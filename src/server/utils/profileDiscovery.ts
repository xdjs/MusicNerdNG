/**
 * Post-claim onboarding — discovers an artist's MISSING platform profiles
 * from whatever identity anchors they already have (a bare Deezer/Spotify
 * ID, existing social links) and proposes them for the artist to confirm.
 *
 * NEVER throws — any failure (Gemini down, bad JSON, network) degrades to
 * an empty result so a discovery failure can never break the onboarding
 * `profiles` turn (the step behaves exactly as it does without discovery).
 *
 * A grounded model will confidently invent URLs, so every candidate is
 * validated before it's ever shown to an artist — see the numbered gates in
 * `discoverInner` below. Nothing here writes to the database; discovery only
 * PROPOSES, the existing `confirm_profiles` → `extractArtistId` →
 * `setArtistLink` path (unchanged) is what actually saves an accepted link.
 */
import { getArtistById, getAllLinks } from "@/server/utils/queries/artistQueries";
import { extractArtistId } from "@/server/utils/services";
import { fetchLinkPreview } from "@/server/utils/linkPreview";
import { musicPlatformData } from "@/server/utils/musicPlatform";
import type { MusicPlatformArtist } from "@/server/utils/musicPlatform";
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import {
    PROFILE_DISPLAY_COLUMNS,
    artistHasRawLinkValue,
    buildLinkPresentationMeta,
    fallbackDisplayName,
    type UrlmapPresentationRow,
} from "@/server/utils/linkPresentation";

export interface DiscoveredProfile {
    siteName: string;
    displayName: string;
    value: string;
    profileUrl: string;
    logoUrl: string | null;
    colorHex: string | null;
    previewImage: string | null;
    reasoning: string | null;
}

// --- Budgets -------------------------------------------------------------
// The whole function must stay well inside the onboarding route's 55s
// in-handler deadline (60s maxDuration) — discovery is one piece of a turn
// that also runs buildProfilesPayload (urlmap lookups + its own ~5s preview
// budget) and the SSE plumbing around it, so DISCOVERY_BUDGET_MS is set with
// a wide margin below 55s, not right up against it.
//
// LIVE measurements against this exact prompt shape (Google Search grounded,
// real artist, real Gemini calls — see docs in the discovery report) found
// grounded multi-platform search is genuinely slow: an untimed raw call
// asking about all 9 non-Deezer curated platforms took ~49s and returned one
// CORRECT, verifiable candidate (confirmed for real by hand afterwards) —
// this is not a hallucination-only regime, it is a genuinely slow one.
// vaultWebSearch's own comment documents 12-33s for its lighter, single-topic
// "find articles" search, for comparison. Two levers reduce the grounded
// work per call (MAX_PLATFORMS_PER_SEARCH, a real per-call timeout informed
// by measurement rather than a guess) but even at 6 platforms and a 24s
// per-call timeout, the bounded run for the same obscure/ambiguously-named
// test artist still timed out and returned zero candidates. That is the
// deliberate, accepted trade-off: turn-budget safety wins over recall for
// artists needing a slow grounded search — see the discovery report for the
// full trade-off discussion. Discovery ends up best-effort by construction,
// which is exactly what "never throw, empty array on any failure" already
// requires it to tolerate.
const DISCOVERY_BUDGET_MS = 30_000;
const GEMINI_CALL_TIMEOUT_MS = 24_000;
const PREVIEW_BUDGET_MS = 5_000;
// Only search the highest-priority missing platforms (PROFILE_DISPLAY_COLUMNS
// order — spotify/instagram/tiktok/x/youtube before the more niche
// soundcloud/bandcamp/twitch/facebook) rather than every missing one at once.
const MAX_PLATFORMS_PER_SEARCH = 6;
// Only attempt a second Gemini call if the FIRST one failed fast — mirrors
// the `PUBLISH_RETRY_BUDGET_MS` time-gated-retry pattern in turnHandlers.ts,
// adapted to this module's numbers: a genuinely slow-but-real first attempt
// (the measured common case, up to GEMINI_CALL_TIMEOUT_MS) has already spent
// most of DISCOVERY_BUDGET_MS and must NOT get a second, near-certainly-
// truncated attempt stacked on top. A FAST failure (network/auth error,
// malformed JSON — returned before any real grounded search work started)
// still gets one retry; the outer DISCOVERY_BUDGET_MS race in
// discoverArtistProfiles remains the hard backstop either way, so a retry
// that does run long still can't blow the turn budget — it just degrades to [].
const RETRY_CUTOFF_MS = 3_000;
const MAX_ATTEMPTS = 2;
const MAX_RAW_CANDIDATES = 10;

// Platforms whose og:image scrape reliably resolves for a real profile
// (verified against the live sites — see linkPreview.ts). A miss here is a
// signal the URL may not exist / be a fabrication. X and platforms with no
// column at all (e.g. Apple Music) are NOT in this set — their absence of
// OG data is normal, so a miss there must not penalize the candidate.
const OG_RELIABLE_SITENAMES = new Set(["spotify", "instagram", "youtube"]);

interface RawCandidate {
    url: string;
    reasoning: string | null;
}

function buildIdentityContext(record: Record<string, unknown>, enrichment: MusicPlatformArtist | null): string {
    const parts: string[] = [];
    if (enrichment) {
        const followerPart = enrichment.followerCount != null ? `, ${enrichment.followerCount} fans/followers` : "";
        parts.push(`Verified via ${enrichment.platform}: "${enrichment.name}"${followerPart}`);
        if (enrichment.topTrackName) parts.push(`Known track: "${enrichment.topTrackName}"`);
        if (enrichment.genres.length > 0) parts.push(`Genres: ${enrichment.genres.join(", ")}`);
    }
    for (const col of PROFILE_DISPLAY_COLUMNS) {
        const value = record[col];
        if (typeof value === "string" && value) parts.push(`${col}: ${value}`);
    }
    return parts.length > 0 ? `\n\nWhat we already know about this artist:\n${parts.join("\n")}` : "";
}

function buildDiscoveryPrompt(artistName: string, identityContext: string, missingDisplayNames: string[]): string {
    const platformList = missingDisplayNames.map(n => `- ${n}`).join("\n");
    return `You are researching the real-world music artist "${artistName}" to find their official profile pages on specific platforms.${identityContext}

Search the web and find "${artistName}"'s OFFICIAL profile on EACH of these platforms, if it exists:
${platformList}

Rules:
- Only return a profile if you are genuinely confident it belongs to THIS specific artist — not a different person, band, or account that happens to share the name. If there is any real ambiguity (e.g. a common name shared by multiple unrelated people), leave that platform out entirely.
- Never invent or guess a plausible-looking URL. Only return a URL you actually found via search.
- One result per platform: the artist's own official/verified account, not a fan page, not a press article, not a search results page.
- If you cannot confidently find a profile for a platform, simply omit it from the results — do not include a low-confidence guess.

Return ONLY a JSON array, no other text, no markdown fences, in this exact format:
[{"platform": "<platform name from the list above>", "url": "<the profile URL>", "reasoning": "<one short sentence on why you believe this is the right ${artistName}>"}]

If you find no confident matches on any platform, return an empty array: []`;
}

/** One bounded, Google-Search-grounded Gemini call. Never throws — parse/
 *  network/timeout failures resolve to `null` (a FAILED attempt, distinct
 *  from a successfully parsed but genuinely empty `[]`, so the caller's
 *  retry loop doesn't waste its one retry re-asking after a clean "no
 *  confident matches" answer). Follows the call shape + tolerant-JSON-
 *  extraction convention of `vaultWebSearch.searchAndPopulateVault`, but
 *  capped at a single attempt per call (the retry loop lives in the caller,
 *  time-gated). */
async function callGeminiOnce(prompt: string): Promise<RawCandidate[] | null> {
    try {
        const response = await Promise.race([
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: prompt,
                config: {
                    systemInstruction: "You are a precise, conservative music research assistant identifying an artist's official profile links across platforms. Only return profiles you are confident belong to the specified artist — never a different person or band with a similar name, and never a fabricated or guessed URL.",
                    tools: [{ googleSearch: {} }],
                },
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("profile discovery timeout")), GEMINI_CALL_TIMEOUT_MS)),
        ]);
        const text = response.text ?? "";
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed)) return null;
        return parsed
            .filter((item): item is { url: string; reasoning?: unknown } => item && typeof item.url === "string" && item.url.length > 0)
            .slice(0, MAX_RAW_CANDIDATES)
            .map(item => ({ url: item.url, reasoning: typeof item.reasoning === "string" ? item.reasoning : null }));
    } catch (e) {
        console.error("[profileDiscovery] Gemini call failed:", e);
        return null;
    }
}

/** Fetch link previews for every {siteName, url} pair in parallel, bounded
 *  by PREVIEW_BUDGET_MS overall. Never throws; a miss/timeout is simply
 *  absent from the map (callers treat that as `null`). Same shape as
 *  `gatherProfilePreviews` in turnHandlers.ts, kept local here so this
 *  module has no dependency on the onboarding step engine. */
async function gatherPreviews(entries: [siteName: string, url: string][]): Promise<Map<string, string | null>> {
    const settled = new Map<string, string | null>();
    if (entries.length === 0) return settled;
    const gathering = Promise.all(entries.map(async ([siteName, url]) => {
        const preview = await fetchLinkPreview(url);
        settled.set(siteName, preview.imageUrl);
    }));
    let timer: ReturnType<typeof setTimeout>;
    const budget = new Promise<void>(resolve => { timer = setTimeout(resolve, PREVIEW_BUDGET_MS); });
    try {
        await Promise.race([gathering, budget]);
    } finally {
        clearTimeout(timer!);
    }
    return settled;
}

async function discoverInner(artistId: string): Promise<DiscoveredProfile[]> {
    const startedAt = Date.now();
    const artist = await getArtistById(artistId);
    if (!artist) return [];
    const record = artist as unknown as Record<string, unknown>;

    // Nothing to search for — the artist already has every platform we'd propose.
    const missingPlatforms = PROFILE_DISPLAY_COLUMNS.filter(col => !artistHasRawLinkValue(record, col));
    if (missingPlatforms.length === 0) return [];

    // A bare platform ID (e.g. only `deezer` set) is useless as a search
    // anchor on its own — resolve the real name/image/fan count first so
    // there's something to actually search for.
    const enrichment = await musicPlatformData.getArtist(artist).catch(() => null);
    const artistName = enrichment?.name?.trim() || artist.name?.trim() || null;
    if (!artistName) return [];

    let allLinks: Awaited<ReturnType<typeof getAllLinks>> = [];
    try {
        allLinks = await getAllLinks();
    } catch (e) {
        console.error("[profileDiscovery] getAllLinks failed, presentation metadata will degrade:", e);
    }
    const urlmapBySiteName = new Map<string, UrlmapPresentationRow>(allLinks.map(l => [l.siteName, l]));

    // Cap the ASK (not the accept-set) to the highest-priority missing
    // platforms — see MAX_PLATFORMS_PER_SEARCH above. An artist missing more
    // than this many just gets the top ones searched this turn; re-opening
    // the profiles step (or a future turn) tries again.
    const searchPlatforms = missingPlatforms.slice(0, MAX_PLATFORMS_PER_SEARCH);
    const missingDisplayNames = searchPlatforms.map(col => urlmapBySiteName.get(col)?.cardPlatformName || fallbackDisplayName(col));
    const identityContext = buildIdentityContext(record, enrichment);
    const prompt = buildDiscoveryPrompt(artistName, identityContext, missingDisplayNames);

    // `null` = a failed attempt (network/timeout/unparseable) — retry, time
    // permitting. A successfully parsed `[]` is a clean "no confident
    // matches" answer and must NOT burn the retry re-asking the same thing.
    let raw: RawCandidate[] | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1 && Date.now() - startedAt > RETRY_CUTOFF_MS) break;
        raw = await callGeminiOnce(prompt);
        if (raw !== null) break;
    }
    if (!raw || raw.length === 0) {
        console.log(`[profileDiscovery] artist=${artistId} name="${artistName}" — Gemini returned no candidates`);
        return [];
    }

    // --- Validation gates -------------------------------------------------
    // (a) extractArtistId resolves the URL to a real {siteName, id}, and
    // (b) that siteName is one MusicNerd can actually write (the curated,
    //     writable-by-construction PROFILE_DISPLAY_COLUMNS set) — otherwise
    //     an accepted candidate would round-trip into a confusing
    //     "already linked to another profile" write-rejection message.
    // (c) the artist doesn't already have a value for that column, and
    // (d) dedupe by siteName, keeping the first (highest-confidence) hit.
    type Survivor = { siteName: string; id: string; reasoning: string | null; originalUrl: string };
    const survivors: Survivor[] = [];
    const seen = new Set<string>();
    let unresolved = 0, unsupported = 0, alreadyHave = 0, duplicate = 0;
    for (const candidate of raw) {
        let extracted;
        try {
            extracted = await extractArtistId(candidate.url);
        } catch (e) {
            console.error(`[profileDiscovery] extractArtistId threw for ${candidate.url}:`, e);
            unresolved++;
            continue;
        }
        if (!extracted?.siteName || !extracted?.id) { unresolved++; continue; }
        const siteName = extracted.siteName;
        if (!(PROFILE_DISPLAY_COLUMNS as readonly string[]).includes(siteName)) { unsupported++; continue; }
        if (artistHasRawLinkValue(record, siteName)) { alreadyHave++; continue; }
        if (seen.has(siteName)) { duplicate++; continue; }
        seen.add(siteName);
        survivors.push({ siteName, id: extracted.id, reasoning: candidate.reasoning, originalUrl: candidate.url });
    }

    if (survivors.length === 0) {
        console.log(`[profileDiscovery] artist=${artistId} name="${artistName}" proposed=${raw.length} survivors=0 (unresolved=${unresolved} unsupported=${unsupported} alreadyHave=${alreadyHave} duplicate=${duplicate})`);
        return [];
    }

    // Build the canonical profile URL from urlmap (matches confirmed-link
    // presentation exactly), but verify it round-trips back through
    // extractArtistId to the SAME {siteName, id} before trusting it as the
    // URL the client will submit on accept — urlmap's appStringFormat isn't
    // guaranteed to be the inverse of every regex (YouTube's `@` handles,
    // SoundCloud's numeric-ID guard, Facebook's full-URL column). When it
    // doesn't round-trip, fall back to the original URL we already proved
    // extracts correctly (gate a) — used for submission; the urlmap
    // metadata is still used for display (logo/color/name).
    const enrichedSurvivors = await Promise.all(survivors.map(async s => {
        const row = urlmapBySiteName.get(s.siteName);
        const meta = buildLinkPresentationMeta(row, s.siteName, s.id);
        let profileUrl = meta.profileUrl || s.originalUrl;
        if (meta.profileUrl) {
            try {
                const roundTrip = await extractArtistId(meta.profileUrl);
                if (!roundTrip || roundTrip.siteName !== s.siteName || roundTrip.id !== s.id) {
                    profileUrl = s.originalUrl;
                }
            } catch {
                profileUrl = s.originalUrl;
            }
        }
        return { ...s, meta, profileUrl };
    }));

    // (e) Preview fetch — a miss on a platform that reliably serves OG data
    // is a signal the profile may not actually exist (a grounded model can
    // hallucinate a plausible-looking but dead URL). Platforms known not to
    // serve OG data (X, and anything outside OG_RELIABLE_SITENAMES) are not
    // penalized for a miss.
    const previewBySiteName = await gatherPreviews(enrichedSurvivors.map(e => [e.siteName, e.profileUrl]));

    let noOg = 0;
    const results: DiscoveredProfile[] = [];
    for (const s of enrichedSurvivors) {
        const previewImage = previewBySiteName.get(s.siteName) ?? null;
        if (!previewImage && OG_RELIABLE_SITENAMES.has(s.siteName)) { noOg++; continue; }
        results.push({
            siteName: s.siteName,
            displayName: s.meta.displayName,
            value: s.id,
            profileUrl: s.profileUrl,
            logoUrl: s.meta.logoUrl,
            colorHex: s.meta.colorHex,
            previewImage,
            reasoning: s.reasoning,
        });
    }

    console.log(
        `[profileDiscovery] artist=${artistId} name="${artistName}" proposed=${raw.length} survivors=${results.length} ` +
        `(unresolved=${unresolved} unsupported=${unsupported} alreadyHave=${alreadyHave} duplicate=${duplicate} noOg=${noOg}) ` +
        `proposedUrls=${JSON.stringify(raw.map(r => r.url))} keptSiteNames=${JSON.stringify(results.map(r => r.siteName))}`,
    );
    return results;
}

/** Discover platform profiles the artist likely has but hasn't linked yet,
 *  from whatever identity anchors are already on file. Bounded to
 *  ~`DISCOVERY_BUDGET_MS` end-to-end and NEVER throws — any failure (Gemini
 *  down, malformed JSON, network errors) resolves to `[]`, leaving the
 *  `profiles` onboarding step exactly as it behaves without discovery. */
export async function discoverArtistProfiles(artistId: string): Promise<DiscoveredProfile[]> {
    try {
        return await Promise.race([
            discoverInner(artistId),
            new Promise<DiscoveredProfile[]>(resolve => setTimeout(() => resolve([]), DISCOVERY_BUDGET_MS)),
        ]);
    } catch (e) {
        console.error(`[profileDiscovery] discoverArtistProfiles failed for ${artistId}:`, e);
        return [];
    }
}
