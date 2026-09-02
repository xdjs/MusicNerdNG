// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getVaultSourcesByArtistId: jest.fn() }));
jest.mock('@/server/utils/queries/docCorrectionQueries', () => ({ getDocCorrections: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/queries/onboardingQueries', () => ({ getInterviewAnswers: jest.fn(), getArtistDoc: jest.fn() }));
jest.mock('@/server/utils/socialIngest', () => ({ getSocialPostsForArtist: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/lib/gemini', () => ({
    getGemini: jest.fn(),
    GEMINI_MODEL_FLASH: 'gemini-2.5-flash',
}));

describe('artistDocService', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    async function setup({ geminiText = '## Overview\nA real doc.', posts, vaultSources } = {}) {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getVaultSourcesByArtistId } = await import('@/server/utils/queries/dashboardQueries');
        const { getInterviewAnswers, getArtistDoc } = await import('@/server/utils/queries/onboardingQueries');
        const { getSocialPostsForArtist } = await import('@/server/utils/socialIngest');
        const { getGemini } = await import('@/server/lib/gemini');
        const generateContent = jest.fn().mockResolvedValue({ text: geminiText });
        getGemini.mockReturnValue({ models: { generateContent } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Nova Reyes', spotify: 'spot123', instagram: 'novareyes' });
        getVaultSourcesByArtistId.mockResolvedValue(vaultSources ?? [
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

    // The About and the auto-generated bio write to the same artists.bio field and
    // render in the same place, so they answer to one length rule — production's,
    // in artistBioQuery. The old "2-4 short paragraphs" set a two-paragraph FLOOR,
    // which is what made an About written through onboarding read twice as long as
    // one generated automatically.
    it('both About prompts carry production\'s one-paragraph length rule', async () => {
        const { svc, generateContent } = await setup({ geminiText: 'An About.' });

        await svc.generateAboutFromDoc('Nova Reyes', '## Overview\ndoc');
        const cited = generateContent.mock.calls[0][0].config.systemInstruction;
        expect(cited).toContain('ONE paragraph, up to ~100 words');
        expect(cited).toContain('Stop when the facts run out');
        expect(cited).not.toContain('2-4 short paragraphs');

        await svc.synthesizeFallbackAbout('a1', 'Nova Reyes', '## Overview\ndoc');
        const fallback = generateContent.mock.calls[1][0].config.systemInstruction;
        expect(fallback).toContain('ONE paragraph, up to ~100 words');
        expect(fallback).not.toContain('2-4 short paragraphs');
    });

    // Length was ported from production but structure wasn't, so the About opened
    // mid-catalogue ("Pete Rango has released several collaborative tracks...") with
    // no sentence saying who he is. Production leads with the identity line.
    it('both About prompts carry production\'s opening rule', async () => {
        const { svc, generateContent } = await setup({ geminiText: 'An About.' });

        // Assert against the CONSTANT, not its current wording — this test is
        // about both prompts sharing one rule, not about how it is phrased.
        const { ABOUT_OPENING_RULE } = await import('@/lib/bioConstants');

        await svc.generateAboutFromDoc('Nova Reyes', '## Overview\ndoc');
        expect(generateContent.mock.calls[0][0].config.systemInstruction)
            .toContain(ABOUT_OPENING_RULE);

        await svc.synthesizeFallbackAbout('a1', 'Nova Reyes', '## Overview\ndoc');
        expect(generateContent.mock.calls[1][0].config.systemInstruction)
            .toContain(ABOUT_OPENING_RULE);
    });

    // A pull-quote inside a ~100-word encyclopedia-style bio reads wrong, and the
    // automatic generator never quoted anyone. The interview facts still reach the
    // About — only the quotation marks go.
    it('neither About prompt asks to carry the artist\'s words over verbatim', async () => {
        const { svc, generateContent } = await setup({ geminiText: 'An About.' });

        await svc.generateAboutFromDoc('Nova Reyes', '## Overview\ndoc');
        const cited = generateContent.mock.calls[0][0].config.systemInstruction;
        expect(cited).not.toMatch(/keep the quote/i);
        expect(cited).toMatch(/no quotation marks/i);

        await svc.synthesizeFallbackAbout('a1', 'Nova Reyes', '## Overview\ndoc');
        const fallback = generateContent.mock.calls[1][0].config.systemInstruction;
        expect(fallback).not.toMatch(/keep the quote/i);
        expect(fallback).toMatch(/no quotation marks/i);
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
                { id: 1, kind: 'vault', label: 'Real', url: 'https://real.example/x' , publishedAt: null },
            ]);
        });

        it('buildDocSources numbers vault sources then interview answers, skipping skipped answers', async () => {
            const { svc } = await setup();
            const sources = await svc.buildDocSources('a1');
            expect(sources).toEqual([
                { id: 1, kind: 'vault', label: 'Pitchfork review', url: 'https://pitchfork.com/x' , publishedAt: null },
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
            expect(call.contents).toContain('[1] Source (date unknown): Pitchfork review');
            expect(call.contents).toContain('NUMBERED SOURCES');
            expect(call.config.systemInstruction).toContain('CITATIONS');
            expect(call.config.systemInstruction).toContain('ANTI-INFLATION');
        });


        it("puts the artist's corrections in the prompt, above the sources", async () => {
            // The document is regenerated whenever sources change, so a correction
            // typed INTO it would appear to save and then vanish. Corrections live
            // outside it and must be re-applied on every rebuild.
            const { getDocCorrections } = await import('@/server/utils/queries/docCorrectionQueries');
            getDocCorrections.mockResolvedValue([
                { id: 'c1', claim: 'Parris Pierce is his production partner', kind: 'fix', correction: 'They worked together 2018-2019, not since.' },
                { id: 'c2', claim: 'He has worked with Black Youngsta', kind: 'wrong', correction: null },
            ]);
            const { svc, generateContent } = await setup();
            await svc.synthesizeArtistDoc('a1');
            const sent = generateContent.mock.calls[0][0].contents;
            expect(sent).toContain('CORRECTIONS FROM THE ARTIST');
            expect(sent).toContain('They worked together 2018-2019, not since.');
            // A "wrong" correction must read as a removal, not as a fact to keep.
            expect(sent).toMatch(/REMOVE[^\n]*Black Youngsta/);
            expect(generateContent.mock.calls[0][0].config.systemInstruction).toContain('CORRECTIONS —');
        });

        it("omits the corrections block entirely when there are none", async () => {
            const { getDocCorrections } = await import('@/server/utils/queries/docCorrectionQueries');
            getDocCorrections.mockResolvedValue([]);
            const { svc, generateContent } = await setup();
            await svc.synthesizeArtistDoc('a1');
            expect(generateContent.mock.calls[0][0].contents).not.toContain('CORRECTIONS FROM THE ARTIST');
        });

        it('labels every source with its age, so a claim can be scoped in time', async () => {
            // "Parris Pierce is my production partner" reached a real artist's
            // profile in the present tense, from an interview published in 2019.
            // The doc had an anti-inflation rule telling it to scope claims in
            // time and no way to obey it: nothing in its material said when
            // anything happened.
            const { svc, generateContent } = await setup({
                vaultSources: [{ id: 'v1', url: 'https://voyagemia.com/x', title: 'Meet Nova', snippet: '', extractedText: 'Nova Reyes said something. '.repeat(40), status: 'approved', publishedAt: '2019-01-10' }],
            });
            await svc.synthesizeArtistDoc('a1');
            const call = generateContent.mock.calls[0][0];
            expect(call.contents).toMatch(/\[1\] Source \(published 2019-01-10, \d+ years ago\)/);
            expect(call.config.systemInstruction).toContain('TIME —');
        });

        it('generateAboutFromDoc strips a marker not present in the passed sources list', async () => {
            const { svc } = await setup({ geminiText: 'They cited Lauryn Hill[1] and something unverifiable[7].' });
            const sources = [{ id: 1, kind: 'vault', label: 'SoundBetter profile', url: 'https://soundbetter.com/profiles/x' , publishedAt: null }];
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

        it('strips GROUPED markers, which is what a sentence resting on two sources gets', async () => {
            // The regex matched a single number only, so "[3]" went and
            // "[3, 4]" stayed — and the model groups them whenever a sentence
            // rests on more than one source, which is often. Pete Rango's
            // published About read "...creative empowerment and education
            // [3, 4]." with nothing rendering those numbers as anything.
            //
            // Not just cosmetic: artist.bio is what the artist page feeds to
            // summarize() for its meta description, so the brackets reached
            // the Google snippet.
            const svc = await import('../artistDocService');
            expect(svc.stripCitationMarkers('and education [3, 4]. Rango composes soundscapes [2, 3].'))
                .toBe('and education. Rango composes soundscapes.');
            expect(svc.stripCitationMarkers('spaced [1 , 2] and tight[4,5,6] both go'))
                .toBe('spaced and tight both go');
        });

        it('leaves square brackets that are prose, not citations, alone', async () => {
            const svc = await import('../artistDocService');
            expect(svc.stripCitationMarkers('the label [now defunct] released it'))
                .toBe('the label [now defunct] released it');
        });
    });
});


describe("stripCitationMarkers — punctuation left behind", () => {
    it("does not leave a space before the period when the model spaces its marker", async () => {
        // Real output from a live run: "...now based in Miami, FL [1]." The
        // prompt asks for no space before the marker and the model does not
        // always comply — and the auto-build stores this exact string as the
        // artist's published bio, so the artefact is visible on their page.
        const { stripCitationMarkers } = await import("@/server/utils/artistDocService");
        expect(stripCitationMarkers("Pete Rango is a producer based in Miami, FL [1]."))
            .toBe("Pete Rango is a producer based in Miami, FL.");
    });

    it("still handles the well-formed case, and mid-sentence markers", async () => {
        const { stripCitationMarkers } = await import("@/server/utils/artistDocService");
        expect(stripCitationMarkers("He founded XUE RECORDS[2]. His work aired on HBO[3]."))
            .toBe("He founded XUE RECORDS. His work aired on HBO.");
        expect(stripCitationMarkers("a hardcore band [4], then electronic music [5]."))
            .toBe("a hardcore band, then electronic music.");
    });

    it("never pulls a paragraph break out with a marker at the start of a line", async () => {
        const { stripCitationMarkers } = await import("@/server/utils/artistDocService");
        expect(stripCitationMarkers("First line.\n[1] Second line.")).toBe("First line.\nSecond line.");
    });
});

describe("source text selection — the best material is rarely at the top", () => {
    it("keeps paragraphs that name the artist over ones that merely came first", async () => {
        // Real failure: a 5,000-character profile carried "featured in HBO's
        // Insecure" at character 2,466, and a 2,000-character HEAD slice cut it.
        // The artist's About read as a summary of his childhood and never
        // mentioned the credit, because an interview opens with childhood and
        // puts the career in the middle.
        const { selectSourceText } = await import("@/server/utils/artistDocService");
        const filler = "Richmond has a long history of independent venues and community radio. ".repeat(60);
        const credit = "\n\nPete Rango landed a placement for his song on HBO's Insecure.\n\n";
        const text = filler + credit + filler;
        expect(text.indexOf("HBO")).toBeGreaterThan(2000); // the condition that broke it

        const selected = selectSourceText(text, "Pete Rango");
        expect(selected).toContain("HBO");
    });

    it("returns short text untouched", async () => {
        const { selectSourceText } = await import("@/server/utils/artistDocService");
        const short = "Pete Rango is a producer from Bogota.";
        expect(selectSourceText(short, "Pete Rango")).toBe(short);
    });

    it("falls back to a head slice when the text has no paragraph structure", async () => {
        // Legacy rows: every source stored before extractReadableText landed was
        // flattened to a single line at scrape time, so there are no paragraphs
        // to choose between and the head slice is all this can do. Sized past
        // SOURCE_TEXT_BUDGET deliberately — under it, text is returned whole.
        const { selectSourceText, SOURCE_TEXT_BUDGET } = await import("@/server/utils/artistDocService");
        const blob = "x".repeat(SOURCE_TEXT_BUDGET + 3000);
        const out = selectSourceText(blob, "Pete Rango");
        expect(out.length).toBe(SOURCE_TEXT_BUDGET);
    });
});
