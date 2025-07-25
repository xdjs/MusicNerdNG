"use client";

import DatePicker from "./DatePicker";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { DateRange } from "react-day-picker";
import { getUgcStatsInRangeAction as getUgcStatsInRange } from "@/app/actions/serverActions";
import { User } from "@/server/db/DbTypes";
import UgcStatsWrapper from "./Wrapper";
import Leaderboard from "./Leaderboard";
import { Pencil, ArrowDownCircle } from "lucide-react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

type RecentItem = {
    ugcId: string;
    artistId: string | null;
    artistName: string | null;
    updatedAt: string | null;
    imageUrl: string | null;
};

export default function Dashboard({ user, showLeaderboard = true, allowEditUsername = false, showDateRange = true, hideLogin = false, showStatus = true }: { user: User; showLeaderboard?: boolean; allowEditUsername?: boolean; showDateRange?: boolean; hideLogin?: boolean; showStatus?: boolean }) {
    return <UgcStatsWrapper><UgcStats user={user} showLeaderboard={showLeaderboard} allowEditUsername={allowEditUsername} showDateRange={showDateRange} hideLogin={hideLogin} showStatus={showStatus} /></UgcStatsWrapper>;
}

function UgcStats({ user, showLeaderboard = true, allowEditUsername = false, showDateRange = true, hideLogin = false, showStatus = true }: { user: User; showLeaderboard?: boolean; allowEditUsername?: boolean; showDateRange?: boolean; hideLogin?: boolean; showStatus?: boolean }) {
    const [date, setDate] = useState<DateRange | undefined>();
    const [ugcStats, setUgcStats] = useState<{ ugcCount: number, artistsCount: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [ugcStatsUserWallet, setUgcStatsUserWallet] = useState<string | null>(null); // retained for future but UI removed
    const [query, setQuery] = useState(''); // retained; will not be used but harmless
    const [allTimeStats, setAllTimeStats] = useState<{ ugcCount: number, artistsCount: number } | null>(null);
    const [isEditingUsername, setIsEditingUsername] = useState(false);
    const [usernameInput, setUsernameInput] = useState(user.username ?? "");
    const [savingUsername, setSavingUsername] = useState(false);
    const [recentUGC, setRecentUGC] = useState<RecentItem[]>([]);
    const [rank, setRank] = useState<number | null>(null);
    const isCompactLayout = !allowEditUsername; // compact (leaderboard-style) when username editing disabled

    // Range selection (synced with Leaderboard)
    type RangeKey = "today" | "week" | "month" | "all";
    const [selectedRange, setSelectedRange] = useState<RangeKey>("today");

    // (duplicate RangeKey and selectedRange definition removed)

    // Fetch leaderboard rank (only in compact layout)
    const [totalEntries, setTotalEntries] = useState<number | null>(null);

    // Fetch the user's rank on the leaderboard. In the compact leaderboard view we
    // respect the currently-selected date range. In the full profile view we
    // always fetch the all-time leaderboard so the stat matches the "UGC Total"
    // values directly above it.
    useEffect(() => {
        async function fetchRank() {
            try {
                let url = '/api/leaderboard';
                if (isCompactLayout) {
                    const dates = getRangeDates(selectedRange);
                    if (dates) {
                        url = `/api/leaderboard?from=${encodeURIComponent(dates.from.toISOString())}&to=${encodeURIComponent(dates.to.toISOString())}`;
                    }
                }

                const resp = await fetch(url);
                if (!resp.ok) return;
                const data = await resp.json();
                setTotalEntries(data.length);
                const idx = data.findIndex((entry: any) => entry.wallet?.toLowerCase() === user.wallet.toLowerCase());
                if (idx !== -1) setRank(idx + 1);
            } catch (e) {
                console.error('Error fetching rank', e);
            }
        }

        fetchRank();
    }, [selectedRange, user.wallet, isCompactLayout]);
    const isGuestUser = user.username === 'Guest User' || user.id === '00000000-0000-0000-0000-000000000000';
    const displayName = isGuestUser ? 'User Profile' : (user?.username ? user.username : user?.wallet);
    // Determine user status string for display
    const statusString = user.isAdmin ? 'Admin' : (user.isWhiteListed ? 'Whitelisted' : 'User');

    const { openConnectModal } = useConnectModal();
    const { status } = useSession();

    // ---------- Simplified view for guest (not logged-in) users ----------
    // Refresh once when auth state changes (login/logout), with sessionStorage flag to avoid loops
    useEffect(() => {
        const skipReload = sessionStorage.getItem('skipReload') === 'true';

        const loggedIn = !isGuestUser && status === 'authenticated';
        const loggedOut = isGuestUser && status === 'unauthenticated';

        const shouldReload = !skipReload && (
            // Guest just logged in (was guest, now authenticated)
            (isGuestUser && status === 'authenticated') ||
            // Authenticated user just logged out (was authenticated, now unauthenticated)
            (!isGuestUser && status === 'unauthenticated')
        );

        if (shouldReload) {
            sessionStorage.setItem('skipReload', 'true');
            window.location.reload();
        }

        // After page stabilizes, clear skipReload so future auth changes trigger refresh again
        if (skipReload && (loggedIn || loggedOut)) {
            sessionStorage.removeItem('skipReload');
        }
    }, [isGuestUser, status]);

    function handleLogin() {
        if (openConnectModal) {
            openConnectModal();
        } else {
            const navLoginBtn = document.getElementById("login-btn");
            if (navLoginBtn) {
                (navLoginBtn as HTMLButtonElement).click();
            }
        }
    }

    async function checkUgcStats() {
        if (date?.from && date?.to) {
            setLoading(true);
            const result = await getUgcStatsInRange(date, ugcStatsUserWallet);
            if (result) {
                setUgcStats(result);
            }
            setLoading(false);
        }
    }

    async function saveUsername() {
        if (!usernameInput || usernameInput === user.username) { setIsEditingUsername(false); return; }
        setSavingUsername(true);
        try {
            const resp = await fetch(`/api/admin/whitelist-user/${user.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: usernameInput })
            });
            const data = await resp.json();
            if (data.status === "success") {
                window.location.reload();
            } else {
                alert(data.message || "Failed to update username");
            }
        } catch(e) {
            alert("Server error updating username");
        }
        setSavingUsername(false);
        setIsEditingUsername(false);
    }

    function getRangeDates(r: RangeKey) {
        const now = new Date();
        switch (r) {
            case "today":
                const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                return { from: startToday, to: now } as const;
            case "week":
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                return { from: weekAgo, to: now } as const;
            case "month":
                const monthAgo = new Date(now);
                monthAgo.setMonth(now.getMonth() - 1);
                return { from: monthAgo, to: now } as const;
            default:
                return null;
        }
    }

    // Fetch all-time stats **once** on mount. These counts remain static and are not affected by leaderboard range filters.
    useEffect(() => {
        async function fetchAllTimeStats() {
            try {
                const dateRange: DateRange = { from: new Date(0), to: new Date() } as DateRange;
                const result = await getUgcStatsInRange(dateRange, ugcStatsUserWallet);
                if (result) setAllTimeStats(result);
            } catch (e) {
                console.error('[Dashboard] Error fetching all-time UGC stats', e);
            }
        }

        fetchAllTimeStats();
    }, [ugcStatsUserWallet]);

    // Fetch stats for the currently selected leaderboard range (compact layout only)
    useEffect(() => {
        if (!isCompactLayout) return;

        async function fetchRangeStats() {
            try {
                let dateRange: DateRange;
                const dates = getRangeDates(selectedRange);
                if (dates) {
                    dateRange = { from: dates.from, to: dates.to } as DateRange;
                } else {
                    // "all" range – use epoch to now
                    dateRange = { from: new Date(0), to: new Date() } as DateRange;
                }

                const result = await getUgcStatsInRange(dateRange, ugcStatsUserWallet);
                if (result) {
                    setUgcStats(result);
                }
            } catch (e) {
                console.error('[Dashboard] Error fetching UGC stats for range', e);
            }
        }

        fetchRangeStats();
    }, [selectedRange, ugcStatsUserWallet, isCompactLayout]);

    // Callback from Leaderboard to keep range in sync
    const handleLeaderboardRangeChange = (range: RangeKey) => {
        setSelectedRange(range);
    };

    // Fetch recent edited UGC only for the full profile layout (not the compact leaderboard layout)
    useEffect(() => {
        if (!isCompactLayout) {
            fetch('/api/recentEdited')
                .then(res => res.json())
                .then((data: RecentItem[]) => setRecentUGC(data))
                .catch((e) => console.error('[Dashboard] error fetching recent edited', e));
        }
    }, [isCompactLayout]);

    // ------------------- RENDER -------------------

    // Show simplified "please log in" screen only on the full (non-compact) profile view.
    // In the compact leaderboard view we still want to show the stats box so we can
    // prompt the user to log in from there.
    if (isGuestUser && !isCompactLayout) {
        return (
            <section className="px-10 py-20 space-y-8 flex items-center justify-center flex-col text-center">
                <h1 className="text-3xl font-bold">User Profile</h1>
                {!hideLogin && (
                    <Button
                        size="lg"
                        className="bg-pastypink hover:bg-gray-200 text-white px-8 py-4 text-xl"
                        onClick={handleLogin}
                    >
                        Log In
                    </Button>
                )}
            </section>
        );
    }

    return (
        <section className="px-5 sm:px-10 py-5 space-y-6">
            {/* Stats + Recently Edited layout */}
            {isCompactLayout ? (
                <div className="flex flex-col gap-6 mb-8 max-w-3xl mx-auto text-center">
                    {/* Username + other controls as before */}
                    <div className="flex flex-col items-center gap-2 pb-1 w-full">
                        {/* Horizontal stats row (User / UGC Added / Artists Added) */}
                        {isGuestUser ? (
                            // Guest variant – single clickable row that asks the visitor to log in
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={handleLogin}
                                className="cursor-pointer flex items-center justify-center py-3 px-4 sm:px-6 border rounded-md bg-accent/40 hover:bg-accent/60 hover:ring-2 hover:ring-black w-full gap-2 focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <span className="text-sm sm:text-lg font-medium underline">Log in to compare your statistics</span>
                            </div>
                        ) : (
                            <>
                            <div
                                role="button"
                                tabIndex={0}
                                title="Jump to my leaderboard position"
                                onClick={() => {
                                    const el = document.getElementById('leaderboard-current-user');
                                    if (el) {
                                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                }}
                                className="cursor-pointer grid grid-cols-2 sm:grid-cols-4 items-center py-3 px-4 sm:px-6 border rounded-md bg-accent/40 hover:bg-accent/60 hover:ring-2 hover:ring-black w-full gap-x-4 gap-y-3 justify-items-center focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                {/* User */}
                                <div className="flex items-center space-x-2 overflow-hidden justify-center">
                                    <span className="font-medium truncate max-w-[160px] text-sm sm:text-lg">
                                        {ugcStatsUserWallet ?? (user?.username ? user.username : user?.wallet)}
                                    </span>
                                    {/* (arrow removed; entire bar now clickable) */}
                                </div>

                                {/* Rank */}
                                <div className="flex flex-row items-center justify-center gap-2 text-xs sm:text-lg whitespace-nowrap">
                                    <span className="font-semibold text-xs sm:text-base">Rank:</span>
                                    <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary text-base px-4 py-1">
                                        {rank ?? '—'}
                                    </Badge>
                                    {totalEntries && (
                                        <>
                                            <span className="text-xs sm:text-base">of</span>
                                            <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary text-base px-4 py-1">
                                                {totalEntries}
                                            </Badge>
                                        </>
                                    )}
                                    {/* (arrow moved next to name) */}
                                </div>

                                {/* UGC Count */}
                                <div className="flex flex-row flex-wrap items-center justify-center gap-1 text-xs sm:text-base whitespace-nowrap">
                                    <span className="font-semibold text-xs sm:text-base">UGC Added:</span>
                                    <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary text-base px-4 py-1">
                                        {(ugcStats ?? allTimeStats)?.ugcCount ?? '—'}
                                    </Badge>
                                </div>

                                {/* Artists Count */}
                                <div className="flex flex-row flex-wrap items-center justify-center gap-1 text-xs sm:text-base whitespace-nowrap">
                                    <span className="font-semibold text-xs sm:text-base">Artists Added:</span>
                                    <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary text-base px-4 py-1">
                                        {(ugcStats ?? allTimeStats)?.artistsCount ?? '—'}
                                    </Badge>
                                </div>
                            </div>

                            {/* Link under stats bar to jump to leaderboard */}
                            <a
                                href="#leaderboard-current-user"
                                onClick={(e) => {
                                    e.preventDefault();
                                    const el = document.getElementById('leaderboard-current-user');
                                    if (el) {
                                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                }}
                                className="mt-2 text-sm text-blue-600 underline hover:text-blue-800"
                            >
                                View leaderboard position
                            </a>
                            </>
                          )}

                        {/* Edit username controls removed in leaderboard view */}
                        {/* Show a standalone login button for guests only when username editing is disabled */}
                        {!allowEditUsername && isGuestUser && !hideLogin && (
                            <div className="pt-2">
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="bg-gray-200 text-black hover:bg-gray-300"
                                    onClick={handleLogin}
                                >
                                    Log In
                                </Button>
                            </div>
                        )}
                    </div>
                    {/* Admin user search removed */}

                    {/* Status row */}
                    {showStatus && (
                    <div className="flex items-center gap-2 text-lg w-full justify-center md:justify-start">
                        <span className="font-semibold">Role:</span>
                        <span className="font-normal">{statusString}</span>
                    </div>
                    )}

                    {/* The vertical dynamic stats block has been replaced by the horizontal grid above */}

                    {showDateRange && !allowEditUsername && (
                        <>
                            {/* Date range picker and action button inline */}
                            <div className="flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-4">
                                <DatePicker date={date} setDate={setDate} />
                                <Button disabled={!date?.from || !date?.to} onClick={checkUgcStats}>Check UGC Stats</Button>
                            </div>
                            {loading && <p>Loading...</p>}
                        </>
                    )}
                </div>
            ) : (
                <>
                    {/* Username row no edit button inline */}
                    <div className="flex flex-col items-center gap-2 pb-4 w-full text-center">
                        {!isEditingUsername && (
                            <div className="flex items-center gap-2">
                                <p className="text-lg font-semibold">
                                    {displayName}
                                </p>
                                {allowEditUsername && !isGuestUser && (
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="w-8 h-8"
                                        onClick={() => setIsEditingUsername(true)}
                                    >
                                        <Pencil size={16} />
                                    </Button>
                                )}
                            </div>
                        )}

                        {allowEditUsername && !isGuestUser && isEditingUsername && (
                            <div className="flex flex-col items-center gap-2 w-full">
                                <div className="flex items-center gap-2 border-2 border-gray-300 bg-white rounded-md p-4 shadow-sm w-64">
                                    <Input
                                        value={usernameInput}
                                        onChange={(e) => setUsernameInput(e.target.value)}
                                        className="h-8 w-40 text-sm"
                                    />
                                    <Button size="sm" onClick={saveUsername} disabled={savingUsername || !usernameInput}>
                                        {savingUsername ? 'Saving...' : 'Save'}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setIsEditingUsername(false)}>Cancel</Button>
                                </div>
                            </div>
                        )}
                        {/* Fallback login button for views where username editing is not allowed */}
                        {!allowEditUsername && isGuestUser && !hideLogin && (
                            <div className="pt-2">
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="bg-gray-200 text-black hover:bg-gray-300"
                                    onClick={handleLogin}
                                >
                                    Log In
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Two-column section under username */}
                    <div className="flex flex-col md:flex-row md:gap-6 justify-center max-w-3xl mx-auto text-center md:text-left">
                        {/* Left column - admin controls, status & stats */}
                        <div className="md:w-1/2 flex flex-col">
                            {/* Top area: admin controls and status */}
                            <div className="space-y-4">
                                {/* Admin user search removed */}

                                {/* Status row */}
                                {showStatus && (
                                <div className="flex items-center gap-2 text-lg w-full justify-center md:justify-start">
                                    <span className="font-semibold">Role:</span>
                                    <span className="font-normal">{statusString}</span>
                                </div>
                                )}
                                    </div>

                            {/* Bottom area: UGC / Artists stats (vertical layout) */}
                            <div className="mt-4">
                            <Button
                                asChild
                                variant="outline"
                                className="py-4 space-y-2 text-left border-gray-300 hover:bg-gray-100 h-auto self-start w-64"
                            >
                                <Link href="/leaderboard" className="inline-flex flex-col items-start justify-start space-y-2">
                                    {/* User Rank */}
                                    <div className="flex justify-between text-lg w-full"><span className="font-semibold">User Rank:</span><span className="font-normal text-right flex-1 truncate">{rank ? `${rank} of ${totalEntries ?? '—'}` : '—'}</span></div>
                                    <div className="flex justify-between text-lg w-full"><span className="font-semibold">UGC Total:</span><span className="font-normal text-right flex-1 truncate">{(ugcStats ?? allTimeStats)?.ugcCount ?? '—'}</span></div>
                                    <div className="flex justify-between text-lg w-full"><span className="font-semibold">Artists Total:</span><span className="font-normal text-right flex-1 truncate">{(ugcStats ?? allTimeStats)?.artistsCount ?? '—'}</span></div>
                                </Link>
                            </Button>
                            </div>
                            </div>

                        {/* Right column - recently edited */}
                        <div className="md:w-1/2 space-y-4 mt-12 md:mt-0 flex flex-col items-center md:items-start">
                            <h3 className="text-lg font-semibold text-center md:text-left">Recently Edited Artists</h3>
                            {recentUGC.length ? (
                                <ul className="space-y-3">
                                    {recentUGC.map((item) => (
                                        <li key={item.ugcId}>
                                            <Link href={`/artist/${item.artistId ?? ''}`} className="flex items-center gap-3 hover:underline">
                                                <img src={item.imageUrl || "/default_pfp_pink.png"} alt="artist" className="h-8 w-8 rounded-full object-cover" />
                                                <span>{item.artistName ?? 'Unknown Artist'}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-gray-500 text-center md:text-left">No recent edits</p>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Leaderboard Section */}
            {showLeaderboard && (
            <div id="leaderboard-section" className="space-y-4">
                <Leaderboard highlightIdentifier={user.wallet} onRangeChange={handleLeaderboardRangeChange} />
            </div>
            )}
        </section>
    )
}