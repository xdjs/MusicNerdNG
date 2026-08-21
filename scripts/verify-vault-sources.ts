/**
 * Re-verify vault sources that are already stored, and repair the database.
 *
 * These rows were written before verification existed: a language model was asked
 * to type URLs and descriptions, and whatever it typed was stored as a source.
 * Some of those URLs never existed (three slug variants of one real article; a
 * domain one letter off from the real one; five Apple Music IDs of which one
 * resolves), and some descriptions describe pages that were never read.
 *
 * This applies exactly the gate `searchAndPopulateVault` now applies at write
 * time, to rows that predate it:
 *
 *   dead      → deleted. The URL does not resolve, 404s, or the page is a parked
 *               domain / soft-404 / not about this artist at all.
 *   lead      → kept, extracted_text cleared. Real URL we could not read (bot
 *               wall, JS-only). Shown to the artist, never cited.
 *   verified  → kept, extracted_text + page-authored title/snippet written.
 *
 * Usage:
 *   npx tsx scripts/verify-vault-sources.ts <artist-uuid|artist name>
 *   npx tsx scripts/verify-vault-sources.ts --all
 *   ... add --dry-run to report without writing.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { fetchPageContent } from "@/server/utils/fetchPageContent";
import { classifyFetchedSource, isGroundingRedirect } from "@/server/utils/sourceVerification";
import { sql, eq } from "drizzle-orm";

const PROD_REF = "cbabvmebugudeuylronz";
const CONN = process.env.SUPABASE_DB_CONNECTION!;
if (!CONN) { console.error("No SUPABASE_DB_CONNECTION in .env.local"); process.exit(1); }
if (CONN.includes(PROD_REF)) {
    console.error(`REFUSING: .env.local points at production (${PROD_REF}).`);
    process.exit(1);
}

const client = postgres(CONN, { prepare: false });
const db = drizzle(client, { schema });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const all = args.includes("--all");
const target = args.find(a => !a.startsWith("--"));

async function main() {
    if (!all && !target) {
        console.error("Pass an artist uuid/name, or --all");
        process.exit(1);
    }

    let artistIds: { id: string; name: string | null }[];
    if (all) {
        artistIds = await db.select({ id: schema.artists.id, name: schema.artists.name }).from(schema.artists);
    } else {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(target!);
        const rows = await db
            .select({ id: schema.artists.id, name: schema.artists.name })
            .from(schema.artists)
            .where(isUuid ? eq(schema.artists.id, target!) : sql`lower(${schema.artists.name}) = lower(${target!})`);
        if (rows.length === 0) { console.error(`No artist matched '${target}'`); process.exit(1); }
        artistIds = rows;
    }

    let totals = { verified: 0, lead: 0, dead: 0 };

    for (const artist of artistIds) {
        const sources = await db.query.artistVaultSources.findMany({
            where: eq(schema.artistVaultSources.artistId, artist.id),
        });
        // Only web sources are verifiable this way; uploaded files have no URL to fetch.
        const webSources = sources.filter(s => s.url && !s.filePath);
        if (webSources.length === 0) continue;

        console.log(`\n${artist.name ?? artist.id} — ${webSources.length} web source(s)`);
        const artistName = artist.name ?? "";

        // Bounded concurrency: these are external fetches and there can be dozens.
        const CONCURRENCY = 6;
        for (let i = 0; i < webSources.length; i += CONCURRENCY) {
            const batch = webSources.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (source) => {
                // A grounding redirect is dead by definition — the token expires and the
                // URL 404s, whatever it may have resolved to when it was stored.
                if (isGroundingRedirect(source.url!)) {
                    totals.dead++;
                    console.log(`  DEAD    (grounding redirect) ${source.url!.slice(0, 80)}`);
                    if (!dryRun) {
                        await db.delete(schema.artistVaultSources).where(eq(schema.artistVaultSources.id, source.id));
                    }
                    return;
                }

                const page = await fetchPageContent(source.url!, { timeoutMs: 8000 });
                const verdict = classifyFetchedSource(page, artistName);
                totals[verdict]++;

                if (verdict === "dead") {
                    console.log(`  DEAD    (status ${page.status}) ${source.url!.slice(0, 80)}`);
                    if (!dryRun) {
                        await db.delete(schema.artistVaultSources).where(eq(schema.artistVaultSources.id, source.id));
                    }
                    return;
                }

                if (verdict === "lead") {
                    console.log(`  LEAD    (status ${page.status}) ${source.url!.slice(0, 80)}`);
                    if (!dryRun) {
                        await db.update(schema.artistVaultSources).set({
                            // Clearing this is the point: a non-empty extracted_text is what
                            // makes a row citable, and we did not read this page.
                            extractedText: null,
                            ogImage: page.ogImage ?? source.ogImage,
                            updatedAt: sql`(now() AT TIME ZONE 'utc'::text)`,
                        }).where(eq(schema.artistVaultSources.id, source.id));
                    }
                    return;
                }

                console.log(`  OK      ${source.url!.slice(0, 80)}`);
                if (!dryRun) {
                    await db.update(schema.artistVaultSources).set({
                        title: page.title,
                        snippet: page.snippet ?? source.snippet,
                        extractedText: page.extractedText,
                        ogImage: page.ogImage ?? source.ogImage,
                        updatedAt: sql`(now() AT TIME ZONE 'utc'::text)`,
                    }).where(eq(schema.artistVaultSources.id, source.id));
                }
            }));
        }
    }

    console.log(`\n${dryRun ? "[dry run] " : ""}verified ${totals.verified} · leads ${totals.lead} · dead ${totals.dead}`);
    await client.end();
}

main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
