"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOnboardingChat, type ChatItem } from "./useOnboardingChat";
import { ProfilesCard, VaultCard, InterviewInput, AboutDraftCard } from "./StepCards";

type Props = { artistId: string; artistName: string; onSkip: () => void };

export default function OnboardingChat({ artistId, artistName, onSkip }: Props) {
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

    const renderItem = (item: ChatItem) => {
        const interactive = item.id === lastInteractiveId && !busy && !complete;
        switch (item.kind) {
            case "bot":
                return <div className="glass rounded-2xl rounded-bl-md px-4 py-2.5 max-w-[85%] self-start">{item.text}</div>;
            case "user":
                return <div className="bg-pink-500 text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-[85%] self-end">{item.text}</div>;
            case "progress":
                return (
                    <div className="self-start text-xs px-3 py-1 rounded-full border border-blue-300/40 text-gray-500">
                        {item.done ? "✓" : "⚙"} {item.text}
                    </div>
                );
            case "error":
                return <div className="self-start text-sm text-amber-600 dark:text-amber-400 px-1">{item.text}</div>;
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
                    <div className="self-stretch text-center glass rounded-xl p-4">
                        <p className="text-2xl">🎉</p>
                        <p className="font-semibold">You&apos;re live!</p>
                        <button
                            onClick={() => { router.refresh(); onSkip(); }}
                            className="mt-2 bg-pink-500 text-white font-semibold px-4 py-2 rounded-lg"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-[480px] h-[85vh] glass rounded-2xl flex flex-col overflow-hidden bg-white/90 dark:bg-gray-900/90">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <p className="font-bold">Set up {artistName}</p>
                    {!complete && (
                        <button onClick={onSkip} className="text-sm text-gray-500 hover:text-gray-700">
                            Skip for now
                        </button>
                    )}
                </div>
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
                    {items.map(item => (
                        <div key={item.id} className="flex flex-col">{renderItem(item)}</div>
                    ))}
                    {busy && <div className="self-start text-gray-400 text-sm px-2 animate-pulse">…</div>}
                </div>
            </div>
        </div>
    );
}
