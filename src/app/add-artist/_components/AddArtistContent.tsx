"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addArtist } from "../../actions/addArtist";
import { useSession } from "next-auth/react";

interface SpotifyArtist {
    id: string;
    name: string;
    images: Array<{
        url: string;
        height: number;
        width: number;
    }>;
    followers: {
        total: number;
    };
    genres: string[];
    type: string;
    uri: string;
    external_urls: {
        spotify: string;
    };
}

export default function AddArtistContent({ initialArtist }: { initialArtist: SpotifyArtist }) {
    const router = useRouter();
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { data: session } = useSession();

    async function handleAddArtist() {
        if (!session) {
            setError("Please log in to add artists");
            return;
        }

        setAdding(true);
        try {
            const result = await addArtist(initialArtist.id);
            
            if (result.status === "success" && result.artistId) {
                router.push(`/artist/${result.artistId}`);
            } else if (result.status === "exists" && result.artistId) {
                router.push(`/artist/${result.artistId}`);
            } else {
                setError(result.message || "Failed to add artist");
            }
        } catch (err) {
            console.error("Error in handleAddArtist:", err);
            setError("Failed to add artist - please ensure you are logged in");
        } finally {
            setAdding(false);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="bg-white p-8 rounded-xl shadow-lg max-w-2xl w-full mx-4">
                {!session && (
                    <div className="mb-4 p-4 bg-yellow-100 text-yellow-800 rounded-lg">
                        Please log in to add artists to the database
                    </div>
                )}
                {error && (
                    <div className="mb-4 p-4 bg-red-100 text-red-800 rounded-lg">
                        {error}
                    </div>
                )}
                <div className="flex flex-col md:flex-row gap-8 items-center">
                    {initialArtist.images[0] && (
                        <img
                            src={initialArtist.images[0].url}
                            alt={initialArtist.name}
                            className="w-48 h-48 object-cover rounded-lg"
                        />
                    )}
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold mb-4">{initialArtist.name}</h1>
                        <div className="space-y-2 mb-6">
                            <p className="text-gray-600">
                                {initialArtist.followers.total.toLocaleString()} followers on Spotify
                            </p>
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
                                disabled={adding || !session}
                                className="bg-green-500 hover:bg-green-600 text-white"
                            >
                                {adding ? "Adding..." : "Add Artist"}
                            </Button>
                            <Button
                                onClick={() => router.back()}
                                variant="outline"
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
} 