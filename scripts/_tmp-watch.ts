import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
const ID = "50f23458-df64-4381-8042-7333e8b64531";
async function main() {
  const { db } = await import("@/server/db/drizzle");
  const { sql } = await import("drizzle-orm");
  const a: any = await db.execute(sql`select spotify, deezer, instagram, x, youtube, soundcloud, bandcamp, twitch from artists where id=${ID}::uuid`);
  const row = (a.rows ?? a)[0];
  console.log(`links now: ${Object.entries(row).filter(([,v])=>v).map(([k])=>k).join(", ") || "(none)"}`);
  const s: any = await db.execute(sql`
    select status::text, count(*) as n, count(published_at) as dated
    from artist_vault_sources where artist_id=${ID}::uuid group by status`);
  const rows = s.rows ?? s;
  console.log(`sources: ${rows.length ? rows.map((r:any)=>`${r.status}=${r.n} (${r.dated} dated)`).join("  ") : "0"}`);
  const st: any = await db.execute(sql`select count(*) as n from artist_onboarding_steps where artist_id=${ID}::uuid`);
  const d: any = await db.execute(sql`select count(*) as n from artist_docs where artist_id=${ID}::uuid`);
  console.log(`steps=${(st.rows??st)[0].n}  docs=${(d.rows??d)[0].n}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
