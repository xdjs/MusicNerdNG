"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function tourFlagKey(artistId: string): string {
    return `mn-tour-done-${artistId}`;
}

/** Set when the build finishes, read when the tour mounts.
 *
 *  The tour used to live inside OnboardingGate, which the page renders ONLY
 *  while onboarding is incomplete. The build's last act is confirming
 *  `publish` — so by the time there is anything to tour, the component holding
 *  the tour has stopped being rendered. It appeared, the page re-fetched, and
 *  it vanished. A flag survives both the refresh and the completion. */
export function tourPendingKey(artistId: string): string {
    return `mn-tour-pending-${artistId}`;
}

/** Fired when the build arms the tour.
 *
 *  The flag alone is not enough. ProfileTour is rendered by the artist page on
 *  INITIAL LOAD — before the build has even started — so its mount effect reads
 *  "not pending" and that is the last time it ever looks. The flag is set
 *  minutes later, and `router.refresh()` re-renders server components without
 *  remounting a client component in the same position, so the effect never runs
 *  again. Result: the build completes, the flag is set, and nothing is
 *  listening. An event closes that gap without polling. */
export const TOUR_ARMED_EVENT = "mn-tour-armed";

export function armTour(artistId: string): void {
    try {
        sessionStorage.setItem(tourPendingKey(artistId), "1");
    } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent(TOUR_ARMED_EVENT, { detail: artistId }));
}

type Stop = {
    anchor: string;
    title: string;
    body: string;
};

// Page order, top to bottom. An earlier pass went Links -> About -> Sources,
// which jumped around the page and matched neither reading order nor the
// order things were built in.
const STOPS: Stop[] = [
    {
        anchor: "mn-about",
        title: "We drafted your About",
        body: "Written from the sources further down — not invented. It's a draft: edit it in your own words, or replace it entirely. Plenty of artists would rather write their own.",
    },
    {
        anchor: "mn-ask",
        title: "Fans can ask about you here",
        body: "Answered from what we found about you, not from guesswork. This is where the sources below do most of their work.",
    },
    {
        anchor: "mn-links",
        title: "These are your links",
        body: "Found by searching for you. Remove anything that isn't yours, or add one we missed — the Add button is right here.",
    },
    {
        anchor: "mn-sources",
        title: "This is what we found written about you",
        body: "It feeds the answers above and the About draft. Anything here that isn't you is worth removing — tell us once and we won't show it again.",
    },
];

const CARD_WIDTH = 340;
const GAP = 16;
const EDGE = 12;

type Placement = { top: number; left: number; side: "right" | "left" | "below" | "above" };

/** Where the card goes relative to the section it describes.
 *
 *  Beside the section when there's room — that's what makes it read as pointing
 *  AT something rather than floating over the page. Falls back to below, then
 *  above, then clamps into the viewport, so a narrow window or a tall section
 *  degrades instead of putting the card off-screen. */
function place(rect: DOMRect, vw: number, vh: number, cardHeight: number): Placement {
    const verticalCenter = rect.top + rect.height / 2 - cardHeight / 2;
    const clampTop = (t: number) => Math.min(Math.max(t, EDGE), Math.max(EDGE, vh - cardHeight - EDGE));
    const clampLeft = (l: number) => Math.min(Math.max(l, EDGE), Math.max(EDGE, vw - CARD_WIDTH - EDGE));

    if (rect.right + GAP + CARD_WIDTH + EDGE <= vw) {
        return { top: clampTop(verticalCenter), left: rect.right + GAP, side: "right" };
    }
    if (rect.left - GAP - CARD_WIDTH - EDGE >= 0) {
        return { top: clampTop(verticalCenter), left: rect.left - GAP - CARD_WIDTH, side: "left" };
    }
    const horizontalCenter = clampLeft(rect.left + rect.width / 2 - CARD_WIDTH / 2);
    if (rect.bottom + GAP + cardHeight + EDGE <= vh) {
        return { top: rect.bottom + GAP, left: horizontalCenter, side: "below" };
    }
    return { top: clampTop(rect.top - GAP - cardHeight), left: horizontalCenter, side: "above" };
}

/**
 * A one-time guided pass, AFTER the page is built.
 *
 * The build asks the artist nothing (see runAutoBuild), which is right — the
 * claim already established who they are, so a question before the payoff is
 * ceremony. But it leaves them on a finished page with no idea what happened or
 * what they're allowed to change. Pete, 2026-08-21: "a person needs to know what
 * to do after the build is done."
 *
 * Deliberately NOT a wizard in front of the work. A wizard is a gate wearing a
 * different hat: it still blocks the payoff and still explains things the artist
 * has no context for yet. Here the thing being described is already on screen and
 * already theirs, so "this is your About" means something.
 *
 * The card is ANCHORED beside the section it describes, with an arrow pointing at
 * it, the section lifted above a dimmed page. A first pass put the card at the
 * bottom of the screen; it read as a notification rather than direction, which is
 * a fair description of what it was.
 *
 * Targets element ids rather than layout, so the page can be rearranged without
 * touching this, and it still renders if a section is missing.
 */
export default function ProfileTour({ artistId }: { artistId: string }) {
    const [index, setIndex] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    // Starts closed and decides after mount — sessionStorage is unavailable
    // during SSR, and rendering optimistically would flash the card for every
    // visitor before the flag says otherwise.
    const [armed, setArmed] = useState(false);
    const [placement, setPlacement] = useState<Placement | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);

    const stop = STOPS[index];

    useEffect(() => {
        const check = () => {
            try {
                const pending = sessionStorage.getItem(tourPendingKey(artistId)) === "1";
                const done = sessionStorage.getItem(tourFlagKey(artistId)) === "1";
                setArmed(pending && !done);
            } catch {
                // Private mode: no tour rather than one that can never be dismissed.
            }
        };
        // On mount, for a reload that lands with the flag already set…
        check();
        // …and on the arming event, for the far more common case: this component
        // mounted long before the build finished and would otherwise never look
        // again. See TOUR_ARMED_EVENT.
        const onArmed = (e: Event) => {
            if ((e as CustomEvent).detail === artistId) check();
        };
        window.addEventListener(TOUR_ARMED_EVENT, onArmed);
        return () => window.removeEventListener(TOUR_ARMED_EVENT, onArmed);
    }, [artistId]);

    const reposition = useCallback(() => {
        if (!stop) return;
        const el = document.getElementById(stop.anchor);
        if (!el) { setPlacement(null); return; }
        const rect = el.getBoundingClientRect();
        const cardHeight = cardRef.current?.offsetHeight ?? 200;
        setPlacement(place(rect, window.innerWidth, window.innerHeight, cardHeight));
    }, [stop]);

    // Scroll the section into view, lift it above the dim, and ring it. Cleanup
    // restores the element's own styles so the tour leaves no trace.
    useEffect(() => {
        if (!armed || dismissed || !stop) return;
        const el = document.getElementById(stop.anchor);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });

        const prev = {
            boxShadow: el.style.boxShadow,
            position: el.style.position,
            zIndex: el.style.zIndex,
            borderRadius: el.style.borderRadius,
        };
        el.style.boxShadow = "0 0 0 3px rgb(236 72 153 / 0.9)";
        el.style.borderRadius = "0.75rem";
        el.style.transition = "box-shadow 250ms ease";
        // Above the dim backdrop so the section stays fully legible.
        if (!el.style.position || el.style.position === "static") el.style.position = "relative";
        el.style.zIndex = "45";

        return () => {
            el.style.boxShadow = prev.boxShadow;
            el.style.position = prev.position;
            el.style.zIndex = prev.zIndex;
            el.style.borderRadius = prev.borderRadius;
        };
    }, [index, armed, dismissed, stop]);

    // Measure after paint, and keep up while the smooth scroll is still running.
    useLayoutEffect(() => {
        if (!armed || dismissed) return;
        reposition();
        let frame = 0;
        const settle = window.setInterval(reposition, 100);
        const stopSettling = window.setTimeout(() => window.clearInterval(settle), 900);
        const onMove = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(reposition);
        };
        window.addEventListener("scroll", onMove, { passive: true });
        window.addEventListener("resize", onMove);
        return () => {
            window.clearInterval(settle);
            window.clearTimeout(stopSettling);
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", onMove);
            window.removeEventListener("resize", onMove);
        };
    }, [index, armed, dismissed, reposition]);

    const finish = () => {
        try {
            sessionStorage.setItem(tourFlagKey(artistId), "1");
            sessionStorage.removeItem(tourPendingKey(artistId));
        } catch { /* private mode */ }
        setDismissed(true);
    };

    if (!armed || dismissed || !stop) return null;
    const isLast = index === STOPS.length - 1;

    // Arrow sits on the edge facing the section.
    const arrowClass = {
        right: "left-[-6px] top-1/2 -translate-y-1/2",
        left: "right-[-6px] top-1/2 -translate-y-1/2",
        below: "top-[-6px] left-1/2 -translate-x-1/2",
        above: "bottom-[-6px] left-1/2 -translate-x-1/2",
    }[placement?.side ?? "below"];

    return (
        <>
            {/* Dims the page so the ringed section is the only lit thing. Never
                blocks clicks — the artist can still use the section we're
                pointing at, which is the entire point of pointing at it. */}
            <div className="fixed inset-0 z-40 bg-black/50 pointer-events-none" aria-hidden="true" />

            <div
                ref={cardRef}
                role="dialog"
                aria-label={`Getting started: ${stop.title}`}
                style={
                    placement
                        ? { position: "fixed", top: placement.top, left: placement.left, width: CARD_WIDTH }
                        : { position: "fixed", bottom: EDGE, left: EDGE, right: EDGE }
                }
                className="z-50 rounded-xl border border-pink-500/40 bg-white dark:bg-neutral-900 p-5 space-y-3 shadow-2xl"
            >
                {placement && (
                    <div
                        aria-hidden="true"
                        className={`absolute w-3 h-3 rotate-45 bg-white dark:bg-neutral-900 border-pink-500/40 ${arrowClass} ${
                            placement.side === "right" ? "border-l border-b"
                            : placement.side === "left" ? "border-r border-t"
                            : placement.side === "below" ? "border-l border-t"
                            : "border-r border-b"
                        }`}
                    />
                )}

                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-pink-500">{index + 1} of {STOPS.length}</p>
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
        </>
    );
}
