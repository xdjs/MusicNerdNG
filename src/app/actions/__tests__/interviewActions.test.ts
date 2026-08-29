// @ts-nocheck
/**
 * When we ask, and when we shut up.
 *
 * The rule Pete set: it comes back when they come back, and only when there is
 * something new to ask about. That makes a decline non-permanent without making
 * it a nag — there is nothing to return with until the artist has done
 * something.
 */
import { jest } from '@jest/globals';

const canEditArtist = jest.fn();
const getInterviewAnswers = jest.fn();
const upsertInterviewAnswer = jest.fn();
const generateGroundedQuestions = jest.fn();
const getSocialPostsForArtist = jest.fn();
const getArtistById = jest.fn();
const getSpotifyCatalogDetail = jest.fn();

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn(async () => ({ user: { id: 'u1' } })) }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn(async () => null) }));
jest.mock('@/server/utils/artistEditAuth', () => ({ canEditArtist: (...a) => canEditArtist(...a) }));
jest.mock('@/server/utils/queries/onboardingQueries', () => ({
    getInterviewAnswers: (...a) => getInterviewAnswers(...a),
    upsertInterviewAnswer: (...a) => upsertInterviewAnswer(...a),
}));
jest.mock('@/server/utils/questionGenerator', () => ({
    generateGroundedQuestions: (...a) => generateGroundedQuestions(...a),
}));
jest.mock('@/server/utils/socialIngest', () => ({
    getSocialPostsForArtist: (...a) => getSocialPostsForArtist(...a),
}));
jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: (...a) => getArtistById(...a) }));
jest.mock('@/server/utils/queries/externalApiQueries', () => ({
    getSpotifyHeaders: jest.fn(async () => ({})),
    getSpotifyCatalogDetail: (...a) => getSpotifyCatalogDetail(...a),
}));

const answered = (key, at) => ({ questionKey: key, question: 'q', answer: 'a', createdAt: at });

async function invite() {
    const { getInterviewInvite } = await import('../interviewActions');
    return getInterviewInvite('a1');
}

describe('getInterviewInvite', () => {
    beforeEach(() => {
        jest.resetModules();
        for (const m of [canEditArtist, getInterviewAnswers, generateGroundedQuestions, getSocialPostsForArtist, getArtistById, getSpotifyCatalogDetail]) m.mockReset();
        canEditArtist.mockResolvedValue(true);
        getSocialPostsForArtist.mockResolvedValue([]);
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: null });
        getSpotifyCatalogDetail.mockResolvedValue([]);
        generateGroundedQuestions.mockResolvedValue([]);
    });

    it('offers a first interview when nothing has ever been answered', async () => {
        getInterviewAnswers.mockResolvedValue([]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_credit_1', question: 'Who mixed it?' }]);
        const out = await invite();
        expect(out.show).toBe(true);
        expect(out.reason).toBe('first');
        // Grounded first, then the static bank fills the sitting out to three.
        expect(out.questions).toHaveLength(3);
        expect(out.questions[0].question).toBe('Who mixed it?');
    });

    it('stays quiet when they have answered and nothing has happened since', async () => {
        getInterviewAnswers.mockResolvedValue([answered('social_credit_1', '2026-08-01T00:00:00Z')]);
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-07-01T00:00:00Z' }]);
        expect((await invite()).show).toBe(false);
    });

    it('comes back when a new post has landed', async () => {
        getInterviewAnswers.mockResolvedValue([answered('social_credit_1', '2026-08-01T00:00:00Z')]);
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-08-20T00:00:00Z' }]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_theme_9', question: 'What was that show?' }]);

        const out = await invite();
        expect(out.show).toBe(true);
        expect(out.reason).toBe('new-material');
        // Scoped to what is new, so the questions are about it.
        expect(generateGroundedQuestions).toHaveBeenCalledWith('a1', { max: 3, since: '2026-08-01T00:00:00Z' });
    });

    it('comes back when a record has appeared', async () => {
        getInterviewAnswers.mockResolvedValue([answered('social_credit_1', '2026-08-01T00:00:00Z')]);
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: 'SPOT1' });
        getSpotifyCatalogDetail.mockResolvedValue([{ name: 'rush', releaseDate: '2026-08-15' }]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_music_2', question: 'Tell me about rush.' }]);
        expect((await invite()).show).toBe(true);
    });

    it('will not pad a return visit with the generic bank', async () => {
        // Coming back with "what got you started?" when they have just released
        // a record is the generic re-ask this whole design exists to avoid.
        getInterviewAnswers.mockResolvedValue([answered('social_credit_1', '2026-08-01T00:00:00Z')]);
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-08-20T00:00:00Z' }]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_theme_9', question: 'What was that show?' }]);

        const out = await invite();
        expect(out.questions).toHaveLength(1);
    });

    it('never re-asks something already answered or skipped', async () => {
        getInterviewAnswers.mockResolvedValue([{ questionKey: 'social_theme_9', question: 'q', answer: null, createdAt: '2026-08-01T00:00:00Z' }]);
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-08-20T00:00:00Z' }]);
        generateGroundedQuestions.mockResolvedValue([
            { key: 'social_theme_9', question: 'the skipped one' },
            { key: 'social_music_2', question: 'a new one' },
        ]);
        const out = await invite();
        expect(out.questions.map(q => q.key)).toEqual(['social_music_2']);
    });

    it('says nothing to somebody who does not own the page', async () => {
        canEditArtist.mockResolvedValue(false);
        expect((await invite()).show).toBe(false);
        expect(getInterviewAnswers).not.toHaveBeenCalled();
    });

    it('stays quiet rather than showing an empty interview', async () => {
        getInterviewAnswers.mockResolvedValue([answered('social_credit_1', '2026-08-01T00:00:00Z')]);
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-08-20T00:00:00Z' }]);
        generateGroundedQuestions.mockResolvedValue([]);
        expect((await invite()).show).toBe(false);
    });
});
