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
    it("declines to start anything when there is no usable time left", async () => {
        const { extractCaptionCredits } = await import("@/server/utils/socialCredits");
        const posts = Array.from({ length: 40 }, (_, i) => post(i));

        // Below the minimum a model call cannot return in time, and starting
        // one anyway spends the reserve the caller keeps for writing down what
        // earlier batches found. Not-started is the correct outcome; the next
        // slice arrives with a full budget.
        const slice = await extractCaptionCredits(posts, "Artist", "artist", { budgetMs: 1 });
        expect(slice.done).toBe(false);
        expect(slice.nextBatch).toBe(0);
        expect(generateContent).not.toHaveBeenCalled();
    });

    it("reports where to resume when it runs out partway", async () => {
        const { extractCaptionCredits } = await import("@/server/utils/socialCredits");
        const posts = Array.from({ length: 40 }, (_, i) => post(i));

        // Enough to start, not enough to finish: it must stop and say where.
        const slice = await extractCaptionCredits(posts, "Artist", "artist", { budgetMs: 9_000 });
        expect(slice.done).toBe(false);
        expect(slice.nextBatch).toBeGreaterThan(0);
        expect(slice.nextBatch).toBeLessThan(slice.totalBatches);
        expect(slice.extraction.credits.length).toBeGreaterThan(0);
    });

    it("resumes from a cursor and finishes without repeating earlier batches", async () => {
        const { extractCaptionCredits } = await import("@/server/utils/socialCredits");
        const posts = Array.from({ length: 40 }, (_, i) => post(i));

        const first = await extractCaptionCredits(posts, "Artist", "artist", { budgetMs: 9_000 });
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

        // The mock has to take real time or a budget cannot bite: with instant
        // replies an unlimited run and a constrained one do identical work and
        // the test asserts nothing.
        const slow = generateContent.getMockImplementation()!;
        generateContent.mockImplementation(async (req: unknown) => {
            await new Promise(r => setTimeout(r, 120));
            return slow(req);
        });

        const constrained = await extractCaptionCredits(posts, "Artist", "artist", { budgetMs: 11_000 });
        const constrainedCalls = generateContent.mock.calls.length;

        generateContent.mockClear();
        const unlimited = await extractCaptionCredits(posts, "Artist", "artist");
        const unlimitedCalls = generateContent.mock.calls.length;

        // A constrained budget does strictly less work and says so. Without the
        // pre-check it would start every batch and lose each to the deadline,
        // paying for all of them and keeping nothing.
        expect(constrainedCalls).toBeLessThan(unlimitedCalls);
        expect(constrained.done).toBe(false);
        expect(unlimited.done).toBe(true);
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
