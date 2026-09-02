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
    getVaultSourceById: jest.fn(),
    getClaimByArtistId: jest.fn(),
    getApprovedClaimByUserId: jest.fn(),
    getApprovedClaimForArtistByUserId: jest.fn(),
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
jest.mock("@/server/utils/artistDocService", () => ({
    refreshArtistDoc: jest.fn().mockResolvedValue("rebuilt"),
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
        const { getApprovedClaimForArtistByUserId, insertVaultSource } = await import("@/server/utils/queries/dashboardQueries");
        const { addVaultSource } = await import("../dashboardActions");

        (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: "user-1", email: "user@test.com" } });
        // canEditArtist authorizes the owner via the per-artist claim lookup
        (getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue({ id: "claim-1", artistId: "artist-1" });
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
        const { getApprovedClaimForArtistByUserId } = await import("@/server/utils/queries/dashboardQueries");
        const { getUserById } = await import("@/server/utils/queries/userQueries");
        // No approved claim for THIS artist, and not an admin
        (getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);
        (getUserById as jest.Mock).mockResolvedValue({ id: "user-1", isAdmin: false });

        const result = await addVaultSource("artist-1", "https://pitchfork.com/a");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Not authorized for this artist");
        expect(insertVaultSource).not.toHaveBeenCalled();
    });
});

// Migration 0007 / partial unique index on artist_claims: a rejected claim no longer
// blocks a new claim (rejected claims persist for audit; only pending|approved are
// considered "active" by getClaimByArtistId).
describe("dashboardActions.claimArtistProfile", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    async function setup() {
        const { getServerAuthSession } = await import("@/server/auth");
        const { getClaimByArtistId, createClaim } = await import("@/server/utils/queries/dashboardQueries");
        const { claimArtistProfile } = await import("../dashboardActions");

        (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: "user-1", email: "user@test.com" } });

        return {
            claimArtistProfile,
            getClaimByArtistId: getClaimByArtistId as jest.Mock,
            createClaim: createClaim as jest.Mock,
        };
    }

    it("permits a new claim when no active claim exists (rejected-only or empty)", async () => {
        const { claimArtistProfile, getClaimByArtistId, createClaim } = await setup();
        // getClaimByArtistId is scoped to ACTIVE claims post-0007, so a row in
        // 'rejected' state surfaces as undefined here — identical to "no claim."
        getClaimByArtistId.mockResolvedValue(undefined);
        createClaim.mockResolvedValue({ id: "claim-new", referenceCode: "MN-NEW" });

        const result = await claimArtistProfile("artist-1");

        expect(result.success).toBe(true);
        expect(result.alreadyClaimed).toBeUndefined();
        expect(createClaim).toHaveBeenCalledTimes(1);
    });

    it("blocks a new claim when an active (pending) claim exists", async () => {
        const { claimArtistProfile, getClaimByArtistId, createClaim } = await setup();
        getClaimByArtistId.mockResolvedValue({ id: "claim-existing", status: "pending" });

        const result = await claimArtistProfile("artist-1");

        expect(result.success).toBe(false);
        expect(result.alreadyClaimed).toBe(true);
        expect(createClaim).not.toHaveBeenCalled();
    });

    it("blocks a new claim when an active (approved) claim exists", async () => {
        const { claimArtistProfile, getClaimByArtistId, createClaim } = await setup();
        getClaimByArtistId.mockResolvedValue({ id: "claim-existing", status: "approved" });

        const result = await claimArtistProfile("artist-1");

        expect(result.success).toBe(false);
        expect(result.alreadyClaimed).toBe(true);
        expect(createClaim).not.toHaveBeenCalled();
    });
});


describe("dashboardActions — the knowledge doc follows the sources", () => {
    beforeEach(() => { jest.resetModules(); });

    async function setup() {
        const { getServerAuthSession } = await import("@/server/auth");
        const dq = await import("@/server/utils/queries/dashboardQueries");
        const { refreshArtistDoc } = await import("@/server/utils/artistDocService");
        const actions = await import("../dashboardActions");
        getServerAuthSession.mockResolvedValue({ user: { id: "u1" } });
        dq.getVaultSourceById.mockResolvedValue({ id: "s1", artistId: "a1" });
        // Authorize through the REAL canEditArtist by giving it the approved
        // claim it reads, rather than stubbing the guard itself out.
        dq.getApprovedClaimForArtistByUserId.mockResolvedValue({ id: "c1", artistId: "a1", userId: "u1" });
        return { ...actions, dq, refreshArtistDoc };
    }

    it("rebuilds the doc when a source is REJECTED, not only when one is approved", async () => {
        // The bug this fixes. updateSourceStatus regenerated only on "approved",
        // and regenerated the About rather than the doc — so an artist removing a
        // marketplace directory from their vault kept a document that cited it
        // forever, and the Ask section kept answering from it. There is no UI for
        // the document, so nothing ever surfaced that.
        const { updateSourceStatus, refreshArtistDoc } = await setup();
        await updateSourceStatus("s1", "rejected");
        expect(refreshArtistDoc).toHaveBeenCalledWith("a1");
    });

    it("rebuilds the doc when a source is approved", async () => {
        const { updateSourceStatus, refreshArtistDoc } = await setup();
        await updateSourceStatus("s1", "approved");
        expect(refreshArtistDoc).toHaveBeenCalledWith("a1");
    });

    it("rebuilds the doc when a source is deleted outright", async () => {
        const { removeVaultSource, refreshArtistDoc } = await setup();
        await removeVaultSource("s1");
        expect(refreshArtistDoc).toHaveBeenCalledWith("a1");
    });

    it("debounces a burst so a multi-remove costs one rebuild, not one each", async () => {
        // Rebuilding is a Gemini call; clearing out five bad sources should not
        // buy five of them.
        const { updateSourceStatus, refreshArtistDoc } = await setup();
        await updateSourceStatus("s1", "rejected");
        await updateSourceStatus("s1", "rejected");
        await updateSourceStatus("s1", "rejected");
        expect(refreshArtistDoc).toHaveBeenCalledTimes(1);
    });

    it("does not fail the user's action when the rebuild throws", async () => {
        // Fire-and-forget behind an action that already succeeded — a bad Gemini
        // day must not turn a successful removal into an error.
        const { removeVaultSource, refreshArtistDoc } = await setup();
        refreshArtistDoc.mockRejectedValueOnce(new Error("gemini down"));
        await expect(removeVaultSource("s1")).resolves.toEqual({ success: true });
    });
});
