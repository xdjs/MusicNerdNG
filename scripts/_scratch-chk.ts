import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
const rowsOf = (r: any) => (Array.isArray(r?.rows) ? r.rows : Array.isArray(r) ? r : []) as any[];
const PETE = "50f23458-df64-4381-8042-7333e8b64531";
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Candidate rule: the "role" is really another @handle from the same caption
 *  — a venue, a brand, an event — not a job this person did. */
function roleIsAnotherHandle(role: string, subject: string, quote: string): string | null {
    const handles = [...quote.matchAll(/@([A-Za-z0-9._]{4,})/g)].map(m => m[1]);
    const r = fold(role);
    if (!r) return null;
    for (const h of handles) {
        const fh = fold(h);
        if (fh.length < 4 || fh === fold(subject)) continue;
        if (r.includes(fh)) return h;
    }
    return null;
}

async function main() {
    const { db } = await import("../src/server/db/drizzle");
    const { sql } = await import("drizzle-orm");
    const rows = rowsOf(await db.execute(sql`
        select subject, label, quote from artist_social_credits
        where artist_id = ${PETE}::uuid and kind='credit'`));
    const flagged = rows.map(r => ({ ...r, hit: roleIsAnotherHandle(String(r.label), String(r.subject), String(r.quote)) }))
                        .filter(r => r.hit);
    console.log(`total credits: ${rows.length}`);
    console.log(`would be rejected: ${flagged.length}  (${(flagged.length / rows.length * 100).toFixed(1)}%)`);
    const seen = new Set<string>();
    console.log("\n=== sample of what it rejects ===");
    for (const f of flagged) {
        const k = `${f.subject}|${f.label}`;
        if (seen.has(k)) continue; seen.add(k);
        if (seen.size > 12) break;
        console.log(`  subject=${String(f.subject).padEnd(18)} role=${JSON.stringify(f.label)}  (matched @${f.hit})`);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
