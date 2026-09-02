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
    describe('boilerplateReason — rules the prompt asked for and the model ignored', () => {
        it.each([
            "Across 22 posts, you've credited @bycherele for creative direction; what changed?",
            "You've credited @zavodskyalan as your main production partner across 23 posts; what next?",
            "You've credited @lemieu_x on 12 posts; what stuck?",
            "You've mentioned them across many posts; what shifted?",
        ])('rejects a question that counts how often something appears: %s', async (q) => {
            // Every question in a real run on Pete Rango's feed opened with a
            // post count. It is the sentence an analytics dashboard writes —
            // a person who read the feed says "your main production partner",
            // because that is what the artist called them. The counts are in
            // the material to help CHOOSE, never to be repeated back.
            const { boilerplateReason } = await import('@/server/utils/questionGenerator');
            expect(boilerplateReason(q)).toMatch(/counts/);
        });

        it.each([
            "You've credited @x for direction; what's a specific moment where their input shaped a project?",
            "What's one specific detail they brought to the mix?",
            "Can you name a particular instance where that mattered?",
        ])('rejects a question that hands the artist the job of being specific: %s', async (q) => {
            // "Tell me about" with a coat on: it describes a subject and then
            // asks the artist to supply the specificity, which was the
            // interviewer's job.
            const { boilerplateReason } = await import('@/server/utils/questionGenerator');
            expect(boilerplateReason(q)).toMatch(/specificity/);
        });

        it.each([
            "What was the process like for that track to be selected?",
            "What was that experience like?",
        ])('rejects it one way or another — these trip the abstraction rule first: %s', async (q) => {
            // "process" and "experience" are banned outright, so these are
            // caught before the like-family check. Which rule fires is not the
            // point; that it is refused is.
            const { boilerplateReason } = await import('@/server/utils/questionGenerator');
            expect(boilerplateReason(q)).not.toBeNull();
        });

        it.each([
            "what was it like working with them?",
            "What was that first night like?",
        ])('rejects the what-was-it-like family with no abstraction to catch it: %s', async (q) => {
            // The instruction bans "what was that like" by name; the model
            // reaches for it anyway with a noun wedged in ("what was the
            // PROCESS like"). It is the emptiest question available — it asks
            // the artist to work out what was being asked.
            const { boilerplateReason } = await import('@/server/utils/questionGenerator');
            expect(boilerplateReason(q)).toMatch(/what something was like/);
        });

        it.each([
            "what does an artist actually get that they didn't have before?",
            "what did she want that you argued with?",
            "What was the first thing you changed after he handed you those albums?",
            "What did the label want that you would not give them?",
            "You wrote that the pandemic was a blessing and a curse; who told you to slow down?",
            "Alan's 808s for that outro were lost — did you try to rebuild them, or was leaving it the point?",
            "You called @lemieu_x your mixer; which of their calls did you argue with?",
        ])('keeps a question that names something real: %s', async (q) => {
            const { boilerplateReason } = await import('@/server/utils/questionGenerator');
            expect(boilerplateReason(q)).toBeNull();
        });
    });

    describe('slug — fixes non-Latin collisions without moving any existing key', () => {
        /** The pattern `slug` replaced, so the test compares against the thing
         *  that actually generated the stored keys rather than a paraphrase. */
        const previous = (x) => x.toLowerCase().normalize('NFKD')
            .replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x';

        it.each([
            'cool__guy', 'cool._guy', 'the_.kid', 'self-love_journey', '_kingkona',
            'crittie_p', 'sage.breath', 'why he believes in Subvert',
            'crying on the floor (pete rango mix)', 'Beyoncé', 'a_b',
        ])('produces the identical key for ASCII input: %s', async (input) => {
            // The key is persisted as questionKey under a unique (artist,
            // questionKey) index, so a changed key silently orphans the answer
            // stored under the old one and the interview re-asks it.
            //
            // My first version dropped "_" from the character class, which
            // collapsed "cool__guy" to "cool_guy" — and I verified byte
            // identity only against the strings we happen to hold, which is not
            // the same as verifying the rule. Found in review.
            const { slugForTest } = await import('@/server/utils/questionGenerator');
            expect(slugForTest(input)).toBe(previous(input));
        });

        it.each(['日本のアーティスト', '김민준', 'Пётр'])(
            'stops folding %s to "x", which collided two artists onto one key', async (input) => {
                const { slugForTest } = await import('@/server/utils/questionGenerator');
                expect(previous(input)).toBe('x');          // the bug
                expect(slugForTest(input)).not.toBe('x');   // the fix
            });
    });

    describe('rankStatements — 268 of them, and the same four forever', () => {
        const st = (over) => ({ quote: 'a statement about something', topic: 't', url: 'https://p/1', postedAt: '2026-01-01', ...over });
        const rank = async () => (await import('@/server/utils/questionGenerator')).rankStatements;

        it('drops a statement whose quote repeats one already kept', async () => {
            // 88 of Pete Rango's 268 repeat a quote already stored — the
            // extractor re-topics one sentence several ways ("discovery of web3
            // and its impact" / "...and its impact on art"). Keyed on the
            // OPENING, because the copies differ only in where they were cut.
            const out = await (await rank())([
                st({ quote: 'I discovered web3 and it changed how I think about art entirely', topic: 'a' }),
                st({ quote: 'I discovered web3 and it changed how I think about art', topic: 'b', url: 'https://p/2' }),
            ]);
            expect(out).toHaveLength(1);
        });

        it('lets no single caption own the window', async () => {
            // One of his posts produced TWELVE statements and would have taken
            // the whole slice on its own, crowding out 114 other posts.
            const many = Array.from({ length: 12 }, (_, i) =>
                st({ quote: `distinct sentence number ${i} about the record`, topic: `t${i}` }));
            expect(await (await rank())(many)).toHaveLength(2);
        });

        it('puts a statement that names somebody ahead of one that does not', async () => {
            // Naming a person is what turns "his philosophy on self" into "why
            // he chose SuperCollector" — a decision only the artist can explain.
            const out = await (await rank())([
                st({ quote: 'some thoughts about music in general', topic: 'vague', url: 'https://p/1' }),
                st({ quote: 'I cut this with @zavodskyalan in one night', topic: 'named', url: 'https://p/2' }),
            ]);
            expect(out[0].topic).toBe('named');
        });

        it('prefers a substantial statement over a throwaway, and newest breaks a tie', async () => {
            const long = 'x'.repeat(400);
            const out = await (await rank())([
                st({ quote: 'short one', topic: 'short', url: 'https://p/1', postedAt: '2020-01-01' }),
                st({ quote: long, topic: 'long', url: 'https://p/2', postedAt: '2019-01-01' }),
                st({ quote: 'also short', topic: 'newer-short', url: 'https://p/3', postedAt: '2026-01-01' }),
            ]);
            expect(out[0].topic).toBe('long');
            expect(out[1].topic).toBe('newer-short');   // tie on score, newest first
        });

        it('does not rank by recency alone, which clusters on one event', async () => {
            // Recency was one of the four candidates measured on Pete's feed and
            // was rejected on the evidence: it returned four near-identical
            // statements about the same recent bereavement.
            const out = await (await rank())([
                st({ quote: 'recent thought one', topic: 'recentA', url: 'https://p/1', postedAt: '2026-05-10' }),
                st({ quote: 'older but I made this with @someone specific', topic: 'named-old', url: 'https://p/2', postedAt: '2020-01-01' }),
            ]);
            expect(out[0].topic).toBe('named-old');
        });
    });

    describe('sourceUrlForQuestionKey — a resumed question keeps its post', () => {
        const resolve = async () => (await import('@/server/utils/questionGenerator')).sourceUrlForQuestionKey;

        /** `target` plus a run of ordinary posts, so it can actually stand out —
         *  a standout is measured against the artist's own typical engagement,
         *  and one post has no baseline to beat. */
        const withPosts = (target) => {
            const post = (url, i, plays) => ({
                platform: 'instagram', platformPostId: `s${i}`, ownerUsername: 'p3t3rango', isOwnPost: true,
                caption: 'a caption', url, postedAt: `2026-01-${String(i + 1).padStart(2, '0')}`,
                likeCount: Math.round(plays / 10), commentCount: 1, playCount: plays,
                hashtags: [], mentions: [], coauthors: [], musicTitle: null, musicArtist: null,
            });
            jest.doMock('@/server/utils/socialIngest', () => ({
                getSocialPostsForArtist: jest.fn(async () => [
                    post(target, 0, 200_000),
                    ...Array.from({ length: 8 }, (_, i) =>
                        post(`https://www.instagram.com/p/ORD${i}/`, i + 1, 1_000)),
                ]),
            }));
        };

        it.each([
            // Real shortcodes from this database — 29 of 267 contain an
            // underscore, 26 contain a dash.
            ['https://www.instagram.com/p/DYKorIdloLG/'],
            ['https://www.instagram.com/p/B-M1HpNgeEO/'],
            ['https://www.instagram.com/p/Czb_V_lxFMA/'],
            ['https://www.instagram.com/p/C_jaGxfuXrD/'],
        ])('resolves a standout key back to %s', async (url) => {
            const artistQ = await import('@/server/utils/queries/artistQueries');
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', instagram: 'p3t3rango' });
            withPosts(url);
            const { sourceUrlForQuestionKey, slugForTest } = await import('@/server/utils/questionGenerator');
            void slugForTest;
            const code = url.match(/\/p\/([^/]+)/)[1];
            expect(await sourceUrlForQuestionKey('a1', `social_standout_${code}`)).toBe(url);
        });

        it('never invents a url for a post that is not /p/<code>/', async () => {
            // The key is built by `shortCodeFromUrl`, which falls back to
            // slugging the WHOLE url for anything that is not already
            // /p/<code>/ — a Reel, for instance. Rebuilding
            // `instagram.com/p/<tail>/` from that produced
            // instagram.com/p/https_www_instagram_com_reel_abc/ and the panel
            // would have offered the artist that as "see the post this came
            // from". All 359 stored posts are /p/ today, so this was latent;
            // assuming the input shape rather than checking it is the mistake.
            const reel = 'https://www.instagram.com/reel/DYFjIRabjS/';
            const artistQ = await import('@/server/utils/queries/artistQueries');
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', instagram: 'p3t3rango' });
            withPosts(reel);
            const { sourceUrlForQuestionKey } = await import('@/server/utils/questionGenerator');
            const got = await sourceUrlForQuestionKey('a1', 'social_standout_https_www_instagram_com_reel_dyfjirabjs');
            // Either the real reel url, or nothing — never a fabricated /p/ one.
            expect(got === undefined || got === reel).toBe(true);
            expect(got).not.toMatch(/\/p\/https/);
        });

        it('resolves a STATEMENT key by rebuilding it, because a shortcode can contain underscores', async () => {
            // `social_statement_<shortcode>_<topic>` — both halves can contain
            // "_", so no regex can split it. A non-greedy match turned the real
            // shortcode "Czb_V_lxFMA" into "Czb" and would have sent the artist
            // to instagram.com/p/Czb/. 29 of 267 shortcodes here are that shape.
            jest.doMock('@/server/utils/queries/socialCreditQueries', () => ({
                getSocialCredits: jest.fn(async () => ({
                    credits: [],
                    statements: [
                        { quote: 'q', topic: 'meaning of IOI', url: 'https://www.instagram.com/p/Czb_V_lxFMA/', postedAt: null },
                    ],
                })),
            }));
            const { sourceUrlForQuestionKey } = await import('@/server/utils/questionGenerator');
            expect(await sourceUrlForQuestionKey('a1', 'social_statement_Czb_V_lxFMA_meaning_of_ioi'))
                .toBe('https://www.instagram.com/p/Czb_V_lxFMA/');
        });

        it('looks a person-keyed question up in the credits, in the order the question was built from', async () => {
            // partnership/credit/collaborator are keyed on a person, not a
            // post. `creditedCollaborators` collects evidenceUrls in stored
            // order and the question uses evidenceUrls[0] — so this must take
            // the FIRST match, not the newest. Sorting by recency sent a
            // question about "those first two tracks" to a post years later.
            jest.doMock('@/server/utils/queries/socialCreditQueries', () => ({
                getSocialCredits: jest.fn(async () => ({
                    statements: [],
                    credits: [
                        { subject: 'zavodskyalan', isHandle: true, isSelf: false, role: 'production partner',
                          quote: 'the first two tracks', url: 'https://www.instagram.com/p/FIRST/', postedAt: '2020-03-26' },
                        { subject: 'zavodskyalan', isHandle: true, isSelf: false, role: 'Prod by',
                          quote: 'later one', url: 'https://www.instagram.com/p/LATER/', postedAt: '2021-03-26' },
                    ],
                })),
            }));
            const { sourceUrlForQuestionKey } = await import('@/server/utils/questionGenerator');
            expect(await sourceUrlForQuestionKey('a1', 'social_credit_zavodskyalan'))
                .toBe('https://www.instagram.com/p/FIRST/');
        });

        it.each([
            ['social_collaborator_dameatlas', 'https://www.instagram.com/p/COLLAB/'],
            ['social_music_rush_pete_rango', 'https://www.instagram.com/p/TRACK/'],
        ])('resolves %s from the POSTS, which is where those signals come from', async (key, expected) => {
            // These are keyed on a person or a track but are built from
            // `deriveSocialSignals`, not from the caption-parsed credits — so
            // the credits lookup could never match them, and `music` was not
            // even in the pattern. A resumed question of either kind silently
            // lost the link this whole change adds. Found in review.
            // deriveSocialSignals needs the artist's own handle to tell their
            // posts from a collaborator's.
            const artistQ = await import('@/server/utils/queries/artistQueries');
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', instagram: 'p3t3rango' });
            jest.doMock('@/server/utils/socialIngest', () => ({
                getSocialPostsForArtist: jest.fn(async () => [
                    { platform: 'instagram', platformPostId: '1', ownerUsername: 'dameatlas', isOwnPost: false,
                      caption: 'with pete', url: 'https://www.instagram.com/p/COLLAB/', postedAt: '2026-01-01',
                      likeCount: 10, commentCount: 1, playCount: 10, hashtags: [], mentions: ['p3t3rango'],
                      coauthors: [], musicTitle: null, musicArtist: null },
                    { platform: 'instagram', platformPostId: '2', ownerUsername: 'p3t3rango', isOwnPost: true,
                      caption: 'out now', url: 'https://www.instagram.com/p/TRACK/', postedAt: '2026-01-02',
                      likeCount: 10, commentCount: 1, playCount: 10, hashtags: [], mentions: [],
                      coauthors: [], musicTitle: 'rush', musicArtist: 'Pete Rango' },
                ]),
            }));
            const { sourceUrlForQuestionKey } = await import('@/server/utils/questionGenerator');
            expect(await sourceUrlForQuestionKey('a1', key)).toBe(expected);
        });

        it('resolves a theme key, which had no branch at all', async () => {
            // `social_theme_<kind>_<term>` matched none of the branches, so a
            // resumed theme question lost its link even though the signal
            // carries evidence urls. Found in review.
            const artistQ = await import('@/server/utils/queries/artistQueries');
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', instagram: 'p3t3rango' });
            jest.doMock('@/server/utils/socialIngest', () => ({
                getSocialPostsForArtist: jest.fn(async () => Array.from({ length: 3 }, (_, i) => ({
                    platform: 'instagram', platformPostId: `h${i}`, ownerUsername: 'p3t3rango', isOwnPost: true,
                    caption: 'in the studio', url: `https://www.instagram.com/p/THEME${i}/`, postedAt: `2026-0${i + 1}-01`,
                    likeCount: 10, commentCount: 1, playCount: 10, hashtags: ['housemusic'], mentions: [],
                    coauthors: [], musicTitle: null, musicArtist: null,
                }))),
            }));
            const { sourceUrlForQuestionKey } = await import('@/server/utils/questionGenerator');
            expect(await sourceUrlForQuestionKey('a1', 'social_theme_hashtag_housemusic'))
                .toMatch(/instagram\.com\/p\/THEME/);
        });

        it('reads each source ONCE for a whole batch of keys', async () => {
            // Resolving per question re-read the artist's entire post history
            // each time — three open collaborator questions meant three full
            // fetches plus three signal derivations, on a path that runs on
            // every page load with an open sitting.
            const artistQ = await import('@/server/utils/queries/artistQueries');
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', instagram: 'p3t3rango' });
            const getPosts = jest.fn(async () => []);
            jest.doMock('@/server/utils/socialIngest', () => ({ getSocialPostsForArtist: getPosts }));
            const { sourceUrlsForQuestionKeys } = await import('@/server/utils/questionGenerator');
            await sourceUrlsForQuestionKeys('a1', [
                'social_collaborator_a', 'social_music_b_c', 'social_theme_hashtag_d',
            ]);
            expect(getPosts).toHaveBeenCalledTimes(1);
        });

        it('does not read the posts when only credit-backed keys were asked for', async () => {
            // Each source is read only if some key actually needs it. (This
            // used to assert a standout resolved with NO read at all, by
            // rebuilding the url from the key — that shortcut is gone, because
            // it fabricated urls for anything not already /p/<code>/.)
            const getPosts = jest.fn(async () => []);
            jest.doMock('@/server/utils/socialIngest', () => ({ getSocialPostsForArtist: getPosts }));
            jest.doMock('@/server/utils/queries/socialCreditQueries', () => ({
                getSocialCredits: jest.fn(async () => ({
                    statements: [],
                    credits: [{ subject: 'zavodskyalan', isHandle: true, isSelf: false, role: 'Prod by',
                                quote: 'q', url: 'https://www.instagram.com/p/CRED/', postedAt: '2026-01-01' }],
                })),
            }));
            const { sourceUrlsForQuestionKeys } = await import('@/server/utils/questionGenerator');
            const out = await sourceUrlsForQuestionKeys('a1', ['social_credit_zavodskyalan']);
            expect(out.get('social_credit_zavodskyalan')).toBe('https://www.instagram.com/p/CRED/');
            expect(getPosts).not.toHaveBeenCalled();
        });

        it('scopes BOTH branches by `since`, so a new-material sitting cannot link to an older post', async () => {
            // The credits branch was scoped and the signals branch was not,
            // while the docstring claimed both. Only the caller's own habits
            // kept it from firing. The review flagged that no test covered
            // `since` on this path at all, which is why it went unnoticed
            // through two rounds.
            const artistQ = await import('@/server/utils/queries/artistQueries');
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', instagram: 'p3t3rango' });
            jest.doMock('@/server/utils/socialIngest', () => ({
                getSocialPostsForArtist: jest.fn(async () => [
                    { platform: 'instagram', platformPostId: 'old', ownerUsername: 'dameatlas', isOwnPost: false,
                      caption: 'ancient', url: 'https://www.instagram.com/p/OLD/', postedAt: '2019-01-01',
                      likeCount: 5, commentCount: 1, playCount: 5, hashtags: [], mentions: ['p3t3rango'],
                      coauthors: [], musicTitle: null, musicArtist: null },
                ]),
            }));
            jest.doMock('@/server/utils/queries/socialCreditQueries', () => ({
                getSocialCredits: jest.fn(async () => ({
                    statements: [],
                    credits: [{ subject: 'zavodskyalan', isHandle: true, isSelf: false, role: 'Prod by',
                                quote: 'q', url: 'https://www.instagram.com/p/OLDCRED/', postedAt: '2019-01-01' }],
                })),
            }));
            const { sourceUrlsForQuestionKeys } = await import('@/server/utils/questionGenerator');
            const out = await sourceUrlsForQuestionKeys(
                'a1',
                ['social_collaborator_dameatlas', 'social_credit_zavodskyalan'],
                { since: '2026-01-01T00:00:00Z' },
            );
            // Everything behind these keys predates `since`, so neither
            // resolves — a missing link, never a link to a post the model
            // could not have seen.
            expect(out.get('social_collaborator_dameatlas')).toBeUndefined();
            expect(out.get('social_credit_zavodskyalan')).toBeUndefined();
        });

        it('returns nothing rather than guessing for a key with no post behind it', async () => {
            // A link to the wrong post is the artist reading somebody else's
            // caption — worse than no link.
            const r = await resolve();
            expect(await r('a1', 'describe_your_sound')).toBeUndefined();
            expect(await r('a1', 'social_theme_hashtag_housemusic')).toBeUndefined();
        });
    });

    describe('exclusion reaches the pool, not just the finished list', () => {
        it('offers the NEXT statement once the top ones have been asked', async () => {
            // Each kind truncates to a small TOP_N, and the exclusion used to
            // run on the finished candidate list — so once the top-ranked items
            // of a kind were answered, the same top-N were recomputed and
            // stripped to zero and that kind produced nothing ever again. With
            // TOP_THEMES at 1, one answered theme question retired themes
            // permanently. Found in review, and it is the same mistake the
            // exclusion was written to fix, one layer down.
            // More statements than TOP_STATEMENTS, so there is a next rank to
            // come forward once the first ones are excluded.
            jest.doMock('@/server/utils/queries/socialCreditQueries', () => ({
                getSocialCredits: jest.fn(async () => ({
                    credits: [],
                    statements: Array.from({ length: 16 }, (_, i) => ({
                        quote: `a distinct thing I said number ${i} about the record and the room`,
                        topic: `topic ${i}`,
                        url: `https://www.instagram.com/p/S${i}/`,
                        postedAt: `2026-01-${String(i + 1).padStart(2, '0')}`,
                    })),
                })),
            }));
            let offered = [];
            const capture = jest.fn(async (req) => {
                const sys = String(req?.config?.systemInstruction ?? "");
                const contents = String(req?.contents ?? "");
                if (sys.startsWith("You are fact-checking")) return { text: '[]' };
                offered = JSON.parse(contents.match(/SIGNALS:\n([\s\S]*?)\n\nChoose/)[1]);
                return { text: '[]' };
            });

            const { generateGroundedQuestions } = await setup({ generateContentImpl: capture });
            await generateGroundedQuestions('a1', { max: 3 });
            const before = offered.filter(x => x.kind === 'statement').map(x => x.signalId);
            expect(before.length).toBeGreaterThan(0);

            // Exclude every statement it just offered. If exclusion happened
            // after truncation there would be nothing left; reaching the pool
            // means the next-ranked ones come forward.
            const { generateGroundedQuestions: again } = await setup({ generateContentImpl: capture });
            await again('a1', { max: 3, excludeKeys: before.map(id => `social_${id}`) });
            const after = offered.filter(x => x.kind === 'statement').map(x => x.signalId);
            expect(after.length).toBeGreaterThan(0);
            expect(after.some(id => before.includes(id))).toBe(false);
        });
    });

    describe('rotation — never offer a question the artist has already answered', () => {
        it('removes excluded keys from the candidate POOL, not just from the result', async () => {
            // Filtering after generation is too late: the model has already
            // spent its picks writing questions that get thrown away, and the
            // static bank fills the gap. Pete, testing repeatedly: "it just
            // seems like I'm getting the same questions every time."
            let offered = [];
            const { generateGroundedQuestions } = await setup({
                generateContentImpl: jest.fn(async (req) => {
                    const sys = String(req?.config?.systemInstruction ?? "");
                    const contents = String(req?.contents ?? "");
                    if (sys.startsWith("You are fact-checking")) {
                        const n = (contents.match(/--- QUESTION \d+ ---/g) ?? []).length;
                        return { text: JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, ok: true, problem: '' }))) };
                    }
                    offered = JSON.parse(contents.match(/SIGNALS:\n([\s\S]*?)\n\nChoose/)[1]);
                    return { text: '[]' };
                }),
            });

            const all = await generateGroundedQuestions('a1', { max: 3 });
            const everySignal = [...offered];
            expect(everySignal.length).toBeGreaterThan(1);
            void all;

            // Ask again, excluding one of the keys the pool would have offered.
            const { generateGroundedQuestions: again } = await setup({
                generateContentImpl: jest.fn(async (req) => {
                    const sys = String(req?.config?.systemInstruction ?? "");
                    const contents = String(req?.contents ?? "");
                    if (sys.startsWith("You are fact-checking")) return { text: '[]' };
                    offered = JSON.parse(contents.match(/SIGNALS:\n([\s\S]*?)\n\nChoose/)[1]);
                    return { text: '[]' };
                }),
            });
            // signalId and key line up for every kind EXCEPT collaborator,
            // where "collab_x" becomes "social_collaborator_x" — so pick one
            // whose mapping is predictable rather than hand-deriving it wrong.
            const dropped = everySignal.find(x => !String(x.signalId).startsWith('collab_')).signalId;
            await again('a1', { max: 3, excludeKeys: [`social_${dropped}`] });
            expect(offered.some(x => x.signalId === dropped)).toBe(false);
            // NOT length - 1. Exclusion now happens against each kind's full
            // pool before it is truncated, so dropping one lets the next-ranked
            // candidate take its place. A shrinking pool was the symptom of
            // filtering the finished list — see the pool test above.
            expect(offered.length).toBeGreaterThanOrEqual(everySignal.length - 1);
        });

        it('keys the cache on the exclusion set, so a second ask is not served the first answer', async () => {
            // Two calls that exclude different things are not the same call.
            // Sharing a cache entry would hand back a question the artist has
            // just answered.
            const calls = [];
            const impl = jest.fn(async (req) => {
                const sys = String(req?.config?.systemInstruction ?? "");
                if (!sys.startsWith("You are fact-checking")) calls.push(1);
                return { text: '[]' };
            });
            const { generateGroundedQuestions } = await setup({ generateContentImpl: impl });
            await generateGroundedQuestions('a1', { max: 3, excludeKeys: ['social_theme_a'] });
            await generateGroundedQuestions('a1', { max: 3, excludeKeys: ['social_theme_b'] });
            expect(calls.length).toBe(2);
        });
    });

    describe('sounding like a person rather than an essay', () => {
        it.each([
            "what does that look like in practice for artists using the platform?",
            "what was a key creative decision that shaped the visual identity of the project?",
            "how did that change your approach to songwriting?",
            "what has that journey been like for you?",
        ])('rejects essay-register abstractions: %s', async (q) => {
            // "process", "approach", "identity", "journey" — the words of
            // somebody describing music rather than making it. Pete: "no one
            // talks like that."
            const { boilerplateReason } = await import('@/server/utils/questionGenerator');
            expect(boilerplateReason(q)).toMatch(/abstraction/);
        });

        it('rejects a question too long to say out loud', async () => {
            // The real one, 38 words. Spoken questions are short; this is
            // written prose with two subordinate clauses.
            const { boilerplateReason } = await import('@/server/utils/questionGenerator');
            expect(boilerplateReason(
                "You wrote that your cousin André handing you 112's Part III and Dr. Dre's 2001 shifted your perspective on how to create music; what was the first track you made where you felt that shift truly take hold?",
            )).toMatch(/too long/);
        });

        it('keeps a short, spoken question with a concrete noun in it', async () => {
            const { boilerplateReason } = await import('@/server/utils/questionGenerator');
            expect(boilerplateReason("You said those two albums changed how you make music — what's the first thing you made after?")).toBeNull();
        });
    });

    describe('not every question is about somebody else', () => {
        it('caps collaborator questions at half the set even when they are all different kinds', async () => {
            // partnership / credit / collaborator / same_post are four
            // different KINDS and all four ask about another person, so
            // spreading by kind alone still produces a tour of the contact
            // list. Pete: "some could just be about things the artist posted."
            // Three collaborators each credited on two posts, so partnership,
            // credit AND collaborator signals all exist — the situation Pete's
            // feed actually produces.
            const person = (h, url, role) => ({ subject: h, isHandle: true, isSelf: false, role, quote: `${role} @${h}`, url, postedAt: null });
            jest.doMock("@/server/utils/queries/socialCreditQueries", () => ({
                getSocialCredits: jest.fn(async () => ({
                    credits: ['alan', 'cherele', 'oyabun'].flatMap(h => [
                        person(h, `https://www.instagram.com/p/${h}1/`, 'production partner'),
                        person(h, `https://www.instagram.com/p/${h}2/`, 'production partner'),
                    ]),
                    statements: [
                        { quote: 'the pandemic was a blessing and a curse', topic: 'the pandemic', url: 'https://www.instagram.com/p/S1/', postedAt: null },
                        { quote: 'house has been therapy for me', topic: 'house music', url: 'https://www.instagram.com/p/S2/', postedAt: null },
                    ],
                })),
            }));
            const { generateGroundedQuestions } = await setup({
                generateContentImpl: jest.fn(async (req) => {
                    const sys = String(req?.config?.systemInstruction ?? "");
                    const contents = String(req?.contents ?? "");
                    if (sys.startsWith("You are fact-checking")) {
                        const n = (contents.match(/--- QUESTION \d+ ---/g) ?? []).length;
                        return { text: JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, ok: true, problem: '' }))) };
                    }
                    const signals = JSON.parse(contents.match(/SIGNALS:\n([\s\S]*?)\n\nChoose/)[1]);
                    // Ranks every person-signal first, which is exactly what
                    // the real model does — the prompt tells it to prefer them.
                    const people = ['partnership', 'same_post', 'credit', 'collaborator'];
                    const ranked = [...signals].sort((a, b) =>
                        (people.includes(a.kind) ? 0 : 1) - (people.includes(b.kind) ? 0 : 1));
                    return { text: JSON.stringify(ranked.map((sig, i) => ({
                        signalId: sig.signalId, question: `Who pushed back on that, ${i}?`, rationale: 'r',
                    }))) };
                }),
            });

            const out = await generateGroundedQuestions('a1', { max: 4 });
            const isPerson = q => ['partnership', 'same_post', 'credit', 'collaborator'].includes(q.kind);
            const aboutPeople = out.filter(isPerson).length;

            // NO `if` GUARD. The first version of this wrapped the assertion in
            // `if (out.some(q => !isPerson(q)))`, which skips it in exactly the
            // situation the test exists to catch: the review pointed out that
            // three collaborators produce six person-kind candidates, matching
            // the draft ceiling, so every draft came back person-kind, the
            // condition was false and the test passed without ever checking the
            // cap. A test that excuses itself when the bug is present is not a
            // test.
            //
            // The draft loop now reserves half the slots for anything that is
            // not about a person, so the statements in this fixture ARE
            // reachable and the cap has something to protect.
            expect(out.length).toBeGreaterThan(0);
            expect(out.some(q => !isPerson(q))).toBe(true);
            expect(aboutPeople).toBeLessThanOrEqual(Math.ceil(4 / 2));
        });
    });

    describe('diversify — one question per kind before a second of any', () => {
        it('spreads across kinds instead of returning four of the strongest one', async () => {
            // A real run returned FOUR "you credited @someone; what's a
            // specific X?" questions about four different collaborators — one
            // question asked four times. The instruction said not to and
            // nothing enforced it.
            const { diversify } = await import('@/server/utils/questionGenerator');
            const items = [
                { kind: 'partnership', id: 1 }, { kind: 'partnership', id: 2 },
                { kind: 'partnership', id: 3 }, { kind: 'statement', id: 4 },
                { kind: 'music', id: 5 },
            ];
            expect(diversify(items, 3).map(x => x.kind)).toEqual(['partnership', 'statement', 'music']);
        });

        it('keeps the model ranking within a kind', async () => {
            const { diversify } = await import('@/server/utils/questionGenerator');
            const items = [{ kind: 'credit', id: 1 }, { kind: 'credit', id: 2 }];
            expect(diversify(items, 2).map(x => x.id)).toEqual([1, 2]);
        });

        it('still fills the set when an artist genuinely only has one kind', async () => {
            // Somebody whose signals really are all credits gets a full
            // interview, not a single question.
            const { diversify } = await import('@/server/utils/questionGenerator');
            const items = [{ kind: 'credit', id: 1 }, { kind: 'credit', id: 2 }, { kind: 'credit', id: 3 }];
            expect(diversify(items, 3)).toHaveLength(3);
        });

        it('never returns more than asked for', async () => {
            const { diversify } = await import('@/server/utils/questionGenerator');
            expect(diversify([{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }], 2)).toHaveLength(2);
        });
    });

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
            // EVERY signal, not the first `asked` — the real model sees them
            // all and the draft loop is what applies the caps. Slicing here
            // hid the person cap behind an empty pool.
            void asked;
            return { text: JSON.stringify(signals.map((sig, i) => ({
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

        it('APPLIES the boilerplate check and the diversity rule, not just exports them', async () => {
            // Both guards were mutation-tested green while nothing called
            // them — the same "it exists and has no caller" failure this
            // branch has now produced three times. So this drives the real
            // pipeline: every draft the model returns is boilerplate except
            // one, and the drafts are deliberately all one kind.
            const { generateGroundedQuestions } = await setup({
                generateContentImpl: jest.fn(async (req) => {
                    const sys = String(req?.config?.systemInstruction ?? "");
                    const contents = String(req?.contents ?? "");
                    if (sys.startsWith("You are fact-checking")) {
                        const n = (contents.match(/--- QUESTION \d+ ---/g) ?? []).length;
                        return { text: JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, ok: true, problem: '' }))) };
                    }
                    const signals = JSON.parse(contents.match(/SIGNALS:\n([\s\S]*?)\n\nChoose/)[1]);
                    return { text: JSON.stringify(signals.map((sig, i) => ({
                        signalId: sig.signalId,
                        // All but one count posts — the banned dashboard phrasing.
                        question: i === 0 ? 'Who pushed back on that?' : `Across ${i + 4} posts you did things; what changed?`,
                        rationale: 'r',
                    }))) };
                }),
            });

            const out = await generateGroundedQuestions('a1', { max: 3 });
            // The clean one RANKS FIRST. It used to be the only survivor, and
            // that made the output worse: a dropped draft is not replaced by a
            // nicer question, it is replaced by "describe your sound". On Pete
            // Rango's real feed that produced zero grounded questions and three
            // generic fallbacks.
            expect(out[0].question).toBe('Who pushed back on that?');
            // …and the flagged ones are still available behind it rather than
            // thrown away.
            expect(out.length).toBeGreaterThan(1);
        });

        it('prefers a clean collaborator question over flagged ones about other collaborators', async () => {
            // The cap counted a person-kind draft before checking whether it
            // survived, so boilerplate collaborator drafts exhausted it and a
            // later good one was dropped with zero person questions in the set
            // — the cap eating the yield the oversample exists to recover.
            // Found in review.
            //
            // Here every person-kind draft but the LAST counts posts, which is
            // rejected. The last one must still get through.
            // TWO collaborators, not four. The draft target is bounded by the
            // latency ceiling, so a fixture with more person signals than that
            // never reaches the last one and the test would be measuring the
            // bound rather than the ranking.
            const person = (h, url, role) => ({ subject: h, isHandle: true, isSelf: false, role, quote: `${role} @${h}`, url, postedAt: null });
            jest.doMock("@/server/utils/queries/socialCreditQueries", () => ({
                getSocialCredits: jest.fn(async () => ({
                    credits: ['alan', 'cherele'].flatMap(h => [
                        person(h, `https://www.instagram.com/p/${h}1/`, 'production partner'),
                        person(h, `https://www.instagram.com/p/${h}2/`, 'production partner'),
                    ]),
                    statements: [],
                })),
            }));
            const { generateGroundedQuestions } = await setup({
                generateContentImpl: jest.fn(async (req) => {
                    const sys = String(req?.config?.systemInstruction ?? "");
                    const contents = String(req?.contents ?? "");
                    if (sys.startsWith("You are fact-checking")) {
                        const n = (contents.match(/--- QUESTION \d+ ---/g) ?? []).length;
                        return { text: JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, ok: true, problem: '' }))) };
                    }
                    const signals = JSON.parse(contents.match(/SIGNALS:\n([\s\S]*?)\n\nChoose/)[1]);
                    // The good question must sit on the LAST PERSON-kind
                    // signal: only a person-kind draft is subject to the cap,
                    // so putting it on a theme or a track would sail past the
                    // bug entirely — which is exactly how the first version of
                    // this test passed against the broken ordering.
                    const people = ['partnership', 'same_post', 'credit', 'collaborator'];
                    const personIds = signals.filter(x => people.includes(x.kind)).map(x => x.signalId);
                    const good = personIds[personIds.length - 1];
                    expect(personIds.length).toBeGreaterThan(1);
                    return { text: JSON.stringify(signals.map((sig, i) => ({
                        signalId: sig.signalId,
                        question: sig.signalId === good
                            ? 'Who pushed back on that?'                                    // the good one
                            : `Across ${i + 5} posts you worked together; what changed?`,    // rejected
                        rationale: 'r',
                    }))) };
                }),
            });

            const out = await generateGroundedQuestions('a1', { max: 3 });
            // The good one is not merely present — it comes FIRST, ahead of
            // every flagged draft, even though the model ranked it last.
            expect(out[0].question).toBe('Who pushed back on that?');
        });

        it('does not return the same KIND of question repeatedly when other kinds are available', async () => {
            const { generateGroundedQuestions } = await setup({
                generateContentImpl: echoRealSignals(() => {}, () => true),
            });
            const out = await generateGroundedQuestions('a1', { max: 3 });
            // Not "all distinct" — the person cap can leave fewer kinds
            // available than slots, and repeating then is correct rather than
            // returning a short set. What must never happen is a set that is
            // one kind over and over.
            expect(out.length).toBeGreaterThan(1);
            expect(new Set(out.map(q => q.kind)).size).toBeGreaterThan(1);
        });

        it('still returns no more than the caller asked for', async () => {
            // Oversampling is about surviving rejection, not about handing the
            // artist nine questions.
            const { generateGroundedQuestions } = await setup({
                generateContentImpl: echoRealSignals(() => {}, () => true),
            });
            await expect(generateGroundedQuestions('a1', { max: 3 })).resolves.toHaveLength(3);
        });

        it('warns rather than silently dropping the oversample when max outgrows the latency ceiling', async () => {
            // MAX_DRAFTS is a measured latency ceiling, and it silently
            // swallowed the oversample for any max above MAX_DRAFTS /
            // DRAFT_OVERSAMPLE — at the module default of 6 the draft target
            // clamps to exactly 6, which is drafting precisely what we need and
            // letting the fact-checker eat it. That is the bug this mechanism
            // exists to fix, reappearing the moment somebody raises the count.
            // Found in review.
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const { generateGroundedQuestions } = await setup({
                    generateContentImpl: echoRealSignals(() => {}, () => true),
                });
                await generateGroundedQuestions('a1', { max: 6 });
                expect(warn.mock.calls.flat().join(' ')).toMatch(/Oversampling degraded/);
            } finally {
                warn.mockRestore();
            }
        });

        it('is quiet when the oversample actually happens', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const { generateGroundedQuestions } = await setup({
                    generateContentImpl: echoRealSignals(() => {}, () => true),
                });
                await generateGroundedQuestions('a1', { max: 3 });
                expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Oversampling degraded/);
            } finally {
                warn.mockRestore();
            }
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

        it("describes a partnership by the roles that RECUR, never by a one-off", async () => {
            // Pete Rango credited @zavodskyalan across 23 posts as his "main
            // production partner", and ONCE for having "added some 808s" —
            // 808s whose files that same caption says were lost and never
            // used. Flattening every label into one list presented the one-off
            // as a description of the relationship, and the question asked him
            // about "adding some 808s across many posts".
            jest.doMock("@/server/utils/queries/socialCreditQueries", () => ({
                getSocialCredits: jest.fn(async () => ({
                    statements: [],
                    credits: [
                        { subject: "zavodskyalan", isHandle: true, isSelf: false, role: "production partner",
                          quote: "my production partner", url: "https://www.instagram.com/p/A/", postedAt: null },
                        { subject: "zavodskyalan", isHandle: true, isSelf: false, role: "production partner",
                          quote: "production partner again", url: "https://www.instagram.com/p/B/", postedAt: null },
                        { subject: "zavodskyalan", isHandle: true, isSelf: false, role: "added some 808s",
                          quote: "added some 808s but those files were lost", url: "https://www.instagram.com/p/C/", postedAt: null },
                    ],
                })),
            }));
            const { generateGroundedQuestions, generateContent } = await setup({ geminiText: "[]" });
            await generateGroundedQuestions("a1");
            const sent = promptFrom(generateContent);
            const partnership = JSON.parse(sent.match(/SIGNALS:\n([\s\S]*?)\n\nChoose/)[1])
                .find(x => x.kind === "partnership");
            expect(partnership.material).toContain("production partner");
            expect(partnership.material).not.toContain("808s");
        });

        it("marks a collaborator's roles as separate occasions, and carries no post count", async () => {
            // The credit signal listed every label in one run-on list with a
            // count on the end — "credits @zavodskyalan as: main production
            // partner; added some 808s; breath church ... on 23 post(s)". The
            // model then asked about being "credited with 'added some 808s'
            // and 'breath church'", merging three unrelated captions into one
            // description of the person. The count is also where "across 23
            // posts" came from.
            const { generateGroundedQuestions, generateContent } = await withExtraction({ geminiText: "[]" });
            await generateGroundedQuestions("a1");
            const sent = promptFrom(generateContent);
            const credit = JSON.parse(sent.match(/SIGNALS:\n([\s\S]*?)\n\nChoose/)[1])
                .find(x => x.kind === "credit");
            // "Each line is ONE caption" — the wording matters. Saying only
            // that the quotes come from DIFFERENT captions made the verifier
            // refuse to combine two facts that sat in the SAME sentence, and it
            // rejected a supported question for it.
            expect(credit.material).toMatch(/Each line below is ONE caption/);
            expect(credit.material).toMatch(/inside a single line .* belongs together/);
            expect(credit.material).toMatch(/DIFFERENT lines do not/);
            expect(credit.material).not.toMatch(/\d+ post\(s\)/);
            // THE SENTENCE, not the label. A label without its sentence loses
            // the only thing that gives it meaning: "added some 808s" reads as
            // a contribution until you see "but those files were lost".
            expect(credit.material).toContain('Mixed by @p3t3rango');
        });

        it("offers a collaborator credited on more than one post as a relationship", async () => {
            const { generateGroundedQuestions, generateContent } = await withExtraction({ geminiText: "[]" });
            await generateGroundedQuestions("a1");
            const sent = promptFrom(generateContent);
            expect(sent).toContain("partnership_p3t3rango");
            expect(sent).toContain("several SEPARATE posts");
            // No count. The material said "on 23 SEPARATE posts" for Pete
            // Rango and the model recited it into every question — "across 23
            // posts, you've credited...". Given a number it uses the number.
            expect(sent).not.toMatch(/on \d+ SEPARATE posts/);
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
