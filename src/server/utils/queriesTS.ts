"use server"

import { db } from '@/server/db/drizzle'
import { getSpotifyHeaders, getSpotifyImage, getSpotifyArtist } from './externalApiQueries';
import { isNotNull, ilike, desc, eq, sql } from "drizzle-orm";
import { featured, artists, users, ugcwhitelist, ugcresearch, urlmap } from '@/server/db/schema';
import { Artist } from '../db/DbTypes';
import { isObjKey, extractArtistId } from './services';
import { getServerAuthSession } from '../auth';
import { unstable_cache } from 'next/cache';

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
        console.log("Fetching all links")
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
    artistId?: string
}


export async function addArtist(spotifyId: string): Promise<AddArtistResp> {
    // Need to implement
    const session = await getServerAuthSession();
    if (!session) throw new Error("Not authenticated");
    // Check if artist already exists
    const headers = await getSpotifyHeaders();
    const spotifyArtist = await getSpotifyArtist(spotifyId, headers);
    if (spotifyArtist.error) return { status: "error", artistId: undefined };
    const artist = await db.query.artists.findFirst({ where: eq(artists.spotify, spotifyId) });
    if (artist) return { status: "exists", artistId: artist.id };
    try {
        const [newArtist] = await db.insert(artists).values(
            {
                spotify: spotifyId,
                addedBy: session.user.id,
                lcname: spotifyArtist.data?.name.toLowerCase(),
                name: spotifyArtist.data?.name
            }).returning();
        return { status: "success", artistId: newArtist.id };
    } catch (e) {
        throw new Error("Error adding artist");
    }
}

export type AddArtistDataResp = {
    status: "success" | "error",
    message: string
}

export async function addArtistData(artistUrl: string, artist: Artist): Promise<AddArtistDataResp> {
    const session = await getServerAuthSession();
    if (!session) throw new Error("Not authenticated");
    const artistIdFromUrl = await extractArtistId(artistUrl);
    if (!artistIdFromUrl) return { status: "error", message: "The data you're trying to add isn't in our list of approved links" };
    try {
        const whiteListedUser = await db.query.ugcwhitelist.findFirst({ where: eq(ugcwhitelist.userId, session.user.id) });
        if (whiteListedUser) {
            await db.execute(sql`
                UPDATE artists
                SET ${sql.identifier(artistIdFromUrl.siteName)} = ${artistIdFromUrl.id} 
                WHERE id = ${artist.id}`);
            return { status: "success", message: "We updated the artist with that data" };
        }
        const existingArtistUGC = await db.query.ugcresearch.findFirst({ where: eq(ugcresearch.ugcUrl, artistUrl) });
        if (existingArtistUGC) return { status: "error", message: "This artist data has already been added" };
        await db.insert(ugcresearch).values(
            {
                ugcUrl: artistUrl,
                siteName: artistIdFromUrl.siteName,
                siteUsername: artistIdFromUrl.id,
                artistId: artist.id,
                name: artist.name,
                userId: session.user.id
            }).returning();
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

export async function checkWhiteListStatusById(id: string) {
    try {
        const whiteListedUser = await db.query.ugcwhitelist.findFirst({ where: eq(ugcwhitelist.userId, id) });
        return whiteListedUser !== undefined;
    } catch (e) {
        throw new Error("Error finding whitelistedUser");
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