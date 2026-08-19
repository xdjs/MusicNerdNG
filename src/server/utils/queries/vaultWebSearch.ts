import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { insertVaultSource, getVaultSourcesByArtistId } from "./dashboardQueries";
import { getArtistById } from "./artistQueries";
import { SOURCE_TYPES, type SourceType } from "@/lib/sourceTypes";
import { fetchPageContent, isUnsafeUrl } from "@/server/utils/fetchPageContent";
import { classifyFetchedSource, isGroundingRedirect } from "@/server/utils/sourceVerification";
import type { ArtistVaultSource } from "@/server/db/DbTypes";

// External fetches (redirect resolution) fan out with plain Promise.all — the result set
// is capped at 8 (see the discovery prompt), so bounded concurrency (p-limit) isn't needed.

/** Per-URL read budget for the verification pass. Tight on purpose — see the
 *  comment at the pass itself. */
const VERIFY_TIMEOUT_MS = 5000;

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
 * Uses Gemini Flash with Google Search grounding to find articles/interviews/reviews
 * about an artist, then inserts them as pending vault sources.
 */
export async function searchAndPopulateVault(artistId: string): Promise<ArtistVaultSource[]> {
    const artist = await getArtistById(artistId);
    if (!artist) return [];

    const artistName = artist.name ?? "Unknown Artist";

    // Build identity context so Gemini knows exactly who this artist is
    const identityParts: string[] = [];
    if (artist.spotify) identityParts.push(`Spotify artist ID: ${artist.spotify}`);
    if (artist.instagram) identityParts.push(`Instagram: @${artist.instagram}`);
    if (artist.x) identityParts.push(`X/Twitter: @${artist.x}`);
    if (artist.youtube) identityParts.push(`YouTube: ${artist.youtube}`);
    if (artist.soundcloud) identityParts.push(`SoundCloud: ${artist.soundcloud}`);
    if (artist.bandcamp) identityParts.push(`Bandcamp: ${artist.bandcamp}`);

    const identityContext = identityParts.length > 0
        ? `\n\nThis artist's known profiles:\n${identityParts.join("\n")}`
        : "";

    const searchRequest = {
        model: GEMINI_MODEL_FLASH,
        contents: `Search the web for articles, interviews, reviews, profiles, and notable content specifically about the music artist "${artistName}".${identityContext}

IMPORTANT: Every result MUST be specifically about "${artistName}" the music artist. Do NOT include results about other people, bands, or websites that happen to share a similar name.

Search for:
- "${artistName}" music artist interview
- "${artistName}" music review
- "${artistName}" artist profile
- "${artistName}" new music

Find up to 8 high-quality results. For each result, provide:
- The exact URL (must be a real, working URL you found via web search)
- The article title
- A 1-2 sentence description of the content
- The type: "article", "interview", "review", "news", or "profile"

Return ONLY a JSON array in this format, no other text:
[{"url": "...", "title": "...", "snippet": "...", "type": "..."}]

If you cannot find any results specifically about this artist, return an empty array: []`,
        config: {
            systemInstruction: "You are a music research assistant. You search the web for articles, interviews, reviews, and content specifically about a given music artist. You must be precise — only return results that are directly about the specified artist, not about other artists or people with similar names.",
            tools: [{ googleSearch: {} }],
        },
    };

    try {
        // Gemini intermittently returns an EMPTY or unparseable grounded response
        // (transient — not artist-specific). Treating that as "no sources" wrongly
        // reduced even famous artists (e.g. Grimes) to nothing. Retry until we get a
        // parseable non-empty list; a genuinely sourceless artist exhausts attempts → [].
        const MAX_ATTEMPTS = 4;
        let results: WebSearchResult[] = [];
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            let outputText = "";
            try {
                const response = await getGemini().models.generateContent(searchRequest);
                outputText = response.text ?? "";
            } catch (e) {
                console.error(`[vaultWebSearch] Gemini call failed (attempt ${attempt}/${MAX_ATTEMPTS}):`, e);
            }
            const jsonMatch = outputText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (Array.isArray(parsed) && parsed.length > 0) { results = parsed; break; }
                } catch {
                    console.error(`[vaultWebSearch] Unparseable JSON (attempt ${attempt}/${MAX_ATTEMPTS}):`, jsonMatch[0].slice(0, 120));
                }
            }
            if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 700 * attempt));
        }

        if (results.length === 0) {
            console.log(`[vaultWebSearch] No usable results for "${artistName}" after ${MAX_ATTEMPTS} attempts`);
            return [];
        }

        // Only dedup against pending + approved sources (allow re-discovery of deleted/rejected URLs)
        const [pendingSources, approvedSources] = await Promise.all([
            getVaultSourcesByArtistId(artistId, "pending"),
            getVaultSourcesByArtistId(artistId, "approved"),
        ]);
        const existingSources = [...pendingSources, ...approvedSources];
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
        const candidates: WebSearchResult[] = [];
        let skipped = 0;
        for (const result of resolved) {
            // Reject non-http(s) schemes and private/local hosts. Gemini can return
            // (or be prompt-injected into returning) javascript:/data:/file: URLs that
            // would become stored XSS when rendered as <a href> on the public page.
            if (isUnsafeUrl(result.url)) {
                console.warn(`[vaultWebSearch] Skipping unsafe URL from Gemini: ${result.url.slice(0, 100)}`);
                continue;
            }
            const normalized = normalizeUrl(result.url);
            if (existingUrls.has(normalized)) {
                skipped++;
                continue;
            }
            // Add to set so subsequent results in the same batch don't duplicate
            existingUrls.add(normalized);
            candidates.push(result);
        }

        // VERIFICATION PASS — the point of this function's existence.
        //
        // Everything above this line is model output: Gemini was asked to TYPE urls,
        // titles and descriptions, and it produces plausible ones. Until a candidate is
        // fetched, we do not know that its URL exists, and we certainly do not know that
        // its description is true of the page. Storing that as a source is how an
        // invented URL and a model-written summary ended up cited in a published About.
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

        const insertedSources: ArtistVaultSource[] = [];
        let dropped = 0;
        for (const { result, page } of verified) {
            const verdict = classifyFetchedSource(page, artistName);
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
            console.log(`[vaultWebSearch] Skipped ${skipped} duplicate(s) for "${artistName}"`);
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
