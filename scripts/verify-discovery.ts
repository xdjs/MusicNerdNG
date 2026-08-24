/**
 * Runs source discovery against real artists and reports what it actually
 * stored — URL liveness, citability, and namesake leakage.
 *
 * Unit tests missed two shipped bugs on this path (fabricated URLs, and a
 * self-credit guard that never fired), so changes here get checked against
 * live data as well. Pharaoh Sistare is the "did we find the real thing" case;
 * Black Dave is the namesake stress test.
 *
 *   npx tsx scripts/verify-discovery.ts <artistId|name> [more...] [--reset]
 *
 * --reset clears the artist's PENDING sources first so repeated runs are
 * comparable. Approved sources are never touched. DEV ONLY — refuses to run
 * against the production project.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const PROD_REF = "cbabvmebugudeuylronz";

async function urlStatus(url: string): Promise<string> {
    try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 10000);
        try { return String((await fetch(url, { redirect: "follow", signal: c.signal })).status); }
        finally { clearTimeout(t); }
    } catch { return "ERR"; }
}

/** Does the stored row actually name this artist? Cheap namesake probe over the
 *  fields a human would judge it by. */
function looksOnTopic(row: { title: string | null; url: string }, name: string): boolean {
    const fold = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const hay = fold(`${row.title ?? ""} ${row.url}`);
    return hay.includes(fold(name));
}

async function main() {
    const args = process.argv.slice(2);
    const reset = args.includes("--reset");
    const targets = args.filter(a => a !== "--reset");
    if (targets.length === 0) { console.error("usage: verify-discovery.ts <artistId|name>... [--reset]"); process.exit(1); }

    if ((process.env.SUPABASE_DB_CONNECTION ?? "").includes(PROD_REF)) {
        console.error("REFUSING: SUPABASE_DB_CONNECTION points at production.");
        process.exit(1);
    }

    const { db } = await import("@/server/db/drizzle");
    const { artists, artistVaultSources } = await import("@/server/db/schema");
    const { eq, and, ilike } = await import("drizzle-orm");
    const { searchAndPopulateVault } = await import("@/server/utils/queries/vaultWebSearch");
    const { getVaultSourcesByArtistId } = await import("@/server/utils/queries/dashboardQueries");

    let anyFail = false;

    for (const target of targets) {
        const isUuid = /^[0-9a-f-]{36}$/i.test(target);
        const row = isUuid
            ? await db.query.artists.findFirst({ where: eq(artists.id, target) })
            : await db.query.artists.findFirst({ where: ilike(artists.name, target) });
        if (!row) { console.error(`\n!! no artist matching "${target}"`); anyFail = true; continue; }

        const name = row.name ?? "(unnamed)";
        console.log(`\n${"=".repeat(72)}\n${name}   ${row.id}\n${"=".repeat(72)}`);

        if (reset) {
            await db.delete(artistVaultSources)
                .where(and(eq(artistVaultSources.artistId, row.id), eq(artistVaultSources.status, "pending")));
            console.log("  (pending sources cleared)");
        }

        const t0 = Date.now();
        await searchAndPopulateVault(row.id);
        const elapsed = Math.round((Date.now() - t0) / 1000);

        const pending = await getVaultSourcesByArtistId(row.id, "pending");
        const codes = await Promise.all(pending.map(r => urlStatus(r.url)));

        let citable = 0, dead = 0, offTopic = 0, citableOffTopic = 0;
        pending.forEach((r, i) => {
            const isCitable = !!r.extractedText;
            const onTopic = looksOnTopic(r, name);
            if (isCitable) citable++;
            if (codes[i] === "404") dead++;
            if (!onTopic) offTopic++;
            if (isCitable && !onTopic) citableOffTopic++;
            console.log(`  [${codes[i].padEnd(3)}] ${isCitable ? "CITABLE" : "lead   "} ${onTopic ? "  " : "??"} ${String(r.title ?? "").slice(0, 52)}`);
            console.log(`              ${r.url.slice(0, 100)}`);
        });

        console.log(`\n  ${pending.length} stored in ${elapsed}s | citable ${citable} | dead ${dead} | off-topic ${offTopic} (of which citable: ${citableOffTopic})`);
        // The two failures that matter: a URL that doesn't exist, or a namesake
        // that became citable and can therefore be quoted in the artist's About.
        const failed = dead > 0 || citableOffTopic > 0;
        console.log(`  ${failed ? "FAIL" : "PASS"} — dead=${dead}, citable-off-topic=${citableOffTopic}`);
        if (failed) anyFail = true;
    }

    console.log(`\n${anyFail ? "OVERALL: FAIL" : "OVERALL: PASS"}`);
    process.exit(anyFail ? 1 : 0);
}

main().catch(e => { console.error("ERROR:", e); process.exit(1); });
