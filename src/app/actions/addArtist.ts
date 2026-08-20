"use server"

import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import {
    addArtist as dbAddArtist,
    type AddArtistOptions,
    type AddArtistResp,
} from "@/server/utils/queries/artistQueries";
import type { MusicPlatform } from "@/server/utils/musicPlatform";

export async function addArtist(
    platformId: string,
    platform: MusicPlatform = 'spotify',
    options?: AddArtistOptions,
): Promise<AddArtistResp> {
    const session = await getServerAuthSession() ?? await getDevSession();

    if (!session) {
        return {
            status: "error",
            code: "UNAUTHENTICATED",
            message: "Please log in to add artists",
        };
    }

    try {
        const result = await dbAddArtist(platformId, platform, options);
        return result;
    } catch (e) {
        console.error("[addArtist] Error:", e);
        if (e instanceof Error) {
            if (e.message.includes('auth')) {
                return {
                    status: "error",
                    code: "UNAUTHENTICATED",
                    message: "Please log in to add artists",
                };
            }
            if (e.message.includes('duplicate')) {
                return { status: "error", message: "This artist is already in our database" };
            }
        }
        return { status: "error", message: "Something went wrong on our end, please try again" };
    }
}
