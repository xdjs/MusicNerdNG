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

export function useResearchPump(artistId: string | undefined, enabled = true) {
    useEffect(() => {
        if (!artistId || !enabled) return;
        let stopped = false;

        const tick = () => {
            if (stopped) return;
            void fetch("/api/research/advance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ artistId }),
            }).catch(() => { /* background work; never surfaced */ });
        };

        tick();
        const id = setInterval(tick, TICK_MS);
        return () => { stopped = true; clearInterval(id); };
    }, [artistId, enabled]);
}
