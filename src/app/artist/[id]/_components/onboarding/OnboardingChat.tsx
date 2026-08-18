"use client";

type Props = { artistId: string; artistName: string; onSkip: () => void };

export default function OnboardingChat({ onSkip }: Props) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="glass p-6 rounded-2xl">
                <p className="text-black dark:text-white">Onboarding chat coming in the next task.</p>
                <button onClick={onSkip} className="mt-3 text-sm text-gray-500 underline">Skip for now</button>
            </div>
        </div>
    );
}
