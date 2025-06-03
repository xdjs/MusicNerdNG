// Mock environment variables
jest.mock('@/env', () => ({
    NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID: 'mock-client-id',
    NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET: 'mock-client-secret',
    DISCORD_WEBHOOK_URL: 'mock-webhook-url'
}));

// Mock the database module
jest.mock('@/server/db/drizzle', () => ({
    db: {
        query: {
            artists: {
                findFirst: jest.fn(),
                findMany: jest.fn()
            }
        },
        insert: jest.fn()
    }
}));

// Mock external API queries
jest.mock('../externalApiQueries', () => ({
    getSpotifyHeaders: jest.fn(),
    getSpotifyArtist: jest.fn()
}));

// Mock auth
jest.mock('../../auth', () => ({
    getServerAuthSession: jest.fn()
}));

// Mock next/headers
jest.mock('next/headers', () => ({
    headers: jest.fn().mockReturnValue({
        get: jest.fn()
    })
}));

import { describe, it, expect, beforeEach } from '@jest/globals';
import { addArtist } from '../queriesTS';
import { setupMocks } from './__utils__/testUtils';
import { artists } from '@/server/db/schema';

describe('Artist Management - addArtist', () => {
    const mocks = setupMocks();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should successfully add a new artist', async () => {
        // Setup mocks
        mocks.mockAuth('test-user-id');
        mocks.mockSpotify('Test Artist');

        const result = await addArtist('test-spotify-id');

        expect(result).toEqual({
            status: 'success',
            artistId: 'test-id',
            artistName: 'Test Artist',
            message: 'Success! You can now find this artist in our directory'
        });

        // Verify database calls
        expect(mocks.mockDb.query.artists.findFirst).toHaveBeenCalledWith({
            where: expect.any(Object)
        });
        expect(mocks.mockDb.insert).toHaveBeenCalledWith(artists);
    });

    it('should handle duplicate artists', async () => {
        // Setup mocks
        mocks.mockAuth('test-user-id');
        mocks.mockSpotify('Test Artist');

        // Mock database to return existing artist
        mocks.mockDb.query.artists.findFirst.mockResolvedValueOnce({
            id: 'existing-artist-id',
            name: 'Test Artist',
            spotify: 'test-spotify-id',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            legacyId: null,
            bandcamp: null,
            facebook: null,
            x: null,
            soundcloud: null,
            youtube: null,
            instagram: null,
            tiktok: null,
            supercollector: null,
            notes: null,
            patreon: null,
            youtubechannel: null,
            lcname: 'test artist',
            wikipedia: null,
            twitch: null,
            linktree: null,
            foundation: null,
            opensea: null,
            audius: null,
            zora: null,
            catalog: null,
            mirror: null,
            soundcloudId: null,
            imdb: null,
            musicbrainz: null,
            wikidata: null,
            mixcloud: null,
            facebookId: null,
            discogs: null,
            tiktokId: null,
            jaxsta: null,
            famousbirthdays: null,
            songexploder: null,
            colorsxstudios: null,
            bandsintown: null,
            onlyfans: null,
            lastfm: null,
            linkedin: null,
            soundxyz: null,
            glassnode: null,
            collectsNfTs: null,
            spotifyusername: null,
            bandcampfan: null,
            tellie: null,
            wallets: [],
            ens: null,
            lens: null,
            addedBy: 'test-user-id',
            cameo: null,
            farcaster: null
        });

        const result = await addArtist('test-spotify-id');

        expect(result).toEqual({
            status: 'exists',
            artistId: 'existing-artist-id',
            artistName: 'Test Artist',
            message: 'That artist is already in our database'
        });
    });

    it('should handle invalid Spotify data', async () => {
        // Setup mocks
        mocks.mockAuth('test-user-id');
        mocks.mockSpotify(undefined, 'Invalid Spotify ID');

        const result = await addArtist('invalid-spotify-id');

        expect(result).toEqual({
            status: 'error',
            message: 'Invalid Spotify ID'
        });
    });

    it('should handle authentication requirement', async () => {
        // Setup mocks
        mocks.mockAuth();

        // Set wallet requirement to true
        process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';

        const result = await addArtist('test-spotify-id');

        expect(result).toEqual({
            status: 'error',
            message: 'Please log in to add artists'
        });
    });

    it('should handle Spotify API errors', async () => {
        // Setup mocks
        mocks.mockAuth('test-user-id');
        mocks.mockSpotify(undefined, 'Failed to authenticate with Spotify');

        const result = await addArtist('test-spotify-id');

        expect(result).toEqual({
            status: 'error',
            message: 'Failed to authenticate with Spotify'
        });
    });
}); 