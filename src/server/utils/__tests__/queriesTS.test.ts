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
jest.mock('@/server/auth', () => ({
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

import { getServerAuthSession } from '../../auth';
import { getSpotifyHeaders, getSpotifyArtist } from '../externalApiQueries';
import { extractArtistId } from '../services';
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