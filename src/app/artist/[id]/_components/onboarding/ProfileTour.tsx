"use client";

import { useEffect, useState } from "react";

export function tourFlagKey(artistId: string): string {
    return `mn-tour-done-${artistId}`;
}

type Stop = {
    anchor: string;
    title: string;
    body: string;
};

const STOPS: Stop[] = [
    {
        anchor: "mn-links",
        title: "These are your links",
        body: "Found by searching for you. Remove anything that isn't yours, or add one we missed — the Add button is right here.",
    },
    {
        anchor: "mn-about",
        title: "This is your About",
        body: "Written from the sources below, not invented. Edit it in your own words any time, or regenerate it after you've added more.",
    },
    {
        anchor: "mn-sources",
        title: "This is what we found written about you",
        body: "Your About is built from these, so anything here that isn't you is worth removing — and we won't show it to you again.",
    },
];

/**
 * A one-time guided pass, AFTER the page is built.
 *
 * The build asks the artist nothing (see runAutoBuild), which is right — the
 * claim already established who they are, so a question before the payoff is
 * ceremony. But it leaves them on a finished page with no idea what just
 * happened or what they're allowed to change. Pete, 2026-08-21: "a person needs
 * to know what to do after the build is done."
 *
 * Deliberately NOT a wizard in front of the work. A wizard is a gate wearing a
 * different hat: it still blocks the payoff and still explains things the artist
 * has no context for yet. Here the thing being described is already on screen
 * and already theirs, so "this is your About" means something.
 *
 * Each stop scrolls its section into view and rings it, so the words always
 * point at something visible. Targets ids rather than layout, so the page can be
 * rearranged without touching this.
 *
 * Shown once per artist per browser. Skipping counts as done — an artist who
 * dismisses it does not want it again.
 */
export default function ProfileTour({ artistId }: { artistId: string }) {
    const [index, setIndex] = useState(0);
    const [dismissed, setDismissed] = useState(false);

    const stop = STOPS[index];

    useEffect(() => {
        if (dismissed || !stop) return;
        const el = document.getElementById(stop.anchor);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Ring the section for as long as we're describing it. Inline styles
        // rather than a class so this needs no global CSS and cleans itself up.
        const previous = el.style.boxShadow;
        el.style.boxShadow = "0 0 0 3px rgb(236 72 153 / 0.9)";
        el.style.borderRadius = "0.75rem";
        el.style.transition = "box-shadow 250ms ease";
        return () => { el.style.boxShadow = previous; };
    }, [index, dismissed, stop]);

    const finish = () => {
        try { sessionStorage.setItem(tourFlagKey(artistId), "1"); } catch { /* private mode */ }
        setDismissed(true);
    };

    if (dismissed || !stop) return null;

    const isLast = index === STOPS.length - 1;

    return (
        <div
            role="dialog"
            aria-label="Getting started"
            className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 pointer-events-none"
        >
            <div className="pointer-events-auto w-full max-w-md glass rounded-xl p-5 space-y-3 shadow-2xl border border-pink-500/30">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-pink-500">
                        {index + 1} of {STOPS.length}
                    </p>
                    <button
                        onClick={finish}
                        className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                    >
                        Skip
                    </button>
                </div>

                <h3 className="text-lg font-bold text-black dark:text-white">{stop.title}</h3>
                <p className="text-sm text-gray-700 dark:text-gray-300">{stop.body}</p>

                <div className="flex gap-2 pt-1">
                    {index > 0 && (
                        <button
                            onClick={() => setIndex(i => i - 1)}
                            className="text-sm px-4 py-2 rounded-lg border border-black/10 dark:border-white/20 text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        >
                            Back
                        </button>
                    )}
                    <button
                        onClick={() => (isLast ? finish() : setIndex(i => i + 1))}
                        className="flex-1 bg-pink-500 hover:bg-pink-600 active:bg-pink-700 transition-colors text-white font-semibold py-2 rounded-lg"
                    >
                        {isLast ? "Got it" : "Next"}
                    </button>
                </div>
            </div>
        </div>
    );
}
