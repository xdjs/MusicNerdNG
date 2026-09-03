// @ts-nocheck
/**
 * The root orientation file.
 *
 * Static-looking content, but the sitemap list is computed — and the whole
 * reason it is computed is that a hardcoded one silently goes stale the day the
 * catalogue crosses a chunk boundary. That is the part worth testing.
 */
import { jest } from '@jest/globals';

const generateSitemaps = jest.fn();
jest.mock('../../sitemap', () => ({ generateSitemaps: (...a) => generateSitemaps(...a) }));

async function get() {
    const { GET } = await import('../route');
    return GET();
}

describe('GET /llms.txt', () => {
    beforeEach(() => {
        jest.resetModules();
        generateSitemaps.mockReset();
        generateSitemaps.mockResolvedValue([{ id: 0 }, { id: 1 }, { id: 2 }]);
    });

    it('says what the site is and how to reach a document', async () => {
        const res = await get();
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/plain');
        const body = await res.text();
        expect(body).toContain('# Music Nerd');
        // The one rule that matters: how to turn an artist URL into its document.
        expect(body).toContain('/artist/<id>/llms.txt');
    });

    it('lists every sitemap chunk that exists, not a fixed three', async () => {
        generateSitemaps.mockResolvedValue([{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }]);
        const body = await (await get()).text();
        expect(body).toContain('/sitemap/3.xml');
    });

    it('still answers when the sitemap count cannot be read', async () => {
        // Degrades to one chunk rather than 500ing — the same choice robots.ts
        // makes, for the same reason: an orientation file that fails is worse
        // than one that under-reports.
        generateSitemaps.mockRejectedValue(new Error('db down'));
        const res = await get();
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('/sitemap/0.xml');
    });
});
