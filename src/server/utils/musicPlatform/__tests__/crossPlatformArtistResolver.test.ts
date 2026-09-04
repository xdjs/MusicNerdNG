// @ts-nocheck
import { jest } from '@jest/globals';

const mockDeezerGetArtistIdentity = jest.fn();
const mockSpotifyGetArtistIdentity = jest.fn();
const mockFindMusicBrainzCounterpart = jest.fn();

jest.mock('../deezerProvider', () => ({
    deezerProvider: { getArtistIdentity: mockDeezerGetArtistIdentity },
}));

jest.mock('../spotifyProvider', () => ({
    spotifyProvider: { getArtistIdentity: mockSpotifyGetArtistIdentity },
}));

jest.mock('@/server/utils/musicBrainzLinks', () => ({
    findMusicBrainzCounterpart: mockFindMusicBrainzCounterpart,
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
        mockDeezerGetArtistIdentity.mockResolvedValue(null);
        mockSpotifyGetArtistIdentity.mockResolvedValue(null);
        mockFindMusicBrainzCounterpart.mockResolvedValue(null);
        ({ findReciprocalArtistIdentity } = await import('../crossPlatformArtistResolver'));
    });

    it('resolves a Deezer artist to Spotify through one Wikidata entity and verifies its name', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([{
            entity: 'Q36153',
            targetId: '6vWDO969PvNqNYHIOW5v0m',
        }]));
        mockSpotifyGetArtistIdentity.mockResolvedValue({
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
        expect(mockSpotifyGetArtistIdentity).toHaveBeenCalledWith('6vWDO969PvNqNYHIOW5v0m');
        expect(mockDeezerGetArtistIdentity).not.toHaveBeenCalled();
        expect(mockFindMusicBrainzCounterpart).not.toHaveBeenCalled();
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
        mockDeezerGetArtistIdentity.mockResolvedValue({
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
        expect(mockDeezerGetArtistIdentity).toHaveBeenCalledWith('145');
        const requestBody = mockFetch.mock.calls[0][1].body as string;
        expect(decodeURIComponent(requestBody)).toContain('wdt:P1902 "6vWDO969PvNqNYHIOW5v0m"');
        expect(decodeURIComponent(requestBody)).toContain('wdt:P2722 ?targetId');
    });

    it('falls back from a Wikidata miss to an exact MusicBrainz platform pair', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([]));
        mockFindMusicBrainzCounterpart.mockResolvedValue({
            platformId: '3PRXdiVu8lUkeCKw4ZUX4B',
            musicbrainzId: 'cdea97c2-b1a1-488f-bb71-5d3d78b8bed4',
        });
        mockSpotifyGetArtistIdentity.mockResolvedValue({
            platform: 'spotify',
            platformId: '3PRXdiVu8lUkeCKw4ZUX4B',
            name: 'NOMELON NOLEMON',
        });

        await expect(findReciprocalArtistIdentity({
            platform: 'deezer',
            platformId: '139294362',
            name: 'NOMELON NOLEMON',
        })).resolves.toEqual({
            platform: 'spotify',
            platformId: '3PRXdiVu8lUkeCKw4ZUX4B',
            source: 'musicbrainz',
            musicbrainzId: 'cdea97c2-b1a1-488f-bb71-5d3d78b8bed4',
        });
        expect(mockFindMusicBrainzCounterpart).toHaveBeenCalledWith(
            'deezer',
            '139294362',
            'spotify',
        );
        expect(mockSpotifyGetArtistIdentity).toHaveBeenCalledWith('3PRXdiVu8lUkeCKw4ZUX4B');
    });

    it('rejects a MusicBrainz counterpart whose verified name does not match', async () => {
        mockFindMusicBrainzCounterpart.mockResolvedValue({
            platformId: '3PRXdiVu8lUkeCKw4ZUX4B',
            musicbrainzId: 'cdea97c2-b1a1-488f-bb71-5d3d78b8bed4',
        });
        mockSpotifyGetArtistIdentity.mockResolvedValue({
            platform: 'spotify',
            platformId: '3PRXdiVu8lUkeCKw4ZUX4B',
            name: 'Different Artist',
        });

        await expect(findReciprocalArtistIdentity({
            platform: 'deezer',
            platformId: '139294362',
            name: 'NOMELON NOLEMON',
        })).resolves.toBeNull();
    });

    it('logs unexpected MusicBrainz failures and returns null', async () => {
        const error = new Error('MusicBrainz unavailable');
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        mockFindMusicBrainzCounterpart.mockRejectedValue(error);

        try {
            await expect(findReciprocalArtistIdentity({
                platform: 'deezer',
                platformId: '139294362',
                name: 'NOMELON NOLEMON',
            })).resolves.toBeNull();
            expect(consoleError).toHaveBeenCalledWith(
                '[CrossPlatformArtistResolver] MusicBrainz lookup failed for deezer:139294362:',
                error,
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it.each([
        {
            sourcePlatform: 'spotify' as const,
            sourcePlatformId: 'spotify123',
            sourceProperty: 'P1902',
            targetProperty: 'P2722',
        },
        {
            sourcePlatform: 'deezer' as const,
            sourcePlatformId: '145',
            sourceProperty: 'P2722',
            targetProperty: 'P1902',
        },
    ])(
        'requests enough Wikidata ownership evidence for $sourcePlatform',
        async ({ sourcePlatform, sourcePlatformId, sourceProperty, targetProperty }) => {
            mockFetch.mockResolvedValue(wikidataResponse([]));

            await findReciprocalArtistIdentity({
                platform: sourcePlatform,
                platformId: sourcePlatformId,
                name: 'Artist',
            });

            const requestBody = mockFetch.mock.calls[0][1].body as string;
            const query = decodeURIComponent(requestBody);
            expect(query).toContain(`?item wdt:${sourceProperty} "${sourcePlatformId}"`);
            expect(query).toContain(`?item wdt:${targetProperty} ?targetId`);
            expect(query).toContain(
                `?otherTarget wdt:${targetProperty} ?targetId`,
            );
            expect(query).toContain('FILTER (?otherTarget != ?item)');
        },
    );

    it('returns null without provider verification when uniqueness filtering leaves no match', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([]));

        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'spotify123',
            name: 'Artist',
        })).resolves.toBeNull();
        expect(mockDeezerGetArtistIdentity).not.toHaveBeenCalled();
        expect(mockSpotifyGetArtistIdentity).not.toHaveBeenCalled();
    });

    it('returns the target provider canonical ID after verification', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([{
            entity: 'Q36153',
            targetId: '000145',
        }]));
        mockDeezerGetArtistIdentity.mockResolvedValue({
            platform: 'deezer',
            platformId: '145',
            name: 'Beyonce',
        });

        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'spotify123',
            name: 'Beyonce',
        })).resolves.toEqual({
            platform: 'deezer',
            platformId: '145',
            source: 'wikidata',
            wikidataId: 'Q36153',
        });
        expect(mockDeezerGetArtistIdentity).toHaveBeenCalledWith('000145');
    });

    it('rejects malformed source IDs before querying Wikidata', async () => {
        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'bad-id-with-punctuation',
            name: 'Artist',
        })).resolves.toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockDeezerGetArtistIdentity).not.toHaveBeenCalled();
        expect(mockFindMusicBrainzCounterpart).not.toHaveBeenCalled();
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
        expect(mockDeezerGetArtistIdentity).not.toHaveBeenCalled();
        expect(mockFindMusicBrainzCounterpart).not.toHaveBeenCalled();
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
        expect(mockDeezerGetArtistIdentity).not.toHaveBeenCalled();
        expect(mockFindMusicBrainzCounterpart).not.toHaveBeenCalled();
    });

    it('does not fall back when another Wikidata entity owns the target ID', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                results: {
                    bindings: [{
                        item: { value: 'http://www.wikidata.org/entity/Q1' },
                        targetId: { value: '123' },
                        otherTarget: { value: 'http://www.wikidata.org/entity/Q2' },
                    }],
                },
            }),
        });

        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'spotify123',
            name: 'Artist',
        })).resolves.toBeNull();
        expect(mockDeezerGetArtistIdentity).not.toHaveBeenCalled();
        expect(mockFindMusicBrainzCounterpart).not.toHaveBeenCalled();
    });

    it('falls back when Wikidata knows the source entity but has no target ID', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                results: {
                    bindings: [{
                        item: { value: 'http://www.wikidata.org/entity/Q1' },
                    }],
                },
            }),
        });

        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'spotify123',
            name: 'Artist',
        })).resolves.toBeNull();
        expect(mockFindMusicBrainzCounterpart).toHaveBeenCalledWith(
            'spotify',
            'spotify123',
            'deezer',
        );
    });

    it('rejects a Wikidata counterpart whose target-platform name does not match', async () => {
        mockFetch.mockResolvedValue(wikidataResponse([{
            entity: 'Q1',
            targetId: '123',
        }]));
        mockDeezerGetArtistIdentity.mockResolvedValue({
            platform: 'deezer',
            platformId: '123',
            name: 'Different Artist',
        });

        await expect(findReciprocalArtistIdentity({
            platform: 'spotify',
            platformId: 'spotify123',
            name: 'Artist',
        })).resolves.toBeNull();
        expect(mockFindMusicBrainzCounterpart).not.toHaveBeenCalled();
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
                '[CrossPlatformArtistResolver] Wikidata lookup failed for deezer:145:',
                error,
            );
            expect(mockFindMusicBrainzCounterpart).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('fails closed on a malformed Wikidata success response', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({ error: 'query result unavailable' }),
        });

        try {
            await expect(findReciprocalArtistIdentity({
                platform: 'deezer',
                platformId: '145',
                name: 'Artist',
            })).resolves.toBeNull();
            expect(mockFindMusicBrainzCounterpart).not.toHaveBeenCalled();
            expect(consoleError).toHaveBeenCalledWith(
                '[CrossPlatformArtistResolver] Wikidata lookup failed for deezer:145:',
                expect.objectContaining({
                    message: 'Wikidata SPARQL returned a malformed response',
                }),
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it.each([
        {
            label: 'an empty binding',
            bindings: [{}],
        },
        {
            label: 'a malformed binding beside a valid one',
            bindings: [
                {
                    item: { value: 'http://www.wikidata.org/entity/Q1' },
                    targetId: { value: '123' },
                },
                { targetId: { value: '456' } },
            ],
        },
    ])('fails closed when Wikidata returns $label', async ({ bindings }) => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({ results: { bindings } }),
        });

        try {
            await expect(findReciprocalArtistIdentity({
                platform: 'deezer',
                platformId: '145',
                name: 'Artist',
            })).resolves.toBeNull();
            expect(mockFindMusicBrainzCounterpart).not.toHaveBeenCalled();
            expect(consoleError).toHaveBeenCalledWith(
                '[CrossPlatformArtistResolver] Wikidata lookup failed for deezer:145:',
                expect.objectContaining({
                    message: 'Wikidata SPARQL returned a malformed binding',
                }),
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
        mockDeezerGetArtistIdentity.mockReturnValue(new Promise(() => undefined));

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
