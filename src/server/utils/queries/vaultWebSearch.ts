import { insertVaultSource, getVaultSourcesByArtistId } from "./dashboardQueries";
import { getArtistById } from "./artistQueries";
import { SOURCE_TYPES, inferTypeFromUrl, type SourceType } from "@/lib/sourceTypes";
import { fetchPageContent, isUnsafeUrl } from "@/server/utils/fetchPageContent";
import { classifyFetchedSource, isGroundingRedirect } from "@/server/utils/sourceVerification";
import { webSearch } from "@/server/utils/webSearch";
import { judgeSourceRelevance } from "@/server/utils/sourceRelevance";
import { extractArtistId } from "@/server/utils/services";
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
const ACCOUNT_PLATFORMS = new Set([
    "instagram", "x", "tiktok", "youtube", "youtubechannel",
    "soundcloud", "bandcamp", "twitch", "facebook", "spotify", "deezer",
]);

const PROFILE_LINK_COLUMNS = [
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

function isKnownProfileUrl(url: string, artist: Record<string, unknown>): boolean {
    const haystack = url.toLowerCase();
    return PROFILE_LINK_COLUMNS.some(col => {
        const value = artist[col];
        if (typeof value !== "string") return false;
        const v = value.trim().toLowerCase().replace(/^@/, "");
        if (v.length < IDENTITY_MATCH_MIN_LENGTH) return false;
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
            if (relevance.get(result.url) === "about-artist") {
                const profileMatch = await extractArtistId(stripQuery(result.url)).catch(() => undefined);
                if (profileMatch?.siteName && profileMatch?.id && ACCOUNT_PLATFORMS.has(profileMatch.siteName)) {
                    try {
                        await setArtistLink(artistId, profileMatch.siteName, profileMatch.id);
                        console.log(`[vaultWebSearch] ${profileMatch.siteName} profile -> links: ${result.url.slice(0, 80)}`);
                    } catch (e) {
                        console.warn(`[vaultWebSearch] Could not save discovered ${profileMatch.siteName} profile:`, e);
                    }
                    skipped++;
                    continue;
                }
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
                });
                if (source) insertedSources.push(source);
            } catch (e) {
                console.error("[vaultWebSearch] Failed to insert source:", result.url, e);
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
