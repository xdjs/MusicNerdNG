"use client";

import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@/app/actions/serverActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

type RangeKey = "today" | "week" | "month" | "all";

export default function Leaderboard({ highlightIdentifier }: { highlightIdentifier?: string }) {
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showTopBtn, setShowTopBtn] = useState(false);
    const [range, setRange] = useState<RangeKey>("all");

    function getRangeDates(r: RangeKey) {
        const now = new Date();
        switch (r) {
            case "today":
                const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                return { from: startToday, to: now };
            case "week":
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                return { from: weekAgo, to: now };
            case "month":
                const monthAgo = new Date(now);
                monthAgo.setMonth(now.getMonth() - 1);
                return { from: monthAgo, to: now };
            default:
                return null;
        }
    }

    function buildUrl() {
        const dates = getRangeDates(range);
        if (dates) {
            const from = dates.from.toISOString();
            const to = dates.to.toISOString();
            return `/api/leaderboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        }
        return "/api/leaderboard";
    }

    useEffect(() => {
        async function fetchLeaderboard() {
            if ((getRangeDates(range)?.from && !getRangeDates(range)?.to) || (!getRangeDates(range)?.from && getRangeDates(range)?.to)) {
                setLeaderboard([]);
                return;
            }
            try {
                setLoading(true);
                setError(null);
                const response = await fetch(buildUrl());
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
    }, [range]);

    // Show/hide "back to top" button based on scroll position
    useEffect(() => {
        function handleScroll() {
            setShowTopBtn(window.scrollY > 400);
        }
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const headingSuffixMap: Record<RangeKey, string> = {
        today: "Today",
        week: "Last Week",
        month: "Last Month",
        all: "All Time",
    };

    if (loading) {
        return (
            <Card>
                <CardHeader className="text-center">
                    <CardTitle>Leaderboard</CardTitle>
                    {/* Range selector buttons */}
                    <div className="grid grid-cols-4 gap-2 mt-2 w-full">
                        {(["today", "week", "month", "all"] as RangeKey[]).map((key) => (
                            <Button
                                key={key}
                                size="sm"
                                variant={range === key ? "default" : "secondary"}
                                className="bg-gray-200 text-black hover:bg-gray-300 flex items-center justify-center"
                                onClick={() => setRange(key)}
                            >
                                {range === key && <Check className="w-4 h-4 mr-1" />} {headingSuffixMap[key]}
                            </Button>
                        ))}
                    </div>
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
                <CardHeader className="text-center">
                    <CardTitle>Leaderboard</CardTitle>
                    <div className="grid grid-cols-4 gap-2 mt-2 w-full">
                        {(["today", "week", "month", "all"] as RangeKey[]).map((key) => (
                            <Button
                                key={key}
                                size="sm"
                                variant={range === key ? "default" : "secondary"}
                                className="bg-gray-200 text-black hover:bg-gray-300 flex items-center justify-center"
                                onClick={() => setRange(key)}
                            >
                                {range === key && <Check className="w-4 h-4 mr-1" />} {headingSuffixMap[key]}
                            </Button>
                        ))}
                    </div>
                </CardHeader>
                <CardContent>
                    <p className="text-red-500">{error}</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <>
        <Card className="max-w-3xl mx-auto">
            <CardHeader className="text-center">
                <CardTitle>Leaderboard</CardTitle>
                <div className="grid grid-cols-4 gap-2 mt-2 w-full">
                    {(["today", "week", "month", "all"] as RangeKey[]).map((key) => (
                        <Button
                            key={key}
                            size="sm"
                            variant={range === key ? "default" : "secondary"}
                            className="bg-gray-200 text-black hover:bg-gray-300 flex items-center justify-center"
                            onClick={() => setRange(key)}
                        >
                            {range === key && <Check className="w-4 h-4 mr-1" />} {headingSuffixMap[key]}
                        </Button>
                    ))}
                </div>
            </CardHeader>
            <CardContent>
                {/* column headings (hidden on mobile) */}
                <div className="hidden sm:grid grid-cols-3 font-semibold text-base text-muted-foreground text-center sticky top-0 z-20 bg-card py-2 mb-2">
                    <span className="justify-self-start text-left">User</span>
                    <span>UGC Added</span>
                    <span className="justify-self-end text-right">Artists Added</span>
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
                                    "p-3 border rounded-md transition-colors",
                                    isHighlighted ? "ring-2 ring-primary bg-accent sticky top-12 z-10" : "hover:bg-accent/40"
                                )}
                            >
                                {/* Mobile layout */}
                                <div className="flex flex-col sm:hidden space-y-1">
                                    {/* Username row */}
                                    <div className="flex items-center space-x-2 overflow-hidden">
                                        <span className={
                                            `w-8 font-semibold text-center text-muted-foreground ${index < 3 ? 'text-2xl' : 'text-sm'}`
                                        }>
                                            {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                                        </span>
                                        <p className="font-medium truncate max-w-[200px] text-lg">
                                            {entry.username || entry.email || entry.wallet.slice(0, 8) + "..."}
                                        </p>
                                    </div>

                                    {/* UGC row */}
                                    <div className="flex justify-between pl-10">
                                        <span className="text-muted-foreground">UGC Added</span>
                                        <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary">
                                            {entry.ugcCount}
                                        </Badge>
                                    </div>

                                    {/* Artists row */}
                                    <div className="flex justify-between pl-10">
                                        <span className="text-muted-foreground">Artists Added</span>
                                        <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary">
                                            {entry.artistsCount}
                                        </Badge>
                                    </div>
                                </div>

                                {/* Desktop layout */}
                                <div className="hidden sm:grid grid-cols-3 items-center">
                                    {/* User col */}
                                    <div className="flex items-center space-x-2 overflow-hidden">
                                        <span className={
                                            `w-8 font-semibold text-center text-muted-foreground ${index < 3 ? 'text-2xl' : 'text-sm'}`
                                        }>
                                            {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                                        </span>
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
        {showTopBtn && (
            <Button
                size="icon"
                variant="secondary"
                className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                aria-label="Back to top"
            >
                ↑
            </Button>
        )}
        </>
    );
} 