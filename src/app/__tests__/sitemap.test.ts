// @ts-nocheck
/**
 * What we ask search engines to read.
 *
 * There was no sitemap worth the name: one url, the homepage, against 41,988
 * artist pages — so every bit of structured data on those pages sat somewhere
 * a crawler had no route to.
 */
import { jest } from '@jest/globals';

describe('sitemap', () => {
    beforeEach(() => { jest.resetModules(); });

    async function build(rows) {
        const { db } = await import('@/server/db/drizzle');
        db.execute = typeof rows === 'function' ? rows : jest.fn(async () => ({ rows }));
        const { default: sitemap } = await import('../sitemap');
        return sitemap();
    }

    it('lists the artist pages it is given, newest first', async () => {
        const out = await build([
            { id: 'a1', updated_at: '2026-08-20T00:00:00Z' },
            { id: 'a2', updated_at: null },
        ]);
        const urls = out.map(e => e.url);
        expect(urls).toContain('https://www.musicnerd.xyz/artist/a1');
        expect(urls).toContain('https://www.musicnerd.xyz/artist/a2');
        expect(out.find(e => e.url.endsWith('a1')).lastModified).toEqual(new Date('2026-08-20T00:00:00Z'));
        // A missing timestamp is omitted rather than faked as "now", which
        // would tell a crawler every page changed on every build.
        expect(out.find(e => e.url.endsWith('a2')).lastModified).toBeUndefined();
    });

    it('always includes the pages that are not artists', async () => {
        const out = await build([]);
        expect(out.map(e => e.url)).toEqual([
            'https://www.musicnerd.xyz/',
            'https://www.musicnerd.xyz/leaderboard',
        ]);
    });

    it('still returns a usable sitemap when the query fails', async () => {
        // A sitemap that 500s is worse than a small one — a crawler treats the
        // error as a reason to back off the whole site.
        const out = await build(jest.fn(async () => { throw new Error('db down'); }));
        expect(out).toHaveLength(2);
        expect(out[0].url).toBe('https://www.musicnerd.xyz/');
    });

    it('asks only for pages with something to say', async () => {
        // Of 41,988 artists, 262 have a real About and three have an approved
        // source; the rest are a name and some links. Submitting forty thousand
        // near-empty pages is a quality signal against the whole domain, and it
        // would bury the pages we want cited under the ones we do not.
        const execute = jest.fn(async () => ({ rows: [] }));
        await build(execute);
        const query = JSON.stringify(execute.mock.calls[0][0]);
        expect(query).toContain('bio');
        expect(query).toContain('approved');
    });
});
