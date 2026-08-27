"use client";

import { useEffect } from "react";

/**
 * Keeps the research queue moving while somebody is on the page.
 *
 * The scrape and the caption extraction are minutes of work, and no request
 * lives that long, so they run as jobs — and a job needs invocations to run in.
 * The artist reading the vault step is the opportunity: they spend minutes
 * there, and each tick is a full-budget invocation happening while someone is
 * actually waiting for the result.
 *
 * Deliberately its own hook rather than part of useOnboardingChat. It shares
 * nothing with the chat, and putting it there meant a background fetch racing
 * the chat's own — which the chat tests noticed immediately by having their
 * mocked response eaten.
 *
 * Fire-and-forget by design: nothing on screen depends on it, a failure is not
 * the artist's problem, and the work is claimed atomically so overlapping ticks
 * cannot double-run it.
 */
const TICK_MS = 20_000;
/** Consecutive "nothing to do" replies before this stops asking. */
const IDLE_TICKS_BEFORE_STOP = 5;

export function useResearchPump(artistId: string | undefined, enabled = true) {
    useEffect(() => {
        if (!artistId || !enabled) return;
        let stopped = false;
        let idle = 0;

        const tick = async () => {
            if (stopped) return;
            try {
                const res = await fetch("/api/research/advance", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ artistId }),
                });
                const data = await res.json().catch(() => ({}));
                // Stop after a few empty ticks. A page left open for an hour
                // should not keep asking a question the answer to which has
                // been "nothing to do" since the first minute.
                idle = data?.ran ? 0 : idle + 1;
                if (idle >= IDLE_TICKS_BEFORE_STOP) { stopped = true; clearInterval(id); }
            } catch { /* background work; never surfaced */ }
        };

        const id = setInterval(() => void tick(), TICK_MS);
        void tick();
        return () => { stopped = true; clearInterval(id); };
    }, [artistId, enabled]);
}
