/**
 * The slicing, which is what makes the long work survive production.
 *
 * These run without a model: `extractCaptionCredits` is exercised through a
 * stubbed Gemini so the questions under test are about batching and resumption,
 * not about what the model says.
 */
import { jest } from "@jest/globals";

const generateContent = jest.fn();
jest.mock("@/server/lib/gemini", () => ({
    getGemini: () => ({ models: { generateContent } }),
    GEMINI_MODEL_FLASH: "flash",
}));

import type { SocialPostRow } from "@/server/utils/socialSignals";

function post(i: number): SocialPostRow {
    return {
        platform: "instagram",
        platformPostId: String(i),
        ownerUsername: "artist",
        isOwnPost: true,
        caption: `Post number ${i}. Mixed by @someone on this one.`,
        url: `https://www.instagram.com/p/POST${i}/`,
        postedAt: "2026-01-01T00:00:00.000Z",
        likeCount: 1, commentCount: 0, playCount: null,
        hashtags: [], mentions: ["someone"], coauthors: [],
        musicTitle: null, musicArtist: null,
    };
}

/** One credit per caption, so a batch's output is predictable. */
function replyFor(urls: string[]) {
    return {
        text: JSON.stringify({
            credits: urls.map(u => ({
                subject: "someone", isHandle: true, role: "Mixed by",
                quote: "Mixed by @someone on this one.", url: u,
            })),
            statements: [],
        }),
    };
}

beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockImplementation(async (req: unknown) => {
        const body = String((req as { contents?: string }).contents ?? "");
        const urls = [...body.matchAll(/https:\/\/www\.instagram\.com\/p\/POST\d+\//g)].map(m => m[0]);
        return replyFor([...new Set(urls)]);
    });
});

describe("extractCaptionCredits, sliced", () => {
    it("reports where to resume when it does not finish", async () => {
        const { extractCaptionCredits } = await import("@/server/utils/socialCredits");
        const posts = Array.from({ length: 40 }, (_, i) => post(i));

        // A budget too small for every batch: it must stop and say where.
        const slice = await extractCaptionCredits(posts, "Artist", "artist", { budgetMs: 1 });
        expect(slice.done).toBe(false);
        expect(slice.nextBatch).toBeGreaterThan(0);
        expect(slice.nextBatch).toBeLessThan(slice.totalBatches);
        // It still did SOMETHING — a slice that returns nothing makes no
        // progress and the job would never finish.
        expect(slice.extraction.credits.length).toBeGreaterThan(0);
    });

    it("resumes from a cursor and finishes without repeating earlier batches", async () => {
        const { extractCaptionCredits } = await import("@/server/utils/socialCredits");
        const posts = Array.from({ length: 40 }, (_, i) => post(i));

        const first = await extractCaptionCredits(posts, "Artist", "artist", { budgetMs: 1 });
        const firstUrls = new Set(first.extraction.credits.map(c => c.url));

        const second = await extractCaptionCredits(posts, "Artist", "artist", {
            startBatch: first.nextBatch,
        });
        expect(second.done).toBe(true);
        expect(second.nextBatch).toBe(second.totalBatches);

        // The second slice covered different captions, which is the whole point
        // of the cursor: re-reading batch zero every time would mean an artist
        // with a long feed never reaches the end of it.
        const secondUrls = new Set(second.extraction.credits.map(c => c.url));
        for (const u of secondUrls) expect(firstUrls.has(u)).toBe(false);

        // Between them, every caption.
        expect(firstUrls.size + secondUrls.size).toBe(posts.length);
    });

    it("is done immediately when there is nothing to read", async () => {
        const { extractCaptionCredits } = await import("@/server/utils/socialCredits");
        const slice = await extractCaptionCredits([], "Artist", "artist");
        expect(slice).toMatchObject({ done: true, nextBatch: 0, totalBatches: 0 });
        // Done-with-nothing is a real outcome and must be distinguishable from
        // never-ran. The job row carries that; here we only assert it does not
        // pretend there is more to do.
        expect(slice.extraction.credits).toHaveLength(0);
    });

    it("does not start a batch it cannot finish", async () => {
        const { extractCaptionCredits } = await import("@/server/utils/socialCredits");
        const posts = Array.from({ length: 40 }, (_, i) => post(i));
        const calls = () => generateContent.mock.calls.length;

        await extractCaptionCredits(posts, "Artist", "artist", { budgetMs: 1 });
        const afterTiny = calls();

        generateContent.mockClear();
        await extractCaptionCredits(posts, "Artist", "artist");
        const afterFull = calls();

        // A tiny budget does strictly less work than an unlimited one. Without
        // the pre-check it would start every batch and lose each one to the
        // deadline, paying for all of them and keeping nothing.
        expect(afterTiny).toBeLessThan(afterFull);
    });

    it("sweeps only the captions that produced nothing", async () => {
        const { sweepSilentCaptions } = await import("@/server/utils/socialCredits");
        const posts = Array.from({ length: 16 }, (_, i) => post(i));
        const claimed = new Set(posts.slice(0, 12).map(p => p.url));

        generateContent.mockClear();
        await sweepSilentCaptions(posts, claimed, "Artist", "artist");

        const asked = generateContent.mock.calls
            .flatMap(c => [...String((c[0] as { contents?: string })?.contents ?? "")
                .matchAll(/https:\/\/www\.instagram\.com\/p\/POST\d+\//g)].map(m => m[0]));
        // Only the four unclaimed captions. Re-reading the twelve we already
        // understood is what makes a sweep expensive enough to skip.
        expect(new Set(asked)).toEqual(new Set(posts.slice(12).map(p => p.url)));
    });
});
