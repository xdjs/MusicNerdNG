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
import { headers } from 'next/headers';

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
                bandcamp,
                youtubechannel,
                instagram,
                x,
                facebook,
                tiktok,
                CASE 
                    WHEN LOWER(name) LIKE LOWER('%' || ${name || ''} || '%') THEN 0  -- Contains match (0 ranks first)
                    ELSE 1  -- Similarity match
                END as match_type
            FROM artists
            WHERE 
                (LOWER(name) LIKE LOWER('%' || ${name || ''} || '%') OR similarity(name, ${name}) > 0.3)
                AND spotify IS NOT NULL
            ORDER BY 
                match_type ASC,  -- Contains matches first (0 before 1)
                CASE 
                    WHEN LOWER(name) LIKE LOWER('%' || ${name || ''} || '%') 
                    THEN -POSITION(LOWER(${name}) IN LOWER(name))  -- Negative position to reverse order
                    ELSE -999999  -- Keep non-contains matches at the end
                END DESC,  -- DESC on negative numbers puts smallest positions first
                similarity(name, ${name}) DESC  -- Higher similarity first
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
            // Only add a link if the artist has a non-null, non-undefined value for this platform
            if (platform.siteName === 'ens' || platform.siteName === 'wallets') continue;
            if (isObjKey(platform.siteName, artist) && artist[platform.siteName] !== null && artist[platform.siteName] !== undefined && artist[platform.siteName] !== "") {
                let artistUrl = platform.appStringFormat;
                // Special handling for YouTube channel URLs
                if (platform.siteName === 'youtubechannel') {
                    const value = artist[platform.siteName]?.toString() ?? "";
                    artistUrl = value.startsWith('@') 
                        ? `https://www.youtube.com/${value}`
                        : `https://www.youtube.com/channel/${value}`;
                } else if (platform.siteName === 'supercollector') {
                    // Remove .eth from Supercollector URLs if present
                    const value = artist[platform.siteName]?.toString() ?? "";
                    const ethRemoved = value.endsWith('.eth') ? value.slice(0, -4) : value;
                    artistUrl = platform.appStringFormat.replace("%@", ethRemoved);
                } else if (platform.siteName === 'soundcloud') {
                    // Only allow username-based SoundCloud profiles (skip numeric user IDs)
                    const value = artist[platform.siteName]?.toString() ?? "";
                    if (!value || /^\d+$/.test(value)) {
                        // Skip if value is empty or purely numeric (user IDs not supported)
                        continue;
                    }
                    artistUrl = platform.appStringFormat.replace("%@", value);
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
    try {
        console.log("[Server] Starting addArtist for spotifyId:", spotifyId);
        
        const headersList = headers();
        console.log("[Server] Request headers:", {
            cookie: headersList.get('cookie'),
            authorization: headersList.get('authorization')
        });
        
        const session = await getServerAuthSession();
        console.log("[Server] Session state:", {
            exists: !!session,
            userId: session?.user?.id
        });

        // Check if wallet requirement is disabled
        const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';

        if (isWalletRequired && !session) {
            console.log("[Server] No session found - authentication failed");
            throw new Error("Not authenticated");
        }

        console.log("[Server] Getting Spotify headers...");
        const spotifyHeaders = await getSpotifyHeaders();
        if (!spotifyHeaders?.headers?.Authorization) {
            console.error("[Server] Failed to get Spotify headers");
            return { status: "error", message: "Failed to authenticate with Spotify" };
        }

        console.log("[Server] Fetching Spotify artist data...");
        const spotifyArtist = await getSpotifyArtist(spotifyId, spotifyHeaders);
        console.log("[Server] Spotify artist response:", spotifyArtist);

        if (spotifyArtist.error) {
            console.error("[Server] Spotify artist error:", spotifyArtist.error);
            return { status: "error", message: spotifyArtist.error };
        }

        if (!spotifyArtist.data?.name) {
            console.error("[Server] Invalid artist data received from Spotify");
            return { status: "error", message: "Invalid artist data received from Spotify" };
        }

        console.log("[Server] Checking if artist exists in database...");
        const artist = await db.query.artists.findFirst({ where: eq(artists.spotify, spotifyId) });
        if (artist) {
            console.log("[Server] Artist already exists:", artist);
            return { 
                status: "exists", 
                artistId: artist.id, 
                artistName: artist.name ?? "", 
                message: "That artist is already in our database" 
            };
        }

        console.log("[Server] Inserting new artist into database...");
        const artistData = {
            spotify: spotifyId,
            lcname: spotifyArtist.data.name.toLowerCase(),
            name: spotifyArtist.data.name,
            addedBy: session?.user?.id || undefined
        };

        const [newArtist] = await db.insert(artists).values(artistData).returning();
        console.log("[Server] New artist created:", newArtist);

        // Only send Discord message if we have a user
        if (session?.user?.id) {
            const user = await getUserById(session.user.id);
            if (user) {
                await sendDiscordMessage(`${user.wallet || 'Anonymous'} added new artist named: ${newArtist.name} (Submitted SpotifyId: ${spotifyId}) ${newArtist.createdAt}`);
            }
        }

        return { 
            status: "success", 
            artistId: newArtist.id, 
            artistName: newArtist.name ?? "", 
            message: "Success! You can now find this artist in our directory" 
        };
    } catch (e) {
        console.error("[Server] Error in addArtist:", e);
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

export async function approveUgcAdmin(ugcIds: string[]) {
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';

    if (!walletlessEnabled) {
        const user = await getServerAuthSession();
        if (!user) throw new Error("Not authenticated");
        const dbUser = await getUserById(user.user.id);
        if (!dbUser || !dbUser.isAdmin) throw new Error("Not authorized");
    }

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
        if (siteName === 'wallets') {
            console.log('[approveUGC] Appending wallet', artistIdFromUrl, 'to artist', artistId);
            // Append wallet to wallets[] column, avoiding duplicates
            await db.execute(sql`
                UPDATE artists
                SET wallets = array_append(wallets, ${artistIdFromUrl})
                WHERE id = ${artistId} AND NOT wallets @> ARRAY[${artistIdFromUrl}]
            `);
        } else if (siteName === 'ens') {
            console.log('[approveUGC] Setting ENS', artistIdFromUrl, 'for artist', artistId);
            // Set ENS scalar column
            await db.execute(sql`
                UPDATE artists
                SET ens = ${artistIdFromUrl}
                WHERE id = ${artistId}
            `);
        } else {
            await db.execute(sql`
                UPDATE artists
                SET ${sql.identifier(siteName)} = ${artistIdFromUrl}
                WHERE id = ${artistId}`);
        }

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
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';

    if (isWalletRequired && !session) {
        throw new Error("Not authenticated");
    }

    const artistIdFromUrl = await extractArtistId(artistUrl);
    if (!artistIdFromUrl) {
        console.log('[addArtistData] URL did not match any approved link regex:', artistUrl);
        return { status: "error", message: "The data you're trying to add isn't in our list of approved links" };
    }

    try {
        // Get user data to check permissions
        const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';
        const user = session?.user?.id ? await getUserById(session.user.id) : null;
        const isWhitelistedOrAdmin = user?.isWhiteListed || user?.isAdmin;

        // Check if this URL has already been added to either table
        const existingArtistUGC = await db.query.ugcresearch.findFirst({ 
            where: and(eq(ugcresearch.ugcUrl, artistUrl), eq(ugcresearch.artistId, artist.id)) 
        });

        if (existingArtistUGC) {
            console.log('[addArtistData] Duplicate submission – data already exists for artist', artist.id, ':', artistUrl);
            return { status: "error", message: "This artist data has already been added" };
        }

        // Create UGC research entry for all users
        const [newUGC] = await db.insert(ugcresearch).values({
            ugcUrl: artistUrl,
            siteName: artistIdFromUrl.siteName,
            siteUsername: artistIdFromUrl.id,
            artistId: artist.id,
            name: artist.name ?? "",
            userId: session?.user?.id || undefined,
            accepted: false
        }).returning();

        // If the user is whitelisted/admin, auto-approve and update artist
        if (isWhitelistedOrAdmin && newUGC?.id) {
            await approveUGC(newUGC.id, artist.id, artistIdFromUrl.siteName, artistIdFromUrl.id);
        }

        // Send Discord message for the submission
        if (user) {
            await sendDiscordMessage(`${user.wallet || 'Anonymous'} added ${artist.name}'s ${artistIdFromUrl.cardPlatformName}: ${artistIdFromUrl.id} (Submitted URL: ${artistUrl}) ${newUGC.createdAt}`);
        }

        return { 
            status: "success", 
            message: isWhitelistedOrAdmin ? "We updated the artist with that data" : "Thanks for adding, we'll review this addition before posting", 
            siteName: artistIdFromUrl.cardPlatformName ?? "" 
        };
    } catch (e) {
        console.error("error adding artist data", e);
        return { status: "error", message: "Error adding artist data, please try again" };
    }
}

export async function getUserByWallet(wallet: string) {
    try {
        const result = await db.query.users.findFirst({ where: eq(users.wallet, wallet) });
        return result;
    } catch (error) {
        console.error("error getting user by wallet", error);
        if (error instanceof Error) {
            throw new Error(`Error finding user: ${error.message}`);
        }
        throw new Error('Error finding user: Unknown error');
    }
}

export async function getUserById(id: string) {
    try {
        const result = await db.query.users.findFirst({ where: eq(users.id, id) });
        return result;
    } catch (error) {
        console.error("error getting user by Id", error);
        if (error instanceof Error) {
            throw new Error(`Error finding user: ${error.message}`);
        }
        throw new Error('Error finding user: Unknown error');
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
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';
    const session = await getServerAuthSession();
    if (!session && !walletlessEnabled) throw new Error("Unauthorized");
    try {
        const result = await db.query.users.findMany({ where: eq(users.isWhiteListed, true) });
        if (!result) return [];
        return result;
    } catch(e) {
        console.error("error getting whitelisted users", e);
        throw new Error("Error getting whitelisted users");
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

export async function getAllSpotifyIds(): Promise<string[]> {
    try {
        const result = await db.execute<{ spotify: string }>(sql`
            SELECT spotify 
            FROM artists 
            WHERE spotify IS NOT NULL
        `);
        return result.map(r => r.spotify);
    } catch (e) {
        console.error('Error fetching Spotify IDs:', e);
        return [];
    }
}

export type UpdateWhitelistedUserResp = {
    status: "success" | "error",
    message: string
}

// Updates a whitelisted user's editable fields (wallet, email, username)
export async function updateWhitelistedUser(userId: string, data: { wallet?: string; email?: string; username?: string }): Promise<UpdateWhitelistedUserResp> {
    try {
        if (!userId) throw new Error("Invalid user id");
        const updateData: Record<string, string> = {};
        if (data.wallet !== undefined) updateData.wallet = data.wallet;
        if (data.email !== undefined) updateData.email = data.email;
        if (data.username !== undefined) updateData.username = data.username;

        if (Object.keys(updateData).length === 0) {
            return { status: "error", message: "No fields to update" };
        }

        await db.update(users).set(updateData).where(eq(users.id, userId));
        return { status: "success", message: "Whitelist user updated" };
    } catch (e) {
        console.error("error updating whitelisted user", e);
        return { status: "error", message: "Error updating whitelisted user" };
    }
}

export type RemoveArtistDataResp = {
    status: "success" | "error",
    message: string
}

export async function removeArtistData(artistId: string, siteName: string): Promise<RemoveArtistDataResp> {
    const session = await getServerAuthSession();
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';

    if (isWalletRequired && !session) {
        throw new Error("Not authenticated");
    }

    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';
    const user = session?.user?.id ? await getUserById(session.user.id) : null;
    const isWhitelistedOrAdmin = user?.isWhiteListed || user?.isAdmin;

    if (!walletlessEnabled && !isWhitelistedOrAdmin) {
        return { status: "error", message: "Unauthorized" };
    }

    try {
        // Remove the value from the specific column in the artists table
        await db.execute(sql`UPDATE artists SET ${sql.identifier(siteName)} = NULL WHERE id = ${artistId}`);

        // Remove any matching ugcResearch rows
        await db.delete(ugcresearch).where(and(eq(ugcresearch.artistId, artistId), eq(ugcresearch.siteName, siteName)));

        return { status: "success", message: "Artist data removed" };
    } catch (e) {
        console.error("Error removing artist data", e);
        return { status: "error", message: "Error removing artist data" };
    }
}


