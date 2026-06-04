// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('next/cache', () => ({
    unstable_cache: jest.fn((fn) => fn),
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: { get: jest.fn() },
}));

jest.mock('p-limit', () => ({
    __esModule: true,
    default: jest.fn((concurrency: number) => {
        // Return a limiter that just calls the function directly
        return (fn: () => Promise<unknown>) => fn();
    }),
}));

const mockDeezerArtist = {
    id: 4738512,
    name: 'FKJ',
    link: 'https://www.deezer.com/artist/4738512',
    picture_medium: 'https://api.deezer.com/artist/4738512/image?size=medium',
    picture_xl: 'https://api.deezer.com/artist/4738512/image?size=xl',
    nb_fan: 1200000,
    nb_album: 8,
};

const mockTopTrackResponse = {
    data: [{ id: 123456, title: 'Ylang Ylang' }],
};

describe('DeezerProvider', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    async function setup() {
        const axios = (await import('axios')).default;
        const { DeezerProvider } = await import('../deezerProvider');

        const axiosGet = axios.get as jest.Mock;

        return { provider: new DeezerProvider(), axiosGet };
    }

    it('should have platform set to deezer', async () => {
        const { provider } = await setup();
        expect(provider.platform).toBe('deezer');
    });

    describe('getArtist', () => {
        it('should normalize Deezer response to MusicPlatformArtist', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet
                .mockResolvedValueOnce({ data: mockDeezerArtist })
                .mockResolvedValueOnce({ data: mockTopTrackResponse });

            const result = await provider.getArtist('4738512');

            expect(result).toEqual({
                platform: 'deezer',
                platformId: '4738512',
                name: 'FKJ',
                imageUrl: 'https://api.deezer.com/artist/4738512/image?size=xl',
                followerCount: 1200000,
                albumCount: 8,
                genres: [],
                profileUrl: 'https://www.deezer.com/artist/4738512',
                topTrackName: 'Ylang Ylang',
            });
        });

        it('should return null when Deezer returns error object', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockResolvedValueOnce({
                data: { error: { type: 'DataException', message: 'no data', code: 800 } },
            });

            const result = await provider.getArtist('99999999999');
            expect(result).toBeNull();
        });

        it('should return null when axios throws', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockRejectedValueOnce(new Error('Network error'));

            const result = await provider.getArtist('4738512');
            expect(result).toBeNull();
        });

        it('should handle artist with no picture_xl', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet
                .mockResolvedValueOnce({ data: { ...mockDeezerArtist, picture_xl: '' } })
                .mockResolvedValueOnce({ data: mockTopTrackResponse });

            const result = await provider.getArtist('4738512');
            expect(result?.imageUrl).toBeNull();
        });

        it('should handle top track call failure gracefully', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet
                .mockResolvedValueOnce({ data: mockDeezerArtist })
                .mockRejectedValueOnce(new Error('timeout'));

            const result = await provider.getArtist('4738512');
            expect(result).not.toBeNull();
            expect(result?.topTrackName).toBeNull();
            expect(result?.name).toBe('FKJ');
        });

        it('should handle empty top tracks data', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet
                .mockResolvedValueOnce({ data: mockDeezerArtist })
                .mockResolvedValueOnce({ data: { data: [] } });

            const result = await provider.getArtist('4738512');
            expect(result?.topTrackName).toBeNull();
        });
    });

    describe('getArtistImage', () => {
        it('should return picture_medium URL', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockResolvedValueOnce({ data: mockDeezerArtist });

            const result = await provider.getArtistImage('4738512');
            expect(result).toBe('https://api.deezer.com/artist/4738512/image?size=medium');
        });

        it('should return null when Deezer returns error', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockResolvedValueOnce({
                data: { error: { type: 'DataException', message: 'no data' } },
            });

            const result = await provider.getArtistImage('99999999999');
            expect(result).toBeNull();
        });

        it('should return null when picture_medium is empty', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockResolvedValueOnce({ data: { ...mockDeezerArtist, picture_medium: '' } });

            const result = await provider.getArtistImage('4738512');
            expect(result).toBeNull();
        });
    });

    describe('getTopTrackName', () => {
        it('should return track name', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockResolvedValueOnce({ data: mockTopTrackResponse });

            const result = await provider.getTopTrackName('4738512');
            expect(result).toBe('Ylang Ylang');
        });

        it('should return null when no top tracks', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockResolvedValueOnce({ data: { data: [] } });

            const result = await provider.getTopTrackName('4738512');
            expect(result).toBeNull();
        });

        it('should return null on network error', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockRejectedValueOnce(new Error('timeout'));

            const result = await provider.getTopTrackName('4738512');
            expect(result).toBeNull();
        });
    });

    describe('searchArtists', () => {
        it('should map search results to MusicPlatformArtist array', async () => {
            const { provider, axiosGet } = await setup();
            const secondArtist = { ...mockDeezerArtist, id: 999, name: 'FKJ Clone' };
            axiosGet.mockResolvedValueOnce({
                data: { data: [mockDeezerArtist, secondArtist] },
            });

            const result = await provider.searchArtists('FKJ', 10);

            expect(result).toHaveLength(2);
            expect(result[0].platformId).toBe('4738512');
            expect(result[0].topTrackName).toBeNull();
            expect(result[1].name).toBe('FKJ Clone');
        });

        it('should return empty array on Deezer error response', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockResolvedValueOnce({
                data: { error: { type: 'Exception', message: 'bad query' } },
            });

            const result = await provider.searchArtists('test query', 10);
            expect(result).toEqual([]);
        });

        it('should return empty array for empty query', async () => {
            const { provider, axiosGet } = await setup();

            const result = await provider.searchArtists('', 10);
            expect(result).toEqual([]);
            expect(axiosGet).not.toHaveBeenCalled();
        });

        it('should return empty array on network error', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockRejectedValueOnce(new Error('Network error'));

            const result = await provider.searchArtists('FKJ', 10);
            expect(result).toEqual([]);
        });

        it('should encode query parameter', async () => {
            const { provider, axiosGet } = await setup();
            axiosGet.mockResolvedValueOnce({ data: { data: [] } });

            await provider.searchArtists('FKJ & Friends', 5);

            expect(axiosGet).toHaveBeenCalledWith(
                expect.stringContaining('q=FKJ%20%26%20Friends&limit=5'),
                expect.objectContaining({ timeout: 5000 }),
            );
        });
    });

    describe('getArtists', () => {
        it('should return empty array for empty input', async () => {
            const { provider, axiosGet } = await setup();

            const result = await provider.getArtists([]);

            expect(result).toEqual([]);
            expect(axiosGet).not.toHaveBeenCalled();
        });

        it('should fetch multiple artists and filter nulls', async () => {
            const { provider, axiosGet } = await setup();
            // First artist: success (2 calls: artist + top track)
            axiosGet
                .mockResolvedValueOnce({ data: mockDeezerArtist })
                .mockResolvedValueOnce({ data: mockTopTrackResponse });
            // Second artist: error (1 call: artist returns error)
            axiosGet
                .mockResolvedValueOnce({ data: { error: { type: 'DataException', message: 'no data' } } });

            const result = await provider.getArtists(['4738512', '99999999999']);

            expect(result).toHaveLength(1);
            expect(result[0].platformId).toBe('4738512');
        });
    });
});
