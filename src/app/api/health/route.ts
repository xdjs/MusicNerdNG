import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { isSupabaseStorageConfigured } from "@/server/lib/supabase";
import { db } from "@/server/db/drizzle";

export const dynamic = "force-dynamic";

/**
 * Deployment health check. Reports whether the RUNTIME environment is actually
 * wired — not whether the code is correct. Mocked unit tests can't catch a
 * missing env var on the deployed host; a post-deploy smoke test hitting this
 * endpoint against the live URL can (see health.smoke.test.ts).
 *
 * Returns only booleans + a timestamp — never secrets, values, or connection
 * strings. 200 when all critical checks pass, 503 otherwise (so a post-deploy
 * check / uptime monitor fails loudly).
 */
export async function GET() {
    // Storage: are the Supabase service-role credentials present? (The exact gap
    // that broke profile-photo + vault uploads in the deployed environments.)
    const storage = isSupabaseStorageConfigured();

    // Database: can we actually round-trip a trivial query as the app's role?
    let database = false;
    try {
        await db.execute(sql`select 1`);
        database = true;
    } catch (err) {
        console.error("[health] database ping failed:", err);
    }

    const ok = storage && database;
    return NextResponse.json(
        {
            ok,
            checks: { storage, database },
            timestamp: new Date().toISOString(),
        },
        { status: ok ? 200 : 503 }
    );
}
