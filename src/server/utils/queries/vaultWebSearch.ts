import { insertVaultSource, getVaultSourcesByArtistId } from "./dashboardQueries";
import { getArtistById } from "./artistQueries";
import { SOURCE_TYPES, inferTypeFromUrl, type SourceType } from "@/lib/sourceTypes";
import { fetchPageContent, isUnsafeUrl, OUTBOUND_LINK_CAP, type PageContent } from "@/server/utils/fetchPageContent";
import { classifyFetchedSource, isGroundingRedirect } from "@/server/utils/sourceVerification";
import { webSearch } from "@/server/utils/webSearch";
import { judgeSourceRelevance } from "@/server/utils/sourceRelevance";
import { extractArtistId } from "@/server/utils/services";
import { isReservedHandle } from "@/lib/platformHandles";
import { setArtistLink } from "@/server/utils/artistLinkService";
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

/** Ceiling on hub pages examined for ownership. Every adoption costs another
 *  getArtistById round trip and every page costs up to MAX_CORROBORATION_CHECKS
 *  urlmap reads, and this is the one pass in this file with no explicit budget
 *  of its own — implicitly bounded only by the caller's outer race. An artist
 *  with more corroborating pages than this has already been identified several
 *  times over. */
const MAX_HUB_PAGES = 5;

/** Ceiling on the propagation pass — see propagateVerifiedHandles. */
const PROPAGATION_BUDGET_MS = 10_000;

/** One spelling of a handle. Stored values are inconsistently "@"-prefixed. */
function normalizeHandle(v: string): string {
    return v.trim().toLowerCase().replace(/^@/, "");
}

const ACCOUNT_PLATFORMS = new Set([
    "instagram", "x", "tiktok", "youtube", "youtubechannel",
    "soundcloud", "bandcamp", "twitch", "facebook", "spotify", "deezer",
]);

export const PROFILE_LINK_COLUMNS = [
    "spotify", "deezer", "instagram", "tiktok", "x", "youtube",
    "youtubechannel", "soundcloud", "bandcamp", "twitch", "facebook",
] as const;

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
function isArtistOwnDomain(url: string, artistName: string): boolean {
    const fold = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
    const name = fold(artistName);
    if (name.length < 5) return false; // too short to be distinctive in a domain
    try {
        return fold(new URL(url).hostname).includes(name);
    } catch {
        return false;
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
async function adoptHandlesFromOwnPage(
    artistId: string,
    outboundLinks: string[],
    artist: Record<string, unknown>,
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
    if (!corroborator) return { adopted: 0, handles: new Set<string>() };
    console.log(`[vaultWebSearch] Page corroborated by known ${corroborator.siteName}=${corroborator.id}`);

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

    let adopted = 0;
    const done = new Set<string>();
    const adoptedHandles = new Set<string>();
    for (const r of resolved) {
        if (!ACCOUNT_PLATFORMS.has(r.siteName)) continue;
        // instagram.com/p/<id> resolves to the "handle" p — one adoption away
        // from writing that onto an artist row.
        if (isReservedHandle(r.siteName, r.id)) continue;
        if (ambiguous.has(r.siteName)) continue;
        if (done.has(r.siteName)) continue;
        if (artist[r.siteName]) continue; // already have it
        try {
            await setArtistLink(artistId, r.siteName, r.id);
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
 * Carry a handle we just verified to the platforms we still have nothing for.
 *
 * Profile discovery's propagation tier already knows how to probe a handle
 * across platforms; what it never had was a handle worth propagating. Working
 * from the artist's NAME it produced `dupes` for Sherwinn Brice — wrong, his
 * handle is `dupesdidit` — and missed his SoundCloud entirely. Given the real
 * handle it finds soundcloud/dupesdidit on the next pass.
 *
 * Deliberately narrow: only a candidate whose value EXACTLY matches a handle the
 * artist published on their own corroborated page is taken. A candidate on some
 * other spelling is still a guess and still goes to the artist to confirm.
 */
async function propagateVerifiedHandles(
    artistId: string,
    verified: Set<string>,
    artist: Record<string, unknown>,
): Promise<number> {
    let adopted = 0;
    try {
        const { discoverArtistProfiles } = await import("@/server/utils/profileDiscovery");
        // Bounded well under discoverArtistProfiles' own 35s budget. This runs
        // at the TAIL of a pipeline the caller already races (38s in
        // artistBioQuery, 45s in turnHandlers) after search, fetch, judge and
        // hub adoption have each taken their share — so borrowing the full
        // budget here means the propagated writes land after the turn has
        // rendered and the artist sees an incomplete profile that silently
        // fixes itself later. Measured at 1.4s and 3.0s on a real artist, so
        // this is generous; giving up is the correct outcome, since everything
        // adopted from the artist's own page is already saved.
        let budgetTimer: ReturnType<typeof setTimeout> | undefined;
        const candidates = await Promise.race([
            discoverArtistProfiles(artistId),
            new Promise<never>((_, reject) => {
                budgetTimer = setTimeout(() => reject(new Error("propagation budget exhausted")), PROPAGATION_BUDGET_MS);
            }),
        // Cleared either way: left dangling, the timer holds the event loop open
        // for the full budget after the winner has already settled.
        ]).finally(() => clearTimeout(budgetTimer));
        for (const c of candidates) {
            const value = String(c.value ?? "");
            if (!verified.has(normalizeHandle(value))) continue;
            if (!ACCOUNT_PLATFORMS.has(c.siteName)) continue;
            if (isReservedHandle(c.siteName, value)) continue;
            // setArtistLink is an unconditional upsert, and until now nothing
            // here stopped it overwriting a value the artist already has —
            // safe only because discoverArtistProfiles happens to gate on the
            // same thing internally. That is a load-bearing assumption about
            // another module's internals; adoptHandlesFromOwnPage guards for
            // itself and so should this.
            if (artist[c.siteName]) continue;
            try {
                await setArtistLink(artistId, c.siteName, value);
                console.log(`[vaultWebSearch] Propagated verified handle -> ${c.siteName}=${value}`);
                adopted++;
            } catch (e) {
                console.warn(`[vaultWebSearch] Could not propagate ${c.siteName}:`, e);
            }
        }
    } catch (e) {
        // Never fail the vault step over this — the handles already adopted stand.
        console.error("[vaultWebSearch] Propagation pass failed:", e);
    }
    return adopted;
}

/**
 * URLs that are just a profile we ALREADY have linked.
 *
 * Discovery kept offering an artist their own Spotify and X pages as "sources
 * about you". They aren't research — they're identity we already hold, and
 * re-presenting them costs the artist a decision for nothing.
 *
 * Matched on the stored platform VALUE appearing in the URL, not on the host.
 * Host matching would be wrong: an artist with a YouTube channel would lose
 * every youtube.com result, including the Shockoe Sessions interview that is
 * the best source we found for one of them. A URL containing their actual
 * Spotify ID or handle is their profile; a video about them is not.
 */
const IDENTITY_MATCH_MIN_LENGTH = 4; // shorter values match far too much

/** Where each stored handle actually lives. A handle only identifies a profile
 *  on its OWN platform. */
const PLATFORM_DOMAINS: Record<string, string[]> = {
    spotify: ["spotify.com"],
    deezer: ["deezer.com"],
    instagram: ["instagram.com"],
    tiktok: ["tiktok.com"],
    x: ["x.com", "twitter.com"],
    youtube: ["youtube.com", "youtu.be"],
    youtubechannel: ["youtube.com"],
    soundcloud: ["soundcloud.com"],
    bandcamp: ["bandcamp.com"],
    twitch: ["twitch.tv"],
    facebook: ["facebook.com", "fb.com"],
};

function isKnownProfileUrl(url: string, artist: Record<string, unknown>): boolean {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return false;
    }
    const haystack = url.toLowerCase();
    return PROFILE_LINK_COLUMNS.some(col => {
        const value = artist[col];
        if (typeof value !== "string") return false;
        const v = value.trim().toLowerCase().replace(/^@/, "");
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
export async function searchAndPopulateVault(artistId: string): Promise<ArtistVaultSource[]> {
    const artist = await getArtistById(artistId);
    if (!artist) return [];

    const artistName = artist.name ?? "Unknown Artist";

    // Exact-phrase queries: an unquoted multi-word name matches each token
    // independently, which is how "Black Dave" returns Dave the UK rapper. The
    // three angles mirror the categories the vault actually wants.
    const queries = [
        `"${artistName}" music artist interview`,
        `"${artistName}" music review`,
        `"${artistName}" artist profile`,
    ];

    try {
        const perQuery = await Promise.all(
            queries.map(q => webSearch(q, { maxResults: TAVILY_RESULTS_PER_QUERY })),
        );

        // Dedupe across queries by URL; the three angles overlap heavily.
        const byUrl = new Map<string, WebSearchResult>();
        for (const hit of perQuery.flat()) {
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
        const identifiers = PROFILE_LINK_COLUMNS.flatMap(col => {
            const v = (artist as unknown as Record<string, unknown>)[col];
            return typeof v === "string" && v ? [`${col}: ${v}`] : [];
        });
        const relevance = await judgeSourceRelevance(
            { name: artistName, catalog: [...catalog.topTracks, ...catalog.releases], identifiers },
            verified.map(({ result, page }) => ({
                url: result.url,
                title: page.title ?? result.title,
                text: page.fullText ?? page.extractedText,
            })),
        );

        const insertedSources: ArtistVaultSource[] = [];
        /** Article URLs harvested from index pages, followed after the main pass. */
        const indexLinks = new Set<string>();
        /** Outbound links per page, examined for ownership once the loop is done. */
        const hubCandidates: string[][] = [];
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
                && ACCOUNT_PLATFORMS.has(profileMatch.siteName)
                // `instagram.com/p/DUtSSjnCYcU` is a POST, and the urlmap regex
                // reads its first path segment as the handle — so this arrives as
                // `{ instagram, id: "p" }`. Writing that would set the artist's
                // Instagram to "p". See isReservedHandle.
                && !isReservedHandle(profileMatch.siteName, profileMatch.id);

            if (isAccountUrl && relevance.get(result.url) === "about-artist") {
                try {
                    await setArtistLink(artistId, profileMatch!.siteName, profileMatch!.id);
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
                hubCandidates.push(page.outboundLinks!);
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
                console.log(`[vaultWebSearch] Account page, not coverage — leaving to profile discovery: ${result.url.slice(0, 90)}`);
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
            if (verdict === "dead") {
                console.warn(`[vaultWebSearch] Dropping unreachable/irrelevant URL (status ${page.status}): ${result.url.slice(0, 120)}`);
                dropped++;
                continue;
            }

            const isVerified = verdict === "verified";
            try {
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
                const verified = new Set<string>();
                for (const outbound of hubCandidates.slice(0, MAX_HUB_PAGES)) {
                    // Keyed on the WHOLE link set. Keying on the first few
                    // collided across pages from one site template, whose
                    // header links are identical and whose later links — the
                    // ones that would actually corroborate — are not.
                    // Sorted: the same link set fetched in a different order is
                    // the same page as far as corroboration is concerned.
                    const key = [...outbound].sort().join("|");
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const { adopted, handles } = await adoptHandlesFromOwnPage(
                        artistId, outbound, current as unknown as Record<string, unknown>);
                    for (const h of handles) verified.add(h);
                    // One adoption can corroborate the next page, so refresh.
                    // Falls back to what we already hold rather than throwing:
                    // a stale record costs us one missed adoption, an exception
                    // costs the caller the whole run's results.
                    if (adopted > 0) {
                        Object.assign(current, await getArtistById(artistId).catch(() => undefined) ?? {});
                    }
                }
                // ONCE for the run, not once per page — see the note in
                // adoptHandlesFromOwnPage about the 35s discovery budget.
                if (verified.size > 0) {
                    await propagateVerifiedHandles(artistId, verified, current as unknown as Record<string, unknown>);
                }
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
                    readable.map(({ url, page }) => ({ url, title: page.title, text: page.fullText ?? page.extractedText })),
                );
                for (const { url, page } of readable) {
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
