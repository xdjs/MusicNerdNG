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
import { Pencil } from "lucide-react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Input } from "@/components/ui/input";
import Link from "next/link";

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
    const isGuestUser = user.username === 'Guest User' || user.id === '00000000-0000-0000-0000-000000000000';
    const displayName = isGuestUser ? 'User Profile' : (user?.username ? user.username : user?.wallet);
    const isCompactLayout = !allowEditUsername; // compact layout (leaderboard-like) when username editing disabled
    // Determine user status string for display
    const statusString = user.isAdmin ? 'Admin' : (user.isWhiteListed ? 'Whitelisted' : 'User');

    const { openConnectModal } = useConnectModal();
    const { status } = useSession();

    // ---------- Simplified view for guest (not logged-in) users ----------
    if (isGuestUser) {
        return (
            <section className="flex flex-col items-center justify-center py-20 space-y-8 text-center">
                <p className="text-3xl font-bold">User Profile</p>
                {!hideLogin && (
                    <Button
                        size="lg"
                        variant="secondary"
                        className="bg-gray-200 text-black hover:bg-gray-300 px-8 py-4 text-xl"
                        onClick={handleLogin}
                    >
                        Log In
                    </Button>
                )}
            </section>
        );
    }

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

    // Fetch all-time stats on mount and whenever the target wallet changes
    useEffect(() => {
        async function fetchAllTimeStats() {
            try {
                const result = await getUgcStatsInRange({ from: new Date(0), to: new Date() } as DateRange, ugcStatsUserWallet);
                if (result) setAllTimeStats(result);
            } catch (e) {
                console.error('Error fetching all-time UGC stats', e);
            }
        }

        fetchAllTimeStats();
    }, [ugcStatsUserWallet]);

    // Fetch recent edited UGC only for the profile layout (not the compact leaderboard layout)
    useEffect(() => {
        if (!isCompactLayout) {
            fetch('/api/recentEdited')
                .then(res => res.json())
                .then((data: RecentItem[]) => setRecentUGC(data))
                .catch((e) => console.error('[Dashboard] error fetching recent edited', e));
        }
    }, [isCompactLayout]);

    return (
        <section className="px-5 sm:px-10 py-5 space-y-6">
            {/* Stats + Recently Edited layout */}
            {isCompactLayout ? (
                <div className="flex flex-col gap-6 mb-8 max-w-xl mx-auto text-center">
                    {/* Username + other controls as before */}
                    <div className="flex flex-col items-center gap-2 pb-1 w-full">
                        {!isEditingUsername && !isGuestUser && (
                            <p className="text-sm text-gray-500">UGC Stats for: <strong>{
                                ugcStatsUserWallet ?? (user?.username ? user.username : user?.wallet)
                            }</strong></p>
                        )}

                        {allowEditUsername && (
                            !isGuestUser && isEditingUsername ? (
                                <div className="flex flex-col items-center gap-2 w-full">
                                    <div className="flex items-center gap-2 border border-gray-300 bg-white rounded-md p-2 shadow-sm">
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
                            ) : (
                                <div className="pt-2">
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        className="bg-gray-200 text-black hover:bg-gray-300"
                                        onClick={isGuestUser ? handleLogin : () => setIsEditingUsername(true)}
                                    >
                                        <div className="flex items-center gap-1">
                                            {isGuestUser ? 'Log In' : (<><Pencil size={14} /> Edit Username</>)}
                                        </div>
                                    </Button>
                                </div>
                            )
                        )}
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
                    <p className="text-lg font-semibold">Status: <span className="font-normal">{statusString}</span></p>
                    )}

                    {/* Dynamic stats block – hide for guest */}
                    {!isGuestUser && (ugcStats ?? allTimeStats) && (
                        <div className="space-y-1 mt-4">
                            <p>UGC Count: {(ugcStats ?? allTimeStats)?.ugcCount}</p>
                            <p>Artists Count: {(ugcStats ?? allTimeStats)?.artistsCount}</p>
                        </div>
                    )}

                    {showDateRange && !isCompactLayout && (
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
                            <p className="text-lg font-semibold">
                                {displayName}
                            </p>
                        )}

                        {allowEditUsername && (
                            !isGuestUser && isEditingUsername ? (
                                <div className="flex flex-col items-center gap-2 w-full">
                                    <div className="flex items-center gap-2 border border-gray-300 bg-white rounded-md p-2 shadow-sm">
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
                            ) : (
                                <div className="pt-2">
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        className="bg-gray-200 text-black hover:bg-gray-300"
                                        onClick={isGuestUser ? handleLogin : () => setIsEditingUsername(true)}
                                    >
                                        <div className="flex items-center gap-1">
                                            {isGuestUser ? 'Log In' : (<><Pencil size={14} /> Edit Username</>)}
                                        </div>
                                    </Button>
                                </div>
                            )
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
                                <p className="text-lg font-semibold">Status: <span className="font-normal">{statusString}</span></p>
                                )}
                                    </div>

                            {/* Bottom area: UGC / Artists stats */}
                            <div className="space-y-1 text-center md:text-left mt-4">
                                <p className="text-lg font-semibold">UGC Count: <span className="font-normal">{(ugcStats ?? allTimeStats)?.ugcCount ?? '—'}</span></p>
                                <p className="text-lg font-semibold">Artists Added: <span className="font-normal">{(ugcStats ?? allTimeStats)?.artistsCount ?? '—'}</span></p>
                            </div>
                        </div>

                        {/* Right column - recently edited */}
                        <div className="md:w-1/2 space-y-4 mt-8 md:mt-0">
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
            <div className="space-y-4">
                <Leaderboard highlightIdentifier={user.wallet} />
            </div>
            )}
        </section>
    )
}