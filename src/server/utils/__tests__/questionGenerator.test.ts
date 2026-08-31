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

    /** Generation calls only. The fact-checker adds a second call per run, and
     *  these assertions are about the cache rather than about how many models a
     *  run talks to. */
    const generations = (mock) => mock.mock.calls.filter(
        c => !String(c[0]?.config?.systemInstruction ?? "").startsWith("You are fact-checking")).length;

    async function setup({ posts = OWN_POSTS, artist = { id: 'a1', name: 'Pete Rango', instagram: 'p3t3rango' }, geminiText, generateContentImpl } = {}) {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getSocialPostsForArtist } = await import('@/server/utils/socialIngest');
        const { getGemini } = await import('@/server/lib/gemini');
        getArtistById.mockResolvedValue(artist);
        getSocialPostsForArtist.mockResolvedValue(posts);
        // Two calls now: the generator, then the fact-checker. Without a
        // verdict for a question it is treated as unverified and dropped, so
        // the default here approves everything and the tests that care about
        // rejection say so explicitly.
        const generateContent = generateContentImpl ?? jest.fn(async (req) =>
            String(req?.config?.systemInstruction ?? "").startsWith("You are fact-checking")
                ? { text: JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ i, ok: true, problem: "" }))) }
                : { text: geminiText ?? '[]' });
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
        // Order-independent: signals are now derived from posts sorted by recency,
        // so evidence comes out newest-first. This test is about the URLs being
        // OUR signal data rather than the model's, not about their order.
        expect([...theme.sourceUrls].sort()).toEqual(
            ['https://www.instagram.com/p/OWN1/', 'https://www.instagram.com/p/OWN1B/'].sort()
        );
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

    // --- per-session cache (onboarding chat turns are stateless — the interview
    // step calls generateGroundedQuestions on every turn it re-enters) ---
    describe('drafting enough to survive the fact-checker', () => {
        /** Answers with the REAL signalIds out of the prompt — the generator
         *  only honours ids it supplied, so invented ones are all dropped. */
        const echoRealSignals = (onAsk, verdictFor) => jest.fn(async (req) => {
            const sys = String(req?.config?.systemInstruction ?? "");
            const contents = String(req?.contents ?? "");
            if (sys.startsWith("You are fact-checking")) {
                const n = (contents.match(/--- QUESTION \d+ ---/g) ?? []).length;
                return { text: JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, ok: verdictFor(i), problem: '' }))) };
            }
            const asked = Number(contents.match(/at most (\d+)/)?.[1] ?? 0);
            const signals = JSON.parse(contents.match(/SIGNALS:\n([\s\S]*?)\n\nChoose/)[1]);
            onAsk(asked, signals.length);
            return { text: JSON.stringify(signals.slice(0, asked).map((sig, i) => ({
                signalId: sig.signalId, question: `Q${i}?`, rationale: 'r',
            }))) };
        });

        it('recovers the yield the fact-checker used to eat', async () => {
            // The checker is strict on purpose — it is what stops "André
            // introduced him to samplers and computers" reaching an artist.
            // Drafting exactly `max` therefore made the YIELD the pass rate:
            // measured on Pete Rango, 299 posts produced three drafts, the
            // checker rejected two, ONE survived, and the interview filled the
            // other two slots with "describe your sound" while hundreds of
            // specific signals sat unused.
            //
            // With the same one-in-three pass rate, drafting only `max` can
            // return at most one. More than one proves the oversample.
            let asked = 0;
            const { generateGroundedQuestions } = await setup({
                generateContentImpl: echoRealSignals((a) => { asked = a; }, i => i % 3 === 0),
            });

            const out = await generateGroundedQuestions('a1', { max: 3 });

            expect(asked).toBeGreaterThan(3);
            expect(out.length).toBeGreaterThan(1);
            expect(out.length).toBeLessThanOrEqual(3);
        });

        it('still returns no more than the caller asked for', async () => {
            // Oversampling is about surviving rejection, not about handing the
            // artist nine questions.
            const { generateGroundedQuestions } = await setup({
                generateContentImpl: echoRealSignals(() => {}, () => true),
            });
            await expect(generateGroundedQuestions('a1', { max: 3 })).resolves.toHaveLength(3);
        });

        it('never asks for more than there are signals to build from', async () => {
            // A thin artist must not be pushed to invent questions.
            let asked = 0, available = 0;
            const { generateGroundedQuestions } = await setup({
                generateContentImpl: echoRealSignals((a, n) => { asked = a; available = n; }, () => true),
            });
            await generateGroundedQuestions('a1', { max: 50 });
            expect(asked).toBeGreaterThan(0);
            expect(asked).toBeLessThanOrEqual(available);
        });
    });

    describe('per-artist TTL cache', () => {
        const geminiText = JSON.stringify([
            { signalId: 'collab_dameatlas', question: 'You and @dameatlas dropped a track together — what\'s the story?', rationale: 'real collab' },
        ]);

        it('a second call for the same artist within the TTL does not re-invoke generation', async () => {
            const { generateGroundedQuestions, generateContent } = await setup({ geminiText });
            const first = await generateGroundedQuestions('a1', { max: 3 });
            const second = await generateGroundedQuestions('a1', { max: 3 });
            expect(generations(generateContent)).toBe(1);
            expect(second).toEqual(first);
        });

        it('a fresh module registry starts with an empty cache — sanity check that jest.resetModules() actually isolates the module-level Map across tests', async () => {
            const { generateGroundedQuestions, generateContent } = await setup({ geminiText });
            await generateGroundedQuestions('a1', { max: 3 });
            expect(generations(generateContent)).toBe(1);
        });

        it('expiry regenerates — a call after the TTL has elapsed invokes generation again', async () => {
            jest.useFakeTimers();
            try {
                const { generateGroundedQuestions, generateContent } = await setup({ geminiText });
                await generateGroundedQuestions('a1', { max: 3 });
                jest.advanceTimersByTime(15 * 60 * 1000 + 1_000); // just past the 15-minute TTL
                await generateGroundedQuestions('a1', { max: 3 });
                expect(generations(generateContent)).toBe(2);
            } finally {
                jest.useRealTimers();
            }
        });

        it('a cache hit never changes which question gets asked — same keys, same order, as the original generation', async () => {
            const multiGeminiText = JSON.stringify([
                { signalId: 'collab_dameatlas', question: 'Q1', rationale: 'x' },
                { signalId: 'theme_hashtag_housemusic', question: 'Q2', rationale: 'x' },
            ]);
            const { generateGroundedQuestions } = await setup({ geminiText: multiGeminiText });
            const first = await generateGroundedQuestions('a1', { max: 3 });
            const second = await generateGroundedQuestions('a1', { max: 3 });
            expect(second.map(q => q.key)).toEqual(first.map(q => q.key));
            expect(second).toEqual(first);
        });

        it('different artists get independent cache entries — a cache hit for one artist does not serve another artist\'s questions', async () => {
            const { generateGroundedQuestions, generateContent, getArtistById } = await setup({ geminiText });
            await generateGroundedQuestions('a1', { max: 3 });
            getArtistById.mockResolvedValue({ id: 'a2', name: 'Other Artist', instagram: 'other' });
            await generateGroundedQuestions('a2', { max: 3 });
            expect(generations(generateContent)).toBe(2);
        });
    });

    describe("scoped to what is new", () => {
        // A returning artist should be asked about what they have done since,
        // not handed the same questions again.

        /** Two posts either side of a cutoff, each with a caption we can look
         *  for in the prompt. */
        const post = (id, caption, postedAt) => ({
            platform: "instagram", platformPostId: id, ownerUsername: "p3t3rango", isOwnPost: true,
            caption, url: `https://www.instagram.com/p/${id}/`, postedAt,
            likeCount: 400, commentCount: 9, playCount: 8000, hashtags: ["housemusic"], mentions: [],
            coauthors: [], musicTitle: null, musicArtist: null,
        });
        const OLD_AND_NEW = [
            post("OLD1", "house been therapy", "2020-04-01T00:00:00.000Z"),
            post("OLD2", "house been therapy again", "2020-05-01T00:00:00.000Z"),
            post("NEW1", "the colombia page is live", "2026-08-20T00:00:00.000Z"),
            post("NEW2", "colombia relief keeps growing", "2026-08-22T00:00:00.000Z"),
        ];

        it("ignores posts older than the cutoff", async () => {
            const { generateGroundedQuestions, generateContent } =
                await setup({ posts: OLD_AND_NEW, geminiText: "[]" });
            await generateGroundedQuestions("a1", { max: 3, since: "2026-06-01T00:00:00.000Z" });

            // The prompt carries derived material rather than raw captions, so
            // the count is the thing that shows the cutoff bit: two posts in
            // the window, not all four.
            const sent = String(generateContent.mock.calls[0][0].contents);
            expect(sent).toContain("appears in 2 of their own posts");
            expect(sent).not.toContain("appears in 4 of their own posts");
        });

        it("scopes the stored statements and credits too, not only the posts", async () => {
            // Filtering only the posts left statement and credit candidates
            // unbounded, so a return interview scoped to the last two months
            // came back asking about a post from 2020 — measured on Pete Rango,
            // where a pandemic reflection surfaced in a window starting six
            // years after it.
            jest.doMock("@/server/utils/queries/socialCreditQueries", () => ({
                getSocialCredits: jest.fn(async () => ({
                    credits: [],
                    statements: [
                        { quote: "the pandemic was a blessing and a curse", topic: "pandemic reflection",
                          url: "https://www.instagram.com/p/OLD1/", postedAt: "2020-04-01T00:00:00.000Z" },
                        { quote: "I made a bilingual page to help", topic: "Colombia relief",
                          url: "https://www.instagram.com/p/NEW1/", postedAt: "2026-08-20T00:00:00.000Z" },
                    ],
                })),
            }));
            const { generateGroundedQuestions, generateContent } =
                await setup({ posts: OLD_AND_NEW, geminiText: "[]" });
            await generateGroundedQuestions("a1", { max: 3, since: "2026-06-01T00:00:00.000Z" });

            const sent = String(generateContent.mock.calls[0][0].contents);
            expect(sent).toContain("bilingual page");
            expect(sent).not.toContain("blessing and a curse");
        });

        it("uses everything when no cutoff is given", async () => {
            const { generateGroundedQuestions, generateContent } =
                await setup({ posts: OLD_AND_NEW, geminiText: "[]" });
            await generateGroundedQuestions("a1", { max: 3 });
            expect(String(generateContent.mock.calls[0][0].contents)).toContain("appears in 4 of their own posts");
        });
    });

    describe("relationships, computed rather than guessed", () => {
        /** Answers generation with `questions`, then the fact-checker with `verdicts`. */
        const twoCalls = (questions, verdicts) => jest.fn(async (req) =>
            String(req?.config?.systemInstruction ?? "").startsWith("You are fact-checking")
                ? { text: typeof verdicts === "function" ? verdicts() : JSON.stringify(verdicts) }
                : { text: JSON.stringify(questions) });

        /** A collaborator credited on two posts, plus a statement sharing one
         *  of them — enough for both relationship kinds. */
        const EXTRACTION = {
            credits: [
                { subject: "p3t3rango", isHandle: true, isSelf: false, role: "Mixed by",
                  quote: "Mixed by @p3t3rango", url: "https://www.instagram.com/p/A/", postedAt: null },
                { subject: "p3t3rango", isHandle: true, isSelf: false, role: "engineered by",
                  quote: "engineered by @p3t3rango", url: "https://www.instagram.com/p/B/", postedAt: null },
            ],
            statements: [
                { quote: "my first single engineered by someone other than myself", topic: "a first",
                  url: "https://www.instagram.com/p/B/", postedAt: null },
                { quote: "a silhouette in flickering light", topic: "what Hourglass means",
                  url: "https://www.instagram.com/p/Z/", postedAt: null },
            ],
        };

        async function withExtraction(opts = {}) {
            jest.doMock("@/server/utils/queries/socialCreditQueries", () => ({
                getSocialCredits: jest.fn(async () => EXTRACTION),
            }));
            return setup(opts);
        }

        const promptFrom = (mock) => String(mock.mock.calls.find(c =>
            !String(c[0]?.config?.systemInstruction ?? "").startsWith("You are fact-checking"))[0].contents);

        it("offers a collaborator credited on more than one post as a relationship", async () => {
            const { generateGroundedQuestions, generateContent } = await withExtraction({ geminiText: "[]" });
            await generateGroundedQuestions("a1");
            const sent = promptFrom(generateContent);
            expect(sent).toContain("partnership_p3t3rango");
            expect(sent).toContain("2 SEPARATE posts");
        });

        it("warns, in the material, against attaching that person to other releases", async () => {
            // The failure this replaces: the model was told Pharaoh credits
            // @p3t3rango and, separately, what "Hourglass & The Flame" sounds
            // like — and wrote that p3t3rango engineered Hourglass. Four
            // different posts, no connection anywhere.
            const { generateGroundedQuestions, generateContent } = await withExtraction({ geminiText: "[]" });
            await generateGroundedQuestions("a1");
            expect(promptFrom(generateContent)).toContain("must not attach");
        });

        it("offers a credit and a statement from the SAME post as one signal", async () => {
            const { generateGroundedQuestions, generateContent } = await withExtraction({ geminiText: "[]" });
            await generateGroundedQuestions("a1");
            const sent = promptFrom(generateContent);
            expect(sent).toContain("same_post_B");
            expect(sent).toContain("IN ONE POST");
            // The statement on post Z has no credit beside it, so it is not a
            // same-post relationship — it is just a statement.
            expect(sent).not.toContain("same_post_Z");
        });

        it("carries only that post as the evidence for a same-post question", async () => {
            const { generateGroundedQuestions } = await withExtraction({
                generateContentImpl: twoCalls(
                    [{ signalId: "same_post_B", question: "You said it was your first — what changed?", rationale: "x" }],
                    [{ i: 0, ok: true, problem: "" }],
                ),
            });
            const [q] = await generateGroundedQuestions("a1");
            expect(q.kind).toBe("same_post");
            expect(q.sourceUrls).toEqual(["https://www.instagram.com/p/B/"]);
        });

        it("ignores an answer that tries to name two signals", async () => {
            // Pairing is gone: a link the model draws between two signals is a
            // guess, and a guess about who worked on what is the one thing an
            // artist notices immediately.
            const { generateGroundedQuestions } = await withExtraction({
                generateContentImpl: twoCalls(
                    [{ signalIds: ["partnership_p3t3rango", "statement_Z_what_hourglass_means"], question: "did p3t3rango engineer Hourglass?", rationale: "x" }],
                    [{ i: 0, ok: true, problem: "" }],
                ),
            });
            await expect(generateGroundedQuestions("a1")).resolves.toEqual([]);
        });

        it("still drops a question the checker says is unsupported", async () => {
            // Single-signal questions can drift too: the material can hold a
            // chain of causes that gets compressed into an agent doing
            // something they never did.
            const { generateGroundedQuestions } = await withExtraction({
                generateContentImpl: twoCalls(
                    [{ signalId: "same_post_B", question: "q", rationale: "x" }],
                    [{ i: 0, ok: false, problem: "introduction to samplers" }],
                ),
            });
            await expect(generateGroundedQuestions("a1")).resolves.toEqual([]);
        });

        it("drops EVERY grounded question when the checker cannot run", async () => {
            // There was no test for this path, which is how a broken guard
            // survived: it claimed to fail closed "asymmetrically" by keeping
            // single-signal questions, and once pairing was removed every draft
            // had exactly one material — so the filter kept all of them. It
            // read as protective and did nothing, which is worse than having
            // none, because it was the reason to feel safe.
            //
            // There is no safe subset. The André sentence compressed a chain of
            // causes inside a SINGLE caption; single-signal questions were
            // never immune, only untouched so far.
            const { generateGroundedQuestions } = await withExtraction({
                generateContentImpl: twoCalls(
                    [{ signalId: "same_post_B", question: "a question", rationale: "x" }],
                    () => { throw new Error("checker down"); },
                ),
            });
            await expect(generateGroundedQuestions("a1")).resolves.toEqual([]);
        });

        it("drops everything when the checker answers with nonsense", async () => {
            const { generateGroundedQuestions } = await withExtraction({
                generateContentImpl: twoCalls(
                    [{ signalId: "same_post_B", question: "a question", rationale: "x" }],
                    () => "not json at all",
                ),
            });
            await expect(generateGroundedQuestions("a1")).resolves.toEqual([]);
        });

        it("gives two collaborators with non-Latin names distinct keys", async () => {
            // `slug` is ASCII-only and reduces both to "x", so they would share
            // a signalId — byId keeps only the last, and their answers overwrite
            // each other under the unique (artist, questionKey) index.
            jest.doMock("@/server/utils/queries/socialCreditQueries", () => ({
                getSocialCredits: jest.fn(async () => ({
                    statements: [],
                    credits: [
                        { subject: "사랑", isHandle: false, isSelf: false, role: "mixed", quote: "q", url: "https://insta/p/A/", postedAt: null },
                        { subject: "사랑", isHandle: false, isSelf: false, role: "mixed", quote: "q", url: "https://insta/p/B/", postedAt: null },
                        { subject: "恋", isHandle: false, isSelf: false, role: "played", quote: "q", url: "https://insta/p/C/", postedAt: null },
                        { subject: "恋", isHandle: false, isSelf: false, role: "played", quote: "q", url: "https://insta/p/D/", postedAt: null },
                    ],
                })),
            }));
            const { generateGroundedQuestions, generateContent } = await setup({ geminiText: "[]" });
            await generateGroundedQuestions("a1");
            const sent = promptFrom(generateContent);
            const ids = [...sent.matchAll(/"signalId": "(partnership_[^"]+)"/g)].map(m => m[1]);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it("treats a question with no verdict as unverified, not approved", async () => {
            const { generateGroundedQuestions } = await withExtraction({
                generateContentImpl: twoCalls([{ signalId: "same_post_B", question: "q", rationale: "x" }], []),
            });
            await expect(generateGroundedQuestions("a1")).resolves.toEqual([]);
        });
    });
});
