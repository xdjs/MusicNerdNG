// @ts-nocheck
/**
 * How an extraction job ENDS.
 *
 * Found by running the queue with several workers against a real artist:
 * Pharaoh Sistare read every one of his captions, stored every credit, and was
 * then marked `failed` after four attempts. `refreshArtistDoc` returned false
 * because he has no document to rebuild, and the runner could not tell that
 * apart from a rebuild that broke. Every artist onboarding for the first time
 * is in exactly that state, so this was the common case, not an edge.
 */
import { jest } from "@jest/globals";

const refreshArtistDoc = jest.fn();
const completeResearchJob = jest.fn(async () => {});
const failResearchJob = jest.fn(async () => {});
const saveJobProgress = jest.fn(async () => {});
const saveJobState = jest.fn(async () => {});
const failJobAtCursor = jest.fn(async () => {});
const claimResearchJob = jest.fn();

jest.mock("@/server/utils/artistDocService", () => ({
    refreshArtistDoc: (...a) => refreshArtistDoc(...a),
    buildDocSources: jest.fn(async () => []),
}));
jest.mock("@/server/utils/queries/researchJobQueries", () => ({
    claimResearchJob: (...a) => claimResearchJob(...a),
    completeResearchJob: (...a) => completeResearchJob(...a),
    failResearchJob: (...a) => failResearchJob(...a),
    saveJobProgress: (...a) => saveJobProgress(...a),
    saveJobState: (...a) => saveJobState(...a),
    failJobAtCursor: (...a) => failJobAtCursor(...a),
    enqueueResearchJob: jest.fn(async () => true),
    reopenResearchJob: jest.fn(async () => {}),
    getResearchJobs: jest.fn(async () => []),
    isResearchComplete: jest.fn(async () => false),
    MAX_ATTEMPTS: 4,
}));

// One post, already read, already swept. This suite is only about the last step.
const POST = {
    platform: "instagram", platformPostId: "1", ownerUsername: "artist", isOwnPost: true,
    caption: "Mixed by @someone.", url: "https://www.instagram.com/p/P1/",
    postedAt: "2026-01-01T00:00:00.000Z", likeCount: 1, commentCount: 0, playCount: null,
    hashtags: [], mentions: [], coauthors: [], musicTitle: null, musicArtist: null,
};
jest.mock("@/server/utils/socialIngest", () => ({
    instagramHandleFor: jest.fn(async () => "artist"),
    hasSocialPosts: jest.fn(async () => true),
    getSocialPostsOrNull: jest.fn(async () => [POST]),
    startInstagramScrape: jest.fn(),
    checkInstagramScrape: jest.fn(),
    collectInstagramScrape: jest.fn(),
}));
jest.mock("@/server/utils/socialCredits", () => ({
    extractCaptionCredits: jest.fn(async () => ({
        done: true, nextBatch: 1, totalBatches: 1,
        extraction: { credits: [], statements: [] }, failed: false,
    })),
    sweepSilentCaptions: jest.fn(async () => ({
        done: true, nextBatch: 0, totalBatches: 0, failed: false,
        extraction: { credits: [], statements: [] },
    })),
}));
jest.mock("@/server/utils/queries/socialCreditQueries", () => ({
    clearSocialCredits: jest.fn(async () => {}),
    appendSocialCredits: jest.fn(async () => 0),
    claimedSourceUrls: jest.fn(async () => new Set()),
}));
jest.mock("@/server/utils/questionGenerator", () => ({ forgetGroundedQuestions: jest.fn() }));

const job = {
    id: "job-1", artistId: "artist-1", kind: "caption_extract",
    status: "running", cursor: 0, total: null, attempts: 0,
    // Already swept, so the run goes straight to the rebuild — the step under
    // test. mode "full" means no baseline filtering.
    state: { mode: "full", swept: true }, updatedAt: null,
};

async function advanceOnce() {
    claimResearchJob.mockResolvedValueOnce({ ...job });
    const { db } = await import("@/server/db/drizzle");
    (db.query.artists.findFirst as jest.Mock).mockResolvedValue({ name: "Test Artist", instagram: "artist" });
    const { advanceResearch } = await import("@/server/utils/researchRunner");
    return advanceResearch({ budgetMs: 60_000 });
}

describe("an extraction job that has read everything", () => {
    beforeEach(() => {
        jest.resetModules();
        for (const m of [refreshArtistDoc, completeResearchJob, failResearchJob, saveJobProgress, saveJobState, failJobAtCursor, claimResearchJob]) m.mockReset();
        completeResearchJob.mockResolvedValue(undefined);
        failResearchJob.mockResolvedValue(undefined);
        saveJobProgress.mockResolvedValue(undefined);
    });

    it("completes when there is no document to rebuild", async () => {
        // The credits are stored. That was the job.
        refreshArtistDoc.mockResolvedValue("no-document");
        const result = await advanceOnce();

        expect(completeResearchJob).toHaveBeenCalledWith("job-1");
        expect(failResearchJob).not.toHaveBeenCalled();
        expect(result.done).toBe(true);
        // And it says which case it was, so "complete" is not silently ambiguous
        // between "rebuilt the document" and "there was none".
        expect(result.progress).toContain("no document to rebuild");
    });

    it("completes when the document was rebuilt", async () => {
        refreshArtistDoc.mockResolvedValue("rebuilt");
        const result = await advanceOnce();

        expect(completeResearchJob).toHaveBeenCalledWith("job-1");
        expect(failResearchJob).not.toHaveBeenCalled();
        expect(result.progress).not.toContain("no document");
    });

    it("still fails, and retries, when the rebuild genuinely breaks", async () => {
        // The other half of the same distinction: a rebuild that throws must
        // not be quietly completed, or the document and the export stay stale
        // forever with no live job to fix them.
        refreshArtistDoc.mockResolvedValue("failed");
        const result = await advanceOnce();

        expect(failResearchJob).toHaveBeenCalledWith("job-1", expect.stringContaining("document rebuild failed"));
        expect(completeResearchJob).not.toHaveBeenCalled();
        expect(result.done).toBe(false);
    });
});
