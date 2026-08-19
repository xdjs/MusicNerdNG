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
 * FINDING candidates is a four-tier cascade, run in authority + speed order,
 * each tier skipping platforms an earlier tier already proposed:
 *
 *   Tier 1 — our own `artist_id_mappings` table (free, instant, DB read).
 *   Tier 2 — platform search APIs (Spotify/Deezer `searchArtists`, deterministic,
 *            sub-second) for whichever of spotify/deezer is missing.
 *   Tier 3 — deterministic HANDLE PROBING: build a small set of candidate
 *            handles (existing handle-shaped links, handles confirmed
 *            earlier in this run, and a few slugs derived from the artist's
 *            name), fetch each candidate URL directly via `fetchLinkPreview`,
 *            and treat a real og:image/og:title as proof — sub-second per
 *            probe, self-validating (a fake handle returns nothing), and
 *            replaces what used to be a per-platform Gemini search (measured
 *            live: that shape timed out on 4 of 7 platforms and found ZERO
 *            candidates for an artist who genuinely has profiles on all of
 *            them — see the discovery-rebuild report).
 *   Tier 4 — Gemini, kept ONLY as a last resort for whatever tier 3's
 *            probing couldn't confirm and only if the time budget allows:
 *            one small call per remaining platform, each restricted to a
 *            single platform's domain — never one big open-web call asking
 *            about every platform at once (that shape measured at 44s
 *            end-to-end with ZERO candidates for an obscure artist).
 *
 * A grounded model (tier 4) will confidently invent URLs, so every candidate
 * it proposes is validated before it's ever shown to an artist; see the
 * numbered gates in `validateCandidate` below. Tiers 1/2/3 are deterministic
 * (DB read, search API, or a direct HTTP probe) and never hallucinate a URL,
 * so the OG-existence gate only re-applies to tier 4 — tier 3's own probe
 * fetch already IS that check, so it isn't repeated. Nothing here writes to
 * the database; discovery only PROPOSES, the existing `confirm_profiles` →
 * `extractArtistId` → `setArtistLink` path (unchanged) is what actually
 * saves an accepted link.
 *
 * Results STREAM: `discoverArtistProfilesStream` is an async generator that
 * yields a `searching`/`checked` pair as each platform lookup starts/settles
 * and a `found` event the instant a candidate clears validation — never a
 * silent `Promise.all` that dumps everything at once. `discoverArtistProfiles`
 * is a thin array-returning wrapper over it for callers that just want the
 * final list.
 */
import { getArtistById, getAllLinks } from "@/server/utils/queries/artistQueries";
import { extractArtistId } from "@/server/utils/services";
import { fetchLinkPreview, type LinkPreview } from "@/server/utils/linkPreview";
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
// own timeout), the cascade below is fast BY CONSTRUCTION: tier 1 is a DB
// read, tier 2 is one or two deterministic HTTP calls, tier 3 is a handful of
// sub-second HTTP probes run with a bounded concurrency, and tier 4 (Gemini,
// last resort only) is N small single-platform grounded calls run in
// PARALLEL — the slowest of those (not their sum) bounds the tier. Worst
// case is roughly tier1(<1s) + tier2(~1-2s) + tier3(a couple probe rounds,
// each ≤PROBE_CONCURRENCY-wide and individually sub-second) +
// tier4(TIER3_CALL_TIMEOUT_MS, only for whatever's still missing) + a
// per-candidate preview fetch (≤4s, 8s worst case chained for Spotify — see
// linkPreview.ts) ≈ well under 15s. DISCOVERY_BUDGET_MS remains a hard
// backstop, checked between tiers inside the generator itself, so a
// pathological run (e.g. a hung DB connection) still can't blow the turn
// budget — it stops yielding instead.
const DISCOVERY_BUDGET_MS = 20_000;
const TIER3_CALL_TIMEOUT_MS = 8_000;

// Platforms whose og:image scrape reliably resolves for a real profile
// (verified against the live sites — see linkPreview.ts). A miss here is a
// signal the URL may not exist / be a fabrication. X and platforms with no
// column at all (e.g. Apple Music) are NOT in this set — their absence of
// OG data is normal, so a miss there must not penalize the candidate.
const OG_RELIABLE_SITENAMES = new Set(["spotify", "instagram", "youtube"]);

/** A candidate proposed by one tier, tagged with which tier proposed it and
 *  which PROFILE_DISPLAY_COLUMN it's a proposal FOR (not yet validated —
 *  every candidate, regardless of tier, still runs the full gate pipeline
 *  in `validateCandidate`). Tier 3 (handle probe) candidates carry the
 *  `LinkPreview` their own probe fetch already produced, so `validateCandidate`
 *  can reuse it instead of re-fetching the same URL a second time. */
interface TierCandidate {
    tier: 1 | 2 | 3 | 4;
    platform: ProfileDisplayColumn;
    url: string;
    reasoning: string | null;
    preview?: LinkPreview;
}

/** The handle-based platforms with no dedicated search API (Spotify and
 *  Deezer are always handled by tier 2, win or lose — they never reach tier
 *  3 or 4). Shared by both tier 3 (handle probing, keyed off the domain to
 *  build a probe URL via urlmap) and tier 4 (Gemini last resort, keyed off
 *  the domain to scope the grounded search). */
const HANDLE_BASED_PLATFORM_DOMAINS: Partial<Record<ProfileDisplayColumn, string>> = {
    instagram: "instagram.com",
    tiktok: "tiktok.com",
    x: "x.com",
    youtube: "youtube.com",
    soundcloud: "soundcloud.com",
    bandcamp: "bandcamp.com",
    twitch: "twitch.tv",
    facebook: "facebook.com",
};

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

/** Drains a set of KEYED promises in COMPLETION order (not creation order) —
 *  the primitive that lets tier 2/3 stream a fast platform's result the
 *  instant it lands instead of waiting on `Promise.all` for the slowest one
 *  in the batch. Each promise is wrapped once (so repeated `Promise.race`
 *  calls don't re-trigger already-settled work) and removed from the pool as
 *  soon as it wins a race, so every entry is yielded exactly once.
 *
 *  A REJECTED input promise is coerced to `null` rather than left to reject
 *  the race — every current caller already self-catches inside its own async
 *  IIFE (so this never fires today), but without this, one rejecting job
 *  would blow up the whole `for await` and silently truncate every later
 *  platform/tier rather than degrading just that one job to "no candidate". */
async function* settleAsCompleted<K, V>(entries: [key: K, promise: Promise<V>][]): AsyncGenerator<[K, V | null]> {
    const remaining = new Map(entries.map(([key, p]) => [
        key,
        p.then(value => ({ key, value: value as V | null }), () => ({ key, value: null as V | null })),
    ] as const));
    while (remaining.size > 0) {
        const { key, value } = await Promise.race(remaining.values());
        remaining.delete(key);
        yield [key, value];
    }
}

/** Deterministic, sub-second: resolve a missing spotify/deezer column via
 *  that platform's own search-by-name API. Kicks off both lookups (when both
 *  are missing) in parallel and yields each as its own job resolves —
 *  Spotify must never wait on Deezer or vice versa. Never throws — a
 *  provider error degrades to no candidate for that platform, same as an
 *  ambiguous/no-match search. Yields `[platform, candidate | null]` for
 *  EVERY targeted platform (not just hits) so the caller can emit a
 *  "checked" signal even when nothing was found. */
async function* tierTwoPlatformSearchStream(
    artistName: string,
    missing: Set<ProfileDisplayColumn>,
): AsyncGenerator<[ProfileDisplayColumn, TierCandidate | null]> {
    const jobs: [ProfileDisplayColumn, Promise<TierCandidate | null>][] = [];

    if (missing.has("spotify")) {
        jobs.push(["spotify", (async (): Promise<TierCandidate | null> => {
            try {
                const matches = await spotifyProvider.searchArtists(artistName, 5);
                const best = pickExactNameMatch(matches, artistName);
                if (!best) return null;
                return { tier: 2, platform: "spotify", url: best.profileUrl, reasoning: `Exact name match via Spotify search (${best.followerCount ?? 0} followers)` };
            } catch (e) {
                console.error("[profileDiscovery] tier2 spotify search failed:", e);
                return null;
            }
        })()]);
    }

    if (missing.has("deezer")) {
        jobs.push(["deezer", (async (): Promise<TierCandidate | null> => {
            try {
                const matches = await deezerProvider.searchArtists(artistName, 5);
                const best = pickExactNameMatch(matches, artistName);
                if (!best) return null;
                return { tier: 2, platform: "deezer", url: best.profileUrl, reasoning: `Exact name match via Deezer search (${best.followerCount ?? 0} fans)` };
            } catch (e) {
                console.error("[profileDiscovery] tier2 deezer search failed:", e);
                return null;
            }
        })()]);
    }

    yield* settleAsCompleted(jobs);
}

// --- Tier 3: deterministic handle probing ----------------------------------
// Everything left after tiers 1-2 has no dedicated search API. Instead of
// asking a grounded model to go find the profile (slow, and a MISS there is
// meaningless — see tier 4 below), build a small set of candidate HANDLES and
// fetch each candidate URL directly. A real profile serves an og:image/
// og:title to our bot UA; a fabricated handle serves neither (measured live
// — see the module docblock). This is sub-second per probe and inherently
// self-validating, so it needs no separate OG-existence gate afterward.

/** Platforms known to block server-side OG scraping entirely (verified live:
 *  a real x.com profile page returns no og:image/og:title to a bot UA — see
 *  linkPreview.ts). A MISS there is NOT evidence the handle doesn't exist,
 *  so these are never probed for confirmation; they're left in `missing` for
 *  the tier-4 Gemini last-resort to attempt instead of a false negative. */
const PROBE_UNVERIFIABLE_PLATFORMS = new Set<ProfileDisplayColumn>(["x"]);

/** Cap on simultaneous in-flight probe fetches — a polite-client bound so a
 *  large candidate set can't fire dozens of requests at third-party servers
 *  at once. */
const PROBE_CONCURRENCY = 8;

/** Cap on how many slugs get DERIVED from the artist's name — never
 *  combinatorially explode (a 5-word artist name still yields at most this
 *  many slugs, not one per permutation). */
const MAX_DERIVED_SLUGS = 4;

function normalizeHandle(raw: string): string {
    return raw.trim().replace(/^@/, "");
}

/** Derives up to `MAX_DERIVED_SLUGS` candidate handle slugs from an artist's
 *  resolved display name, mirroring how artists commonly pick a handle: a
 *  plain concatenation ("Pete Rango" -> "peterango"), a hyphenated form
 *  ("pete-rango"), and — only for a clearly two-word name, where a dot/
 *  underscore join is unambiguous — "pete.rango" / "pete_rango". */
export function deriveNameSlugs(artistName: string): string[] {
    const words = artistName
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "") // strip diacritics (e.g. "é" -> "e")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0) return [];

    const slugs: string[] = [];
    const add = (s: string) => { if (s && !slugs.includes(s)) slugs.push(s); };
    add(words.join(""));
    if (words.length > 1) add(words.join("-"));
    if (words.length === 2) {
        add(words.join("."));
        add(words.join("_"));
    }
    return slugs.slice(0, MAX_DERIVED_SLUGS);
}

function normalizeForCompare(s: string): string {
    return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

/** Loose containment check, either direction — an og:title is rarely an
 *  exact match (platforms append taglines, e.g. `"Pete Rango (@p3t3rango) •
 *  Instagram photos and videos"`), but a title belonging to a genuinely
 *  different person won't contain the artist's (normalized) name at all. */
export function titleMatchesArtist(title: string, artistName: string): boolean {
    const t = normalizeForCompare(title);
    const a = normalizeForCompare(artistName);
    if (!t || !a) return false;
    return t.includes(a) || a.includes(t);
}

/** A probe "hit" is an og:image OR an og:title — but a title that clearly
 *  names someone else overrides an image and is still a MISS; this is the
 *  main defense against grabbing a stranger's handle. No title at all means
 *  no cross-check is possible, so an image alone is trusted (matches the
 *  measured live behavior: a fabricated handle returns neither image nor
 *  title, never a mismatched title alone). */
export function isProbeHit(preview: LinkPreview, artistName: string): boolean {
    if (preview.title && !titleMatchesArtist(preview.title, artistName)) return false;
    return !!(preview.imageUrl || preview.title);
}

/** Bounded-concurrency streaming map — same "yield the instant each settles"
 *  contract as `settleAsCompleted`, but caps in-flight work at `concurrency`
 *  instead of starting everything at once (a large handle × platform
 *  candidate set must not fire dozens of simultaneous requests). */
async function* mapWithConcurrency<I, R>(
    items: I[],
    concurrency: number,
    run: (item: I) => Promise<R>,
): AsyncGenerator<[I, R]> {
    if (items.length === 0) return;
    let nextIndex = 0;
    const inFlight = new Map<number, Promise<{ slot: number; item: I; result: R }>>();
    const launch = (slot: number) => {
        const item = items[nextIndex++];
        inFlight.set(slot, run(item).then(result => ({ slot, item, result })));
    };
    for (let i = 0; i < Math.min(concurrency, items.length); i++) launch(i);
    while (inFlight.size > 0) {
        const { slot, item, result } = await Promise.race(inFlight.values());
        inFlight.delete(slot);
        yield [item, result];
        if (nextIndex < items.length) launch(slot);
    }
}

interface HandleProbe {
    platform: ProfileDisplayColumn;
    handle: string;
    source: string;
}

/** Probes one (platform, handle) URL via the existing `fetchLinkPreview`
 *  helper (already uses the right UA and handles Spotify oEmbed) and reports
 *  a confirmed hit, or `null` on a miss/failure — `fetchLinkPreview` itself
 *  never throws and already carries its own ~4s per-fetch timeout. */
async function runHandleProbe(
    probe: HandleProbe,
    urlmapBySiteName: Map<string, UrlmapPresentationRow>,
    artistName: string,
): Promise<{ url: string; preview: LinkPreview } | null> {
    const row = urlmapBySiteName.get(probe.platform);
    if (!row?.appStringFormat) return null;
    const url = row.appStringFormat.replace("%@", probe.handle);
    try {
        // `fetchLinkPreview` is documented as never-throwing, but this tier's
        // whole promise-racing pipeline (`mapWithConcurrency`) would propagate
        // a single rejection out through the generator and violate this
        // module's "never throws" contract, so defend anyway — same pattern
        // every other tier in this file already follows.
        const preview = await fetchLinkPreview(url);
        if (!isProbeHit(preview, artistName)) return null;
        return { url, preview };
    } catch (e) {
        console.error(`[profileDiscovery] tier3 handle probe failed for ${url}:`, e);
        return null;
    }
}

/** Tier 3 — deterministic handle probing, two passes:
 *
 *  1. SEED — the candidate handle set (the artist's own existing
 *     handle-shaped links across every handle-based platform, deduped, plus
 *     up to `MAX_DERIVED_SLUGS` name-derived slugs) probed against every
 *     still-missing target, budget- and concurrency-capped.
 *  2. PROPAGATE — a mop-up pass: any handle CONFIRMED by the seed pass,
 *     retried (skipping any pair already tried) against whatever target is
 *     STILL unresolved. This is what turns a single confirmed handle into
 *     hits on every other platform that artist reuses it on, and recovers
 *     any (platform, handle) pair the seed pass had to skip once its budget
 *     ran out — never a flat `Promise.all` over the full candidate matrix.
 *
 *  Yields `[platform, candidate | null]` for EVERY targeted platform exactly
 *  once (a `null` for anything never confirmed, INCLUDING platforms in
 *  `PROBE_UNVERIFIABLE_PLATFORMS` that are never actually probed) so the
 *  caller can emit a "checked" signal and hand anything still unresolved to
 *  the tier-4 Gemini last-resort. Never throws — an individual probe failure
 *  degrades to "no hit" for that one (platform, handle) pair only. */
async function* tierThreeHandleProbeStream(
    artistName: string,
    record: Record<string, unknown>,
    missing: Set<ProfileDisplayColumn>,
    urlmapBySiteName: Map<string, UrlmapPresentationRow>,
): AsyncGenerator<[ProfileDisplayColumn, TierCandidate | null]> {
    const handlePlatforms = Object.keys(HANDLE_BASED_PLATFORM_DOMAINS) as ProfileDisplayColumn[];
    const targets = handlePlatforms.filter(p => missing.has(p) && !PROBE_UNVERIFIABLE_PLATFORMS.has(p));
    if (targets.length === 0) return;

    const resolved = new Map<ProfileDisplayColumn, TierCandidate>();
    const tried = new Set<string>(); // `${platform}|${handle}` — never probe the same pair twice
    let budget = MAX_DERIVED_SLUGS * targets.length; // roughly "4 slugs x platform count", per the polite-client cap

    const toCandidate = (probe: HandleProbe, hit: { url: string; preview: LinkPreview }, propagated: boolean): TierCandidate => ({
        tier: 3,
        platform: probe.platform,
        url: hit.url,
        reasoning: `Handle probe: ${hit.preview.title ? `og:title matched "${artistName}"` : "og:image resolved"} for @${probe.handle}` +
            (propagated ? " (propagated from a handle confirmed on another platform)" : ` (${probe.source})`),
        preview: hit.preview,
    });

    // --- Seed pass: existing handle-shaped links + name-derived slugs -----
    const seenHandles = new Set<string>();
    const seedHandles: { handle: string; source: string }[] = [];
    for (const col of handlePlatforms) {
        const raw = record[col];
        if (typeof raw !== "string" || !raw) continue;
        const handle = normalizeHandle(raw);
        if (!handle || seenHandles.has(handle)) continue;
        seenHandles.add(handle);
        seedHandles.push({ handle, source: `existing ${col} handle` });
    }
    for (const slug of deriveNameSlugs(artistName)) {
        if (seenHandles.has(slug)) continue;
        seenHandles.add(slug);
        seedHandles.push({ handle: slug, source: "derived from artist name" });
    }

    const seedJobs: HandleProbe[] = [];
    for (const { handle, source } of seedHandles) {
        for (const platform of targets) {
            const key = `${platform}|${handle}`;
            if (tried.has(key) || budget <= 0) continue;
            tried.add(key);
            budget--;
            seedJobs.push({ platform, handle, source });
        }
    }

    const newlyConfirmedHandles = new Set<string>();
    for await (const [probe, hit] of mapWithConcurrency(seedJobs, PROBE_CONCURRENCY, p => runHandleProbe(p, urlmapBySiteName, artistName))) {
        if (!hit || resolved.has(probe.platform)) continue; // first confirmed hit per platform wins
        const candidate = toCandidate(probe, hit, false);
        resolved.set(probe.platform, candidate);
        newlyConfirmedHandles.add(probe.handle);
        yield [probe.platform, candidate];
    }

    // --- Propagate pass: handles confirmed above -> still-unresolved ------
    const stillMissing = targets.filter(p => !resolved.has(p));
    if (stillMissing.length > 0 && newlyConfirmedHandles.size > 0 && budget > 0) {
        const propagationJobs: HandleProbe[] = [];
        for (const handle of newlyConfirmedHandles) {
            for (const platform of stillMissing) {
                const key = `${platform}|${handle}`;
                if (tried.has(key) || budget <= 0) continue;
                tried.add(key);
                budget--;
                propagationJobs.push({ platform, handle, source: "propagated" });
            }
        }
        for await (const [probe, hit] of mapWithConcurrency(propagationJobs, PROBE_CONCURRENCY, p => runHandleProbe(p, urlmapBySiteName, artistName))) {
            if (!hit || resolved.has(probe.platform)) continue;
            const candidate = toCandidate(probe, hit, true);
            resolved.set(probe.platform, candidate);
            yield [probe.platform, candidate];
        }
    }

    for (const platform of targets) {
        if (!resolved.has(platform)) yield [platform, null];
    }
}

// --- Tier 4: Gemini, kept ONLY as a last resort -----------------------------
// Whatever tier 3's deterministic handle probing couldn't confirm falls
// through here — one small Gemini call PER platform,
// each scoped to a single domain and asking for a single URL back — never
// the retired shape (one call, every platform, JSON array, Google Search
// grounding wide open). Run in parallel via Promise.all: concurrency is
// inherently bounded by PROFILE_DISPLAY_COLUMNS' fixed, small size (at most
// 8 candidates here), so the slowest single call (capped at
// TIER3_CALL_TIMEOUT_MS) bounds the whole tier, not their sum.

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

/** One small Gemini call PER remaining platform, all kicked off together but
 *  yielded as EACH individual call resolves (via `settleAsCompleted`) — never
 *  a `Promise.all` barrier that lets the slowest platform hold up the rest.
 *  Yields `[platform, candidate | null]` for every targeted platform so the
 *  caller can emit a "checked" signal even for a `NONE`/failed response. */
async function* tierThreeGroundedSearchStream(
    artistName: string,
    identityContext: string,
    missing: Set<ProfileDisplayColumn>,
    urlmapBySiteName: Map<string, UrlmapPresentationRow>,
): AsyncGenerator<[ProfileDisplayColumn, TierCandidate | null]> {
    const platforms = (Object.keys(HANDLE_BASED_PLATFORM_DOMAINS) as ProfileDisplayColumn[]).filter(p => missing.has(p));
    if (platforms.length === 0) return;

    const jobs: [ProfileDisplayColumn, Promise<TierCandidate | null>][] = platforms.map(platform => [platform, (async (): Promise<TierCandidate | null> => {
        const domain = HANDLE_BASED_PLATFORM_DOMAINS[platform]!;
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
            return { tier: 4, platform, url: parsed.url, reasoning: parsed.reasoning };
        } catch (e) {
            console.error(`[profileDiscovery] tier3 (${platform}) search failed:`, e);
            return null;
        }
    })()]);

    yield* settleAsCompleted(jobs);
}

/** A live progress/result signal from `discoverArtistProfilesStream`, emitted
 *  as each individual platform lookup starts and settles — the SSE layer
 *  (`turnHandlers.ts`) translates these 1:1 into `progress`/`candidate`
 *  frames so the artist watches profiles get found in real time, instead of
 *  the whole three-tier cascade running silently and dumping a single result
 *  array at the end.
 *
 *  `searching`/`checked` always come in pairs for a given platform (start,
 *  then settle — regardless of whether anything was found) so a client can
 *  flip a "Searching X…" chip to a checkmark by matching on `displayName`.
 *  `found` fires the instant a candidate clears every validation gate — it
 *  is NOT batched behind its tier's other in-flight platforms. */
export type DiscoveryEvent =
    | { kind: "searching"; platform: ProfileDisplayColumn; displayName: string }
    | { kind: "checked"; platform: ProfileDisplayColumn; displayName: string }
    | { kind: "found"; profile: DiscoveredProfile };

function platformDisplayName(platform: ProfileDisplayColumn, urlmapBySiteName: Map<string, UrlmapPresentationRow>): string {
    return urlmapBySiteName.get(platform)?.cardPlatformName || fallbackDisplayName(platform);
}

interface ValidationContext {
    artistId: string;
    record: Record<string, unknown>;
    urlmapBySiteName: Map<string, UrlmapPresentationRow>;
    /** Shared across the WHOLE run (all tiers) — dedupe gate (d): first
     *  validated hit for a siteName wins, a later one is dropped. */
    seen: Set<string>;
}

/** Runs a single raw tier candidate through every validation gate a
 *  discovered profile must clear before it's ever shown to an artist — the
 *  exact gates `discoverInner` used to run once over a fully-collected batch,
 *  now run inline per-candidate so a hit can be yielded the instant it's
 *  proven real, without waiting on the rest of its tier:
 *  (0) the URL resolves back to the SAME platform the tier proposed it for
 *      (a tier-3 Instagram-scoped call must not smuggle in a TikTok URL),
 *  (a) `extractArtistId` resolves the URL to a real {siteName, id},
 *  (b) that siteName is one MusicNerd can actually write (curated,
 *      writable-by-construction `PROFILE_DISPLAY_COLUMNS`),
 *  (c) the artist doesn't already have a value for that column,
 *  (d) dedupe by siteName (first validated hit wins),
 *  (e) a preview (og:image) resolves — but ONLY for tier 4 (Gemini). This
 *      gate exists to catch a GROUNDED MODEL hallucinating a
 *      plausible-but-dead URL; tiers 1 (our own DB), 2 (deterministic
 *      platform search APIs), and 3 (a deterministic HTTP probe — the
 *      og:existence check already IS how it confirms a candidate in the
 *      first place) never hallucinate, so a real deterministic match is
 *      never discarded just because an unrelated oEmbed/scrape blipped.
 *      Only enforced for platforms known to reliably serve OG data in the
 *      first place (`OG_RELIABLE_SITENAMES`) — a miss anywhere else is
 *      normal, not a red flag. */
async function validateCandidate(candidate: TierCandidate, ctx: ValidationContext): Promise<DiscoveredProfile | null> {
    let extracted;
    try {
        extracted = await extractArtistId(candidate.url);
    } catch (e) {
        console.error(`[profileDiscovery] extractArtistId threw for ${candidate.url}:`, e);
        return null;
    }
    if (!extracted?.siteName || !extracted?.id) return null;
    const siteName = extracted.siteName;
    if (siteName !== candidate.platform) return null; // gate (0) — tier-scoping mismatch
    if (!(PROFILE_DISPLAY_COLUMNS as readonly string[]).includes(siteName)) return null; // gate (b)
    if (artistHasRawLinkValue(ctx.record, siteName)) return null; // gate (c)
    if (ctx.seen.has(siteName)) return null; // gate (d)
    ctx.seen.add(siteName);

    // Build the canonical profile URL from urlmap (matches confirmed-link
    // presentation exactly), but verify it round-trips back through
    // extractArtistId to the SAME {siteName, id} before trusting it as the
    // URL the client will submit on accept — urlmap's appStringFormat isn't
    // guaranteed to be the inverse of every regex (YouTube's `@` handles,
    // SoundCloud's numeric-ID guard, Facebook's full-URL column). When it
    // doesn't round-trip, fall back to the original URL we already proved
    // extracts correctly — used for submission; the urlmap metadata is
    // still used for display (logo/color/name).
    const row = ctx.urlmapBySiteName.get(siteName);
    const meta = buildLinkPresentationMeta(row, siteName, extracted.id);
    let profileUrl = meta.profileUrl || candidate.url;
    if (meta.profileUrl) {
        try {
            const roundTrip = await extractArtistId(meta.profileUrl);
            if (!roundTrip || roundTrip.siteName !== siteName || roundTrip.id !== extracted.id) {
                profileUrl = candidate.url;
            }
        } catch {
            profileUrl = candidate.url;
        }
    }

    // Tier 3's own probe fetch already fetched this exact URL to confirm the
    // candidate in the first place — reuse that result instead of fetching
    // it again (the "don't double-fetch" contract in the module docblock).
    const preview = candidate.preview ?? await fetchLinkPreview(profileUrl);
    const previewImage = preview.imageUrl ?? null;
    if (!previewImage && candidate.tier === 4 && OG_RELIABLE_SITENAMES.has(siteName)) return null; // gate (e)

    return {
        siteName,
        displayName: meta.displayName,
        value: extracted.id,
        profileUrl,
        logoUrl: meta.logoUrl,
        colorHex: meta.colorHex,
        previewImage,
        reasoning: candidate.reasoning,
    };
}

/** Discover platform profiles the artist likely has but hasn't linked yet,
 *  from whatever identity anchors are already on file — streamed as an async
 *  generator so each finding renders the instant it's proven real instead of
 *  the whole cascade running silently and dumping one array at the end (see
 *  `DiscoveryEvent` above). Tiers still run in authority order (1 → 2 → 3 → 4,
 *  each skipping platforms an earlier tier already proposed for), but WITHIN
 *  a tier, multiple platforms are checked in parallel and yielded as each one
 *  individually settles — a slow platform must never delay a fast one.
 *
 *  Carries its own `DISCOVERY_BUDGET_MS` deadline (checked between tiers) so
 *  a hung tier can't eat the onboarding turn's budget — this generator is
 *  consumed directly in production (`turnHandlers.ts`), so unlike the old
 *  array-returning function it has no outer `Promise.race` backstop of its
 *  own; `discoverArtistProfiles` below adds one anyway for any other caller.
 *
 *  NEVER throws — any failure (DB down, provider down, Gemini down, bad
 *  JSON, network) simply stops yielding, degrading to whatever was already
 *  found (possibly nothing) so a discovery failure can never break the
 *  `profiles` onboarding turn. */
export async function* discoverArtistProfilesStream(artistId: string): AsyncGenerator<DiscoveryEvent> {
    const startedAt = Date.now();
    const pastBudget = () => Date.now() - startedAt > DISCOVERY_BUDGET_MS;

    let artist;
    try {
        artist = await getArtistById(artistId);
    } catch (e) {
        console.error(`[profileDiscovery] getArtistById failed for ${artistId}:`, e);
        return;
    }
    if (!artist) return;
    const record = artist as unknown as Record<string, unknown>;

    // Nothing to search for — the artist already has every platform we'd propose.
    const missing = new Set<ProfileDisplayColumn>(PROFILE_DISPLAY_COLUMNS.filter(col => !artistHasRawLinkValue(record, col)));
    if (missing.size === 0) return;

    let allLinks: Awaited<ReturnType<typeof getAllLinks>> = [];
    try {
        allLinks = await getAllLinks();
    } catch (e) {
        console.error("[profileDiscovery] getAllLinks failed, presentation metadata will degrade:", e);
    }
    const urlmapBySiteName = new Map<string, UrlmapPresentationRow>(allLinks.map(l => [l.siteName, l]));
    const ctx: ValidationContext = { artistId, record, urlmapBySiteName, seen: new Set<string>() };
    let foundCount = 0;

    // --- Tier 1 — free, instant, authoritative ----------------------------
    const tier1Targets = (Object.values(MAPPING_PLATFORM_TO_COLUMN) as (ProfileDisplayColumn | undefined)[])
        .filter((p): p is ProfileDisplayColumn => !!p && missing.has(p));
    for (const p of tier1Targets) yield { kind: "searching", platform: p, displayName: platformDisplayName(p, urlmapBySiteName) };
    const tier1Raw = await tierOneIdMappings(artistId, missing, urlmapBySiteName);
    for (const c of tier1Raw) missing.delete(c.platform);
    for (const c of tier1Raw) {
        const profile = await validateCandidate(c, ctx);
        if (profile) { foundCount++; yield { kind: "found", profile }; }
    }
    for (const p of tier1Targets) yield { kind: "checked", platform: p, displayName: platformDisplayName(p, urlmapBySiteName) };

    // --- Tiers 2/3 both need a real name to search/ask about. A bare
    // platform ID (e.g. only `deezer` set) is useless as a search anchor on
    // its own — resolve the real name/image/fan count first. Skipped
    // entirely once tier 1 alone has satisfied everything missing.
    if (missing.size === 0 || pastBudget()) return;
    let enrichment: MusicPlatformArtist | null = null;
    try {
        enrichment = await musicPlatformData.getArtist(artist);
    } catch {
        enrichment = null;
    }
    const artistName = enrichment?.name?.trim() || artist.name?.trim() || null;
    if (!artistName) return;

    // --- Tier 2 — deterministic platform search APIs -----------------------
    if (!pastBudget()) {
        const tier2Targets = (["spotify", "deezer"] as const).filter(p => missing.has(p));
        for (const p of tier2Targets) yield { kind: "searching", platform: p, displayName: platformDisplayName(p, urlmapBySiteName) };
        for await (const [platform, candidate] of tierTwoPlatformSearchStream(artistName, missing)) {
            if (candidate) {
                missing.delete(candidate.platform);
                const profile = await validateCandidate(candidate, ctx);
                if (profile) { foundCount++; yield { kind: "found", profile }; }
            }
            yield { kind: "checked", platform, displayName: platformDisplayName(platform, urlmapBySiteName) };
        }
    }

    // --- Tier 3 — deterministic handle probing ------------------------------
    if (missing.size > 0 && !pastBudget()) {
        const tier3Targets = (Object.keys(HANDLE_BASED_PLATFORM_DOMAINS) as ProfileDisplayColumn[]).filter(p => missing.has(p));
        for (const p of tier3Targets) yield { kind: "searching", platform: p, displayName: platformDisplayName(p, urlmapBySiteName) };
        for await (const [platform, candidate] of tierThreeHandleProbeStream(artistName, record, missing, urlmapBySiteName)) {
            if (candidate) {
                missing.delete(candidate.platform);
                const profile = await validateCandidate(candidate, ctx);
                if (profile) { foundCount++; yield { kind: "found", profile }; }
            }
            yield { kind: "checked", platform, displayName: platformDisplayName(platform, urlmapBySiteName) };
        }
    }

    // --- Tier 4 — Gemini, kept ONLY as a last resort for whatever tier 3's
    // deterministic probing couldn't confirm, and only if the time budget
    // still allows it (per-platform, domain-scoped grounded search, parallel).
    if (missing.size > 0 && !pastBudget()) {
        const identityContext = buildIdentityContext(record, enrichment);
        const tier4Targets = (Object.keys(HANDLE_BASED_PLATFORM_DOMAINS) as ProfileDisplayColumn[]).filter(p => missing.has(p));
        for (const p of tier4Targets) yield { kind: "searching", platform: p, displayName: platformDisplayName(p, urlmapBySiteName) };
        for await (const [platform, candidate] of tierThreeGroundedSearchStream(artistName, identityContext, missing, urlmapBySiteName)) {
            if (candidate) {
                missing.delete(candidate.platform);
                const profile = await validateCandidate(candidate, ctx);
                if (profile) { foundCount++; yield { kind: "found", profile }; }
            }
            yield { kind: "checked", platform, displayName: platformDisplayName(platform, urlmapBySiteName) };
        }
    }

    console.log(`[profileDiscovery] artist=${artistId} name="${artist.name ?? artistName}" found=${foundCount} elapsedMs=${Date.now() - startedAt}`);
}

/** Array-returning wrapper over `discoverArtistProfilesStream` — kept for any
 *  caller that just wants the final list (a page reload/resume, or a future
 *  non-streaming consumer) rather than live events. The production onboarding
 *  path (`turnHandlers.ts`) consumes the generator directly for live
 *  progress/candidate frames; this wrapper runs the exact same underlying
 *  work, just drained to an array instead of surfaced as it lands. Bounded to
 *  ~`DISCOVERY_BUDGET_MS` end-to-end (belt-and-suspenders on top of the
 *  generator's own internal deadline check) and NEVER throws — any failure
 *  resolves to `[]`, leaving the `profiles` onboarding step exactly as it
 *  behaves without discovery. */
export async function discoverArtistProfiles(artistId: string): Promise<DiscoveredProfile[]> {
    try {
        return await Promise.race([
            (async () => {
                const results: DiscoveredProfile[] = [];
                for await (const event of discoverArtistProfilesStream(artistId)) {
                    if (event.kind === "found") results.push(event.profile);
                }
                return results;
            })(),
            new Promise<DiscoveredProfile[]>(resolve => setTimeout(() => resolve([]), DISCOVERY_BUDGET_MS)),
        ]);
    } catch (e) {
        console.error(`[profileDiscovery] discoverArtistProfiles failed for ${artistId}:`, e);
        return [];
    }
}
