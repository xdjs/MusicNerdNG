// Import types first
import { Artist, UrlMap } from '@/server/db/DbTypes';
import { platformType } from '@/server/db/schema';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
    getArtistLinks, 
    getAllLinks, 
    getArtistById, 
    getArtistByProperty,
    getArtistbyWallet,
    getArtistByNameApiResp,
    searchForArtistByName,
    getUserById,
    getUserByWallet
} from '../queriesTS';
import { hasSpotifyCredentials } from '../setup/testEnv';

// Skip all tests if Spotify credentials are missing
const testWithSpotify = hasSpotifyCredentials ? it : it.skip;

// Comprehensive DB mock for this suite
jest.mock('@/server/db/drizzle', () => {
    const makeTable = () => ({
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        insert: jest.fn(),
    });
    return {
        db: {
            query: {
                urlmap: makeTable(),
                artists: makeTable(),
                users: makeTable(),
                ugcresearch: makeTable(),
            },
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            insert: jest.fn(),
            update: jest.fn(),
            execute: jest.fn(),
        },
    };
});

// Import the mocked db
import { db } from '@/server/db/drizzle';

describe('getArtistLinks', () => {
    // Mock URL mapping data that would come from the db
    const mockUrlMaps = [
        {
            id: '1',
            siteName: 'spotify',
            siteUrl: 'https://spotify.com',
            example: 'example',
            appStringFormat: 'https://open.spotify.com/artist/%@',
            order: 1,
            isIframeEnabled: false,
            isEmbedEnabled: false,
            cardDescription: 'Listen on Spotify',
            cardPlatformName: 'Spotify',
            isWeb3Site: false,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            siteImage: '',
            regex: '',
            regexMatcher: '',
            isMonetized: false,
            regexOptions: [],
            platformTypeList: ['listen'],
            colorHex: '#000000'
        },
        {
            id: '2',
            siteName: 'youtubechannel',
            siteUrl: 'https://youtube.com',
            example: 'example',
            appStringFormat: 'https://www.youtube.com/%@',
            order: 2,
            isIframeEnabled: false,
            isEmbedEnabled: false,
            cardDescription: 'Watch on YouTube',
            cardPlatformName: 'YouTube',
            isWeb3Site: false,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            siteImage: '',
            regex: '',
            regexMatcher: '',
            isMonetized: false,
            regexOptions: [],
            platformTypeList: ['social'],
            colorHex: '#FF0000'
        },
        {
            id: '3',
            siteName: 'supercollector',
            siteUrl: 'https://release.supercollector.xyz',
            example: 'example',
            appStringFormat: 'https://release.supercollector.xyz/artist/%@',
            order: 3,
            isIframeEnabled: false,
            isEmbedEnabled: false,
            cardDescription: 'View on Supercollector',
            cardPlatformName: 'Supercollector',
            isWeb3Site: true,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            siteImage: '',
            regex: '',
            regexMatcher: '',
            isMonetized: false,
            regexOptions: [],
            platformTypeList: ['web3'],
            colorHex: '#00FF00'
        }
    ] as const as UrlMap[];

    beforeEach(() => {
        jest.clearAllMocks();
        (db.query.urlmap.findMany as jest.Mock).mockResolvedValue(mockUrlMaps);
        // Mock isObjKey to return true for valid platform properties
        const { isObjKey } = require('../services');
        (isObjKey as jest.Mock).mockImplementation((key: string, obj: any) => key in obj);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // Base artist object for testing
    const baseArtist: Artist = {
        id: '',
        name: '',
        legacyId: null,
        bandcamp: null,
        facebook: null,
        x: null,
        soundcloud: null,
        notes: null,
        patreon: null,
        instagram: null,
        youtube: null,
        youtubechannel: null,
        lcname: null,
        soundcloudId: null,
        spotify: null,
        twitch: null,
        imdb: null,
        musicbrainz: null,
        wikidata: null,
        mixcloud: null,
        facebookId: null,
        discogs: null,
        tiktok: null,
        tiktokId: null,
        jaxsta: null,
        famousbirthdays: null,
        songexploder: null,
        colorsxstudios: null,
        bandsintown: null,
        linktree: null,
        onlyfans: null,
        wikipedia: null,
        audius: null,
        zora: null,
        catalog: null,
        opensea: null,
        foundation: null,
        lastfm: null,
        linkedin: null,
        soundxyz: null,
        mirror: null,
        glassnode: null,
        collectsNfTs: null,
        spotifyusername: null,
        bandcampfan: null,
        tellie: null,
        wallets: [],
        ens: null,
        lens: null,
        addedBy: '00000000-0000-0000-0000-000000000000',
        cameo: null,
        farcaster: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        supercollector: null
    };

    testWithSpotify('should handle an artist with all platforms correctly', async () => {
        const artist: Artist = {
            ...baseArtist,
            id: '123',
            name: 'Test Artist',
            spotify: 'spotify123',
            youtubechannel: '@testartist',
            supercollector: 'testartist.eth'
        };

        const result = await getArtistLinks(artist);

        expect(result).toHaveLength(3);
        expect(result).toEqual([
            {
                ...mockUrlMaps[0],
                artistUrl: 'https://open.spotify.com/artist/spotify123'
            },
            {
                ...mockUrlMaps[1],
                artistUrl: 'https://www.youtube.com/@testartist'
            },
            {
                ...mockUrlMaps[2],
                artistUrl: 'https://release.supercollector.xyz/artist/testartist'
            }
        ]);
    });

    it('should handle YouTube channel URLs correctly', async () => {
        // Test both @ handle and channel ID formats
        const artistWithAtHandle: Artist = {
            ...baseArtist,
            id: '123',
            name: 'Test Artist',
            youtubechannel: '@testchannel'
        };

        const artistWithChannelId: Artist = {
            ...baseArtist,
            id: '124',
            name: 'Test Artist',
            youtubechannel: 'UC1234567890'
        };

        const resultWithAtHandle = await getArtistLinks(artistWithAtHandle);
        const resultWithChannelId = await getArtistLinks(artistWithChannelId);

        expect(resultWithAtHandle).toHaveLength(1);
        expect(resultWithAtHandle[0].artistUrl).toBe('https://www.youtube.com/@testchannel');

        expect(resultWithChannelId).toHaveLength(1);
        expect(resultWithChannelId[0].artistUrl).toBe('https://www.youtube.com/channel/UC1234567890');
    });

    it('should remove .eth from Supercollector URLs', async () => {
        const artist: Artist = {
            ...baseArtist,
            id: '123',
            name: 'Test Artist',
            supercollector: 'testartist.eth'
        };

        const result = await getArtistLinks(artist);

        expect(result).toHaveLength(1);
        expect(result[0].artistUrl).toBe('https://release.supercollector.xyz/artist/testartist');
    });

    it('should handle null and empty values correctly', async () => {
        const artist: Artist = {
            ...baseArtist,
            id: '123',
            name: 'Test Artist',
            spotify: null,
            youtubechannel: '',
            supercollector: null
        };

        const result = await getArtistLinks(artist);

        expect(result).toHaveLength(0);
    });

    it('should return links in correct order', async () => {
        const artist: Artist = {
            ...baseArtist,
            id: '123',
            name: 'Test Artist',
            spotify: 'spotify123',
            youtubechannel: '@testartist',
            supercollector: 'testartist.eth'
        };

        const result = await getArtistLinks(artist);

        expect(result).toHaveLength(3);
        expect(result.map(link => link.siteName)).toEqual(['spotify', 'youtubechannel', 'supercollector']);
    });

    it('should handle database errors gracefully', async () => {
        (db.query.urlmap.findMany as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

        const artist: Artist = {
            ...baseArtist,
            id: '123',
            name: 'Test Artist',
            spotify: 'spotify123'
        };

        await expect(getArtistLinks(artist)).rejects.toThrow('Error fetching artist links');
    });
});

describe('getAllLinks', () => {
    it('should return all URL mappings from database', async () => {
        const mockUrlMaps = [
            { id: '1', siteName: 'spotify', siteUrl: 'https://spotify.com' },
            { id: '2', siteName: 'youtube', siteUrl: 'https://youtube.com' }
        ];
        (db.query.urlmap.findMany as jest.Mock).mockResolvedValue(mockUrlMaps);

        const result = await getAllLinks();

        expect(result).toEqual(mockUrlMaps);
        expect(db.query.urlmap.findMany).toHaveBeenCalledTimes(1);
    });
});

describe('getArtistById', () => {
    const mockArtist = {
        id: '123',
        name: 'Test Artist',
        spotify: 'spotify123'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return artist when found', async () => {
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(mockArtist);

        const result = await getArtistById('123');

        expect(result).toEqual(mockArtist);
        expect(db.query.artists.findFirst).toHaveBeenCalledWith({
            where: expect.any(Object)
        });
    });

    it('should return undefined when artist not found', async () => {
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(undefined);

        const result = await getArtistById('nonexistent');

        expect(result).toBeUndefined();
    });

    it('should throw error when database fails', async () => {
        (db.query.artists.findFirst as jest.Mock).mockRejectedValue(new Error('DB Error'));

        await expect(getArtistById('123')).rejects.toThrow('Error fetching artist by Id');
    });
});

describe('getArtistByProperty', () => {
    const mockArtist = {
        id: '123',
        name: 'Test Artist',
        spotify: 'spotify123'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return success response when artist found', async () => {
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(mockArtist);

        const result = await getArtistByProperty({} as any, 'test-value');

        expect(result).toEqual({
            isError: false,
            message: '',
            data: mockArtist,
            status: 200
        });
    });

    it('should return 404 error when artist not found', async () => {
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(null);

        const result = await getArtistByProperty({} as any, 'nonexistent');

        expect(result).toEqual({
            isError: true,
            status: 404,
            message: "The artist you're searching for is not found",
            data: null
        });
    });

    it('should return 404 error when database throws', async () => {
        (db.query.artists.findFirst as jest.Mock).mockRejectedValue(new Error('DB Error'));

        const result = await getArtistByProperty({} as any, 'test-value');

        expect(result).toEqual({
            isError: true,
            message: "Something went wrong on our end",
            data: null,
            status: 404
        });
    });
});

describe('getArtistbyWallet', () => {
    const mockArtist = {
        id: '123',
        name: 'Test Artist',
        wallets: ['0x1234567890123456789012345678901234567890']
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return success response when artist found by wallet', async () => {
        // Mock the query builder chain
        const mockQueryBuilder = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([mockArtist])
        };
        
        (db.select as jest.Mock).mockReturnValue(mockQueryBuilder);

        const result = await getArtistbyWallet('0x1234567890123456789012345678901234567890');

        expect(result).toEqual({
            isError: false,
            message: '',
            data: mockArtist,
            status: 200
        });
    });

    it('should return 404 error when no artist found', async () => {
        const mockQueryBuilder = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([])
        };
        
        (db.select as jest.Mock).mockReturnValue(mockQueryBuilder);

        const result = await getArtistbyWallet('0x9999999999999999999999999999999999999999');

        expect(result).toEqual({
            isError: true,
            message: "The artist you're searching for is not found",
            data: null,
            status: 404
        });
    });

    it('should return 500 error when database throws', async () => {
        const mockQueryBuilder = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockRejectedValue(new Error('DB Error'))
        };
        
        (db.select as jest.Mock).mockReturnValue(mockQueryBuilder);

        const result = await getArtistbyWallet('0x1234567890123456789012345678901234567890');

        expect(result).toEqual({
            isError: true,
            message: "Something went wrong on our end",
            data: null,
            status: 500
        });
    });
});

describe('searchForArtistByName', () => {
    const mockArtists = [
        { id: '1', name: 'Test Artist', spotify: 'spotify1' },
        { id: '2', name: 'Another Test', spotify: 'spotify2' }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        // Mock console.log to avoid noise in tests
        jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should return artists matching the search name', async () => {
        (db.execute as jest.Mock).mockResolvedValue(mockArtists);

        const result = await searchForArtistByName('Test');

        expect(result).toEqual(mockArtists);
        expect(db.execute).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should throw error when database fails', async () => {
        (db.execute as jest.Mock).mockRejectedValue(new Error('DB Error'));

        await expect(searchForArtistByName('Test')).rejects.toThrow('Error searching for artist by name');
    });
});

describe('getArtistByNameApiResp', () => {
    const mockArtist = { id: '1', name: 'Test Artist', spotify: 'spotify1' };

    beforeEach(() => {
        jest.clearAllMocks();
        (db.execute as jest.Mock).mockResolvedValue([mockArtist]);
        jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should return success response when artist found', async () => {
        const result = await getArtistByNameApiResp('Test Artist');

        expect(result).toEqual({
            isError: false,
            message: '',
            data: mockArtist,
            status: 200
        });
    });

    it('should return 404 error when no artists found', async () => {
        (db.execute as jest.Mock).mockResolvedValue(null);

        const result = await getArtistByNameApiResp('Nonexistent Artist');

        expect(result).toEqual({
            isError: true,
            message: "The artist you're searching for is not found",
            data: null,
            status: 404
        });
    });

    it('should return 500 error when search throws', async () => {
        (db.execute as jest.Mock).mockRejectedValue(new Error('Search Error'));

        const result = await getArtistByNameApiResp('Test Artist');

        expect(result).toEqual({
            isError: true,
            message: "Something went wrong on our end",
            data: null,
            status: 500
        });
    });
});

describe('getUserById', () => {
    const mockUser = {
        id: '123',
        wallet: '0x1234567890123456789012345678901234567890',
        email: 'test@example.com'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return user when found', async () => {
        (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);

        const result = await getUserById('123');

        expect(result).toEqual(mockUser);
        expect(db.query.users.findFirst).toHaveBeenCalledWith({
            where: expect.any(Object)
        });
    });

    it('should return undefined when user not found', async () => {
        (db.query.users.findFirst as jest.Mock).mockResolvedValue(undefined);

        const result = await getUserById('nonexistent');

        expect(result).toBeUndefined();
    });

    it('should throw error when database fails', async () => {
        (db.query.users.findFirst as jest.Mock).mockRejectedValue(new Error('DB Error'));

        await expect(getUserById('123')).rejects.toThrow('Error finding user: DB Error');
    });
});

describe('getUserByWallet', () => {
    const mockUser = {
        id: '123',
        wallet: '0x1234567890123456789012345678901234567890',
        email: 'test@example.com'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return user when found by wallet', async () => {
        (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);

        const result = await getUserByWallet('0x1234567890123456789012345678901234567890');

        expect(result).toEqual(mockUser);
        expect(db.query.users.findFirst).toHaveBeenCalledWith({
            where: expect.any(Object)
        });
    });

    it('should return undefined when user not found', async () => {
        (db.query.users.findFirst as jest.Mock).mockResolvedValue(undefined);

        const result = await getUserByWallet('0x9999999999999999999999999999999999999999');

        expect(result).toBeUndefined();
    });

    it('should throw error when database fails', async () => {
        (db.query.users.findFirst as jest.Mock).mockRejectedValue(new Error('DB Error'));

        await expect(getUserByWallet('0x1234567890123456789012345678901234567890')).rejects.toThrow('Error finding user: DB Error');
    });
});

// Additional comprehensive tests for uncovered functions

// Mock additional imports needed for new tests
jest.mock('src/server/auth.ts', () => ({
    getServerAuthSession: jest.fn()
}));

jest.mock('../externalApiQueries', () => ({
    getSpotifyHeaders: jest.fn(),
    getSpotifyArtist: jest.fn(),
    getSpotifyImage: jest.fn()
}));

jest.mock('../services', () => ({
    extractArtistId: jest.fn(),
    isObjKey: jest.fn()
}));

jest.mock('axios');
jest.mock('next/headers', () => ({
    headers: jest.fn()
}));

import { getServerAuthSession } from '../../auth';
import { getSpotifyHeaders, getSpotifyArtist } from '../externalApiQueries';
import { extractArtistId } from '../services';
import axios from 'axios';
import { headers } from 'next/headers';
import {
    getArtistByWalletOrEns,
    addArtist,
    addArtistData,
    approveUgcAdmin,
    approveUGC,
    getPendingUGC,
    createUser,
    getUgcStats,
    getUgcStatsInRange,
    getWhitelistedUsers,
    addUsersToWhitelist,
    removeFromWhitelist,
    updateWhitelistedUser,
    searchForUsersByWallet,
    sendDiscordMessage,
    getAllSpotifyIds
} from '../queriesTS';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedGetServerAuthSession = getServerAuthSession as jest.MockedFunction<typeof getServerAuthSession>;
const mockedGetSpotifyHeaders = getSpotifyHeaders as jest.MockedFunction<typeof getSpotifyHeaders>;
const mockedGetSpotifyArtist = getSpotifyArtist as jest.MockedFunction<typeof getSpotifyArtist>;
const mockedExtractArtistId = extractArtistId as jest.MockedFunction<typeof extractArtistId>;
const mockedHeaders = headers as jest.MockedFunction<typeof headers>;

describe('getArtistByWalletOrEns', () => {
    const mockArtist = {
        id: '123',
        name: 'Test Artist',
        wallets: ['0x1234567890123456789012345678901234567890']
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should handle valid wallet address and call getArtistbyWallet', async () => {
        const mockQueryBuilder = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([mockArtist])
        };
        (db.select as jest.Mock).mockReturnValue(mockQueryBuilder);

        const result = await getArtistByWalletOrEns('0x1234567890123456789012345678901234567890');

        expect(result).toEqual({
            isError: false,
            message: '',
            data: mockArtist,
            status: 200
        });
    });

    it('should fall back to ENS search when wallet search fails', async () => {
        const mockQueryBuilder = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([])
        };
        (db.select as jest.Mock).mockReturnValue(mockQueryBuilder);
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(mockArtist);

        const result = await getArtistByWalletOrEns('0x1234567890123456789012345678901234567890');

        expect(result).toEqual({
            isError: false,
            message: '',
            data: mockArtist,
            status: 200
        });
    });

    it('should handle ENS names directly', async () => {
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(mockArtist);

        const result = await getArtistByWalletOrEns('testartist.eth');

        expect(result).toEqual({
            isError: false,
            message: '',
            data: mockArtist,
            status: 200
        });
        expect(db.query.artists.findFirst).toHaveBeenCalled();
    });

    it('should handle invalid wallet formats', async () => {
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(null);

        const result = await getArtistByWalletOrEns('invalid-address');

        expect(result).toEqual({
            isError: true,
            status: 404,
            message: "The artist you're searching for is not found",
            data: null
        });
    });
});

describe('addArtist', () => {
    const mockSession = {
        user: { id: 'user123' }
    };

    const mockUser = {
        id: 'user123',
        wallet: '0x1234567890123456789012345678901234567890',
        isAdmin: false,
        isWhiteListed: false
    };

    const mockSpotifyHeaders = {
        headers: { Authorization: 'Bearer token123' }
    };

    const mockSpotifyArtist = {
        error: null,
        data: {
            id: 'spotify123',
            name: 'Test Artist',
            images: []
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockedGetServerAuthSession.mockResolvedValue(mockSession as any);
        mockedGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders as any);
        mockedGetSpotifyArtist.mockResolvedValue(mockSpotifyArtist as any);
        mockedHeaders.mockReturnValue({
            get: jest.fn().mockReturnValue('mock-cookie')
        } as any);
        (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should successfully add new artist with authentication', async () => {
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(null);
        const mockInsert = {
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([{
                id: 'artist123',
                name: 'Test Artist',
                spotify: 'spotify123',
                createdAt: new Date().toISOString()
            }])
        };
        (db.insert as jest.Mock).mockReturnValue(mockInsert);
        mockedAxios.post.mockResolvedValue({ data: {} });

        const result = await addArtist('spotify123');

        expect(result).toEqual({
            status: 'success',
            artistId: 'artist123',
            artistName: 'Test Artist',
            message: 'Success! You can now find this artist in our directory'
        });
    });

    it('should return exists status when artist already in database', async () => {
        const existingArtist = {
            id: 'existing123',
            name: 'Existing Artist',
            spotify: 'spotify123'
        };
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(existingArtist);

        const result = await addArtist('spotify123');

        expect(result).toEqual({
            status: 'exists',
            artistId: 'existing123',
            artistName: 'Existing Artist',
            message: 'That artist is already in our database'
        });
    });

    it('should handle Spotify API errors', async () => {
        mockedGetSpotifyArtist.mockResolvedValue({
            error: 'Artist not found',
            data: null
        } as any);

        const result = await addArtist('invalid-spotify-id');

        expect(result).toEqual({
            status: 'error',
            message: 'Artist not found'
        });
    });

    it('should handle missing authentication when required', async () => {
        mockedGetServerAuthSession.mockResolvedValue(null);

        const result = await addArtist('spotify123');

        expect(result).toEqual({
            status: 'error',
            message: 'Please log in to add artists'
        });
    });

    it('should handle Spotify headers failure', async () => {
        mockedGetSpotifyHeaders.mockResolvedValue({ headers: {} } as any);

        const result = await addArtist('spotify123');

        expect(result).toEqual({
            status: 'error',
            message: 'Failed to authenticate with Spotify'
        });
    });

    it('should handle invalid artist data from Spotify', async () => {
        mockedGetSpotifyArtist.mockResolvedValue({
            error: null,
            data: { id: 'test', name: null }
        } as any);

        const result = await addArtist('spotify123');

        expect(result).toEqual({
            status: 'error',
            message: 'Invalid artist data received from Spotify'
        });
    });

    it('should handle database insertion errors', async () => {
        (db.query.artists.findFirst as jest.Mock).mockResolvedValue(null);
        (db.insert as jest.Mock).mockImplementation(() => {
            throw new Error('Database error');
        });

        const result = await addArtist('spotify123');

        expect(result).toEqual({
            status: 'error',
            artistId: undefined,
            message: 'Something went wrong on our end, please try again'
        });
    });
});

describe('addArtistData', () => {
    const mockSession = {
        user: { id: 'user123' }
    };

    const mockUser = {
        id: 'user123',
        wallet: '0x1234567890123456789012345678901234567890',
        isAdmin: false,
        isWhiteListed: true
    };

    const mockArtist = {
        id: 'artist123',
        name: 'Test Artist'
    };

    const mockExtractResult = {
        id: 'testusername',
        siteName: 'instagram',
        cardPlatformName: 'Instagram'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockedGetServerAuthSession.mockResolvedValue(mockSession as any);
        (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
        mockedExtractArtistId.mockResolvedValue(mockExtractResult as any);
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should directly update artist for whitelisted users', async () => {
        (db.query.ugcresearch.findFirst as jest.Mock).mockResolvedValue(null);
        const mockUpdate = {
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockResolvedValue([])
        };
        (db.update as jest.Mock).mockReturnValue(mockUpdate);
        mockedAxios.post.mockResolvedValue({ data: {} });

        const result = await addArtistData('https://instagram.com/testusername', mockArtist as any);

        expect(result).toEqual({
            status: 'success',
            message: 'Artist data has been added successfully',
            siteName: 'Instagram'
        });
        expect(db.update).toHaveBeenCalled();
    });

    it('should create UGC research entry for regular users', async () => {
        const regularUser = { ...mockUser, isWhiteListed: false };
        (db.query.users.findFirst as jest.Mock).mockResolvedValue(regularUser);
        (db.query.ugcresearch.findFirst as jest.Mock).mockResolvedValue(null);
        const mockInsert = {
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([{ id: 'ugc123' }])
        };
        (db.insert as jest.Mock).mockReturnValue(mockInsert);
        mockedAxios.post.mockResolvedValue({ data: {} });

        const result = await addArtistData('https://instagram.com/testusername', mockArtist as any);

        expect(result).toEqual({
            status: 'success',
            message: "Thanks for adding, we'll review this addition before posting",
            siteName: 'Instagram'
        });
        expect(db.insert).toHaveBeenCalled();
    });

    it('should reject invalid URLs', async () => {
        mockedExtractArtistId.mockResolvedValue(null);

        const result = await addArtistData('https://invalid-site.com/user', mockArtist as any);

        expect(result).toEqual({
            status: 'error',
            message: "The data you're trying to add isn't in our list of approved links"
        });
    });

    it('should prevent duplicate UGC submissions', async () => {
        const existingUGC = {
            id: 'existing123',
            ugcUrl: 'https://instagram.com/testusername',
            artistId: 'artist123'
        };
        (db.query.ugcresearch.findFirst as jest.Mock).mockResolvedValue(existingUGC);

        const result = await addArtistData('https://instagram.com/testusername', mockArtist as any);

        expect(result).toEqual({
            status: 'error',
            message: 'This artist data has already been added'
        });
    });

    it('should handle authentication errors', async () => {
        mockedGetServerAuthSession.mockResolvedValue(null);

        await expect(addArtistData('https://instagram.com/test', mockArtist as any))
            .rejects.toThrow('Not authenticated');
    });
});

describe('UGC Management', () => {
    const mockSession = {
        user: { id: 'admin123' }
    };

    const mockAdminUser = {
        id: 'admin123',
        wallet: '0x1234567890123456789012345678901234567890',
        isAdmin: true,
        isWhiteListed: true
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockedGetServerAuthSession.mockResolvedValue(mockSession as any);
        (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockAdminUser);
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('approveUgcAdmin', () => {
        it('should approve multiple UGC entries for admin users', async () => {
            const mockUgcData = [
                { id: 'ugc1', artistId: 'artist1', siteName: 'instagram', siteUsername: 'user1' },
                { id: 'ugc2', artistId: 'artist2', siteName: 'twitter', siteUsername: 'user2' }
            ];
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue(mockUgcData);
            (db.execute as jest.Mock).mockResolvedValue([]);
            const mockUpdate = {
                set: jest.fn().mockReturnThis(),
                where: jest.fn().mockResolvedValue([])
            };
            (db.update as jest.Mock).mockReturnValue(mockUpdate);

            const result = await approveUgcAdmin(['ugc1', 'ugc2']);

            expect(result).toEqual({
                status: 'success',
                message: 'UGC approved'
            });
        });

        it('should reject non-admin users', async () => {
            const regularUser = { ...mockAdminUser, isAdmin: false };
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(regularUser);

            await expect(approveUgcAdmin(['ugc1'])).rejects.toThrow('Not authorized');
        });

        it('should handle unauthenticated users', async () => {
            mockedGetServerAuthSession.mockResolvedValue(null);

            await expect(approveUgcAdmin(['ugc1'])).rejects.toThrow('Not authenticated');
        });
    });

    describe('approveUGC', () => {
        it('should update artist and mark UGC as accepted', async () => {
            (db.execute as jest.Mock).mockResolvedValue([]);
            const mockUpdate = {
                set: jest.fn().mockReturnThis(),
                where: jest.fn().mockResolvedValue([])
            };
            (db.update as jest.Mock).mockReturnValue(mockUpdate);

            await expect(approveUGC('ugc123', 'artist123', 'instagram', 'username'))
                .resolves.not.toThrow();

            expect(db.execute).toHaveBeenCalled();
            expect(db.update).toHaveBeenCalled();
        });

        it('should handle database errors', async () => {
            (db.execute as jest.Mock).mockRejectedValue(new Error('DB Error'));

            await expect(approveUGC('ugc123', 'artist123', 'instagram', 'username'))
                .rejects.toThrow('Error approving UGC');
        });
    });

    describe('getPendingUGC', () => {
        it('should return pending UGC with user wallet info', async () => {
            const mockPendingUGC = [
                {
                    id: 'ugc1',
                    ugcUrl: 'https://instagram.com/test',
                    accepted: false,
                    ugcUser: { wallet: '0x123...abc' }
                }
            ];
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue(mockPendingUGC);

            const result = await getPendingUGC();

            expect(result).toEqual([
                {
                    id: 'ugc1',
                    ugcUrl: 'https://instagram.com/test',
                    accepted: false,
                    wallet: '0x123...abc'
                }
            ]);
        });

        it('should handle database errors', async () => {
            (db.query.ugcresearch.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

            await expect(getPendingUGC()).rejects.toThrow('Error finding pending UGC');
        });
    });
});

describe('User Management', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('createUser', () => {
        it('should create new user successfully', async () => {
            const newUser = {
                id: 'user123',
                wallet: '0x1234567890123456789012345678901234567890'
            };
            const mockInsert = {
                values: jest.fn().mockReturnThis(),
                returning: jest.fn().mockResolvedValue([newUser])
            };
            (db.insert as jest.Mock).mockReturnValue(mockInsert);

            const result = await createUser('0x1234567890123456789012345678901234567890');

            expect(result).toEqual(newUser);
        });

        it('should handle database errors', async () => {
            (db.insert as jest.Mock).mockImplementation(() => {
                throw new Error('Database error');
            });

            await expect(createUser('0x1234567890123456789012345678901234567890'))
                .rejects.toThrow('Error creating user');
        });
    });

    describe('getUgcStats', () => {
        it('should return UGC count for authenticated user', async () => {
            const mockSession = { user: { id: 'user123' } };
            mockedGetServerAuthSession.mockResolvedValue(mockSession as any);
            const mockUgcList = [{ id: 'ugc1' }, { id: 'ugc2' }];
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue(mockUgcList);

            const result = await getUgcStats();

            expect(result).toBe(2);
        });

        it('should throw error for unauthenticated users', async () => {
            mockedGetServerAuthSession.mockResolvedValue(null);

            await expect(getUgcStats()).rejects.toThrow('Not authenticated');
        });
    });

    describe('getUgcStatsInRange', () => {
        const mockSession = { user: { id: 'user123' } };
        const dateRange = {
            from: new Date('2024-01-01'),
            to: new Date('2024-01-31')
        };

        beforeEach(() => {
            mockedGetServerAuthSession.mockResolvedValue(mockSession as any);
        });

        it('should return stats for current user in date range', async () => {
            const mockUgcList = [{ id: 'ugc1' }];
            const mockArtistsList = [{ id: 'artist1' }, { id: 'artist2' }];
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue(mockUgcList);
            (db.query.artists.findMany as jest.Mock).mockResolvedValue(mockArtistsList);

            const result = await getUgcStatsInRange(dateRange);

            expect(result).toEqual({
                ugcCount: 1,
                artistsCount: 2
            });
        });

        it('should return stats for specific wallet in date range', async () => {
            const searchedUser = { id: 'searched123' };
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(searchedUser);
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue([]);
            (db.query.artists.findMany as jest.Mock).mockResolvedValue([]);

            const result = await getUgcStatsInRange(dateRange, '0x123...abc');

            expect(result).toEqual({
                ugcCount: 0,
                artistsCount: 0
            });
        });

        it('should throw error when searched user not found', async () => {
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(null);

            await expect(getUgcStatsInRange(dateRange, '0x999...xyz'))
                .rejects.toThrow('User not found');
        });
    });
});

describe('Whitelist Management', () => {
    const mockSession = { user: { id: 'user123' } };

    beforeEach(() => {
        jest.clearAllMocks();
        mockedGetServerAuthSession.mockResolvedValue(mockSession as any);
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('getWhitelistedUsers', () => {
        it('should return whitelisted users for authenticated users', async () => {
            const mockUsers = [
                { id: 'user1', wallet: '0x123...abc', isWhiteListed: true },
                { id: 'user2', wallet: '0x456...def', isWhiteListed: true }
            ];
            (db.query.users.findMany as jest.Mock).mockResolvedValue(mockUsers);

            const result = await getWhitelistedUsers();

            expect(result).toEqual(mockUsers);
        });

        it('should throw error for unauthenticated users', async () => {
            mockedGetServerAuthSession.mockResolvedValue(null);

            await expect(getWhitelistedUsers()).rejects.toThrow('Unauthorized');
        });

        it('should return empty array when no whitelisted users', async () => {
            (db.query.users.findMany as jest.Mock).mockResolvedValue(null);

            const result = await getWhitelistedUsers();

            expect(result).toEqual([]);
        });
    });

    describe('addUsersToWhitelist', () => {
        it('should successfully add users to whitelist', async () => {
            const mockUpdate = {
                set: jest.fn().mockReturnThis(),
                where: jest.fn().mockResolvedValue([])
            };
            (db.update as jest.Mock).mockReturnValue(mockUpdate);

            const result = await addUsersToWhitelist(['0x123...abc', '0x456...def']);

            expect(result).toEqual({
                status: 'success',
                message: 'Users added to whitelist'
            });
        });

        it('should handle database errors', async () => {
            (db.update as jest.Mock).mockImplementation(() => {
                throw new Error('DB Error');
            });

            const result = await addUsersToWhitelist(['0x123...abc']);

            expect(result).toEqual({
                status: 'error',
                message: 'Error adding users to whitelist'
            });
        });
    });

    describe('removeFromWhitelist', () => {
        it('should remove users from whitelist', async () => {
            const mockUpdate = {
                set: jest.fn().mockReturnThis(),
                where: jest.fn().mockResolvedValue([])
            };
            (db.update as jest.Mock).mockReturnValue(mockUpdate);

            await expect(removeFromWhitelist(['user1', 'user2']))
                .resolves.not.toThrow();
        });

        it('should handle database errors silently', async () => {
            (db.update as jest.Mock).mockImplementation(() => {
                throw new Error('DB Error');
            });

            await expect(removeFromWhitelist(['user1']))
                .resolves.not.toThrow();
        });
    });

    describe('updateWhitelistedUser', () => {
        it('should update user fields successfully', async () => {
            const mockUpdate = {
                set: jest.fn().mockReturnThis(),
                where: jest.fn().mockResolvedValue([])
            };
            (db.update as jest.Mock).mockReturnValue(mockUpdate);

            const result = await updateWhitelistedUser('user123', {
                wallet: '0x999...xyz',
                email: 'new@example.com'
            });

            expect(result).toEqual({
                status: 'success',
                message: 'Whitelist user updated'
            });
        });

        it('should handle empty update data', async () => {
            const result = await updateWhitelistedUser('user123', {});

            expect(result).toEqual({
                status: 'error',
                message: 'No fields to update'
            });
        });

        it('should validate user ID', async () => {
            const result = await updateWhitelistedUser('', { wallet: '0x123...abc' });

            expect(result).toEqual({
                status: 'error',
                message: 'Error updating whitelisted user'
            });
        });
    });
});

describe('Utility Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('searchForUsersByWallet', () => {
        it('should return matching wallet addresses', async () => {
            const mockUsers = [
                { wallet: '0x1234...abcd' },
                { wallet: '0x1234...efgh' }
            ];
            (db.query.users.findMany as jest.Mock).mockResolvedValue(mockUsers);

            const result = await searchForUsersByWallet('0x1234');

            expect(result).toEqual(['0x1234...abcd', '0x1234...efgh']);
        });

        it('should handle database errors', async () => {
            (db.query.users.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

            const result = await searchForUsersByWallet('0x1234');

            expect(result).toBeUndefined();
        });
    });

    describe('sendDiscordMessage', () => {
        it('should send message when webhook URL configured', async () => {
            // Mock environment variable
            process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/webhook/test';
            mockedAxios.post.mockResolvedValue({ data: {} });

            await expect(sendDiscordMessage('Test message')).resolves.not.toThrow();

            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://discord.com/webhook/test',
                { content: 'Test message' }
            );
        });

        it('should fail silently when no webhook URL', async () => {
            delete (process.env as any).DISCORD_WEBHOOK_URL;

            await expect(sendDiscordMessage('Test message')).resolves.not.toThrow();

            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it('should handle network errors', async () => {
            process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/webhook/test';
            mockedAxios.post.mockRejectedValue(new Error('Network error'));

            await expect(sendDiscordMessage('Test message')).resolves.not.toThrow();
        });
    });

    describe('getAllSpotifyIds', () => {
        it('should return all non-null Spotify IDs', async () => {
            const mockResult = [
                { spotify: 'spotify1' },
                { spotify: 'spotify2' },
                { spotify: 'spotify3' }
            ];
            (db.execute as jest.Mock).mockResolvedValue(mockResult);

            const result = await getAllSpotifyIds();

            expect(result).toEqual(['spotify1', 'spotify2', 'spotify3']);
        });

        it('should handle database errors and return empty array', async () => {
            (db.execute as jest.Mock).mockRejectedValue(new Error('DB Error'));

            const result = await getAllSpotifyIds();

            expect(result).toEqual([]);
        });
    });
});