import { NextResponse } from "next/server";
import { getLeaderboard } from "@/server/utils/queriesTS";

export const revalidate = 60; // cache for 1 minute

export async function GET() {
    try {
        // Check if walletless mode is enabled
        const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';
        
        // In walletless mode, we allow access without authentication
        // In normal mode, this would typically check for authentication
        
        const leaderboard = await getLeaderboard();
        return NextResponse.json(leaderboard, { status: 200 });
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        return NextResponse.json(
            { error: "Failed to fetch leaderboard", details: error instanceof Error ? error.message : "Unknown error" },
            { status: 500 }
        );
    }
} 