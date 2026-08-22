/**
 * Run vault discovery for an artist ahead of time, the way approval-time
 * discovery does in production.
 *
 * The onboarding chat re-runs discovery only as a fallback, and it has to bound
 * that on a turn deadline — but a grounded Gemini search plus the verification
 * fetches routinely takes ~60s, longer than any single turn can wait. Running it
 * here first means the vault step finds sources already waiting, which is the
 * production path anyway.
 *
 * Usage: npx tsx scripts/discover-vault.ts <artist-uuid|artist name>
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { sql, eq } from "drizzle-orm";

const PROD_REF = "cbabvmebugudeuylronz";
const CONN = process.env.SUPABASE_DB_CONNECTION!;
if (!CONN) { console.error("No SUPABASE_DB_CONNECTION in .env.local"); process.exit(1); }
if (CONN.includes(PROD_REF)) {
    console.error(`REFUSING: .env.local points at production (${PROD_REF}).`);
    process.exit(1);
}

const target = process.argv[2];
if (!target) { console.error("Pass an artist uuid or name"); process.exit(1); }

const client = postgres(CONN, { prepare: false });
const db = drizzle(client, { schema });

async function main() {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(target);
    const [artist] = await db
        .select({ id: schema.artists.id, name: schema.artists.name })
        .from(schema.artists)
        .where(isUuid ? eq(schema.artists.id, target) : sql`lower(${schema.artists.name}) = lower(${target})`);
    if (!artist) { console.error(`No artist matched '${target}'`); process.exit(1); }

    const { searchAndPopulateVault } = await import("@/server/utils/queries/vaultWebSearch");
    const started = Date.now();
    const inserted = await searchAndPopulateVault(artist.id);
    console.log(`\n${artist.name}: ${inserted.length} source(s) kept in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    await client.end();
    // The work is done in seconds; without this the process hangs forever.
    // Anything importing an app module also pulls in `@/server/db/drizzle`,
    // whose module-level connection pool nothing closes, so the event loop
    // never drains. Three orphaned discovery runs were still resident after
    // "finishing" in 4.2 seconds, which is where "discovery takes 10 minutes"
    // came from — it does not, it just never exits.
    process.exit(0);
}

main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
