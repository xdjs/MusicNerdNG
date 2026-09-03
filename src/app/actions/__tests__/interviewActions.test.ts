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
const hasPostsScrapedSince = jest.fn();
const hasCreditsSince = jest.fn();
const isResearchInFlight = jest.fn();

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn(async () => ({ user: { id: 'u1' } })) }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn(async () => null) }));
jest.mock('@/server/utils/artistEditAuth', () => ({ canEditArtist: (...a) => canEditArtist(...a) }));
jest.mock('@/server/utils/queries/onboardingQueries', () => ({
    getInterviewAnswers: (...a) => getInterviewAnswers(...a),
    upsertInterviewAnswer: (...a) => upsertInterviewAnswer(...a),
    recordInterviewOffered: (...a) => recordInterviewOffered(...a),
}));
// Both exports. Mocking only `generateGroundedQuestions` left
// `sourceUrlForQuestionKey` undefined, and calling it threw inside
// getInterviewInvite's try — which returns { show: false }, so every resume
// test failed with "questions is undefined" rather than anything about links.
// The BATCHED resolver — resolving per question re-read the artist's whole
// post history for each one, on a path that runs on every page load with an
// open sitting.
const sourceUrlsForQuestionKeys = jest.fn(async (_artistId, keys) =>
    new Map(keys.filter(k => k.startsWith('social_'))
                .map(k => [k, `https://www.instagram.com/p/${k}/`])));
jest.mock('@/server/utils/questionGenerator', () => ({
    generateGroundedQuestions: (...a) => generateGroundedQuestions(...a),
    sourceUrlsForQuestionKeys: (...a) => sourceUrlsForQuestionKeys(...a),
}));
jest.mock('@/server/utils/socialIngest', () => ({
    getSocialPostsForArtist: (...a) => getSocialPostsForArtist(...a),
    hasPostsScrapedSince: (...a) => hasPostsScrapedSince(...a),
}));
jest.mock('@/server/utils/queries/socialCreditQueries', () => ({
    hasCreditsSince: (...a) => hasCreditsSince(...a),
}));
jest.mock('@/server/utils/queries/researchJobQueries', () => ({
    isResearchInFlight: (...a) => isResearchInFlight(...a),
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
        for (const m of [canEditArtist, getInterviewAnswers, generateGroundedQuestions, getSocialPostsForArtist, getArtistById, getSpotifyCatalogDetail, hasPostsScrapedSince, hasCreditsSince, isResearchInFlight]) m.mockReset();
        hasPostsScrapedSince.mockResolvedValue(false);
        hasCreditsSince.mockResolvedValue(false);
        isResearchInFlight.mockResolvedValue(false);
        canEditArtist.mockResolvedValue(true);
        getSocialPostsForArtist.mockResolvedValue([]);
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: null });
        getSpotifyCatalogDetail.mockResolvedValue([]);
        generateGroundedQuestions.mockResolvedValue([]);
    });

    it('offers a first interview when nothing has ever been answered', async () => {
        getInterviewAnswers.mockResolvedValue([]);
        generateGroundedQuestions.mockResolvedValue([{
            key: 'social_credit_1', question: 'Who mixed it?',
            sourceUrls: ['https://www.instagram.com/p/ABC/'],
        }]);
        const out = await invite();
        expect(out.show).toBe(true);
        expect(out.reason).toBe('first');
        // Grounded first, then the static bank fills the sitting out to three.
        expect(out.questions).toHaveLength(3);
        expect(out.questions[0].question).toBe('Who mixed it?');
        // THE POST TRAVELS WITH THE QUESTION. The generator always produced
        // sourceUrls and this type dropped them, so the panel had no way to
        // show the artist where a question came from. Pete, reading his own:
        // "I may not remember at that moment."
        expect(out.questions[0].sourceUrl).toBe('https://www.instagram.com/p/ABC/');
        // The static bank has no post behind it, and must not pretend to.
        expect(out.questions[1].sourceUrl).toBeUndefined();
    });

    // ── The production failure of 2026-09-03 ──────────────────────────────
    // Pete Rango's questions were written at 13:18:08 and his caption
    // extraction was queued at 13:19:16. With nothing extracted yet the static
    // bank filled all three slots, those rows persisted, and the new-material
    // gate then locked him out of the 187 credits extraction went on to find.
    // Tom Vek's ran two minutes after his extraction and read fine. Nothing
    // differed but timing.

    it('does not ask while caption extraction is still running', async () => {
        getInterviewAnswers.mockResolvedValue([]);
        isResearchInFlight.mockResolvedValue(true);
        generateGroundedQuestions.mockResolvedValue([]);

        const out = await invite();
        expect(out.show).toBe(false);
        // AND DOES NOT GENERATE. Returning show:false is not enough — the harm
        // is the static rows persisting under (artist_id, question_key).
        expect(generateGroundedQuestions).not.toHaveBeenCalled();
    });

    it('resumes an open sitting while extraction runs, without topping it up', async () => {
        // Resuming is safe: the question exists and so does what it was built
        // on. Topping it up is not — it would draw static fillers from
        // incomplete material and persist them, which is the lockout itself.
        getInterviewAnswers.mockResolvedValue([stillOpen('social_credit_7')]);
        isResearchInFlight.mockResolvedValue(true);

        const out = await invite();
        expect(out.show).toBe(true);
        expect(out.questions).toHaveLength(1);
        expect(out.questions[0].key).toBe('social_credit_7');
        expect(generateGroundedQuestions).not.toHaveBeenCalled();
    });

    it('comes back when posts were SCRAPED since, though published long before', async () => {
        // The whole feed of a first-time artist: published months ago, stored
        // minutes ago. By publication date there is nothing new; to us it is
        // all new. Asking by postedAt answered the wrong question.
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2025-01-01T00:00:00Z' }]);
        hasPostsScrapedSince.mockResolvedValue(true);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_credit_9', question: 'Who played on it?' }]);

        const out = await invite();
        expect(out.show).toBe(true);
        expect(out.reason).toBe('new-material');
    });

    it('generates UNSCOPED when the new material is something we learned', async () => {
        // The third layer. `newerThan` in the generator filters posts, credits
        // and statements by postedAt, so passing `since` here would generate
        // from an empty set and fall through to the static bank — the same
        // failure one level down. What we learned has no publication date to
        // scope to; excludeKeys is what prevents repeats.
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-09-03T13:18:13Z'));
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2025-01-01T00:00:00Z' }]);
        hasCreditsSince.mockResolvedValue(true);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_credit_x', question: 'Who engineered it?' }]);

        const out = await invite();
        expect(out.show).toBe(true);
        expect(generateGroundedQuestions.mock.calls[0][1].since).toBeNull();
    });

    it('still scopes to the window when the artist PUBLISHED something new', async () => {
        // The date means something here: ask about the new thing, not the feed.
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2026-08-20T00:00:00Z' }]);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_theme_2', question: 'What was that show?' }]);

        const out = await invite();
        expect(out.show).toBe(true);
        expect(generateGroundedQuestions.mock.calls[0][1].since).toBe('2026-08-01T00:00:00Z');
    });

    it('comes back when credits were extracted since, with no newer post at all', async () => {
        // Extraction finishes minutes after the posts land. An artist whose
        // sitting closed in that window has no newer post to point at and 187
        // credits we did not have before.
        getInterviewAnswers.mockResolvedValue(aFullSitting('2026-08-01T00:00:00Z'));
        getSocialPostsForArtist.mockResolvedValue([{ postedAt: '2025-01-01T00:00:00Z' }]);
        hasPostsScrapedSince.mockResolvedValue(false);
        hasCreditsSince.mockResolvedValue(true);
        generateGroundedQuestions.mockResolvedValue([{ key: 'social_statement_3', question: 'What made it difficult?' }]);

        expect((await invite()).show).toBe(true);
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
        // `excludeKeys` is what stops a returning artist being asked the same
        // things again: the answered keys leave the candidate POOL rather than
        // being filtered out of the result after the model has already spent
        // its picks on them.
        expect(generateGroundedQuestions).toHaveBeenCalledWith('a1',
            expect.objectContaining({ max: 3, since: '2026-08-01T00:00:00Z', excludeKeys: expect.any(Set) }));
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
        expect(generateGroundedQuestions).toHaveBeenCalledWith('a1',
            expect.objectContaining({ max: 3, since: null, excludeKeys: expect.any(Set) }));
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
        expect(generateGroundedQuestions).toHaveBeenCalledWith('a1',
            expect.objectContaining({ max: 3, since: null, excludeKeys: expect.any(Set) }));
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
        expect(out.questions[0]).toEqual({
            key: 'social_theme_7',
            question: 'the one still open',
            // A resumed question carries its post too, recovered from the key.
            sourceUrl: 'https://www.instagram.com/p/social_theme_7/',
        });
    });
});
