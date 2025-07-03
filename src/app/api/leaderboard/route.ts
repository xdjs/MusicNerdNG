import { NextResponse, NextRequest } from "next/server";
import { getLeaderboard, getLeaderboardInRange } from "@/server/utils/queriesTS";

export const revalidate = 60; // cache for 1 minute

export async function GET(request: NextRequest | Request) {
    try {
        // Check if walletless mode is enabled
        const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';
        
        // In walletless mode, we allow access without authentication
        // In normal mode, this would typically check for authentication
        
        const urlString = request.url;
        const { searchParams } = new URL(urlString);
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        let leaderboard;

        if (from && to) {
            leaderboard = await getLeaderboardInRange(from, to);
        } else {
            leaderboard = await getLeaderboard();
        }
        return NextResponse.json(leaderboard, { status: 200 });
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        return NextResponse.json(
            { error: "Failed to fetch leaderboard", details: error instanceof Error ? error.message : "Unknown error" },
            { status: 500 }
        );
    }
} 