/**
 * One-off: regenerate the broken AI-generated bios through the new factual pipeline.
 * Selects ONLY bios carrying an AI signature (citation links, leaked prompt
 * scaffolding, or an AI refusal) — never touches artist-written bios.
 *
 * Dry run (prints matches, writes nothing):  npx tsx scripts/backfill-ai-bios.ts
 * Live run (regenerates + writes to prod):    npx tsx scripts/backfill-ai-bios.ts --write
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";

// NOTE: `regenerateArtistBio` is dynamically imported inside main() *after*
// dotenv.config() runs. Its import chain pulls in `@/env`, which validates
// required env vars at module-load time — a static import would evaluate
// before dotenv populates process.env (ESM imports are hoisted).

const WRITE = process.argv.includes("--write");

const client = postgres(process.env.SUPABASE_DB_CONNECTION!, { prepare: false });
const db = drizzle(client, { schema });

// AI-signature predicate — must exactly mirror the spec's Part C selection.
// `%](http%` catches markdown citation links (a bare LIKE, so no regex
// paren-balancing hazards inside the template literal).
const AI_SIGNATURE = sql`(
  bio LIKE '%](http%'
  OR bio ILIKE '%utm_source=openai%'
  OR bio ILIKE '%Identify the artist%'
  OR bio ILIKE '%Retrieve verified information%'
  OR bio ILIKE '%Checklist:%'
  OR bio ILIKE '%I could not find%'
  OR bio ILIKE '%I''m sorry%'
)`;

async function main() {
  const rows = await db.execute<{ id: string; name: string; bio: string }>(
    sql`SELECT id, name, bio FROM artists WHERE ${AI_SIGNATURE} ORDER BY name`
  );
  const artists = rows as unknown as { id: string; name: string; bio: string }[];

  console.log(`Matched ${artists.length} AI-signature bios:\n`);
  for (const a of artists) {
    console.log(`  • ${a.name} (${a.id})`);
  }

  if (!WRITE) {
    console.log(`\nDRY RUN — nothing written. Re-run with --write to regenerate.`);
    await client.end();
    return;
  }

  const { regenerateArtistBio } = await import("@/server/utils/queries/artistBioQuery");

  console.log(`\n--write set. Regenerating ${artists.length} bios through the new pipeline…\n`);
  let ok = 0, failed = 0;
  for (const a of artists) {
    try {
      const bio = await regenerateArtistBio(a.id);
      if (bio) {
        ok++;
        console.log(`  [ok]   ${a.name}\n         → ${bio.slice(0, 120)}…`);
      } else {
        failed++;
        console.log(`  [FAIL] ${a.name} — generator returned null`);
      }
    } catch (e) {
      failed++;
      console.log(`  [FAIL] ${a.name} — ${(e as Error).message}`);
    }
    // small delay to respect Gemini rate limits
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`\nDone. ${ok} regenerated, ${failed} failed.`);
  await client.end();
}

// regenerateArtistBio opens the app's own pooled DB client (@/server/db/drizzle),
// separate from `client` above; its open pool can keep the process alive after
// client.end(). Exit explicitly so the script always terminates.
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
