"use server"

import { getServerAuthSession } from "@/server/auth";
import { getSpotifyHeaders, getSpotifyArtist } from '@/server/utils/externalApiQueries';
import { getUserById } from '@/server/utils/queries/userQueries';
import { sendDiscordMessage } from '@/server/utils/queries/discord';
import { addArtist as dbAddArtist, type AddArtistResp } from "@/server/utils/queries/artistQueries";

export async function addArtist(spotifyId: string): Promise<AddArtistResp> {
    const session = await getServerAuthSession();

    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';

    if (isWalletRequired && !session) {
        throw new Error("Not authenticated");
    }

    try {
        const headers = await getSpotifyHeaders();
        if (!headers?.headers?.Authorization) {
            return { status: "error", message: "Failed to authenticate with Spotify" };
        }

        const spotifyArtist = await getSpotifyArtist(spotifyId, headers);

        if (spotifyArtist.error) {
            return { status: "error", message: spotifyArtist.error };
        }

        if (!spotifyArtist.data?.name) {
            return { status: "error", message: "Invalid artist data received from Spotify" };
        }

        // Get user data if we have a session
        let user = null;
        if (session?.user?.id) {
            user = await getUserById(session.user.id);
        }

        const result = await dbAddArtist(spotifyId);

        // Only send Discord message if we have user data
        if (result.status === "success" && user) {
            await sendDiscordMessage(`${user.wallet} added new artist named: ${result.artistName} (Submitted SpotifyId: ${spotifyId})`);
        }

        return result;
    } catch (e) {
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