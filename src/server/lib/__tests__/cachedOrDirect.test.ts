// @ts-nocheck
import { jest } from '@jest/globals';

// cachedOrDirect is now a shared primitive behind ten call sites (getSpotifyArtist,
// getArtistWiki, both Deezer fetchers...). It was only covered indirectly through
// getSpotifyHeaders, so a regression here would surface as nine features quietly
// losing their data rather than as a failing test.
describe('cachedOrDirect', () => {
    beforeEach(() => { jest.resetModules(); });

    async function load(cacheImpl) {
        jest.doMock('next/cache', () => ({ unstable_cache: cacheImpl }));
        return import('@/server/lib/cachedOrDirect');
    }

    it('returns the cached value when there is a request context', async () => {
        const { cachedOrDirect } = await load(() => async () => 'from-cache');
        const fn = cachedOrDirect(async () => 'direct', ['k']);
        await expect(fn()).resolves.toBe('from-cache');
    });

    it('falls back to a direct call when the cache has no request context', async () => {
        // refreshArtistDoc is fired detached after a server action returns, and
        // CLI scripts have no context at all. Both were getting an exception
        // instead of data — profile discovery lost ALL Spotify enrichment that
        // way and returned almost nothing, looking like an artist with no
        // findable profiles.
        const { cachedOrDirect } = await load(() => async () => {
            throw new Error('Invariant: incrementalCache missing in unstable_cache async function x()');
        });
        const fn = cachedOrDirect(async () => 'direct', ['k']);
        await expect(fn()).resolves.toBe('direct');
    });

    it('rethrows a real failure instead of retrying it', async () => {
        // Catching everything would call the function a second time after it
        // just failed for a real reason, masking the original error behind an
        // identical one.
        const { cachedOrDirect } = await load(() => async () => { throw new Error('Spotify credentials not configured'); });
        const direct = jest.fn(async () => 'direct');
        const fn = cachedOrDirect(direct, ['k']);
        await expect(fn()).rejects.toThrow('Spotify credentials not configured');
        expect(direct).not.toHaveBeenCalled();
    });

    it('passes arguments through on the fallback path', async () => {
        const { cachedOrDirect } = await load(() => async () => { throw new Error('Invariant: incrementalCache missing'); });
        const fn = cachedOrDirect(async (a, b) => `${a}:${b}`, ['k']);
        await expect(fn('x', 'y')).resolves.toBe('x:y');
    });

    it('does not treat an unrelated cache error as missing context', async () => {
        const { cachedOrDirect, isMissingCacheContext } = await load(() => async () => { throw new Error('Redis cache connection refused'); });
        expect(isMissingCacheContext(new Error('Redis cache connection refused'))).toBe(false);
        await expect(cachedOrDirect(async () => 'direct', ['k'])()).rejects.toThrow('Redis');
    });
});
