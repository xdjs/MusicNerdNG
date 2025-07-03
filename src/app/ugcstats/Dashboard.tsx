"use client";

import DatePicker from "./DatePicker";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { DateRange } from "react-day-picker";
import { getUgcStatsInRange, getUserById } from "@/server/utils/queriesTS";
import { User } from "@/server/db/DbTypes";
import UgcStatsWrapper from "./Wrapper";
import SearchBar from "@/app/admin/UserSearch";
import Leaderboard from "./Leaderboard";

export default function Dashboard({ user }: { user: User }) {
    return <UgcStatsWrapper><UgcStats user={user} /></UgcStatsWrapper>;
}

function UgcStats({ user }: { user: User }) {
    const [date, setDate] = useState<DateRange | undefined>();
    const [ugcStats, setUgcStats] = useState<{ ugcCount: number, artistsCount: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [ugcStatsUserWallet, setUgcStatsUserWallet] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [allTimeStats, setAllTimeStats] = useState<{ ugcCount: number, artistsCount: number } | null>(null);

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

    return (
        <section className="px-10 py-5 space-y-6">
            <h1 className="text-2xl font-bold text-center">UGC Stats</h1>
            
            {/* Individual Stats Section */}
            <div className="space-y-6 mb-8 max-w-xl mx-auto text-center">
                {/* User info */}
                <p className="text-sm text-gray-500 pb-1">UGC Stats for: <strong>{
                    ugcStatsUserWallet ?? (user?.username ? user.username : user?.wallet)
                }</strong></p>

                {user?.isAdmin && (
                    <>
                        <SearchBar setUsers={(user) => setUgcStatsUserWallet(user)} query={query} setQuery={setQuery} />
                        <div className="mt-2">
                            <Button disabled={!ugcStatsUserWallet} onClick={() => {setUgcStatsUserWallet(null); setQuery('')}}>
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

                {/* Date range picker and action button inline */}
                <div className="flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-4">
                    <DatePicker date={date} setDate={setDate} />
                    <Button disabled={!date?.from || !date?.to} onClick={checkUgcStats}>Check UGC Stats</Button>
                </div>
                {loading && <p>Loading...</p>}
            </div>

            {/* Leaderboard Section */}
            <div>
                <Leaderboard highlightIdentifier={user.wallet} dateRange={date} />
            </div>
        </section>
    )
}