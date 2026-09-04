// @ts-nocheck
import { jest } from "@jest/globals";

const mockSpotifyGetArtist = jest.fn();
const mockDeezerGetArtist = jest.fn();
const mockFindReciprocalArtistIdentity = jest.fn();
const mockAcquirePlatformIdentityLock = jest.fn();
const mockAcquireArtistNameLock = jest.fn();

jest.mock("@/server/auth", () => ({ getServerAuthSession: jest.fn() }));
jest.mock("@/server/utils/musicPlatform", () => ({
    spotifyProvider: {
        getArtist: mockSpotifyGetArtist,
    },
    deezerProvider: {
        getArtist: mockDeezerGetArtist,
    },
    findReciprocalArtistIdentity: mockFindReciprocalArtistIdentity,
}));
jest.mock("@/server/utils/artistIdentityLocks", () => ({
    acquirePlatformIdentityLock: mockAcquirePlatformIdentityLock,
    acquireArtistNameLock: mockAcquireArtistNameLock,
}));
jest.mock("@/server/utils/queries/userQueries", () => ({
    getUserById: jest.fn(),
    getUserDisplayName: jest.fn(),
}));
jest.mock("@/server/utils/queries/discord", () => ({ sendDiscordMessage: jest.fn() }));
jest.mock("@/server/utils/artistLinkService", () => ({
    ArtistLinkConflictError: class ArtistLinkConflictError extends Error {},
    setArtistLink: jest.fn(),
    clearArtistLink: jest.fn(),
}));
jest.mock("@/server/utils/queries/artistBioQuery", () => ({ regenerateArtistBio: jest.fn() }));
jest.mock("@/server/utils/ugcDiscordNotifier", () => ({ maybePingDiscordForPendingUGC: jest.fn() }));
jest.mock("@/server/utils/artistLinkDiscordNotifier", () => ({ notifyDiscordOfArtistLinkAdded: jest.fn() }));
jest.mock("next/headers", () => ({
    headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));

function artist(overrides: Record<string, unknown> = {}) {
    return {
        id: "artist-1",
        name: "Jonathan Pape",
        spotify: null,
        deezer: null,
        ...overrides,
    };
}

function reciprocalIdentity(platform: "spotify" | "deezer", platformId: string) {
    return {
        platform,
        platformId,
        source: "wikidata",
        wikidataId: "Q123",
    };
}

function musicBrainzReciprocalIdentity(
    platform: "spotify" | "deezer",
    platformId: string,
) {
    return {
        platform,
        platformId,
        source: "musicbrainz",
        musicbrainzId: "cdea97c2-b1a1-488f-bb71-5d3d78b8bed4",
    };
}

function mockInsertReturning(mockDb: any, rows: unknown[]) {
    const returning = jest.fn().mockResolvedValue(rows);
    const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
    const values = jest.fn().mockReturnValue({ onConflictDoNothing });
    mockDb.insert.mockReturnValue({ values });
    return { values, onConflictDoNothing, returning };
}

describe("addArtist identity resolution", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    async function setup() {
        const { db } = await import("@/server/db/drizzle");
        const { getServerAuthSession } = await import("@/server/auth");
        const { getUserById, getUserDisplayName } = await import("@/server/utils/queries/userQueries");
        const { sendDiscordMessage } = await import("@/server/utils/queries/discord");
        const { addArtist } = await import("../artistQueries");
        const mockDb = db as any;
        const mockGetServerAuthSession = getServerAuthSession as jest.Mock;
        const mockGetUserById = getUserById as jest.Mock;
        const mockGetUserDisplayName = getUserDisplayName as jest.Mock;
        const mockSendDiscordMessage = sendDiscordMessage as jest.Mock;

        mockDb.query.artists.findFirst.mockReset();
        mockDb.query.artists.findMany.mockReset();
        mockDb.query.artistIdMappings.findFirst.mockReset();
        mockDb.insert.mockReset();
        mockDb.execute = jest.fn().mockResolvedValue([]);
        mockDb.transaction = jest.fn(async (callback) => callback(mockDb));

        mockGetServerAuthSession.mockResolvedValue({ user: { id: "user-1" } });
        mockGetUserById.mockResolvedValue(null);
        mockGetUserDisplayName.mockReturnValue("tester");
        mockSendDiscordMessage.mockResolvedValue(undefined);
        mockSpotifyGetArtist.mockResolvedValue({
            platform: "spotify",
            platformId: "spotify-123",
            name: "Jonathan Pape",
        });
        mockDeezerGetArtist.mockResolvedValue({
            platform: "deezer",
            platformId: "815939",
            name: "Jonathan Pape",
        });
        mockFindReciprocalArtistIdentity.mockResolvedValue(null);
        mockAcquirePlatformIdentityLock.mockResolvedValue(undefined);
        mockAcquireArtistNameLock.mockResolvedValue(undefined);
        mockDb.query.artists.findFirst.mockResolvedValue(null);
        mockDb.query.artists.findMany.mockResolvedValue([]);
        mockDb.query.artistIdMappings.findFirst.mockResolvedValue(null);

        return {
            addArtist,
            mockDb,
            mockGetServerAuthSession,
            mockGetUserById,
            mockSendDiscordMessage,
        };
    }

    it("returns a typed unauthenticated response before provider or database work", async () => {
        const { addArtist, mockDb, mockGetServerAuthSession } = await setup();
        mockGetServerAuthSession.mockResolvedValue(null);

        await expect(addArtist("spotify-123", "spotify")).resolves.toEqual({
            status: "error",
            code: "UNAUTHENTICATED",
            message: "Please log in to add artists",
        });
        expect(mockSpotifyGetArtist).not.toHaveBeenCalled();
        expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("offers a Deezer-only exact-name record before creating a Spotify duplicate", async () => {
        const { addArtist, mockDb } = await setup();
        const deezerOnly = artist({ id: "deezer-owner", deezer: "815939" });
        mockDb.query.artists.findMany.mockResolvedValue([deezerOnly]);

        const result = await addArtist("spotify-123", "spotify");

        expect(result).toEqual({
            status: "possible_duplicate",
            candidates: [deezerOnly],
            platform: "spotify",
            platformId: "spotify-123",
            message: expect.stringContaining("same name"),
        });
        expect(mockDb.query.artists.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                limit: 10,
                orderBy: expect.arrayContaining([expect.anything(), expect.anything()]),
            }),
        );
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("returns a conflict when a mapping owner has a different first-class platform ID", async () => {
        const { addArtist, mockDb } = await setup();
        const contradictoryOwner = artist({
            id: "mapped-owner",
            spotify: "different-spotify-id",
            deezer: "815939",
        });
        mockDb.query.artistIdMappings.findFirst.mockResolvedValue({ artistId: "mapped-owner" });
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(contradictoryOwner);

        const result = await addArtist("spotify-123", "spotify");

        expect(result).toEqual(expect.objectContaining({
            status: "conflict",
            candidates: [contradictoryOwner],
            platform: "spotify",
            platformId: "spotify-123",
        }));
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("returns the canonical artist when the platform ID is owned by a mapping", async () => {
        const { addArtist, mockDb } = await setup();
        const mappedOwner = artist({ id: "mapped-owner", deezer: "815939" });
        mockDb.query.artistIdMappings.findFirst.mockResolvedValue({ artistId: "mapped-owner" });
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(mappedOwner);

        const result = await addArtist("spotify-123", "spotify");

        expect(result).toEqual(expect.objectContaining({
            status: "exists",
            artistId: "mapped-owner",
            artistName: "Jonathan Pape",
        }));
        expect(mockDb.query.artists.findMany).not.toHaveBeenCalled();
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("returns a conflict without writing when direct and mapped owners disagree", async () => {
        const { addArtist, mockDb } = await setup();
        const directOwner = artist({ id: "direct-owner", spotify: "spotify-123" });
        const mappedOwner = artist({ id: "mapped-owner", deezer: "815939" });
        mockDb.query.artistIdMappings.findFirst.mockResolvedValue({ artistId: "mapped-owner" });
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(directOwner)
            .mockResolvedValueOnce(mappedOwner);

        const result = await addArtist("spotify-123", "spotify");

        expect(result).toEqual({
            status: "conflict",
            candidates: [directOwner, mappedOwner],
            platform: "spotify",
            platformId: "spotify-123",
            message: expect.stringContaining("conflicting"),
        });
        expect(mockDb.query.artists.findMany).not.toHaveBeenCalled();
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("creates a separate homonymous artist only when forceCreate is set", async () => {
        const { addArtist, mockDb } = await setup();
        const inserted = artist({ id: "new-artist", spotify: "spotify-123" });
        const insert = mockInsertReturning(mockDb, [inserted]);

        const result = await addArtist("spotify-123", "spotify", { forceCreate: true });

        expect(result).toEqual(expect.objectContaining({
            status: "success",
            artistId: "new-artist",
        }));
        expect(mockDb.query.artists.findMany).not.toHaveBeenCalled();
        expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({
            spotify: "spotify-123",
            lcname: "jonathan pape",
            name: "Jonathan Pape",
        }));
        expect(insert.onConflictDoNothing).toHaveBeenCalledWith();
    });

    it.each([
        {
            submittedPlatform: "spotify",
            submittedId: "spotify-123",
            reciprocalPlatform: "deezer",
            reciprocalId: "815939",
        },
        {
            submittedPlatform: "deezer",
            submittedId: "815939",
            reciprocalPlatform: "spotify",
            reciprocalId: "spotify-123",
        },
    ])(
        "adds the $reciprocalPlatform ID when creating an artist from $submittedPlatform",
        async ({ submittedPlatform, submittedId, reciprocalPlatform, reciprocalId }) => {
            const { addArtist, mockDb } = await setup();
            mockFindReciprocalArtistIdentity.mockResolvedValue(
                reciprocalIdentity(reciprocalPlatform, reciprocalId),
            );
            const inserted = artist({
                id: "new-artist",
                spotify: "spotify-123",
                deezer: "815939",
            });
            const insert = mockInsertReturning(mockDb, [inserted]);

            const result = await addArtist(
                submittedId,
                submittedPlatform,
                { forceCreate: true },
            );

            expect(result).toEqual(expect.objectContaining({
                status: "success",
                artistId: "new-artist",
            }));
            expect(mockFindReciprocalArtistIdentity).toHaveBeenCalledWith({
                platform: submittedPlatform,
                platformId: submittedId,
                name: "Jonathan Pape",
            });
            expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({
                spotify: "spotify-123",
                deezer: "815939",
            }));
            expect(mockDb.execute).toHaveBeenCalledTimes(1);
            expect(mockAcquirePlatformIdentityLock.mock.calls.map(([, lockedPlatform, lockedId]) => (
                [lockedPlatform, lockedId]
            ))).toEqual([
                ["deezer", "815939"],
                ["spotify", "spotify-123"],
            ]);
        },
    );

    it("records MusicBrainz provenance for a resolved Deezer-to-Spotify pair", async () => {
        const { addArtist, mockDb } = await setup();
        mockDeezerGetArtist.mockResolvedValue({
            platform: "deezer",
            platformId: "139294362",
            name: "NOMELON NOLEMON",
        });
        mockFindReciprocalArtistIdentity.mockResolvedValue(
            musicBrainzReciprocalIdentity("spotify", "3PRXdiVu8lUkeCKw4ZUX4B"),
        );
        const insert = mockInsertReturning(mockDb, [artist({
            id: "new-artist",
            name: "NOMELON NOLEMON",
            spotify: "3PRXdiVu8lUkeCKw4ZUX4B",
            deezer: "139294362",
        })]);

        const result = await addArtist("139294362", "deezer", { forceCreate: true });

        expect(result).toEqual(expect.objectContaining({
            status: "success",
            artistId: "new-artist",
        }));
        expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({
            spotify: "3PRXdiVu8lUkeCKw4ZUX4B",
            deezer: "139294362",
        }));
        const mappingQuery = mockDb.execute.mock.calls[0][0];
        expect(mappingQuery.queryChunks).toEqual(expect.arrayContaining([
            "musicbrainz",
            "MusicBrainz cdea97c2-b1a1-488f-bb71-5d3d78b8bed4 links Spotify and Deezer for NOMELON NOLEMON",
        ]));
    });

    it("creates with only the submitted ID when no reciprocal identity is resolved", async () => {
        const { addArtist, mockDb } = await setup();
        const insert = mockInsertReturning(mockDb, [
            artist({ id: "new-artist", spotify: "spotify-123" }),
        ]);

        const result = await addArtist("spotify-123", "spotify", { forceCreate: true });

        expect(result.status).toBe("success");
        expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({
            spotify: "spotify-123",
        }));
        expect(insert.values).not.toHaveBeenCalledWith(expect.objectContaining({
            deezer: expect.anything(),
        }));
        expect(mockAcquirePlatformIdentityLock).toHaveBeenCalledTimes(1);
    });

    it("uses the provider's canonical Deezer ID for resolution, locking, and insertion", async () => {
        const { addArtist, mockDb } = await setup();
        mockDeezerGetArtist.mockResolvedValue({
            platform: "deezer",
            platformId: "6251",
            name: "Jonathan Pape",
        });
        const insert = mockInsertReturning(mockDb, [
            artist({ id: "new-artist", deezer: "6251" }),
        ]);

        const result = await addArtist("0006251", "deezer", { forceCreate: true });

        expect(result.status).toBe("success");
        expect(mockFindReciprocalArtistIdentity).toHaveBeenCalledWith({
            platform: "deezer",
            platformId: "6251",
            name: "Jonathan Pape",
        });
        expect(mockAcquirePlatformIdentityLock).toHaveBeenCalledWith(
            mockDb,
            "deezer",
            "6251",
        );
        expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({
            deezer: "6251",
        }));
    });

    it("finds a canonical Deezer owner when the submitted URL uses a zero-padded alias", async () => {
        const { addArtist, mockDb } = await setup();
        const existing = artist({ id: "deezer-owner", deezer: "6251" });
        mockDeezerGetArtist.mockResolvedValue({
            platform: "deezer",
            platformId: "6251",
            name: "Jonathan Pape",
        });
        mockDb.query.artists.findFirst.mockResolvedValueOnce(existing);

        const result = await addArtist("0006251", "deezer");

        expect(result).toEqual(expect.objectContaining({
            status: "exists",
            artistId: "deezer-owner",
        }));
        expect(mockAcquirePlatformIdentityLock).toHaveBeenCalledWith(
            mockDb,
            "deezer",
            "6251",
        );
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("offers the owner of a discovered reciprocal ID instead of creating a duplicate", async () => {
        const { addArtist, mockDb } = await setup();
        const reciprocalOwner = artist({
            id: "deezer-owner",
            spotify: null,
            deezer: "815939",
        });
        mockFindReciprocalArtistIdentity.mockResolvedValue(
            reciprocalIdentity("deezer", "815939"),
        );
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(reciprocalOwner);

        const result = await addArtist("spotify-123", "spotify");

        expect(result).toEqual(expect.objectContaining({
            status: "possible_duplicate",
            candidates: [reciprocalOwner],
            platform: "spotify",
            platformId: "spotify-123",
            canCreateSeparate: false,
        }));
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("identifies MusicBrainz as the source when its counterpart already exists", async () => {
        const { addArtist, mockDb } = await setup();
        const reciprocalOwner = artist({
            id: "spotify-owner",
            spotify: "3PRXdiVu8lUkeCKw4ZUX4B",
        });
        mockDeezerGetArtist.mockResolvedValue({
            platform: "deezer",
            platformId: "139294362",
            name: "NOMELON NOLEMON",
        });
        mockFindReciprocalArtistIdentity.mockResolvedValue(
            musicBrainzReciprocalIdentity("spotify", "3PRXdiVu8lUkeCKw4ZUX4B"),
        );
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(reciprocalOwner);

        const result = await addArtist("139294362", "deezer");

        expect(result).toEqual(expect.objectContaining({
            status: "possible_duplicate",
            candidates: [reciprocalOwner],
            canCreateSeparate: false,
            message: "MusicBrainz links this profile to an existing artist's spotify profile. Add the submitted link to that artist.",
        }));
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("recognizes a reciprocal ID owner recorded only in the mapping table", async () => {
        const { addArtist, mockDb } = await setup();
        const reciprocalOwner = artist({
            id: "mapped-owner",
            spotify: null,
            deezer: null,
        });
        mockFindReciprocalArtistIdentity.mockResolvedValue(
            reciprocalIdentity("deezer", "815939"),
        );
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(reciprocalOwner);
        mockDb.query.artistIdMappings.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ artistId: "mapped-owner" });

        const result = await addArtist("spotify-123", "spotify");

        expect(result).toEqual(expect.objectContaining({
            status: "possible_duplicate",
            candidates: [reciprocalOwner],
        }));
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("returns a conflict when submitted and reciprocal IDs have different owners", async () => {
        const { addArtist, mockDb } = await setup();
        const spotifyOwner = artist({ id: "spotify-owner", spotify: "spotify-123" });
        const deezerOwner = artist({ id: "deezer-owner", deezer: "815939" });
        mockFindReciprocalArtistIdentity.mockResolvedValue(
            reciprocalIdentity("deezer", "815939"),
        );
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(spotifyOwner)
            .mockResolvedValueOnce(deezerOwner);

        const result = await addArtist("spotify-123", "spotify");

        expect(result).toEqual(expect.objectContaining({
            status: "conflict",
            candidates: [spotifyOwner, deezerOwner],
        }));
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("returns the existing artist when both platform IDs have the same owner", async () => {
        const { addArtist, mockDb } = await setup();
        const existing = artist({
            id: "existing-owner",
            spotify: "spotify-123",
            deezer: "815939",
        });
        mockFindReciprocalArtistIdentity.mockResolvedValue(
            reciprocalIdentity("deezer", "815939"),
        );
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(existing)
            .mockResolvedValueOnce(existing);

        const result = await addArtist("spotify-123", "spotify");

        expect(result).toEqual(expect.objectContaining({
            status: "exists",
            artistId: "existing-owner",
        }));
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("does not let forceCreate bypass reciprocal platform ownership", async () => {
        const { addArtist, mockDb } = await setup();
        const reciprocalOwner = artist({ id: "deezer-owner", deezer: "815939" });
        mockFindReciprocalArtistIdentity.mockResolvedValue(
            reciprocalIdentity("deezer", "815939"),
        );
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(reciprocalOwner);

        const result = await addArtist("spotify-123", "spotify", { forceCreate: true });

        expect(result).toEqual(expect.objectContaining({
            status: "conflict",
            candidates: [reciprocalOwner],
        }));
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("returns the race winner when a conflict-safe insert creates no row", async () => {
        const { addArtist, mockDb } = await setup();
        const raceWinner = artist({ id: "race-winner", spotify: "spotify-123" });
        mockInsertReturning(mockDb, []);
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(raceWinner);
        mockDb.query.artistIdMappings.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null);

        const result = await addArtist("spotify-123", "spotify", { forceCreate: true });

        expect(result).toEqual(expect.objectContaining({
            status: "exists",
            artistId: "race-winner",
            artistName: "Jonathan Pape",
        }));
    });

    it("re-resolves the reciprocal ID when a dual-ID insert loses a race", async () => {
        const { addArtist, mockDb } = await setup();
        const reciprocalRaceWinner = artist({
            id: "reciprocal-race-winner",
            deezer: "815939",
        });
        mockFindReciprocalArtistIdentity.mockResolvedValue(
            reciprocalIdentity("deezer", "815939"),
        );
        mockInsertReturning(mockDb, []);
        mockDb.query.artists.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(reciprocalRaceWinner);
        mockDb.query.artistIdMappings.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null);

        const result = await addArtist("spotify-123", "spotify");

        expect(result).toEqual(expect.objectContaining({
            status: "possible_duplicate",
            candidates: [reciprocalRaceWinner],
        }));
    });

    it("keeps a committed insert successful when notification lookup fails", async () => {
        const { addArtist, mockDb, mockGetUserById } = await setup();
        const inserted = artist({ id: "new-artist", spotify: "spotify-123" });
        mockInsertReturning(mockDb, [inserted]);
        mockGetUserById.mockRejectedValue(new Error("notification lookup failed"));

        const result = await addArtist("spotify-123", "spotify", { forceCreate: true });

        expect(result).toEqual(expect.objectContaining({
            status: "success",
            artistId: "new-artist",
        }));
    });

    it("preserves the created-at timestamp in the artist-added notification", async () => {
        const { addArtist, mockDb, mockGetUserById, mockSendDiscordMessage } = await setup();
        const createdAt = "2026-08-19T20:00:00.000Z";
        const inserted = artist({
            id: "new-artist",
            spotify: "spotify-123",
            createdAt,
        });
        mockInsertReturning(mockDb, [inserted]);
        mockGetUserById.mockResolvedValue({ id: "user-1" });

        await addArtist("spotify-123", "spotify", { forceCreate: true });

        expect(mockSendDiscordMessage).toHaveBeenCalledWith(
            `tester added new artist named: Jonathan Pape (Submitted spotifyId: spotify-123) ${createdAt}`,
        );
    });
});
