/**
 * Post-claim onboarding — discovers an artist's MISSING platform profiles
 * from whatever identity anchors they already have (a bare Deezer/Spotify
 * ID, existing social links) and proposes them for the artist to confirm.
 *
 * NEVER throws — any failure (DB down, provider down, Gemini down, bad JSON,
 * network) degrades to an empty result so a discovery failure can never
 * break the onboarding `profiles` turn (the step behaves exactly as it does
 * without discovery).
 *
 * FINDING candidates is a three-tier cascade, run in authority + speed
 * order, each tier skipping platforms an earlier tier already proposed:
 *
 *   Tier 1 — our own `artist_id_mappings` table (free, instant, DB read).
 *   Tier 2 — platform search APIs (Spotify/Deezer `searchArtists`, deterministic,
 *            sub-second) for whichever of spotify/deezer is missing.
 *   Tier 3 — one small Gemini call PER remaining platform, all in parallel,
 *            each restricted to a single platform's domain — never one big
 *            open-web call asking about every platform at once (that shape
 *            measured at 44s end-to-end with ZERO candidates for an obscure
 *            artist — see the discovery-rebuild report).
 *
 * A grounded model will confidently invent URLs, so every candidate from
 * EVERY tier — DB-sourced and API-sourced included — is validated before
 * it's ever shown to an artist; see the numbered gates in `discoverInner`
 * below. Nothing here writes to the database; discovery only PROPOSES, the
 * existing `confirm_profiles` → `extractArtistId` → `setArtistLink` path
 * (unchanged) is what actually saves an accepted link.
 */
import { getArtistById, getAllLinks } from "@/server/utils/queries/artistQueries";
import { extractArtistId } from "@/server/utils/services";
import { fetchLinkPreview } from "@/server/utils/linkPreview";
import { musicPlatformData, spotifyProvider, deezerProvider } from "@/server/utils/musicPlatform";
import type { MusicPlatformArtist } from "@/server/utils/musicPlatform";
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { getArtistMappings } from "@/server/utils/idMappingService";
import {
    PROFILE_DISPLAY_COLUMNS,
    artistHasRawLinkValue,
    buildLinkPresentationMeta,
    fallbackDisplayName,
    type ProfileDisplayColumn,
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
// budget) and the SSE plumbing around it.
//
// Unlike the retired single-combined-call design (one 24s-capped Gemini call
// grounded across up to 6 platforms — measured at 44.3s end-to-end for one
// real, obscure artist, returning ZERO candidates because the call blew its
// own timeout), the tiered cascade below is fast BY CONSTRUCTION: tier 1 is a
// DB read, tier 2 is one or two deterministic HTTP calls, and tier 3 is N
// small single-platform grounded calls run in PARALLEL — the slowest of
// those (not their sum) bounds the tier. Worst case is roughly
// tier1(<1s) + tier2(~1-2s) + tier3(TIER3_CALL_TIMEOUT_MS) + the unchanged
// PREVIEW_BUDGET_MS gate ≈ well under 15s. DISCOVERY_BUDGET_MS remains a hard
// backstop so a pathological run (e.g. a hung DB connection) still can't
// blow the turn budget — it degrades to [] instead.
const DISCOVERY_BUDGET_MS = 20_000;
const TIER3_CALL_TIMEOUT_MS = 8_000;
const PREVIEW_BUDGET_MS = 5_000;

// Platforms whose og:image scrape reliably resolves for a real profile
// (verified against the live sites — see linkPreview.ts). A miss here is a
// signal the URL may not exist / be a fabrication. X and platforms with no
// column at all (e.g. Apple Music) are NOT in this set — their absence of
// OG data is normal, so a miss there must not penalize the candidate.
const OG_RELIABLE_SITENAMES = new Set(["spotify", "instagram", "youtube"]);

/** A candidate proposed by one tier, tagged with which tier proposed it and
 *  which PROFILE_DISPLAY_COLUMN it's a proposal FOR (not yet validated —
 *  every candidate, regardless of tier, still runs the full gate pipeline
 *  in `discoverInner`). */
interface TierCandidate {
    tier: 1 | 2 | 3;
    platform: ProfileDisplayColumn;
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

// --- Tier 1: our own cross-platform ID mappings ---------------------------
// `artist_id_mappings` (see idMappingService.ts) anchors on Spotify and maps
// to VALID_MAPPING_PLATFORMS: deezer, apple_music, musicbrainz, wikidata,
// tidal, amazon_music, youtube_music, genius, allmusic, billboard,
// rolling_stone. Of those, only "deezer" is also a PROFILE_DISPLAY_COLUMN we
// render as an onboarding profile card — the rest aren't social/listen
// platforms this UI surfaces at all. This map is intentionally sparse today;
// it exists so a future platform that lands in BOTH sets picks up tier-1
// resolution for free, without code changes here.
const MAPPING_PLATFORM_TO_COLUMN: Partial<Record<string, ProfileDisplayColumn>> = {
    deezer: "deezer",
};

/** Free, instant, authoritative: turn already-resolved cross-platform ID
 *  mappings into candidates. Never throws (DB down, no rows, artist not
 *  found in the mapping table — all degrade to []). Low-confidence rows are
 *  skipped; "manual" (human-entered) is the highest authority and kept. */
async function tierOneIdMappings(
    artistId: string,
    missing: Set<ProfileDisplayColumn>,
    urlmapBySiteName: Map<string, UrlmapPresentationRow>,
): Promise<TierCandidate[]> {
    if (missing.size === 0) return [];
    try {
        const mappings = await getArtistMappings(artistId);
        const out: TierCandidate[] = [];
        for (const m of mappings) {
            if (m.confidence === "low") continue;
            const column = MAPPING_PLATFORM_TO_COLUMN[m.platform];
            if (!column || !missing.has(column)) continue;
            const row = urlmapBySiteName.get(column);
            if (!row?.appStringFormat) continue; // no known URL shape to propose — skip rather than guess
            out.push({
                tier: 1,
                platform: column,
                url: row.appStringFormat.replace("%@", m.platformId),
                reasoning: `Cross-platform ID mapping (${m.confidence} confidence, source: ${m.source})`,
            });
        }
        return out;
    } catch (e) {
        console.error(`[profileDiscovery] tier1 (id mappings) failed for artist=${artistId}:`, e);
        return [];
    }
}

// --- Tier 2: platform search APIs (Spotify / Deezer) ----------------------

function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The artist's own result from a name search: an EXACT (case/whitespace-
 *  insensitive) name match, tie-broken by follower count. No match, or an
 *  ambiguous tie at the top of the ranking, returns null — this tier
 *  proposes only when confident, never a best-effort guess. */
function pickExactNameMatch(matches: MusicPlatformArtist[], artistName: string): MusicPlatformArtist | null {
    const target = normalizeName(artistName);
    const exact = matches.filter(m => normalizeName(m.name) === target);
    if (exact.length === 0) return null;
    exact.sort((a, b) => (b.followerCount ?? 0) - (a.followerCount ?? 0));
    if (exact.length > 1 && (exact[0].followerCount ?? 0) === (exact[1].followerCount ?? 0)) return null;
    return exact[0];
}

/** Deterministic, sub-second: resolve a missing spotify/deezer column via
 *  that platform's own search-by-name API. Runs both lookups (when both are
 *  missing) in parallel. Never throws — a provider error degrades to no
 *  candidate for that platform, same as an ambiguous/no-match search. */
async function tierTwoPlatformSearch(
    artistName: string,
    missing: Set<ProfileDisplayColumn>,
): Promise<TierCandidate[]> {
    const jobs: Promise<TierCandidate | null>[] = [];

    if (missing.has("spotify")) {
        jobs.push((async () => {
            try {
                const matches = await spotifyProvider.searchArtists(artistName, 5);
                const best = pickExactNameMatch(matches, artistName);
                if (!best) return null;
                return { tier: 2, platform: "spotify", url: best.profileUrl, reasoning: `Exact name match via Spotify search (${best.followerCount ?? 0} followers)` };
            } catch (e) {
                console.error("[profileDiscovery] tier2 spotify search failed:", e);
                return null;
            }
        })());
    }

    if (missing.has("deezer")) {
        jobs.push((async () => {
            try {
                const matches = await deezerProvider.searchArtists(artistName, 5);
                const best = pickExactNameMatch(matches, artistName);
                if (!best) return null;
                return { tier: 2, platform: "deezer", url: best.profileUrl, reasoning: `Exact name match via Deezer search (${best.followerCount ?? 0} fans)` };
            } catch (e) {
                console.error("[profileDiscovery] tier2 deezer search failed:", e);
                return null;
            }
        })());
    }

    const settled = await Promise.all(jobs);
    return settled.filter((c): c is TierCandidate => c !== null);
}

// --- Tier 3: per-platform, domain-scoped grounded search -------------------
// Everything left after tiers 1-2 has no dedicated search API (Spotify and
// Deezer are always handled by tier 2, win or lose — they never fall
// through to a grounded search here). One small Gemini call PER platform,
// each scoped to a single domain and asking for a single URL back — never
// the retired shape (one call, every platform, JSON array, Google Search
// grounding wide open). Run in parallel via Promise.all: concurrency is
// inherently bounded by PROFILE_DISPLAY_COLUMNS' fixed, small size (at most
// 8 candidates here), so the slowest single call (capped at
// TIER3_CALL_TIMEOUT_MS) bounds the whole tier, not their sum.
const TIER3_DOMAINS: Partial<Record<ProfileDisplayColumn, string>> = {
    instagram: "instagram.com",
    tiktok: "tiktok.com",
    x: "x.com",
    youtube: "youtube.com",
    soundcloud: "soundcloud.com",
    bandcamp: "bandcamp.com",
    twitch: "twitch.tv",
    facebook: "facebook.com",
};

function buildTierThreePrompt(artistName: string, identityContext: string, platformDisplayName: string, domain: string): string {
    return `You are researching the real-world music artist "${artistName}" to find their OFFICIAL profile on ${platformDisplayName} ONLY.${identityContext}

Search the web, but restrict your search to pages on ${domain}. Find "${artistName}"'s official/verified ${platformDisplayName} profile — not a fan page, not a press article, not a search results page.

Rules:
- Only return a URL if you are genuinely confident it belongs to THIS specific artist, not a different person or band who happens to share the name. If there is any real ambiguity, return nothing.
- Never invent or guess a plausible-looking URL — only a URL you actually found via search.

Respond with ONLY the profile URL and nothing else — no other text, no markdown. If you cannot confidently find one on ${domain}, respond with exactly: NONE`;
}

/** Parses a tier-3 response. The prompt asks for a bare URL (or `NONE`), but
 *  the parser also tolerates a JSON-array shape (`[{"url": ..., "reasoning":
 *  ...}]`) for resilience against a model that ignores the "bare URL only"
 *  instruction — only the first item is used, since this tier is one
 *  platform in, one candidate out by construction. */
function parseTierThreeResponse(text: string): { url: string; reasoning: string | null } | null {
    const trimmed = (text ?? "").trim();
    if (!trimmed) return null;

    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            const parsed = JSON.parse(arrayMatch[0]);
            const first = Array.isArray(parsed) ? parsed[0] : null;
            if (first && typeof first.url === "string" && first.url.length > 0) {
                return { url: first.url, reasoning: typeof first.reasoning === "string" ? first.reasoning : null };
            }
        } catch {
            // fall through — not valid JSON, try the bare-URL shape below
        }
        return null;
    }

    if (/^none$/i.test(trimmed) || /no confident/i.test(trimmed)) return null;
    const urlMatch = trimmed.match(/https?:\/\/\S+/);
    if (!urlMatch) return null;
    return { url: urlMatch[0].replace(/[)\].,'"]+$/, ""), reasoning: null };
}

async function tierThreeGroundedSearch(
    artistName: string,
    identityContext: string,
    missing: Set<ProfileDisplayColumn>,
    urlmapBySiteName: Map<string, UrlmapPresentationRow>,
): Promise<TierCandidate[]> {
    const platforms = (Object.keys(TIER3_DOMAINS) as ProfileDisplayColumn[]).filter(p => missing.has(p));
    if (platforms.length === 0) return [];

    const settled = await Promise.all(platforms.map(async (platform): Promise<TierCandidate | null> => {
        const domain = TIER3_DOMAINS[platform]!;
        const displayName = urlmapBySiteName.get(platform)?.cardPlatformName || fallbackDisplayName(platform);
        const prompt = buildTierThreePrompt(artistName, identityContext, displayName, domain);
        try {
            const response = await Promise.race([
                getGemini().models.generateContent({
                    model: GEMINI_MODEL_FLASH,
                    contents: prompt,
                    config: {
                        systemInstruction: "You are a precise, conservative music research assistant identifying a single official profile link on one platform. Only return a URL you are confident belongs to the specified artist, restricted to the requested domain — never a guess, never a link to a different platform.",
                        tools: [{ googleSearch: {} }],
                    },
                }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error("tier3 discovery timeout")), TIER3_CALL_TIMEOUT_MS)),
            ]);
            const parsed = parseTierThreeResponse(response.text ?? "");
            if (!parsed) return null;
            return { tier: 3, platform, url: parsed.url, reasoning: parsed.reasoning };
        } catch (e) {
            console.error(`[profileDiscovery] tier3 (${platform}) search failed:`, e);
            return null;
        }
    }));

    return settled.filter((c): c is TierCandidate => c !== null);
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
    const artist = await getArtistById(artistId);
    if (!artist) return [];
    const record = artist as unknown as Record<string, unknown>;

    // Nothing to search for — the artist already has every platform we'd propose.
    const missing = new Set<ProfileDisplayColumn>(PROFILE_DISPLAY_COLUMNS.filter(col => !artistHasRawLinkValue(record, col)));
    if (missing.size === 0) return [];

    let allLinks: Awaited<ReturnType<typeof getAllLinks>> = [];
    try {
        allLinks = await getAllLinks();
    } catch (e) {
        console.error("[profileDiscovery] getAllLinks failed, presentation metadata will degrade:", e);
    }
    const urlmapBySiteName = new Map<string, UrlmapPresentationRow>(allLinks.map(l => [l.siteName, l]));

    // --- Tier 1 — free, instant, authoritative ----------------------------
    const tier1 = await tierOneIdMappings(artistId, missing, urlmapBySiteName);
    for (const c of tier1) missing.delete(c.platform);

    // --- Tiers 2/3 both need a real name to search/ask about. A bare
    // platform ID (e.g. only `deezer` set) is useless as a search anchor on
    // its own — resolve the real name/image/fan count first. Skipped
    // entirely once tier 1 alone has satisfied everything missing.
    let tier2: TierCandidate[] = [];
    let tier3: TierCandidate[] = [];
    let artistName: string | null = null;
    if (missing.size > 0) {
        const enrichment = await musicPlatformData.getArtist(artist).catch(() => null);
        artistName = enrichment?.name?.trim() || artist.name?.trim() || null;
        if (artistName) {
            // --- Tier 2 — deterministic platform search APIs ------------------
            tier2 = await tierTwoPlatformSearch(artistName, missing);
            for (const c of tier2) missing.delete(c.platform);

            // --- Tier 3 — per-platform, domain-scoped grounded search, parallel
            if (missing.size > 0) {
                const identityContext = buildIdentityContext(record, enrichment);
                tier3 = await tierThreeGroundedSearch(artistName, identityContext, missing, urlmapBySiteName);
                for (const c of tier3) missing.delete(c.platform);
            }
        }
    }

    const allRaw: TierCandidate[] = [...tier1, ...tier2, ...tier3];
    if (allRaw.length === 0) {
        console.log(`[profileDiscovery] artist=${artistId} name="${artist.name ?? artistName}" — no tier proposed any candidates`);
        return [];
    }

    // --- Validation gates -------------------------------------------------
    // Every candidate from EVERY tier runs through the SAME gates — a tier-1
    // or tier-2 result is not exempt:
    // (0) [new — tier-scoping check] the URL must resolve back to the SAME
    //     platform the tier proposed it for (e.g. a tier-3 Instagram-scoped
    //     call must not smuggle in a TikTok URL). Not one of the six
    //     original gates below — an additive safety check the per-platform
    //     tier-3 design specifically needs, since each call now carries an
    //     implicit "this answer is about platform X" contract to enforce.
    // (a) extractArtistId resolves the URL to a real {siteName, id}, and
    // (b) that siteName is one MusicNerd can actually write (the curated,
    //     writable-by-construction PROFILE_DISPLAY_COLUMNS set) — otherwise
    //     an accepted candidate would round-trip into a confusing
    //     "already linked to another profile" write-rejection message.
    // (c) the artist doesn't already have a value for that column, and
    // (d) dedupe by siteName, keeping the first (highest-confidence /
    //     highest-authority-tier) hit.
    type Survivor = { siteName: string; id: string; reasoning: string | null; originalUrl: string; tier: 1 | 2 | 3 };
    const survivors: Survivor[] = [];
    const seen = new Set<string>();
    let unresolved = 0, unsupported = 0, alreadyHave = 0, duplicate = 0, mismatch = 0;
    for (const candidate of allRaw) {
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
        if (siteName !== candidate.platform) { mismatch++; continue; }
        if (!(PROFILE_DISPLAY_COLUMNS as readonly string[]).includes(siteName)) { unsupported++; continue; }
        if (artistHasRawLinkValue(record, siteName)) { alreadyHave++; continue; }
        if (seen.has(siteName)) { duplicate++; continue; }
        seen.add(siteName);
        survivors.push({ siteName, id: extracted.id, reasoning: candidate.reasoning, originalUrl: candidate.url, tier: candidate.tier });
    }

    if (survivors.length === 0) {
        console.log(
            `[profileDiscovery] artist=${artistId} name="${artist.name ?? artistName}" ` +
            `proposed(t1=${tier1.length},t2=${tier2.length},t3=${tier3.length}) survivors=0 ` +
            `(unresolved=${unresolved} mismatch=${mismatch} unsupported=${unsupported} alreadyHave=${alreadyHave} duplicate=${duplicate})`,
        );
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
    const tierBySiteName = new Map<string, 1 | 2 | 3>();
    for (const s of enrichedSurvivors) {
        const previewImage = previewBySiteName.get(s.siteName) ?? null;
        if (!previewImage && OG_RELIABLE_SITENAMES.has(s.siteName)) { noOg++; continue; }
        tierBySiteName.set(s.siteName, s.tier);
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

    // Per-tier proposed/survived counts — lets us judge which tier earns its
    // keep over time (see the discovery-rebuild report).
    const survivedByTier = { 1: 0, 2: 0, 3: 0 };
    for (const tier of tierBySiteName.values()) survivedByTier[tier]++;

    console.log(
        `[profileDiscovery] artist=${artistId} name="${artist.name ?? artistName}" ` +
        `tier1 proposed=${tier1.length} survived=${survivedByTier[1]} | ` +
        `tier2 proposed=${tier2.length} survived=${survivedByTier[2]} | ` +
        `tier3 proposed=${tier3.length} survived=${survivedByTier[3]} | ` +
        `total survivors=${results.length} (unresolved=${unresolved} mismatch=${mismatch} unsupported=${unsupported} alreadyHave=${alreadyHave} duplicate=${duplicate} noOg=${noOg}) ` +
        `keptSiteNames=${JSON.stringify(results.map(r => r.siteName))}`,
    );
    return results;
}

/** Discover platform profiles the artist likely has but hasn't linked yet,
 *  from whatever identity anchors are already on file. Bounded to
 *  ~`DISCOVERY_BUDGET_MS` end-to-end and NEVER throws — any failure (DB
 *  down, provider down, Gemini down, malformed JSON, network errors)
 *  resolves to `[]`, leaving the `profiles` onboarding step exactly as it
 *  behaves without discovery. */
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
