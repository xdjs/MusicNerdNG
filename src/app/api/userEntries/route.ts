import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db/drizzle";
import { ugcresearch, artists } from "@/server/db/schema";
import { desc, eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PER_PAGE = 10;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pageParam = parseInt(searchParams.get("page") ?? "1", 10);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

    const session = await getServerAuthSession();
    const walletlessEnabled =
      process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === "true" &&
      process.env.NODE_ENV !== "production";

    let userId: string | null = null;

    if (session && session.user?.id) {
      userId = session.user.id;
    } else if (walletlessEnabled) {
      // Guest user – use sentinel UUID so we can still show demo data for guest profile
      userId = "00000000-0000-0000-0000-000000000000";
    }

    if (!userId) {
      return NextResponse.json({ entries: [], total: 0, pageCount: 0 }, { status: 200 });
    }

    // Total count for pagination controls
    const total = (
      await db.query.ugcresearch.findMany({
        where: and(eq(ugcresearch.userId, userId), eq(ugcresearch.accepted, true)),
      })
    ).length;
    const pageCount = Math.ceil(total / PER_PAGE);
    const offset = (page - 1) * PER_PAGE;

    const rows = await db
      .select({
        id: ugcresearch.id,
        createdAt: ugcresearch.createdAt,
        siteName: ugcresearch.siteName,
        ugcUrl: ugcresearch.ugcUrl,
        accepted: ugcresearch.accepted,
        artistName: artists.name,
      })
      .from(ugcresearch)
      .leftJoin(artists, eq(artists.id, ugcresearch.artistId))
      .where(and(eq(ugcresearch.userId, userId), eq(ugcresearch.accepted, true)))
      .orderBy(desc(ugcresearch.createdAt))
      .limit(PER_PAGE)
      .offset(offset);

    return NextResponse.json({ entries: rows, total, pageCount }, { status: 200 });
  } catch (e) {
    console.error("[userEntries] error", e);
    return NextResponse.json({ entries: [], total: 0, pageCount: 0 }, { status: 500 });
  }
} 