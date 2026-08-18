"use client";

// One next step per visit, framed as the next win — never as incompleteness.
const STEP_LABELS: Record<string, string> = {
    profiles: "Next up: confirm your profiles",
    vault: "Next up: pick your best sources",
    interview: "Next up: tell us your story",
    publish: "One tap left: publish your About",
};

type Props = {
    currentStep: string | null;
    onContinue: () => void;
};

export default function OnboardingBanner({ currentStep, onContinue }: Props) {
    const label = (currentStep && STEP_LABELS[currentStep]) ?? "Next up: confirm your profiles";
    return (
        <div className="glass flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl">
            <div>
                <p className="text-black dark:text-white font-semibold">Finish setting up your profile</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">{label} — about a minute.</p>
            </div>
            <button
                onClick={onContinue}
                className="bg-pink-500 hover:bg-pink-600 active:bg-pink-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
            >
                Continue →
            </button>
        </div>
    );
}
