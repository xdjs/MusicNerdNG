import { unstable_cache } from "next/cache";

/** Next's `unstable_cache` outside a request context. The message is the only
 *  signal it gives — there is no typed error class to match on. */
export function isMissingCacheContext(e: unknown): boolean {
    const msg = (e as Error)?.message ?? "";
    return /incrementalCache missing|static generation store missing|Invariant: (?:cache|incremental)/i.test(msg);
}

/**
 * `unstable_cache` that degrades to a direct call instead of throwing.
 *
 * Next's `unstable_cache` requires a request context and throws
 * "Invariant: incrementalCache missing" without one. A growing amount of our
 * work has no such context: `refreshArtistDoc` is fired detached after a server
 * action returns, and CLI and dev scripts have none at all. Every cached read
 * was therefore an exception waiting for its first caller outside a request.
 *
 * That was not theoretical. `getSpotifyArtist` throwing this way meant profile
 * discovery ran with NO Spotify enrichment — no name, genres or images to
 * search with — and quietly returned almost nothing, looking for all the world
 * like an artist with no findable profiles.
 *
 * The cache is an optimisation. Losing it should cost a round trip, not the
 * feature. Any error that is NOT the missing-context invariant still throws:
 * catching everything would retry a call that just failed for a real reason and
 * mask the original behind a second identical one.
 */
export function cachedOrDirect<A extends unknown[], R>(
    fn: (...args: A) => Promise<R>,
    keyParts: string[],
    opts?: { tags?: string[]; revalidate?: number | false },
): (...args: A) => Promise<R> {
    const cached = unstable_cache(fn, keyParts, opts);
    return async (...args: A): Promise<R> => {
        try {
            return await cached(...args);
        } catch (e) {
            if (!isMissingCacheContext(e)) throw e;
            return fn(...args);
        }
    };
}
