"use client";

import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@/app/actions/serverActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

type RangeKey = "today" | "week" | "month" | "all";

type RecentItem = {
    ugcId: string;
    artistId: string | null;
    artistName: string | null;
    updatedAt: string | null;
    imageUrl: string | null;
};

function LeaderboardRow({ entry, index, highlightIdentifier }: { entry: LeaderboardEntry; index: number; highlightIdentifier?: string }) {
    const [recent, setRecent] = useState<RecentItem[] | null>(null);
    const [loadingRec, setLoadingRec] = useState(false);

    const identifierLc = highlightIdentifier?.toLowerCase();
    const isHighlighted = identifierLc && (
        entry.wallet?.toLowerCase() === identifierLc ||
        (entry.username ?? '').toLowerCase() === identifierLc ||
        (entry.email ?? '').toLowerCase() === identifierLc
    );

    async function fetchRecent() {
        if (recent || loadingRec) return;
        setLoadingRec(true);
        try {
            const resp = await fetch(`/api/recentEdited?userId=${entry.userId}`);
            if (resp.ok) {
                const data = await resp.json();
                setRecent(data);
            }
        } catch (e) {
            console.error('Error fetching recent edits for user', e);
        } finally {
            setLoadingRec(false);
        }
    }

    const [showRecent, setShowRecent] = useState(false);

    return (
        <div
            id={isHighlighted ? "leaderboard-current-user" : undefined}
            onMouseEnter={() => { setShowRecent(true); fetchRecent(); }}
            onMouseLeave={() => setShowRecent(false)}
            className={cn(
                        "p-3 border rounded-md transition-colors scroll-mt-12",
                        isHighlighted ? "ring-2 ring-primary bg-accent sticky top-12 z-10" : "hover:bg-accent/40"
                    )}
        >
            {/* Mobile layout */}
            <div className="flex flex-col sm:hidden space-y-1">
                        {/* Username row */}
                        <div className="flex items-center space-x-2 overflow-hidden">
                            <span className={`w-8 font-semibold text-center text-muted-foreground ${index < 3 ? 'text-2xl' : 'text-sm'}`}>
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
                            <span className={`w-8 font-semibold text-center text-muted-foreground ${index < 3 ? 'text-2xl' : 'text-sm'}`}>
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

                    {/* Recently Added Artists inline expansion */}
                    {showRecent && (
                        <div className="mt-4">
                            <p className="font-semibold text-center mb-2">{(entry.username || entry.email || entry.wallet.slice(0,8)+"...")}&#39;s Recently Edited</p>
                            {loadingRec && <p className="text-sm text-muted-foreground text-center">Loading...</p>}
                            {recent && recent.length ? (
                                <ul className="grid grid-cols-3 gap-4 justify-items-center">
                                    {recent.map(r => (
                                        <li key={r.artistId ?? r.ugcId} className="w-full flex flex-col items-center">
                                            <Link href={`/artist/${r.artistId ?? ''}`} className="flex flex-col items-center gap-1 hover:underline w-full">
                                                <img src={r.imageUrl || "/default_pfp_pink.png"} alt="artist" className="h-10 w-10 rounded-full object-cover" />
                                                <span className="text-xs truncate max-w-[80px] text-center">{r.artistName ?? 'Unknown Artist'}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            ) : !loadingRec ? (
                                <p className="text-sm text-muted-foreground text-center">No recent artists</p>
                            ) : null}
                        </div>
                    )}
                </div>
        );
}

export default function Leaderboard({ highlightIdentifier, onRangeChange }: { highlightIdentifier?: string; onRangeChange?: (range: RangeKey) => void }) {
    const PER_PAGE = 10;
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showTopBtn, setShowTopBtn] = useState(false);
    const [range, setRange] = useState<RangeKey>("today");
    const [page, setPage] = useState(1);
    const [pageCount, setPageCount] = useState(1);

    // Notify parent whenever the range changes (including initial mount)
    useEffect(() => {
        onRangeChange?.(range);
    }, [range, onRangeChange]);

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
        const params = new URLSearchParams();
        const dates = getRangeDates(range);
        if (dates) {
            params.set("from", dates.from.toISOString());
            params.set("to", dates.to.toISOString());
        }
        params.set("page", page.toString());
        params.set("perPage", PER_PAGE.toString());
        return `/api/leaderboard?${params.toString()}`;
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
                if (Array.isArray(data)) {
                    // legacy response (no pagination)
                    setLeaderboard(data);
                    setPageCount(1);
                } else {
                    setLeaderboard(data.entries);
                    setPageCount(data.pageCount ?? 1);
                }
            } catch (err) {
                setError("Failed to load leaderboard");
                console.error("Error fetching leaderboard:", err);
            } finally {
                setLoading(false);
            }
        }

        fetchLeaderboard();
    }, [range, page]);

    // Show/hide "back to top" button based on scroll position
    useEffect(() => {
        function handleScroll() {
            setShowTopBtn(window.scrollY > 400);
        }
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    // Reset to page 1 whenever range changes
    useEffect(() => {
        setPage(1);
    }, [range]);

    const headingLabelMap: Record<RangeKey, string> = {
        today: "Today",
        week: "Last Week",
        month: "Last Month",
        all: "All Time",
    };

    if (loading) {
        return (
            <Card className="max-w-3xl mx-auto">
                <CardHeader className="text-center">
                    <CardTitle className="mb-5">Leaderboard</CardTitle>
                    {/* Range selector buttons */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full mt-6 mb-4">
                        {(["today", "week", "month", "all"] as RangeKey[]).map((key) => (
                            <Button
                                key={key}
                                size="sm"
                                variant={range === key ? "default" : "secondary"}
                                className={cn("w-full py-1 px-2 text-[0.7rem] leading-tight sm:text-sm", range === key ? "bg-primary text-white" : "bg-gray-200 text-black hover:bg-gray-300")}
                                onClick={() => setRange(key)}
                            >
                                {range === key && <Check className="inline h-4 w-4 mr-1" />}
                                {headingLabelMap[key]}
                            </Button>
                        ))}
                    </div>
                </CardHeader>
                <CardContent>
                    <p className="text-center">Loading...</p>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="max-w-3xl mx-auto">
                <CardHeader className="text-center">
                    <CardTitle className="mb-5">Leaderboard</CardTitle>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full mt-6 mb-4">
                        {(["today", "week", "month", "all"] as RangeKey[]).map((key) => (
                            <Button
                                key={key}
                                size="sm"
                                variant={range === key ? "default" : "secondary"}
                                className={cn("w-full py-1 px-2 text-[0.7rem] leading-tight sm:text-sm", range === key ? "bg-primary text-white" : "bg-gray-200 text-black hover:bg-gray-300")}
                                onClick={() => setRange(key)}
                            >
                                {range === key && <Check className="inline h-4 w-4 mr-1" />}
                                {headingLabelMap[key]}
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
        <TooltipProvider delayDuration={200}>
        <Card className="max-w-3xl mx-auto">
            <CardHeader className="text-center">
                <CardTitle className="mb-5">Leaderboard</CardTitle>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full mt-6 mb-4">
                    {(["today", "week", "month", "all"] as RangeKey[]).map((key) => (
                        <Button
                            key={key}
                            size="sm"
                            variant={range === key ? "default" : "secondary"}
                            className={cn("w-full py-1 px-2 text-[0.7rem] leading-tight sm:text-sm", range === key ? "bg-primary text-white" : "bg-gray-200 text-black hover:bg-gray-300")}
                            onClick={() => setRange(key)}
                        >
                            {range === key && <Check className="inline h-4 w-4 mr-1" />}
                            {headingLabelMap[key]}
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
                    {leaderboard.map((entry, index) => (
                        <LeaderboardRow key={entry.userId} entry={entry} index={(page - 1) * PER_PAGE + index} highlightIdentifier={highlightIdentifier} />
                    ))}
                    {leaderboard.length === 0 && (
                        <p className="text-center text-muted-foreground py-8">
                            No users have added artists yet. Be the first!
                        </p>
                    )}
                </div>
            </CardContent>
            {pageCount > 1 && (
                <div className="bg-gray-50 border-t flex justify-end items-center gap-4 p-3">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                        Prev
                    </Button>
                    <span className="text-sm">Page {page} of {pageCount}</span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= pageCount}
                        onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    >
                        Next
                    </Button>
                </div>
            )}
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
        </TooltipProvider>
    );
} 