import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db/drizzle";
import { ugcresearch } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";

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

    const recent = await db
      .select()
      .from(ugcresearch)
      .where(eq(ugcresearch.userId, userId))
      .orderBy(desc(ugcresearch.updatedAt))
      .limit(3);

    return NextResponse.json(recent, { status: 200 });
  } catch (e) {
    console.error("[recentEdited] error", e);
    return NextResponse.json([], { status: 500 });
  }
} 