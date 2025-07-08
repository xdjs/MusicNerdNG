import { db } from "@/server/db/drizzle";
import { sql } from "drizzle-orm";
import { eq, gte, lte, and } from "drizzle-orm";
import { artists, ugcresearch } from "@/server/db/schema";
import { DateRange } from "react-day-picker";
import { getServerAuthSession } from "@/server/auth";
import { getUserByWallet } from "@/server/utils/queries/userQueries";

export type LeaderboardEntry = {
    userId: string;
    wallet: string;
    username: string | null;
    email: string | null;
    artistsCount: number;
    ugcCount: number;
};

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
    try {
        const result = await db.execute<LeaderboardEntry>(sql`
            SELECT 
                u.id   AS "userId",
                u.wallet,
                u.username,
                u.email,
                (
                    SELECT COUNT(*)::int FROM artists a WHERE a.added_by = u.id
                ) AS "artistsCount",
                (
                    SELECT COUNT(*)::int FROM ugcresearch ug WHERE ug.user_id = u.id
                ) AS "ugcCount"
            FROM users u
            ORDER BY "ugcCount" DESC, "artistsCount" DESC
        `);
        return result;
    } catch (e) {
        console.error("error getting leaderboard", e);
        throw new Error("Error getting leaderboard");
    }
}

// Get leaderboard stats within a date range (inclusive)
export async function getLeaderboardInRange(fromIso: string, toIso: string): Promise<LeaderboardEntry[]> {
    try {
        const result = await db.execute<LeaderboardEntry>(sql`
            SELECT 
                u.id   AS "userId",
                u.wallet,
                u.username,
                u.email,
                (
                    SELECT COUNT(*)::int FROM artists a 
                    WHERE a.added_by = u.id 
                      AND a.created_at BETWEEN ${fromIso} AND ${toIso}
                ) AS "artistsCount",
                (
                    SELECT COUNT(*)::int FROM ugcresearch ug 
                    WHERE ug.user_id = u.id 
                      AND ug.created_at BETWEEN ${fromIso} AND ${toIso}
                ) AS "ugcCount"
            FROM users u
            ORDER BY "ugcCount" DESC, "artistsCount" DESC
        `);
        return result;
    } catch (e) {
        console.error("error getting leaderboard in range", e);
        throw new Error("Error getting leaderboard in range");
    }
} 

export async function getUgcStats() {
    const user = await getServerAuthSession();
    if (!user) throw new Error("Not authenticated");
    try {
        const ugcList = await db.query.ugcresearch.findMany({ where: eq(ugcresearch.userId, user.user.id) });
        return ugcList.length;
    } catch (e) {
        console.error("error getting user ugc stats", e);
    }
}

export async function getUgcStatsInRange(date: DateRange, wallet: string | null = null) {
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === "true" && process.env.NODE_ENV !== "production";

    let session = await getServerAuthSession();
    let userId: string;

    if (walletlessEnabled && !session) {
        userId = "00000000-0000-0000-0000-000000000000";
    } else {
        if (!session) throw new Error("Not authenticated");
        userId = session.user.id;
    }

    if (wallet) {
        const searchedUser = await getUserByWallet(wallet);
        if (!searchedUser) throw new Error("User not found");
        userId = searchedUser.id;
    }

    try {
        const ugcList = await db.query.ugcresearch.findMany({
            where: and(
                gte(ugcresearch.createdAt, date.from?.toISOString() ?? ""),
                lte(ugcresearch.createdAt, date.to?.toISOString() ?? ""),
                eq(ugcresearch.userId, userId)
            ),
        });
        const artistsList = await db.query.artists.findMany({
            where: and(
                gte(artists.createdAt, date.from?.toISOString() ?? ""),
                lte(artists.createdAt, date.to?.toISOString() ?? ""),
                eq(artists.addedBy, userId)
            ),
        });
        return { ugcCount: ugcList.length, artistsCount: artistsList.length };
    } catch (e) {
        console.error("error getting ugc stats for user in range", e);
    }
} 