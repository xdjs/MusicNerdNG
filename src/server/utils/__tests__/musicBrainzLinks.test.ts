// @ts-nocheck
import { jest } from '@jest/globals';

const SPOTIFY_ID = '0123456789ABCDEFGHIJKL';
const DEEZER_ID = '123456789';
const MUSICBRAINZ_ID = '12345678-1234-4234-8234-123456789abc';
const OTHER_MUSICBRAINZ_ID = 'abcdef12-abcd-4abc-8abc-abcdef123456';

const ok = (body: unknown) => ({
    ok: true,
    json: jest.fn().mockResolvedValue(body),
});

const sourceLookup = (...musicbrainzIds: string[]) => ({
    relations: musicbrainzIds.map(id => ({
        'target-type': 'artist',
        artist: { id },
    })),
});

const artistDetail = (...urls: string[]) => ({
    id: MUSICBRAINZ_ID,
    relations: urls.map(resource => ({ url: { resource } })),
});

async function subject() {
    const { findMusicBrainzCounterpart } = await import('../musicBrainzLinks');
    return findMusicBrainzCounterpart;
}

async function finish<T>(promise: Promise<T>): Promise<T> {
    await jest.runAllTimersAsync();
    return promise;
}

describe('findMusicBrainzCounterpart', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('resolves a NOMELON-style Spotify-to-Deezer match in exactly two calls', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(ok(sourceLookup(MUSICBRAINZ_ID)))
            .mockResolvedValueOnce(ok(artistDetail(
                `https://open.spotify.com/artist/${SPOTIFY_ID}`,
                `https://www.deezer.com/artist/${DEEZER_ID}`,
            )));

        const findCounterpart = await subject();
        const result = await finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer'));

        expect(result).toEqual({
            platformId: DEEZER_ID,
            musicbrainzId: MUSICBRAINZ_ID,
        });
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch.mock.calls[0][0]).toContain('/url?');
        expect(global.fetch.mock.calls[0][0]).toContain(
            `resource=${encodeURIComponent(`https://open.spotify.com/artist/${SPOTIFY_ID}`)}`,
        );
        expect(global.fetch.mock.calls[1][0]).toContain(`/artist/${MUSICBRAINZ_ID}?`);
    });

    it('resolves the NOMELON Deezer ID to its Spotify counterpart', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(ok(sourceLookup(MUSICBRAINZ_ID)))
            .mockResolvedValueOnce(ok(artistDetail(
                `https://www.deezer.com/artist/${DEEZER_ID}`,
                `https://open.spotify.com/artist/${SPOTIFY_ID}`,
            )));

        const findCounterpart = await subject();
        const result = await finish(findCounterpart('deezer', DEEZER_ID, 'spotify'));

        expect(result).toEqual({
            platformId: SPOTIFY_ID,
            musicbrainzId: MUSICBRAINZ_ID,
        });
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('abstains when the source URL is related to multiple MusicBrainz artists', async () => {
        global.fetch = jest.fn().mockResolvedValueOnce(ok(
            sourceLookup(MUSICBRAINZ_ID, OTHER_MUSICBRAINZ_ID),
        ));

        const findCounterpart = await subject();

        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toBeNull();
        await expect(findCounterpart('spotify', SPOTIFY_ID, 'deezer'))
            .resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['missing', {}],
        ['malformed', { id: 'not-a-musicbrainz-id' }],
    ])('fails closed when a %s artist relation accompanies a valid one', async (_case, artist) => {
        global.fetch = jest.fn().mockResolvedValueOnce(ok({
            relations: [
                ...sourceLookup(MUSICBRAINZ_ID).relations,
                { 'target-type': 'artist', artist },
            ],
        }));

        const findCounterpart = await subject();

        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('abstains when one artist exposes multiple target-platform IDs', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(ok(sourceLookup(MUSICBRAINZ_ID)))
            .mockResolvedValueOnce(ok(artistDetail(
                `https://open.spotify.com/artist/${SPOTIFY_ID}`,
                `https://www.deezer.com/artist/${DEEZER_ID}`,
                'https://www.deezer.com/artist/987654321',
            )));

        const findCounterpart = await subject();

        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toBeNull();
        await expect(findCounterpart('spotify', SPOTIFY_ID, 'deezer'))
            .resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it.each([
        {
            sourcePlatform: 'spotify',
            sourceId: SPOTIFY_ID,
            targetPlatform: 'deezer',
            validSource: `https://open.spotify.com/artist/${SPOTIFY_ID}`,
            validTarget: `https://www.deezer.com/artist/${DEEZER_ID}`,
            invalidTarget: 'https://www.deezer.com/artist/not-a-number',
        },
        {
            sourcePlatform: 'deezer',
            sourceId: DEEZER_ID,
            targetPlatform: 'spotify',
            validSource: `https://www.deezer.com/artist/${DEEZER_ID}`,
            validTarget: `https://open.spotify.com/artist/${SPOTIFY_ID}`,
            invalidTarget: 'https://open.spotify.com/artist/not-a-valid-id',
        },
    ])('fails closed when a valid $targetPlatform relation accompanies a malformed one', async ({
        sourcePlatform,
        sourceId,
        targetPlatform,
        validSource,
        validTarget,
        invalidTarget,
    }) => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(ok(sourceLookup(MUSICBRAINZ_ID)))
            .mockResolvedValueOnce(ok(artistDetail(
                validSource,
                validTarget,
                invalidTarget,
            )));

        const findCounterpart = await subject();

        await expect(finish(findCounterpart(sourcePlatform, sourceId, targetPlatform)))
            .resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('briefly caches a confirmed artist with no target-platform ID', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(ok(sourceLookup(MUSICBRAINZ_ID)))
            .mockResolvedValueOnce(ok(artistDetail(
                `https://open.spotify.com/artist/${SPOTIFY_ID}`,
            )));

        const findCounterpart = await subject();

        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toBeNull();
        await expect(findCounterpart('spotify', SPOTIFY_ID, 'deezer'))
            .resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['does not repeat it', [`https://www.deezer.com/artist/${DEEZER_ID}`]],
        ['puts it on a lookalike host', [
            `https://open.spotify.com.evil.example/artist/${SPOTIFY_ID}`,
            `https://www.deezer.com/artist/${DEEZER_ID}`,
        ]],
    ])('rejects a target when the detail response %s for the source ID', async (_case, urls) => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(ok(sourceLookup(MUSICBRAINZ_ID)))
            .mockResolvedValueOnce(ok(artistDetail(...urls)));

        const findCounterpart = await subject();

        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('shares an in-flight lookup and caches the independently verified direction', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(ok(sourceLookup(MUSICBRAINZ_ID)))
            .mockResolvedValueOnce(ok(artistDetail(
                `https://open.spotify.com/artist/${SPOTIFY_ID}`,
                `https://www.deezer.com/artist/${DEEZER_ID}`,
            )));

        const findCounterpart = await subject();
        const first = findCounterpart('spotify', SPOTIFY_ID, 'deezer');
        const concurrent = findCounterpart('spotify', SPOTIFY_ID, 'deezer');
        const [firstResult, concurrentResult] = await finish(Promise.all([first, concurrent]));

        expect(firstResult).toEqual(concurrentResult);
        expect(global.fetch).toHaveBeenCalledTimes(2);

        await expect(findCounterpart('spotify', SPOTIFY_ID, 'deezer'))
            .resolves.toEqual(firstResult);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('does not infer or cache the unverified reverse direction', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(ok(sourceLookup(MUSICBRAINZ_ID)))
            .mockResolvedValueOnce(ok(artistDetail(
                `https://open.spotify.com/artist/${SPOTIFY_ID}`,
                `https://www.deezer.com/artist/${DEEZER_ID}`,
            )))
            .mockResolvedValueOnce(ok(sourceLookup(MUSICBRAINZ_ID)))
            .mockResolvedValueOnce(ok(artistDetail(
                `https://www.deezer.com/artist/${DEEZER_ID}`,
                `https://open.spotify.com/artist/${SPOTIFY_ID}`,
            )));

        const findCounterpart = await subject();

        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toEqual({
                platformId: DEEZER_ID,
                musicbrainzId: MUSICBRAINZ_ID,
            });
        await expect(finish(findCounterpart('deezer', DEEZER_ID, 'spotify')))
            .resolves.toEqual({
                platformId: SPOTIFY_ID,
                musicbrainzId: MUSICBRAINZ_ID,
            });
        expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('drops expired queue reservations without delaying a later lookup', async () => {
        global.fetch = jest.fn().mockResolvedValue(ok(sourceLookup()));
        const findCounterpart = await subject();
        const spotifyId = (index: number) => String(index).padStart(22, '0');
        const burst = Array.from({ length: 10 }, (_, index) => (
            findCounterpart('spotify', spotifyId(index), 'deezer')
        ));

        await jest.advanceTimersByTimeAsync(6_000);
        await expect(Promise.all(burst)).resolves.toEqual(Array(10).fill(null));
        expect(global.fetch).toHaveBeenCalledTimes(6);

        const later = findCounterpart('spotify', spotifyId(99), 'deezer');
        await jest.advanceTimersByTimeAsync(599);
        expect(global.fetch).toHaveBeenCalledTimes(6);
        await jest.advanceTimersByTimeAsync(1);
        await expect(later).resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(7);
    });

    it('honors the reciprocal budget when background lookups fill the shared queue', async () => {
        global.fetch = jest.fn().mockResolvedValue(ok({ artists: [] }));
        const {
            fetchMusicBrainzLinks,
            findMusicBrainzCounterpart,
        } = await import('../musicBrainzLinks');
        const background = Array.from({ length: 10 }, (_, index) => (
            fetchMusicBrainzLinks(`Background Artist ${index}`, {})
        ));
        const startedAt = Date.now();
        const bounded = findMusicBrainzCounterpart('spotify', SPOTIFY_ID, 'deezer');

        await jest.advanceTimersByTimeAsync(5_999);
        let settled = false;
        void bounded.finally(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        await jest.advanceTimersByTimeAsync(1);
        await expect(bounded).resolves.toBeNull();
        expect(Date.now() - startedAt).toBe(6_000);

        await jest.runAllTimersAsync();
        await expect(Promise.all(background)).resolves.toEqual(Array(10).fill(null));
    });

    it('returns null rather than throwing when MusicBrainz returns malformed JSON', async () => {
        global.fetch = jest.fn().mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockRejectedValue(new SyntaxError('invalid JSON')),
        });

        const findCounterpart = await subject();

        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('briefly caches an exact MusicBrainz 404', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 404,
        });

        const findCounterpart = await subject();

        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toBeNull();
        await expect(findCounterpart('spotify', SPOTIFY_ID, 'deezer'))
            .resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not cache transient MusicBrainz failures', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 503,
        });

        const findCounterpart = await subject();

        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toBeNull();
        await expect(finish(findCounterpart('spotify', SPOTIFY_ID, 'deezer')))
            .resolves.toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});
