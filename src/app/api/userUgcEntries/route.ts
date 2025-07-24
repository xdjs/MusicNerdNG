import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db/drizzle";
import { ugcresearch, artists } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";
// (artist images removed)

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Determine user
    const session = await getServerAuthSession();
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === "true" && process.env.NODE_ENV !== "production";

    let userId: string | null = null;
    if (session?.user?.id) {
      userId = session.user.id;
    } else if (walletlessEnabled) {
      // Special guest ID when wallet requirement disabled (local dev)
      userId = "00000000-0000-0000-0000-000000000000";
    }

    if (!userId) {
      return NextResponse.json([], { status: 200 });
    }

    // Fetch entries ordered by newest first (limit 200 to keep payload reasonable)
    const rows = await db
      .select({
        id: ugcresearch.id,
        artistId: ugcresearch.artistId,
        artistName: artists.name,
        siteName: ugcresearch.siteName,
        ugcUrl: ugcresearch.ugcUrl,
        createdAt: ugcresearch.createdAt,
        accepted: ugcresearch.accepted,
        dateProcessed: ugcresearch.dateProcessed,
        spotifyId: artists.spotify,
      })
      .from(ugcresearch)
      .leftJoin(artists, eq(artists.id, ugcresearch.artistId))
      .where(eq(ugcresearch.userId, userId))
      .orderBy(desc(ugcresearch.createdAt))
      .limit(200);

    return NextResponse.json(rows, { status: 200 });
  } catch (e) {
    console.error("[userUgcEntries] error", e);
    return NextResponse.json([], { status: 500 });
  }
} 