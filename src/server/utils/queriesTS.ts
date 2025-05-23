"use server"

import { db } from '@/server/db/drizzle'
import { getSpotifyHeaders, getSpotifyImage, getSpotifyArtist } from './externalApiQueries';
import { isNotNull, ilike, desc, eq, sql, inArray, and, gte, lte, arrayContains } from "drizzle-orm";
import { featured, artists, users, ugcresearch, urlmap } from '@/server/db/schema';
import { Artist, UrlMap } from '../db/DbTypes';
import { isObjKey, extractArtistId } from './services';
import { getServerAuthSession } from '../auth';
import { DateRange } from 'react-day-picker';
import { DISCORD_WEBHOOK_URL } from '@/env';
import axios from 'axios';
import { PgColumn } from 'drizzle-orm/pg-core';

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

type getResponse<T> = {
    isError: boolean,
    message: string,
    data: T | null,
    status: number
}

export async function getArtistByProperty(column: PgColumn<any>, value: string) : Promise<getResponse<Artist>> {
    try {
        const result = await db.query.artists.findFirst({
            where: eq(column, value)
        });
        if(!result) return {isError: true, status: 404, message: "The artist you're searching for is not found", data: null}
        return {isError: false, message: "", data: result, status: 200};
    } catch {
        return {isError: true, message: "Something went wrong on our end", data: null, status: 404}
    }
}

export async function getArtistByWalletOrEns(value: string) {
    const walletRegex = /^0x[a-fA-F0-9]{40}$/;
    if(walletRegex.test(value)) {
        const result = await getArtistbyWallet(value);
        if(result.isError) return await getArtistByProperty(artists.ens, value);
        return result;
    }
    return await getArtistByProperty(artists.ens, value);
}

export async function getArtistbyWallet(wallet: string) {
    try {
        const result = await db
                                .select()
                                .from(artists)
                                .where(arrayContains(artists.wallets, [wallet]))
                                .limit(1);
        if(!result[0]) return {isError: true, message: "The artist you're searching for is not found", data: null, status: 404}
        return {isError: false, message: "", data: result[0], status: 200};
    } catch (e) {
        console.error(`Error fetching artist by wallet`, e);
        return {isError: true, message: "Something went wrong on our end", data: null, status: 500};
    }
}

export async function getArtistByNameApiResp(name: string) {
    try {
        const result = await searchForArtistByName(name);
        if(!result) return {isError: true, message: "The artist you're searching for is not found", data: null, status: 404}
        return {isError: false, message: "", data: result[0], status: 200} ;
    } catch(e) {
        return {isError: true, message: "Something went wrong on our end", data: null, status: 500}
    }
}

// Searches for artists in the database by name using fuzzy matching and similarity scoring
// Uses PostgreSQL's similarity function to find close matches and prioritizes exact prefix matches
// Params:
//      name: The artist name to search for
// Returns:
//      Promise<Artist[]> - Array of matching artists, limited to 10 results
export async function searchForArtistByName(name: string) {
    try {
        const startTime = performance.now();
        const result = await db.execute<Artist>(sql`
            SELECT 
                id, 
                name, 
                spotify, 
                instagram,
                CASE 
                    WHEN LOWER(name) LIKE LOWER(${name || ''} || '%') THEN 1  -- Exact prefix match
                    ELSE 2
                END as match_type
            FROM artists
            WHERE similarity(name, ${name}) > 0.3
            ORDER BY 
                match_type,  -- Prefix matches first
                similarity(name, ${name}) DESC  -- Then by similarity
            LIMIT 10
        `);
        const endTime = performance.now();
        console.log(`Search for "${name}" took ${endTime - startTime}ms`);
        return result;
    } catch(e) {
        console.error(`Error fetching artist by name`, e);
        throw new Error("Error searching for artist by name");
    }
}

export async function getArtistById(id: string) {
    try {
        const result = await db.query.artists.findFirst({
            where: eq(artists.id, id)
        });
        return result;
    } catch (e) {
        console.error(`Error fetching artist by Id`, e);
        throw new Error('Error fetching artist by Id')
    }
}

export async function getAllLinks() {
    const result = await db.query.urlmap.findMany();
    return result;
}

export type ArtistLink = UrlMap & {
    artistUrl: string
}

export async function getArtistLinks(artist: Artist): Promise<ArtistLink[]> {
    try {
        const allLinkObjects = await getAllLinks();
        if (!artist) throw new Error("Artist not found");
        const artistLinksSiteNames: ArtistLink[] = [];
        for (const platform of allLinkObjects) {
            if (isObjKey(platform.siteName, artist) && artist[platform.siteName]) {
                let artistUrl = platform.appStringFormat;
                // Special handling for YouTube channel URLs
                if (platform.siteName === 'youtubechannel') {
                    const value = artist[platform.siteName]?.toString() ?? "";
                    artistUrl = value.startsWith('@') 
                        ? `https://www.youtube.com/${value}`
                        : `https://www.youtube.com/channel/${value}`;
                } else {
                    artistUrl = platform.appStringFormat.replace("%@", artist[platform.siteName]?.toString() ?? "");
                }
                artistLinksSiteNames.push({ ...platform, artistUrl });
            }
        }
        artistLinksSiteNames.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
    try {
        const user = await getUserById(session.user.id);
        const headers = await getSpotifyHeaders();
        const spotifyArtist = await getSpotifyArtist(spotifyId, headers);
        if (spotifyArtist.error) return { status: "error", message: "That spotify id you entered doesn't exist" };
        const artist = await db.query.artists.findFirst({ where: eq(artists.spotify, spotifyId) });
        if (artist) return { status: "exists", artistId: artist.id, artistName: artist.name ?? "", message: "That artist is already in our database" };
        const [newArtist] = await db.insert(artists).values(
            {
                spotify: spotifyId,
                addedBy: session.user.id,
                lcname: spotifyArtist.data?.name.toLowerCase(),
                name: spotifyArtist.data?.name
            }).returning();

        await sendDiscordMessage(`${user?.wallet} added new artist named: ${newArtist.name} (Submitted SpotifyId: ${spotifyId}) ${newArtist.createdAt}`);
        return { status: "success", artistId: newArtist.id, artistName: newArtist.name ?? "", message: "Success! You can now find this artist in our directory" };
    } catch (e) {
        console.error("error adding artist", e);
        return { status: "error", artistId: undefined, message: "Something went wrong on our end, please try again" };   
     }
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
        console.error("error approving ugc:", e);
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
        console.error(`Error approving ugc`, e);
        throw new Error("Error approving UGC");
    }
}
export type AddArtistDataResp = {
    status: "success" | "error",
    message: string,
    siteName?: string
}

export async function addArtistData(artistUrl: string, artist: Artist): Promise<AddArtistDataResp> {
    const session = await getServerAuthSession();
    if (!session) throw new Error("Not authenticated");
    const artistIdFromUrl = await extractArtistId(artistUrl);
    if (!artistIdFromUrl) return { status: "error", message: "The data you're trying to add isn't in our list of approved links" };
    try {
        const existingArtistUGC = await db.query.ugcresearch.findFirst({ where: and(eq(ugcresearch.ugcUrl, artistUrl), eq(ugcresearch.artistId, artist.id)) });
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
        await sendDiscordMessage(`${user?.wallet} added ${artist.name}'s ${artistIdFromUrl.cardPlatformName}: ${artistIdFromUrl.id} (Submitted URL: ${artistUrl}) ${newUGC.createdAt}`);
        if (user?.isWhiteListed) {
            await approveUGC(newUGC.id, artist.id, artistIdFromUrl.siteName, artistIdFromUrl.id);
            return { status: "success", message: "We updated the artist with that data", siteName: artistIdFromUrl.cardPlatformName ?? "" };
        }
        return { status: "success", message: "Thanks for adding, we'll review this addition before posting", siteName: artistIdFromUrl.cardPlatformName ?? "" };
    } catch (e) {
        console.error("error adding artist data", e);
        return { status: "error", message: "Error adding artist data, please try again" };
    }
}

export async function getUserByWallet(wallet: string) {
    try {
        return await db.query.users.findFirst({ where: eq(users.wallet, wallet) });
    } catch (e) {
        console.error("error getting user by wallet", e);
        throw new Error("Error finding user");
    }
}

export async function getUserById(id: string) {
    try {
        return await db.query.users.findFirst({ where: eq(users.id, id) });
    } catch (e) {
        console.error("error getting user by Id", e);
        throw new Error("Error finding user");
    }
}

export async function createUser(wallet: string) {
    try {
        const [newUser] = await db.insert(users).values({ wallet: wallet }).returning();
        return newUser;
    } catch (e) {
        console.error("error creating user", e);
        throw new Error("Error creating user");
    }
}

export async function getPendingUGC() {
    try {
        const result = await db.query.ugcresearch.findMany({ where: eq(ugcresearch.accepted, false), with: { ugcUser: true } });
        return result.map((obj) => {
            const { ugcUser, ...rest } = obj;
            return {
                ...rest,
                wallet: ugcUser?.wallet ?? null,
            };
        });
    } catch (e) {
        console.error("error getting pending ugc", e);
        throw new Error("Error finding pending UGC");
    }
}

export async function getUgcStats() {
    const user = await getServerAuthSession();
    if (!user) throw new Error("Not authenticated");
    try {
        const ugcList = await db.query.ugcresearch.findMany({ where: eq(ugcresearch.userId, user.user.id) });
        return ugcList.length;
    } catch(e) {
        console.error("error getting user ugc stats", e);
    }
}

// Get UGC stats for a user in a date range default to current user if no wallet is provided
export async function getUgcStatsInRange(date: DateRange, wallet: string | null = null) {
    let session = await getServerAuthSession();
    if (!session) throw new Error("Not authenticated");
    let userId = session.user.id;
    if(wallet) {
        const searchedUser = await getUserByWallet(wallet);
        if (!searchedUser) throw new Error("User not found");
        userId = searchedUser.id;
    }
    try {

        const ugcList = await db.query.ugcresearch.findMany(
            { 
                where: and(
                    gte(ugcresearch.createdAt, date.from?.toISOString() ?? ""), 
                    lte(ugcresearch.createdAt, date.to?.toISOString() ?? ""), 
                    eq(ugcresearch.userId, userId))
            }
        );
        const artistsList = await db.query.artists.findMany(
            { 
                where: and(
                    gte(artists.createdAt, date.from?.toISOString() ?? ""), 
                    lte(artists.createdAt, date.to?.toISOString() ?? ""), 
                    eq(artists.addedBy, userId))
            }
        );
        return { ugcCount: ugcList.length, artistsCount: artistsList.length };
    } catch(e) {
        console.error("error getting ugc stats for user in range", e);
    }
}

export async function getWhitelistedUsers() {
    const user = await getServerAuthSession();
    if (!user) throw new Error("Not authenticated");
    try {
        const result = await db.query.users.findMany({ where: eq(users.isWhiteListed, true) });
        return result;
    } catch(e) {
        console.error("error getting whitelisted users", e);
    }
}

export async function removeFromWhitelist(userIds: string[]) {
    try {
        await db.update(users).set({ isWhiteListed: false }).where(inArray(users.id, userIds));
    } catch (e) {
        console.error("error getting removing from whitelist", e);
    }
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
        console.error("error adding users to whitelist", e);
        return { status: "error", message: "Error adding users to whitelist" };
    }
}

export async function searchForUsersByWallet(wallet: string) {
    try {
        const result = await db.query.users.findMany({ where: ilike(users.wallet, `%${wallet}%`) });
        return result.map((user) => user.wallet);
    } catch(e) {
        console.error("searching for users by wallet", e);
    }
}

export async function sendDiscordMessage(message: string) {
    const discordWebhookUrl = DISCORD_WEBHOOK_URL;
    if (!discordWebhookUrl) return;
    try {
        const resp = await axios.post(discordWebhookUrl, { content: message });
    } catch(e) {
        console.error("error sending discord ping ", e);
    }
}


