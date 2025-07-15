import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db/drizzle";
import { ugcresearch } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";

type RespItem = {
  artistId: string;
  name: string | null;
};

export async function GET() {
  try {
    const session = await getServerAuthSession();
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';

    let userId: string | null = null;
    if (session && session.user?.id) {
      userId = session.user.id;
    } else if (walletlessEnabled) {
      userId = "00000000-0000-0000-0000-000000000000"; // guest
    }

    if (!userId) {
      return NextResponse.json([], { status: 200 });
    }

    const rows = await db.query.ugcresearch.findMany({
      where: eq(ugcresearch.userId, userId),
      orderBy: desc(ugcresearch.updatedAt),
      with: { ugcArtist: true },
      limit: 15, // grab extra to dedupe
    });

    const unique: RespItem[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const artistId = row.artistId;
      if (!artistId) continue;
      if (seen.has(artistId)) continue;
      seen.add(artistId);
      unique.push({ artistId, name: (row as any).ugcArtist?.name ?? null });
      if (unique.length >= 3) break;
    }

    return NextResponse.json(unique, { status: 200 });
  } catch (e) {
    console.error("[recentEdited] error", e);
    return NextResponse.json([], { status: 500 });
  }
} 