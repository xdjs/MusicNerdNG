"use client";

/** Progress group ids emitted by runAutoBuild, in the order they run. Kept in
 *  sync with turnHandlers.ts by hand — a stage that never reports simply stays
 *  pending rather than breaking the view. */
export const BUILD_STAGES = [
    { group: "platform-search", label: "Finding your profiles" },
    { group: "source-search", label: "Reading what's written about you" },
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
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-pink-500 flex items-center justify-center" aria-hidden="true">
                <svg viewBox="0 0 12 12" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </span>
        );
    }
    if (state === "active") {
        return (
            <span
                className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-pink-500 border-t-transparent animate-spin"
                aria-hidden="true"
            />
        );
    }
    return <span className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-black/15 dark:border-white/20" aria-hidden="true" />;
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
        <div className="w-full max-w-md rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-4 space-y-1">
                <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-bold text-black dark:text-white">
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
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    {complete
                        ? `${artistName} — everything below is editable, and anything that isn't you can be removed.`
                        : artistName}
                </p>
            </div>

            {/* Thin determinate bar: three stages, not four abstract steps. */}
            <div className="h-1 bg-black/5 dark:bg-white/10">
                <div
                    className="h-full bg-pink-500 transition-[width] duration-700 ease-out"
                    style={{ width: `${(finishedCount / BUILD_STAGES.length) * 100}%` }}
                />
            </div>

            <ul className="px-5 py-4 space-y-3">
                {stages.map(stage => (
                    <li key={stage.label} className="flex items-center gap-3">
                        <Tick state={stage.state} />
                        <span
                            className={`text-sm ${
                                stage.state === "pending"
                                    ? "text-gray-400 dark:text-gray-500"
                                    : "text-black dark:text-white"
                            }`}
                        >
                            {stage.label}
                        </span>
                    </li>
                ))}
            </ul>

            {complete && (
                <div className="px-5 pb-5">
                    <button
                        onClick={onFinish}
                        className="w-full bg-pink-500 hover:bg-pink-600 active:bg-pink-700 transition-colors text-white font-semibold py-2.5 rounded-lg"
                    >
                        See my page
                    </button>
                </div>
            )}
        </div>
    );
}
