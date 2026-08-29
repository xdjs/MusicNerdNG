// @ts-nocheck
/**
 * The onboarding write path, and whose Instagram it writes.
 *
 * These checks guarded the vault's adoption path and nothing else — twelve uses
 * in vaultWebSearch.ts, zero in turnHandlers.ts — so the auto-build wrote
 * whatever profile discovery guessed, with nobody looking. With three Black
 * Daves in the directory it gave Black Dave an Instagram belonging to a
 * different one.
 *
 * It was invisible because the benchmark ran only the vault half of the flow.
 */
import { jest } from "@jest/globals";

const nameIsAmbiguousInDirectory = jest.fn();
const handleBelongsToAnotherArtist = jest.fn();
const contradictsScrapedPosts = jest.fn();
const setArtistLink = jest.fn();

jest.mock("@/server/utils/artistIdentityGuards", () => ({
    nameIsAmbiguousInDirectory: (...a) => nameIsAmbiguousInDirectory(...a),
    handleBelongsToAnotherArtist: (...a) => handleBelongsToAnotherArtist(...a),
    contradictsScrapedPosts: (...a) => contradictsScrapedPosts(...a),
}));
jest.mock("@/server/utils/artistLinkService", () => ({
    setArtistLink: (...a) => setArtistLink(...a),
    clearArtistLink: jest.fn(),
}));
jest.mock("@/server/utils/services", () => ({
    extractArtistId: jest.fn(async (url) =>
        url.includes("instagram") ? { siteName: "instagram", id: url.split("/").filter(Boolean).pop() } : undefined),
}));
jest.mock("@/server/utils/queries/artistQueries", () => ({
    getArtistById: jest.fn(async () => ({ id: "a1", name: "Black Dave" })),
    getAllLinks: jest.fn(async () => []),
}));

const LINK = [{ url: "https://instagram.com/blackdave" }];

async function apply(opts) {
    const { applyProfileLinkDecisions } = await import("@/server/utils/onboarding/turnHandlers");
    return applyProfileLinkDecisions("a1", LINK, [], opts);
}

describe("writing a discovered profile", () => {
    beforeEach(() => {
        jest.resetModules();
        for (const m of [nameIsAmbiguousInDirectory, handleBelongsToAnotherArtist, contradictsScrapedPosts, setArtistLink]) m.mockReset();
        nameIsAmbiguousInDirectory.mockResolvedValue(false);
        handleBelongsToAnotherArtist.mockResolvedValue(false);
        contradictsScrapedPosts.mockResolvedValue(false);
        setArtistLink.mockResolvedValue(undefined);
    });

    it("refuses a handle that belongs to another artist", async () => {
        handleBelongsToAnotherArtist.mockResolvedValue(true);
        const out = await apply({ verifyIdentity: true });
        expect(setArtistLink).not.toHaveBeenCalled();
        expect(out.identityBlocked).toEqual(["https://instagram.com/blackdave"]);
    });

    it("refuses a guess when the name is ambiguous in the directory", async () => {
        nameIsAmbiguousInDirectory.mockResolvedValue(true);
        await apply({ verifyIdentity: true });
        expect(setArtistLink).not.toHaveBeenCalled();
    });

    it("refuses a handle the artist's own scraped feed contradicts", async () => {
        contradictsScrapedPosts.mockResolvedValue(true);
        await apply({ verifyIdentity: true });
        expect(setArtistLink).not.toHaveBeenCalled();
    });

    it("writes it when every check clears", async () => {
        await apply({ verifyIdentity: true });
        expect(setArtistLink).toHaveBeenCalledWith("a1", "instagram", "blackdave");
    });

    it("does NOT check a link the artist typed themselves", async () => {
        // Two of the three callers pass links the artist entered. Blocking
        // somebody from adding their own Instagram because a similarly named
        // act exists would be a worse bug than the one being fixed.
        handleBelongsToAnotherArtist.mockResolvedValue(true);
        await apply(undefined);
        expect(setArtistLink).toHaveBeenCalledWith("a1", "instagram", "blackdave");
        expect(handleBelongsToAnotherArtist).not.toHaveBeenCalled();
    });
});
