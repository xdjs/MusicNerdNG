// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/server/utils/socialIngest', () => ({ getSocialPostsForArtist: jest.fn() }));
jest.mock('@/server/lib/gemini', () => ({
    getGemini: jest.fn(),
    GEMINI_MODEL_FLASH: 'gemini-2.5-flash',
}));

const OWN_POSTS = [
    {
        platform: 'instagram', platformPostId: '1', ownerUsername: 'p3t3rango', isOwnPost: true,
        caption: 'house been therapy', url: 'https://www.instagram.com/p/OWN1/', postedAt: '2026-05-01T00:00:00.000Z',
        likeCount: 500, commentCount: 10, playCount: 9000, hashtags: ['housemusic'], mentions: [],
        coauthors: [], musicTitle: 'Signals', musicArtist: 'Brian Eno',
    },
    {
        platform: 'instagram', platformPostId: '1b', ownerUsername: 'p3t3rango', isOwnPost: true,
        caption: 'house is a church', url: 'https://www.instagram.com/p/OWN1B/', postedAt: '2026-05-03T00:00:00.000Z',
        likeCount: 30, commentCount: 2, playCount: 300, hashtags: ['housemusic'], mentions: [],
        coauthors: [], musicTitle: null, musicArtist: null,
    },
    ...Array.from({ length: 5 }, (_, i) => ({
        platform: 'instagram', platformPostId: `own${i}`, ownerUsername: 'p3t3rango', isOwnPost: true,
        caption: null, url: `https://www.instagram.com/p/OWNREG${i}/`, postedAt: `2026-0${i + 1}-01T00:00:00.000Z`,
        likeCount: 20 + i, commentCount: 1, playCount: 100 + i, hashtags: [], mentions: [],
        coauthors: [], musicTitle: null, musicArtist: null,
    })),
    {
        platform: 'instagram', platformPostId: '2', ownerUsername: 'dameatlas', isOwnPost: false,
        caption: 'collab drop with pete', url: 'https://www.instagram.com/p/COLLAB1/', postedAt: '2026-05-02T00:00:00.000Z',
        likeCount: 100, commentCount: 5, playCount: 2000, hashtags: [], mentions: [],
        coauthors: [], musicTitle: 'crying on the floor', musicArtist: 'Dame Atlas, Pete Rango',
    },
];

describe('generateGroundedQuestions', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    async function setup({ posts = OWN_POSTS, artist = { id: 'a1', name: 'Pete Rango', instagram: 'p3t3rango' }, geminiText, generateContentImpl } = {}) {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getSocialPostsForArtist } = await import('@/server/utils/socialIngest');
        const { getGemini } = await import('@/server/lib/gemini');
        getArtistById.mockResolvedValue(artist);
        getSocialPostsForArtist.mockResolvedValue(posts);
        const generateContent = generateContentImpl ?? jest.fn().mockResolvedValue({ text: geminiText ?? '[]' });
        getGemini.mockReturnValue({ models: { generateContent } });
        const mod = await import('@/server/utils/questionGenerator');
        return { ...mod, generateContent, getArtistById, getSocialPostsForArtist, getGemini };
    }

    it('returns [] when the artist does not exist', async () => {
        const { generateGroundedQuestions, getArtistById } = await setup();
        getArtistById.mockResolvedValue(undefined);
        await expect(generateGroundedQuestions('a1')).resolves.toEqual([]);
    });

    it('returns [] when the artist has no ingested posts', async () => {
        const { generateGroundedQuestions } = await setup({ posts: [] });
        await expect(generateGroundedQuestions('a1')).resolves.toEqual([]);
    });

    it('builds questions from model answers, joined back to OUR signal data (not the model\'s)', async () => {
        const geminiText = JSON.stringify([
            { signalId: 'collab_dameatlas', question: 'You and @dameatlas dropped a track together — what\'s the story?', rationale: 'real collab' },
            { signalId: 'theme_hashtag_housemusic', question: 'House music keeps coming up for you — where does that come from?', rationale: 'recurring hashtag' },
        ]);
        const { generateGroundedQuestions } = await setup({ geminiText });
        const questions = await generateGroundedQuestions('a1');

        expect(questions).toHaveLength(2);
        const collab = questions.find(q => q.kind === 'collaborator');
        expect(collab.key).toBe('social_collaborator_dameatlas');
        expect(collab.sourceUrls).toEqual(['https://www.instagram.com/p/COLLAB1/']); // from OUR candidate, not the model
        expect(collab.question).toContain('@dameatlas');

        const theme = questions.find(q => q.kind === 'theme');
        expect(theme.key).toBe('social_theme_hashtag_housemusic');
        expect(theme.sourceUrls).toEqual(['https://www.instagram.com/p/OWN1/', 'https://www.instagram.com/p/OWN1B/']);
    });

    it('drops any answer whose signalId was not one WE supplied (hallucination defense)', async () => {
        const geminiText = JSON.stringify([
            { signalId: 'made_up_signal_not_real', question: 'Tell me about this thing I invented', rationale: 'x' },
        ]);
        const { generateGroundedQuestions } = await setup({ geminiText });
        await expect(generateGroundedQuestions('a1')).resolves.toEqual([]);
    });

    it('drops a duplicate signalId (only the first occurrence counts)', async () => {
        const geminiText = JSON.stringify([
            { signalId: 'collab_dameatlas', question: 'First question', rationale: 'x' },
            { signalId: 'collab_dameatlas', question: 'Second question', rationale: 'x' },
        ]);
        const { generateGroundedQuestions } = await setup({ geminiText });
        const questions = await generateGroundedQuestions('a1');
        expect(questions).toHaveLength(1);
        expect(questions[0].question).toBe('First question');
    });

    it('caps output at opts.max even when the model returns more', async () => {
        const geminiText = JSON.stringify([
            { signalId: 'collab_dameatlas', question: 'q1', rationale: 'x' },
            { signalId: 'theme_hashtag_housemusic', question: 'q2', rationale: 'x' },
        ]);
        const { generateGroundedQuestions } = await setup({ geminiText });
        const questions = await generateGroundedQuestions('a1', { max: 1 });
        expect(questions).toHaveLength(1);
    });

    it('strips markdown code fences from the model response defensively', async () => {
        const geminiText = '```json\n' + JSON.stringify([{ signalId: 'collab_dameatlas', question: 'fenced question', rationale: 'x' }]) + '\n```';
        const { generateGroundedQuestions } = await setup({ geminiText });
        const questions = await generateGroundedQuestions('a1');
        expect(questions).toHaveLength(1);
        expect(questions[0].question).toBe('fenced question');
    });

    it('never throws and degrades to [] when Gemini itself throws (e.g. missing API key)', async () => {
        const { getGemini } = await import('@/server/lib/gemini');
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getSocialPostsForArtist } = await import('@/server/utils/socialIngest');
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', instagram: 'p3t3rango' });
        getSocialPostsForArtist.mockResolvedValue(OWN_POSTS);
        getGemini.mockImplementation(() => { throw new Error('GEMINI_API_KEY must be set'); });
        const { generateGroundedQuestions } = await import('@/server/utils/questionGenerator');
        await expect(generateGroundedQuestions('a1')).resolves.toEqual([]);
    });

    it('degrades to [] on malformed (non-JSON) model output', async () => {
        const { generateGroundedQuestions } = await setup({ geminiText: 'not json at all' });
        await expect(generateGroundedQuestions('a1')).resolves.toEqual([]);
    });

    it('degrades to [] on empty model text', async () => {
        const { generateGroundedQuestions } = await setup({ geminiText: '' });
        await expect(generateGroundedQuestions('a1')).resolves.toEqual([]);
    });

    it('labels a collab-owned signal authoredBy "@handle" (never "artist") in the prompt sent to Gemini', async () => {
        const { generateGroundedQuestions, generateContent } = await setup({ geminiText: '[]' });
        await generateGroundedQuestions('a1');
        const call = generateContent.mock.calls[0][0];
        const payload = JSON.parse(call.contents.split('SIGNALS:\n')[1].split('\n\nChoose')[0]);
        const collabSignal = payload.find((c) => c.signalId === 'collab_dameatlas');
        expect(collabSignal.authoredBy).toBe('@dameatlas');
        const ownThemeSignal = payload.find((c) => c.signalId === 'theme_hashtag_housemusic');
        expect(ownThemeSignal.authoredBy).toBe('artist');
        // ungrounded by design — no search tools attached
        expect(call.config.tools).toBeUndefined();
        expect(call.config.systemInstruction).toContain('NEVER say or imply');
    });

    it('never fetches Instagram posts owned by others as if they were the artist\'s own words in the music signal', async () => {
        const { generateGroundedQuestions, generateContent } = await setup({ geminiText: '[]' });
        await generateGroundedQuestions('a1');
        const call = generateContent.mock.calls[0][0];
        const payload = JSON.parse(call.contents.split('SIGNALS:\n')[1].split('\n\nChoose')[0]);
        const musicSignal = payload.find((c) => c.signalId.startsWith('music_crying'));
        expect(musicSignal.authoredBy).toBe('@dameatlas');
        expect(musicSignal.material).toContain('NOT');
    });
});
