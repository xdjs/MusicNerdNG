"use server"

import { db } from '@/server/db/drizzle'
import { getSpotifyHeaders, getSpotifyImage } from './externalApiQueries';
import { isNotNull, ilike, desc, eq } from "drizzle-orm";
import { featured, artists, users, ugcwhitelist } from '@/server/db/schema';
import { Artist } from '../db/DbTypes';
import { isObjKey } from './services';
import { getServerAuthSession } from '../auth';


export async function getFeaturedArtistsTS() {
    const featuredObj = await db.query.featured.findMany({
        where: isNotNull(featured.featuredartist),
        with: { featuredArtist: true }
    });
    let featuredArtists = featuredObj.map(artist => { return { spotifyId: artist.featuredArtist?.spotify ?? null, artistId: artist.featuredartist } });
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

export async function getAllLinks() {
    const result = await db.query.urlmap.findMany();
    return result;
}

export async function getArtistLinks(artist: Artist) {
    try {
        const allLinkObjects = await getAllLinks();
        if(!artist) throw new Error("Artist not found");
        const artistLinksSiteNames = []
        for(const platform of allLinkObjects) {
            if(isObjKey(platform.sitename, artist) && artist[platform.sitename]) {
                artistLinksSiteNames.push({...platform, artistUrl: platform.appstingformat.replace("%@", artist[platform.sitename]?.toString()?? "")});
            }
        }
        return artistLinksSiteNames;
    } catch (e) {
        throw new Error("Error fetching artist links");
    }
}

export async function addArtist(spotifyLink: string) {
    // Need to implement
    const session = await getServerAuthSession();
    if (!session) throw new Error("Not authenticated");
    const user = await db.query.users.findFirst({where: eq(users.wallet, session.user.id)}); 
    try {
        const [newArtist] = await db.insert(artists).values({spotify: spotifyLink}).returning();
    } catch (e) {
        throw new Error("Error adding artist");
    }
}

export async function addArtistData() {
    return;
}

export async function getUserByWallet( wallet: string) {
    try {
        return await db.query.users.findFirst({where: eq(users.wallet, wallet)}); 
    } catch (e) {
        throw new Error("Error finding user");
    }
}

export async function getUserById(id: string) {
    try {
        return await db.query.users.findFirst({where: eq(users.id, id)}); 
    } catch (e) {
        throw new Error("Error finding user");
    }
}

export async function createUser(wallet: string) {
    try {
        const [newUser] = await db.insert(users).values({wallet : wallet}).returning();
        return newUser;
    } catch (e) {
        throw new Error("Error finding user");
    }
}

export async function checkWhiteListStatusById(id: string) {
    try {
        const whiteListedUser = await db.query.ugcwhitelist.findFirst({where: eq(ugcwhitelist.userid, id)});
        return whiteListedUser !== undefined;
    } catch (e) {
        throw new Error("Error finding whitelistedUser");
    }
}