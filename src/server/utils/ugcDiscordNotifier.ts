import { db } from "@/server/db/drizzle";
import { ugcresearch } from "@/server/db/schema";
import { sendDiscordMessage } from "@/server/utils/queries/discord";
import { eq } from "drizzle-orm";

// Discord role to ping when new UGC is waiting for review
const ADMIN_ROLE_ID = "1091088804028362944";
// Special marker used in ugcresearch.site_name so we can store a single row with the
// timestamp of the last Discord notification that went out.
const SENTINEL_SITE_NAME = "ugc_discord_ping";

/**
 * Checks whether we should ping Discord about new pending-UGC submissions.
 *
 * The function keeps exactly one sentinel row in the `ugcresearch` table whose
 * `created_at` field stores the timestamp of the most recent notification. If
 * the time elapsed since that value exceeds `TIMEOUT_COUNT` (seconds, defined
 * in the environment), we send a message and update the timestamp. Otherwise
 * we stay silent so admins are not spammed.
 *
 * Usage: call this immediately after inserting a new pending UGC row.
 */
export async function maybePingDiscordForPendingUGC() {
    const timeoutSec = parseInt(process.env.TIMEOUT_COUNT ?? "900", 10); // default 15 min
    const now = new Date();

    // 1) Read the sentinel row (should be at most one)
    const sentinel = await db.query.ugcresearch.findFirst({
        where: eq(ugcresearch.siteName, SENTINEL_SITE_NAME),
    });

    const lastSent = sentinel?.createdAt ? new Date(sentinel.createdAt as string) : null;
    const shouldNotify = !lastSent || (now.getTime() - lastSent.getTime() > timeoutSec * 1000);

    if (!shouldNotify) {
        // Within the cooldown window – exit without sending.
        return;
    }

    // 2) Send the Discord ping
    const message = `<@&${ADMIN_ROLE_ID}> New UGC awaiting review!`;
    await sendDiscordMessage(message);

    // 3) Upsert the sentinel row so `created_at` reflects this notification time.
    if (sentinel) {
        await db
            .update(ugcresearch)
            .set({ createdAt: now.toISOString() })
            .where(eq(ugcresearch.id, sentinel.id));
    } else {
        await db.insert(ugcresearch).values({
            siteName: SENTINEL_SITE_NAME,
            createdAt: now.toISOString(),
            accepted: true,
        });
    }
} 