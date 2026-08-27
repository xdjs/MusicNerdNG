"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BuildStatus from "./BuildStatus";
import { useOnboardingChat, type ChatItem } from "./useOnboardingChat";
import { useResearchPump } from "./useResearchPump";
import { ProfilesCard, VaultCard, InterviewInput, AboutDraftCard, DocReviewCard, LiveDiscoveryFeed, type InterviewPayload } from "./StepCards";
import MusicNerdLoader from "@/app/_components/MusicNerdLoader";

type Props = { artistId: string; artistName: string; onSkip: () => void; onFinish: () => void };

// Presentational only — progress rail order + stage derivation for display purposes.
const STEP_ORDER = ["profiles", "vault", "interview", "publish"] as const;

// Scroll-anchoring tuning: how close to the true bottom counts as "the user
// was following along" (vs. deliberately scrolled up to re-read something),
// and how much breathing room to leave above a newly-anchored item's top edge.
const NEAR_BOTTOM_PX = 120;
const ANCHOR_OFFSET_PX = 12;

/** Scrolls `container` so `itemId`'s top edge sits just below the container's
 *  top edge, rather than snapping to the absolute bottom of everything. Uses
 *  getBoundingClientRect deltas (not offsetTop) so it doesn't depend on the
 *  container being a positioned offsetParent. No-ops safely when the target
 *  isn't found, or when JSDOM's zeroed-out layout rects make the math trivial
 *  (rect.top - rect.top - offset = a small negative number, clamped to 0). */
function anchorToItem(container: HTMLDivElement, itemId: string, behavior: ScrollBehavior) {
    const target = container.querySelector<HTMLElement>(`[data-item-id="${itemId}"]`);
    if (!target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const delta = targetRect.top - containerRect.top - ANCHOR_OFFSET_PX;
    container.scrollTo({ top: Math.max(0, container.scrollTop + delta), behavior });
}

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function OnboardingChat({ artistId, artistName, onSkip, onFinish }: Props) {
    const { items, busy, sendTurn } = useOnboardingChat(artistId);
    // Keeps the scrape and the caption extraction moving while the artist is
    // here. They are minutes of work and no request lives that long, so the
    // person on the page is what turns a queued job into a finished one.
    useResearchPump(artistId);
    const router = useRouter();
    const opened = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    // Ids already rendered as of the last items-change effect run — lets us
    // diff to find just-added items instead of re-anchoring on every render.
    const prevIdsRef = useRef<Set<string>>(new Set());
    // Updated only by real scroll events (ours or the user's) — reflects the
    // scroll position as it was BEFORE new items grew the container, since
    // appending content below the fold doesn't itself fire a "scroll" event.
    const wasNearBottomRef = useRef(true);
    // The earliest still-unread item id, set when we decide not to auto-scroll.
    const pillTargetIdRef = useRef<string | null>(null);
    const [hasNewBelow, setHasNewBelow] = useState(false);

    useEffect(() => {
        if (!opened.current) {
            opened.current = true;
            void sendTurn({ type: "open" });
        }
    }, [sendTurn]);

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        const near = distance <= NEAR_BOTTOM_PX;
        wasNearBottomRef.current = near;
        if (near) setHasNewBelow(false);
    }, []);

    // Three-way, total scroll-anchoring rule. Every items-change takes EXACTLY
    // one of these branches — there is no silent fourth "do nothing" outcome:
    //   1. The new items include something the user just drove (their own
    //      echo) or something that demands their attention (a step, draft, or
    //      complete card) → ALWAYS anchor-scroll to it, no matter where
    //      they've scrolled. This must never depend on "near bottom".
    //   2. Else, if they were already near the bottom → anchor-scroll to the
    //      newest content, same as always.
    //   3. Else → leave their scroll position alone and surface the
    //      "↓ New messages" pill instead.
    useEffect(() => {
        const container = scrollRef.current;
        const prevIds = prevIdsRef.current;
        const newItems = items.filter(i => !prevIds.has(i.id));
        prevIdsRef.current = new Set(items.map(i => i.id));
        if (!container || newItems.length === 0) return;

        // Only the items that actually demand attention decide branch 1 — a
        // bot/progress item that happened to batch in alongside a real step
        // or draft (e.g. multiple SSE frames flushed in one React update)
        // shouldn't win the anchor target over the thing the user needs to
        // see.
        const actionItems = newItems.filter(
            i => i.kind === "user" || i.kind === "step" || i.kind === "draft" || i.kind === "complete"
        );
        // Anchor to the action item itself — falls back to the user's own
        // echo bubble when that's the only action item in this update, or to
        // the first new item at all when there's no action item (branch 2).
        const anchorItem = actionItems.length > 0 ? actionItems.find(i => i.kind !== "user") ?? actionItems[0] : newItems[0];

        const shouldAutoScroll = actionItems.length > 0 || wasNearBottomRef.current;

        if (!shouldAutoScroll) {
            if (!pillTargetIdRef.current) pillTargetIdRef.current = anchorItem.id;
            setHasNewBelow(true);
            return;
        }

        anchorToItem(container, anchorItem.id, prefersReducedMotion() ? "auto" : "smooth");
        pillTargetIdRef.current = null;
        setHasNewBelow(false);
        // We just placed the user at the top of the newest content — treat
        // that as "caught up" without waiting for a scroll event to confirm
        // it, since a same-position or clamped-to-zero anchor may not fire
        // one (e.g. jsdom, or the target was already at the top).
        wasNearBottomRef.current = true;
    }, [items]);

    const jumpToNewMessages = useCallback(() => {
        const container = scrollRef.current;
        const targetId = pillTargetIdRef.current;
        pillTargetIdRef.current = null;
        setHasNewBelow(false);
        if (container && targetId) anchorToItem(container, targetId, prefersReducedMotion() ? "auto" : "smooth");
        // Clicking the pill is an explicit "I'm following along again"
        // signal — don't wait on a scroll event that might not fire.
        wasNearBottomRef.current = true;
    }, []);

    const complete = items.some(i => i.kind === "complete");
    // Only the LAST step/draft item is interactive — earlier ones are history.
    const lastInteractiveId = [...items].reverse().find(i => i.kind === "step" || i.kind === "draft")?.id;
    // Progress rail (presentational): most recent step/draft/complete item decides the stage.
    const lastStageItem = [...items].reverse().find(i => i.kind === "step" || i.kind === "draft" || i.kind === "complete");
    const currentStage = lastStageItem ? (lastStageItem.kind === "step" ? lastStageItem.step : "publish") : null;
    const currentStepIndex = currentStage ? STEP_ORDER.indexOf(currentStage as (typeof STEP_ORDER)[number]) : -1;
    // Spec §9 retry affordance: only the LAST error item gets a "Try again"
    // button, and only when nothing newer (a step/draft) already superseded it.
    const lastErrorIndex = items.reduce((acc, item, idx) => (item.kind === "error" ? idx : acc), -1);
    const lastErrorId =
        lastErrorIndex !== -1 && !items.slice(lastErrorIndex + 1).some(i => i.kind === "step" || i.kind === "draft")
            ? items[lastErrorIndex].id
            : null;

    const renderItem = (item: ChatItem) => {
        const interactive = item.id === lastInteractiveId && !busy && !complete;
        switch (item.kind) {
            case "bot":
                return (
                    <div className="glass-subtle !rounded-2xl !rounded-bl-md px-4 py-2.5 max-w-[80%] self-start text-black dark:text-white">
                        {item.text}
                    </div>
                );
            case "user":
                return (
                    <div className="bg-pink-500 text-white !rounded-2xl !rounded-br-md px-4 py-2.5 max-w-[80%] self-end shadow-sm shadow-pink-500/30">
                        {item.text}
                    </div>
                );
            case "progress":
                // In flight: a slow "breathing" glow (see .animate-onboarding-progress-breathe
                // in globals.css) reads as clearly alive without the flat mechanical
                // feel of a plain opacity pulse. Done: the glow simply stops and the
                // border/background settle into a calm, static pink pill — the
                // transition-colors on both classes makes that settle a smooth fade
                // rather than a hard cut.
                return (
                    <div
                        className={`self-start flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-colors duration-500 text-gray-700 dark:text-gray-300 ${
                            item.done
                                ? "border-pink-400/50 dark:border-pink-400/40 bg-pink-500/5"
                                : "border-gray-300/60 dark:border-gray-600/60 animate-onboarding-progress-breathe"
                        }`}
                    >
                        {item.done ? <span aria-hidden="true">✓</span> : <MusicNerdLoader size={13} label={item.text} />}
                        <span>{item.text}</span>
                    </div>
                );
            case "candidates":
                return <LiveDiscoveryFeed candidates={item.candidates ?? []} />;
            case "error":
                return (
                    <div className="self-start flex flex-col items-start gap-1.5">
                        <div className="text-sm text-amber-600 dark:text-amber-400 px-1">{item.text}</div>
                        {item.id === lastErrorId && !busy && !complete && (
                            <button
                                onClick={() => void sendTurn({ type: "open" })}
                                className="text-sm font-semibold text-pink-500 hover:text-pink-600 transition-colors px-1"
                            >
                                Try again
                            </button>
                        )}
                    </div>
                );
            case "step": {
                if (item.step === "profiles") return <ProfilesCard payload={item.payload as never} disabled={!interactive}
                        onFindMore={r => void sendTurn({ type: "find_more_profiles", ...r })} onConfirm={r => void sendTurn({ type: "confirm_profiles", ...r })} />;
                if (item.step === "vault") return <VaultCard payload={item.payload as never} disabled={!interactive} onConfirm={r => void sendTurn({ type: "vault_review", ...r })} />;
                if (item.step === "interview") {
                    const payload = item.payload as InterviewPayload;
                    // The question TEXT round-trips to the server here (not
                    // in InterviewInput's own onAnswer contract, which stays
                    // exactly {questionKey, answer}) — the server needs it to
                    // store a grounded (non-static) question's wording; see
                    // resolveInterviewQuestionText in turnHandlers.ts.
                    return <InterviewInput payload={payload} disabled={!interactive} onAnswer={r => void sendTurn({ type: "interview_answer", question: payload.question, ...r })} />;
                }
                return null;
            }
            case "draft":
                // Stage "doc": the knowledge document alone, to be read and corrected.
                // No About exists yet — approving prose built from an unchecked record
                // is exactly the order this split exists to avoid.
                if (item.stage === "doc") {
                    return (
                        <DocReviewCard
                            doc={item.doc ?? ""}
                            sources={item.sources}
                            disabled={!interactive}
                            onChoose={r => void sendTurn({ type: "about_choice", sources: item.sources, ...r })}
                        />
                    );
                }
                // Stage "about": the About on its own. The document it was written from
                // was read and corrected one card earlier, and stays in the transcript
                // there. It used to be reprinted under the publish button — a holdover
                // from when both arrived in one turn — which repeated a step the artist
                // had already taken, still asking them to flag anything wrong from a card
                // that has no editor to fix it in.
                // AboutDraftCard's onPublish stays locked to exactly {doc, about} (existing
                // test contract) — `sources` is threaded into the actual server turn here,
                // from the draft item's own `sources` field, not from AboutDraftCard itself.
                return (
                    <AboutDraftCard
                        doc={item.doc ?? ""}
                        about={item.about ?? ""}
                        sources={item.sources}
                        startEditing={item.selfWrite}
                        disabled={!interactive}
                        onPublish={r => void sendTurn({ type: "publish", sources: item.sources, ...r })}
                    />
                );
            case "complete":
                return (
                    <div className="self-stretch text-center glass rounded-xl p-4 shadow-lg shadow-pink-500/10">
                        <p className="text-2xl">🎉</p>
                        <p className="font-bold text-lg text-black dark:text-white">You&apos;re live!</p>
                        <button
                            onClick={() => {
                                // The takeover covered the page for the whole flow, so the
                                // body is still wherever it was when the artist arrived —
                                // usually scrolled down. Land them at the top of the profile
                                // they just built rather than in the middle of it.
                                window.scrollTo({ top: 0, behavior: "auto" });
                                router.refresh();
                                onFinish();
                            }}
                            className="mt-2 bg-pink-500 enabled:hover:bg-pink-600 active:bg-pink-700 transition-colors text-white font-semibold px-4 py-2 rounded-lg shadow-sm"
                        >
                            See my page
                        </button>
                    </div>
                );
            default:
                return null;
        }
    };

    // While the build runs, this is a LOADING state, not a conversation — it asks
    // nothing and the artist answers nothing. A step card appearing is what makes
    // it a conversation again (the resume path, where they really are answering),
    // so that is the discriminator rather than a mode flag that could drift.
    // An ERROR always falls back to the chat surface. The build card has no way
    // to show a failure or offer "Try again", so inferring build-mode from "no
    // step card yet" would strand an artist on a frozen card after a failed
    // build — with no error and no recovery.
    const isBuild = !items.some(i => i.kind === "step" || i.kind === "draft" || i.kind === "error");
    if (isBuild) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <BuildStatus
                    artistName={artistName}
                    items={items}
                    complete={complete}
                    onSkip={onSkip}
                    onFinish={() => {
                        window.scrollTo({ top: 0, behavior: "auto" });
                        router.refresh();
                        onFinish();
                    }}
                />
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-[480px] h-[85vh] glass rounded-2xl flex flex-col overflow-hidden shadow-2xl shadow-black/30 dark:shadow-black/50 animate-onboarding-panel-in">
                <div className="flex flex-col border-b border-black/10 dark:border-white/10">
                    <div className="flex items-center justify-between px-4 py-3">
                        <p className="font-bold text-black dark:text-white">Set up {artistName}</p>
                        {!complete && (
                            <button
                                onClick={onSkip}
                                className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                            >
                                Skip for now
                            </button>
                        )}
                    </div>
                    <div className="flex gap-1 px-4 pb-3" aria-hidden="true">
                        {STEP_ORDER.map((step, idx) => (
                            <div
                                key={step}
                                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                                    idx <= currentStepIndex ? "bg-pink-500" : "bg-black/10 dark:bg-white/10"
                                }`}
                            />
                        ))}
                    </div>
                </div>
                <div className="relative flex-1 min-h-0">
                    <div
                        ref={scrollRef}
                        onScroll={handleScroll}
                        data-testid="onboarding-scroll"
                        className="h-full overflow-y-auto scrollbar-glass p-4 flex flex-col gap-2.5"
                    >
                        {items.map(item => (
                            <div key={item.id} data-item-id={item.id} className="flex flex-col">{renderItem(item)}</div>
                        ))}
                        {busy && (
                            <div className="glass-subtle self-start !rounded-2xl !rounded-bl-md px-4 py-3 flex items-center gap-1.5" aria-hidden="true">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-gray-400 motion-safe:animate-bounce [animation-delay:-0.3s]" />
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-gray-400 motion-safe:animate-bounce [animation-delay:-0.15s]" />
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-gray-400 motion-safe:animate-bounce" />
                            </div>
                        )}
                    </div>
                    {hasNewBelow && (
                        <button
                            onClick={jumpToNewMessages}
                            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 glass-subtle text-xs font-semibold text-pink-500 dark:text-pink-400 px-3 py-1.5 rounded-full shadow-lg shadow-black/20 dark:shadow-black/40 hover:text-pink-600 dark:hover:text-pink-300 transition-colors"
                        >
                            ↓ New messages
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
