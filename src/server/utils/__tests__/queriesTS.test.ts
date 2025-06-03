// Mock environment variables
jest.mock('@/env', () => ({
    NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID: 'mock-client-id',
    NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET: 'mock-client-secret',
    DISCORD_WEBHOOK_URL: 'mock-webhook-url'
}));

// Mock the database module before imports
jest.mock('@/server/db/drizzle', () => ({
    db: {
        query: {
            urlmap: {
                findMany: jest.fn()
            }
        }
    }
}));

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { getArtistLinks } from '../queriesTS';
import { Artist, UrlMap } from '@/server/db/DbTypes';
import { platformType } from '@/server/db/schema';
import { db } from '@/server/db/drizzle';

// Get the mocked function with type assertion
const mockFindMany = (db.query.urlmap.findMany as unknown) as jest.MockedFunction<() => Promise<UrlMap[]>>;

// Mock URL mapping data that would come from the database
const mockUrlMaps: UrlMap[] = [
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
        regex: '""',
        regexMatcher: '',
        isMonetized: false,
        regexOptions: [],
        platformTypeList: ['social'],
        colorHex: '#000000'
    },
    {
        id: '2',
        siteName: 'youtubechannel',
        siteUrl: 'https://youtube.com',
        example: 'example',
        appStringFormat: 'placeholder-not-used',
        order: 2,
        isIframeEnabled: false,
        isEmbedEnabled: false,
        cardDescription: 'Watch on YouTube',
        cardPlatformName: 'YouTube',
        isWeb3Site: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        siteImage: '',
        regex: '""',
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
        regex: '""',
        regexMatcher: '',
        isMonetized: false,
        regexOptions: [],
        platformTypeList: ['web3'],
        colorHex: '#00FF00'
    }
];

describe('getArtistLinks', () => {
    // Reset mocks before each test
    beforeEach(() => {
        jest.clearAllMocks();
        // Set up the mock to return our test data
        mockFindMany.mockResolvedValue(mockUrlMaps);
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
        createdAt: '',
        updatedAt: '',
        supercollector: null
    };

    it('should handle an artist with all platforms correctly', async () => {
        // Mock database response
        mockFindMany.mockResolvedValueOnce(mockUrlMaps);

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
        // Mock database response
        mockFindMany.mockResolvedValueOnce(mockUrlMaps);

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
            name: 'Test Artist 2',
            youtubechannel: 'UC1234567890'
        };

        const result1 = await getArtistLinks(artistWithAtHandle);
        const result2 = await getArtistLinks(artistWithChannelId);

        expect(result1[0].artistUrl).toBe('https://www.youtube.com/@testchannel');
        expect(result2[0].artistUrl).toBe('https://www.youtube.com/channel/UC1234567890');
    });

    it('should handle Supercollector .eth removal correctly', async () => {
        // Mock database response
        mockFindMany.mockResolvedValueOnce(mockUrlMaps);

        const artistWithEth: Artist = {
            ...baseArtist,
            id: '123',
            name: 'Test Artist',
            supercollector: 'testartist.eth'
        };

        const artistWithoutEth: Artist = {
            ...baseArtist,
            id: '124',
            name: 'Test Artist 2',
            supercollector: 'testartist'
        };

        const result1 = await getArtistLinks(artistWithEth);
        const result2 = await getArtistLinks(artistWithoutEth);

        expect(result1[0].artistUrl).toBe('https://release.supercollector.xyz/artist/testartist');
        expect(result2[0].artistUrl).toBe('https://release.supercollector.xyz/artist/testartist');
    });

    it('should handle null and empty values correctly', async () => {
        // Mock database response
        mockFindMany.mockResolvedValueOnce(mockUrlMaps);

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

    it('should maintain correct ordering of links', async () => {
        // Mock URL maps with different orders
        const unorderedMockUrlMaps: UrlMap[] = [
            { ...mockUrlMaps[2], order: 3 }, // supercollector
            { ...mockUrlMaps[0], order: 1 }, // spotify
            { ...mockUrlMaps[1], order: 2 }, // youtube
        ];

        // Mock database response
        mockFindMany.mockResolvedValueOnce(unorderedMockUrlMaps);

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
        expect(result[0].siteName).toBe('spotify');
        expect(result[1].siteName).toBe('youtubechannel');
        expect(result[2].siteName).toBe('supercollector');
    });

    it('should handle database query errors', async () => {
        // Mock database error
        mockFindMany.mockRejectedValueOnce(new Error('Database error'));

        const artist: Artist = {
            ...baseArtist,
            id: '123',
            name: 'Test Artist',
            spotify: 'spotify123'
        };

        await expect(getArtistLinks(artist)).rejects.toThrow('Error fetching artist links');
    });
}); 