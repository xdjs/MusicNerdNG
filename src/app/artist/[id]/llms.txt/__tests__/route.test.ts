// @ts-nocheck
/**
 * The public door onto the knowledge document.
 *
 * The point of the route is that it has NO auth check, which is exactly the
 * kind of thing that gets "tidied" back in later by someone copying the export
 * route next door. These tests fail if that happens.
 */
import { jest } from '@jest/globals';

const getArtistDocStrict = jest.fn();
const getArtistById = jest.fn();

jest.mock('@/server/utils/queries/onboardingQueries', () => ({ getArtistDocStrict: (...a) => getArtistDocStrict(...a) }));
jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: (...a) => getArtistById(...a) }));

async function get(id = 'a1') {
    const { GET } = await import('../route');
    return GET(new Request(`https://www.musicnerd.xyz/artist/${id}/llms.txt`), { params: Promise.resolve({ id }) });
}

describe('GET /artist/[id]/llms.txt', () => {
    beforeEach(() => {
        jest.resetModules();
        getArtistDocStrict.mockReset();
        getArtistById.mockReset();
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Tom Vek' });
    });

    it('serves the document to nobody in particular — no session required', async () => {
        getArtistDocStrict.mockResolvedValue({
            content: 'He self-releases everything[1].',
            sources: [{ id: 1, kind: 'vault', label: 'Interview', url: 'https://example.com/i', publishedAt: '2024-03-02T00:00:00Z' }],
            updatedAt: '2026-09-03T10:00:00Z',
        });

        const res = await get();
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/markdown');
        // Not a download: an attachment makes a crawler save a file rather
        // than read a page.
        expect(res.headers.get('Content-Disposition')).toBeNull();

        const body = await res.text();
        expect(body).toContain('# Tom Vek');
        expect(body).toContain('He self-releases everything[1].');
        // The citation resolves inside the same file — the whole point.
        expect(body).toContain('1. Interview (2024-03-02) — https://example.com/i');
    });

    it('says how stale it is, because a crawler cannot tell', async () => {
        getArtistDocStrict.mockResolvedValue({ content: 'x', sources: [], updatedAt: '2026-09-03T10:00:00Z' });
        expect(await (await get()).text()).toContain('last updated 2026-09-03');
    });

    it('404s rather than serving an empty document', async () => {
        // A crawler that caches a blank page does not come back for the real one.
        getArtistDocStrict.mockResolvedValue({ content: '', sources: [] });
        const res = await get();
        expect(res.status).toBe(404);
        expect(await res.text()).toContain('No knowledge document');
    });

    it('404s for an artist that does not exist', async () => {
        getArtistById.mockResolvedValue(null);
        expect((await get('nope')).status).toBe(404);
    });

    it('answers 503 on a failed read, not a cacheable 404', async () => {
        // The distinction matters: 404 tells a crawler to stop asking. This
        // uses the STRICT read precisely so a database blip cannot be mistaken
        // for "this artist has no document".
        getArtistDocStrict.mockRejectedValue(new Error('db down'));
        expect((await get()).status).toBe(503);
    });
});
