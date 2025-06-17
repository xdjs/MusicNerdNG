// Import types first
import { Artist, UrlMap } from '@/server/db/DbTypes';
import { platformType } from '@/server/db/schema';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getArtistLinks, getAllLinks } from '../queriesTS';
import { hasSpotifyCredentials } from '../setup/testEnv';

// Skip all tests if Spotify credentials are missing
const testWithSpotify = hasSpotifyCredentials ? it : it.skip;

// Mock the database
jest.mock('@/server/db/drizzle', () => ({
    db: {
        query: {
            urlmap: {
                findMany: jest.fn()
            }
        }
    }
}));

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