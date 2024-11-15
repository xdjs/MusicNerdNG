"use server"

import { db } from '@/server/db/drizzle'
import { getSpotifyHeaders, getSpotifyImage, getSpotifyArtist } from './externalApiQueries';
import { isNotNull, ilike, desc, eq, sql, inArray, and, gte, lte } from "drizzle-orm";
import { featured, artists, users, ugcresearch, urlmap } from '@/server/db/schema';
import { Artist } from '../db/DbTypes';
import { isObjKey, extractArtistId } from './services';
import { getServerAuthSession } from '../auth';
import { unstable_cache } from 'next/cache';
import { DateRange } from 'react-day-picker';

export async function getFeaturedArtistsTS() {
    const featuredObj = await db.query.featured.findMany({
        where: isNotNull(featured.featuredArtist),
        with: { featuredArtist: true }
    });
    let featuredArtists = featuredObj.map(artist => { return { spotifyId: artist.featuredArtist?.spotify ?? null, artistId: artist.featuredArtist?.id } });
    const spotifyHeader = await getSpotifyHeaders();
    if (!spotifyHeader) return [];
    const images = await Promise.all(featuredArtists.map(artist => getSpotifyImage(artist.spotifyId ?? "", artist.artistId ?? "", spotifyHeader)));
    return images;
}

export async function searchForArtistByName(name: string) {
    const result = await db
        .select()
        .from(artists)
        .where(
            ilike(artists.name, `%${name}%`)
        )
        .orderBy(desc(artists.name));
    return result;
}

export async function getArtistById(id: string) {
    const result = await db.query.artists.findFirst({
        where: eq(artists.id, id)
    });
    return result;
}

export const getAllLinks = unstable_cache(
    async () => {
        const result = await db.query.urlmap.findMany();
        return result;
    },
    ['url-map-links'], // Cache key
    {
      revalidate: 86400, // Revalidate every day
      tags: ['url-map-links'] // Tag for manual revalidation
    }
);

export async function getArtistLinks(artist: Artist) {
    try {
        const allLinkObjects = await getAllLinks();
        if (!artist) throw new Error("Artist not found");
        const artistLinksSiteNames = []
        for (const platform of allLinkObjects) {
            if (isObjKey(platform.siteName, artist) && artist[platform.siteName]) {
                artistLinksSiteNames.push({ ...platform, artistUrl: platform.appStringFormat.replace("%@", artist[platform.siteName]?.toString() ?? "") });
            }
        }
        return artistLinksSiteNames;
    } catch (e) {
        throw new Error("Error fetching artist links");
    }
}

export type AddArtistResp = {
    status: "success" | "error" | "exists",
    artistId?: string,
    message?: string,
    artistName?: string
}


export async function addArtist(spotifyId: string): Promise<AddArtistResp> {
    const session = await getServerAuthSession();
    if (!session) throw new Error("Not authenticated");
    const headers = await getSpotifyHeaders();
    const spotifyArtist = await getSpotifyArtist(spotifyId, headers);
    if (spotifyArtist.error) return { status: "error", message: "That spotify id you entered doesn't exist" };
    const artist = await db.query.artists.findFirst({ where: eq(artists.spotify, spotifyId) });
    if (artist) return { status: "exists", artistId: artist.id, artistName: artist.name ?? "", message: "That artist is already in our database" };
    try {
        const [newArtist] = await db.insert(artists).values(
            {
                spotify: spotifyId,
                addedBy: session.user.id,
                lcname: spotifyArtist.data?.name.toLowerCase(),
                name: spotifyArtist.data?.name
            }).returning();
        return { status: "success", artistId: newArtist.id, artistName: newArtist.name ?? "", message: "Success! You can now find this artist in our directory" };
    } catch (e) {
        return { status: "error", artistId: undefined, message: "Something went wrong on our end, please try again" };   
     }
}

export type AddArtistDataResp = {
    status: "success" | "error",
    message: string
}

export async function approveUgcAdmin(ugcIds: string[]) {
    const user = await getServerAuthSession();
    if (!user) throw new Error("Not authenticated");
    const dbUser = await getUserById(user.user.id);
    if (!dbUser || !dbUser.isAdmin) throw new Error("Not authorized");
    try {
        const ugcData = await db.query.ugcresearch.findMany({ where: inArray(ugcresearch.id, ugcIds) });
        await Promise.all(ugcData.map(async (ugc) => {
            await approveUGC(ugc.id, ugc.artistId ?? "", ugc.siteName ?? "", ugc.siteUsername ?? "");
        }));
    } catch (e) {
        return { status: "error", message: "Error approving UGC" };
    }
    return { status: "success", message: "UGC approved" };
}

export async function approveUGC(ugcId: string, artistId: string, siteName: string, artistIdFromUrl: string) {
    try {
        await db.execute(sql`
            UPDATE artists
            SET ${sql.identifier(siteName)} = ${artistIdFromUrl} 
            WHERE id = ${artistId}`);
        await db.update(ugcresearch).set({ accepted: true }).where(eq(ugcresearch.id, ugcId));
    } catch (e) {
        throw new Error("Error approving UGC");
    }
}

export async function addArtistData(artistUrl: string, artist: Artist): Promise<AddArtistDataResp> {
    const session = await getServerAuthSession();
    if (!session) throw new Error("Not authenticated");
    const artistIdFromUrl = await extractArtistId(artistUrl);
    if (!artistIdFromUrl) return { status: "error", message: "The data you're trying to add isn't in our list of approved links" };
    try {
        const existingArtistUGC = await db.query.ugcresearch.findFirst({ where: eq(ugcresearch.ugcUrl, artistUrl) });
        if (existingArtistUGC) return { status: "error", message: "This artist data has already been added" };
        const [newUGC] = await db.insert(ugcresearch).values(
            {
                ugcUrl: artistUrl,
                siteName: artistIdFromUrl.siteName,
                siteUsername: artistIdFromUrl.id,
                artistId: artist.id,
                name: artist.name,
                userId: session.user.id
            }).returning();
        const user = await getUserById(session.user.id);
        if (user?.isWhiteListed) {
            await approveUGC(newUGC.id, artist.id, artistIdFromUrl.siteName, artistIdFromUrl.id);
            return { status: "success", message: "We updated the artist with that data" };
        }
        return { status: "success", message: "Thanks for adding, we'll review this addition before posting" };
    } catch (e) {
        return { status: "error", message: "Error adding artist data, please try again" };
    }
}

export async function getUserByWallet(wallet: string) {
    try {
        return await db.query.users.findFirst({ where: eq(users.wallet, wallet) });
    } catch (e) {
        throw new Error("Error finding user");
    }
}

export async function getUserById(id: string) {
    try {
        return await db.query.users.findFirst({ where: eq(users.id, id) });
    } catch (e) {
        throw new Error("Error finding user");
    }
}

export async function createUser(wallet: string) {
    try {
        const [newUser] = await db.insert(users).values({ wallet: wallet }).returning();
        return newUser;
    } catch (e) {
        throw new Error("Error finding user");
    }
}

export async function getPendingUGC() {
    try {
        const result = await db.query.ugcresearch.findMany({ where: eq(ugcresearch.accepted, false) });
        return result;
    } catch (e) {
        throw new Error("Error finding pending UGC");
    }
}

export async function getUgcStats(date: DateRange) {
    const user = await getServerAuthSession();
    if (!user) throw new Error("Not authenticated");
    const ugcList = await db.query.ugcresearch.findMany(
        { 
            where: and(
                gte(ugcresearch.createdAt, date.from?.toISOString() ?? ""), 
                lte(ugcresearch.createdAt, date.to?.toISOString() ?? ""), 
                eq(ugcresearch.userId, user.user.id))
        }
    );
    const artistsList = await db.query.artists.findMany(
        { 
            where: and(
                gte(artists.createdAt, date.from?.toISOString() ?? ""), 
                lte(artists.createdAt, date.to?.toISOString() ?? ""), 
                eq(artists.addedBy, user.user.id))
        }
    );
    return { ugcCount: ugcList.length, artistsCount: artistsList.length };
}

export async function getWhitelistedUsers() {
    const user = await getServerAuthSession();
    if (!user) throw new Error("Not authenticated");
    const result = await db.query.users.findMany({ where: eq(users.isWhiteListed, true) });
    return result;
}

export async function removeFromWhitelist(userIds: string[]) {
    await db.update(users).set({ isWhiteListed: false }).where(inArray(users.id, userIds));
}

export type AddUsersToWhitelistResp = {
    status: "success" | "error",
    message: string
}

export async function addUsersToWhitelist(walletAddresses: string[]): Promise<AddUsersToWhitelistResp> {
    try {
        await db.update(users).set({ isWhiteListed: true }).where(inArray(users.wallet, walletAddresses));
        return { status: "success", message: "Users added to whitelist" };
    } catch (e) {
        return { status: "error", message: "Error adding users to whitelist" };
    }
}

export async function searchForUsersByWallet(wallet: string) {
    const result = await db.query.users.findMany({ where: ilike(users.wallet, `%${wallet}%`) });
    return result.map((user) => user.wallet);
}
