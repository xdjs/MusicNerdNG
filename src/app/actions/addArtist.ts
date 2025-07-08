"use server"

import { getServerAuthSession } from "@/server/auth";
import { getSpotifyHeaders, getSpotifyArtist } from '@/server/utils/externalApiQueries';
import { getUserById } from '@/server/utils/queries/userQueries';
import { sendDiscordMessage } from '@/server/utils/queries/discord';
import { addArtist as dbAddArtist, type AddArtistResp } from "@/server/utils/queries/artistQueries";

export async function addArtist(spotifyId: string): Promise<AddArtistResp> {
    console.log("[Server Action] Starting addArtist for spotifyId:", spotifyId);
    
    const session = await getServerAuthSession();
    console.log("[Server Action] Session state:", {
        exists: !!session,
        userId: session?.user?.id
    });

    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';

    if (isWalletRequired && !session) {
        console.log("[Server Action] No session found - authentication failed");
        throw new Error("Not authenticated");
    }

    try {
        console.log("[Server Action] Getting Spotify headers...");
        const headers = await getSpotifyHeaders();
        if (!headers?.headers?.Authorization) {
            console.error("[Server Action] Failed to get Spotify headers");
            return { status: "error", message: "Failed to authenticate with Spotify" };
        }

        console.log("[Server Action] Fetching Spotify artist data...");
        const spotifyArtist = await getSpotifyArtist(spotifyId, headers);
        console.log("[Server Action] Spotify artist response:", spotifyArtist);

        if (spotifyArtist.error) {
            console.error("[Server Action] Spotify artist error:", spotifyArtist.error);
            return { status: "error", message: spotifyArtist.error };
        }

        if (!spotifyArtist.data?.name) {
            console.error("[Server Action] Invalid artist data received from Spotify");
            return { status: "error", message: "Invalid artist data received from Spotify" };
        }

        // Get user data if we have a session
        let user = null;
        if (session?.user?.id) {
            console.log("[Server Action] Getting user data...");
            user = await getUserById(session.user.id);
            console.log("[Server Action] User data:", {
                userId: user?.id,
                isWhitelisted: user?.isWhiteListed,
                wallet: user?.wallet
            });
        }

        const result = await dbAddArtist(spotifyId);

        // Only send Discord message if we have user data
        if (result.status === "success" && user) {
            await sendDiscordMessage(`${user.wallet} added new artist named: ${result.artistName} (Submitted SpotifyId: ${spotifyId})`);
        }

        return result;
    } catch (e) {
        console.error("[Server Action] Error in addArtist:", e);
        if (e instanceof Error) {
            if (e.message.includes('auth')) {
                return { status: "error", message: "Please log in to add artists" };
            }
            if (e.message.includes('duplicate')) {
                return { status: "error", message: "This artist is already in our database" };
            }
        }
        return { status: "error", message: "Something went wrong on our end, please try again" };
    }
} 