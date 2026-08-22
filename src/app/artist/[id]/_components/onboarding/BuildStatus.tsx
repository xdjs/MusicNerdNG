"use client";

import MusicNerdLoader from "@/app/_components/MusicNerdLoader";

/** Progress group ids emitted by runAutoBuild, in the order they run. Kept in
 *  sync with turnHandlers.ts by hand — a stage that never reports simply stays
 *  pending rather than breaking the view. */
export const BUILD_STAGES = [
    { group: "platform-search", label: "Finding your profiles" },
    { group: "source-search", label: "Reading what people wrote about you" },
    { group: "about-write", label: "Writing your About" },
] as const;

type ProgressItem = { kind: string; text?: string; done?: boolean; group?: string };

type StageState = "pending" | "active" | "done";

function stageStates(items: ProgressItem[]): { label: string; detail: string | null; state: StageState }[] {
    return BUILD_STAGES.map(stage => {
        const item = items.find(i => i.kind === "progress" && i.group === stage.group);
        if (!item) return { label: stage.label, detail: null, state: "pending" as StageState };
        return {
            // The finished label carries the count ("Found 7 profiles"), which is
            // the interesting part — show it in place of the generic one.
            label: item.done && item.text ? item.text : stage.label,
            detail: null,
            state: item.done ? ("done" as StageState) : ("active" as StageState),
        };
    });
}

function Tick({ state }: { state: StageState }) {
    if (state === "done") {
        return (
            <span
                className="flex-shrink-0 w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center shadow-[0_0_12px_rgba(236,72,153,0.55)]"
                aria-hidden="true"
            >
                <svg viewBox="0 0 12 12" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </span>
        );
    }
    if (state === "active") {
        // The Music Nerd mark, breathing, rather than a generic spinner. The mark
        // is a face, so it scales and brightens instead of rotating — see
        // MusicNerdLoader. A halo behind it carries the same pink as the rest of
        // the card.
        return (
            <span className="relative flex-shrink-0 w-6 h-6 flex items-center justify-center">
                <span aria-hidden="true" className="absolute inset-0 rounded-full bg-pink-500/25 motion-safe:animate-ping" />
                <MusicNerdLoader size={24} label="Working on this step" className="relative" />
            </span>
        );
    }
    return (
        <span
            className="flex-shrink-0 w-6 h-6 rounded-full border border-black/15 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.04]"
            aria-hidden="true"
        />
    );
}

/**
 * What the artist sees while their page is built.
 *
 * The flow used to be a conversation, so the surface was a chat: message
 * bubbles, a typing indicator, a four-segment step rail, and a tall empty
 * column waiting for replies. None of that is true any more — the build asks
 * nothing. Pete: "it's not a chat anymore, it's more of a loading state so it
 * should feel more like that."
 *
 * So: a compact status card. Three stages, each pending, running, or done,
 * with the finished label carrying its own count. No bubbles, no typing dots,
 * no step rail for steps that no longer exist.
 *
 * The chat surface is still used on the RESUME path, where an artist genuinely
 * is answering step cards — see OnboardingChat, which switches to this view
 * only while no step card has appeared.
 */
export default function BuildStatus({
    artistName,
    items,
    complete,
    onSkip,
    onFinish,
}: {
    artistName: string;
    items: ProgressItem[];
    complete: boolean;
    onSkip: () => void;
    onFinish: () => void;
}) {
    const stages = stageStates(items);
    const finishedCount = stages.filter(s => s.state === "done").length;

    return (
        <div className="glass relative w-full max-w-md overflow-hidden shadow-2xl shadow-black/40">
            {/* Brand wash — keeps the card from reading as a system dialog. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-gradient-to-b from-pink-500/25 via-purple-500/10 to-transparent blur-2xl"
            />
            <div className="relative px-6 pt-6 pb-4 space-y-1">
                <div className="flex items-start justify-between gap-3">
                    <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-black dark:text-white">
                        {!complete && <MusicNerdLoader size={22} label="Building your page" />}
                        {complete ? "Your page is ready" : "Building your page"}
                    </h2>
                    {!complete && (
                        <button
                            onClick={onSkip}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors flex-shrink-0"
                        >
                            Skip for now
                        </button>
                    )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300/80">
                    {complete
                        ? `${artistName}. You can edit anything below, and take off anything that isn't you.`
                        : artistName}
                </p>
            </div>

            {/* Thin determinate bar: three real stages, not four abstract steps. */}
            <div className="relative h-[3px] bg-black/5 dark:bg-white/10">
                <div
                    className="h-full bg-gradient-to-r from-pink-500 to-purple-400 shadow-[0_0_10px_rgba(236,72,153,0.7)] transition-[width] duration-700 ease-out"
                    style={{ width: `${(finishedCount / BUILD_STAGES.length) * 100}%` }}
                />
            </div>

            <ul className="relative px-6 py-5 space-y-3.5">
                {stages.map(stage => (
                    <li key={stage.label} className="flex items-center gap-3.5">
                        <Tick state={stage.state} />
                        <span
                            className={`text-sm transition-colors duration-500 ${
                                stage.state === "pending"
                                    ? "text-gray-400 dark:text-gray-500"
                                    : stage.state === "active"
                                        ? "text-black dark:text-white font-medium"
                                        : "text-gray-700 dark:text-gray-300"
                            }`}
                        >
                            {stage.label}
                        </span>
                    </li>
                ))}
            </ul>

            {complete && (
                <div className="relative px-6 pb-6">
                    <button
                        onClick={onFinish}
                        className="w-full bg-pink-500 hover:bg-pink-600 active:bg-pink-700 transition-colors text-white font-semibold py-3 rounded-xl shadow-lg shadow-pink-500/30"
                    >
                        See my page
                    </button>
                </div>
            )}
        </div>
    );
}
