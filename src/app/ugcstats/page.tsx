"use client";

import DatePicker from "./DatePicker";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { DateRange } from "react-day-picker";
import { getUgcStats } from "@/server/utils/queriesTS";

export default function UgcStats() {
    const [date, setDate] = useState<DateRange | undefined>();
    const [ugcStats, setUgcStats] = useState<{ ugcCount: number, artistsCount: number } | undefined>();
    const [loading, setLoading] = useState(false);

    async function checkUgcStats() {
        if (date?.from && date?.to) {
            setLoading(true);
            const result = await getUgcStats(date);
            setUgcStats(result);
            setLoading(false);
        }
    }

    return (
        <section className="px-10 py-5 space-y-6">
            <h1 className="text-2xl">UGC Stats</h1>
            <DatePicker date={date} setDate={setDate} />
            <Button disabled={!date?.from || !date?.to} onClick={checkUgcStats}>Check UGC Stats</Button>
            {loading && <p>Loading...</p>}
            {ugcStats && (
                <div>
                    <p>UGC Count: {ugcStats.ugcCount}</p>
                    <p>Artists Count: {ugcStats.artistsCount}</p>
                </div>
            )}
        </section>
    )
}