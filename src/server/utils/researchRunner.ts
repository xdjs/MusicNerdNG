/**
 * One slice of research, per invocation.
 *
 * This is the piece that makes the long work survive production. Everything it
 * does is bounded by a budget the caller owns, and everything it learns is on
 * the job row before it returns — so being killed costs the current slice and
 * nothing else.
 *
 * Called from `/api/research/advance`, which has its own maxDuration. It is
 * deliberately NOT called from an onboarding turn's `after()`: that shares the
 * turn's remaining budget, which is how a chat turn that spent fifty seconds
 * left ten for a seven-minute job, every time, for every artist we had not
 * pre-warmed by hand.
 */
import { db } from "@/server/db/drizzle";
import { artists } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import {
    claimResearchJob, saveJobProgress, completeResearchJob, failResearchJob,
    enqueueResearchJob, type ResearchJob,
} from "@/server/utils/queries/researchJobQueries";
import {
    clearSocialCredits, appendSocialCredits, claimedSourceUrls,
} from "@/server/utils/queries/socialCreditQueries";
import { extractCaptionCredits, sweepSilentCaptions } from "@/server/utils/socialCredits";
import { ensureRecentSocialPosts, getSocialPostsForArtist } from "@/server/utils/socialIngest";
import { forgetGroundedQuestions } from "@/server/utils/questionGenerator";
import { refreshArtistDoc } from "@/server/utils/artistDocService";

/** Headroom kept back so the slice can persist what it did before the platform
 *  stops the invocation. Losing a finished batch because there was no time left
 *  to write it down would be the same bug one layer in. */
const PERSIST_RESERVE_MS = 5_000;

export interface AdvanceResult {
    ran: boolean;
    kind?: string;
    artistId?: string;
    progress?: string;
    done?: boolean;
}

/**
 * Claim one job and work on it for up to `budgetMs`.
 *
 * Returns `{ ran: false }` when there is nothing to do, which is the normal
 * case and not an error.
 */
export async function advanceResearch(opts: { budgetMs: number; artistId?: string }): Promise<AdvanceResult> {
    const job = await claimResearchJob({ artistId: opts.artistId });
    if (!job) return { ran: false };

    const deadline = Date.now() + Math.max(0, opts.budgetMs - PERSIST_RESERVE_MS);
    try {
        const result = job.kind === "social_ingest"
            ? await runIngest(job)
            : await runExtraction(job, deadline);
        return { ran: true, kind: job.kind, artistId: job.artistId, ...result };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[research] ${job.kind} failed for ${job.artistId}:`, message);
        await failResearchJob(job.id, message);
        return { ran: true, kind: job.kind, artistId: job.artistId, progress: `failed: ${message}` };
    }
}

/** Fetch the feed. Idempotent, and cheap when the posts are already there. */
async function runIngest(job: ResearchJob): Promise<{ progress: string; done: boolean }> {
    // A job created by the "look again" button carries force, so the scrape
    // runs again and picks up anything posted since. A job created by
    // onboarding does not, and is a no-op when the posts are already there.
    const force = job.state?.force === true;
    const outcome = await ensureRecentSocialPosts(job.artistId, { force });
    if (outcome.status === "error") {
        await failResearchJob(job.id, "apify ingest failed");
        return { progress: "ingest failed", done: false };
    }
    await completeResearchJob(job.id);
    // Reading the captions is the next job, and it only exists once there is
    // something to read.
    if (outcome.status === "ingested" || outcome.status === "already_present") {
        await enqueueResearchJob(job.artistId, "caption_extract");
    }
    return { progress: `ingest ${outcome.status}`, done: true };
}

/**
 * Read as many caption batches as fit, then persist and hand the lease back.
 *
 * The document is rebuilt only when the whole extraction finishes. Rebuilding
 * per slice would mean an artist watching their own page see it change three
 * times and cost three Gemini calls to reach the same place.
 */
async function runExtraction(job: ResearchJob, deadline: number): Promise<{ progress: string; done: boolean }> {
    const artist = await db.query.artists.findFirst({
        where: eq(artists.id, job.artistId),
        columns: { name: true, instagram: true },
    });
    if (!artist?.name) {
        await completeResearchJob(job.id);
        return { progress: "no artist", done: true };
    }

    const posts = await getSocialPostsForArtist(job.artistId);
    if (posts.length === 0) {
        // Finished, having found nothing to read. Recorded as done so this is
        // never confused with "has not run" — the distinction the old
        // row-count check could not make.
        await completeResearchJob(job.id);
        return { progress: "no posts", done: true };
    }

    // A fresh job starts clean; a resumed one keeps what earlier slices wrote.
    if (job.cursor === 0) await clearSocialCredits(job.artistId);

    const budgetMs = Math.max(0, deadline - Date.now());
    const slice = await extractCaptionCredits(posts, artist.name, artist.instagram ?? "", {
        startBatch: job.cursor,
        budgetMs,
    });

    const postedAtByUrl = new Map(posts.map(p => [p.url, p.postedAt] as const));
    const stored = await appendSocialCredits(job.artistId, slice.extraction, postedAtByUrl);

    if (!slice.done) {
        await saveJobProgress(job.id, slice.nextBatch, { total: slice.totalBatches });
        return { progress: `batch ${slice.nextBatch}/${slice.totalBatches}, +${stored} row(s)`, done: false };
    }

    // Every batch read. One sweep over the captions that produced nothing,
    // if there is time; if not, leave the job open and sweep next slice.
    const remaining = deadline - Date.now();
    if (remaining > 15_000) {
        const swept = await sweepSilentCaptions(
            posts, await claimedSourceUrls(job.artistId), artist.name, artist.instagram ?? "",
            { budgetMs: remaining },
        );
        await appendSocialCredits(job.artistId, swept, postedAtByUrl);
    }

    await completeResearchJob(job.id);
    // Questions cached while this was running were generated against an empty
    // credits table; the document was likely written then too.
    forgetGroundedQuestions(job.artistId);
    await refreshArtistDoc(job.artistId).catch(e =>
        console.error("[research] doc rebuild after extraction failed:", e));

    return { progress: `complete, ${slice.totalBatches} batch(es)`, done: true };
}

/** Ask for an artist's feed to be read. Safe to call repeatedly.
 *
 *  `force` means the artist asked, so the scrape runs even though we already
 *  hold posts — that is how anything they published since gets picked up. */
export async function requestArtistResearch(
    artistId: string,
    opts?: { force?: boolean },
): Promise<void> {
    await enqueueResearchJob(artistId, "social_ingest", {
        state: opts?.force ? { force: true } : {},
    });
}
