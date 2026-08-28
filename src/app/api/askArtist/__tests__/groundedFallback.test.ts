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

jest.mock('@/server/utils/queries/artistQueries', () => ({
    getArtistById: jest.fn(),
    findArtistsByInstagram: jest.fn().mockResolvedValue([]),
    findUniqueArtistsByName: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/artistDocService', () => ({ getArtistDocContext: jest.fn().mockResolvedValue('') }));
jest.mock('@/server/lib/gemini', () => ({ getGemini: jest.fn(), GEMINI_MODEL_FLASH: 'gemini-2.5-flash' }));
jest.mock('@/server/utils/queries/externalApiQueries', () => ({
    getSpotifyHeaders: jest.fn().mockResolvedValue({}),
    getSpotifyCatalogDetail: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/server/utils/queries/socialCreditQueries', () => ({ getSocialCredits: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/socialCredits', () => ({
    creditedCollaborators: jest.fn(() => []),
    selfCredits: jest.fn(() => []),
}));
jest.mock('@/server/utils/socialIngest', () => ({ getRecentOwnPosts: jest.fn().mockResolvedValue([]) }));

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

    it('links records the answer names, and only ones we hold', async () => {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getSpotifyCatalogDetail } = await import('@/server/utils/queries/externalApiQueries');
        const { getGemini } = await import('@/server/lib/gemini');
        getGemini.mockReturnValue({ models: { generateContent: jest.fn().mockResolvedValue({
            text: 'He put out "rush" and also mentioned Thriller.',
        }) } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: 'SPOT1', bandcamp: 'peterango' });
        getSpotifyCatalogDetail.mockResolvedValue([
            { name: 'rush', releaseDate: '2026-04-01', kind: 'single', url: 'https://open.spotify.com/album/RUSH' },
            { name: 'loved you more', releaseDate: '2026-03-20', kind: 'single', url: 'https://open.spotify.com/album/LOVE' },
        ]);

        const { POST } = await import('../route');
        const body = await (await POST(new Request('http://x/api/askArtist', {
            method: 'POST',
            body: JSON.stringify({ artistId: 'a1', question: 'What has he released?' }),
        }))).json();

        // "rush" is named and is in the catalogue. "loved you more" is in the
        // catalogue and is NOT named. "Thriller" is named and is not his — a
        // quoted phrase is as likely to be a lyric or a project as a release,
        // so the catalogue is the only evidence that settles it.
        expect(body.songs).toEqual([{ title: 'rush', spotifyUrl: 'https://open.spotify.com/album/RUSH' }]);
        expect(body.bandcamp).toBe('https://peterango.bandcamp.com');
    });

    it('never links the artist to their own page', async () => {
        // They reach the mention list by both routes: their own handle appears
        // in their own captions, and their name is in the directory.
        const { getArtistById, findUniqueArtistsByName, findArtistsByInstagram } = await import('@/server/utils/queries/artistQueries');
        const { getGemini } = await import('@/server/lib/gemini');
        const { creditedCollaborators } = await import('@/server/utils/socialCredits');

        getGemini.mockReturnValue({ models: { generateContent: jest.fn().mockResolvedValue({
            text: 'Pete Rango produced it with Dame Atlas.',
        }) } });
        // The bio is part of the material handed to the model, so a name in it
        // is grounded rather than something the model brought from its weights.
        getArtistById.mockResolvedValue({
            id: 'a1', name: 'Pete Rango',
            bio: 'Pete Rango produces. He works with Dame Atlas.',
        });
        creditedCollaborators.mockReturnValue([
            { subject: 'p3t3rango', isHandle: true, roles: ['mixed and mastered'] },
        ]);
        findArtistsByInstagram.mockResolvedValue([{ id: 'a1', instagram: 'p3t3rango' }]);
        findUniqueArtistsByName.mockResolvedValue(new Map([['peterango', 'a1'], ['dameatlas', 'dame-uuid']]));

        const { POST } = await import('../route');
        const body = await (await POST(new Request('http://x/api/askArtist', {
            method: 'POST',
            body: JSON.stringify({ artistId: 'a1', question: 'Who produced it?' }),
        }))).json();

        expect(body.mentions.map(m => m.artistId)).not.toContain('a1');
        // Somebody else in the directory still links, so this is about the self
        // link and not about the pass being switched off.
        expect(body.mentions).toContainEqual(expect.objectContaining({ artistId: 'dame-uuid' }));
    });

    it('will not turn a one-word instrument into a link to a stranger', async () => {
        // Pharaoh Sistare's answer mentions a Rhodes — the electric piano — and
        // there is exactly one artist here called Rhodes, so uniqueness alone
        // passed it. Every common instrument, label and place is a potential
        // artist name; a stoplist of them would always be one word short.
        const { getArtistById, findUniqueArtistsByName } = await import('@/server/utils/queries/artistQueries');
        const { getGemini } = await import('@/server/lib/gemini');
        const { creditedCollaborators } = await import('@/server/utils/socialCredits');

        getGemini.mockReturnValue({ models: { generateContent: jest.fn().mockResolvedValue({
            text: 'He played Rhodes on it, alongside Cherele and Jesse Boykins III.',
        }) } });
        getArtistById.mockResolvedValue({
            id: 'a1', name: 'Pharaoh Sistare',
            bio: 'He played Rhodes on it, alongside Cherele and Jesse Boykins III.',
        });
        // Cherele is one word AND somebody this artist has credited.
        creditedCollaborators.mockReturnValue([{ subject: 'Cherele', isHandle: false, roles: ['vocals'] }]);
        findUniqueArtistsByName.mockResolvedValue(new Map([
            ['rhodes', 'rhodes-uuid'],
            ['cherele', 'cherele-uuid'],
            ['jesseboykinsiii', 'jesse-uuid'],
        ]));

        const { POST } = await import('../route');
        const body = await (await POST(new Request('http://x/api/askArtist', {
            method: 'POST',
            body: JSON.stringify({ artistId: 'a1', question: 'Who played on it?' }),
        }))).json();

        const ids = body.mentions.map(m => m.artistId);
        expect(ids).not.toContain('rhodes-uuid');
        // Two words carry enough signal on their own; one word needs to be
        // somebody they have actually credited.
        expect(ids).toContain('jesse-uuid');
        expect(ids).toContain('cherele-uuid');
    });

    it('does not find a one-word release inside a longer word', async () => {
        // A catalogue containing "rush" matched an answer that only said
        // "rushing", and the client then rendered the "rush" inside "rushing"
        // as a record button.
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getSpotifyCatalogDetail } = await import('@/server/utils/queries/externalApiQueries');
        const { getGemini } = await import('@/server/lib/gemini');
        getGemini.mockReturnValue({ models: { generateContent: jest.fn().mockResolvedValue({
            text: 'He has been rushing to finish the record.',
        }) } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: 'SPOT1' });
        getSpotifyCatalogDetail.mockResolvedValue([
            { name: 'rush', releaseDate: '2026-04-01', kind: 'single', url: 'https://open.spotify.com/album/RUSH' },
        ]);

        const { POST } = await import('../route');
        const body = await (await POST(new Request('http://x/api/askArtist', {
            method: 'POST', body: JSON.stringify({ artistId: 'a1', question: 'What is he doing?' }),
        }))).json();
        expect(body.songs).toEqual([]);
    });

    it('will not link a name the model brought from its own weights', async () => {
        // Uniqueness in the directory proves one row has this spelling, not
        // that the sentence means that row. A name we never supplied — in the
        // vault, the document or the credits — is a guess wearing a link.
        const { getArtistById, findUniqueArtistsByName } = await import('@/server/utils/queries/artistQueries');
        const { getGemini } = await import('@/server/lib/gemini');

        getGemini.mockReturnValue({ models: { generateContent: jest.fn().mockResolvedValue({
            text: 'He grew up in Los Angeles and worked with Dame Atlas.',
        }) } });
        getArtistById.mockResolvedValue({
            id: 'a1', name: 'Pete Rango',
            bio: 'Pete Rango works with Dame Atlas.',   // Los Angeles is NOT in here
        });
        findUniqueArtistsByName.mockResolvedValue(new Map([
            ['losangeles', 'la-uuid'],
            ['dameatlas', 'dame-uuid'],
        ]));

        const { POST } = await import('../route');
        const body = await (await POST(new Request('http://x/api/askArtist', {
            method: 'POST', body: JSON.stringify({ artistId: 'a1', question: 'Where is he from?' }),
        }))).json();

        const ids = body.mentions.map(m => m.artistId);
        expect(ids).not.toContain('la-uuid');
        expect(ids).toContain('dame-uuid');
    });

    it('links a surname-first handle to the words the answer actually used', async () => {
        // The filter accepts `zavodskyalan` because the answer says "Alan
        // Zavodsky", and asWritten then has to hand back that spelling — the
        // raw handle appears nowhere on screen, so the client cannot link it.
        const { getArtistById, findArtistsByInstagram } = await import('@/server/utils/queries/artistQueries');
        const { getGemini } = await import('@/server/lib/gemini');
        const { creditedCollaborators } = await import('@/server/utils/socialCredits');

        getGemini.mockReturnValue({ models: { generateContent: jest.fn().mockResolvedValue({
            text: 'He works with Alan Zavodsky on production.',
        }) } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango' });
        creditedCollaborators.mockReturnValue([
            { subject: 'zavodskyalan', isHandle: true, roles: ['production'] },
        ]);
        findArtistsByInstagram.mockResolvedValue([]);

        const { POST } = await import('../route');
        const body = await (await POST(new Request('http://x/api/askArtist', {
            method: 'POST', body: JSON.stringify({ artistId: 'a1', question: 'Who does he work with?' }),
        }))).json();

        expect(body.mentions).toContainEqual(expect.objectContaining({
            name: 'Alan Zavodsky', instagram: 'zavodskyalan',
        }));
    });
});
