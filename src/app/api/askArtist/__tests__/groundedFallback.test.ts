// @ts-nocheck
/**
 * When our own sources do not cover a question, the ask goes to the open web.
 * That is a second surface on the same artist's page, and the blocklist has to
 * reach it — Pete's instruction was that he does not want a scrape farm
 * anywhere, not that he does not want one in the vault.
 *
 * Google's grounding chunks carry the registrable domain in `web.title`
 * (measured: "stereogum.com", "peterango.com"), and `web.uri` is an opaque
 * vertexaisearch redirect, so the domain is the only thing there is to check.
 */
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/artistDocService', () => ({ getArtistDocContext: jest.fn().mockResolvedValue('') }));
jest.mock('@/server/lib/gemini', () => ({ getGemini: jest.fn(), GEMINI_MODEL_FLASH: 'gemini-2.5-flash' }));
jest.mock('@/server/utils/queries/externalApiQueries', () => ({
    getSpotifyHeaders: jest.fn().mockResolvedValue({}),
    getSpotifyCatalogDetail: jest.fn().mockResolvedValue([]),
}));

if (!('json' in Response)) {
    Response.json = (data, init) =>
        new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            status: init?.status || 200,
        });
}

const chunksFrom = (...domains) => ({
    candidates: [{ groundingMetadata: { groundingChunks: domains.map(d => ({ web: { title: d } })) } }],
});

/**
 * First call answers INSUFFICIENT so the route falls through to grounding;
 * the second is the grounded call and returns whatever the test wants.
 */
async function ask(groundedReply) {
    const { getArtistById } = await import('@/server/utils/queries/artistQueries');
    const { getGemini } = await import('@/server/lib/gemini');
    const generateContent = jest.fn()
        .mockResolvedValueOnce({ text: 'INSUFFICIENT' })
        .mockResolvedValue(groundedReply);
    getGemini.mockReturnValue({ models: { generateContent } });
    getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango' });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://x/api/askArtist', {
        method: 'POST',
        body: JSON.stringify({ artistId: 'a1', question: 'What has Pete Rango been up to lately?' }),
    }));
    return { body: await res.json(), generateContent };
}

describe('the grounded fallback and the blocklist', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    it('never names a blocked host among the domains it used', async () => {
        const { body } = await ask({ text: 'He put out a record.', ...chunksFrom('boomplay.com', 'stereogum.com') });
        expect(body.webDomains).toEqual(['stereogum.com']);
        expect(body.fromOpenWeb).toBe(true);
    });

    it('abstains rather than answering off a scrape farm alone', async () => {
        // Dropping the pill and keeping the answer would be worse than either:
        // the claim still came from a scrape, and hiding where it came from is
        // how an unsourced sentence ends up looking like reporting.
        const { body } = await ask({ text: 'He has 12 songs.', ...chunksFrom('boomplay.com', 'viberate.com') });
        expect(body.answer).toBe("I don't have anything on that for Pete Rango yet.");
        expect(body.fromOpenWeb).toBe(false);
        expect(body.webDomains).toEqual([]);
    });

    it('still answers normally when nothing it used is blocked', async () => {
        const { body } = await ask({ text: 'He co-directed a documentary.', ...chunksFrom('rvamag.com', 'peterango.com') });
        expect(body.answer).toContain('documentary');
        expect(body.fromOpenWeb).toBe(true);
        expect(body.webDomains).toEqual(['rvamag.com', 'peterango.com']);
    });

    it('keeps an ungrounded answer, because no domains is not the same as blocked domains', async () => {
        // Gemini can answer without grounding chunks. Treating an empty list as
        // "grounded only on blocked hosts" would silence the whole fallback.
        const { body } = await ask({ text: 'He is a producer in Miami.' });
        expect(body.answer).toContain('Miami');
        expect(body.fromOpenWeb).toBe(true);
    });

    it('tells the grounded call not to lean on chart and catalogue sites', async () => {
        const { generateContent } = await ask({ text: 'ok', ...chunksFrom('rvamag.com') });
        const sys = generateContent.mock.calls[1][0].config.systemInstruction;
        expect(sys).toMatch(/chart scrapers|catalogue-listing/);
    });

    it('numbers the Spotify catalogue so a release answer can be cited', async () => {
        // "What is their latest release?" is answered purely from the catalogue
        // block. Unnumbered, it came back with no pill and the label
        // "AI-generated response" — exactly wrong for the best-sourced answer
        // we can give.
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getSpotifyCatalogDetail } = await import('@/server/utils/queries/externalApiQueries');
        const { getGemini } = await import('@/server/lib/gemini');
        const generateContent = jest.fn().mockResolvedValue({ text: 'Their latest is "rush" [1].' });
        getGemini.mockReturnValue({ models: { generateContent } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: 'SPOT1' });
        getSpotifyCatalogDetail.mockResolvedValue([{ name: 'rush', releaseDate: '2026-03-01', kind: 'single' }]);

        const { POST } = await import('../route');
        const res = await POST(new Request('http://x/api/askArtist', {
            method: 'POST',
            body: JSON.stringify({ artistId: 'a1', question: 'What is their latest release?' }),
        }));
        const body = await res.json();

        expect(String(generateContent.mock.calls[0][0].config.systemInstruction)).toContain("[1] PETE RANGO'S RELEASES");
        expect(body.sources).toEqual([
            { n: 1, title: "Pete Rango's catalogue on Spotify", url: 'https://open.spotify.com/artist/SPOT1' },
        ]);
    });

    it('numbers the places to listen, so "where can I buy this" has a pill', async () => {
        // Answered entirely from these lines. Unnumbered they produced no pill
        // and the label "AI-generated response" — presenting a link we hold on
        // file as though we made it up.
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getGemini } = await import('@/server/lib/gemini');
        const generateContent = jest.fn().mockResolvedValue({ text: 'Buy it on Bandcamp [1] or hear it on Deezer [2].' });
        getGemini.mockReturnValue({ models: { generateContent } });
        getArtistById.mockResolvedValue({
            id: 'a1', name: 'Pete Rango', bandcamp: 'peterango', deezer: '123', instagram: 'p3t3rango',
        });

        const { POST } = await import('../route');
        const body = await (await POST(new Request('http://x/api/askArtist', {
            method: 'POST',
            body: JSON.stringify({ artistId: 'a1', question: 'Where can I buy their music?' }),
        }))).json();

        expect(body.sources).toEqual([
            { n: 1, title: 'Pete Rango on Bandcamp', url: 'https://peterango.bandcamp.com' },
            { n: 2, title: 'Pete Rango on Deezer', url: 'https://www.deezer.com/artist/123' },
        ]);
        // A bare handle is identity, not a place: it stays unnumbered, and the
        // posts behind it are already citable on their own.
        expect(String(generateContent.mock.calls[0][0].config.systemInstruction)).toContain('Instagram: @p3t3rango');
    });
});
