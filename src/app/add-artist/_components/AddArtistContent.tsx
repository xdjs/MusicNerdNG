"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addArtist } from "../../actions/addArtist";
import { useSession } from "next-auth/react";
import type { MusicPlatform, MusicPlatformArtist } from "@/server/utils/musicPlatform";
import DuplicateArtistChoice, { type DuplicateArtistCandidate } from "@/app/_components/DuplicateArtistChoice";

type PossibleDuplicateResponse = {
    status: "possible_duplicate";
    candidates: DuplicateArtistCandidate[];
    platform: MusicPlatform;
    platformId: string;
    message?: string;
};

const LOGIN_REQUIRED_MESSAGE = "Please log in to add artists";

export default function AddArtistContent({ initialArtist }: { initialArtist: MusicPlatformArtist }) {
    const router = useRouter();
    const [adding, setAdding] = useState(false);
    const [isCreatingSeparate, setIsCreatingSeparate] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [duplicateChoice, setDuplicateChoice] = useState<PossibleDuplicateResponse | null>(null);
    const { data: session, status } = useSession();

    function promptLogin() {
        const loginBtn = document.getElementById("login-btn");
        if (!loginBtn) return false;

        loginBtn.click();
        return true;
    }

    function handleResult(result: Awaited<ReturnType<typeof addArtist>>) {
        if (result.status === "error" && result.message === LOGIN_REQUIRED_MESSAGE) {
            setDuplicateChoice(null);
            setError(promptLogin() ? null : result.message);
            return;
        }

        if ((result.status === "success" || result.status === "exists") && result.artistId) {
            setDuplicateChoice(null);
            router.push(`/artist/${result.artistId}`);
        } else if (result.status === "possible_duplicate") {
            setDuplicateChoice(result);
            setError(null);
        } else {
            setDuplicateChoice(null);
            setError(result.message || "Failed to add artist");
        }
    }

    async function handleAddArtist() {
        if (status === "loading") {
            return;
        }

        if (!session) {
            promptLogin();
            return;
        }

        setAdding(true);
        setError(null);

        try {
            const result = await addArtist(initialArtist.platformId, initialArtist.platform);
            handleResult(result);
        } catch (err) {
            console.error("Error in handleAddArtist:", err);
            if (err instanceof Error && err.message.includes('Not authenticated')) {
                promptLogin();
            } else {
                setError("Failed to add artist - please try again");
            }
        } finally {
            setAdding(false);
        }
    }

    async function handleCreateSeparate() {
        if (!duplicateChoice || isCreatingSeparate) return;

        setIsCreatingSeparate(true);
        setError(null);
        try {
            const result = await addArtist(
                duplicateChoice.platformId,
                duplicateChoice.platform,
                { forceCreate: true },
            );
            handleResult(result);
        } catch (err) {
            console.error("Error creating separate artist:", err);
            setError("Failed to add artist - please try again");
        } finally {
            setIsCreatingSeparate(false);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div
                aria-busy={isCreatingSeparate}
                className="bg-white p-8 rounded-xl shadow-lg max-w-2xl w-full mx-4"
            >
                {status === "loading" ? (
                    <div className="mb-4 p-4 bg-blue-100 text-blue-800 rounded-lg">
                        Loading authentication status...
                    </div>
                ) : !session ? (
                    <div className="mb-4 p-4 bg-yellow-100 text-yellow-800 rounded-lg">
                        Please log in to add artists to the database
                    </div>
                ) : null}
                {error && (
                    <div role="alert" className="mb-4 p-4 bg-red-100 text-red-800 rounded-lg">
                        {error}
                    </div>
                )}
                <div className="flex flex-col md:flex-row gap-8 items-center">
                    {initialArtist.imageUrl && (
                        <img
                            src={initialArtist.imageUrl}
                            alt={initialArtist.name}
                            className="w-48 h-48 object-cover rounded-lg"
                        />
                    )}
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold mb-4">{initialArtist.name}</h1>
                        <div className="space-y-2 mb-6">
                            {initialArtist.followerCount != null && initialArtist.followerCount > 0 && (
                                <p className="text-gray-600">
                                    {initialArtist.followerCount.toLocaleString()} followers
                                </p>
                            )}
                            {initialArtist.genres.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {initialArtist.genres.map(genre => (
                                        <span
                                            key={genre}
                                            className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700"
                                        >
                                            {genre}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex gap-4">
                            <Button
                                onClick={handleAddArtist}
                                disabled={adding || status === "loading" || Boolean(duplicateChoice)}
                                className="bg-green-500 hover:bg-green-600 text-white"
                            >
                                {adding ? "Adding..." : "Add Artist"}
                            </Button>
                            <Button
                                onClick={() => router.back()}
                                variant="outline"
                                disabled={isCreatingSeparate}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                </div>
                {duplicateChoice && (
                    <DuplicateArtistChoice
                        candidates={duplicateChoice.candidates}
                        platform={duplicateChoice.platform}
                        platformId={duplicateChoice.platformId}
                        message={duplicateChoice.message}
                        isCreatingSeparate={isCreatingSeparate}
                        onCreateSeparate={handleCreateSeparate}
                    />
                )}
            </div>
        </div>
    );
}
