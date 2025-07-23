import { db } from "@/server/db/drizzle";
import { getSpotifyHeaders, getSpotifyArtist } from "@/server/utils/queries/externalApiQueries";
import { eq, sql, inArray, and, arrayContains } from "drizzle-orm";
import { artists, ugcresearch, aiPrompts } from "@/server/db/schema";
import { Artist, UrlMap } from "@/server/db/DbTypes";
import { isObjKey, extractArtistId } from "@/server/utils/services";
import { getServerAuthSession } from "@/server/auth";
import { PgColumn } from "drizzle-orm/pg-core";
import { headers } from "next/headers";
import { openai } from "@/server/lib/openai";

import { getUserById } from "@/server/utils/queries/userQueries";
import { sendDiscordMessage } from "@/server/utils/queries/discord";
import { maybePingDiscordForPendingUGC } from "@/server/utils/ugcDiscordNotifier";

// ----------------------------------
// Types
// ----------------------------------

type getResponse<T> = {
    isError: boolean;
    message: string;
    data: T | null;
    status: number;
};

export type ArtistLink = UrlMap & {
    artistUrl: string;
};

export type AddArtistResp = {
    status: "success" | "error" | "exists";
    artistId?: string;
    message?: string;
    artistName?: string;
};

export type AddArtistDataResp = {
    status: "success" | "error";
    message: string;
    siteName?: string;
};

export type RemoveArtistDataResp = {
    status: "success" | "error";
    message: string;
};

// ----------------------------------
// Artist helpers & basic look-ups
// ----------------------------------

export async function getArtistByProperty(column: PgColumn<any>, value: string): Promise<getResponse<Artist>> {
    try {
        const result = await db.query.artists.findFirst({
            where: eq(column, value),
        });
        if (!result)
            return {
                isError: true,
                status: 404,
                message: "The artist you're searching for is not found",
                data: null,
            };
        return { isError: false, message: "", data: result, status: 200 };
    } catch {
        return {
            isError: true,
            message: "Something went wrong on our end",
            data: null,
            status: 404,
        };
    }
}

export async function getArtistByWalletOrEns(value: string) {
    const walletRegex = /^0x[a-fA-F0-9]{40}$/;
    if (walletRegex.test(value)) {
        const result = await getArtistbyWallet(value);
        if (result.isError) return await getArtistByProperty(artists.ens, value);
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
        if (!result[0])
            return {
                isError: true,
                message: "The artist you're searching for is not found",
                data: null,
                status: 404,
            };
        return { isError: false, message: "", data: result[0], status: 200 };
    } catch (e) {
        console.error(`Error fetching artist by wallet`, e);
        return {
            isError: true,
            message: "Something went wrong on our end",
            data: null,
            status: 500,
        };
    }
}

export async function getArtistByNameApiResp(name: string) {
    try {
        const result = await searchForArtistByName(name);
        if (!result)
            return {
                isError: true,
                message: "The artist you're searching for is not found",
                data: null,
                status: 404,
            };
        return { isError: false, message: "", data: result[0], status: 200 };
    } catch (e) {
        return {
            isError: true,
            message: "Something went wrong on our end",
            data: null,
            status: 500,
        };
    }
}

// Searches for artists in the database by name using fuzzy matching and similarity scoring
export async function searchForArtistByName(name: string) {
    try {
        const startTime = performance.now();

        // Normalise the incoming query (lower-case, accents & punctuation removed)
        const normalisedQuery = normaliseText(name);

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
                    WHEN lcname LIKE '%' || ${normalisedQuery || ''} || '%' THEN 0  -- Contains match (0 ranks first)
                    ELSE 1  -- Similarity match
                END as match_type
            FROM artists
            WHERE 
                (lcname LIKE '%' || ${normalisedQuery || ''} || '%' OR similarity(lcname, ${normalisedQuery}) > 0.3)
                AND spotify IS NOT NULL
            ORDER BY 
                match_type ASC,  -- Contains matches first (0 before 1)
                CASE 
                    WHEN lcname LIKE '%' || ${normalisedQuery || ''} || '%' 
                    THEN -POSITION(${normalisedQuery} IN lcname)  -- Negative position to reverse order
                    ELSE -999999  -- Keep non-contains matches at the end
                END DESC,  -- DESC on negative numbers puts smallest positions first
                similarity(lcname, ${normalisedQuery}) DESC  -- Higher similarity first
            LIMIT 10
        `);

        const endTime = performance.now();
        console.debug(`Search for "${name}" (normalised: "${normalisedQuery}") took ${endTime - startTime}ms`);
        return result;
    } catch (e) {
        console.error(`Error fetching artist by name`, e);
        throw new Error("Error searching for artist by name");
    }
}

export async function getArtistById(id: string) {
    try {
        const result = await db.query.artists.findFirst({
            where: eq(artists.id, id),
        });
        return result;
    } catch (e) {
        console.error(`Error fetching artist by Id`, e);
        throw new Error("Error fetching artist by Id");
    }
}

// ----------------------------------
// Links helpers
// ----------------------------------

export async function getAllLinks() {
    return await db.query.urlmap.findMany();
}

export async function getArtistLinks(artist: Artist): Promise<ArtistLink[]> {
    try {
        const allLinkObjects = await getAllLinks();
        if (!artist) throw new Error("Artist not found");
        const artistLinksSiteNames: ArtistLink[] = [];
        for (const platform of allLinkObjects) {
            if (platform.siteName === "ens" || platform.siteName === "wallets") continue;
            if (
                isObjKey(platform.siteName, artist) &&
                artist[platform.siteName] !== null &&
                artist[platform.siteName] !== undefined &&
                artist[platform.siteName] !== ""
            ) {
                let artistUrl = platform.appStringFormat;
                if (platform.siteName === "youtubechannel") {
                    const value = artist[platform.siteName]?.toString() ?? "";
                    artistUrl = value.startsWith("@")
                        ? `https://www.youtube.com/${value}`
                        : `https://www.youtube.com/channel/${value}`;
                } else if (platform.siteName === "supercollector") {
                    const value = artist[platform.siteName]?.toString() ?? "";
                    const ethRemoved = value.endsWith(".eth") ? value.slice(0, -4) : value;
                    artistUrl = platform.appStringFormat.replace("%@", ethRemoved);
                } else if (platform.siteName === "soundcloud") {
                    const value = artist[platform.siteName]?.toString() ?? "";
                    if (!value || /^\d+$/.test(value)) {
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

// ----------------------------------
// Artist creation & mutation
// ----------------------------------

export async function addArtist(spotifyId: string): Promise<AddArtistResp> {
    try {
        console.debug("[Server] Starting addArtist for spotifyId:", spotifyId);

        const headersList = headers();
        console.debug("[Server] Request headers:", {
            cookie: headersList.get("cookie"),
            authorization: headersList.get("authorization"),
        });

        const session = await getServerAuthSession();
        console.debug("[Server] Session state:", {
            exists: !!session,
            userId: session?.user?.id,
        });

        const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== "true";
        if (isWalletRequired && !session) {
            console.debug("[Server] No session found - authentication failed");
            throw new Error("Not authenticated");
        }

        console.debug("[Server] Getting Spotify headers...");
        const spotifyHeaders = await getSpotifyHeaders();
        if (!spotifyHeaders?.headers?.Authorization) {
            console.error("[Server] Failed to get Spotify headers");
            return { status: "error", message: "Failed to authenticate with Spotify" };
        }

        console.debug("[Server] Fetching Spotify artist data...");
        const spotifyArtist = await getSpotifyArtist(spotifyId, spotifyHeaders);
        console.debug("[Server] Spotify artist response:", spotifyArtist);

        if (spotifyArtist.error) {
            console.error("[Server] Spotify artist error:", spotifyArtist.error);
            return { status: "error", message: spotifyArtist.error };
        }

        if (!spotifyArtist.data?.name) {
            console.error("[Server] Invalid artist data received from Spotify");
            return { status: "error", message: "Invalid artist data received from Spotify" };
        }

        console.debug("[Server] Checking if artist exists in database...");
        const artist = await db.query.artists.findFirst({ where: eq(artists.spotify, spotifyId) });
        if (artist) {
            console.debug("[Server] Artist already exists:", artist);
            return {
                status: "exists",
                artistId: artist.id,
                artistName: artist.name ?? "",
                message: "That artist is already in our database",
            };
        }

        console.debug("[Server] Inserting new artist into database...");
        const artistData = {
            spotify: spotifyId,
            lcname: normaliseText(spotifyArtist.data.name),
            name: spotifyArtist.data.name,
            addedBy: session?.user?.id || undefined,
        };

        const [newArtist] = await db.insert(artists).values(artistData).returning();
        console.debug("[Server] New artist created:", newArtist);

        if (session?.user?.id) {
            const user = await getUserById(session.user.id);
            if (user) {
                await sendDiscordMessage(
                    `${user.wallet || "Anonymous"} added new artist named: ${newArtist.name} (Submitted SpotifyId: ${spotifyId}) ${newArtist.createdAt}`
                );
            }
        }

        return {
            status: "success",
            artistId: newArtist.id,
            artistName: newArtist.name ?? "",
            message: "Success! You can now find this artist in our directory",
        };
    } catch (e) {
        console.error("[Server] Error in addArtist:", e);
        if (e instanceof Error) {
            if (e.message.includes("auth")) {
                return { status: "error", message: "Please log in to add artists" };
            }
            if (e.message.includes("duplicate")) {
                return { status: "error", message: "This artist is already in our database" };
            }
        }
        return { status: "error", artistId: undefined, message: "Something went wrong on our end, please try again" };
    }
}

// ----------------------------------
// UGC approval / submission flows
// ----------------------------------

export async function approveUgcAdmin(ugcIds: string[]) {
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === "true" && process.env.NODE_ENV !== "production";

    if (!walletlessEnabled) {
        const user = await getServerAuthSession();
        if (!user) throw new Error("Not authenticated");
        const dbUser = await getUserById(user.user.id);
        if (!dbUser || !dbUser.isAdmin) throw new Error("Not authorized");
    }

    try {
        const ugcData = await db.query.ugcresearch.findMany({ where: inArray(ugcresearch.id, ugcIds) });
        await Promise.all(
            ugcData.map(async (ugc) => {
                await approveUGC(ugc.id, ugc.artistId ?? "", ugc.siteName ?? "", ugc.siteUsername ?? "");
            })
        );
    } catch (e) {
        console.error("error approving ugc:", e);
        return { status: "error", message: "Error approving UGC" };
    }
    return { status: "success", message: "UGC approved" };
}

export async function approveUGC(
    ugcId: string,
    artistId: string,
    siteName: string,
    artistIdFromUrl: string
) {
    // Sanitize siteName to match column naming convention (remove dots and other non-alphanumerics)
    const columnName = siteName.replace(/[^a-zA-Z0-9_]/g, "");
    try {
        if (siteName === "wallets" || siteName === "wallet") {
            await db.execute(sql`
                UPDATE artists
                SET wallets = array_append(wallets, ${artistIdFromUrl})
                WHERE id = ${artistId} AND NOT wallets @> ARRAY[${artistIdFromUrl}]
            `);
        } else if (siteName === "ens") {
            await db.execute(sql`
                UPDATE artists
                SET ens = ${artistIdFromUrl}
                WHERE id = ${artistId}
            `);
        } else {
            await db.execute(sql`
                UPDATE artists
                SET ${sql.identifier(columnName)} = ${artistIdFromUrl}
                WHERE id = ${artistId}`);
        }

        const promptRelevantColumns = ["spotify", "instagram", "x", "soundcloud", "youtubechannel"];
        if (promptRelevantColumns.includes(columnName)) {
            await db.execute(sql`UPDATE artists SET bio = NULL WHERE id = ${artistId}`);
            await generateArtistBio(artistId);
        }

        await db.update(ugcresearch).set({ accepted: true }).where(eq(ugcresearch.id, ugcId));
    } catch (e) {
        console.error(`Error approving ugc`, e);
        throw new Error("Error approving UGC");
    }
}

export async function addArtistData(artistUrl: string, artist: Artist): Promise<AddArtistDataResp> {
    const session = await getServerAuthSession();
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== "true";

    if (isWalletRequired && !session) {
        throw new Error("Not authenticated");
    }

    const artistIdFromUrl = await extractArtistId(artistUrl);
    if (!artistIdFromUrl) {
        console.debug("[addArtistData] URL did not match any approved link regex:", artistUrl);
        return { status: "error", message: "The data you're trying to add isn't in our list of approved links" };
    }

    try {
        const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === "true" && process.env.NODE_ENV !== "production";
        const user = session?.user?.id ? await getUserById(session.user.id) : null;
        const isWhitelistedOrAdmin = user?.isWhiteListed || user?.isAdmin;

        const existingArtistUGC = await db.query.ugcresearch.findFirst({
            where: and(eq(ugcresearch.ugcUrl, artistUrl), eq(ugcresearch.artistId, artist.id)),
        });

        if (existingArtistUGC) {
            console.debug(
                "[addArtistData] Duplicate submission – data already exists for artist",
                artist.id,
                ":",
                artistUrl
            );
            return { status: "error", message: "This artist data has already been added" };
        }

        const [newUGC] = await db
            .insert(ugcresearch)
            .values({
                ugcUrl: artistUrl,
                siteName: artistIdFromUrl.siteName,
                siteUsername: artistIdFromUrl.id,
                artistId: artist.id,
                name: artist.name ?? "",
                userId: session?.user?.id || undefined,
                accepted: false,
            })
            .returning();

        if (isWhitelistedOrAdmin && newUGC?.id) {
            await approveUGC(newUGC.id, artist.id, artistIdFromUrl.siteName, artistIdFromUrl.id);
        } else {
            // Pending submission by regular user – trigger (throttled) Discord ping
            await maybePingDiscordForPendingUGC();
        }

        if (user) {
            await sendDiscordMessage(
                `${user.wallet || "Anonymous"} added ${artist.name}'s ${artistIdFromUrl.cardPlatformName}: ${artistIdFromUrl.id} (Submitted URL: ${artistUrl}) ${newUGC.createdAt}`
            );
        }

        return {
            status: "success",
            message: isWhitelistedOrAdmin
                ? "We updated the artist with that data"
                : "Thanks for adding, we'll review this addition before posting",
            siteName: artistIdFromUrl.cardPlatformName ?? "",
        };
    } catch (e) {
        console.error("error adding artist data", e);
        return { status: "error", message: "Error adding artist data, please try again" };
    }
}

// ----------------------------------
// UGC stats & retrieval
// ----------------------------------

export async function getPendingUGC() {
    try {
        const result = await db.query.ugcresearch.findMany({ where: eq(ugcresearch.accepted, false), with: { ugcUser: true } });
        return result.map((obj) => {
            const { ugcUser, ...rest } = obj;
            return { ...rest, wallet: ugcUser?.wallet ?? null };
        });
    } catch (e) {
        console.error("error getting pending ugc", e);
        throw new Error("Error finding pending UGC");
    }
}

// Removed getUgcStats and getUgcStatsInRange – these functions have been moved to leaderboardQueries.ts

// ----------------------------------
// Misc helpers
// ----------------------------------

// NOTE: Consider adding an index on (spotify) column for better performance:
// CREATE INDEX IF NOT EXISTS idx_artists_spotify ON artists(spotify) WHERE spotify IS NOT NULL;
export async function getAllSpotifyIds(): Promise<string[]> {
    try {
        // Limit the result set - we don't need ALL Spotify IDs for filtering, just a reasonable subset
        const result = await db.execute<{ spotify: string }>(sql`
            SELECT spotify 
            FROM artists 
            WHERE spotify IS NOT NULL 
            LIMIT 10000
        `);
        return result.map((r) => r.spotify);
    } catch (e) {
        console.error("Error fetching Spotify IDs:", e);
        return [];
    }
}

export async function removeArtistData(artistId: string, siteName: string): Promise<RemoveArtistDataResp> {
    const session = await getServerAuthSession();
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== "true";
    if (isWalletRequired && !session) {
        throw new Error("Not authenticated");
    }

    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === "true" && process.env.NODE_ENV !== "production";
    const user = session?.user?.id ? await getUserById(session.user.id) : null;
    const isWhitelistedOrAdmin = user?.isWhiteListed || user?.isAdmin;

    if (!walletlessEnabled && !isWhitelistedOrAdmin) {
        return { status: "error", message: "Unauthorized" };
    }

    try {
        const columnName = siteName.replace(/[^a-zA-Z0-9_]/g, "");
        if (columnName === "wallets" || columnName === "wallet") {
            await db.execute(sql`
                UPDATE artists
                SET wallets = array_remove(wallets, ${artistId})
                WHERE id = ${artistId}`);
        } else {
            await db.execute(sql`UPDATE artists SET ${sql.identifier(columnName)} = NULL WHERE id = ${artistId}`);
        }

        const promptRelevantColumns = ["spotify", "instagram", "x", "soundcloud", "youtubechannel"];
        if (promptRelevantColumns.includes(columnName)) {
            await db.execute(sql`UPDATE artists SET bio = NULL WHERE id = ${artistId}`);
            await generateArtistBio(artistId);
        }

        // NOTE: We no longer delete the UGC record so that the original contribution
        // continues to count towards the leaderboard. Keeping the row ensures the
        // user retains credit for having added the link, even after it is removed
        // from the artist profile. If we want to track removal explicitly in the
        // future we can add a column (e.g. `removed: boolean`) but for now simply
        // leaving the row untouched is sufficient.

        return { status: "success", message: "Artist data removed" };
    } catch (e) {
        console.error("Error removing artist data", e);
        return { status: "error", message: "Error removing artist data" };
    }
}

// ----------------------------------
// Prompt helpers
// ----------------------------------

export async function getActivePrompt() {
    return await db.query.aiPrompts.findFirst({ where: eq(aiPrompts.isActive, true) });
}

export async function setActivePrompt() {
    // TODO: implement if necessary
}


// Helper to (re)generate an artist bio immediately using OpenAI and store it
export async function generateArtistBio(artistId: string): Promise<string | null> {
    try {
        const artist = await getArtistById(artistId);
        if (!artist) return null;
        const promptRow = await getActivePrompt();
        if (!promptRow) return null;

        const promptParts: string[] = [promptRow.promptBeforeName, artist.name ?? "", promptRow.promptAfterName];
        if (artist.spotify) promptParts.push(`Spotify ID: ${artist.spotify}`);
        if (artist.instagram) promptParts.push(`Instagram: https://instagram.com/${artist.instagram}`);
        if (artist.x) promptParts.push(`Twitter: https://twitter.com/${artist.x}`);
        if (artist.soundcloud) promptParts.push(`SoundCloud: ${artist.soundcloud}`);
        if (artist.youtubechannel) promptParts.push(`YouTube Channel: ${artist.youtubechannel}`);
        promptParts.push("Focus on genre, key achievements, and unique traits; avoid speculation.");

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content:
                        "You are an artifical intelligence whose sole purpose is to follow the provided prompt." +
                        promptParts.join("\n"),
                },
            ],
            temperature: 0.8,
        });
        const bio = completion.choices[0]?.message?.content?.trim() ?? "";
        if (bio) {
            await db.update(artists).set({ bio }).where(eq(artists.id, artistId));
        }
        return bio;
    } catch (e) {
        console.error("[generateArtistBio] Error generating bio", e);
        return null;
    }
} 

// Helper to remove accents/diacritics and optionally lowercase the result
function normaliseText(input: string): string {
    return input
        .normalize("NFD") // decompose accented chars into base + mark
        .replace(/[\u0300-\u036f]/g, "") // strip the marks
        .replace(/[^\p{L}\p{N}\s]+/gu, '') // strip punctuation; keep letters, numbers, spaces
        .toLowerCase();
} 
