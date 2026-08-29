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
const recordInterviewOffered = jest.fn();
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
    recordInterviewOffered: (...a) => recordInterviewOffered(...a),
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

const answered = (key, at) => ({ questionKey: key, question: 'q', answer: 'a', createdAt: at, source: 'followup' });
/** A question put to them that they have not dealt with — the boundary of a
 *  sitting, and the only thing that can tell an abandoned one from a finished
 *  one. A lifetime row count cannot: after a completed first sitting, one
 *  answer into a second gives four rows, which is not "fewer than a set". */
const stillOpen = (key) => ({ questionKey: key, question: 'q', answer: null, createdAt: '2026-08-25T00:00:00Z', source: 'offered' });
/** A COMPLETED sitting. Fewer rows than this means they started and stopped,
 *  and the remaining questions are still owed — the new-material gate does not
 *  apply until a full set has been dealt with, one way or another. Dismissing
 *  the card writes a skip row for every question offered, so an artist only
 *  lingers below three by closing the browser mid-sitting. */
const aFullSitting = (at) => [
    answered('social_credit_1', at), answered('social_credit_2', at), answered('social_credit_3', at),
];

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
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-07-01T00:00:00Z' }]);
        expect((await invite()).show).toBe(false);
    });

    it('comes back when a new post has landed', async () => {
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-08-20T00:00:00Z' }]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_theme_9', question: 'What was that show?' }]);

        const out = await invite();
        expect(out.show).toBe(true);
        expect(out.reason).toBe('new-material');
        // Scoped to what is new, so the questions are about it.
        expect(generateGroundedQuestions).toHaveBeenCalledWith('a1', { max: 3, since: '2026-08-01T00:00:00Z' });
    });

    it('comes back when a record has appeared', async () => {
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: 'SPOT1' });
        getSpotifyCatalogDetail.mockResolvedValue([{ name: 'rush', releaseDate: '2026-08-15' }]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_music_2', question: 'Tell me about rush.' }]);
        expect((await invite()).show).toBe(true);
    });

    it('will not pad a return visit with the generic bank', async () => {
        // Coming back with "what got you started?" when they have just released
        // a record is the generic re-ask this whole design exists to avoid.
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-08-20T00:00:00Z' }]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_theme_9', question: 'What was that show?' }]);

        const out = await invite();
        expect(out.questions).toHaveLength(1);
    });

    it('never re-asks something already answered or skipped', async () => {
        getInterviewAnswers.mockResolvedValue([
            ...aFullSitting('2026-08-01T00:00:00Z'),
            { questionKey: 'social_theme_9', question: 'q', answer: null, createdAt: '2026-08-01T00:00:00Z' },
        ]);
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
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-08-20T00:00:00Z' }]);
        generateGroundedQuestions.mockResolvedValue([]);
        expect((await invite()).show).toBe(false);
    });

    it('lets an abandoned sitting be finished, without waiting for new material', async () => {
        // Answering one question and closing the tab made `since` truthy, and
        // the new-material gate then hid the other two until the artist
        // happened to post something. The sitting could never be resumed.
        getInterviewAnswers.mockResolvedValue([
            answered('social_credit_1', '2026-08-01T00:00:00Z'),
            stillOpen('social_credit_2'),
        ]);
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-07-01T00:00:00Z' }]);  // nothing new
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_credit_2', question: 'the next one' }]);

        const out = await invite();
        expect(out.show).toBe(true);
        // Unscoped, because this is still the first sitting rather than a return.
        expect(generateGroundedQuestions).toHaveBeenCalledWith('a1', { max: 3, since: null });
    });

    it('asks about a record even when nothing was posted about it', async () => {
        // Releases trigger the invite, but the generator reads captions — so an
        // artist who put out a record and said nothing on Instagram produced no
        // questions and the invite was suppressed. The release trigger did
        // nothing, silently.
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getSocialPostsForArtist.mockResolvedValue([]);
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: 'SPOT1' });
        getSpotifyCatalogDetail.mockResolvedValue([{ name: 'rush', releaseDate: '2026-08-20' }]);
        generateGroundedQuestions.mockResolvedValue([]);

        const out = await invite();
        expect(out.show).toBe(true);
        expect(out.questions[0].question).toContain('"rush"');
    });

    it('truncates an oversized answer rather than storing it', async () => {
        // A server action is a public endpoint and the textarea's maxLength is
        // a suggestion. An unbounded answer goes straight into the ask prompt
        // and the document build.
        upsertInterviewAnswer.mockClear();
        const { answerInterviewQuestion } = await import('../interviewActions');
        await answerInterviewQuestion({
            artistId: 'a1', questionKey: 'k', question: 'q', answer: 'x'.repeat(9000),
        });
        expect(upsertInterviewAnswer.mock.calls[0][0].answer).toHaveLength(2000);
    });

    it('records a dismissal, so the same three do not come back next visit', async () => {
        upsertInterviewAnswer.mockClear();
        const { declineInterview } = await import('../interviewActions');
        await declineInterview('a1', [
            { key: 'k1', question: 'one' },
            { key: 'k2', question: 'two' },
        ]);
        expect(upsertInterviewAnswer).toHaveBeenCalledTimes(2);
        // Written as skips — the same shape skipping one inside the panel uses.
        expect(upsertInterviewAnswer.mock.calls[0][0]).toMatchObject({ questionKey: 'k1', answer: null });
    });

    it('resumes an abandoned SECOND sitting, which a row count cannot see', async () => {
        // After a completed first sitting, one answer into a later one gives
        // four rows — not "fewer than a set" — so the gate hid the rest of that
        // offer for good. The open row is the boundary.
        getInterviewAnswers.mockResolvedValue([
            ...aFullSitting('2026-08-01T00:00:00Z'),
            answered('social_theme_9', '2026-08-25T00:00:00Z'),
            stillOpen('social_theme_10'),
        ]);
        getSocialPostsForArtist.mockResolvedValue([]);          // nothing newer
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_theme_10', question: 'the one they did not reach' }]);

        const out = await invite();
        expect(out.show).toBe(true);
        expect(generateGroundedQuestions).toHaveBeenCalledWith('a1', { max: 3, since: null });
    });

    it('does not treat an open offer as an answer', async () => {
        // An offered row means "we asked, they have not said" — re-offering it
        // is the point, so it must not land in answeredKeys.
        getInterviewAnswers.mockResolvedValue([stillOpen('social_theme_10')]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_theme_10', question: 'ask me again' }]);
        const out = await invite();
        expect(out.questions.map(q => q.key)).toContain('social_theme_10');
    });

    it('gives two non-Latin releases distinct keys', async () => {
        // [^a-z0-9] reduces a Korean or Japanese title to nothing, so every
        // such release collapsed onto one key — and (artist, questionKey) is
        // unique, so the second answer would have overwritten the first and
        // silently destroyed what the artist wrote.
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getSocialPostsForArtist.mockResolvedValue([]);
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: 'SPOT1' });
        getSpotifyCatalogDetail.mockResolvedValue([
            { name: '사랑', releaseDate: '2026-08-20' },
            { name: '恋', releaseDate: '2026-08-22' },
        ]);
        generateGroundedQuestions.mockResolvedValue([]);

        const out = await invite();
        const keys = out.questions.map(q => q.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('records an opened offer without a read-then-write that could clobber an answer', async () => {
        // The upsert version read the existing rows and then wrote nulls, so an
        // answer typed in the moment between those two steps was overwritten
        // with answer: null — losing what the artist had just written, on the
        // one screen where the words are theirs. Insert-only removes the race
        // rather than narrowing it.
        recordInterviewOffered.mockClear();
        upsertInterviewAnswer.mockClear();
        const { markInterviewOffered } = await import('../interviewActions');
        await markInterviewOffered('a1', [{ key: 'k1', question: 'one' }, { key: 'k2', question: 'two' }]);

        expect(recordInterviewOffered).toHaveBeenCalledTimes(2);
        expect(upsertInterviewAnswer).not.toHaveBeenCalled();
        expect(recordInterviewOffered.mock.calls[0][0]).toMatchObject({ questionKey: 'k1' });
    });

    it('stops rather than guessing when the answer history cannot be read', async () => {
        // Returning [] on a failure said "they have answered nothing", so a
        // database blip would offer a first sitting to somebody who had already
        // done one and re-ask everything they had answered.
        getInterviewAnswers.mockResolvedValue(null);
        expect((await invite()).show).toBe(false);
    });

    it('resumes the questions that are actually outstanding, not regenerated guesses', async () => {
        // An open row whose key the model stops choosing is orphaned forever,
        // and an orphaned open row keeps every later invite unscoped and
        // labelled a first interview.
        getInterviewAnswers.mockResolvedValue([
            ...aFullSitting('2026-08-01T00:00:00Z'),
            { questionKey: 'social_theme_7', question: 'the one still open', answer: null,
              createdAt: '2026-08-25T00:00:00Z', source: 'offered' },
        ]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'something_else', question: 'a different one' }]);

        const out = await invite();
        expect(out.questions[0]).toEqual({ key: 'social_theme_7', question: 'the one still open' });
    });
});
