"use server"

import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { db } from '@/server/db/drizzle';
import { getSpotifyHeaders, getSpotifyArtist } from '@/server/utils/externalApiQueries';
import { eq } from "drizzle-orm";
import { artists } from '@/server/db/schema';
import { sendDiscordMessage } from '@/server/utils/queriesTS';
import { getUserById } from '@/server/utils/queriesTS';

export type AddArtistResp = {
    status: "success" | "error" | "exists",
    artistId?: string,
    message?: string,
    artistName?: string
}

export async function addArtist(spotifyId: string): Promise<AddArtistResp> {
    console.log("[Server Action] Starting addArtist for spotifyId:", spotifyId);
    
    const session = await getServerSession(authOptions);
    console.log("[Server Action] Session state:", {
        exists: !!session,
        userId: session?.user?.id
    });

    if (!session) {
        console.log("[Server Action] No session found - authentication failed");
        throw new Error("Not authenticated");
    }
    
    try {
        console.log("[Server Action] Getting user data...");
        const user = await getUserById(session.user.id);
        console.log("[Server Action] User data:", {
            userId: user?.id,
            isWhitelisted: user?.isWhiteListed,
            wallet: user?.wallet
        });

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

        console.log("[Server Action] Checking if artist exists in database...");
        const artist = await db.query.artists.findFirst({ where: eq(artists.spotify, spotifyId) });
        if (artist) {
            console.log("[Server Action] Artist already exists:", artist);
            return { 
                status: "exists", 
                artistId: artist.id, 
                artistName: artist.name ?? "", 
                message: "That artist is already in our database" 
            };
        }

        console.log("[Server Action] Inserting new artist into database...");
        const [newArtist] = await db.insert(artists).values({
            spotify: spotifyId,
            addedBy: session.user.id,
            lcname: spotifyArtist.data.name.toLowerCase(),
            name: spotifyArtist.data.name
        }).returning();
        console.log("[Server Action] New artist created:", newArtist);

        await sendDiscordMessage(`${user?.wallet} added new artist named: ${newArtist.name} (Submitted SpotifyId: ${spotifyId}) ${newArtist.createdAt}`);
        return { 
            status: "success", 
            artistId: newArtist.id, 
            artistName: newArtist.name ?? "", 
            message: "Success! You can now find this artist in our directory" 
        };
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
        return { 
            status: "error", 
            artistId: undefined, 
            message: "Something went wrong on our end, please try again" 
        };   
    }
} 