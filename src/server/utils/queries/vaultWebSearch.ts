import { insertVaultSource, getVaultSourcesByArtistId } from "./dashboardQueries";
import { getArtistById } from "./artistQueries";
import { SOURCE_TYPES, inferTypeFromUrl, type SourceType } from "@/lib/sourceTypes";
import { fetchPageContent, isUnsafeUrl, OUTBOUND_LINK_CAP, type PageContent } from "@/server/utils/fetchPageContent";
import { classifyFetchedSource, isGroundingRedirect, nameAppearsIn } from "@/server/utils/sourceVerification";
import { webSearch } from "@/server/utils/webSearch";
import { judgeSourceRelevance } from "@/server/utils/sourceRelevance";
import { extractArtistId } from "@/server/utils/services";
import { db } from "@/server/db/drizzle";
import { sql } from "drizzle-orm";
import { isReservedHandle } from "@/lib/platformHandles";
import { isBlockedSourceHost } from "@/lib/sourceAuthority";
import { setArtistLink } from "@/server/utils/artistLinkService";
import {
    PROFILE_LINK_COLUMNS, PLATFORM_DOMAINS, IDENTITY_ANCHOR_COLUMNS,
} from "@/server/utils/artistPlatforms";
import {
    contradictsScrapedPosts, handleBelongsToAnotherArtist, nameIsAmbiguousInDirectory,
} from "@/server/utils/artistIdentityGuards";
import { artistRowProperty } from "@/server/db/artistRowProperties";

// Re-exported: several callers and scripts import these from here.
export { PROFILE_LINK_COLUMNS, PLATFORM_DOMAINS, IDENTITY_ANCHOR_COLUMNS };
import { getSpotifyHeaders, getSpotifyCatalogNames } from "@/server/utils/queries/externalApiQueries";
import type { ArtistVaultSource } from "@/server/db/DbTypes";

// External fetches (redirect resolution) fan out with plain Promise.all — the result set
// is capped at 8 (see the discovery prompt), so bounded concurrency (p-limit) isn't needed.

/** Per-URL read budget for the verification pass.
 *
 *  The fetches run in parallel, so this is the pass's total cost, not a per-URL
 *  one — which is what makes 8s affordable inside the vault step's 45s budget.
 *  It was 5s, and that was measurably too tight: the artist's own website
 *  (peterango.com) reads fine in ~6s and was being demoted to an unverified lead
 *  purely on our own impatience. Demoting a real source is a cheaper mistake than
 *  citing a fake one, but it is still a mistake. */
const VERIFY_TIMEOUT_MS = 8000;

/** Per query, across three queries — so up to 15 candidates before dedupe, which
 *  overlaps heavily in practice. Roughly matches the 8 the old prompt asked for
 *  while giving the dedupe something to work with. */
const TAVILY_RESULTS_PER_QUERY = 5;

/** The artist's own platform links — mirrors PROFILE_DISPLAY_COLUMNS in
 *  linkPresentation.ts. Used to recognise "this is a profile we already have". */
/** Platforms whose identifier is an ACCOUNT the artist owns, so that "this page
 *  is about the artist" also means "this account is theirs". Deliberately
 *  excludes wikipedia and imdb: those identifiers are article titles about a
 *  subject, and an article being about someone does not make it their account. */
/** How many links we chase out of index pages in one discovery run.
 *
 *  Bounded hard because this runs inside discovery's latency budget and an index
 *  can link to hundreds of articles. Three covers a tag archive of one artist's
 *  own coverage, which is the case this exists for; a directory of OTHER people
 *  yields links the judge then rejects, costing three fetches and nothing else. */
const MAX_INDEX_FOLLOWS = 3;

/** How many of a page's outbound links we resolve when deciding whether it is
 *  the artist's own. Matches the cap `extractOutboundLinks` collects, so the two
 *  do not silently disagree about which links matter. Each resolution reads the
 *  urlmap, so this is a real cost on a latency-bounded step. */
const MAX_CORROBORATION_CHECKS = OUTBOUND_LINK_CAP;

/** Bails out of the account-verification pass without touching the run's
 *  results — the name is shared, so a page title proves nothing. */
class SkipAccountPass extends Error {}

/** Ceiling on account pages verified per run. Each is one link-preview fetch. */
const MAX_ACCOUNT_CHECKS = 10;

/** Ceiling on hub pages examined for ownership. Every adoption costs another
 *  getArtistById round trip and every page costs up to MAX_CORROBORATION_CHECKS
 *  urlmap reads, and this is the one pass in this file with no explicit budget
 *  of its own — implicitly bounded only by the caller's outer race. An artist
 *  with more corroborating pages than this has already been identified several
 *  times over. */
const MAX_HUB_PAGES = 5;

/** Ceiling on the propagation pass — see propagateVerifiedHandles. */
const PROPAGATION_BUDGET_MS = 10_000;

/** How much of a handle must look like the artist's name before a page merely
 *  mentioning them counts as theirs. Four characters is short enough for
 *  "dupesdidit" against "Sherwinn Dupes Brice" to fail on prefix and long enough
 *  that "insomniac" against "hardwell" cannot pass. */
const HANDLE_STEM_MIN = 4;

/** Length of the common opening run between a handle and an artist's name,
 *  both folded. Prefix rather than substring: a handle that merely CONTAINS a
 *  common word is not evidence, while one that starts the same way is. */
function sharedPrefix(handle: string, artistName: string): number {
    const a = folded(handle), b = folded(artistName);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
}

/** Letters and digits only, for comparing a name against page text. */
function folded(v: string): string {
    return (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** One spelling of a handle. Stored values are inconsistently "@"-prefixed. */
function normalizeHandle(v: string): string {
    return v.trim().toLowerCase().replace(/^@/, "");
}

/** Reference databases: a record of work, not an account someone posts from.
 *
 *  Worth adopting as a link and NOT worth probing for. A Discogs id cannot be
 *  guessed from an artist's Instagram handle the way a SoundCloud one often
 *  can, so these are kept out of the propagation pass on purpose — they are
 *  adopted only when discovery actually finds the page.
 *
 *  Discogs matters more than its traffic suggests: it is where a producer's or
 *  engineer's credits on OTHER artists' releases are recorded, and that work is
 *  invisible on every streaming profile they have. */
const REFERENCE_PLATFORMS = new Set(["discogs"]);

const ACCOUNT_PLATFORMS = new Set([
    "instagram", "x", "tiktok", "youtube", "youtubechannel",
    "soundcloud", "bandcamp", "twitch", "facebook", "spotify", "deezer",
]);



const TYPE_ALIASES: Record<string, SourceType> = {
    news: "article",
};

function normalizeSourceType(raw: string): SourceType {
    const lower = raw.toLowerCase();
    if (SOURCE_TYPES.includes(lower as SourceType)) return lower as SourceType;
    if (TYPE_ALIASES[lower]) return TYPE_ALIASES[lower];
    return "article";
}

interface WebSearchResult {
    url: string;
    title: string;
    snippet: string;
    type: string;
}

/**
 * Resolve a vertexaisearch redirect URL to its actual destination.
 *
 * Gemini with Google Search grounding returns URLs like
 * `https://vertexaisearch.cloud.google.com/grounding-api-redirect/...`.
 * Those tokens are short-lived: one persisted as a source URL 404s within days,
 * which is exactly what a user hit when they clicked a citation and got
 * Google's "That's an error" page.
 *
 * Returns `null` when the redirect cannot be resolved to a real destination.
 * This function previously returned the redirect URL itself in that case, which
 * is how an expiring token ended up stored as a permanent source. A candidate we
 * cannot resolve is a candidate we drop.
 */
async function resolveRedirectUrl(url: string): Promise<string | null> {
    // Vestigial on this path since retrieval moved to a search API, which returns
    // destination URLs. Kept as a passthrough guard: it is a no-op for any normal
    // URL, and it is the safety net if a future provider ever hands back a
    // redirect token instead of a destination.
    if (!isGroundingRedirect(url)) return url;
    try {
        const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5000) });
        if (res.url && !isGroundingRedirect(res.url) && !isUnsafeUrl(res.url)) {
            return res.url;
        }
    } catch {
        // Fall through — an unresolvable redirect is not a source.
    }
    return null;
}

/**
 * Is this URL's host the artist's own domain?
 *
 * `requireFullName` (below) is right for a page a keyword search returned, but
 * wrong for the artist's own site: peterango.com reads fine, is unambiguously
 * his, and still fails a full-name text match because the page renders the two
 * words apart. Measured — strict said `lead`, loose said `verified`.
 *
 * A hostname that IS the artist's name is stronger evidence of ownership than
 * any phrase in the body, so it earns the looser text check. It cannot reopen
 * the namesake hole this gate exists to close: "Black Dave MK2" matches none of
 * theguardian.com, head-fi.org or soundnews.net.
 */
/** Suffixes a musician actually appends to their own name in a domain. Kept
 *  short and specific on purpose: every entry widens what counts as "theirs". */
/** Public suffixes that occupy two labels, so the registrable domain is three.
 *  Not exhaustive — a full public-suffix list is a dependency this file does not
 *  need. Anything missing here is treated as a plain TLD, which makes the check
 *  STRICTER (it rejects) rather than looser. */
const TWO_PART_TLDS = new Set([
    "co.uk", "org.uk", "me.uk", "ac.uk", "com.au", "net.au", "org.au",
    "co.nz", "co.za", "com.br", "co.jp", "or.jp", "co.kr", "com.mx",
]);

const OWN_DOMAIN_SUFFIXES = ["", "music", "official", "band", "sound", "sounds", "hq", "live", "tv"];

/**
 * Is this the artist's OWN site, rather than a site with their name in it?
 *
 * This used to be `fold(hostname).includes(name)`, which a security review
 * pointed out is a substring test on a string anybody can register. Publish
 * artistname-fans.example, fill it with your own handles, and the relevance
 * judge affirms the page because a fan site genuinely IS about the artist —
 * and this branch treats affirmation plus a name-shaped hostname as proof of
 * ownership. Those handles then become the artist's public profile links.
 *
 * The registrable label must now BE the artist's name, optionally with one of
 * a short list of suffixes a musician actually uses. peterango.com passes;
 * peterango-fans.example does not, and neither does anything else that merely
 * contains the name.
 */
function isArtistOwnDomain(url: string, artistName: string): boolean {
    const fold = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
    const name = fold(artistName);
    if (name.length < 5) return false; // too short to be distinctive in a domain
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
        const parts = host.split(".").filter(Boolean);
        if (parts.length < 2) return false;
        // The REGISTRABLE domain, not the leftmost label. Taking parts[0] was
        // still bypassable: an attacker who controls attacker.example can serve
        // an artist-themed page at peterango.attacker.example, whose leftmost
        // label is the artist's name. Ownership lives at the registrable
        // domain, so that is what has to match.
        const twoPartTld = TWO_PART_TLDS.has(parts.slice(-2).join("."));
        const registrable = parts.slice(twoPartTld ? -3 : -2);
        if (registrable.length < (twoPartTld ? 3 : 2)) return false;
        // Anything to the left of the registrable domain is a subdomain the
        // registrant chose, and says nothing about who they are.
        if (parts.length > registrable.length) return false;
        const label = fold(registrable[0] ?? "");
        return OWN_DOMAIN_SUFFIXES.some(s => label === name + s);
    } catch {
        return false;
    }
}


/** Rows out of a `db.execute` result, whatever shape the driver hands back.
 *
 *  A result that carries no rows means the query ran and matched nothing, which
 *  is an ANSWER. Only a thrown exception means we could not ask. The two must
 *  stay distinguishable, because the guards below fail closed on the second and
 *  conflating them would turn every empty result into a blocked adoption. */
function rowsOf(result: unknown): unknown[] {
    if (!result) return [];
    const r = result as { rows?: unknown[] };
    if (Array.isArray(r.rows)) return r.rows;
    return Array.isArray(result) ? result : [];
}



/**
 * Take an artist's links from MusicBrainz before inferring any from search.
 *
 * This is the step that should have existed first. Everything else in this file
 * infers identity from pages: judge whether one is about the right person, probe
 * a handle, abstain when two answer. MusicBrainz simply holds the answer, curated
 * by people, for six of the seven artists we test against.
 *
 * An IDENTIFIER match — their entry links a Spotify or Deezer id we already hold
 * — is stronger than anything the rest of this file can establish, so those links
 * are adopted directly. An EXACT-NAME match is not, so those go through
 * setArtistLink the same way but only after the same reserved-handle and
 * already-taken checks, and never for a name another artist here shares.
 *
 * Returns the handles it adopted so propagation can carry them onward, and the
 * artist's homepage, which is the hub the search pass otherwise spends a whole
 * round hunting for.
 */
async function adoptFromMusicBrainz(
    artistId: string,
    artistName: string,
    artist: Record<string, unknown>,
    /** Columns holding a discovery guess rather than an answer — see
     *  `holdsAnswerFor`. MusicBrainz relations are the most authoritative
     *  thing this file reads, so they certainly outrank a handle built out of
     *  the artist's name. */
    provisional?: Set<string>,
): Promise<{ handles: Set<string>; homepage: string | null; authoritative: boolean }> {
    const handles = new Set<string>();
    try {
        const { fetchMusicBrainzLinks } = await import("@/server/utils/musicBrainzLinks");
        const found = await fetchMusicBrainzLinks(artistName, {
            spotify: artist.spotify as string | null,
            deezer: artist.deezer as string | null,
        });
        if (!found) return { handles, homepage: null, authoritative: false };

        console.log(`[vaultWebSearch] MusicBrainz matched "${artistName}" by ${found.matchedBy}, ${found.urls.length} link(s)`);
        for (const url of found.urls) {
            const match = await extractArtistId(stripQuery(url)).catch(() => undefined);
            if (!match?.siteName || !match?.id) continue;
            if (!ACCOUNT_PLATFORMS.has(match.siteName) && !REFERENCE_PLATFORMS.has(match.siteName)) continue;
            const id = String(match.id);
            if (isReservedHandle(match.siteName, id)) continue;
            if (holdsAnswerFor(artist, match.siteName, provisional)) continue;
            if (await handleBelongsToAnotherArtist(artistId, match.siteName, id)) continue;
            if (await contradictsScrapedPosts(artistId, match.siteName, id)) {
                console.log(`[vaultWebSearch] MusicBrainz lists ${match.siteName}=${id}, but their own posts are authored by a different handle — ignoring`);
                continue;
            }

            // An IDENTIFIER match is pinned to a DSP id we already hold, so its
            // links are this artist's by construction. An EXACT-NAME match is
            // not, and MusicBrainz curates entities rather than people:
            // Sherwinn Brice's entry lists instagram/dupesdiditmusic, which is
            // "Dupes Did It Music Inc", his COMPANY, while the artist himself is
            // instagram/dupesdidit. Both are live and only one belongs on his
            // profile — so a name match gets the same page check a search result
            // would.
            if (found.matchedBy === "exact-name") {
                // The account-candidate pass refuses to resolve a name that
                // several artists in this directory share, and a MusicBrainz
                // name match is no better evidence than a search result — it
                // is the SAME claim, made by a different source. Three artists
                // here are called Black Dave; a page titled "Black Dave" does
                // not say which one, whoever pointed us at it.
                if (await nameIsAmbiguousInDirectory(artistId, artistName)) {
                    console.log(`[vaultWebSearch] MusicBrainz matched "${artistName}" by name only, but that name is shared in this directory — not adopting`);
                    break;
                }
                const page = await fetchPageContent(stripQuery(url), { timeoutMs: VERIFY_TIMEOUT_MS }).catch(() => null);
                const { titleMatchesArtist } = await import("@/server/utils/profileDiscovery");
                if (!page?.title || !titleMatchesArtist(page.title, artistName)) {
                    console.log(`[vaultWebSearch] MusicBrainz lists ${match.siteName}=${id} but the page is not "${artistName}", ignoring`);
                    continue;
                }
            }
            try {
                await writeArtistLink(artistId, match.siteName, id, provisional, artist);
                console.log(`[vaultWebSearch] MusicBrainz -> ${match.siteName}=${id}`);
                handles.add(normalizeHandle(id));
            } catch (e) {
                console.warn(`[vaultWebSearch] Could not save ${match.siteName} from MusicBrainz:`, e);
            }
        }
        // An identifier match is the strongest thing this pipeline can
        // establish, and the list is curated. Guessing at the platforms it did
        // not name only adds mistakes: Hardwell's youtube is `robberthardwell`
        // and TroyBoi's is `TroyBoiOfficial`, and probing their names produces
        // `hardwell` and `troyboi` — plausible, wrong, and worse than a gap.
        return { handles, homepage: found.homepage, authoritative: found.matchedBy === "identifier" };
    } catch (e) {
        // An enrichment. Losing it costs a few links, not the run.
        console.error("[vaultWebSearch] MusicBrainz lookup failed:", e);
        return { handles, homepage: null, authoritative: false };
    }
}

/**
 * Adopt the account handles an artist published on their own page.
 *
 * An artist's own site is the only first-party statement of their handles that
 * exists, and it lives entirely in href attributes: the text extractor strips
 * them and `extractArticleLinks` is same-host so it never sees them. Sherwinn
 * Brice's Instagram is `dupesdidit`, published on dupes.rocks, while profile
 * discovery guessed `dupes` from his name. No name-derived slug reaches it.
 *
 * But we cannot trust every account link on every page — a magazine's footer
 * links to the MAGAZINE's Instagram, and adopting that would put a publication's
 * account on an artist's profile.
 *
 * CORROBORATION: his site links to dupes.bandcamp.com and we already hold
 * `bandcamp: dupes` for him, confirmed. A page linking to an identifier we have
 * independently verified is his hub. RVA Mag's footer does not link to his
 * Bandcamp. Identity through a matched (platform, id) pair, never through a
 * name — the discipline that keeps a film soundtrack's Wikipedia page off an
 * artist's profile.
 *
 * DELIBERATELY INDEPENDENT OF THE RELEVANCE JUDGE below. The judge decides
 * whether a page is worth citing as coverage; this decides whose page it is,
 * from a verified id rather than from text. A page can legitimately fail the
 * judge (an artist's own site is not "coverage") and still be authoritative
 * about its owner's handles.
 *
 * Links are resolved ONCE. `extractArtistId` reads the whole urlmap from the
 * database with no memoisation, so corroborating and adopting in two separate
 * passes cost twice the round trips on a latency-bounded step — invisible in
 * tests, where it is mocked, and only visible in production.
 */
/**
 * Does the artist's row hold a real ANSWER for this platform, or a placeholder?
 *
 * Three passes in this file skip a platform under "already have it". That is
 * right when the value is an answer and wrong when it is a guess — and by the
 * time this search runs, the onboarding auto-build has already written whatever
 * profile discovery came up with, including handles it built out of the
 * artist's own name and nothing else.
 *
 * That is how Black Dave MK2 ended up with instagram=blackdavemk2. Discovery
 * constructed the URL from his name, a real account answered (its title even
 * reads "Black Dave MK2"), and it went to the row. This search then found
 * blackdave.xyz — corroborated, the answer Pete confirmed — and skipped the
 * column because it was full. First writer wins, and the first writer is the
 * one with the least evidence. Running the search ALONE found blackdave.xyz on
 * 8/27; running the artist's real sequence stopped finding it.
 *
 * So the caller names the columns holding a guess and they are treated as still
 * open. Everything else about the passes is unchanged: a candidate still has to
 * clear the identity guards and the name cross-check before it is written, so
 * this widens what may be ANSWERED, never what counts as evidence.
 */
function holdsAnswerFor(artist: Record<string, unknown>, siteName: string, provisional?: Set<string>): boolean {
    return !!artist[siteName] && !provisional?.has(siteName);
}

/** Write a link and stop calling that column provisional.
 *
 *  The set is built once, before the run, and three passes consult it in
 *  sequence: account candidates, then hub adoption, then propagation. Without
 *  this, a column stayed marked open AFTER one of them had put a real answer
 *  in it — so the account pass could replace Black Dave MK2's guess with the
 *  corroborated handle and hub adoption could then replace THAT with a third,
 *  inside the same run. Once anything writes an answer it is an answer.
 *
 *  Every setArtistLink in this file goes through here for that reason: the
 *  bookkeeping is one line and the whole point of it is that it cannot be
 *  forgotten at one of five call sites. */
async function writeArtistLink(
    artistId: string, siteName: string, value: string, provisional?: Set<string>,
    /** The in-memory snapshot the gates read. Updated so a LATER gate in the
     *  same pass can see this write.
     *
     *  Every "already have it" check in this file reads a record fetched before
     *  its loop started, which cannot see what the loop itself just wrote. The
     *  judge-affirmed account path wrote bandcamp THREE times in one run for
     *  Sherwinn Brice — dupes, dupes again, then radicalone from an album page
     *  crediting him — and the last one won, so he ended with another artist's
     *  Bandcamp. The gate was there and was reading a stale answer.
     *
     *  The MusicBrainz path already did this by hand ("so the search pass does
     *  not re-add it"). Doing it here means every path gets it, including the
     *  ones nobody has hit yet. */
    record?: Record<string, unknown>,
): Promise<void> {
    await setArtistLink(artistId, siteName, value);
    provisional?.delete(siteName);
    if (record) record[siteName] = value;
}

async function adoptHandlesFromOwnPage(
    artistId: string,
    outboundLinks: string[],
    artist: Record<string, unknown>,
    artistName: string,
    /** The page these links came from, and what the judge made of it. */
    page?: { url: string; aboutArtist: boolean },
    /** Columns holding a discovery guess rather than an answer — see
     *  `holdsAnswerFor`. */
    provisional?: Set<string>,
): Promise<{ adopted: number; handles: Set<string> }> {
    const resolved: { siteName: string; id: string }[] = [];
    for (const link of outboundLinks.slice(0, MAX_CORROBORATION_CHECKS)) {
        const match = await extractArtistId(stripQuery(link)).catch(() => undefined);
        if (match?.siteName && match?.id) resolved.push({ siteName: match.siteName, id: normalizeHandle(String(match.id)) });
    }

    const corroborator = resolved.find(r => {
        const held = artist[r.siteName];
        // Normalised on BOTH sides. isKnownProfileUrl in this file already
        // strips a leading "@", as do profileDiscovery, socialIngest and
        // socialSignals — a stored "@dupesdidit" comparing unequal to a
        // resolved "dupesdidit" would silently disable this whole feature for
        // that artist, with no error anywhere.
        return typeof held === "string" && !!held && normalizeHandle(held) === r.id;
    });
    // Failing that: the page IS the artist's domain, and the judge — reading it
    // against their verified catalog — says it is about them.
    //
    // Pete Rango's site links his real Instagram and X and NOTHING we already
    // hold: no spotify, no deezer, no bandcamp, just imdb, wikipedia and an HBO
    // credit. Under id-corroboration alone he scored 0 of 7 known handles while
    // Sherwinn Brice scored 5 of 5, because Brice's site happens to link his
    // Bandcamp. A hostname that folds to the artist's own name is the other
    // honest way to know whose page this is.
    //
    // The judge's affirmation is required HERE and not for an id match, because
    // a name in a domain is weaker: three artists called Black Dave are in this
    // directory, and a blackdave.com would fold identically for all of them. An
    // id cannot be ambiguous that way, so it stands alone.
    // A shared name in a domain is no better than a shared name anywhere else:
    // a blackdave.com would fold identically for all three artists here called
    // Black Dave. The other adoption paths abstain on an ambiguous name and so
    // does this one.
    const ownDomain = !corroborator
        && !!page?.aboutArtist
        && isArtistOwnDomain(page.url, String(artist.name ?? ""))
        && !(await nameIsAmbiguousInDirectory(artistId, String(artist.name ?? "")));

    if (!corroborator && !ownDomain) return { adopted: 0, handles: new Set<string>() };
    console.log(corroborator
        ? `[vaultWebSearch] Page corroborated by known ${corroborator.siteName}=${corroborator.id}`
        : `[vaultWebSearch] Page corroborated as the artist's own domain: ${page!.url.slice(0, 70)}`);

    // A page naming TWO different handles for one platform is ambiguous — an
    // artist's footer can carry their own Instagram beside their label's. The
    // pre-loop `artist` snapshot never sees what this loop just wrote, so
    // without this the second silently overwrites the first and the result is
    // decided by link order. Abstain instead of guessing.
    const ambiguous = new Set(
        resolved
            .filter(r => resolved.some(o => o.siteName === r.siteName && o.id !== r.id))
            .map(r => r.siteName),
    );
    for (const platform of ambiguous) {
        console.log(`[vaultWebSearch] Own page names more than one ${platform} handle — adopting none`);
    }

    // A genuine hub links the artist's OWN accounts and only those: dupes.rocks
    // gives dupesdidit throughout, peterango.com gives p3t3rango throughout. A
    // third party gives a MIX — an Insomniac page linking Hardwell's SoundCloud
    // corroborates as his, then offers youtube/insomniac, tiktok/insomniacevents
    // and x/hardwell side by side.
    //
    // So when some handles on a page resemble the artist and others do not, keep
    // only the ones that do. When NONE resemble, keep them all: that is the
    // normal case for a hub whose owner's handle is nothing like their name, and
    // it is how Sherwinn Brice's `dupesdidit` is found at all.
    const accountHandles = resolved.filter(r => ACCOUNT_PLATFORMS.has(r.siteName) || REFERENCE_PLATFORMS.has(r.siteName));
    const anyResembles = accountHandles.some(r => sharedPrefix(r.id, artistName) >= HANDLE_STEM_MIN);

    let adopted = 0;
    const done = new Set<string>();
    const adoptedHandles = new Set<string>();
    for (const r of resolved) {
        if (!ACCOUNT_PLATFORMS.has(r.siteName) && !REFERENCE_PLATFORMS.has(r.siteName)) continue;
        if (anyResembles && sharedPrefix(r.id, artistName) < HANDLE_STEM_MIN) {
            console.log(`[vaultWebSearch] Page mixes "${artistName}" accounts with ${r.siteName}=${r.id}; keeping only theirs`);
            continue;
        }
        // instagram.com/p/<id> resolves to the "handle" p — one adoption away
        // from writing that onto an artist row.
        if (isReservedHandle(r.siteName, r.id)) continue;
        if (ambiguous.has(r.siteName)) continue;
        if (done.has(r.siteName)) continue;
        if (holdsAnswerFor(artist, r.siteName, provisional)) continue; // already have it
        if (await contradictsScrapedPosts(artistId, r.siteName, r.id)) {
            console.log(`[vaultWebSearch] ${r.siteName}=${r.id} contradicts the handle their own posts are authored by, ignoring`);
            continue;
        }
        // A corroborated page can still list somebody else's account — a label,
        // a collaborator, a support act. The MusicBrainz, account-candidate and
        // propagation paths all check this and this one did not, so a handle
        // the directory already assigns to its real owner could be written onto
        // a second artist as well.
        if (await handleBelongsToAnotherArtist(artistId, r.siteName, r.id)) {
            console.log(`[vaultWebSearch] ${r.siteName}=${r.id} is already another artist's, not adopting from the hub page`);
            continue;
        }
        try {
            await writeArtistLink(artistId, r.siteName, r.id, provisional, artist);
            console.log(`[vaultWebSearch] Adopted ${r.siteName}=${r.id} from the artist's own page`);
            done.add(r.siteName);
            adoptedHandles.add(r.id);
            adopted++;
        } catch (e) {
            console.warn(`[vaultWebSearch] Could not save ${r.siteName} from own page:`, e);
        }
    }

    // Propagation is NOT triggered here. This function runs once per hub page,
    // and discoverArtistProfiles carries its own 35s budget against a caller
    // that races the whole search at 38s — so propagating per page would let an
    // artist with two corroborating pages blow the budget outright. The handles
    // go back to the caller, which propagates once for the run.
    return { adopted, handles: adoptedHandles };
}

/**
 * Carry the handles we verified to the platforms we still have nothing for.
 *
 * Profile discovery's propagation tier always knew how to do this; what it
 * lacked was a handle worth carrying. Given only the NAME "Sherwinn Dupes
 * Brice" it produced `dupes` — wrong, his handle is `dupesdidit` — and missed
 * his SoundCloud entirely.
 *
 * PROBES EVERY VERIFIED HANDLE AND ABSTAINS ON A TIE. An artist can hold more
 * than one: Pete Rango is `p3t3rango` on Instagram and X, `peterango` on
 * SoundCloud. Taking whichever candidate came back first gave him
 * twitch=peterango when his Twitch is p3t3rango — a wrong link, which is worse
 * than the gap it replaced.
 *
 * Probing separates them where the platform lets it. Only one YouTube resolves
 * ("Pete Rango"); only one Bandcamp resolves ("rush, by PETE RANGO"). But
 * twitch.tv answers for BOTH, with titles that merely echo the handle back —
 * so there we genuinely cannot tell from outside, and we leave it empty.
 */
async function propagateVerifiedHandles(
    artistId: string,
    verified: Set<string>,
    artist: Record<string, unknown>,
    artistName: string,
    callerDeadline: number = Number.POSITIVE_INFINITY,
    /** Columns holding a discovery guess rather than an answer — see
     *  `holdsAnswerFor`. */
    provisional?: Set<string>,
): Promise<number> {
    const handles = [...verified].filter(h => h.length >= 3);
    if (handles.length === 0) return 0;

    // Bounding the WORK, not just the wait. This used to be a Promise.race
    // against the same budget, which is weaker than it looks: the loser of a
    // race is never cancelled, so the loop kept probing and kept WRITING long
    // after the caller had given up and the HTTP response had gone out. A
    // deadline checked between probes stops the work itself.
    // Its own ceiling OR whatever the caller has left, whichever comes first.
    // A fixed budget added on top of every earlier phase is how the phases
    // came to sum past the caller's cap.
    const deadline = Math.min(Date.now() + PROPAGATION_BUDGET_MS, callerDeadline);
    const outOfTime = () => Date.now() > deadline;

    let adopted = 0;
    try {
        const { fetchLinkPreview } = await import("@/server/utils/linkPreview");
        const { titleMatchesArtist } = await import("@/server/utils/profileDiscovery");
        const { getAllLinks } = await import("./artistQueries");
        const urlmap = await getAllLinks();

        for (const platform of ACCOUNT_PLATFORMS) {
            if (outOfTime()) { console.log("[vaultWebSearch] Propagation budget spent, stopping"); break; }
            if (holdsAnswerFor(artist, platform, provisional)) continue; // already have it
            if (PROBE_BLIND_PLATFORMS.has(platform)) continue;    // serves a bot nothing
            const row = urlmap.find(u => u.siteName === platform);
            const pattern = row?.appStringFormat;
            if (!pattern?.includes("%@")) continue;

            const resolved: string[] = [];
            // Whether every candidate actually got looked at. Running out of
            // time after checking one handle leaves resolved.length === 1,
            // which is indistinguishable from "exactly one of them answered" —
            // and that is the tie-blindness this whole function exists to
            // avoid. A scan that did not finish cannot conclude anything.
            let scannedAll = true;
            for (const handle of handles) {
                if (outOfTime()) { scannedAll = false; break; }
                if (isReservedHandle(platform, handle)) continue;
                if (await handleBelongsToAnotherArtist(artistId, platform, handle)) continue;
                if (await contradictsScrapedPosts(artistId, platform, handle)) continue;
                const preview = await fetchLinkPreview(pattern.replace("%@", handle)).catch(() => null);
                // The title must NAME the artist, not merely exist. Bandcamp and
                // Twitch answer for handles nobody owns: probing
                // twitch.tv/pharaohsistare returns the bare string "Twitch", and
                // taking that as proof gave Pharaoh Sistare six identical
                // handles, one of which is an account that does not exist.
                if (preview?.title && titleMatchesArtist(preview.title, artistName)) resolved.push(handle);
            }

            if (!scannedAll) {
                console.log(`[vaultWebSearch] ${platform} scan ran out of time before checking every handle — leaving empty rather than guessing`);
                continue;
            }
            if (resolved.length !== 1) {
                if (resolved.length > 1) {
                    console.log(`[vaultWebSearch] ${platform} answers for ${resolved.join(" and ")} — cannot tell which is theirs, leaving empty`);
                }
                continue;
            }
            try {
                await writeArtistLink(artistId, platform, resolved[0], provisional, artist);
                console.log(`[vaultWebSearch] Propagated verified handle -> ${platform}=${resolved[0]}`);
                adopted++;
            } catch (e) {
                console.warn(`[vaultWebSearch] Could not propagate ${platform}:`, e);
            }
        }
    } catch (e) {
        // Never fail the vault step over this — everything already adopted stands.
        console.error("[vaultWebSearch] Propagation pass failed:", e);
    }
    return adopted;
}

/** Platforms a probe cannot settle, for two different reasons — both measured.
 *
 *  `tiktok` serves a server-side fetch nothing at all, so a miss is not evidence
 *  of absence. `twitch` answers, but its title only ever echoes the handle back
 *  ("peterango - Twitch") and never the display name, so it can tell us an
 *  account exists and never whose it is. Pete Rango holds two verified handles
 *  and twitch answers for both; his real Twitch stays empty rather than being
 *  guessed.
 *
 *  `bandcamp` is the third shape: it returns 200 with a plausible title for a
 *  subdomain nobody owns — kaskade.bandcamp.com answers "Music | Kaskade" — so
 *  a constructed probe cannot distinguish a real page from a fabricated one. A
 *  bandcamp URL that came back from SEARCH is still adopted, because being
 *  indexed means it exists; only guessing at the URL is blocked. */
const PROBE_BLIND_PLATFORMS = new Set(["tiktok", "twitch", "bandcamp"]);

const IDENTITY_MATCH_MIN_LENGTH = 4; // shorter values match far too much

/** Where each stored handle actually lives. A handle only identifies a profile
 *  on its OWN platform. */


/**
 * The part of a stored value that identifies the profile.
 *
 * Almost always the value itself — these columns hold handles. When one holds a
 * whole url, the identifying part is its last meaningful path segment: a
 * Facebook profile stored as ".../people/Angela-Bofill/100044180243805/"
 * identifies the same page as "profile.php?id=100044180243805", and only the
 * number is common to both.
 */
function identifyingPart(value: string): string {
    const v = value.trim().toLowerCase().replace(/^@/, "");
    if (!/^https?:\/\//.test(v)) return v;
    const segments = v.split(/[?#]/)[0].split("/").filter(Boolean).slice(2);
    // The longest segment is the identifier; the rest is routing ("people",
    // "artist", a display name).
    return segments.sort((a, b) => b.length - a.length)[0] ?? v;
}

function isKnownProfileUrl(url: string, artist: Record<string, unknown>): boolean {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return false;
    }
    const haystack = url.toLowerCase();
    return PROFILE_LINK_COLUMNS.some(col => {
        // A stored value is USUALLY a handle and occasionally a whole url. Ten
        // rows hold one — a Facebook profile saved as
        // ".../people/Angela-Bofill/100044180243805/", a Bandcamp, a Discogs,
        // six Farcasters — and `haystack.includes(wholeUrl)` can essentially
        // never match, so those artists' own profiles were never recognised as
        // theirs. Comparing the identifying part instead covers all of them
        // rather than special-casing the one the review happened to find.
        // BY ROW PROPERTY, NOT BY COLUMN NAME. The column is `facebookID` and
        // the Drizzle property is `facebookId`, so indexing by the column read
        // undefined and an artist's own numeric Facebook profile was never
        // recognised as one we already hold — it could still be filed as press
        // about them. The same list the link writer uses, rather than a third
        // copy of it.
        const value = artist[artistRowProperty(col)];
        if (typeof value !== "string") return false;
        const v = identifyingPart(value);
        if (v.length < IDENTITY_MATCH_MIN_LENGTH) return false;
        // The handle must appear ON ITS OWN PLATFORM. Without this the check is
        // a bare substring test: an artist whose Bandcamp handle is "dupes" had
        // his own website, dupes.rocks, discarded as "a profile we already
        // have" — so the one page that states his real Instagram never reached
        // the loop. Same substring-for-identity mistake as every other one this
        // pipeline has made.
        const domains = PLATFORM_DOMAINS[col];
        if (!domains?.some(d => host === d || host.endsWith(`.${d}`))) return false;
        return haystack.includes(v);
    });
}

/** Query strings and fragments are never part of a platform handle, and
 *  extractArtistId will happily fold one in ("p3t3rango?hl=en"). */
function stripQuery(raw: string): string {
    try {
        const u = new URL(raw);
        u.search = "";
        u.hash = "";
        return u.toString();
    } catch {
        return raw.split(/[?#]/)[0];
    }
}

/** Machine formats a person should never be handed as a "source".
 *
 *  A real artist's vault held the same article twice: rvamag.com/tags/<tag> and
 *  rvamag.com/tags/<tag>/feed. They looked like duplicates because an RSS
 *  channel carries the same <title> as its page, but the second was raw XML.
 *  Dedup could not catch it (different paths, correctly) and the deeper problem
 *  was accepting a feed at all: clicking it shows a fan an XML document.
 *
 *  Filtering these before the fetch also saves the request. */
function isMachineFormatUrl(raw: string): boolean {
    const url = raw.toLowerCase().split(/[?#]/)[0];
    if (/\.(xml|rss|atom|json)$/.test(url)) return true;
    if (/\/(feed|rss|atom)\/?$/.test(url)) return true;
    return /[?&](feed|format)=(rss|atom|xml|json)/.test(raw.toLowerCase());
}

/** Normalize a URL for dedup comparison: lowercase, strip protocol/www/trailing slash */
function normalizeUrl(raw: string): string {
    try {
        const u = new URL(raw);
        const host = u.hostname.replace(/^www\./, "").toLowerCase();
        const path = u.pathname.replace(/\/+$/, "").toLowerCase();
        return `${host}${path}`;
    } catch {
        // Fallback for malformed URLs
        return raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    }
}

/**
 * Finds articles/interviews/reviews about an artist and inserts them as pending
 * vault sources.
 *
 * Retrieval is a REAL SEARCH API (see webSearch.ts), not a model. It used to be
 * Gemini with `googleSearch` grounding asked to "return ONLY a JSON array" —
 * which meant the model AUTHORED the URLs. Grounding loads real results into
 * context, but emitting JSON is generation, and nothing bound the two together:
 * Gemini reports what it actually retrieved in `groundingMetadata.groundingChunks`
 * and that was never read. The result was confident fabrication — a real artist's
 * vault filled with a YouTube interview whose video ID 404s and a channel page
 * that never mentions him, both with invented titles and descriptions.
 *
 * The same lesson was already learned for profile discovery (webSearch.ts's
 * docblock: "a model deciding whether to search is not a substitute for an actual
 * search API") and simply never applied here.
 *
 * A search API cannot invent a URL. It CAN return the wrong person, so the
 * verification pass below runs with `requireFullName` — see the comment there.
 */
export async function searchAndPopulateVault(
    artistId: string,
    opts?: {
        deadline?: number;
        /** Columns the caller wrote from a GUESS, not an answer — see
         *  `holdsAnswerFor`. Only the onboarding auto-build passes these,
         *  because it is the only caller that writes handles nobody has
         *  looked at, immediately before calling this. */
        provisionalSiteNames?: string[];
    },
): Promise<ArtistVaultSource[]> {
    const provisional = new Set(opts?.provisionalSiteNames ?? []);
    // A DEADLINE THE CALLER OWNS, rather than per-phase budgets that happen to
    // add up to less than it.
    //
    // A review made the arithmetic explicit: the onboarding vault step races
    // this whole call against 45 seconds, while inside it MusicBrainz can spend
    // three 8-second detail timeouts plus pacing, Tavily six, relevance judging
    // twenty, page verification eight, and propagation ten. On slow-but-allowed
    // responses the outer race wins first, the step re-reads a half-written
    // vault and shows the artist that, and the losing side of the race — which
    // Promise.race never cancels — keeps writing sources after the step has
    // moved on.
    //
    // Checking between phases does not cancel work already in flight, but it
    // does stop us STARTING a phase that cannot finish, which is what turns an
    // overrun into writes landing behind the artist's back.
    const deadline = opts?.deadline ?? Number.POSITIVE_INFINITY;
    const outOfBudget = (phase: string): boolean => {
        if (Date.now() < deadline) return false;
        console.log(`[vaultWebSearch] Out of time before ${phase} — stopping rather than writing behind the caller`);
        return true;
    };

    const artist = await getArtistById(artistId);
    if (!artist) return [];

    const artistName = artist.name ?? "Unknown Artist";

    // Exact-phrase queries: an unquoted multi-word name matches each token
    // independently, which is how "Black Dave" returns Dave the UK rapper. The
    // three angles mirror the categories the vault actually wants.
    // Before inferring anything: ask a database that already knows. Its handles
    // are curated rather than probed, and its homepage is the hub the search
    // pass would otherwise spend a round hunting for.
    const fromMusicBrainz = outOfBudget("MusicBrainz")
        ? { handles: new Set<string>(), homepage: null, authoritative: false }
        : await adoptFromMusicBrainz(artistId, artistName, artist as unknown as Record<string, unknown>, provisional);

    if (outOfBudget("web search")) return [];

    const queries = [
        `"${artistName}" music artist interview`,
        `"${artistName}" music review`,
        `"${artistName}" artist profile`,
        // The bare name, unquoted and unqualified — the way a person searches.
        // The three above all demand the exact phrase AND an editorial word, so
        // they systematically miss the artist's OWN pages: Black Dave MK2's
        // instagram is titled "Black Dave! (@blackdave.xyz)" and never contains
        // the string "Black Dave MK2", and his website blackdave.xyz appears
        // for `black dave mk2` and for nothing we were asking.
        //
        // This is the query that loses the exact-phrase protection, so it is the
        // one the judge and the corroboration rules exist to clean up after.
        artistName,
        // CREDITS, which none of the above will ever find. The editorial queries
        // want articles and the bare name wants anything; neither surfaces a
        // credits database, and for a producer or an engineer that is where
        // most of their actual work is recorded. Pete Rango appears in the
        // credits of other artists' releases on Discogs and nothing we searched
        // for would have returned it — his vault had a Clubhouse profile in it
        // and no record of the records he made.
        `"${artistName}" discogs credits`,
    ];

    try {
        const perQuery = await Promise.all(
            queries.map(q => webSearch(q, { maxResults: TAVILY_RESULTS_PER_QUERY })),
        );

        // MusicBrainz names the artist's official homepage, and until a review
        // pointed it out we returned that field and never read it. That page is
        // the hub the search pass spends a whole round hunting for — the one
        // that lists their real accounts — and whenever search failed to return
        // the site independently we threw away a curated answer to a question we
        // were about to ask. Seeded first so it survives the dedupe below.
        const seeded: WebSearchResult[] = [];
        if (fromMusicBrainz.homepage) {
            seeded.push({
                url: fromMusicBrainz.homepage,
                title: artistName,
                snippet: "",
                type: inferTypeFromUrl(fromMusicBrainz.homepage),
            });
            console.log(`[vaultWebSearch] Seeding MusicBrainz homepage into discovery: ${fromMusicBrainz.homepage.slice(0, 70)}`);
        }

        // Dedupe across queries by URL; the three angles overlap heavily.
        const byUrl = new Map<string, WebSearchResult>();
        for (const hit of [...seeded, ...perQuery.flat()]) {
            if (!hit.url || !hit.title) continue;
            const key = normalizeUrl(hit.url);
            if (byUrl.has(key)) continue;
            byUrl.set(key, {
                url: hit.url,
                title: hit.title,
                snippet: hit.snippet ?? "",
                // Tavily returns no category, and asking a model to supply one
                // would put generated content back on this path for no benefit.
                // The URL itself is a better signal and it cannot be invented.
                type: inferTypeFromUrl(hit.url),
            });
        }
        const results: WebSearchResult[] = [...byUrl.values()];

        if (results.length === 0) {
            console.log(`[vaultWebSearch] Web search returned nothing for "${artistName}"`);
            return [];
        }

        // Dedup against pending, approved AND rejected.
        //
        // Rejected was deliberately excluded, to "allow re-discovery of
        // deleted/rejected URLs". That cost more than it bought: a rejection is
        // the single most reliable signal we have about who an artist is NOT,
        // and re-offering something they already said no to reads as not
        // listening. Black Dave rejecting the Chord DAVE amplifier reviews and
        // Dave the UK rapper's Guardian interview should not have to reject
        // them again on the next run.
        //
        // Deleted URLs are unaffected: a deleted row is gone from the table, so
        // it can never appear in any of these three sets and stays
        // re-discoverable exactly as before.
        const [pendingSources, approvedSources, rejectedSources] = await Promise.all([
            getVaultSourcesByArtistId(artistId, "pending"),
            getVaultSourcesByArtistId(artistId, "approved"),
            getVaultSourcesByArtistId(artistId, "rejected"),
        ]);
        const existingSources = [...pendingSources, ...approvedSources, ...rejectedSources];
        const existingUrls = new Set(
            existingSources.map((s) => normalizeUrl(s.url))
        );

        // Resolve vertexaisearch redirect URLs to their real destinations in PARALLEL.
        // Each redirect fetch can take several seconds and there can be up to 8; doing
        // them sequentially could blow the request budget now that discovery runs inside
        // About generation (bounded by the route's 57s race). An unresolvable redirect
        // yields null and the candidate is dropped — never stored as-is.
        const named = results.filter((r) => r.url && r.title);
        const resolved = (await Promise.all(
            named.map(async (r) => {
                const url = await resolveRedirectUrl(r.url);
                return url ? { ...r, url } : null;
            })
        )).filter((r): r is WebSearchResult => r !== null);

        // Dedup and safety-filter BEFORE fetching, so the verification pass below
        // never spends its budget on a URL we were going to discard anyway.
        // Tracked separately so the logs distinguish "we already had this" from
        // "the artist told us no" — the second is a signal worth watching.
        const rejectedUrls = new Set(rejectedSources.map(r => normalizeUrl(r.url)));
        const candidates: WebSearchResult[] = [];
        let skipped = 0;
        let rejectedSkips = 0;
        for (const result of resolved) {
            // Reject non-http(s) schemes and private/local hosts. Still required with
            // a search API: these URLs are rendered as <a href> on a public page, and
            // the provider is an external system whose output we do not control.
            if (isKnownProfileUrl(result.url, artist as unknown as Record<string, unknown>)) {
                skipped++;
                continue;
            }

            if (isMachineFormatUrl(result.url)) {
                console.log(`[vaultWebSearch] Skipping machine format (feed/XML): ${result.url.slice(0, 100)}`);
                skipped++;
                continue;
            }
            // A host with no author on it. Dropped here rather than after the
            // fetch so we neither read nor judge it: these pages are readable
            // and are genuinely about the artist, so the judge affirms them and
            // they become citable press. Pharaoh Sistare's vault holds a
            // Viberate stats page for exactly that reason, and Pete Rango's
            // Boomplay page arrived by the other route — unreadable, but its
            // search title carried his full name, so it passed as a lead.
            if (isBlockedSourceHost(result.url)) {
                console.log(`[vaultWebSearch] Blocked host, not a source: ${result.url.slice(0, 100)}`);
                skipped++;
                continue;
            }
            if (isUnsafeUrl(result.url)) {
                console.warn(`[vaultWebSearch] Skipping unsafe URL: ${result.url.slice(0, 100)}`);
                continue;
            }
            const normalized = normalizeUrl(result.url);
            if (existingUrls.has(normalized)) {
                if (rejectedUrls.has(normalized)) rejectedSkips++;
                skipped++;
                continue;
            }
            // Add to set so subsequent results in the same batch don't duplicate
            existingUrls.add(normalized);
            candidates.push(result);
        }

        // VERIFICATION PASS — still the point of this function's existence.
        //
        // Retrieval no longer invents URLs, but a search hit is a claim about a page,
        // not the page. It can be dead, paywalled, since-repurposed, or about a
        // different person of the same name — and the last of those is the live risk
        // now that a keyword index is the source: "Black Dave" returns real, working
        // articles about Dave the UK rapper. So every candidate is still fetched and
        // classified before a row is written, because a row is the thing that later
        // gets cited.
        //
        // So every candidate is fetched, in parallel, and classified. This is AWAITED
        // (it used to be fire-and-forget) because the classification has to happen before
        // the row is written — a row is the thing that later gets cited. The timeout is
        // deliberately tight: this runs inside the onboarding/About budget alongside a
        // 12-33s grounded discovery call, and a slow-but-real site being demoted to an
        // unverified lead is a much better outcome than blowing the turn's deadline.
        // The deadline was checked before MusicBrainz and before search and
        // then never again, so once search returned, verification, judging,
        // insertion, hub adoption and index following all ran regardless — the
        // exact phases that WRITE. Rechecked before each of them now.
        if (outOfBudget("page verification")) return [];
        const verified = await Promise.all(
            candidates.map(async (result) => ({
                result,
                page: await fetchPageContent(result.url, { timeoutMs: VERIFY_TIMEOUT_MS }),
            }))
        );

        // RELEVANCE JUDGEMENT — the model's job, now that retrieval is not.
        //
        // A substring check ("does the page contain the artist's name") cannot
        // tell a Chord DAVE amplifier review from Black Dave, or a Peter Calandra
        // interview from Pete Rango. All three reached real artists' vaults. The
        // verified anchor below — real catalog, confirmed accounts — is evidence
        // a name match doesn't have.
        //
        // Runs once for the whole batch, and never rejects on failure: an
        // unavailable judge leaves everything `undecided` and the name check
        // below decides, exactly as before. Deleting an artist's real press
        // because Gemini had a bad day would be worse than no judge at all.
        const spotifyId = typeof artist.spotify === "string" ? artist.spotify : "";
        const catalog = spotifyId
            ? await (async () => {
                try {
                    return await getSpotifyCatalogNames(spotifyId, await getSpotifyHeaders());
                } catch {
                    return { releases: [] as string[], topTracks: [] as string[] };
                }
            })()
            : { releases: [] as string[], topTracks: [] as string[] };
        const identifiers = IDENTITY_ANCHOR_COLUMNS.flatMap(col => {
            const v = (artist as unknown as Record<string, unknown>)[artistRowProperty(col)];
            return typeof v === "string" && v ? [`${col}: ${v}`] : [];
        });
        if (outOfBudget("relevance judging")) return [];
        const relevance = await judgeSourceRelevance(
            { name: artistName, catalog: [...catalog.topTracks, ...catalog.releases], identifiers },
            verified.map(({ result, page }) => ({
                url: result.url,
                title: page.title ?? result.title,
                text: page.fullText ?? page.extractedText,
                ownDomain: isArtistOwnDomain(result.url, artistName),
            })),
        );

        const insertedSources: ArtistVaultSource[] = [];
        /** Article URLs harvested from index pages, followed after the main pass. */
        const indexLinks = new Set<string>();
        /** Account URLs the search returned — candidate handles, verified below. */
        const accountCandidates: { siteName: string; id: string; url: string; title: string; description: string }[] = [];
        /** Seeded with whatever MusicBrainz gave us — curated handles are at
         *  least as trustworthy as ones we read off a page. */
        /** Handles proven to be this artist's, however we proved it. Both the
         *  account-title check and the own-page adoption contribute, and the
         *  propagation pass runs once over the union — a handle confirmed by a
         *  page title is exactly as good as one read off the artist's website. */
        const verifiedHandles = new Set<string>(fromMusicBrainz.handles);
        /** Outbound links per page, examined for ownership once the loop is done. */
        const hubCandidates: { links: string[]; url: string; aboutArtist: boolean }[] = [];
        let dropped = 0;
        for (const { result, page } of verified) {
            // requireFullName: a keyword search returns REAL pages about the wrong
            // person, and the default distinctive-token match is far too loose for
            // that — "Black Dave" reduces to "black", which matches a large share of
            // the web. Without this, a namesake article becomes `verified`, gains
            // extractedText, and is therefore citable in the artist's About. That
            // would be a worse failure than the invented URLs this path replaced,
            // because it is plausible. Anything that only half-matches degrades to
            // an unverified lead the artist can still see and judge.
            // A social profile is IDENTITY, not something written about the artist,
            // so it belongs in links rather than the vault. But ONLY once the page
            // has been fetched and the judge has affirmed it is this artist.
            //
            // An earlier version routed on the URL pattern alone, before any
            // fetch. It put en.wikipedia.org/wiki/Rango:_Music_from_the_Motion_Picture
            // on a real artist's profile as "his" Wikipedia, because the URL
            // matched the wikipedia pattern. Matching a platform's URL shape says
            // nothing whatsoever about whose page it is.
            //
            // ACCOUNT_PLATFORMS is the second half of that lesson: an account
            // identifier is a handle a person owns, while wikipedia and imdb
            // identifiers are article titles about a subject. Only the former can
            // be inferred from a page being about someone.
            const profileMatch = await extractArtistId(stripQuery(result.url)).catch(() => undefined);
            const isAccountUrl = !!profileMatch?.siteName
                && !!profileMatch?.id
                && (ACCOUNT_PLATFORMS.has(profileMatch.siteName) || REFERENCE_PLATFORMS.has(profileMatch.siteName))
                // `instagram.com/p/DUtSSjnCYcU` is a POST, and the urlmap regex
                // reads its first path segment as the handle — so this arrives as
                // `{ instagram, id: "p" }`. Writing that would set the artist's
                // Instagram to "p". See isReservedHandle.
                && !isReservedHandle(profileMatch.siteName, profileMatch.id);

            // NEVER OVERWRITE A LINK THE ARTIST ALREADY HAS. setArtistLink is
            // an unconditional update for non-DSP columns, and every other
            // adoption path in this file checks `artist[platform]` first — this
            // one did not, so a namesake, a label account or a fan page that the
            // judge affirmed could replace a confirmed link. A second account on
            // a platform we already have is not an upgrade; it is a different
            // account, and we have no way to tell which is theirs.
            // `provisional` is deliberately NOT passed here, so this gate stays
            // shut even for a column holding a guess. This is the weakest of
            // the four adoption paths — a search result the judge called
            // about-artist, whose URL happens to be an account URL, with no
            // cross-check on the account page itself. The other three earn the
            // right to replace a guess; this one does not. Stated rather than
            // left looking like an oversight, which is how the last one of
            // these got missed.
            const alreadyHave = isAccountUrl && !!(artist as Record<string, unknown>)[profileMatch!.siteName];
            if (alreadyHave) {
                console.log(`[vaultWebSearch] Already have ${profileMatch!.siteName}; not replacing it with ${result.url.slice(0, 60)}`);
            }
            // THE SAME IDENTITY CHECKS EVERY OTHER PATH APPLIES. This branch
            // wrote on "the judge says this page is about the artist" plus a
            // platform we lack, then `continue`d — skipping the ambiguity and
            // collision checks entirely. For a shared name that is not enough:
            // a page genuinely about a DIFFERENT Black Dave is genuinely about
            // an artist called Black Dave, and the judge is right to affirm it.
            const accountBlocked = isAccountUrl && !alreadyHave && (
                await nameIsAmbiguousInDirectory(artistId, artistName)
                || await handleBelongsToAnotherArtist(artistId, profileMatch!.siteName, profileMatch!.id)
                || await contradictsScrapedPosts(artistId, profileMatch!.siteName, profileMatch!.id)
            );
            if (accountBlocked) {
                console.log(`[vaultWebSearch] Not adopting ${profileMatch!.siteName}=${profileMatch!.id} — identity checks did not clear it`);
            }
            if (isAccountUrl && !alreadyHave && !accountBlocked && relevance.get(result.url) === "about-artist") {
                try {
                    await writeArtistLink(artistId, profileMatch!.siteName, profileMatch!.id, provisional, artist as unknown as Record<string, unknown>);
                    console.log(`[vaultWebSearch] ${profileMatch!.siteName} profile -> links: ${result.url.slice(0, 80)}`);
                } catch (e) {
                    console.warn(`[vaultWebSearch] Could not save discovered ${profileMatch!.siteName} profile:`, e);
                }
                skipped++;
                continue;
            }

            // Held for a pass AFTER the loop. Adopting inline meant deciding
            // whose page this is before the run had finished learning who the
            // artist is: Sherwinn Brice's site corroborates through his
            // Bandcamp, and his Bandcamp was itself only adopted LATER in the
            // same loop, from a different page. Starting from the spotify and
            // deezer ids an artist actually arrives with, the corroborator
            // showed up minutes after the page that needed it, and nothing was
            // adopted at all.
            // An INDEX page is excluded from this outright. Corroboration proves
            // a page is CONNECTED to the artist, not that it is about them
            // alone — and a label roster linking this artist's real Spotify
            // beside a labelmate's Instagram would corroborate and then adopt
            // the labelmate. `lists-artist` is precisely that page, so the
            // judge's verdict is worth honouring here even though adoption is
            // otherwise independent of it.
            if ((page.outboundLinks?.length ?? 0) > 0 && relevance.get(result.url) !== "lists-artist") {
                hubCandidates.push({
                    links: page.outboundLinks!,
                    url: result.url,
                    aboutArtist: relevance.get(result.url) === "about-artist",
                });
            }

            // An account page is IDENTITY, never coverage — so it is not a vault
            // source whatever the judge concluded. These platforms serve a bot
            // nothing, so they are unreadable, so the judge returns `undecided`,
            // and they were being stored as "sources" with zero body text. Pete,
            // on seeing exactly that: "it put my X and my instagram in the vault
            // instead of my links? makes zero sense."
            //
            // Dropped rather than linked when unconfirmed. Adding a link on a URL
            // pattern alone is the mistake that put a film soundtrack's Wikipedia
            // page on a real artist's profile; DECLINING to file something as
            // press carries no such risk. Profile discovery owns finding these
            // properly — it can probe and verify, which this path cannot.
            if (profileMatch?.siteName && ACCOUNT_PLATFORMS.has(profileMatch.siteName)) {
                // Not a source — but not nothing either. Searching an artist's
                // NAME and getting back an account page is real evidence about
                // whose account it is, and until now we discarded it: the log
                // said "leaving to profile discovery" while profile discovery,
                // a separate step working only from the name, never received it.
                //
                // Pete Rango's own instagram, x and soundcloud were all returned
                // by his search and all three were thrown away on the same run
                // that scored him 0 of 7 known handles. Verified after the loop.
                if (profileMatch.id && !isReservedHandle(profileMatch.siteName, String(profileMatch.id))) {
                    // Title AND description, captured from the fetch we already
                    // did. The description is where the distinguishing part of a
                    // name actually lives: Black Dave MK2's instagram is titled
                    // "Black Dave! (@blackdave.xyz)" and never says MK2, while
                    // its bio reads "Making music as @blackdave.mk2". Google
                    // indexes the bio, which is why a plain search finds him and
                    // we did not.
                    accountCandidates.push({
                        siteName: profileMatch.siteName,
                        id: String(profileMatch.id),
                        url: result.url,
                        title: page.title ?? "",
                        description: page.snippet ?? "",
                    });
                }
                skipped++;
                continue;
            }

            // A page the judge says is about someone else is dropped outright,
            // not stored as a lead: we READ it and it isn't them. Leads exist for
            // pages we could not read, not for pages we read and rejected.
            if (relevance.get(result.url) === "not-about-artist") {
                console.log(`[vaultWebSearch] Judge: not about "${artistName}" — ${result.url.slice(0, 100)}`);
                dropped++;
                continue;
            }
            // An index page: real, genuinely concerns the artist, and useless as a
            // source. A marketplace directory titled "Producers who worked with
            // <artist>" reached a real artist's vault and named him in 2 of its 173
            // paragraphs; the other 171 were a genre filter and OTHER producers'
            // credits. Those names are worse than noise — on a page indexed under
            // his name they read as his collaborators when they are his
            // competitors. Dropped like any other non-source, but logged
            // separately: this is the category the judge had no word for, so it
            // passed such pages as "about-artist" for months.
            if (relevance.get(result.url) === "lists-artist") {
                console.log(`[vaultWebSearch] Judge: index/directory page, not coverage — ${result.url.slice(0, 100)}`);
                // But an index is a table of contents, not a dead end. Pete:
                // "rvamag was a good article, it's just that it was presenting
                // an index and the article as separate links." Its tag page
                // leads to a 2026 piece naming him as a documentary's
                // co-director — the most current coverage of him anywhere, lost
                // both by storing the index and by discarding it.
                for (const link of page.links ?? []) indexLinks.add(link);
                dropped++;
                continue;
            }
            // Some feeds are served from ordinary-looking URLs. If what came back
            // is a document rather than a page, it is not a source either.
            const body = (page.fullText ?? page.extractedText ?? "").trimStart();
            if (body.startsWith("<?xml") || body.startsWith("<rss")) {
                console.log(`[vaultWebSearch] Skipping XML document: ${result.url.slice(0, 100)}`);
                dropped++;
                continue;
            }
            const verdict = classifyFetchedSource(page, artistName, {
                requireFullName: !isArtistOwnDomain(result.url, artistName),
                // The judge READ the page and affirmed it. That outranks any
                // string match — which is what kept genuine press written under
                // an artist's earlier name ("Black Dave" vs "Black Dave MK2")
                // from ever becoming citable.
                identityConfirmed: relevance.get(result.url) === "about-artist",
            });
            // AN UNREADABLE PAGE IS ONLY AS GOOD AS ITS TITLE.
            //
            // A 403, a 5xx or a JS-only page classifies as "lead": real URL,
            // unread body, filed as a non-citable source. That is right when the
            // page is plausibly about the artist and wrong when it is plainly
            // not — blogcritics.org answers our fetch with 403, so the only
            // evidence we ever had about "Music Review: Pete Seeger - Pete
            // Seeger At 89" was that title, which names a different musician.
            // We filed it against Pete Rango anyway and made him look at it.
            //
            // So when the body is unreadable, the SEARCH TITLE has to name the
            // artist in full. The distinctive-token fallback is not allowed
            // here: it exists for pages we already believe are theirs, and this
            // is the opposite case. A page we cannot read, whose title is about
            // somebody else, is not a lead. It is a search result.
            // Only when we genuinely could not READ it. A readable page that
            // simply does not name the artist is a different case and keeps its
            // existing treatment; this is about pages where the search title is
            // the only evidence that will ever exist.
            const unreadable = verdict === "lead"
                && (!page.extractedText || page.extractedText.trim().length < 200);
            if (unreadable) {
                const evidence = `${result.title ?? ""} ${result.snippet ?? ""}`;
                if (!nameAppearsIn(evidence, artistName, { requireFullName: true })) {
                    console.log(`[vaultWebSearch] Unreadable and its title is not about "${artistName}", dropping: ${String(result.title ?? result.url).slice(0, 70)}`);
                    dropped++;
                    continue;
                }
            }

            if (verdict === "dead") {
                console.warn(`[vaultWebSearch] Dropping unreachable/irrelevant URL (status ${page.status}): ${result.url.slice(0, 120)}`);
                dropped++;
                continue;
            }

            const isVerified = verdict === "verified";
            try {
                if (outOfBudget("source insertion")) break;
                const source = await insertVaultSource({
                    artistId,
                    url: result.url,
                    // Prefer what the PAGE says it is over what the model said it is —
                    // the page is the authority on its own title and description.
                    title: (isVerified ? page.title : null) ?? result.title,
                    // For a verified source the snippet is the page's own meta
                    // description. For a lead we could not read, we keep the model's
                    // description ONLY so the artist has something to recognize the link
                    // by while curating — it is never fed to synthesis and the UI labels
                    // it unverified, because it is a guess about the page, not the page.
                    snippet: (isVerified ? page.snippet : undefined) ?? result.snippet ?? "",
                    type: normalizeSourceType(result.type ?? "article"),
                    status: "pending",
                    // The verification record itself: extractedText is populated if and
                    // only if we actually read the page and it was about this artist.
                    // `isCitableSource` reads exactly this, so no column or backfill is
                    // needed to make already-stored rows behave correctly.
                    extractedText: isVerified ? page.extractedText : null,
                    ogImage: page.ogImage ?? null,
                    // What the page says about its own age. Without it every claim
                    // in the document reads as current — a 2019 interview saying
                    // "X is my production partner" became a present-tense fact
                    // about a real artist seven years later.
                    publishedAt: page.publishedAt ?? null,
                });
                if (source) insertedSources.push(source);
            } catch (e) {
                console.error("[vaultWebSearch] Failed to insert source:", result.url, e);
            }
        }

        // Verify the account pages search handed us. These platforms serve a bot
        // no readable body, so the relevance judge can never affirm them — but
        // their og:title names the account holder, and that IS checkable:
        // instagram.com/p3t3rango returns "Pete Rango (@p3t3rango) • Instagram
        // photos and videos". Same cross-check profile discovery uses on a
        // handle it guessed; the difference is that this handle was not guessed,
        // it was returned by a search for the artist's name.
        if (accountCandidates.length > 0) try {
            // A title cross-check identifies an artist only if the name does.
            const ambiguous = await nameIsAmbiguousInDirectory(artistId, artistName);
            if (ambiguous) {
                console.log(`[vaultWebSearch] Another artist's name here begins with "${artistName}" — nothing a page says can tell them apart, skipping ${accountCandidates.length} account candidate(s)`);
            }
            if (ambiguous) throw new SkipAccountPass();
            const current = await getArtistById(artistId).catch(() => undefined);
            const { fetchLinkPreview } = await import("@/server/utils/linkPreview");
            const { titleMatchesArtist } = await import("@/server/utils/profileDiscovery");
            // Order matters now that a bare-name query is in the mix: it returns
            // more, including near-misses. Pharaoh Sistare's search surfaces both
            // instagram/pharaohsistare and instagram/pherosistar, and whichever
            // was checked first won — which handed her the wrong one and then
            // blocked the right one under "already have it".
            //
            // A handle that IS the artist's name, folded, is the strongest claim
            // available and goes first. Everything else keeps its original order.
            const foldedName = artistName.toLowerCase().replace(/[^a-z0-9]/g, "");
            const ranked = [...accountCandidates].sort((a, b) => {
                const score = (c: { id: string }) => c.id.toLowerCase().replace(/[^a-z0-9]/g, "") === foldedName ? 0 : 1;
                return score(a) - score(b);
            });

            const done = new Set<string>();
            for (const cand of ranked.slice(0, MAX_ACCOUNT_CHECKS)) {
                if (done.has(cand.siteName)) continue;
                if (current && holdsAnswerFor(current as Record<string, unknown>, cand.siteName, provisional)) continue;
                // A title cannot tell three artists of the same name apart. Our
                // own directory holds Black Dave, Black Dave MK2 and Black Dave
                // NYC; instagram.com/blackdave is NYC's, and its title says
                // "Black Dave", so the check below passes and we would hand one
                // artist another's account. If the directory already assigns
                // this handle to somebody else, it is not evidence about this
                // artist — leave it alone.
                if (await handleBelongsToAnotherArtist(artistId, cand.siteName, cand.id)) {
                    console.log(`[vaultWebSearch] ${cand.siteName}=${cand.id} is already another artist's, ignoring`);
                    continue;
                }
                if (await contradictsScrapedPosts(artistId, cand.siteName, cand.id)) {
                    console.log(`[vaultWebSearch] ${cand.siteName}=${cand.id} contradicts the handle their own posts are authored by, ignoring`);
                    continue;
                }
                // The page we already read, falling back to a preview for one we
                // could not.
                let title = cand.title;
                if (!title && !cand.description) {
                    const preview = await fetchLinkPreview(stripQuery(cand.url)).catch(() => null);
                    title = preview?.title ?? "";
                }
                const identity = `${title} ${cand.description}`.trim();
                if (!identity) continue;

                // A profile page's TITLE is the account holder's own name:
                // "Pete Rango (@p3t3rango) • Instagram photos". That is the
                // strong signal and it stands alone — it has to, because a real
                // handle often looks nothing like the name (`p3t3rango` shares
                // one character with "Pete Rango", `dupesdidit` shares none with
                // "Sherwinn Dupes Brice").
                //
                // A DESCRIPTION naming the artist is far weaker: Insomniac is an
                // EDM promoter whose YouTube bio lists everyone it books,
                // Hardwell included, and that alone gave him youtube=insomniac.
                // So a description-only match additionally needs the handle to
                // resemble the name — which is exactly Black Dave MK2's case,
                // where the title says "Black Dave!" and only the bio says
                // "blackdave.mk2", and `blackdave.xyz` shares nine characters
                // with `blackdavemk2` while `insomniac` shares none with
                // `hardwell`.
                if (!titleMatchesArtist(title, artistName)) {
                    if (!titleMatchesArtist(identity, artistName)) {
                        console.log(`[vaultWebSearch] Account page did not name "${artistName}", ignoring: ${cand.url.slice(0, 70)}`);
                        continue;
                    }
                    if (sharedPrefix(cand.id, artistName) < HANDLE_STEM_MIN) {
                        console.log(`[vaultWebSearch] Only ${cand.siteName}=${cand.id}'s bio mentions "${artistName}" and the handle is unlike it, ignoring`);
                        continue;
                    }
                }
                try {
                    await writeArtistLink(artistId, cand.siteName, cand.id, provisional, current as unknown as Record<string, unknown> | undefined);
                    console.log(`[vaultWebSearch] Search found ${cand.siteName}=${cand.id}, page confirms it: "${identity.slice(0, 60)}"`);
                    done.add(cand.siteName);
                    verifiedHandles.add(normalizeHandle(cand.id));
                } catch (e) {
                    console.warn(`[vaultWebSearch] Could not save ${cand.siteName} from search:`, e);
                }
            }
        } catch (e) {
            // Everything found so far stands. This pass is an enrichment, and an
            // exception here previously reached the function's outer catch and
            // returned [] — telling the caller a successful run found nothing.
            if (!(e instanceof SkipAccountPass)) {
                console.error("[vaultWebSearch] Account verification pass failed:", e);
            }
        }

        // Now that the run has finished learning what it can about this artist,
        // work out which of the pages we read are theirs. Re-read the record
        // first: links adopted during the loop (a Bandcamp routed out of an
        // about-artist page, say) are exactly the corroborators the earlier
        // pages needed, and the snapshot taken before the loop cannot see them.
        if (hubCandidates.length > 0) {
            // getArtistById rethrows on a DB error, and this block sits inside
            // the function's one try/catch, which returns []. A transient hiccup
            // here would therefore discard `insertedSources` — every source we
            // just persisted would still be in the database, but every caller
            // keying off the return value would be told the run found nothing.
            // Same discipline propagateVerifiedHandles already applies to itself.
            const current = await getArtistById(artistId).catch(e => {
                console.error("[vaultWebSearch] Could not re-read artist for hub adoption:", e);
                return undefined;
            });
            if (current) {
                const seen = new Set<string>();
                for (const hub of hubCandidates.slice(0, MAX_HUB_PAGES)) {
                    const outbound = hub.links;
                    // Keyed on the WHOLE link set. Keying on the first few
                    // collided across pages from one site template, whose
                    // header links are identical and whose later links — the
                    // ones that would actually corroborate — are not.
                    // Sorted: the same link set fetched in a different order is
                    // the same page as far as corroboration is concerned.
                    const key = [...outbound].sort().join("|");
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (outOfBudget("hub adoption")) break;
                    const { adopted, handles } = await adoptHandlesFromOwnPage(
                        artistId, outbound, current as unknown as Record<string, unknown>, artistName,
                        { url: hub.url, aboutArtist: hub.aboutArtist }, provisional);
                    for (const h of handles) verifiedHandles.add(h);
                    // One adoption can corroborate the next page, so refresh.
                    // Falls back to what we already hold rather than throwing:
                    // a stale record costs us one missed adoption, an exception
                    // costs the caller the whole run's results.
                    if (adopted > 0) {
                        Object.assign(current, await getArtistById(artistId).catch(() => undefined) ?? {});
                    }
                }
            }
        }

        // ONCE for the run, over every handle either path proved — see the note
        // in adoptHandlesFromOwnPage about the 35s discovery budget. Pete Rango
        // reaches this with p3t3rango and peterango confirmed by page titles and
        // nothing found on a hub at all, which is why it cannot live inside the
        // hub branch.
        if (fromMusicBrainz.authoritative) {
            console.log(`[vaultWebSearch] MusicBrainz identified "${artistName}" outright — not guessing at the platforms it did not name`);
        } else if (verifiedHandles.size > 0) {
            const latest = await getArtistById(artistId).catch(() => undefined);
            if (latest) {
                await propagateVerifiedHandles(artistId, verifiedHandles, latest as unknown as Record<string, unknown>, artistName, deadline, provisional);
            }
        }

        // Follow the indexes. Bounded hard: this runs inside discovery's latency
        // budget, and an index page can link to hundreds of articles. Three is
        // enough for a tag archive of one artist's own coverage, which is the
        // case this exists for — a directory of OTHER people yields links the
        // judge then rejects, costing three fetches and nothing else.
        const toFollow = [...indexLinks].filter(u => !existingUrls.has(stripQuery(u))).slice(0, MAX_INDEX_FOLLOWS);
        if (toFollow.length > 0) {
            console.log(`[vaultWebSearch] Following ${toFollow.length} link(s) out of index page(s)`);
            const followed = await Promise.all(toFollow.map(async url => {
                try { return { url, page: await fetchPageContent(url, { timeoutMs: VERIFY_TIMEOUT_MS }) }; }
                catch { return null; }
            }));
            const readable = followed.filter((f): f is { url: string; page: PageContent } =>
                !!f && (f.page.fullText?.length ?? 0) > 0);
            if (readable.length > 0) {
                // Judged exactly like any other candidate — being reached via the
                // artist's own tag page is a lead, never a verdict.
                const followVerdicts = await judgeSourceRelevance(
                    { name: artistName, catalog: [...catalog.topTracks, ...catalog.releases], identifiers },
                    readable.map(({ url, page }) => ({
                        url, title: page.title, text: page.fullText ?? page.extractedText,
                        ownDomain: isArtistOwnDomain(url, artistName),
                    })),
                );
                for (const { url, page } of readable) {
                    // Reached from an index rather than from search, so it never
                    // passed the intake filter.
                    if (isBlockedSourceHost(url)) {
                        console.log(`[vaultWebSearch] Blocked host, not a source: ${url.slice(0, 100)}`);
                        continue;
                    }
                    if (followVerdicts.get(url) !== "about-artist") {
                        console.log(`[vaultWebSearch] Followed link is not about "${artistName}" — ${url.slice(0, 90)}`);
                        continue;
                    }
                    try {
                        const source = await insertVaultSource({
                            artistId,
                            url,
                            title: page.title,
                            snippet: page.snippet ?? "",
                            type: normalizeSourceType("article"),
                            status: "pending",
                            extractedText: page.extractedText,
                            ogImage: page.ogImage ?? null,
                            publishedAt: page.publishedAt ?? null,
                        });
                        if (source) {
                            insertedSources.push(source);
                            console.log(`[vaultWebSearch] Recovered from index: ${page.title?.slice(0, 70)}`);
                        }
                    } catch (e) {
                        console.error("[vaultWebSearch] Failed to insert followed source:", url, e);
                    }
                }
            }
        }

        if (skipped > 0) {
            console.log(`[vaultWebSearch] Skipped ${skipped} duplicate(s) for "${artistName}"${rejectedSkips > 0 ? `, ${rejectedSkips} previously rejected by the artist` : ""}`);
        }
        if (dropped > 0) {
            console.log(`[vaultWebSearch] Dropped ${dropped} unverifiable candidate(s) for "${artistName}"`);
        }

        console.log(`[vaultWebSearch] Inserted ${insertedSources.length} sources for "${artistName}"`);
        return insertedSources;
    } catch (error: unknown) {
        const err = error as { status?: number; message?: string; code?: string };
        console.error("[vaultWebSearch] Error searching for artist:", {
            message: err.message,
            status: err.status,
            code: err.code,
            full: error,
        });
        return [];
    }
}
