"use server"

import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { addArtist as dbAddArtist, type AddArtistResp } from "@/server/utils/queries/artistQueries";
import type { MusicPlatform } from "@/server/utils/musicPlatform";

export async function addArtist(platformId: string, platform: MusicPlatform = 'spotify'): Promise<AddArtistResp> {
    const session = await getServerAuthSession() ?? await getDevSession();

    if (!session) {
        throw new Error("Not authenticated");
    }

    try {
        const result = await dbAddArtist(platformId, platform);
        return result;
    } catch (e) {
        console.error("[addArtist] Error:", e);
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
