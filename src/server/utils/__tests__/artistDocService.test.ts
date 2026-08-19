// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getVaultSourcesByArtistId: jest.fn() }));
jest.mock('@/server/utils/queries/onboardingQueries', () => ({ getInterviewAnswers: jest.fn(), getArtistDoc: jest.fn() }));
jest.mock('@/server/utils/socialIngest', () => ({ getSocialPostsForArtist: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/lib/gemini', () => ({
    getGemini: jest.fn(),
    GEMINI_MODEL_FLASH: 'gemini-2.5-flash',
}));

describe('artistDocService', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    async function setup({ geminiText = '## Overview\nA real doc.', posts } = {}) {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getVaultSourcesByArtistId } = await import('@/server/utils/queries/dashboardQueries');
        const { getInterviewAnswers, getArtistDoc } = await import('@/server/utils/queries/onboardingQueries');
        const { getSocialPostsForArtist } = await import('@/server/utils/socialIngest');
        const { getGemini } = await import('@/server/lib/gemini');
        const generateContent = jest.fn().mockResolvedValue({ text: geminiText });
        getGemini.mockReturnValue({ models: { generateContent } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Nova Reyes', spotify: 'spot123', instagram: 'novareyes' });
        getVaultSourcesByArtistId.mockResolvedValue([
            // Long enough to be CITABLE: a source is only usable as evidence if we
            // actually fetched and read the page, and stored body text is that record.
            { title: 'Pitchfork review', url: 'https://pitchfork.com/x', snippet: 'bedroom auteur', extractedText: 'the review text '.repeat(40) },
        ]);
        getInterviewAnswers.mockResolvedValue([
            { questionKey: 'sound_in_own_words', question: 'Sound?', answer: 'heartbreak you can dance to', source: 'onboarding' },
            { questionKey: 'offline_fact', question: 'Offline?', answer: null, source: 'onboarding' },
        ]);
        getSocialPostsForArtist.mockResolvedValue(posts ?? []);
        const svc = await import('@/server/utils/artistDocService');
        return { svc, generateContent, getArtistDoc };
    }

    it('synthesizeArtistDoc feeds sources AND interview answers to Gemini, skipping skipped answers', async () => {
        const { svc, generateContent } = await setup();
        const doc = await svc.synthesizeArtistDoc('a1');
        expect(doc).toContain('## Overview');
        const call = generateContent.mock.calls[0][0];
        expect(call.contents).toContain('Pitchfork review');
        expect(call.contents).toContain('heartbreak you can dance to');
        expect(call.contents).not.toContain('Offline?'); // skipped answers are omitted, not sent as empties
        expect(call.config.systemInstruction).toContain('Story hooks');
        expect(call.config.tools).toBeUndefined(); // ungrounded by design
    });

    it('synthesizeArtistDoc hard-truncates at ARTIST_DOC_MAX_CHARS', async () => {
        const { svc } = await setup({ geminiText: 'x'.repeat(30_000) });
        const doc = await svc.synthesizeArtistDoc('a1');
        expect(doc.length).toBe(svc.ARTIST_DOC_MAX_CHARS);
    });

    it('generateAboutFromDoc returns trimmed text within MAX_BIO_LENGTH', async () => {
        const { svc, generateContent } = await setup({ geminiText: '  A concrete About.  ' });
        await expect(svc.generateAboutFromDoc('Nova Reyes', '## Overview\ndoc')).resolves.toBe('A concrete About.');
        const call = generateContent.mock.calls[0][0];
        expect(call.config.tools).toBeUndefined(); // ungrounded by design
        expect(call.config.systemInstruction).toContain('About');
    });

    it('getArtistDocContext caps the slice and returns null with no doc', async () => {
        const { svc, getArtistDoc } = await setup();
        getArtistDoc.mockResolvedValueOnce(undefined);
        await expect(svc.getArtistDocContext('a1')).resolves.toBeNull();
        getArtistDoc.mockResolvedValueOnce({ content: 'y'.repeat(10_000) });
        const ctx = await svc.getArtistDocContext('a1');
        expect(ctx.length).toBe(svc.ARTIST_DOC_CONTEXT_CAP);
    });

    describe('citations', () => {
        it('excludes sources whose page was never read — a model-written snippet is not evidence', async () => {
            const { svc } = await setup();
            const { getVaultSourcesByArtistId } = await import('@/server/utils/queries/dashboardQueries');
            getVaultSourcesByArtistId.mockResolvedValue([
                { title: 'Real', url: 'https://real.example/x', snippet: 'from the page', extractedText: 'body text '.repeat(60) },
                // Fetched nothing. Its snippet is Gemini's description of a search
                // result, not text from the page — a published About once cited one
                // of these for a claim the live page did not contain.
                { title: 'Unread', url: 'https://unread.example/y', snippet: 'a model wrote this', extractedText: null },
                // Grounding-redirect tokens expire and then 404, whatever text was
                // captured when they were stored.
                { title: 'Expired', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/T', snippet: 's', extractedText: 'body text '.repeat(60) },
            ]);
            const sources = await svc.buildDocSources('a1');
            expect(sources.filter(s => s.kind === 'vault')).toEqual([
                { id: 1, kind: 'vault', label: 'Real', url: 'https://real.example/x' },
            ]);
        });

        it('buildDocSources numbers vault sources then interview answers, skipping skipped answers', async () => {
            const { svc } = await setup();
            const sources = await svc.buildDocSources('a1');
            expect(sources).toEqual([
                { id: 1, kind: 'vault', label: 'Pitchfork review', url: 'https://pitchfork.com/x' },
                { id: 2, kind: 'interview', label: 'Their own words — "Sound?"', url: null },
            ]);
        });

        it('buildDocSources adds a numbered source per confirmed collaborator and track credit', async () => {
            const { svc } = await setup({
                posts: [
                    {
                        platform: 'instagram', platformPostId: 'p1', ownerUsername: 'novareyes', isOwnPost: true,
                        caption: 'studio day', url: 'https://instagram.com/p/collab', postedAt: '2026-01-01T00:00:00Z',
                        likeCount: 10, commentCount: 1, playCount: null,
                        hashtags: [], mentions: [], coauthors: ['dameatlas'],
                        musicTitle: 'Song Title', musicArtist: 'Nova Reyes, Dame Atlas',
                    },
                ],
            });
            const sources = await svc.buildDocSources('a1');
            const social = sources.filter(s => s.kind === 'social');
            expect(social).toEqual([
                { id: 3, kind: 'social', label: 'Instagram collaboration with @dameatlas', url: 'https://instagram.com/p/collab' },
                { id: 4, kind: 'social', label: 'Track credit — "Song Title" (Nova Reyes, Dame Atlas)', url: 'https://instagram.com/p/collab' },
            ]);
        });

        it('synthesizeArtistDoc strips a citation marker that does not resolve to a real source id, keeps valid ones', async () => {
            // Only 2 real sources exist (vault [1], interview [2]) — [1] is valid, [99] is hallucinated.
            const { svc } = await setup({ geminiText: '## Overview\nCited Lauryn Hill as an influence[1]. Also claims something[99].' });
            const doc = await svc.synthesizeArtistDoc('a1');
            expect(doc).toContain('influence[1]');
            expect(doc).not.toContain('[99]');
        });

        it('synthesizeArtistDoc feeds a numbered SOURCES manifest and citation instructions to Gemini', async () => {
            const { svc, generateContent } = await setup();
            await svc.synthesizeArtistDoc('a1');
            const call = generateContent.mock.calls[0][0];
            expect(call.contents).toContain('[1] Source: Pitchfork review');
            expect(call.contents).toContain('NUMBERED SOURCES');
            expect(call.config.systemInstruction).toContain('CITATIONS');
            expect(call.config.systemInstruction).toContain('ANTI-INFLATION');
        });

        it('generateAboutFromDoc strips a marker not present in the passed sources list', async () => {
            const { svc } = await setup({ geminiText: 'They cited Lauryn Hill[1] and something unverifiable[7].' });
            const sources = [{ id: 1, kind: 'vault', label: 'SoundBetter profile', url: 'https://soundbetter.com/profiles/x' }];
            const about = await svc.generateAboutFromDoc('Nova Reyes', '## Overview\ndoc', sources);
            expect(about).toContain('Lauryn Hill[1]');
            expect(about).not.toContain('[7]');
        });

        it('extractCitedIds finds every marker id in a string', async () => {
            const { svc } = await setup();
            expect([...svc.extractCitedIds('a[1] b[2][5] c')].sort()).toEqual([1, 2, 5]);
        });

        it('stripCitationMarkers removes every marker regardless of validity, leaving plain prose', async () => {
            const { svc } = await setup();
            expect(svc.stripCitationMarkers('Cited Lauryn Hill as an influence[3] and Solange[3].'))
                .toBe('Cited Lauryn Hill as an influence and Solange.');
            expect(svc.stripCitationMarkers('No markers here.')).toBe('No markers here.');
        });
    });
});
