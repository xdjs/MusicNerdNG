"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { getSpotifyHeaders, getSpotifyArtist } from "@/server/utils/externalApiQueries";
import { Button } from "@/components/ui/button";
import { addArtist } from "@/server/utils/queriesTS";

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
}

// Handles the main content of the Add Artist page, including fetching and displaying Spotify artist data
// and managing the addition of artists to the database
// Params:
//      None - Uses hooks internally for state and navigation
// Returns:
//      JSX.Element - The rendered content including artist details and action buttons
function AddArtistContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const spotifyId = searchParams.get("spotify");
    const [artist, setArtist] = useState<SpotifyArtist | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);

    // Fetches artist data from Spotify API when the component mounts or spotifyId changes
    // Params:
    //      None - Uses spotifyId from component state
    // Returns:
    //      void - Updates component state with artist data or error
    async function fetchArtistData() {
        if (!spotifyId) {
            setError("No Spotify ID provided");
            setLoading(false);
            return;
        }

        try {
            const headers = await getSpotifyHeaders();
            const response = await getSpotifyArtist(spotifyId, headers);
            
            if (response.error || !response.data) {
                setError(response.error || "Failed to fetch artist data");
            } else if (
                'images' in response.data &&
                Array.isArray(response.data.images) &&
                'followers' in response.data &&
                'genres' in response.data &&
                Array.isArray(response.data.genres)
            ) {
                setArtist(response.data as SpotifyArtist);
            } else {
                setError("Invalid artist data format");
            }
        } catch (err) {
            setError("Failed to fetch artist data");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchArtistData();
    }, [spotifyId]);

    // Handles the addition of an artist to the database and navigates to their page on success
    // Params:
    //      None - Uses spotifyId from component state
    // Returns:
    //      Promise<void> - Redirects to artist page on success or updates error state
    async function handleAddArtist() {
        if (!spotifyId) return;
        
        setAdding(true);
        try {
            const result = await addArtist(spotifyId);
            
            if (result.status === "success" && result.artistId) {
                router.push(`/artist/${result.artistId}`);
            } else if (result.status === "exists" && result.artistId) {
                router.push(`/artist/${result.artistId}`);
            } else {
                setError(result.message || "Failed to add artist");
            }
        } catch (err) {
            setError("Failed to add artist");
        } finally {
            setAdding(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-gray-900"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-4">
                <div className="text-red-500 text-xl">{error}</div>
                <Button onClick={() => router.back()}>Go Back</Button>
            </div>
        );
    }

    if (!artist) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-4">
                <div className="text-xl">Artist not found</div>
                <Button onClick={() => router.back()}>Go Back</Button>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="bg-white p-8 rounded-xl shadow-lg max-w-2xl w-full mx-4">
                <div className="flex flex-col md:flex-row gap-8 items-center">
                    {artist.images[0] && (
                        <img
                            src={artist.images[0].url}
                            alt={artist.name}
                            className="w-48 h-48 object-cover rounded-lg"
                        />
                    )}
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold mb-4">{artist.name}</h1>
                        <div className="space-y-2 mb-6">
                            <p className="text-gray-600">
                                {artist.followers.total.toLocaleString()} followers on Spotify
                            </p>
                            {artist.genres.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {artist.genres.map(genre => (
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
                                disabled={adding}
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

// Main page component that wraps the content in a Suspense boundary for proper client-side navigation
// Params:
//      None
// Returns:
//      JSX.Element - The wrapped AddArtistContent component with a loading fallback
export default function AddArtistPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-gray-900"></div>
            </div>
        }>
            <AddArtistContent />
        </Suspense>
    );
} 