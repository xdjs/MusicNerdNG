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
import {
    getSocialPostsForArtist, hasSocialPosts, instagramHandleFor,
    startInstagramScrape, checkInstagramScrape, collectInstagramScrape,
} from "@/server/utils/socialIngest";
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

/**
 * Fetch the feed, across as many slices as it takes.
 *
 * A scrape is one to five minutes and this route has sixty seconds, so it is
 * never awaited: the run is STARTED, its id goes on the job row immediately,
 * and later slices poll it. An invocation the platform kills therefore leaves a
 * run we can find again rather than an orphan we paid for and never collected —
 * which is what happened when this was a single blocking call, forever, because
 * each new slice started the same scrape from scratch.
 */
async function runIngest(job: ResearchJob): Promise<{ progress: string; done: boolean }> {
    const force = job.state?.force === true;
    const runId = typeof job.state?.apifyRunId === "string" ? job.state.apifyRunId : null;

    // Nothing to scrape, or nothing to scrape it with.
    const handle = await instagramHandleFor(job.artistId);
    if (!handle) {
        await completeResearchJob(job.id);
        return { progress: "no instagram handle", done: true };
    }

    // Already have the posts and nobody asked for a fresh look.
    if (!force && !runId && await hasSocialPosts(job.artistId)) {
        await completeResearchJob(job.id);
        await enqueueResearchJob(job.artistId, "caption_extract");
        return { progress: "posts already present", done: true };
    }

    if (!runId) {
        const started = await startInstagramScrape(handle);
        if (started.status === "failed") {
            await failResearchJob(job.id, started.reason);
            return { progress: `scrape did not start: ${started.reason}`, done: false };
        }
        // Persisted BEFORE anything else can go wrong.
        await saveJobProgress(job.id, job.cursor, { state: { ...job.state, apifyRunId: started.runId } });
        return { progress: `scrape started (${started.runId})`, done: false };
    }

    const state = await checkInstagramScrape(runId);
    if (state.status === "started" || state.status === "running") {
        await saveJobProgress(job.id, job.cursor, { state: job.state });
        return { progress: "scrape still running", done: false };
    }
    if (state.status === "failed") {
        await failResearchJob(job.id, state.reason);
        return { progress: `scrape failed: ${state.reason}`, done: false };
    }

    const result = await collectInstagramScrape(job.artistId, handle, state.datasetId);
    await completeResearchJob(job.id);
    await enqueueResearchJob(job.artistId, "caption_extract", {
        state: force ? { incremental: true } : {},
    });
    return { progress: `ingested ${result.ingested} post(s)`, done: true };
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

    // INCREMENTAL means incremental.
    //
    // A "look again" job used to start at cursor zero like any other, which
    // cleared every credit the artist had and re-read their entire feed —
    // seven minutes and a full model bill to learn what we already knew, and a
    // profile left empty if the replacement stalled halfway. A refresh reads
    // only the captions it has no credit for, and keeps everything else.
    // Credits we already hold are not ours to throw away.
    //
    // A full extraction clears first, so that re-reading a changed feed does
    // not leave stale credits behind. But "there are credits and no job row"
    // is the normal state for an artist whose captions were read before this
    // queue existed — and clearing those to re-read a feed we already
    // understand is minutes of model time to arrive back where we started,
    // with the profile empty in between if anything interrupts it.
    //
    // So: explicit re-read clears. Anything else reads what it has no credit
    // for and keeps the rest.
    const existing = await claimedSourceUrls(job.artistId);
    const fullRebuild = job.state?.fullRebuild === true;
    const incremental = job.state?.incremental === true || (!fullRebuild && existing.size > 0);

    let toRead = posts;
    if (incremental) {
        toRead = posts.filter(p => !existing.has(p.url));
        if (toRead.length === 0) {
            await completeResearchJob(job.id);
            return { progress: "nothing new to read", done: true };
        }
    } else if (job.cursor === 0) {
        // A fresh full extraction starts clean; a resumed one keeps what
        // earlier slices wrote.
        await clearSocialCredits(job.artistId);
    }

    const budgetMs = Math.max(0, deadline - Date.now());
    const slice = await extractCaptionCredits(toRead, artist.name, artist.instagram ?? "", {
        startBatch: job.cursor,
        budgetMs,
    });

    const postedAtByUrl = new Map(posts.map(p => [p.url, p.postedAt] as const));
    const stored = await appendSocialCredits(job.artistId, slice.extraction, postedAtByUrl);

    if (!slice.done) {
        await saveJobProgress(job.id, slice.nextBatch, { total: slice.totalBatches, state: job.state });
        return { progress: `batch ${slice.nextBatch}/${slice.totalBatches}, +${stored} row(s)`, done: false };
    }

    // Every batch read. One sweep over the captions that produced nothing,
    // if there is time; if not, leave the job open and sweep next slice.
    const remaining = deadline - Date.now();
    if (remaining > 15_000) {
        const swept = await sweepSilentCaptions(
            toRead, await claimedSourceUrls(job.artistId), artist.name, artist.instagram ?? "",
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
