"use client";

import { useEffect, useState } from "react";
import { LeaderboardEntry } from "@/server/utils/queriesTS";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default function Leaderboard({ highlightIdentifier }: { highlightIdentifier?: string }) {
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchLeaderboard() {
            try {
                setLoading(true);
                const response = await fetch('/api/leaderboard');
                if (!response.ok) {
                    throw new Error('Failed to fetch leaderboard');
                }
                const data = await response.json();
                setLeaderboard(data);
            } catch (err) {
                setError("Failed to load leaderboard");
                console.error("Error fetching leaderboard:", err);
            } finally {
                setLoading(false);
            }
        }

        fetchLeaderboard();
    }, []);

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Leaderboard</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Loading leaderboard...</p>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Leaderboard</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-red-500">{error}</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="max-w-3xl mx-auto">
            <CardHeader className="text-center">
                <CardTitle>Leaderboard</CardTitle>
            </CardHeader>
            <CardContent>
                {/* column headings */}
                <div className="grid grid-cols-3 font-semibold text-base text-muted-foreground sticky top-0 z-20 bg-card py-2">
                    <span className="justify-self-start">User</span>
                    <span className="justify-self-center">UGC Added</span>
                    <span className="justify-self-end">Artists Added</span>
                </div>

                <div className="space-y-2">
                    {leaderboard.map((entry, index) => {
                        const identifierLc = highlightIdentifier?.toLowerCase();
                        const isHighlighted = identifierLc && (
                            entry.wallet?.toLowerCase() === identifierLc ||
                            (entry.username ?? '').toLowerCase() === identifierLc ||
                            (entry.email ?? '').toLowerCase() === identifierLc
                        );
                        return (
                            <div
                                key={entry.userId}
                                className={cn(
                                    "grid grid-cols-3 items-center p-3 border rounded-md transition-colors",
                                    isHighlighted ? "ring-2 ring-primary bg-accent sticky top-12 z-10" : "hover:bg-accent/40"
                                )}
                            >
                                {/* User col */}
                                <div className="flex items-center space-x-2 overflow-hidden">
                                    <span className="w-8 text-sm font-semibold text-muted-foreground">{index + 1}</span>
                                    <div className="truncate">
                                        <p className="font-medium truncate max-w-[200px] text-lg">
                                            {entry.username || entry.email || entry.wallet.slice(0, 8) + "..."}
                                        </p>
                                    </div>
                                </div>

                                {/* UGC count */}
                                <div className="text-center text-lg">
                                    <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary">
                                        {entry.ugcCount}
                                    </Badge>
                                </div>

                                {/* Artist count */}
                                <div className="text-right text-lg">
                                    <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary">
                                        {entry.artistsCount}
                                    </Badge>
                                </div>
                            </div>
                        );
                    })}
                    {leaderboard.length === 0 && (
                        <p className="text-center text-muted-foreground py-8">
                            No users have added artists yet. Be the first!
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
} 