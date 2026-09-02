/**
 * Does the job queue survive several workers running at once?
 *
 * The queue has only ever been exercised by one browser tab at a time, and
 * every failure found while building it was in this seam: a claim released
 * mid-slice, a cursor saved under a work list that had changed, a job marked
 * done before its results were written. From September 4th there is a cron
 * ticking every minute AND artists' own tabs pumping, so several workers on one
 * queue is the normal case rather than the edge.
 *
 * Deliberately FEW JOBS AND MANY WORKERS. The dangerous case is two invocations
 * claiming the same job, and that is most likely when workers outnumber jobs —
 * five artists and five pumps would mostly avoid each other and prove nothing.
 *
 *   npx tsx scripts/queue-concurrency-check.ts [--workers 6] [--seconds 180]
 *
 * The dev server speaks HTTPS with an mkcert certificate, so Node needs the
 * mkcert root to verify it. The script points NODE_EXTRA_CA_CERTS at it rather
 * than switching verification off — a script in the repo that disables TLS
 * checking is a pattern that gets copied into one that talks to something real.
 *
 * DEV ONLY. It resets job rows, so it refuses production.
 */
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import postgres from "postgres";

dotenv.config({ path: ".env.local" });

const PROD_REF = "cbabvmebugudeuylronz";
const BASE = process.env.PUMP_URL ?? "https://localhost:3001";

/** Trust the local mkcert CA, and only it. Already the case when the caller
 *  sets NODE_EXTRA_CA_CERTS themselves. */
const MKCERT_ROOT = path.join(os.homedir(), "Library/Application Support/mkcert/rootCA.pem");
if (!process.env.NODE_EXTRA_CA_CERTS && fs.existsSync(MKCERT_ROOT)) {
    process.env.NODE_EXTRA_CA_CERTS = MKCERT_ROOT;
}

type Slice = { ran: boolean; kind?: string; artistId?: string; progress?: string; done?: boolean };
type Sample = { at: number; id: string; status: string; cursor: number; total: number | null; claimed: string | null };

const arg = (name: string, fallback: number) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

async function main() {
    const conn = process.env.SUPABASE_DB_CONNECTION;
    if (!conn) throw new Error("SUPABASE_DB_CONNECTION is not set");
    if (conn.includes(PROD_REF)) throw new Error("Refusing to run against production");

    const workers = arg("workers", 6);
    const seconds = arg("seconds", 180);
    const sql = postgres(conn, { max: 4 });

    // Only artists whose feed we already hold. Enqueuing an ingest would scrape
    // a real person's Instagram to run a test, which is not ours to do.
    const withPosts = await sql<{ artist_id: string; name: string; n: number }[]>`
        SELECT p.artist_id, a.name, count(*)::int AS n
          FROM artist_social_posts p JOIN artists a ON a.id = p.artist_id
         GROUP BY 1, 2 ORDER BY n DESC`;
    if (withPosts.length === 0) throw new Error("No artist has scraped posts; nothing to extract");

    console.log(`Seeding ${withPosts.length} extraction job(s) for ${workers} workers over ${seconds}s:`);
    for (const a of withPosts) console.log(`  ${a.name} — ${a.n} posts`);

    for (const a of withPosts) {
        await sql`DELETE FROM artist_research_jobs WHERE artist_id = ${a.artist_id}::uuid AND kind = 'caption_extract'`;
        await sql`INSERT INTO artist_research_jobs (artist_id, kind, state)
                  VALUES (${a.artist_id}::uuid, 'caption_extract', '{"mode":"full"}'::jsonb)`;
    }

    const stop = Date.now() + seconds * 1000;
    const slices: Slice[] = [];
    const samples: Sample[] = [];
    let requests = 0;

    // Every worker hits the same endpoint the cron will, with no artist scope,
    // so they compete for whatever the queue offers next.
    const pump = async (worker: number) => {
        while (Date.now() < stop) {
            try {
                requests++;
                const res = await fetch(`${BASE}/api/research/advance`, { method: "GET" });
                const body = await res.json() as { slices?: Slice[] };
                for (const s of body.slices ?? []) slices.push(s);
                if (!body.slices?.length) await new Promise(r => setTimeout(r, 1_000));
            } catch (e) {
                console.error(`  worker ${worker}: ${(e as Error).message}`);
                await new Promise(r => setTimeout(r, 1_000));
            }
        }
    };

    const watch = async () => {
        while (Date.now() < stop) {
            const rows = await sql<{ id: string; status: string; cursor: number; total: number | null; claimed_at: string | null }[]>`
                SELECT id, status, cursor, total, claimed_at FROM artist_research_jobs`;
            const at = Date.now();
            for (const r of rows) samples.push({ at, id: r.id, status: r.status, cursor: r.cursor, total: r.total, claimed: r.claimed_at });
            await new Promise(r => setTimeout(r, 250));
        }
    };

    await Promise.all([...Array.from({ length: workers }, (_, i) => pump(i)), watch()]);

    // ---- the three invariants -------------------------------------------
    const failures: string[] = [];

    // 1. No job is claimed twice. Two workers holding one job would do the same
    //    batch twice, so the same "batch N/M" reported twice for one artist is
    //    the observable form of a double claim — and it is what the caller
    //    actually pays for.
    const seen = new Map<string, number>();
    for (const s of slices) {
        if (!s.artistId || !s.progress) continue;
        const batch = s.progress.match(/^batch (\d+)\/(\d+)/);
        if (!batch) continue;
        const key = `${s.artistId}#${batch[1]}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, n] of seen) if (n > 1) failures.push(`batch reported ${n}x: ${key}`);

    // 2. A cursor never goes backwards. That is how a slice resuming under a
    //    changed work list re-reads captions somebody already paid for.
    const byJob = new Map<string, Sample[]>();
    for (const s of samples) (byJob.get(s.id) ?? byJob.set(s.id, []).get(s.id)!).push(s);
    for (const [id, rows] of byJob) {
        rows.sort((a, b) => a.at - b.at);
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].cursor < rows[i - 1].cursor) {
                failures.push(`cursor went backwards on ${id}: ${rows[i - 1].cursor} -> ${rows[i].cursor}`);
                break;
            }
        }
    }

    // 3. Nothing is done while unfinished. "It ran and found nothing" and "it
    //    never ran" have to stay distinguishable, and a premature done is what
    //    made a document get written from an empty credits table.
    for (const s of samples) {
        if (s.status === "done" && s.total !== null && s.cursor < s.total) {
            failures.push(`done at ${s.cursor}/${s.total} on ${s.id}`);
            break;
        }
    }

    const finalRows = await sql<{ id: string; status: string; cursor: number; total: number | null }[]>`
        SELECT id, status, cursor, total FROM artist_research_jobs ORDER BY created_at`;

    console.log(`\n${requests} requests, ${slices.length} slices, ${samples.length} samples`);
    console.log("final job state:");
    for (const r of finalRows) console.log(`  ${r.status.padEnd(8)} ${r.cursor}/${r.total ?? "?"}  ${r.id}`);

    console.log(`\n${"=".repeat(56)}`);
    if (failures.length === 0) {
        console.log("no job claimed twice, no cursor backwards, nothing done while unfinished");
    } else {
        console.log(`${failures.length} INVARIANT FAILURE(S)`);
        for (const f of failures.slice(0, 20)) console.log(`  ! ${f}`);
    }
    console.log("=".repeat(56));

    await sql.end();
    process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
