// @ts-nocheck
import { jest } from '@jest/globals';

/**
 * The search query is raw SQL through db.execute, so Postgres column names come
 * back exactly as written — Drizzle's camelCase mapping does not apply, and the
 * db.execute<Artist> generic is an unchecked assertion. A bare `custom_image`
 * would arrive as row.custom_image, leaving row.customImage undefined with
 * types passing and every route-level test still green.
 *
 * Route tests can't catch this: they mock searchForArtistByName entirely. This
 * asserts on the SQL the query actually builds.
 */
function sqlText(node: unknown): string {
    const out: string[] = [];
    const seen = new Set();
    const walk = (v: unknown) => {
        if (typeof v === 'string') { out.push(v); return; }
        if (!v || typeof v !== 'object' || seen.has(v)) return;
        seen.add(v);
        (Array.isArray(v) ? v : Object.values(v)).forEach(walk);
    };
    walk(node);
    return out.join(' ');
}

describe('searchForArtistByName SQL', () => {
    beforeEach(() => { jest.resetModules(); });

    it('selects custom_image aliased to customImage', async () => {
        const { db } = await import('@/server/db/drizzle');
        (db.execute as jest.Mock).mockReset();
        (db.execute as jest.Mock).mockResolvedValue([]);

        const { searchForArtistByName } = await import('../artistQueries');
        await searchForArtistByName('anything');

        const all = (db.execute as jest.Mock).mock.calls.map(c => sqlText(c[0])).join(' ');

        expect(all).toContain('custom_image');
        // The alias is the whole point — without it the column arrives snake_cased.
        expect(all.replace(/\s+/g, ' ')).toContain('custom_image AS "customImage"');
    });
});
