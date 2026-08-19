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
import { artistSocialPosts } from "@/server/db/schema";
import type { SocialPostRow } from "@/server/utils/socialSignals";
import { APIFY_API_TOKEN } from "@/env";

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
function extractMusic(raw: ApifyPost, ownerUsername: string, selfNorm: string): { musicTitle: string | null; musicArtist: string | null } {
    const info = raw.musicInfo as ApifyMusicInfo | undefined;
    if (!info || typeof info !== "object") return { musicTitle: null, musicArtist: null };

    const songName = typeof info.song_name === "string" ? info.song_name.trim() : "";
    const artistName = typeof info.artist_name === "string" ? info.artist_name.trim() : "";
    if (!songName || !artistName) return { musicTitle: null, musicArtist: null };
    if (info.uses_original_audio === true) return { musicTitle: null, musicArtist: null };
    if (songName.toLowerCase() === "original audio") return { musicTitle: null, musicArtist: null };
    // The music "artist" is just the poster's own handle — not a real credit.
    if (norm(artistName) === selfNorm || norm(artistName) === norm(ownerUsername)) {
        return { musicTitle: null, musicArtist: null };
    }

    return { musicTitle: songName, musicArtist: artistName };
}

/**
 * Maps one raw Apify dataset item to an insertable row, or `null` if the
 * item isn't a real post (Apify datasets can contain error placeholders for
 * posts it failed to fetch — those lack `id`/`url`/`ownerUsername`).
 */
export function mapApifyPost(rawItem: unknown, artistId: string, handle: string): SocialPostInsert | null {
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
    const { musicTitle, musicArtist } = extractMusic(raw, ownerUsername, selfNorm);

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

        const rows = items
            .map(item => mapApifyPost(item, artistId, handle))
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
        const rows = items
            .map(item => mapApifyPost(item, artistId, handle))
            .filter((r): r is SocialPostInsert => r !== null);
        return await upsertMappedRows(rows);
    } catch (e) {
        console.error("[ingestInstagramPostsFromItems] Error:", e);
        return EMPTY_RESULT;
    }
}
