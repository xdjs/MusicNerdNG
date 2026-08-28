/**
 * One slice of research work, in its own invocation.
 *
 * The point of this route is the budget. `after()` on an onboarding turn shares
 * that turn's remaining maxDuration, so a chat turn that spent fifty seconds
 * left ten for a job that needs minutes — which is why every artist we had not
 * pre-warmed by hand ended up with a document built from an empty credits
 * table. Here the slice gets the whole allowance.
 *
 * Called by:
 *   - the onboarding client, while the artist is reading the vault step. They
 *     spend minutes there, and each call is a full-budget invocation happening
 *     while somebody is actually watching.
 *   - the artist, from the "look again" button in edit mode.
 *   - a scheduler, for artists nobody is watching. This was documented here
 *     before it existed: nothing scheduled anything, so a job only advanced
 *     while a browser tab sat open on the artist's page. Pete Rango's own
 *     caption extraction sat at batch 3 of 30 for a day because he closed the
 *     tab, and an artist who onboards on a phone and puts it down would have
 *     been left with a document written from whatever was read in the first
 *     ninety seconds. GET below is that scheduler's entry point.
 *
 * Safe to call concurrently: the work is claimed atomically with a lease, so
 * two callers cannot take the same job, and a caller the platform kills frees
 * its job instead of wedging it.
 */
import { advanceResearch } from "@/server/utils/researchRunner";
import { CRON_SECRET } from "@/env";

export const dynamic = "force-dynamic";
/** The whole point. A slice gets its own allowance rather than a chat turn's
 *  leftovers. 60 is the ceiling on the current plan. */
export const maxDuration = 60;

/** Held back so the response is sent rather than the platform cutting us off
 *  mid-write. */
const RESPONSE_RESERVE_MS = 4_000;

export async function POST(req: Request): Promise<Response> {
    const started = Date.now();
    try {
        const body = await req.json().catch(() => ({}));
        const artistId = typeof body?.artistId === "string" ? body.artistId : undefined;

        const result = await advanceResearch({
            budgetMs: maxDuration * 1000 - RESPONSE_RESERVE_MS,
            artistId,
        });

        console.debug(`[research/advance] ${JSON.stringify(result)} in ${Date.now() - started}ms`);
        return Response.json(result);
    } catch (e) {
        console.error("[research/advance] Error:", e);
        // Deliberately a 200 with ran:false. This is a background worker
        // endpoint, and the callers are a browser poll and a scheduler; a 500
        // teaches them to back off from work that is fine.
        return Response.json({ ran: false, error: "advance failed" });
    }
}

/**
 * The scheduler's entry point. Vercel cron issues a GET.
 *
 * Takes SLICES UNTIL THE BUDGET RUNS OUT rather than one and stopping. A tick
 * that does a single slice and waits a minute for the next would take half an
 * hour to read a three-hundred-post feed; there is a whole invocation here and
 * the queue is the thing that decides what to work on, so it keeps claiming
 * while there is time to finish something.
 *
 * It stops the moment a claim comes back empty — an idle queue must cost one
 * database round trip per tick, not a minute of spinning.
 */
export async function GET(req: Request): Promise<Response> {
    const started = Date.now();
    // Only when a secret is configured. Unset, this stays as open as POST
    // already is, which keeps local and preview environments working; set, it
    // is required, so production cannot be pumped by anyone who finds the URL.
    if (CRON_SECRET && req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
        return Response.json({ ran: false, error: "unauthorized" }, { status: 401 });
    }

    const deadline = started + maxDuration * 1000 - RESPONSE_RESERVE_MS;
    const slices: unknown[] = [];
    // A WAITING JOB IS SET ASIDE FOR THE REST OF THE TICK. An ingest polling an
    // Apify run hands its lease straight back and the queue orders by age, so
    // the loop would otherwise reclaim that same job and poll the scrape until
    // the invocation expired — hammering the provider and starving every job
    // behind it. The next tick a minute later picks it up, which is the right
    // cadence for something that takes one to five minutes anyway.
    //
    // Only WAITING jobs. A job that read a batch of captions made progress and
    // should keep the invocation: taking several extraction slices per tick is
    // the reason this loops at all.
    const waiting: string[] = [];
    try {
        // A slice needs room to do something and to write down what it did.
        // Starting one with eight seconds left spends the reserve and keeps
        // nothing, which is the same rule extractCaptionCredits applies inside
        // itself.
        while (Date.now() < deadline - MIN_SLICE_MS) {
            // A copy, not the live array — the callee must not be holding a
            // reference to a list this loop keeps appending to.
            const result = await advanceResearch({ budgetMs: deadline - Date.now(), excludeJobIds: [...waiting] });
            if (!result.ran) break;
            if (result.waiting && result.jobId) waiting.push(result.jobId);
            slices.push(result);
        }
        console.debug(`[research/advance] cron ran ${slices.length} slice(s) in ${Date.now() - started}ms`);
        return Response.json({ ran: slices.length > 0, slices });
    } catch (e) {
        console.error("[research/advance] cron error:", e);
        return Response.json({ ran: slices.length > 0, slices, error: "advance failed" });
    }
}

/** Below this there is not enough left for a model call and the write after it. */
const MIN_SLICE_MS = 12_000;
