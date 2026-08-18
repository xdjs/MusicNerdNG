"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOnboardingChat, type ChatItem } from "./useOnboardingChat";
import { ProfilesCard, VaultCard, InterviewInput, AboutDraftCard } from "./StepCards";

type Props = { artistId: string; artistName: string; onSkip: () => void; onFinish: () => void };

// Presentational only — progress rail order + stage derivation for display purposes.
const STEP_ORDER = ["profiles", "vault", "interview", "publish"] as const;

export default function OnboardingChat({ artistId, artistName, onSkip, onFinish }: Props) {
    const { items, busy, sendTurn } = useOnboardingChat(artistId);
    const router = useRouter();
    const opened = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!opened.current) {
            opened.current = true;
            void sendTurn({ type: "open" });
        }
    }, [sendTurn]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [items]);

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
                return (
                    <div
                        className={`self-start text-xs px-3 py-1 rounded-full border text-gray-700 dark:text-gray-300 ${
                            item.done
                                ? "border-pink-400/50 dark:border-pink-400/40"
                                : "border-gray-300/60 dark:border-gray-600/60 motion-safe:animate-pulse"
                        }`}
                    >
                        {item.done ? "✓" : "⚙"} {item.text}
                    </div>
                );
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
                if (item.step === "profiles") return <ProfilesCard payload={item.payload as never} disabled={!interactive} onConfirm={r => void sendTurn({ type: "confirm_profiles", ...r })} />;
                if (item.step === "vault") return <VaultCard payload={item.payload as never} disabled={!interactive} onConfirm={r => void sendTurn({ type: "vault_review", ...r })} />;
                if (item.step === "interview") return <InterviewInput payload={item.payload as never} disabled={!interactive} onAnswer={r => void sendTurn({ type: "interview_answer", ...r })} />;
                return null;
            }
            case "draft":
                return <AboutDraftCard doc={item.doc ?? ""} about={item.about ?? ""} disabled={!interactive} onPublish={r => void sendTurn({ type: "publish", ...r })} />;
            case "complete":
                return (
                    <div className="self-stretch text-center glass rounded-xl p-4 shadow-lg shadow-pink-500/10">
                        <p className="text-2xl">🎉</p>
                        <p className="font-bold text-lg text-black dark:text-white">You&apos;re live!</p>
                        <button
                            onClick={() => { router.refresh(); onFinish(); }}
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
                <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-glass p-4 flex flex-col gap-2.5">
                    {items.map(item => (
                        <div key={item.id} className="flex flex-col">{renderItem(item)}</div>
                    ))}
                    {busy && (
                        <div className="glass-subtle self-start !rounded-2xl !rounded-bl-md px-4 py-3 flex items-center gap-1.5" aria-hidden="true">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-gray-400 motion-safe:animate-bounce [animation-delay:-0.3s]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-gray-400 motion-safe:animate-bounce [animation-delay:-0.15s]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-gray-400 motion-safe:animate-bounce" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
