"use client";

import DatePicker from "./DatePicker";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { DateRange } from "react-day-picker";
import { getUgcStatsInRangeAction as getUgcStatsInRange } from "@/app/actions/serverActions";
import { User } from "@/server/db/DbTypes";
import UgcStatsWrapper from "./Wrapper";
import SearchBar from "@/app/admin/UserSearch";
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
};

export default function Dashboard({ user, showLeaderboard = true, allowEditUsername = true, showDateRange = true }: { user: User; showLeaderboard?: boolean; allowEditUsername?: boolean; showDateRange?: boolean }) {
    return <UgcStatsWrapper><UgcStats user={user} showLeaderboard={showLeaderboard} allowEditUsername={allowEditUsername} showDateRange={showDateRange} /></UgcStatsWrapper>;
}

function UgcStats({ user, showLeaderboard = true, allowEditUsername = true, showDateRange = true }: { user: User; showLeaderboard?: boolean; allowEditUsername?: boolean; showDateRange?: boolean }) {
    const [date, setDate] = useState<DateRange | undefined>();
    const [ugcStats, setUgcStats] = useState<{ ugcCount: number, artistsCount: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [ugcStatsUserWallet, setUgcStatsUserWallet] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [allTimeStats, setAllTimeStats] = useState<{ ugcCount: number, artistsCount: number } | null>(null);
    const [isEditingUsername, setIsEditingUsername] = useState(false);
    const [usernameInput, setUsernameInput] = useState(user.username ?? "");
    const [savingUsername, setSavingUsername] = useState(false);
    const [recentUGC, setRecentUGC] = useState<RecentItem[]>([]);
    const isGuestUser = user.username === 'Guest User' || user.id === '00000000-0000-0000-0000-000000000000';

    const { openConnectModal } = useConnectModal();
    const { status } = useSession();

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

    // Fetch recent edited UGC on mount (only for profile page where leaderboard hidden)
    useEffect(() => {
        if (!showLeaderboard) {
            fetch('/api/recentEdited')
                .then(res => res.json())
                .then((data: RecentItem[]) => setRecentUGC(data))
                .catch((e) => console.error('[Dashboard] error fetching recent edited', e));
        }
    }, [showLeaderboard]);

    return (
        <section className="px-10 py-5 space-y-6">
            {/* Removed "User Profile" heading as per design update */}
            
            {/* Stats + Recently Edited layout */}
            {showLeaderboard ? (
                <div className="space-y-6 mb-8 max-w-xl mx-auto text-center">
                    {/* Username + other controls as before */}
                    <div className="flex flex-wrap justify-center items-center gap-2 pb-1 w-full">
                        {!isEditingUsername && (
                            <p className="text-sm text-gray-500">UGC Stats for: <strong>{
                                ugcStatsUserWallet ?? (user?.username ? user.username : user?.wallet)
                            }</strong></p>
                        )}

                        {allowEditUsername && !isEditingUsername && !isGuestUser && (
                            <div className="pt-2">
                                <Button size="sm" variant="secondary" className="bg-gray-200 text-black hover:bg-gray-300" onClick={() => setIsEditingUsername(true)}>
                                    Edit Username
                                </Button>
                            </div>
                        )}
                    </div>
                    {/* Admin controls for leaderboard stats */}
                    {user?.isAdmin && (
                        <>
                            <SearchBar setUsers={(user) => setUgcStatsUserWallet(user)} query={query} setQuery={setQuery} />
                            <div className="mt-2">
                                <Button disabled={!ugcStatsUserWallet} onClick={() => { setUgcStatsUserWallet(null); setQuery('') }}>
                                    Clear User
                                </Button>
                            </div>
                        </>
                    )}

                    {/* Dynamic stats block (shows date-range stats if available, otherwise all-time) */}
                    {(ugcStats ?? allTimeStats) && (
                        <div className="space-y-1">
                            <p>UGC Count: {(ugcStats ?? allTimeStats)?.ugcCount}</p>
                            <p>Artists Count: {(ugcStats ?? allTimeStats)?.artistsCount}</p>
                        </div>
                    )}

                    {showDateRange && (
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
                    <div className="flex flex-wrap justify-center items-center gap-2 pb-4 w-full text-center">
                        {!isEditingUsername && (
                            <p className="text-lg font-semibold">
                                {ugcStatsUserWallet ?? (user?.username ? user.username : user?.wallet)}
                            </p>
                        )}

                        {allowEditUsername && (
                            !isGuestUser && isEditingUsername ? (
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
                            ) : (
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
                            )
                        )}
                    </div>

                    {/* Two-column section under username */}
                    <div className="flex flex-col md:flex-row md:gap-6 justify-center max-w-3xl mx-auto text-center md:text-left">
                        {/* Left column - stats & admin controls */}
                        <div className="md:w-1/2 space-y-4">
                            {user?.isAdmin && (
                                <>
                                    <SearchBar setUsers={(user) => setUgcStatsUserWallet(user)} query={query} setQuery={setQuery} />
                                    <div className="mt-2">
                                        <Button disabled={!ugcStatsUserWallet} onClick={() => { setUgcStatsUserWallet(null); setQuery('') }}>
                                            Clear User
                                        </Button>
                                    </div>
                                </>
                            )}

                            <div className="space-y-1 text-center md:text-left">
                                <p className="text-lg font-semibold">UGC Count: <span className="font-normal">{(ugcStats ?? allTimeStats)?.ugcCount ?? '—'}</span></p>
                                <p className="text-lg font-semibold">Artists Added: <span className="font-normal">{(ugcStats ?? allTimeStats)?.artistsCount ?? '—'}</span></p>
                            </div>
                        </div>

                        {/* Right column - recently edited */}
                        <div className="md:w-1/2 space-y-4 mt-8 md:mt-0">
                            <h3 className="text-lg font-semibold text-center md:text-left">Recently Edited</h3>
                            {recentUGC.length ? (
                                <ul className="space-y-3">
                                    {recentUGC.map((item) => (
                                        <li key={item.ugcId}>
                                            <Link href={`/artist/${item.artistId ?? ''}`} className="flex items-center gap-3 hover:underline">
                                                <img src="/default_pfp.png" alt="artist" className="h-8 w-8 rounded-full object-cover" />
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
            <div>
                <Leaderboard highlightIdentifier={user.wallet} dateRange={date} />
            </div>
            )}
        </section>
    )
}