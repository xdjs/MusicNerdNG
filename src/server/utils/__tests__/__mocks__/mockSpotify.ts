import type { SpotifyHeaders, SpotifyArtistApiResponse, SpotifyArtist } from '@/server/utils/externalApiQueries';

export const createMockSpotifyHeaders = (): { headers: { Authorization: string | null } } => ({
    headers: { 
        Authorization: `Bearer mock-token`
    }
});

export const createMockSpotifyArtist = (id: string, name: string): SpotifyArtistApiResponse => ({
    data: {
        name,
        id,
        images: [],
        followers: { total: 0 },
        genres: [],
        type: 'artist',
        uri: `spotify:artist:${id}`,
        external_urls: {
            spotify: `https://open.spotify.com/artist/${id}`
        }
    },
    error: null
});

export const createMockSpotifyError = (error: string): SpotifyArtistApiResponse => ({
    data: null,
    error
});

export const mockSpotifyApi = {
    getArtist: jest.fn(async (id: string) => {
        if (id === 'invalid-spotify-id') {
            return createMockSpotifyError('Invalid Spotify ID');
        }
        if (id === 'spotify-auth-error') {
            return createMockSpotifyError('Failed to authenticate with Spotify');
        }
        return createMockSpotifyArtist('mock-spotify-id', 'Test Artist');
    })
};

// Basic test to verify mock functionality
describe('mockSpotify', () => {
    it('should return mock artist data for valid ID', async () => {
        const result = await mockSpotifyApi.getArtist('valid-id');
        expect(result.data).toBeTruthy();
        expect(result.error).toBeNull();
        expect(result.data?.name).toBe('Test Artist');
        expect(result.data?.id).toBe('mock-spotify-id');
    });

    it('should return error for invalid ID', async () => {
        const result = await mockSpotifyApi.getArtist('invalid-spotify-id');
        expect(result.data).toBeNull();
        expect(result.error).toBe('Invalid Spotify ID');
    });
}); 