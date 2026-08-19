"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { MusicPlatform } from "@/server/utils/musicPlatform";

export type DuplicateArtistCandidate = {
    id: string;
    name: string | null;
    spotify: string | null;
    deezer: string | null;
};

type DuplicateArtistChoiceProps = {
    candidates: DuplicateArtistCandidate[];
    platform: MusicPlatform;
    platformId: string;
    message?: string;
    isCreatingSeparate: boolean;
    onCreateSeparate: () => void | Promise<void>;
    onChooseExisting?: () => void;
};

function linkedPlatforms(candidate: DuplicateArtistCandidate) {
    return [candidate.spotify ? "Spotify" : null, candidate.deezer ? "Deezer" : null]
        .filter(Boolean)
        .join(" and ");
}

function canonicalArtistUrl(platform: MusicPlatform, platformId: string) {
    const encodedId = encodeURIComponent(platformId);
    return platform === "spotify"
        ? `https://open.spotify.com/artist/${encodedId}`
        : `https://www.deezer.com/artist/${encodedId}`;
}

export default function DuplicateArtistChoice({
    candidates,
    platform,
    platformId,
    message,
    isCreatingSeparate,
    onCreateSeparate,
    onChooseExisting,
}: DuplicateArtistChoiceProps) {
    if (isCreatingSeparate) {
        return (
            <section
                role="status"
                aria-live="polite"
                aria-busy="true"
                className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
            >
                <h3 className="font-semibold">Creating separate artist…</h3>
                <p className="mt-1 text-sm">
                    Please wait while the artist is created. This action cannot be cancelled.
                </p>
            </section>
        );
    }

    const submittedUrl = canonicalArtistUrl(platform, platformId);

    return (
        <section
            aria-label="Possible existing artists"
            aria-live="polite"
            className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
        >
            <h3 className="font-semibold">Is this an existing artist?</h3>
            <p className="mt-1 text-sm">
                {message ?? "We found an artist with the same name. Choose where this link belongs."}
            </p>

            <ul className="mt-3 space-y-3">
                {candidates.map((candidate) => {
                    const platforms = linkedPlatforms(candidate);
                    const href = `/artist/${candidate.id}?addLink=${encodeURIComponent(submittedUrl)}`;

                    return (
                        <li key={candidate.id} className="rounded-md border border-amber-200 bg-white p-3">
                            <p className="font-medium text-gray-950">{candidate.name || "Unnamed artist"}</p>
                            {platforms && (
                                <p className="mb-2 text-xs text-gray-600">Already linked on {platforms}</p>
                            )}
                            <Link
                                href={href}
                                onClick={onChooseExisting}
                                aria-label={`Add link to existing artist: ${candidate.name || "Unnamed artist"} (${candidate.id})`}
                                className="inline-flex min-h-9 items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-gray-950 shadow-sm hover:bg-accent hover:text-accent-foreground"
                            >
                                Add link to existing artist
                            </Link>
                        </li>
                    );
                })}
            </ul>

            <div className="mt-4 border-t border-amber-200 pt-4">
                <p className="mb-2 text-xs text-amber-900">
                    Only create a separate artist if this is a different person or group with the same name.
                </p>
                <Button
                    type="button"
                    variant="outline"
                    disabled={isCreatingSeparate}
                    onClick={onCreateSeparate}
                >
                    {isCreatingSeparate ? "Creating..." : "Create separate artist"}
                </Button>
            </div>
        </section>
    );
}
