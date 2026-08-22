/**
 * Re-runs the relevance judge over an artist's ALREADY-APPROVED vault sources.
 *
 * Discovery judges a page once, at the moment it is found. When the judge learns
 * something new, every source approved before that stays as it was — so an
 * artist can be left with a source the current judge would never have accepted.
 *
 * That is not hypothetical. `lists-artist` was added after a marketplace
 * directory titled "Producers who worked with <artist>" had already been
 * approved on a real profile, and its OTHER producers' credits were being
 * written into his knowledge document as his own collaborators.
 *
 *   npx tsx scripts/rejudge-vault.ts <artistId|name> [--apply]
 *
 * Dry run by default: prints a verdict per source and changes nothing. --apply
 * rejects everything the judge no longer calls coverage, then rebuilds the
 * knowledge document so the change actually reaches the Ask section.
 *
 * Rejects rather than deletes — the row stays for audit, and rejection is
 * durable, so discovery will not re-offer it. DEV ONLY.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const PROD_REF = "cbabvmebugudeuylronz";

async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes("--apply");
    const target = args.find(a => a !== "--apply");
    if (!target) { console.error("usage: rejudge-vault.ts <artistId|name> [--apply]"); process.exit(1); }

    if ((process.env.SUPABASE_DB_CONNECTION ?? "").includes(PROD_REF)) {
        console.error("REFUSING: SUPABASE_DB_CONNECTION points at production.");
        process.exit(1);
    }

    const { db } = await import("@/server/db/drizzle");
    const { sql } = await import("drizzle-orm");
    const { judgeSourceRelevance, mentionDensity } = await import("@/server/utils/sourceRelevance");
    const { refreshArtistDoc } = await import("@/server/utils/artistDocService");
    // Same column list discovery uses, so the anchor here cannot drift from it.
    const { PROFILE_LINK_COLUMNS } = await import("@/server/utils/queries/vaultWebSearch");

    const isUuid = /^[0-9a-f-]{36}$/i.test(target);
    const found: any = await db.execute(isUuid
        ? sql`select * from artists where id = ${target}::uuid`
        : sql`select * from artists where name ilike ${target} limit 1`);
    const artist = (found.rows ?? found)[0];
    if (!artist) { console.error(`No artist matching "${target}"`); process.exit(1); }

    const rows: any = await db.execute(sql`
        select id, url, title, extracted_text from artist_vault_sources
        where artist_id = ${artist.id}::uuid and status = 'approved' order by url`);
    const sources = (rows.rows ?? rows) as { id: string; url: string; title: string | null; extracted_text: string | null }[];
    if (!sources.length) { console.log("No approved sources."); process.exit(0); }

    const identifiers = PROFILE_LINK_COLUMNS.flatMap((col: string) => {
        const v = artist[col];
        return typeof v === "string" && v ? [`${col}: ${v}`] : [];
    });

    console.log(`\n${artist.name} — re-judging ${sources.length} approved source(s)${apply ? "" : "  (DRY RUN)"}\n`);
    const verdicts = await judgeSourceRelevance(
        { name: artist.name, identifiers },
        sources.map(s => ({ url: s.url, title: s.title, text: s.extracted_text })),
    );

    const doomed: typeof sources = [];
    for (const s of sources) {
        const v = verdicts.get(s.url) ?? "undecided";
        const d = mentionDensity(s.extracted_text ?? "", artist.name, identifiers);
        // `undecided` is NEVER acted on — the judge failing must not delete an
        // artist's real press. Only an explicit negative verdict counts.
        const drop = v === "lists-artist" || v === "not-about-artist";
        if (drop) doomed.push(s);
        console.log(`  ${(drop ? "REJECT" : "keep  ")}  ${v.padEnd(17)} ${(d ? `${d.hits}/${d.total}` : "n/a").padEnd(9)} ${(s.title ?? s.url).slice(0, 62)}`);
    }

    if (!doomed.length) { console.log("\nNothing to change."); process.exit(0); }
    if (!apply) { console.log(`\n${doomed.length} would be rejected. Re-run with --apply.`); process.exit(0); }

    for (const s of doomed) {
        await db.execute(sql`update artist_vault_sources set status = 'rejected' where id = ${s.id}::uuid`);
    }
    console.log(`\nRejected ${doomed.length}. Rebuilding the knowledge document...`);
    console.log(await refreshArtistDoc(artist.id) ? "Document rebuilt." : "No document to rebuild.");
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
