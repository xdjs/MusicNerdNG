// @ts-nocheck
import { jest } from '@jest/globals';

const mockDeezerGetArtist = jest.fn();
const mockSpotifyGetArtist = jest.fn();

jest.mock('../deezerProvider', () => ({
    deezerProvider: { getArtist: mockDeezerGetArtist },
}));

jest.mock('../spotifyProvider', () => ({
    spotifyProvider: { getArtist: mockSpotifyGetArtist },
}));

function wikidataResponse(rows: Array<{ entity: string; targetId: string }>) {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
            results: {
                bindings: rows.map(({ entity, targetId }) => ({
                    item: { value: `http://www.wikidata.org/entity/${entity}` },
                    targetId: { value: targetId },
                })),
            },
        }),
    };
}

describe('findReciprocalArtistIdentity', () => {
    let findReciprocalArtistIdentity: typeof import('../crossPlatformArtistResolver').findReciprocalArtistIdentity;
    let mockFetch: jest.Mock;

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();
        mockFetch = global.fetch as jest.Mock;
        mockFetch.mockResolvedValue(wikidataResponse([]));
        mockDeezerGetArtist.mockResolvedValue(null);
        mockSpotifyGetArtist.mockResolvedValue(null);
        ({ findReciprocalArtistIdentity } = await import('../crossPlatformArtistResolver'));
    });

    it('resolves a Deezer artist to Spotify through one Wikidata entity and verifies its name', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([{
            entity: 'Q36153',
            targetId: '6vWDO969PvNqNYHIOW5v0m',
        }]));
        mockSpotifyGetArtist.mockResolvedValue({
            platform: 'spotify',
            platformId: '6vWDO969PvNqNYHIOW5v0m',
            name: 'Beyoncé',
        });

        await expect(findReciprocalArtistIdentity({
            platform: 'deezer',
            platformId: '145',
            name: 'Beyonce',
        })).resolves.toEqual({
            platform: 'spotify',
            platformId: '6vWDO969PvNqNYHIOW5v0m',
            source: 'wikidata',
            wikidataId: 'Q36153',
        });
        expect(mockSpotifyGetArtist).toHaveBeenCalledWith('6vWDO969PvNqNYHIOW5v0m');
        expect(mockDeezerGetArtist).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledWith(
            'https://query.wikidata.org/sparql',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('query='),
            }),
        );
        const requestBody = mockFetch.mock.calls[0][1].body as string;
        expect(decodeURIComponent(requestBody)).toContain('wdt:P2722 "145"');
        expect(decodeURIComponent(requestBody)).toContain('wdt:P1902 ?targetId');
    });

    it('resolves a Spotify artist to Deezer and verifies the target profile', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([{
            entity: 'Q36153',
            targetId: '145',
        }]));
        mockDeezerGetArtist.mockResolvedValue({
            platform: 'deezer',
            platformId: '145',
            name: 'Beyoncé',
        });

        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: '6vWDO969PvNqNYHIOW5v0m',
            name: 'Beyonce',
        })).resolves.toEqual({
            platform: 'deezer',
            platformId: '145',
            source: 'wikidata',
            wikidataId: 'Q36153',
        });
        expect(mockDeezerGetArtist).toHaveBeenCalledWith('145');
        const requestBody = mockFetch.mock.calls[0][1].body as string;
        expect(decodeURIComponent(requestBody)).toContain('wdt:P1902 "6vWDO969PvNqNYHIOW5v0m"');
        expect(decodeURIComponent(requestBody)).toContain('wdt:P2722 ?targetId');
    });

    it('rejects malformed source IDs before querying Wikidata', async () => {
        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'bad-id-with-punctuation',
            name: 'Artist',
        })).resolves.toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockDeezerGetArtist).not.toHaveBeenCalled();
    });

    it('returns null when a source ID is attached to multiple Wikidata entities', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([
            { entity: 'Q1', targetId: '123' },
            { entity: 'Q2', targetId: '123' },
        ]));

        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'spotify123',
            name: 'Artist',
        })).resolves.toBeNull();
        expect(mockDeezerGetArtist).not.toHaveBeenCalled();
    });

    it('returns null when Wikidata has multiple target IDs for one entity', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([
            { entity: 'Q1', targetId: '123' },
            { entity: 'Q1', targetId: '456' },
        ]));

        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'spotify123',
            name: 'Artist',
        })).resolves.toBeNull();
        expect(mockDeezerGetArtist).not.toHaveBeenCalled();
    });

    it('rejects a Wikidata counterpart whose target-platform name does not match', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([{
            entity: 'Q1',
            targetId: '123',
        }]));
        mockDeezerGetArtist.mockResolvedValue({
            platform: 'deezer',
            platformId: '123',
            name: 'Different Artist',
        });

        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'spotify123',
            name: 'Artist',
        })).resolves.toBeNull();
    });

    it('logs Wikidata failures and returns null', async () => {
        const error = new Error('Wikidata unavailable');
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        mockFetch.mockRejectedValue(error);

        try {
            await expect(findReciprocalArtistIdentity({
                platform: 'deezer',
                platformId: '145',
                name: 'Artist',
            })).resolves.toBeNull();
            expect(consoleError).toHaveBeenCalledWith(
                '[CrossPlatformArtistResolver] Failed to resolve deezer:145:',
                error,
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('bounds target-provider verification time and falls back to no counterpart', async () => {
        jest.useFakeTimers();
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        mockFetch.mockResolvedValue(wikidataResponse([{
            entity: 'Q1',
            targetId: '123',
        }]));
        mockDeezerGetArtist.mockReturnValue(new Promise(() => undefined));

        try {
            const result = findReciprocalArtistIdentity({
                platform: 'spotify',
                platformId: 'spotify123',
                name: 'Artist',
            });
            await Promise.resolve();
            await Promise.resolve();
            await jest.advanceTimersByTimeAsync(5000);
            await expect(result).resolves.toBeNull();
        } finally {
            consoleError.mockRestore();
            jest.useRealTimers();
        }
    });
});
