// @ts-nocheck
/**
 * What we ask search engines to read.
 *
 * There was no sitemap worth the name: one url, the homepage, against 41,988
 * artist pages — so every bit of structured data on those pages sat somewhere
 * a crawler had no route to.
 *
 * And no bar. Two earlier versions filtered, first to pages with prose and then
 * to pages with three or more links, on a rule about auto-generated filler that
 * does not describe a database record. Pete settled it: no artist profile is
 * excluded.
 */
import { jest } from '@jest/globals';

describe('sitemap', () => {
    beforeEach(() => { jest.resetModules(); });

    /** Answers by which query it is, not by call order — `sitemap()` asks only
     *  for pages and `generateSitemaps()` asks only for the count. */
    async function load(rows, count = Array.isArray(rows) ? rows.length : 0) {
        const { db } = await import('@/server/db/drizzle');
        db.execute = typeof rows === 'function' ? rows : jest.fn(async (q) =>
            JSON.stringify(q).includes('count(*)') ? { rows: [{ n: count }] } : { rows });
        return import('../sitemap');
    }

    it('lists every artist, with no bar on what is on the page', async () => {
        const { default: sitemap } = await load([{ id: 'a1', updated_at: '2026-08-20T00:00:00Z' }, { id: 'a2', updated_at: null }]);
        const urls = (await sitemap({ id: 0 })).map(e => e.url);
        expect(urls).toContain('https://www.musicnerd.xyz/artist/a1');
        expect(urls).toContain('https://www.musicnerd.xyz/artist/a2');
    });

    it('carries what we last knew, and does not invent it', async () => {
        const { default: sitemap } = await load([{ id: 'a1', updated_at: '2026-08-20T00:00:00Z' }, { id: 'a2', updated_at: null }]);
        const out = await sitemap({ id: 0 });
        expect(out.find(e => e.url.endsWith('a1')).lastModified).toEqual(new Date('2026-08-20T00:00:00Z'));
        // Omitted rather than faked as "now", which would claim every page
        // changed on every build.
        expect(out.find(e => e.url.endsWith('a2')).lastModified).toBeUndefined();
    });

    it('splits into enough chunks to stay under the 50,000 limit', async () => {
        // A sitemap holds fifty thousand urls; there are nearly forty-two
        // thousand artists and the number only goes up. The previous answer was
        // to truncate silently, which is the failure nobody notices until an
        // artist asks why they are not in Google.
        const { generateSitemaps } = await load([], 41_988);
        expect(await generateSitemaps()).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
    });

    it('always produces at least one chunk, even with nothing to list', async () => {
        const { generateSitemaps } = await load([], 0);
        expect(await generateSitemaps()).toEqual([{ id: 0 }]);
    });

    it('puts the pages that are not artists in the first chunk only', async () => {
        const { default: sitemap } = await load([{ id: 'a1', updated_at: null }]);
        expect((await sitemap({ id: 0 })).map(e => e.url)).toContain('https://www.musicnerd.xyz/');
        expect((await sitemap({ id: 1 })).map(e => e.url)).not.toContain('https://www.musicnerd.xyz/');
    });

    it('windows by id rather than by date, so a chunk means the same thing twice', async () => {
        // Ordering by updated_at would shuffle artists between chunks whenever
        // anything changed, handing a crawler a different set of pages at the
        // same url and making it re-read all of them forever.
        const execute = jest.fn(async () => ({ rows: [{ n: 0 }] }));
        const { default: sitemap } = await load(execute);
        await sitemap({ id: 2 });
        const query = JSON.stringify(execute.mock.calls.at(-1)[0]);
        expect(query).toContain('ORDER BY a.id');
        expect(query).not.toContain('updated_at DESC');
    });

    it('still returns a usable sitemap when the query fails', async () => {
        // A sitemap that 500s is worse than a short one — a crawler treats the
        // error as a reason to back off the whole site.
        const { default: sitemap } = await load(jest.fn(async () => { throw new Error('db down'); }));
        const out = await sitemap({ id: 0 });
        expect(out).toHaveLength(2);
        expect(out[0].url).toBe('https://www.musicnerd.xyz/');
    });
});

describe('robots', () => {
    beforeEach(() => { jest.resetModules(); });

    it('names every sitemap chunk, since there is no index at the old path', async () => {
        const { db } = await import('@/server/db/drizzle');
        db.execute = jest.fn(async () => ({ rows: [{ n: 41_988 }] }));
        const { default: robots } = await import('../robots');
        const out = await robots();
        expect(out.sitemap).toEqual([
            'https://www.musicnerd.xyz/sitemap/0.xml',
            'https://www.musicnerd.xyz/sitemap/1.xml',
            'https://www.musicnerd.xyz/sitemap/2.xml',
        ]);
        expect(out.rules).toMatchObject({ allow: '/' });
    });

    it('still serves a robots.txt when the count cannot be read', async () => {
        const { db } = await import('@/server/db/drizzle');
        db.execute = jest.fn(async () => { throw new Error('db down'); });
        const { default: robots } = await import('../robots');
        // One chunk named is worth serving; a 500 tells a crawler to stay away.
        expect((await robots()).sitemap).toEqual(['https://www.musicnerd.xyz/sitemap/0.xml']);
    });
});
