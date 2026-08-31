/**
 * Does discovery know about every platform the product does?
 *
 * The lists in vaultWebSearch.ts are hand-maintained on purpose — deriving a
 * platform's domain from urlmap's url template gives the wrong answer for the
 * ones that matter most (bandcamp's template is `%@.bandcamp.com`, so a
 * substituted host reads `x.bandcamp.com`; spotify's resolves to
 * `open.spotify.com`, narrower than the correct `spotify.com`). But hand
 * maintenance is exactly how they fell nineteen platforms behind without
 * anybody noticing.
 *
 * So this is the tripwire: it fails when urlmap holds a platform the lists do
 * not classify. Drift becomes a failure rather than a silence.
 *
 *   npx tsx scripts/check-platform-coverage.ts
 *
 * Not a jest test because it needs the real urlmap table, which the suite
 * mocks. Run it when platforms are added.
 */
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: ".env.local" });

/** Platforms deliberately left unclassified, with the reason. */
const KNOWN_ABSENT: Record<string, string> = {
    wallet: "no column on artists, and urlmap carries a placeholder url",
    ens: "wallet identity rather than an artist name; urlmap url is a placeholder",
};

async function main() {
    const conn = process.env.SUPABASE_DB_CONNECTION;
    if (!conn) throw new Error("SUPABASE_DB_CONNECTION is not set");
    const sql = postgres(conn, { max: 1 });

    const { PROFILE_LINK_COLUMNS, PLATFORM_DOMAINS, IDENTITY_ANCHOR_COLUMNS } =
        await import("@/server/utils/queries/vaultWebSearch");

    const rows = await sql<{ site_name: string }[]>`SELECT site_name FROM urlmap ORDER BY site_name`;
    const cols = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'artists'`;
    const isColumn = new Set(cols.map(c => c.column_name));

    const known = new Set<string>(PROFILE_LINK_COLUMNS as readonly string[]);
    const problems: string[] = [];

    for (const { site_name } of rows) {
        if (KNOWN_ABSENT[site_name]) continue;
        if (!isColumn.has(site_name)) {
            problems.push(`${site_name}: in urlmap but not a column on artists`);
            continue;
        }
        if (!known.has(site_name)) {
            problems.push(`${site_name}: a real column, and discovery does not know it exists`);
            continue;
        }
        if (!PLATFORM_DOMAINS[site_name]?.length) {
            // Without a domain the skip check silently contributes nothing for
            // this platform — the failure mode is invisible, which is the whole
            // reason this script exists.
            problems.push(`${site_name}: in PROFILE_LINK_COLUMNS with no PLATFORM_DOMAINS entry, so it does nothing`);
        }
    }

    // The other direction: a list naming something urlmap has never heard of.
    const inUrlmap = new Set(rows.map(r => r.site_name));
    for (const col of PROFILE_LINK_COLUMNS) {
        if (!inUrlmap.has(col)) problems.push(`${col}: classified here but not configured in urlmap`);
    }
    for (const col of IDENTITY_ANCHOR_COLUMNS) {
        if (!known.has(col)) problems.push(`${col}: an identity anchor that is not a known profile column`);
    }

    console.log(`urlmap platforms: ${rows.length}`);
    console.log(`known to discovery: ${PROFILE_LINK_COLUMNS.length}`);
    console.log(`used as identity anchors: ${IDENTITY_ANCHOR_COLUMNS.length}`);
    console.log(`deliberately absent: ${Object.keys(KNOWN_ABSENT).join(", ")}`);

    if (problems.length === 0) {
        console.log("\nEvery platform is classified.");
    } else {
        console.log(`\n${problems.length} PROBLEM(S):`);
        for (const p of problems) console.log(`  ! ${p}`);
    }
    await sql.end();
    process.exit(problems.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
