import { NextRequest } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db/drizzle";
import { ugcresearch, artists } from "@/server/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { musicPlatformData } from "@/server/utils/musicPlatform";
import type { Artist } from "@/server/db/DbTypes";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let userId: string | null = searchParams.get("userId");

    if (!userId) {
      // Fallback to session-based lookup
      const session = await getServerAuthSession();
      if (session?.user?.id) {
        userId = session.user.id;
      }
    }

    if (!userId) {
      return Response.json([]);
    }

    // Fetch last 20 approved edits, then dedupe by artistId to pick latest 3 unique artists
    const rows = await db
      .select({
        ugcId: ugcresearch.id,
        artistId: ugcresearch.artistId,
        updatedAt: ugcresearch.updatedAt,
        artistName: artists.name,
        spotifyId: artists.spotify,
      deezerId: artists.deezer,
      })
      .from(ugcresearch)
      .leftJoin(artists, eq(artists.id, ugcresearch.artistId))
      .where(and(eq(ugcresearch.userId, userId), eq(ugcresearch.accepted, true)))
      .orderBy(desc(ugcresearch.updatedAt))
      .limit(20);

    const unique: Record<string, (typeof rows)[number]> = {};
    for (const row of rows) {
      if (row.artistId && !unique[row.artistId]) {
        unique[row.artistId] = row;
      }
      if (Object.keys(unique).length === 3) break;
    }

    // Enrich with platform images
    const enriched = await Promise.all(
      Object.values(unique).map(async (row) => {
        let imageUrl: string | null = null;
        if (row.deezerId || row.spotifyId) {
          try {
            const partialArtist = { deezer: row.deezerId, spotify: row.spotifyId } as Artist;
            imageUrl = await musicPlatformData.getArtistImage(partialArtist);
          } catch {
            // ignore platform image errors
          }
        }
        return { ...row, imageUrl };
      })
    );

    return Response.json(enriched);
  } catch (error) {
    console.error("[recentEdited] error", error);
    return Response.json([]);
  }
}
