// @ts-nocheck
import { jest } from '@jest/globals';

// The reviewer's point on #1176: this is the one defensive branch in that PR
// with no test, and its only signal is Next's error MESSAGE TEXT — not a typed
// or stable API. If the wording drifts, either getSpotifyHeaders starts
// rethrowing inside refreshArtistDoc's detached call (silently losing the
// Spotify catalog grounding, the exact failure the PR fixes), or the broad half
// of the pattern starts swallowing an unrelated invariant and masking a real
// bug. Pin both directions.
describe('getSpotifyHeaders — unstable_cache outside a request context', () => {
    beforeEach(() => { jest.resetModules(); });

    /** The real message Next throws from unstable_cache with no incremental cache. */
    const REAL = 'Invariant: incrementalCache missing in unstable_cache async function refreshSpotifyToken()';

    async function withCacheError(err) {
        jest.doMock('next/cache', () => ({
            unstable_cache: () => async () => { throw err; },
        }));
        const axios = (await import('axios')).default;
        jest.spyOn(axios, 'post').mockResolvedValue({
            data: { access_token: 'fresh-token', expires_in: 3600 },
        });
        return import('@/server/utils/queries/externalApiQueries');
    }

    it('falls back to a direct token fetch when there is no request context', async () => {
        const { getSpotifyHeaders } = await withCacheError(new Error(REAL));
        const headers = await getSpotifyHeaders();
        expect(headers.headers.Authorization).toBe('Bearer fresh-token');
    });

    it('also recognises the static-generation-store wording', async () => {
        const { getSpotifyHeaders } = await withCacheError(
            new Error('Invariant: static generation store missing in unstable_cache'),
        );
        await expect(getSpotifyHeaders()).resolves.toBeDefined();
    });

    it('RETHROWS anything that is not a missing-context invariant', async () => {
        // Catching every error here retried a token fetch that had just failed
        // for a real reason, masking the original behind a second identical one.
        // The credential tests caught that when it was first written too broadly.
        const { getSpotifyHeaders } = await withCacheError(new Error('Spotify credentials not configured'));
        await expect(getSpotifyHeaders()).rejects.toThrow('Spotify credentials not configured');
    });

    it('does not treat an unrelated error mentioning a cache as missing context', async () => {
        const { getSpotifyHeaders } = await withCacheError(new Error('Redis cache connection refused'));
        await expect(getSpotifyHeaders()).rejects.toThrow('Redis cache connection refused');
    });
});
