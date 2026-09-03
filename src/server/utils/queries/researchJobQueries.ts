/**
 * The queue. Enqueue, claim, record progress, finish.
 *
 * Everything here is deliberately small and boring, because the interesting
 * failure in this subsystem has never been the work — it has been not knowing
 * whether the work ran. `status` answers that; row counts never could.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/drizzle";
import { artistResearchJobs } from "@/server/db/schema";

export type JobKind = "social_ingest" | "caption_extract";
export type JobStatus = "pending" | "running" | "done" | "failed";

export interface ResearchJob {
    id: string;
    artistId: string;
    kind: JobKind;
    status: JobStatus;
    cursor: number;
    total: number | null;
    attempts: number;
    state: Record<string, unknown>;
    /** Dropped by an earlier version of toJob, which made the refresh cooldown
     *  read undefined and never fire — an artist could re-trigger an expensive
     *  scrape immediately. */
    updatedAt: string | null;
}

/** How long a claim is good for. An invocation the platform kills leaves its
 *  job claimed; after this it is claimable again. Comfortably longer than a
 *  slice (which is bounded by the route's maxDuration) and short enough that a
 *  death does not strand an artist for an hour. */
const LEASE_MS = 3 * 60 * 1000;

/** Give up after this many failed attempts rather than retrying forever. The
 *  row stays, with last_error, because a job that quietly disappears is the
 *  thing this table exists to stop. */
export const MAX_ATTEMPTS = 4;

function toJob(row: Record<string, unknown>): ResearchJob {
    return {
        id: String(row.id),
        artistId: String(row.artist_id ?? row.artistId),
        kind: String(row.kind) as JobKind,
        status: String(row.status) as JobStatus,
        cursor: Number(row.cursor ?? 0),
        total: row.total === null || row.total === undefined ? null : Number(row.total),
        attempts: Number(row.attempts ?? 0),
        state: (row.state as Record<string, unknown>) ?? {},
        updatedAt: (row.updated_at ?? row.updatedAt) ? String(row.updated_at ?? row.updatedAt) : null,
    };
}

const rowsOf = (r: unknown): Record<string, unknown>[] => {
    if (!r) return [];
    const x = r as { rows?: unknown[] };
    return (Array.isArray(x.rows) ? x.rows : Array.isArray(r) ? r : []) as Record<string, unknown>[];
};

/**
 * Ask for a job to exist. Idempotent: a live job for this artist and kind means
 * this call does nothing, which is what the unique partial index enforces.
 *
 * Returns true when a job is live afterwards, whether or not this call made it.
 */
export async function enqueueResearchJob(
    artistId: string,
    kind: JobKind,
    opts?: { total?: number; state?: Record<string, unknown> },
): Promise<boolean> {
    if (!artistId) return false;
    try {
        await db.execute(sql`
            insert into artist_research_jobs (artist_id, kind, total, state)
            values (${artistId}::uuid, ${kind}, ${opts?.total ?? null}, ${JSON.stringify(opts?.state ?? {})}::jsonb)
            on conflict do nothing`);
        return true;
    } catch (e) {
        console.error("[enqueueResearchJob] Error:", e);
        return false;
    }
}

/**
 * Take one job, atomically.
 *
 * NOTE that claiming does not increment `attempts`. It used to, which quietly
 * capped every job at four slices: a three-hundred-post feed needs far more
 * than that, and once attempts hit the limit the job became unclaimable while
 * staying `pending`, so the unique live-job index also blocked re-enqueuing it.
 * A large artist would have stalled forever with no error anywhere. `attempts`
 * counts FAILURES, and is incremented in failResearchJob.
 *
 * The claim and the read are a single statement on purpose: two invocations
 * arriving together must not both come away believing they own the same job.
 * MNTv learned this the hard way on their nugget cache and spent three commits
 * on releasing the claim; the lease here means a claim that is never released
 * expires instead of wedging.
 */
export async function claimResearchJob(opts?: { artistId?: string; excludeIds?: string[] }): Promise<ResearchJob | null> {
    try {
        const scope = opts?.artistId
            ? sql`and artist_id = ${opts.artistId}::uuid`
            : sql``;
        // Jobs a single caller has already worked on this invocation. A slice
        // that is WAITING — an ingest polling an Apify run — hands its lease
        // straight back, and `order by created_at` then offers the same job
        // again, so a loop would poll one scrape until its budget ran out and
        // never reach anything behind it. Excluding what it has already touched
        // lets it move down the queue instead.
        const skip = opts?.excludeIds?.length
            ? sql`and id <> all(${sql.raw(`'{${opts.excludeIds.map(id => `"${id}"`).join(",")}}'::uuid[]`)})`
            : sql``;
        const res = await db.execute(sql`
            update artist_research_jobs
               set status = 'running',
                   claimed_at = now(),
                   updated_at = now()
             where id = (
                 select id from artist_research_jobs
                  where status in ('pending', 'running')
                    and attempts < ${MAX_ATTEMPTS}
                    and (claimed_at is null or claimed_at < now() - interval '${sql.raw(String(LEASE_MS))} milliseconds')
                    ${scope}
                    ${skip}
                  order by created_at
                  limit 1
                  for update skip locked
             )
         returning *`);
        const row = rowsOf(res)[0];
        return row ? toJob(row) : null;
    } catch (e) {
        console.error("[claimResearchJob] Error:", e);
        return null;
    }
}

/** Record progress and hand the lease back, so the next slice can pick it up
 *  immediately rather than waiting for the lease to expire. */
/** Progress is also proof of life: a slice that got somewhere clears the
 *  failure count, so a job that fails twice and then succeeds is not one
 *  failure away from being abandoned. */
export async function saveJobProgress(
    jobId: string,
    cursor: number,
    opts?: { total?: number | null; state?: Record<string, unknown> },
): Promise<void> {
    try {
        await db.execute(sql`
            update artist_research_jobs
               set cursor = ${cursor},
                   status = 'pending',
                   claimed_at = null,
                   attempts = 0,
                   total = coalesce(${opts?.total ?? null}, total),
                   state = coalesce(${opts?.state ? JSON.stringify(opts.state) : null}::jsonb, state),
                   updated_at = now()
             where id = ${jobId}::uuid`);
    } catch (e) {
        console.error("[saveJobProgress] Error:", e);
    }
}

/**
 * Write job state while KEEPING the claim.
 *
 * saveJobProgress hands the lease back so the next slice can start at once,
 * which is right at the end of a slice and wrong in the middle of one: the
 * pump ticks every twenty seconds, so releasing the claim before the model
 * calls meant a second invocation could claim the same job, duplicate the
 * Gemini work, and overwrite the first one's cursor or mark the job done
 * before it had written its results.
 */
export async function saveJobState(
    jobId: string,
    state: Record<string, unknown>,
): Promise<void> {
    try {
        await db.execute(sql`
            update artist_research_jobs
               set state = ${JSON.stringify(state)}::jsonb,
                   claimed_at = now(),
                   updated_at = now()
             where id = ${jobId}::uuid`);
    } catch (e) {
        console.error("[saveJobState] Error:", e);
    }
}

/** Finished, successfully. The row stays: "this ran and found nothing" is a
 *  fact worth keeping, and it is the one the old row-count check could not
 *  express. */
export async function completeResearchJob(jobId: string): Promise<void> {
    try {
        await db.execute(sql`
            update artist_research_jobs
               set status = 'done', claimed_at = null, last_error = null, updated_at = now()
             where id = ${jobId}::uuid`);
    } catch (e) {
        console.error("[completeResearchJob] Error:", e);
    }
}

/** Failed this attempt. Stays pending until attempts run out, then failed —
 *  either way the error is on the row rather than only in a log nobody reads. */
export async function failResearchJob(jobId: string, error: string): Promise<void> {
    try {
        await db.execute(sql`
            update artist_research_jobs
               set attempts = attempts + 1,
                   status = case when attempts + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end,
                   claimed_at = null,
                   last_error = ${error.slice(0, 500)},
                   updated_at = now()
             where id = ${jobId}::uuid`);
    } catch (e) {
        console.error("[failResearchJob] Error:", e);
    }
}

/**
 * Record a cursor AND a failure in one statement.
 *
 * Doing these as two writes reset `attempts` to zero (saveJobProgress treats
 * progress as proof of life) immediately before incrementing it, so a job that
 * failed the same batch every time sat at exactly one attempt forever and could
 * never reach MAX_ATTEMPTS. It also released the claim in between.
 */
export async function failJobAtCursor(
    jobId: string,
    cursor: number,
    total: number | null,
    state: Record<string, unknown>,
    error: string,
): Promise<void> {
    try {
        await db.execute(sql`
            update artist_research_jobs
               set cursor = ${cursor},
                   total = coalesce(${total ?? null}, total),
                   state = ${JSON.stringify(state)}::jsonb,
                   attempts = attempts + 1,
                   status = case when attempts + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end,
                   claimed_at = null,
                   last_error = ${error.slice(0, 500)},
                   updated_at = now()
             where id = ${jobId}::uuid`);
    } catch (e) {
        console.error("[failJobAtCursor] Error:", e);
    }
}

/** What an artist's research is doing, for the UI and for the completion checks
 *  that used to count rows. */
export async function getResearchJobs(artistId: string): Promise<ResearchJob[]> {
    if (!artistId) return [];
    try {
        const rows = await db.select().from(artistResearchJobs)
            .where(eq(artistResearchJobs.artistId, artistId));
        return rows.map(r => toJob(r as unknown as Record<string, unknown>));
    } catch (e) {
        console.error("[getResearchJobs] Error:", e);
        return [];
    }
}

/** True when this kind of work has finished for this artist — including when it
 *  finished having found nothing.
 *
 *  NOT THE GUARD YOU WANT FOR "should I wait". Its negation is true both for
 *  work in progress AND for work that was never enqueued, so gating on
 *  `!isResearchComplete` blocks an artist with no Instagram handle forever.
 *  Use `isResearchInFlight` below, which asks the question directly. */
export async function isResearchComplete(artistId: string, kind: JobKind): Promise<boolean> {
    if (!artistId) return false;
    try {
        const rows = await db.select({ status: artistResearchJobs.status })
            .from(artistResearchJobs)
            .where(and(eq(artistResearchJobs.artistId, artistId), eq(artistResearchJobs.kind, kind)))
            .limit(1);
        return rows[0]?.status === "done";
    } catch (e) {
        console.error("[isResearchComplete] Error:", e);
        return false;
    }
}

/**
 * True when ANY of these kinds of work is QUEUED OR RUNNING for this artist.
 *
 * TAKES A LIST BECAUSE ONE STAGE IS NOT THE QUESTION. `caption_extract` is
 * enqueued only after `social_ingest` completes (runIngest, above), so while
 * the scrape is running there is no extraction row to find. Asking only about
 * extraction answers "false" for the entire scrape — which is the exact window
 * Pete Rango's sitting fell into: questions at 13:18:08, ingest still running,
 * extraction not queued until 13:19:16. A guard that checks one stage misses
 * the state the incident actually happened in.
 *
 * Deliberately not `!isResearchComplete`. An artist with no job row at all —
 * no Instagram handle, nothing ever enqueued — is not in flight, and inverting
 * the completion check would block them from an interview forever.
 *
 * FAILS CLOSED, unlike everything else in this file. A read error returns
 * `true` (treat as in flight), because the two mistakes are not symmetrical:
 * wrongly blocking costs one page load and retries on the next, while wrongly
 * proceeding persists a static-bank sitting under (artist_id, question_key)
 * that sets `since` and gates every later sitting. One is a delay; the other
 * is permanent.
 */
export async function isResearchInFlight(artistId: string, kinds: JobKind | JobKind[]): Promise<boolean> {
    if (!artistId) return false;
    const wanted = Array.isArray(kinds) ? kinds : [kinds];
    if (wanted.length === 0) return false;
    try {
        const rows = await db.select({ status: artistResearchJobs.status })
            .from(artistResearchJobs)
            .where(and(
                eq(artistResearchJobs.artistId, artistId),
                inArray(artistResearchJobs.kind, wanted),
                inArray(artistResearchJobs.status, ["pending", "running"]),
            ))
            .limit(1);
        return rows.length > 0;
    } catch (e) {
        console.error("[isResearchInFlight] Error:", e);
        return true;
    }
}

/** Let an artist ask for a fresh look. Clears the finished job so a new one can
 *  be enqueued; the caller decides the rate limit. */
export async function reopenResearchJob(artistId: string, kind: JobKind): Promise<void> {
    try {
        await db.execute(sql`
            delete from artist_research_jobs
             where artist_id = ${artistId}::uuid and kind = ${kind} and status in ('done', 'failed')`);
    } catch (e) {
        console.error("[reopenResearchJob] Error:", e);
    }
}
