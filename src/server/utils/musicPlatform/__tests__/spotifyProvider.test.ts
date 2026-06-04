// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/externalApiQueries', () => ({
    getSpotifyHeaders: jest.fn(),
    getSpotifyArtist: jest.fn(),
    getSpotifyImage: jest.fn(),
    getNumberOfSpotifyReleases: jest.fn(),
    getArtistTopTrackName: jest.fn(),
    getSpotifyArtists: jest.fn(),
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: { get: jest.fn() },
}));

const mockHeaders = { headers: { Authorization: 'Bearer test-token' } };

const mockSpotifyArtist = {
    id: 'spotify-123',
    name: 'Test Artist',
    images: [{ url: 'https://img.spotify.com/artist.jpg', height: 640, width: 640 }],
    followers: { total: 50000 },
    genres: ['electronic', 'ambient'],
    type: 'artist',
    uri: 'spotify:artist:spotify-123',
    external_urls: { spotify: 'https://open.spotify.com/artist/spotify-123' },
};

describe('SpotifyProvider', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    async function setup() {
        const externalApi = await import('@/server/utils/queries/externalApiQueries');
        const axios = (await import('axios')).default;
        const { SpotifyProvider } = await import('../spotifyProvider');

        const mocks = {
            getSpotifyHeaders: externalApi.getSpotifyHeaders as jest.Mock,
            getSpotifyArtist: externalApi.getSpotifyArtist as jest.Mock,
            getSpotifyImage: externalApi.getSpotifyImage as jest.Mock,
            getNumberOfSpotifyReleases: externalApi.getNumberOfSpotifyReleases as jest.Mock,
            getArtistTopTrackName: externalApi.getArtistTopTrackName as jest.Mock,
            getSpotifyArtists: externalApi.getSpotifyArtists as jest.Mock,
            axiosGet: axios.get as jest.Mock,
        };

        mocks.getSpotifyHeaders.mockResolvedValue(mockHeaders);

        return { provider: new SpotifyProvider(), ...mocks };
    }

    it('should have platform set to spotify', async () => {
        const { provider } = await setup();
        expect(provider.platform).toBe('spotify');
    });

    describe('getArtist', () => {
        it('should normalize SpotifyArtist to MusicPlatformArtist', async () => {
            const { provider, getSpotifyArtist, getNumberOfSpotifyReleases, getArtistTopTrackName } = await setup();
            getSpotifyArtist.mockResolvedValue({ data: mockSpotifyArtist, error: null });
            getNumberOfSpotifyReleases.mockResolvedValue(5);
            getArtistTopTrackName.mockResolvedValue('Hit Song');

            const result = await provider.getArtist('spotify-123');

            expect(result).toEqual({
                platform: 'spotify',
                platformId: 'spotify-123',
                name: 'Test Artist',
                imageUrl: 'https://img.spotify.com/artist.jpg',
                followerCount: 50000,
                albumCount: 5,
                genres: ['electronic', 'ambient'],
                profileUrl: 'https://open.spotify.com/artist/spotify-123',
                topTrackName: 'Hit Song',
            });
        });

        it('should return null when getSpotifyArtist returns error', async () => {
            const { provider, getSpotifyArtist, getNumberOfSpotifyReleases, getArtistTopTrackName } = await setup();
            getSpotifyArtist.mockResolvedValue({ data: null, error: 'Invalid Spotify ID' });

            const result = await provider.getArtist('bad-id');
            expect(result).toBeNull();
            // Enrichment calls should not fire for invalid artists
            expect(getNumberOfSpotifyReleases).not.toHaveBeenCalled();
            expect(getArtistTopTrackName).not.toHaveBeenCalled();
        });

        it('should handle artist with no images', async () => {
            const { provider, getSpotifyArtist, getNumberOfSpotifyReleases, getArtistTopTrackName } = await setup();
            getSpotifyArtist.mockResolvedValue({
                data: { ...mockSpotifyArtist, images: [] },
                error: null,
            });
            getNumberOfSpotifyReleases.mockResolvedValue(3);
            getArtistTopTrackName.mockResolvedValue(null);

            const result = await provider.getArtist('spotify-123');
            expect(result?.imageUrl).toBeNull();
        });

        it('should default albumCount to 0 when releases call rejects', async () => {
            const { provider, getSpotifyArtist, getNumberOfSpotifyReleases, getArtistTopTrackName } = await setup();
            getSpotifyArtist.mockResolvedValue({ data: mockSpotifyArtist, error: null });
            getNumberOfSpotifyReleases.mockRejectedValue(new Error('Spotify rate limit'));
            getArtistTopTrackName.mockResolvedValue('Track');

            const result = await provider.getArtist('spotify-123');
            expect(result?.albumCount).toBe(0);
            expect(result?.topTrackName).toBe('Track');
        });

        it('should default topTrackName to null when top track call rejects', async () => {
            const { provider, getSpotifyArtist, getNumberOfSpotifyReleases, getArtistTopTrackName } = await setup();
            getSpotifyArtist.mockResolvedValue({ data: mockSpotifyArtist, error: null });
            getNumberOfSpotifyReleases.mockResolvedValue(5);
            getArtistTopTrackName.mockRejectedValue(new Error('Spotify error'));

            const result = await provider.getArtist('spotify-123');
            expect(result?.albumCount).toBe(5);
            expect(result?.topTrackName).toBeNull();
        });
    });

    describe('getArtistImage', () => {
        it('should return image URL', async () => {
            const { provider, getSpotifyImage } = await setup();
            getSpotifyImage.mockResolvedValue({ artistImage: 'https://img.spotify.com/artist.jpg', artistId: '' });

            const result = await provider.getArtistImage('spotify-123');
            expect(result).toBe('https://img.spotify.com/artist.jpg');
        });

        it('should return null when image is empty string', async () => {
            const { provider, getSpotifyImage } = await setup();
            getSpotifyImage.mockResolvedValue({ artistImage: '', artistId: '' });

            const result = await provider.getArtistImage('spotify-123');
            expect(result).toBeNull();
        });
    });

    describe('getTopTrackName', () => {
        it('should return track name', async () => {
            const { provider, getArtistTopTrackName } = await setup();
            getArtistTopTrackName.mockResolvedValue('Hit Song');

            const result = await provider.getTopTrackName('spotify-123');
            expect(result).toBe('Hit Song');
        });

        it('should return null when no top track', async () => {
            const { provider, getArtistTopTrackName } = await setup();
            getArtistTopTrackName.mockResolvedValue(null);

            const result = await provider.getTopTrackName('spotify-123');
            expect(result).toBeNull();
        });
    });

    describe('searchArtists', () => {
        it('should call Spotify search API and normalize results', async () => {
            const { provider, axiosGet } = await setup();
            const secondArtist = {
                ...mockSpotifyArtist,
                id: 'spotify-456',
                name: 'Another Artist',
            };
            axiosGet.mockResolvedValue({
                data: { artists: { items: [mockSpotifyArtist, secondArtist] } },
            });

            const result = await provider.searchArtists('test', 10);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                platform: 'spotify',
                platformId: 'spotify-123',
                name: 'Test Artist',
                imageUrl: 'https://img.spotify.com/artist.jpg',
                followerCount: 50000,
                albumCount: 0,
                genres: ['electronic', 'ambient'],
                profileUrl: 'https://open.spotify.com/artist/spotify-123',
                topTrackName: null,
            });
            expect(result[1].platformId).toBe('spotify-456');
        });

        it('should return empty array on API error', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockRejectedValue(new Error('Network error'));

            const result = await provider.searchArtists('test', 10);
            expect(result).toEqual([]);
        });

        it('should pass limit to Spotify API', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockResolvedValue({ data: { artists: { items: [] } } });

            await provider.searchArtists('query', 5);

            expect(axiosGet).toHaveBeenCalledWith(
                expect.stringContaining('&limit=5'),
                mockHeaders,
            );
        });
    });

    describe('getArtists', () => {
        it('should normalize batch results', async () => {
            const { provider, getSpotifyArtists } = await setup();
            const secondArtist = { ...mockSpotifyArtist, id: 'spotify-456', name: 'Artist 2' };
            getSpotifyArtists.mockResolvedValue([mockSpotifyArtist, secondArtist]);

            const result = await provider.getArtists(['spotify-123', 'spotify-456']);

            expect(result).toHaveLength(2);
            expect(result[0].albumCount).toBe(0);
            expect(result[0].topTrackName).toBeNull();
            expect(result[1].platformId).toBe('spotify-456');
        });

        it('should filter out null entries', async () => {
            const { provider, getSpotifyArtists } = await setup();
            getSpotifyArtists.mockResolvedValue([mockSpotifyArtist, null, mockSpotifyArtist]);

            const result = await provider.getArtists(['id1', 'id2', 'id3']);
            expect(result).toHaveLength(2);
        });

        it('should return empty array for empty input', async () => {
            const { provider, getSpotifyArtists } = await setup();

            const result = await provider.getArtists([]);

            expect(result).toEqual([]);
            expect(getSpotifyArtists).not.toHaveBeenCalled();
        });
    });
});
