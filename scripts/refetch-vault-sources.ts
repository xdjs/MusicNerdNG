/**
 * One-off script to re-fetch page content for all vault sources.
 * Decodes HTML entities and updates title/snippet/extractedText.
 *
 * Usage: npx tsx scripts/refetch-vault-sources.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { fetchPageContent } from "@/server/utils/fetchPageContent";
import { sql, eq } from "drizzle-orm";

const client = postgres(process.env.SUPABASE_DB_CONNECTION!, { prepare: false });
const db = drizzle(client, { schema });

async function main() {
    const sources = await db.query.artistVaultSources.findMany();
    console.log(`Found ${sources.length} vault sources to refresh.\n`);

    for (const source of sources) {
        if (!source.url) {
            console.log(`  [skip] ${source.id} — no URL`);
            continue;
        }

        try {
            const content = await fetchPageContent(source.url);
            await db
                .update(schema.artistVaultSources)
                .set({
                    title: content.title,
                    snippet: content.snippet ?? null,
                    extractedText: content.extractedText,
                    updatedAt: sql`(now() AT TIME ZONE 'utc'::text)`,
                })
                .where(eq(schema.artistVaultSources.id, source.id));

            console.log(`  [ok] ${source.url} → "${content.title}"`);
        } catch (e: any) {
            console.error(`  [err] ${source.url} — ${e.message}`);
        }
    }

    console.log("\nDone.");
    process.exit(0);
}

main();
