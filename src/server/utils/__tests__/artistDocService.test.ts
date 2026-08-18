// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getVaultSourcesByArtistId: jest.fn() }));
jest.mock('@/server/utils/queries/onboardingQueries', () => ({ getInterviewAnswers: jest.fn(), getArtistDoc: jest.fn() }));
jest.mock('@/server/lib/gemini', () => ({
    getGemini: jest.fn(),
    GEMINI_MODEL_FLASH: 'gemini-2.5-flash',
}));

describe('artistDocService', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    async function setup({ geminiText = '## Overview\nA real doc.' } = {}) {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getVaultSourcesByArtistId } = await import('@/server/utils/queries/dashboardQueries');
        const { getInterviewAnswers, getArtistDoc } = await import('@/server/utils/queries/onboardingQueries');
        const { getGemini } = await import('@/server/lib/gemini');
        const generateContent = jest.fn().mockResolvedValue({ text: geminiText });
        getGemini.mockReturnValue({ models: { generateContent } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Nova Reyes', spotify: 'spot123', instagram: 'novareyes' });
        getVaultSourcesByArtistId.mockResolvedValue([
            { title: 'Pitchfork review', url: 'https://pitchfork.com/x', snippet: 'bedroom auteur', extractedText: 'long text' },
        ]);
        getInterviewAnswers.mockResolvedValue([
            { questionKey: 'sound_in_own_words', question: 'Sound?', answer: 'heartbreak you can dance to', source: 'onboarding' },
            { questionKey: 'offline_fact', question: 'Offline?', answer: null, source: 'onboarding' },
        ]);
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
});
