// @ts-nocheck
import { jest } from "@jest/globals";

jest.mock("@/server/auth", () => ({
    getServerAuthSession: jest.fn(),
}));
jest.mock("@/server/utils/dev-auth", () => ({
    getDevSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/server/utils/queries/userQueries", () => ({
    getUserById: jest.fn(),
}));
jest.mock("@/server/utils/queries/dashboardQueries", () => ({
    createClaim: jest.fn(),
    getClaimByArtistId: jest.fn(),
    getApprovedClaimByUserId: jest.fn(),
    getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
    getVaultSourceByIdAndArtist: jest.fn(),
    updateVaultSourceStatus: jest.fn(),
    updateVaultSourceType: jest.fn(),
    seedMockVaultSources: jest.fn(),
    insertVaultSource: jest.fn(),
    deleteVaultSource: jest.fn(),
    deleteVaultSources: jest.fn(),
    deleteClaim: jest.fn(),
    updateVaultSourceContent: jest.fn().mockResolvedValue(undefined),
    getBioVersionsByArtistId: jest.fn(),
    saveBioVersion: jest.fn(),
    pinBioVersion: jest.fn(),
    deleteBioVersion: jest.fn(),
}));
jest.mock("@/server/utils/queries/vaultWebSearch", () => ({
    searchAndPopulateVault: jest.fn().mockResolvedValue(0),
}));
jest.mock("@/server/utils/queries/artistBioQuery", () => ({
    generateArtistBio: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/server/utils/queries/discord", () => ({
    sendDiscordMessage: jest.fn().mockResolvedValue(undefined),
}));
// Keep the real isUnsafeUrl implementation — stub only the fire-and-forget fetch.
jest.mock("@/server/utils/fetchPageContent", () => {
    const actual = jest.requireActual("@/server/utils/fetchPageContent");
    return {
        ...actual,
        fetchPageContent: jest.fn().mockResolvedValue({ title: "mock", snippet: undefined, extractedText: null }),
    };
});

describe("dashboardActions.addVaultSource", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    async function setup() {
        const { getServerAuthSession } = await import("@/server/auth");
        const { getApprovedClaimByUserId, insertVaultSource } = await import("@/server/utils/queries/dashboardQueries");
        const { addVaultSource } = await import("../dashboardActions");

        (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: "user-1", email: "user@test.com" } });
        (getApprovedClaimByUserId as jest.Mock).mockResolvedValue({ id: "claim-1", artistId: "artist-1" });
        (insertVaultSource as jest.Mock).mockResolvedValue({ id: "source-1" });

        return {
            addVaultSource,
            insertVaultSource: insertVaultSource as jest.Mock,
        };
    }

    it("rejects javascript: URLs without touching the DB", async () => {
        const { addVaultSource, insertVaultSource } = await setup();

        const result = await addVaultSource("artist-1", "javascript:alert(document.cookie)");

        expect(result.success).toBe(false);
        expect(result.error).toBe("URL must be a public http or https address");
        expect(insertVaultSource).not.toHaveBeenCalled();
    });

    it("rejects data: URLs", async () => {
        const { addVaultSource, insertVaultSource } = await setup();

        const result = await addVaultSource("artist-1", "data:text/html,<script>alert(1)</script>");

        expect(result.success).toBe(false);
        expect(result.error).toBe("URL must be a public http or https address");
        expect(insertVaultSource).not.toHaveBeenCalled();
    });

    it("rejects file: URLs", async () => {
        const { addVaultSource, insertVaultSource } = await setup();

        const result = await addVaultSource("artist-1", "file:///etc/passwd");

        expect(result.success).toBe(false);
        expect(insertVaultSource).not.toHaveBeenCalled();
    });

    it("rejects private/loopback hosts", async () => {
        const { addVaultSource, insertVaultSource } = await setup();

        const result = await addVaultSource("artist-1", "http://169.254.169.254/latest/meta-data/");

        expect(result.success).toBe(false);
        expect(insertVaultSource).not.toHaveBeenCalled();
    });

    it("accepts a normal public https URL", async () => {
        const { addVaultSource, insertVaultSource } = await setup();

        const result = await addVaultSource("artist-1", "https://pitchfork.com/reviews/albums/example");

        expect(result.success).toBe(true);
        expect(insertVaultSource).toHaveBeenCalledTimes(1);
        expect(insertVaultSource).toHaveBeenCalledWith(expect.objectContaining({
            artistId: "artist-1",
            url: "https://pitchfork.com/reviews/albums/example",
            status: "pending",
        }));
    });

    it("rejects when session is missing", async () => {
        const { addVaultSource, insertVaultSource } = await setup();
        const { getServerAuthSession } = await import("@/server/auth");
        (getServerAuthSession as jest.Mock).mockResolvedValue(null);

        const result = await addVaultSource("artist-1", "https://pitchfork.com/a");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Not authenticated");
        expect(insertVaultSource).not.toHaveBeenCalled();
    });

    it("rejects when the user's claim is for a different artist", async () => {
        const { addVaultSource, insertVaultSource } = await setup();
        const { getApprovedClaimByUserId } = await import("@/server/utils/queries/dashboardQueries");
        (getApprovedClaimByUserId as jest.Mock).mockResolvedValue({ id: "claim-1", artistId: "other-artist" });

        const result = await addVaultSource("artist-1", "https://pitchfork.com/a");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Not authorized for this artist");
        expect(insertVaultSource).not.toHaveBeenCalled();
    });
});
