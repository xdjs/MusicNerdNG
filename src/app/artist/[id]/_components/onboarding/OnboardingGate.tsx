"use client";

import { useEffect, useState } from "react";
import OnboardingChat from "./OnboardingChat";
import OnboardingBanner from "./OnboardingBanner";

export function skipFlagKey(artistId: string): string {
    return `mn-onboarding-skip-${artistId}`;
}

type Props = {
    artistId: string;
    artistName: string;
    currentStep: string | null;
};

/**
 * Client-side takeover-vs-banner branch. The server only reports onboarding
 * state; the skip flag lives in sessionStorage and is invisible to the server
 * component (spec §8). Skip is session-scoped: a later visit reopens the chat.
 */
export default function OnboardingGate({ artistId, artistName, currentStep }: Props) {
    // Start closed and decide after mount — sessionStorage is unavailable during SSR.
    const [mode, setMode] = useState<"closed" | "chat" | "banner">("closed");

    useEffect(() => {
        const skipped = sessionStorage.getItem(skipFlagKey(artistId)) === "1";
        setMode(skipped ? "banner" : "chat");
    }, [artistId]);

    if (mode === "closed") return null;
    if (mode === "chat") {
        return (
            <OnboardingChat
                artistId={artistId}
                artistName={artistName}
                onSkip={() => {
                    sessionStorage.setItem(skipFlagKey(artistId), "1");
                    setMode("banner");
                }}
                // "See my page" after a real finish: close the takeover WITHOUT the
                // skip flag, so a later visit (onboarding now complete) never shows
                // the "Finish setting up" banner it would flash before refresh.
                onFinish={() => setMode("closed")}
            />
        );
    }
    return (
        <OnboardingBanner
            currentStep={currentStep}
            onContinue={() => {
                sessionStorage.removeItem(skipFlagKey(artistId));
                setMode("chat");
            }}
        />
    );
}
