/**
 * Remove vault sources on hosts we now block, and say what went.
 *
 * The blocklist stops new ones arriving; rows discovered before it are still on
 * artists' pages. Reads the list from the same module the pipeline uses, so this
 * never drifts from what is actually blocked.
 *
 *   npx tsx scripts/purgeBlockedSources.ts          # show what would go
 *   npx tsx scripts/purgeBlockedSources.ts --delete # delete it
 */
import dotenv from "dotenv";
import postgres from "postgres";
import { isBlockedSourceHost } from "../src/lib/sourceAuthority";

dotenv.config({ path: ".env.local" });

async function main() {
    const conn = process.env.SUPABASE_DB_CONNECTION;
    if (!conn) throw new Error("SUPABASE_DB_CONNECTION is not set");
    // Guard rail: this deletes rows, and prod is one env var away.
    if (conn.includes("cbabvmebugudeuylronz")) throw new Error("Refusing to run against production");

    const sql = postgres(conn, { max: 1 });
    const rows = await sql<{ id: string; artist_id: string; url: string; title: string | null; status: string; artist: string }[]>`
        SELECT s.id, s.artist_id, s.url, s.title, s.status, a.name AS artist
          FROM artist_vault_sources s JOIN artists a ON a.id = s.artist_id`;

    const blocked = rows.filter(r => isBlockedSourceHost(r.url));
    if (blocked.length === 0) {
        console.log(`No blocked-host sources among ${rows.length} rows.`);
        await sql.end();
        return;
    }
    console.log(`${blocked.length} of ${rows.length} sources are on blocked hosts:\n`);
    for (const r of blocked) console.log(`  ${r.artist} [${r.status}] ${r.title ?? "(untitled)"}\n    ${r.url}`);

    if (!process.argv.includes("--delete")) {
        console.log("\nDry run. Pass --delete to remove them.");
        await sql.end();
        return;
    }
    const ids = blocked.map(r => r.id);
    await sql`DELETE FROM artist_vault_sources WHERE id = ANY(${sql.array(ids)}::uuid[])`;
    console.log(`\nDeleted ${ids.length}.`);

    // REMOVING THE ROW IS NOT THE WHOLE JOB. The knowledge document was
    // synthesised from these sources and stores its own citation manifest, so
    // an artist whose Boomplay page is deleted keeps a document built partly
    // from it — and the ask answers from that document as ground truth, citing
    // a source that no longer exists. Same reason deleting a source from the
    // vault UI triggers a rebuild.
    const affected = [...new Set(blocked.map(r => r.artist_id))];
    console.log(`Rebuilding ${affected.length} document(s)...`);
    const { refreshArtistDoc } = await import("../src/server/utils/artistDocService");
    for (const artistId of affected) {
        const name = blocked.find(r => r.artist_id === artistId)?.artist ?? artistId;
        const outcome = await refreshArtistDoc(artistId);
        console.log(`  ${name}: ${{
            rebuilt: "document rebuilt",
            "no-document": "no document to rebuild",
            failed: "REBUILD FAILED — it may still cite a source just deleted",
        }[outcome]}`);
    }
    await sql.end();
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
