/**
 * Post-claim onboarding: pulls an artist's Instagram feed via Apify and
 * upserts it into `artist_social_posts`. This is a BACKGROUND job — a
 * 200-post run takes ~1-5 minutes (see apify-validation-findings.md) — and
 * must never be awaited inside a chat turn.
 *
 * Correctness rule (product-owner-caught, see design doc): a scraped feed
 * includes posts authored by OTHER people where the artist is a
 * collaborator (tagged / co-authored). `mapApifyPost` is the single place
 * that decides `ownerUsername` / `isOwnPost` — never attribute a foreign
 * owner's caption to the artist. Every downstream consumer (socialSignals,
 * questionGenerator) trusts `isOwnPost` rather than re-deriving it.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/drizzle";
import { artistSocialPosts, artists } from "@/server/db/schema";
import type { SocialPostRow } from "@/server/utils/socialSignals";
import { APIFY_API_TOKEN } from "@/env";
import { extractCaptionCredits, sweepSilentCaptions } from "@/server/utils/socialCredits";
import { replaceSocialCredits, appendSocialCredits, claimedSourceUrls } from "@/server/utils/queries/socialCreditQueries";
import { forgetGroundedQuestions } from "@/server/utils/questionGenerator";

const APIFY_RUN_SYNC_URL = "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";
const DEFAULT_LIMIT = 200;
/** Hard ceiling regardless of what a caller asks for — apify/instagram-scraper
 *  bills ~$2.70/1,000 results; this caps a single ingest call's worst case. */
const MAX_LIMIT = 300;
/** A 200-post scrape has been observed taking up to several minutes. */
const APIFY_FETCH_TIMEOUT_MS = 8 * 60 * 1000;

export interface IngestResult {
    ingested: number;
    ownPosts: number;
    collabPosts: number;
}

const EMPTY_RESULT: IngestResult = { ingested: 0, ownPosts: 0, collabPosts: 0 };

/** Mirrors the `artist_social_posts` insert shape (see schema.ts). Exported
 *  so scripts/tests can construct rows without depending on Drizzle's
 *  inferred insert type. */
export interface SocialPostInsert {
    artistId: string;
    platform: string;
    platformPostId: string;
    ownerUsername: string;
    isOwnPost: boolean;
    caption: string | null;
    url: string;
    postedAt: string | null;
    likeCount: number | null;
    commentCount: number | null;
    playCount: number | null;
    hashtags: string[];
    mentions: string[];
    coauthors: string[];
    musicTitle: string | null;
    musicArtist: string | null;
    raw: unknown;
}

interface ApifyTaggedUser {
    username?: unknown;
}

interface ApifyMusicInfo {
    artist_name?: unknown;
    song_name?: unknown;
    uses_original_audio?: unknown;
}

interface ApifyPost {
    id?: unknown;
    url?: unknown;
    ownerUsername?: unknown;
    caption?: unknown;
    hashtags?: unknown;
    mentions?: unknown;
    taggedUsers?: unknown;
    coauthorProducers?: unknown;
    likesCount?: unknown;
    commentsCount?: unknown;
    videoPlayCount?: unknown;
    timestamp?: unknown;
    musicInfo?: unknown;
    error?: unknown;
}

function norm(handle: string): string {
    return handle.trim().toLowerCase().replace(/^@/, "");
}

/** Compares a DISPLAY NAME against a HANDLE, which `norm` cannot do: it keeps
 *  spaces and punctuation, so "Pharaoh Sistare" never equals "pharaohsistare".
 *  Strips everything that isn't alphanumeric so the two forms of the same
 *  identity collapse together. Handle-to-handle comparisons should keep using
 *  `norm` — this is deliberately lossy. */
function normLoose(value: string): string {
    return value.trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function usernamesFrom(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const entry of value as ApifyTaggedUser[]) {
        const u = entry && typeof entry === "object" ? entry.username : undefined;
        if (typeof u === "string" && u.length > 0) out.push(u);
    }
    return out;
}

/** Dedupe by normalized handle, drop the artist's own handle (a coauthor or
 *  tagged-user list can legitimately include the artist themselves). */
function dedupeExcludingSelf(handles: string[], selfNorm: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of handles) {
        const key = norm(h);
        if (!key || key === selfNorm || seen.has(key)) continue;
        seen.add(key);
        out.push(h.trim().replace(/^@/, ""));
    }
    return out;
}

/** musicInfo is noisy: most video posts carry it, but it's frequently "the
 *  artist's own original audio" (uninteresting) rather than a real track
 *  credit. Only keep it when it looks like a genuine song reference. */
function extractMusic(raw: ApifyPost, ownerUsername: string, selfNorm: string, realArtistName?: string): { musicTitle: string | null; musicArtist: string | null } {
    const info = raw.musicInfo as ApifyMusicInfo | undefined;
    if (!info || typeof info !== "object") return { musicTitle: null, musicArtist: null };

    const songName = typeof info.song_name === "string" ? info.song_name.trim() : "";
    const artistName = typeof info.artist_name === "string" ? info.artist_name.trim() : "";
    if (!songName || !artistName) return { musicTitle: null, musicArtist: null };
    if (info.uses_original_audio === true) return { musicTitle: null, musicArtist: null };
    if (songName.toLowerCase() === "original audio") return { musicTitle: null, musicArtist: null };
    // The music "artist" is the poster themselves — not a real third-party
    // credit. Instagram reports `artist_name` as a DISPLAY NAME ("Pharaoh
    // Sistare") while ownerUsername is a HANDLE ("pharaohsistare"), so this
    // must compare loosely; `norm` alone keeps the space and never matches.
    //
    // That mismatch is why a real artist was asked "how did that collaboration
    // and remix come about?" about a track he had no part in — the audio
    // credit was his own name, we kept it as a third-party track reference,
    // and the question generator faithfully asked about the collaboration it
    // implied. See docs/rnd/research/2026-08-21-artist-test-pharaoh.md.
    //
    // When the credited artist IS the poster we cannot tell "their own release"
    // from "Instagram mislabelled the audio", so dropping it is the safe read —
    // which was always this guard's intent.
    // Compare against the artist's REAL NAME first, not just their handle. A
    // handle is not a name: "Black Dave" posts as @worstgeneration, "Pete
    // Rango" as @p3t3rango. Matching only on the handle would keep working for
    // artists whose handle happens to be their name with the spaces removed
    // and silently fail for everyone else — the same shape of near-miss that
    // caused this bug in the first place.
    const credited = normLoose(artistName);
    const isSelfCredit =
        credited === normLoose(selfNorm)
        || credited === normLoose(ownerUsername)
        || (!!realArtistName && credited === normLoose(realArtistName));
    if (isSelfCredit) {
        return { musicTitle: null, musicArtist: null };
    }

    return { musicTitle: songName, musicArtist: artistName };
}

/**
 * Maps one raw Apify dataset item to an insertable row, or `null` if the
 * item isn't a real post (Apify datasets can contain error placeholders for
 * posts it failed to fetch — those lack `id`/`url`/`ownerUsername`).
 */
export function mapApifyPost(rawItem: unknown, artistId: string, handle: string, artistName?: string): SocialPostInsert | null {
    if (!rawItem || typeof rawItem !== "object") return null;
    const raw = rawItem as ApifyPost;
    if (raw.error) return null;

    const id = raw.id;
    const url = raw.url;
    const ownerUsername = raw.ownerUsername;
    if (typeof id !== "string" && typeof id !== "number") return null;
    if (typeof url !== "string" || !url) return null;
    if (typeof ownerUsername !== "string" || !ownerUsername) return null;

    const selfNorm = norm(handle);
    const isOwnPost = norm(ownerUsername) === selfNorm;

    const coauthors = dedupeExcludingSelf(usernamesFrom(raw.coauthorProducers), selfNorm);
    const mentions = dedupeExcludingSelf(
        [...stringArray(raw.mentions), ...usernamesFrom(raw.taggedUsers)],
        selfNorm,
    );
    const { musicTitle, musicArtist } = extractMusic(raw, ownerUsername, selfNorm, artistName);

    const likeCount = typeof raw.likesCount === "number" ? raw.likesCount : null;
    const commentCount = typeof raw.commentsCount === "number" ? raw.commentsCount : null;
    const playCount = typeof raw.videoPlayCount === "number" ? raw.videoPlayCount : null;
    const postedAt = typeof raw.timestamp === "string" ? raw.timestamp : null;
    const caption = typeof raw.caption === "string" ? raw.caption : null;

    return {
        artistId,
        platform: "instagram",
        platformPostId: String(id),
        ownerUsername,
        isOwnPost,
        caption,
        url,
        postedAt,
        likeCount,
        commentCount,
        playCount,
        hashtags: stringArray(raw.hashtags),
        mentions,
        coauthors,
        musicTitle,
        musicArtist,
        raw: rawItem,
    };
}

/** Upserts one mapped row. Exported so the dev script can ingest from a
 *  local file (bypassing Apify) through the exact same write path. */
export async function upsertSocialPost(row: SocialPostInsert): Promise<void> {
    await db
        .insert(artistSocialPosts)
        .values(row)
        .onConflictDoUpdate({
            target: [artistSocialPosts.artistId, artistSocialPosts.platform, artistSocialPosts.platformPostId],
            set: {
                ownerUsername: row.ownerUsername,
                isOwnPost: row.isOwnPost,
                caption: row.caption,
                url: row.url,
                postedAt: row.postedAt,
                likeCount: row.likeCount,
                commentCount: row.commentCount,
                playCount: row.playCount,
                hashtags: row.hashtags,
                mentions: row.mentions,
                coauthors: row.coauthors,
                musicTitle: row.musicTitle,
                musicArtist: row.musicArtist,
                raw: row.raw,
            },
        });
}

async function upsertMappedRows(rows: SocialPostInsert[]): Promise<IngestResult> {
    let ingested = 0, ownPosts = 0, collabPosts = 0;
    for (const row of rows) {
        await upsertSocialPost(row);
        ingested += 1;
        if (row.isOwnPost) ownPosts += 1; else collabPosts += 1;
    }
    return { ingested, ownPosts, collabPosts };
}

/**
 * Ingests up to `opts.limit` (default 200, hard-capped at 300) recent
 * Instagram posts for `handle` into `artist_social_posts`, scoped to
 * `artistId`. Never throws — returns zero counts and logs on any failure,
 * so a caller can fire-and-forget this from a background job without a
 * try/catch. Returns immediately if APIFY_API_TOKEN is unset.
 */
export async function ingestInstagramPosts(
    artistId: string,
    handle: string,
    opts?: { limit?: number },
): Promise<IngestResult> {
    if (!APIFY_API_TOKEN) return EMPTY_RESULT;
    if (!artistId || !handle) return EMPTY_RESULT;

    const limit = Math.min(Math.max(1, opts?.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const profileUrl = `https://www.instagram.com/${handle.trim().replace(/^@/, "")}/`;

    try {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), APIFY_FETCH_TIMEOUT_MS);
        let items: unknown;
        try {
            const res = await fetch(`${APIFY_RUN_SYNC_URL}?token=${encodeURIComponent(APIFY_API_TOKEN)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    directUrls: [profileUrl],
                    resultsType: "posts",
                    resultsLimit: limit,
                    addParentData: false,
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                console.error(`[ingestInstagramPosts] Apify request failed: ${res.status} ${res.statusText}`);
                return EMPTY_RESULT;
            }
            items = await res.json();
        } finally {
            clearTimeout(timeoutHandle);
        }

        if (!Array.isArray(items)) {
            console.error("[ingestInstagramPosts] Unexpected Apify response shape (not an array)");
            return EMPTY_RESULT;
        }

        const artistName = await getArtistNameById(artistId);
        const rows = items
            .map(item => mapApifyPost(item, artistId, handle, artistName))
            .filter((r): r is SocialPostInsert => r !== null);

        return await upsertMappedRows(rows);
    } catch (e) {
        console.error("[ingestInstagramPosts] Error:", e);
        return EMPTY_RESULT;
    }
}

/** Reads back an artist's stored posts in the shape `socialSignals.ts` pure
 *  functions expect. Never throws — returns [] and logs on failure, matching
 *  the rest of this module's degrade-gracefully contract. */
export async function getSocialPostsForArtist(artistId: string): Promise<SocialPostRow[]> {
    try {
        const rows = await db.query.artistSocialPosts.findMany({
            where: eq(artistSocialPosts.artistId, artistId),
        });
        return rows.map(r => ({
            platform: r.platform,
            platformPostId: r.platformPostId,
            ownerUsername: r.ownerUsername,
            isOwnPost: r.isOwnPost,
            caption: r.caption,
            url: r.url,
            postedAt: r.postedAt ?? "",
            likeCount: r.likeCount,
            commentCount: r.commentCount,
            playCount: r.playCount,
            hashtags: r.hashtags ?? [],
            mentions: r.mentions ?? [],
            coauthors: r.coauthors ?? [],
            musicTitle: r.musicTitle,
            musicArtist: r.musicArtist,
        }));
    } catch (e) {
        console.error("[getSocialPostsForArtist] Error:", e);
        return [];
    }
}

/** Ingests already-fetched Apify dataset items (e.g. from a local JSON file)
 *  through the identical mapping + upsert path as a live run. Used by
 *  scripts/ingest-social.sh's --from-file mode so question-quality
 *  iteration doesn't re-pay for an Apify run every time. Never throws. */
export async function ingestInstagramPostsFromItems(
    artistId: string,
    handle: string,
    items: unknown[],
): Promise<IngestResult> {
    if (!artistId || !handle) return EMPTY_RESULT;
    try {
        const artistName = await getArtistNameById(artistId);
        const rows = items
            .map(item => mapApifyPost(item, artistId, handle, artistName))
            .filter((r): r is SocialPostInsert => r !== null);
        return await upsertMappedRows(rows);
    } catch (e) {
        console.error("[ingestInstagramPostsFromItems] Error:", e);
        return EMPTY_RESULT;
    }
}

/** Onboarding ingests fewer posts than the CLI default. Signal derivation only
 *  looks at recent activity, so 200 buys no extra questions — it just makes the
 *  Apify run longer (1-5 min at 200) and costs more, while the artist is
 *  actively waiting two steps away. */
const ONBOARDING_INGEST_LIMIT = 60;

export type EnsureSocialPostsOutcome =
    | { status: "disabled" }
    | { status: "no_handle" }
    // No count: the check behind this is a cheap existence probe, and a
    // number that says "1" when 60 rows exist is worse than no number in a
    // log line whose whole job is telling you what happened.
    | { status: "already_present" }
    | { status: "ingested"; count: number }
    | { status: "found_nothing" }
    | { status: "error" };

/** The artist's stored name, for the self-credit check in `extractMusic`.
 *  Looked up here rather than pushed onto every caller so the CLI script and
 *  the onboarding path get the same protection without signature churn. */
async function getArtistNameById(artistId: string): Promise<string | undefined> {
    try {
        const row = await db.query.artists.findFirst({
            where: eq(artists.id, artistId),
            columns: { name: true },
        });
        return row?.name ?? undefined;
    } catch (e) {
        console.error("[getArtistNameById] Error:", e);
        return undefined;
    }
}

/** Cheap existence probe — avoids hydrating every row just to ask "any?".
 *  Deliberately a boolean, not a count: `LIMIT 1` can't produce a real total,
 *  and a "count" that maxes out at 1 invites exactly the misleading log line
 *  this module exists to prevent. Callers that need a total should read the
 *  rows. Fails closed (false) so an error can't be mistaken for "we have
 *  posts" and skip an ingest. */
export async function hasSocialPosts(artistId: string): Promise<boolean> {
    try {
        const rows = await db
            .select({ id: artistSocialPosts.id })
            .from(artistSocialPosts)
            .where(eq(artistSocialPosts.artistId, artistId))
            .limit(1);
        return rows.length > 0;
    } catch (e) {
        console.error("[hasSocialPosts] Error:", e);
        return false;
    }
}

/**
 * Idempotent entry point for "make sure we have this artist's posts".
 *
 * Deliberately knows nothing about onboarding steps. The trigger point is
 * expected to move — today it fires when profiles are confirmed; under a
 * pre-filled-profile flow it would fire at claim approval instead — and that
 * should be a one-line change at the call site, not a rewrite here.
 *
 * MUST be called as background work (Next.js `after()`), never awaited in a
 * chat turn: a scrape runs 1-5 minutes against a 55s turn deadline.
 *
 * Returns a discriminated outcome rather than a bare count so callers can log
 * *why* nothing happened. "No Instagram handle", "Apify returned nothing", and
 * "Apify errored" are three different problems that previously all looked like
 * silence — which is how the missing-questions bug reached a real artist
 * (see docs/rnd/research/2026-08-21-artist-test-pharaoh.md).
 */
export async function ensureRecentSocialPosts(
    artistId: string,
    opts?: { limit?: number },
): Promise<EnsureSocialPostsOutcome> {
    if (!APIFY_API_TOKEN) return { status: "disabled" };
    if (!artistId) return { status: "no_handle" };

    try {
        if (await hasSocialPosts(artistId)) return { status: "already_present" };

        const artist = await db.query.artists.findFirst({
            where: eq(artists.id, artistId),
            columns: { instagram: true },
        });
        const handle = artist?.instagram?.trim();
        if (!handle) return { status: "no_handle" };

        const result = await ingestInstagramPosts(artistId, handle, {
            limit: opts?.limit ?? ONBOARDING_INGEST_LIMIT,
        });
        if (result.ingested === 0) return { status: "found_nothing" };
        return { status: "ingested", count: result.ingested };
    } catch (e) {
        console.error("[ensureRecentSocialPosts] Error:", e);
        return { status: "error" };
    }
}

/**
 * Read this artist's captions, in one go.
 *
 * SCRIPTS AND TESTS ONLY. A three-hundred-post feed takes about seven minutes,
 * which no request survives — running this from a request is the bug that made
 * every non-pre-warmed artist end up with a document built from an empty
 * credits table. Production goes through the job queue: enqueue with
 * `requestArtistResearch`, and slices run in `/api/research/advance`, each with
 * its own budget.
 *
 * Kept because the benchmark and the R&D scripts genuinely want the whole thing
 * at once, and because "read this feed now" is a useful thing to be able to do
 * from a terminal.
 */
export async function ensureSocialCredits(artistId: string): Promise<number> {
    if (!artistId) return 0;
    try {
        const posts = await getSocialPostsForArtist(artistId);
        if (posts.length === 0) return 0;

        const artist = await db.query.artists.findFirst({
            where: eq(artists.id, artistId),
            columns: { name: true, instagram: true },
        });
        if (!artist?.name) return 0;

        const slice = await extractCaptionCredits(posts, artist.name, artist.instagram ?? "");
        const postedAtByUrl = new Map(posts.map(p => [p.url, p.postedAt] as const));
        let stored = await replaceSocialCredits(artistId, slice.extraction, postedAtByUrl);

        const swept = await sweepSilentCaptions(
            posts, await claimedSourceUrls(artistId), artist.name, artist.instagram ?? "");
        stored += await appendSocialCredits(artistId, swept, postedAtByUrl);

        if (stored > 0) forgetGroundedQuestions(artistId);
        console.debug(`[ensureSocialCredits] ${artist.name}: stored ${stored} row(s)`);
        return stored;
    } catch (e) {
        console.error("[ensureSocialCredits] Error:", e);
        return 0;
    }
}

/** Waits for a background ingest to land, up to `timeoutMs`, polling cheaply.
 *  Returns as soon as any post exists. Used by the interview step so a scrape
 *  that is nearly done still produces grounded questions instead of silently
 *  falling back — but bounded, because the artist is waiting. */
export async function waitForSocialPosts(artistId: string, timeoutMs: number, pollMs = 1000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await hasSocialPosts(artistId)) return true;
        if (Date.now() >= deadline) return false;
        await new Promise(r => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    }
}
