import { db } from "@/server/db/drizzle";
import { getSpotifyHeaders, getSpotifyArtist } from "@/server/utils/queries/externalApiQueries";
import { deezerProvider, spotifyProvider } from "@/server/utils/musicPlatform";
import type { MusicPlatform } from "@/server/utils/musicPlatform";
import { eq, sql, inArray, and, arrayContains, asc } from "drizzle-orm";
import { artists, artistIdMappings, ugcresearch } from "@/server/db/schema";
import { Artist, UrlMap } from "@/server/db/DbTypes";
import { isObjKey, extractArtistId } from "@/server/utils/services";
import { getServerAuthSession } from "@/server/auth";
import { PgColumn } from "drizzle-orm/pg-core";

import { getUserById, getUserDisplayName } from "@/server/utils/queries/userQueries";
import { sendDiscordMessage } from "@/server/utils/queries/discord";
import { maybePingDiscordForPendingUGC } from "@/server/utils/ugcDiscordNotifier";
import { notifyDiscordOfArtistLinkAdded } from "@/server/utils/artistLinkDiscordNotifier";
import {
    ArtistLinkConflictError,
    setArtistLink,
    clearArtistLink,
} from "@/server/utils/artistLinkService";
import { regenerateArtistBio } from "@/server/utils/queries/artistBioQuery";
import { isAboutEmptyState } from "@/lib/bioConstants";
import { LINK_NOT_SUPPORTED_LONG } from "@/lib/linkSubmissionMessages";
import {
    acquireArtistNameLock,
    acquirePlatformIdentityLock,
} from "@/server/utils/artistIdentityLocks";

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

export type AddArtistCandidate = {
    id: string;
    name: string | null;
    spotify: string | null;
    deezer: string | null;
};

export type AddArtistOptions = {
    forceCreate?: boolean;
};

type AddArtistRespCommon = {
    artistId?: string;
    message?: string;
    artistName?: string;
};

export type AddArtistErrorCode = "UNAUTHENTICATED";

export type AddArtistResp =
    | (AddArtistRespCommon & {
        status: "success" | "exists";
        candidates?: AddArtistCandidate[];
        platform?: MusicPlatform;
        platformId?: string;
    })
    | (AddArtistRespCommon & {
        status: "error";
        code?: AddArtistErrorCode;
        candidates?: AddArtistCandidate[];
        platform?: MusicPlatform;
        platformId?: string;
    })
    | (AddArtistRespCommon & {
        status: "possible_duplicate";
        candidates: AddArtistCandidate[];
        platform: MusicPlatform;
        platformId: string;
    })
    | (AddArtistRespCommon & {
        status: "conflict";
        candidates: AddArtistCandidate[];
        platform: MusicPlatform;
        platformId: string;
    });

export type AddArtistDataResp = {
    status: "success" | "error";
    message: string;
    siteName?: string;
};

export type RemoveArtistDataResp = {
    status: "success" | "error";
    message: string;
    data?: string | null;
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

        try {
            await db.execute(sql`SET LOCAL pg_trgm.similarity_threshold = 0.3;`);
        } catch (err) {
            console.error("Error setting pg_trgm similarity threshold", err);
            throw err;
        }
        const result = await db.execute<Artist>(sql`
            SELECT
            id, name, spotify, deezer, bandcamp, youtube, youtubechannel,
            instagram, x, facebook, tiktok,
            CASE WHEN lcname LIKE '%' || ${normalisedQuery} || '%' THEN 0 ELSE 1 END AS match_type
            FROM artists
            WHERE
            lcname LIKE '%' || ${normalisedQuery} || '%'
            OR lcname % ${normalisedQuery}          -- ← indexable equivalent to similarity(...) >= 0.3
            ORDER BY
            match_type ASC,
            CASE
                WHEN lcname LIKE '%' || ${normalisedQuery} || '%'
                THEN -POSITION(${normalisedQuery} IN lcname)
                ELSE -999999
            END DESC,
            similarity(lcname, ${normalisedQuery}) DESC   -- keep for ranking
            LIMIT 10;
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
    const start = performance.now();
    try {
        return await db.query.urlmap.findMany();
    } finally {
        const end = performance.now();
        console.debug(`[getAllLinks] took ${end - start}ms`);
    }
}

export async function getArtistLinks(artist: Artist): Promise<ArtistLink[]> {
    try {
        const allLinkObjects = await getAllLinks();
        if (!artist) throw new Error("Artist not found");
        const artistLinksSiteNames: ArtistLink[] = [];
        // Check if both YouTube columns have data to implement preference logic
        const hasYoutubeUsername = artist.youtube?.toString()?.trim();
        const hasYoutubeChannel = artist.youtubechannel?.toString()?.trim();
        
        // Check if both Facebook columns have data to implement preference logic
        const hasFacebookUsername = artist.facebook?.toString()?.trim();
        const hasFacebookId = artist.facebookId?.toString()?.trim();

        for (const platform of allLinkObjects) {
            if (platform.siteName === "ens" || platform.siteName === "wallets") continue;
            
            // Skip youtubechannel platform if both youtube and youtubechannel have data (prefer username)
            if (platform.siteName === "youtubechannel" && hasYoutubeUsername && hasYoutubeChannel) {
                continue;
            }
            
            // Skip facebookID platform if both facebook and facebookID have data (prefer username)
            if (platform.siteName === "facebookID" && hasFacebookUsername && hasFacebookId) {
                continue;
            }
            
            // Handle the special case where platform.siteName is "facebookID" but artist property is "facebookId"
            const artistPropertyName = platform.siteName === "facebookID" ? "facebookId" : platform.siteName;
            
            if (
                isObjKey(artistPropertyName, artist) &&
                artist[artistPropertyName] !== null &&
                artist[artistPropertyName] !== undefined &&
                artist[artistPropertyName] !== ""
            ) {
                let artistUrl = platform.appStringFormat;
                if (platform.siteName === "youtubechannel") {
                    // Handle YouTube channel URL construction - only use youtubechannel column
                    const youtubeChannelValue = artist[platform.siteName]?.toString()?.trim() ?? "";
                    
                    if (youtubeChannelValue) {
                        // Check if youtubechannel column contains username data (starts with @) or channel ID
                        if (youtubeChannelValue.startsWith("@")) {
                            // It's username data stored in youtubechannel column (legacy state)
                            const cleanUsername = youtubeChannelValue.substring(1);
                            artistUrl = `https://youtube.com/@${cleanUsername}`;
                        } else {
                            // It's actual channel ID data
                            artistUrl = `https://www.youtube.com/channel/${youtubeChannelValue}`;
                        }
                    } else {
                        // No YouTube channel data available, skip this platform
                        continue;
                    }
                } else if (platform.siteName === "youtube") {
                    // Handle dedicated YouTube username platform
                    const youtubeUsername = artist[platform.siteName]?.toString()?.trim() ?? "";
                    if (youtubeUsername) {
                        // Remove @ prefix if present, we'll add it in the URL
                        const cleanUsername = youtubeUsername.startsWith("@") ? youtubeUsername.substring(1) : youtubeUsername;
                        artistUrl = `https://youtube.com/@${cleanUsername}`;
                    } else {
                        continue;
                    }
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
                } else if (platform.siteName === "facebookID" as string) {
                    // Handle Facebook ID format - facebookID column now stores full URLs
                    const facebookUrl = artist.facebookId?.toString()?.trim() ?? "";
                    if (facebookUrl) {
                        // Use the stored URL directly (it's already a complete Facebook URL)
                        artistUrl = facebookUrl;
                    } else {
                        continue;
                    }
                } else {
                    artistUrl = platform.appStringFormat.replace("%@", artist[artistPropertyName]?.toString() ?? "");
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

type PlatformIdOwnerResolution =
    | { status: "none" }
    | { status: "owner"; owner: AddArtistCandidate }
    | { status: "conflict"; candidates: AddArtistCandidate[] };

type ArtistCreationExecutor = Pick<typeof db, "query" | "execute" | "insert">;

const ADD_ARTIST_CANDIDATE_LIMIT = 10;

function toAddArtistCandidate(artist: Pick<Artist, "id" | "name" | "spotify" | "deezer">): AddArtistCandidate {
    return {
        id: artist.id,
        name: artist.name,
        spotify: artist.spotify,
        deezer: artist.deezer,
    };
}

async function resolvePlatformIdOwner(
    database: Pick<ArtistCreationExecutor, "query">,
    platform: MusicPlatform,
    platformId: string,
): Promise<PlatformIdOwnerResolution> {
    const directColumn = platform === "deezer" ? artists.deezer : artists.spotify;
    const [directOwner, mapping] = await Promise.all([
        database.query.artists.findFirst({
            where: eq(directColumn, platformId),
            columns: { id: true, name: true, spotify: true, deezer: true },
        }),
        database.query.artistIdMappings.findFirst({
            where: and(
                eq(artistIdMappings.platform, platform),
                eq(artistIdMappings.platformId, platformId),
            ),
            columns: { artistId: true },
        }),
    ]);

    if (!mapping) {
        return directOwner
            ? { status: "owner", owner: toAddArtistCandidate(directOwner) }
            : { status: "none" };
    }

    if (directOwner?.id === mapping.artistId) {
        return { status: "owner", owner: toAddArtistCandidate(directOwner) };
    }

    const mappedOwner = await database.query.artists.findFirst({
        where: eq(artists.id, mapping.artistId),
        columns: { id: true, name: true, spotify: true, deezer: true },
    });
    const mappedCandidate = mappedOwner
        ? toAddArtistCandidate(mappedOwner)
        : { id: mapping.artistId, name: null, spotify: null, deezer: null };

    const mappedOwnerPlatformId = platform === "deezer"
        ? mappedCandidate.deezer
        : mappedCandidate.spotify;
    const mappedOwnerContradictsMapping = Boolean(
        mappedOwnerPlatformId?.trim() && mappedOwnerPlatformId !== platformId,
    );

    if (directOwner || mappedOwnerContradictsMapping) {
        return {
            status: "conflict",
            candidates: directOwner
                ? [toAddArtistCandidate(directOwner), mappedCandidate]
                : [mappedCandidate],
        };
    }

    return { status: "owner", owner: mappedCandidate };
}

export async function addArtist(
    platformId: string,
    platform: MusicPlatform = 'spotify',
    options?: AddArtistOptions,
): Promise<AddArtistResp> {
    if (platform !== 'deezer' && platform !== 'spotify') {
        return { status: "error", message: "Invalid platform" };
    }
    try {
        console.debug(`[Server] Starting addArtist for ${platform}Id:`, platformId);

        const session = await getServerAuthSession();
        console.debug("[Server] Session state:", {
            exists: !!session,
            userId: session?.user?.id,
        });

        if (!session) {
            console.debug("[Server] No session found - authentication failed");
            return {
                status: "error",
                code: "UNAUTHENTICATED",
                message: "Please log in to add artists",
            };
        }

        // Validate via platform provider
        const provider = platform === 'deezer' ? deezerProvider : spotifyProvider;
        console.debug(`[Server] Validating ${platform} artist...`);
        const platformArtist = await provider.getArtist(platformId);

        if (!platformArtist?.name) {
            console.error(`[Server] Invalid artist data from ${platform}`);
            return { status: "error", message: `Could not find artist on ${platform}` };
        }

        const normalisedName = normaliseText(platformArtist.name);
        let notificationCreatedAt: string | null | undefined;
        const result = await db.transaction(async (transaction): Promise<AddArtistResp> => {
            const database = transaction as ArtistCreationExecutor;
            await acquirePlatformIdentityLock(database, platform, platformId);
            if (!options?.forceCreate) {
                await acquireArtistNameLock(database, normalisedName);
            }

            console.debug("[Server] Checking platform ID ownership...");
            const ownership = await resolvePlatformIdOwner(database, platform, platformId);
            if (ownership.status === "conflict") {
                console.error("[Server] Conflicting platform ID owners:", ownership.candidates);
                return {
                    status: "conflict",
                    candidates: ownership.candidates,
                    platform,
                    platformId,
                    message: "That platform profile is assigned to conflicting artist records",
                };
            }
            if (ownership.status === "owner") {
                console.debug("[Server] Artist already exists:", ownership.owner);
                return {
                    status: "exists",
                    artistId: ownership.owner.id,
                    artistName: ownership.owner.name ?? "",
                    message: "That artist is already in our database",
                };
            }

            if (!options?.forceCreate) {
                const possibleDuplicates = await database.query.artists.findMany({
                    where: eq(artists.lcname, normalisedName),
                    orderBy: [asc(artists.createdAt), asc(artists.id)],
                    limit: ADD_ARTIST_CANDIDATE_LIMIT,
                    columns: { id: true, name: true, spotify: true, deezer: true },
                });
                if (possibleDuplicates.length > 0) {
                    return {
                        status: "possible_duplicate",
                        candidates: possibleDuplicates.map(toAddArtistCandidate),
                        platform,
                        platformId,
                        message: "We found an artist with the same name. Choose the existing artist or confirm this is a different artist.",
                    };
                }
            }

            console.debug("[Server] Inserting new artist into database...");
            const artistData = {
                [platform]: platformId,
                lcname: normalisedName,
                name: platformArtist.name,
                addedBy: session.user?.id || undefined,
            };

            const [newArtist] = await database
                .insert(artists)
                .values(artistData)
                .onConflictDoNothing()
                .returning();

            if (!newArtist) {
                const raceWinner = await resolvePlatformIdOwner(database, platform, platformId);
                if (raceWinner.status === "conflict") {
                    return {
                        status: "conflict",
                        candidates: raceWinner.candidates,
                        platform,
                        platformId,
                        message: "That platform profile is assigned to conflicting artist records",
                    };
                }
                if (raceWinner.status === "owner") {
                    return {
                        status: "exists",
                        artistId: raceWinner.owner.id,
                        artistName: raceWinner.owner.name ?? "",
                        message: "That artist is already in our database",
                    };
                }
                return {
                    status: "error",
                    message: "The artist could not be created because another record changed at the same time. Please try again.",
                };
            }
            console.debug("[Server] New artist created:", newArtist);
            notificationCreatedAt = newArtist.createdAt;

            return {
                status: "success",
                artistId: newArtist.id,
                artistName: newArtist.name ?? "",
                message: "Success! You can now find this artist in our directory",
            };
        });

        if (result.status === "success" && session.user?.id) {
            try {
                const user = await getUserById(session.user.id);
                if (user) {
                    await sendDiscordMessage(
                        `${getUserDisplayName(user)} added new artist named: ${result.artistName ?? ""} (Submitted ${platform}Id: ${platformId}) ${notificationCreatedAt ?? ""}`
                    );
                }
            } catch (notificationError) {
                console.error("[Server] Failed to send artist-added notification:", notificationError);
            }
        }

        return result;
    } catch (e) {
        console.error("[Server] Error in addArtist:", e);
        if (e instanceof Error) {
            if (e.message.includes("auth")) {
                return {
                    status: "error",
                    code: "UNAUTHENTICATED",
                    message: "Please log in to add artists",
                };
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
    const user = await getServerAuthSession();
    if (!user) throw new Error("Not authenticated");
    const dbUser = await getUserById(user.user.id);
    if (!dbUser || !dbUser.isAdmin) throw new Error("Not authorized");

    try {
        const ugcData = await db.query.ugcresearch.findMany({ where: inArray(ugcresearch.id, ugcIds) });
        const approvalResults = await Promise.allSettled(
            ugcData.map(async (ugc) => {
                await approveUGC(ugc.id, ugc.artistId ?? "", ugc.siteName ?? "", ugc.siteUsername ?? "");
            })
        );

        const failures = approvalResults.flatMap((result, index) => {
            if (result.status === "fulfilled") return [];

            const reason = result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
            return [{ ugcId: ugcData[index]?.id ?? "unknown", reason }];
        });

        if (failures.length > 0) {
            const approvedCount = approvalResults.length - failures.length;
            return {
                status: "error",
                message: `Approved ${approvedCount} of ${approvalResults.length} UGC items. Failed: ${failures
                    .map(({ ugcId, reason }) => `${ugcId} (${reason})`)
                    .join("; ")}`,
            };
        }
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
    artistUrlOrId: string
) {
    try {
        // Normalise values for certain platforms before storing on the artist record
        let valueToStore = artistUrlOrId;

        // For most platforms, artistUrlOrId is now the extracted username/ID
        // Only do URL parsing for platforms that need special handling
        if (siteName === "youtubechannel") {
            // Expect channel ID, not a full URL
            // Accept both full URLs and raw IDs and convert to ID only
            try {
                const url = new URL(artistUrlOrId.startsWith("http") ? artistUrlOrId : `https://${artistUrlOrId}`);
                const parts = url.pathname.split("/").filter(Boolean);
                const channelIdx = parts.findIndex((p) => p.toLowerCase() === "channel");
                if (channelIdx !== -1 && parts[channelIdx + 1]) {
                    valueToStore = parts[channelIdx + 1];
                }
            } catch {
                const m = artistUrlOrId.match(/youtube\.com\/channel\/([^/?#]+)/i);
                if (m) valueToStore = m[1];
            }
        } else if (siteName === "youtube") {
            // Store plain username without leading @ if a URL was provided
            try {
                if (artistUrlOrId.includes("youtube.com")) {
                    const url = new URL(artistUrlOrId.startsWith("http") ? artistUrlOrId : `https://${artistUrlOrId}`);
                    const atMatch = url.pathname.match(/@([^/?#]+)/);
                    if (atMatch && atMatch[1]) {
                        valueToStore = atMatch[1];
                    }
                } else if (artistUrlOrId.startsWith("@")) {
                    valueToStore = artistUrlOrId.slice(1);
                }
            } catch {
                /* ignore */
            }
        }

        if (siteName === "wallets" || siteName === "wallet") {
            // Wallets stay inline — array_append logic unchanged
            await db.execute(sql`
                UPDATE artists
                SET wallets = array_append(wallets, ${artistUrlOrId})
                WHERE id = ${artistId} AND NOT wallets @> ARRAY[${artistUrlOrId}]
            `);
        } else {
            await setArtistLink(artistId, siteName, valueToStore);
        }

        await db.update(ugcresearch).set({ accepted: true, dateProcessed: new Date().toISOString() }).where(eq(ugcresearch.id, ugcId));
    } catch (e) {
        console.error(`Error approving ugc`, e);
        if (e instanceof ArtistLinkConflictError) {
            throw e;
        }
        throw new Error(e instanceof Error ? `Error approving UGC: ${e.message}` : "Error approving UGC");
    }
}

export async function addArtistData(artistUrl: string, artist: Artist): Promise<AddArtistDataResp> {
    const session = await getServerAuthSession();

    if (!session) {
        throw new Error("Not authenticated");
    }

    const artistIdFromUrl = await extractArtistId(artistUrl);
    if (!artistIdFromUrl) {
        console.debug("[addArtistData] URL did not match any approved link regex:", artistUrl);
        return { status: "error", message: LINK_NOT_SUPPORTED_LONG };
    }

    try {
        const user = session?.user?.id ? await getUserById(session.user.id) : null;
        const isWhitelistedOrAdmin = user?.isAdmin || user?.isWhiteListed;

        const existingArtistUGC = await db.query.ugcresearch.findFirst({
            where: and(eq(ugcresearch.ugcUrl, artistUrl), eq(ugcresearch.artistId, artist.id)),
        });

        if (existingArtistUGC) {
            // If the artist profile still HAS this link, block duplicate submissions.
            // But if the link was previously removed (so the artist column is now null),
            // allow the user to re-submit and earn credit again.
            const columnName = artistIdFromUrl.siteName as keyof Artist;
            const artistHasValue = (artist as any)?.[columnName];
            if (artistHasValue) {
                console.debug(
                    "[addArtistData] Duplicate submission – data already exists for artist",
                    artist.id,
                    ":",
                    artistUrl
                );
                return { status: "error", message: "This artist data has already been added" };
            }
            // Else: link no longer on artist profile – proceed so user can add again.
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
            await notifyDiscordOfArtistLinkAdded({
                user,
                artistName: artist.name ?? artist.id,
                platformName: artistIdFromUrl.cardPlatformName ?? artistIdFromUrl.siteName,
                platformId: artistIdFromUrl.id,
                submittedUrl: artistUrl,
                createdAt: newUGC.createdAt ?? undefined,
            });
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
        if (e instanceof ArtistLinkConflictError) {
            return { status: "error", message: e.message };
        }
        return { status: "error", message: "Error adding artist data, please try again" };
    }
}

// ----------------------------------
// UGC stats & retrieval
// ----------------------------------

export async function getPendingUGC() {
    const start = performance.now();
    try {
        const result = await db.query.ugcresearch.findMany({ where: eq(ugcresearch.accepted, false), with: { user: true } });
        return result.map((obj) => {
            const { user, ...rest } = obj;
            return { ...rest, wallet: user?.wallet ?? null, username: user?.username ?? null };
        });
    } catch (e) {
        console.error("error getting pending ugc", e);
        throw new Error("Error finding pending UGC");
    } finally {
        const end = performance.now();
        console.debug(`[getPendingUGC] took ${end - start}ms`);
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
    if (!session) {
        throw new Error("Not authenticated");
    }

    const user = session?.user?.id ? await getUserById(session.user.id) : null;
    const isWhitelistedOrAdmin = user?.isAdmin || user?.isWhiteListed;

    if (!isWhitelistedOrAdmin) {
        return { status: "error", message: "Unauthorized" };
    }

    try {
        if (siteName === "wallets" || siteName === "wallet") {
            // FIXME: Bug — uses artistId as the value to remove instead of the wallet address.
            // The caller should pass the wallet address, not the artist ID.
            await db.execute(sql`
                UPDATE artists
                SET wallets = array_remove(wallets, ${artistId})
                WHERE id = ${artistId}`);
        } else {
            await clearArtistLink(artistId, siteName);
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
        if (e instanceof Error && e.message.startsWith("Column not in writable whitelist")) {
            return { status: "error", message: "Invalid platform column" };
        }
        return { status: "error", message: "Error removing artist data" };
    }
}

// ----------------------------------
// Bio update helper
// ----------------------------------
export async function updateArtistBio(artistId: string, bio: string, regenerate: boolean = false): Promise<RemoveArtistDataResp> {
    try {
        if (regenerate) {
            // Snapshot the current About so we can tell a real regeneration apart from a
            // no-op (discovery is flaky; when it finds nothing new the clobber-guard in
            // generateArtistBio preserves the existing bio unchanged).
            const priorBio = (await getArtistById(artistId))?.bio ?? null;
            const generatedBio = await regenerateArtistBio(artistId);
            if (!generatedBio) {
                return { status: "error", message: "Failed to generate bio" };
            }
            // Discovery found nothing verifiable — the About degraded to the claim-nudge.
            // Surface that distinctly so an admin regenerate doesn't look like a normal success.
            if (isAboutEmptyState(generatedBio)) {
                return { status: "success", message: "No verified sources found — showing the claim prompt", data: generatedBio };
            }
            // Discovery found nothing new — the existing About was preserved, not regenerated.
            if (priorBio !== null && generatedBio === priorBio) {
                return { status: "success", message: "No new sources found — About unchanged", data: generatedBio };
            }
            return { status: "success", message: "Bio regenerated", data: generatedBio };
        } else {
            // Update with provided bio
            await db.update(artists).set({ bio }).where(eq(artists.id, artistId));
            return { status: "success", message: "Bio updated" };
        }
    } catch (e) {
        console.error("Error updating bio", e);
        return { status: "error", message: "Error updating bio" };
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
