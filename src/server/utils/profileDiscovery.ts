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
 *            and require POSITIVE evidence of the artist's NAME — never the
 *            handle itself, which is nearly always echoed inside a page's
 *            og:title (e.g. a stranger's Instagram bio titled "Peter
 *            Lyrøholm (@peterango)" contains the probed handle "peterango"
 *            and would satisfy a naive "title contains handle" check). See
 *            `stripHandleAndBoilerplate`/`runHandleProbe` for the exact
 *            rule: strip the handle and platform boilerplate out of the
 *            title first, cross-check whatever real name text remains, and
 *            treat "nothing meaningful remains" as a MISS, not a hit. An
 *            og:image with no usable title is trusted only for an already
 *            CONFIRMED handle (an existing link, or one confirmed on another
 *            platform this run) — never for a bare name-derived guess.
 *            Sub-second per probe and replaces what used to be a
 *            per-platform Gemini search (measured live: that shape timed out
 *            on 4 of 7 platforms and found ZERO candidates for an artist who
 *            genuinely has profiles on all of them — see the
 *            discovery-rebuild report).
 *   Tier 4 — a REAL web search (Tavily, via `webSearch.ts`), kept ONLY as a
 *            last resort for whatever tier 3's probing couldn't confirm and
 *            only if the time budget allows: one search per remaining
 *            platform, each restricted to that platform's own domain via
 *            `include_domains` — never one big open-web call asking about
 *            every platform at once. This replaces what used to be a
 *            per-platform GEMINI search: a grounded LLM deciding whether/
 *            what to search is not a search API — measured live, that shape
 *            timed out on most platforms and, when it did answer, confidently
 *            returned an unrelated stranger's profile (see the web-search
 *            report). Every search hit is a LEAD, not proof: each result
 *            first has to look like an actual profile URL (`looksLikeProfileUrl`
 *            — a search engine returns arbitrary pages, not just profiles,
 *            and `extractArtistId`'s regexes were never designed to tell the
 *            difference), then the resolved HANDLE has to echo the artist's
 *            name (`handleEchoesArtistName` — the primary discriminator; a
 *            title/snippet-only check is too weak for a same-surname
 *            stranger or a common-word artist name — see
 *            `resultPassesNameCheck` for the live-tested detail), before the
 *            surviving candidate runs the full `validateCandidate` gate
 *            pipeline below like every other tier.
 *
 * A search result (tier 4) is a lead a stranger's page can satisfy just as
 * easily as the real artist's, so every candidate it proposes is validated
 * before it's ever shown to an artist; see the numbered gates in
 * `validateCandidate` below. Tiers 1/2/3 are deterministic (DB read, search
 * API, or a direct HTTP probe) and never hallucinate/misattribute a URL, so
 * the OG-existence gate only re-applies to tier 4 — tier 3's own probe fetch
 * already IS that check, so it isn't repeated. Nothing here writes to the
 * database; discovery only PROPOSES, the existing `confirm_profiles` →
 * `extractArtistId` → `setArtistLink` path (unchanged) is what actually
 * saves an accepted link.
 *
 * Tier 4 also FEEDS BACK into tier 3's probing: any handle it confirms is
 * propagated through the exact same probe mechanism tier 3 uses internally
 * (see `propagateConfirmedHandles`) — so one successful search (say,
 * Instagram) can resolve X/TikTok/Facebook for free from the confirmed
 * handle, without a second search call per platform.
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
import { webSearch, type WebSearchResult } from "@/server/utils/webSearch";
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
    /**
     * We built this URL out of the artist's own name and a real page answered.
     *
     * That is the weakest finding this module produces, and it is the ONLY one
     * with no independent retrieval behind it: nothing linked the page to the
     * artist, we constructed the address from their name and something was
     * home. instagram.com/blackdavemk2 is titled "Black Dave MK2", so every
     * cross-check passes — and it is not the account Black Dave MK2 uses.
     *
     * It is still worth writing: for a cold-start artist a name-derived slug
     * is how most of their links are found at all (six of Pete Rango's seven).
     * What it must not do is OUTRANK a later, better-evidenced answer purely
     * by arriving first, which is what happened — the auto-build writes
     * discovery's guess, then the vault search skips the column under "already
     * have it" and its corroborated `blackdave.xyz` never lands.
     *
     * So the caller passes these columns to `searchAndPopulateVault`, which
     * treats them as still-open rather than answered.
     */
    provisional: boolean;
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
// sub-second HTTP probes run with a bounded concurrency, and tier 4 (a real
// web search, last resort only) is N single-platform search calls run in
// PARALLEL, each bounded by `webSearch.ts`'s own ~6s per-request timeout — the
// slowest of those (not their sum) bounds the tier, plus one more bounded
// probe round if tier 4 confirms a handle to propagate. Worst case is roughly
// tier1(<1s) + tier2(~1-2s) + tier3(a couple probe rounds, each
// ≤PROBE_CONCURRENCY-wide and individually sub-second) + tier4(~6s, only for
// whatever's still missing) + a propagate round (sub-second, probe-shaped) +
// a per-candidate preview fetch (≤4s, 8s worst case chained for Spotify — see
// linkPreview.ts) ≈ well under 15s. DISCOVERY_BUDGET_MS remains a hard
// backstop, checked between tiers inside the generator itself, so a
// pathological run (e.g. a hung DB connection) still can't blow the turn
// budget — it stops yielding instead.
//
// Raised 20s → 35s: real runs were hitting the backstop often enough that the
// same artist saw a different number of profiles from one run to the next,
// because tier 4 (the web-search last resort, the tier most likely to find the
// platforms tiers 1-3 missed) is also the tier most likely to be cut. Stopping
// early is silent by design — it just stops yielding — so a truncated search is
// indistinguishable from a thorough one that found less. 35s still leaves ~20s
// of the route's 55s deadline for buildProfilesPayload and the SSE plumbing.
const DISCOVERY_BUDGET_MS = 35_000;

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
    /** See `DiscoveredProfile.provisional`. Only tier 3's name-derived seed
     *  probes set this. */
    provisional?: boolean;
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

/** Platforms that block server-side OG scraping, where a MISS is not evidence
 *  the handle is absent, so probing would produce false negatives.
 *
 *  Measured 2026-08-21: tiktok.com returns no title and no image for ANY handle,
 *  including ones we know exist, so probing it can only produce false negatives.
 *  Because of that we cannot currently tell whether an artist HAS a TikTok —
 *  say that rather than reporting one as absent.
 *
 *  x.com was listed here, and re-measuring showed it now
 *  returns both og:title and og:image to our fetcher ("Pete Rango ... (@p3t3rango)
 *  on X", image present). While it was listed, X could never be found at all:
 *  probing skipped it because fetches were assumed useless, and tier 4 could not
 *  rescue it. Re-measure before adding a platform back. */
const PROBE_UNVERIFIABLE_PLATFORMS = new Set<ProfileDisplayColumn>(["tiktok"]);

/** Cap on simultaneous in-flight probe fetches — a polite-client bound so a
 *  large candidate set can't fire dozens of requests at third-party servers
 *  at once. */
const PROBE_CONCURRENCY = 8;

/** Cap on how many slugs get DERIVED from the artist's name — never
 *  combinatorially explode (a 5-word artist name still yields at most this
 *  many slugs, not one per permutation). */
const MAX_DERIVED_SLUGS = 4;

/** Query strings and fragments are never part of a handle. Search results carry
 *  tracking params (?hl=en, ?igsh=...), and extractArtistId captures the first
 *  path segment verbatim, so they otherwise end up inside the stored handle. */
export function stripUrlQuery(raw: string): string {
    // Deliberately a string split rather than a URL round-trip: `new
    // URL(x).toString()` NORMALISES as well as strips, and adds a trailing
    // slash to a bare domain. That turned Bandcamp's canonical
    // "<handle>.bandcamp.com" into "<handle>.bandcamp.com/" and stopped it
    // matching. Stripping must not reformat.
    return raw.split(/[?#]/)[0];
}

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

/** Platform-boilerplate fragments a real profile page's og:title commonly
 *  appends AFTER the person's own name (e.g. `"Pete Rango (@peterango) •
 *  Instagram photos and videos"`, `"peterango - Twitch"`). Stripped before
 *  the name cross-check below so this boilerplate — which is identical on
 *  EVERY profile on a platform, not just the real artist's — can never
 *  itself count as "evidence of the artist's name". Anchored to the end of
 *  the title (where platforms actually append it); order doesn't matter,
 *  each fragment is removed independently. */
const TITLE_BOILERPLATE_FRAGMENTS: RegExp[] = [
    /[•·]\s*instagram photos and videos\s*$/i,
    /-\s*twitch\s*$/i,
    /\|\s*spotify\s*$/i,
    /\bon soundcloud\s*$/i,
    /-\s*youtube\s*$/i,
    /\|\s*facebook\s*$/i,
];

/** Strips a probed HANDLE (bare `peterango`, `@peterango`, or `(@peterango)`)
 *  and known platform boilerplate out of an og:title, leaving whatever
 *  human-readable name text remains — the ONLY thing the name cross-check
 *  below is allowed to treat as evidence.
 *
 *  This exists because the handle is nearly always echoed inside the title
 *  ("Peter Lyrøholm (@peterango) • Instagram photos and videos" contains
 *  "peterango"), so comparing the artist name against the RAW title lets a
 *  probe "match" on the handle it already guessed rather than on any real
 *  proof of whose page it is — nearly every profile page on the internet
 *  satisfies that, including strangers'. Comparing against the residual
 *  after stripping is what makes this a real name cross-check instead of a
 *  tautology. */
export function stripHandleAndBoilerplate(title: string, handle: string): string {
    let s = title;
    if (handle) {
        const esc = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        s = s.replace(new RegExp(`\\(\\s*@${esc}\\s*\\)`, "gi"), " "); // "(@handle)"
        s = s.replace(new RegExp(`@${esc}\\b`, "gi"), " "); // "@handle"
        s = s.replace(new RegExp(`\\b${esc}\\b`, "gi"), " "); // bare "handle"
    }
    for (const fragment of TITLE_BOILERPLATE_FRAGMENTS) s = s.replace(fragment, " ");
    return s.replace(/\s+/g, " ").trim();
}

/** A probe "hit" is an og:image OR an og:title — but a title that clearly
 *  names someone else overrides an image and is still a MISS; this is the
 *  main defense against grabbing a stranger's handle. No title at all means
 *  no cross-check is possible, so an image alone is trusted (matches the
 *  measured live behavior: a fabricated handle returns neither image nor
 *  title, never a mismatched title alone).
 *
 *  Callers that have a HANDLE to cross-check against (every real probe —
 *  see `runHandleProbe`) must pass the STRIPPED residual (see
 *  `stripHandleAndBoilerplate`) as `preview.title`, not the raw title —
 *  otherwise the handle-echo problem above reappears. This function itself
 *  stays a plain, generic "does this preview look like a hit for
 *  `artistName`" predicate with no handle awareness, so its "image alone is
 *  trusted" branch is only ever correct when there was genuinely no title
 *  text to check in the first place. */
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
    /** Is this handle already known-good — an existing link already on the
     *  artist's row, or a handle CONFIRMED on another platform earlier this
     *  run (the propagate pass below)? Or is it a plain name-derived GUESS?
     *  Gates whether an og:image alone (no title text to cross-check) is
     *  trusted as a hit — see `runHandleProbe`. Propagating a known-good
     *  handle is much stronger evidence than probing a guessed slug, so the
     *  two must not be trusted the same way. */
    confirmed: boolean;
}

/** Probes one (platform, handle) URL via the existing `fetchLinkPreview`
 *  helper (already uses the right UA and handles Spotify oEmbed) and reports
 *  a confirmed hit, or `null` on a miss/failure — `fetchLinkPreview` itself
 *  never throws and already carries its own ~4s per-fetch timeout.
 *
 *  A hit requires POSITIVE evidence of the artist's name, independent of the
 *  handle: strip the probed handle and platform boilerplate out of the
 *  og:title (see `stripHandleAndBoilerplate`) and cross-check whatever real
 *  name text remains. If nothing meaningful survives stripping — "peterango
 *  - Twitch", a title-less page — that is a MISS, not a hit; absence of
 *  evidence must never count as evidence. The one exception: an og:image
 *  with no usable title text at all is still trusted, but ONLY for a
 *  `confirmed` handle (see `HandleProbe.confirmed` above) — propagation of a
 *  known-good handle is strong enough evidence on its own, a guessed slug is
 *  not. */
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
        const residual = preview.title ? stripHandleAndBoilerplate(preview.title, probe.handle) : "";
        // A THROTTLED PLATFORM LOOKS EXACTLY LIKE AN ABSENT PROFILE, and only
        // one of those is true. Probe Instagram hard enough and it stops
        // serving profile metadata and returns a login wall titled plainly
        // "Instagram", with an og:image, for every handle including real ones.
        // The name cross-check below correctly refuses it — "Instagram" is not
        // "Black Dave MK2" — so nothing wrong is ever written. What it cannot
        // do is tell the difference between "this artist has no Instagram" and
        // "we were rate-limited", and it reports both as the former.
        //
        // Measured 2026-08-29: after one benchmark run's probes, every
        // instagram.com/<handle> fetch from this machine came back titled
        // "Instagram". The two cases that run LAST scored zero Instagram
        // findings and the three before them scored theirs — a result that
        // reads as a recall problem and is a rate limit.
        //
        // Logged, not acted on. Suppressing the miss would mean claiming to
        // know something we do not, and trusting the image alone is how a
        // login wall becomes a confirmed profile. This just makes a run that
        // was throttled distinguishable from a run that found nothing.
        // AND an og:image, which is what separates a wall from a 404. Both serve
        // the platform's own name as the title, and they mean opposite things:
        //
        //   twitch.tv/<handle-that-does-not-exist> -> "Twitch", NO image
        //   instagram.com/<real handle>, throttled  -> "Instagram", image
        //
        // The first version of this warned on the title alone and fired four
        // times in one Pharaoh Sistare run for Twitch handles that genuinely
        // do not exist — noise in the exact log line added to make a real
        // signal findable. A platform that rendered a real page and withheld
        // the profile is the case worth flagging; one that said "no such
        // handle" is a plain miss and always was.
        const platformName = urlmapBySiteName.get(probe.platform)?.cardPlatformName ?? probe.platform;
        if (residual && preview.imageUrl && normalizeForCompare(residual) === normalizeForCompare(platformName)) {
            console.warn(`[profileDiscovery] ${probe.platform} served its own name as the page title for @${probe.handle} — a wall or a rate limit, not evidence this handle is absent`);
        }
        if (residual) {
            // Real name text survived stripping — cross-check IT against the
            // artist name (never the raw title, which is nearly always
            // "satisfied" by the handle we ourselves guessed).
            if (!isProbeHit({ imageUrl: preview.imageUrl, title: residual }, artistName)) return null;
            return { url, preview };
        }
        // No usable title text (none at all, or only the handle/boilerplate
        // we just stripped out) — an image alone is evidence ONLY when the
        // handle is already known-good.
        if (probe.confirmed && preview.imageUrl) return { url, preview };
        return null;
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
        // The one place provisional is set. `confirmed: false` means the handle
        // came from `deriveNameSlugs` — a guess with nothing behind it but the
        // artist's name. An existing link on their row, or a handle this run
        // already confirmed on another platform, is not a guess.
        provisional: !probe.confirmed,
        platform: probe.platform,
        url: hit.url,
        reasoning: `Handle probe: ${hit.preview.title ? `og:title matched "${artistName}"` : "og:image resolved"} for @${probe.handle}` +
            (propagated ? " (propagated from a handle confirmed on another platform)" : ` (${probe.source})`),
        preview: hit.preview,
    });

    // --- Seed pass: existing handle-shaped links + name-derived slugs -----
    // `confirmed: true` for an existing link already on the artist's row (a
    // real anchor); `confirmed: false` for a name-derived GUESS — this is
    // the distinction `runHandleProbe` uses to decide whether an og:image
    // alone (no title) is trusted.
    const seenHandles = new Set<string>();
    const seedHandles: { handle: string; source: string; confirmed: boolean }[] = [];
    for (const col of handlePlatforms) {
        const raw = record[col];
        if (typeof raw !== "string" || !raw) continue;
        const handle = normalizeHandle(raw);
        if (!handle || seenHandles.has(handle)) continue;
        seenHandles.add(handle);
        seedHandles.push({ handle, source: `existing ${col} handle`, confirmed: true });
    }
    for (const slug of deriveNameSlugs(artistName)) {
        if (seenHandles.has(slug)) continue;
        seenHandles.add(slug);
        seedHandles.push({ handle: slug, source: "derived from artist name", confirmed: false });
    }

    const seedJobs: HandleProbe[] = [];
    for (const { handle, source, confirmed } of seedHandles) {
        for (const platform of targets) {
            const key = `${platform}|${handle}`;
            if (tried.has(key) || budget <= 0) continue;
            tried.add(key);
            budget--;
            seedJobs.push({ platform, handle, source, confirmed });
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
    // Every handle here already cleared a full probe (title-matched, or
    // image-only on an already-confirmed handle) on ANOTHER platform this
    // run, so it's `confirmed: true` here too — propagation of a known-good
    // handle is strong evidence on its own.
    const stillMissing = targets.filter(p => !resolved.has(p));
    if (stillMissing.length > 0 && newlyConfirmedHandles.size > 0 && budget > 0) {
        const propagationJobs: HandleProbe[] = [];
        for (const handle of newlyConfirmedHandles) {
            for (const platform of stillMissing) {
                const key = `${platform}|${handle}`;
                if (tried.has(key) || budget <= 0) continue;
                tried.add(key);
                budget--;
                propagationJobs.push({ platform, handle, source: "propagated", confirmed: true });
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

// --- Tier 4: a real web search, kept ONLY as a last resort -----------------
// Whatever tier 3's deterministic handle probing couldn't confirm falls
// through here — one Tavily search PER remaining platform, each restricted
// to that platform's own domain via `include_domains` — never one big
// open-web call asking about every platform at once, and never a model
// deciding whether/what to search (the retired Gemini shape this replaces —
// see the module docblock and the web-search report). Run in parallel:
// concurrency is inherently bounded by PROFILE_DISPLAY_COLUMNS' fixed, small
// size (at most 8 candidates here), so the slowest single search (capped by
// `webSearch.ts`'s own ~6s request timeout) bounds the whole tier, not their
// sum.

const WEB_SEARCH_MAX_RESULTS = 5;

/** The search query for a platform: the artist's resolved name plus whatever
 *  disambiguating context is actually available. `MusicPlatformArtist` has
 *  no location field, so — unlike a hand-written research prompt — this
 *  can't include one; genre (when known) plus the literal words "music
 *  artist" is what's available to disambiguate a same-named stranger. */
function buildTierFourQuery(artistName: string, enrichment: MusicPlatformArtist | null): string {
    const parts = [artistName];
    if (enrichment?.genres?.[0]) parts.push(enrichment.genres[0]);
    parts.push("music artist");
    return parts.join(" ");
}

// Tiers 1-3's candidate URLs are always CONSTRUCTED by our own code (a
// provider's own canonical `profileUrl`, or `urlmap.appStringFormat` filled
// in with a handle) — so `extractArtistId`'s DB-driven regexes, which
// capture "the first path segment" as if it were always a handle, never had
// to distinguish a profile page from any other page on the domain. Tier 4 is
// the first tier to feed it an ARBITRARY page a search engine actually
// returned, and live testing against the real Tavily API (see the
// web-search report) surfaced exactly that gap: `instagram.com/reel/<id>`,
// `youtube.com/watch?v=<id>`, and `twitch.tv/<handle>/about` all satisfy
// those regexes, producing a garbage "handle" (`reel`, `watch?v=<id>`,
// `<handle>`+wrong-page) that would write straight into `artists` if
// accepted. `looksLikeProfileUrl` is the fix: a POSITIVE shape requirement
// (not a blocklist of known-bad paths) applied BEFORE `extractArtistId` ever
// runs. Facebook's regex also legitimately supports `profile.php?id=N` and
// `people/<slug>/<id>` — both rejected by this rule; tier 4 accepts losing
// numeric-ID Facebook matches rather than special-case a second URL shape
// (see the report for the reasoning).
function looksLikeProfileUrl(rawUrl: string): boolean {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return false;
    }
    if (url.search || url.hash) return false; // e.g. youtube.com/watch?v=...
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length > 1) return false; // e.g. instagram.com/reel/<id>, twitch.tv/<handle>/about
    // Zero path segments (a bare `https://<domain>`) is allowed, not just
    // exactly-one: Bandcamp's canonical artist URL IS the domain root
    // (`https://<handle>.bandcamp.com`, the subdomain — not a path segment —
    // is the handle; see `isReservedBandcampSubdomain` below). Every OTHER
    // platform's `extractArtistId` regex requires a path capture, so a bare
    // `https://x.com`/`https://instagram.com` still fails to resolve
    // downstream — this doesn't loosen anything for them.
    if (segments.length === 0) return true;
    return segments[0].replace(/^@/, "").length > 0;
}

/** Bandcamp's regex captures ANY subdomain as a "handle" (`<sub>.bandcamp.com`
 *  IS the real URL shape for an artist's own store), which also matches
 *  Bandcamp's own editorial/official subdomains — `blog.bandcamp.com`
 *  surfaced live for an unrelated artist. `looksLikeProfileUrl` can't catch
 *  this (a subdomain isn't a path segment), so this is the one
 *  platform-specific carve-out: a short, well-known reserved-subdomain list,
 *  confined to bandcamp only — not a general blocklist pattern. */
const BANDCAMP_RESERVED_SUBDOMAINS = new Set(["blog", "daily", "help", "support", "get"]);

function isReservedBandcampSubdomain(rawUrl: string): boolean {
    try {
        return BANDCAMP_RESERVED_SUBDOMAINS.has(new URL(rawUrl).hostname.toLowerCase().split(".")[0]);
    } catch {
        return false;
    }
}

/** Best-effort leetspeak/number-substitution normalization layered on top of
 *  `normalizeForCompare` below — common social handles substitute a digit
 *  for a visually similar letter (`p3t3rango` for "Pete Rango")
 *  SPECIFICALLY because the plain name is already taken elsewhere. Without
 *  this, `handleEchoesArtistName` would reject exactly the real-world
 *  handle shape this feature exists to find (see the module docblock's
 *  "instagram.com/sonsofsilverband" motivating failure — the opposite
 *  problem: a handle with ZERO relation to the artist's name). */
function deleetHandle(s: string): string {
    return s.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
}

/** The PRIMARY identity signal for a tier-4 candidate: does the extracted
 *  HANDLE itself echo the artist's name (loose containment, either
 *  direction, tolerating leetspeak)? Live testing turned up same-surname
 *  strangers (artist on file: "shumov"; search hit: an unrelated "Ivan
 *  Shumov" whose handle "inoise" carries zero relation to either name) that
 *  a title-only check does NOT catch — "shumov" is a genuine substring of
 *  "Ivan Shumov", so the title itself is not contradictory evidence, only
 *  the handle is. This is the check that rejects those. It is deliberately
 *  a HARD requirement (not one-of-two-signals) — see `resultPassesNameCheck`
 *  for why title evidence alone can't substitute. */
function handleEchoesArtistName(handle: string, artistName: string): boolean {
    const normArtist = normalizeForCompare(artistName);
    if (!normArtist) return false;
    for (const candidate of [handle, deleetHandle(handle)]) {
        const normHandle = normalizeForCompare(candidate);
        if (normHandle && (normHandle.includes(normArtist) || normArtist.includes(normHandle))) return true;
    }
    return false;
}

/** The name cross-check every tier-4 search RESULT must clear before it's
 *  even considered a candidate:
 *   (1) `looksLikeProfileUrl` — the URL has to look like a profile page in
 *       the first place (see above).
 *   (2) `extractArtistId` resolves it, for the PLATFORM this search was
 *       scoped to (never a different platform's URL slipping through).
 *   (3) `handleEchoesArtistName` — the resolved HANDLE must echo the
 *       artist's name. This is the primary discriminator (see above) and is
 *       REQUIRED, not optional.
 *   (4) if the search result's TITLE (never the snippet — ordinary prose
 *       can innocently contain a common-word artist name, e.g. an artist
 *       literally named "Whilst") carries real name text after stripping
 *       the handle/boilerplate (`stripHandleAndBoilerplate`, the same
 *       helper tier 3's own probing uses), that text must not contradict
 *       the artist's name. No usable title text — absent, or a stylized/
 *       emoji display name that normalizes to nothing — is NOT a failure:
 *       (3) is already strong evidence on its own, mirroring tier 3's
 *       "confirmed handle -> image alone trusted" exception.
 *  A bare search result is a LEAD, never proof — this is what stops a
 *  plausible-but-wrong hit from ever reaching `validateCandidate`. */
async function resultPassesNameCheck(
    result: WebSearchResult,
    platform: ProfileDisplayColumn,
    artistName: string,
): Promise<boolean> {
    const url = stripUrlQuery(result.url);
    if (!looksLikeProfileUrl(url)) return false;
    if (platform === "bandcamp" && isReservedBandcampSubdomain(url)) return false;

    let extracted;
    try {
        extracted = await extractArtistId(url);
    } catch {
        return false;
    }
    if (!extracted?.siteName || !extracted?.id || extracted.siteName !== platform) return false;
    if (!handleEchoesArtistName(extracted.id, artistName)) return false;

    const residual = result.title ? stripHandleAndBoilerplate(result.title, extracted.id) : "";
    if (normalizeForCompare(residual) && !titleMatchesArtist(residual, artistName)) return false;

    return true;
}

/** One Tavily search PER remaining platform, all kicked off together but
 *  yielded as EACH individual search resolves (via `settleAsCompleted`) —
 *  never a `Promise.all` barrier that lets the slowest platform hold up the
 *  rest. Each search can return several results; every result that passes
 *  `resultPassesNameCheck` becomes a candidate, IN RANK ORDER — the caller
 *  tries them in that order and stops at the first one that also clears
 *  `validateCandidate`'s gates (a top search hit is often a fan page or the
 *  wrong same-named artist, so trying only the first raw result would
 *  under-perform for reasons that look like the search API failing). Yields
 *  `[platform, candidate[]]` (possibly `[]`) for every targeted platform so
 *  the caller can emit a "checked" signal even when nothing came back.
 *  Never throws — a `webSearch` failure or an individual result's failed
 *  name check degrades to no candidate for that platform only. */
async function* tierFourWebSearchStream(
    artistName: string,
    enrichment: MusicPlatformArtist | null,
    missing: Set<ProfileDisplayColumn>,
): AsyncGenerator<[ProfileDisplayColumn, TierCandidate[] | null]> {
    const platforms = (Object.keys(HANDLE_BASED_PLATFORM_DOMAINS) as ProfileDisplayColumn[]).filter(p => missing.has(p));
    if (platforms.length === 0) return;

    const query = buildTierFourQuery(artistName, enrichment);

    const jobs: [ProfileDisplayColumn, Promise<TierCandidate[]>][] = platforms.map(platform => [platform, (async (): Promise<TierCandidate[]> => {
        const domain = HANDLE_BASED_PLATFORM_DOMAINS[platform]!;
        try {
            const results = await webSearch(query, { includeDomains: [domain], maxResults: WEB_SEARCH_MAX_RESULTS });
            const out: TierCandidate[] = [];
            for (const result of results) {
                if (typeof result?.url !== "string" || !result.url.startsWith("https://")) continue;
                if (!(await resultPassesNameCheck(result, platform, artistName))) continue;
                out.push({
                    tier: 4,
                    platform,
                    url: result.url,
                    reasoning: `Web search hit on ${domain}: "${result.title || result.snippet}"`,
                });
            }
            return out;
        } catch (e) {
            console.error(`[profileDiscovery] tier4 (${platform}) web search failed:`, e);
            return [];
        }
    })()]);

    yield* settleAsCompleted(jobs);
}

/** Probes a set of already-CONFIRMED handles against a set of still-missing
 *  target platforms — the same "propagate" idea tier 3's own two-pass probe
 *  uses internally (see `tierThreeHandleProbeStream`), exposed standalone so
 *  tier 4 (web search) can feed a handle IT confirms back into probing too:
 *  if search confirms Instagram `p3t3rango`, this is what lets X/TikTok/
 *  Facebook resolve from that handle without a second search call. Every
 *  probed handle here is `confirmed: true` — propagation of a known-good
 *  handle (from ANY tier) is strong evidence on its own, the same rule
 *  `runHandleProbe` already applies to tier 3's own propagate pass. Yielded
 *  candidates are tagged `tier: 3` (a probe result, not a search result) so
 *  `validateCandidate`'s gate (e) — which exists to catch tier 4's
 *  hallucination-adjacent risk — correctly does not re-apply to them; the
 *  probe fetch that confirmed them already IS that check. Note: X is in
 *  `PROBE_UNVERIFIABLE_PLATFORMS` (blocks server-side OG scraping — see
 *  above), so propagation can never confirm a handle there either; that
 *  limitation is inherited unchanged, not loosened. */
async function* propagateConfirmedHandles(
    handles: Set<string>,
    targets: ProfileDisplayColumn[],
    urlmapBySiteName: Map<string, UrlmapPresentationRow>,
    artistName: string,
): AsyncGenerator<[ProfileDisplayColumn, TierCandidate | null]> {
    const probeTargets = targets.filter(p => !PROBE_UNVERIFIABLE_PLATFORMS.has(p));
    if (probeTargets.length === 0 || handles.size === 0) return;

    const resolved = new Set<ProfileDisplayColumn>();
    const jobs: HandleProbe[] = [];
    for (const handle of handles) {
        for (const platform of probeTargets) {
            jobs.push({ platform, handle, source: "propagated from web search", confirmed: true });
        }
    }

    for await (const [probe, hit] of mapWithConcurrency(jobs, PROBE_CONCURRENCY, p => runHandleProbe(p, urlmapBySiteName, artistName))) {
        if (!hit || resolved.has(probe.platform)) continue;
        resolved.add(probe.platform);
        yield [probe.platform, {
            tier: 3,
            platform: probe.platform,
            url: hit.url,
            reasoning: `Handle probe: ${hit.preview.title ? `og:title matched "${artistName}"` : "og:image resolved"} for @${probe.handle} (propagated from a handle confirmed via web search)`,
            preview: hit.preview,
        }];
    }
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
        // Strip the query string first. A search result is a real URL with real
        // tracking params, and extractArtistId captures the first path segment
        // verbatim — so instagram.com/p3t3rango?hl=en yields the handle
        // "p3t3rango?hl=en", which then fails to round-trip and would be stored
        // as the artist's handle if it did.
        extracted = await extractArtistId(stripUrlQuery(candidate.url));
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
        provisional: candidate.provisional ?? false,
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

    // --- Tier 4 — a real web search, kept ONLY as a last resort for whatever
    // tier 3's deterministic probing couldn't confirm, and only if the time
    // budget still allows it (per-platform, domain-scoped, parallel).
    if (missing.size > 0 && !pastBudget()) {
        const tier4Targets = (Object.keys(HANDLE_BASED_PLATFORM_DOMAINS) as ProfileDisplayColumn[]).filter(p => missing.has(p));
        for (const p of tier4Targets) yield { kind: "searching", platform: p, displayName: platformDisplayName(p, urlmapBySiteName) };
        const confirmedHandles = new Set<string>();
        for await (const [platform, candidates] of tierFourWebSearchStream(artistName, enrichment, missing)) {
            for (const candidate of candidates ?? []) {
                const profile = await validateCandidate(candidate, ctx);
                if (profile) {
                    missing.delete(candidate.platform);
                    // Facebook's extractArtistId regex can capture a leading
                    // "@" verbatim (kept as-is in profile.value for storage/
                    // display, matching existing extractArtistId behavior —
                    // out of scope to change here); normalize it away before
                    // it enters the propagation set so it doesn't waste a
                    // probe on "instagram.com/@Handle" instead of the real
                    // "instagram.com/Handle".
                    confirmedHandles.add(normalizeHandle(profile.value));
                    foundCount++;
                    yield { kind: "found", profile };
                    break; // first result to clear every gate wins — don't try the rest for this platform
                }
            }
            yield { kind: "checked", platform, displayName: platformDisplayName(platform, urlmapBySiteName) };
        }

        // --- Feed back: a handle CONFIRMED by search propagates through the
        // probe tier exactly like a tier-3-confirmed handle does (see
        // `propagateConfirmedHandles`) — this is what lets one successful
        // search (say, Instagram) resolve X/TikTok/Facebook for free, from
        // the confirmed handle, without a second search call per platform.
        if (missing.size > 0 && confirmedHandles.size > 0 && !pastBudget()) {
            const propagateTargets = (Object.keys(HANDLE_BASED_PLATFORM_DOMAINS) as ProfileDisplayColumn[]).filter(p => missing.has(p));
            for (const p of propagateTargets) yield { kind: "searching", platform: p, displayName: platformDisplayName(p, urlmapBySiteName) };
            for await (const [, candidate] of propagateConfirmedHandles(confirmedHandles, propagateTargets, urlmapBySiteName, artistName)) {
                if (candidate) {
                    missing.delete(candidate.platform);
                    const profile = await validateCandidate(candidate, ctx);
                    if (profile) { foundCount++; yield { kind: "found", profile }; }
                }
            }
            for (const p of propagateTargets) yield { kind: "checked", platform: p, displayName: platformDisplayName(p, urlmapBySiteName) };
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
