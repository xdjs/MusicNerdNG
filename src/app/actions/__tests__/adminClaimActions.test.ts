// @ts-nocheck
import { jest } from "@jest/globals";

jest.mock("@/server/auth", () => ({
    getServerAuthSession: jest.fn(),
}));
jest.mock("@/server/utils/queries/userQueries", () => ({
    getUserById: jest.fn(),
}));
jest.mock("@/server/utils/queries/dashboardQueries", () => ({
    approveClaim: jest.fn(),
    rejectClaim: jest.fn(),
    deleteClaim: jest.fn(),
    getAllClaims: jest.fn(),
    getClaimById: jest.fn(),
    revokeApprovedClaim: jest.fn(),
}));
jest.mock("@/server/utils/queries/vaultWebSearch", () => ({
    searchAndPopulateVault: jest.fn().mockResolvedValue(0),
}));
jest.mock("@/server/utils/queries/discord", () => ({
    sendDiscordMessage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/app/api/mcp/audit", () => ({
    logMcpAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/server/lib/supabase", () => {
    const list = jest.fn().mockResolvedValue({ data: [], error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn(() => ({ list, remove }));
    return {
        getSupabaseAdmin: jest.fn(() => ({ storage: { from } })),
        VAULT_BUCKET: "vault-files",
        __storageMocks: { list, remove, from },
    };
});

describe("adminClaimActions", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    async function setup() {
        const { getServerAuthSession } = await import("@/server/auth");
        const { getUserById } = await import("@/server/utils/queries/userQueries");
        const { approveClaim, rejectClaim, deleteClaim, getAllClaims, getClaimById, revokeApprovedClaim } = await import("@/server/utils/queries/dashboardQueries");
        const { searchAndPopulateVault } = await import("@/server/utils/queries/vaultWebSearch");
        const supabaseMod = await import("@/server/lib/supabase");
        const storageMocks = (supabaseMod as any).__storageMocks;
        const { approveClaimAction, rejectClaimAction, revokeClaimAction, getAdminAllClaims } = await import("../adminClaimActions");

        return {
            getServerAuthSession: getServerAuthSession as jest.Mock,
            getUserById: getUserById as jest.Mock,
            approveClaim: approveClaim as jest.Mock,
            rejectClaim: rejectClaim as jest.Mock,
            deleteClaim: deleteClaim as jest.Mock,
            getAllClaims: getAllClaims as jest.Mock,
            getClaimById: getClaimById as jest.Mock,
            revokeApprovedClaim: revokeApprovedClaim as jest.Mock,
            searchAndPopulateVault: searchAndPopulateVault as jest.Mock,
            storageList: storageMocks.list as jest.Mock,
            storageRemove: storageMocks.remove as jest.Mock,
            storageFrom: storageMocks.from as jest.Mock,
            approveClaimAction,
            rejectClaimAction,
            revokeClaimAction,
            getAdminAllClaims,
        };
    }

    function mockAdmin(mocks: { getServerAuthSession: jest.Mock; getUserById: jest.Mock }) {
        mocks.getServerAuthSession.mockResolvedValue({ user: { id: "admin-1", email: "admin@test.com" } });
        mocks.getUserById.mockResolvedValue({ id: "admin-1", isAdmin: true });
    }

    function mockNonAdmin(mocks: { getServerAuthSession: jest.Mock; getUserById: jest.Mock }) {
        mocks.getServerAuthSession.mockResolvedValue({ user: { id: "user-1", email: "user@test.com" } });
        mocks.getUserById.mockResolvedValue({ id: "user-1", isAdmin: false });
    }

    describe("approveClaimAction", () => {
        it("approves a claim and triggers vault population", async () => {
            const m = await setup();
            mockAdmin(m);
            m.approveClaim.mockResolvedValue({ id: "c1", artistId: "a1", referenceCode: "MN-TEST" });

            const result = await m.approveClaimAction("c1");
            expect(result.success).toBe(true);
            expect(m.approveClaim).toHaveBeenCalledWith("c1");
            expect(m.searchAndPopulateVault).toHaveBeenCalledWith("a1");
        });

        it("rejects non-admin", async () => {
            const m = await setup();
            mockNonAdmin(m);

            const result = await m.approveClaimAction("c1");
            expect(result.success).toBe(false);
            expect(result.error).toBe("Not authorized");
        });

        it("returns error when claim not found", async () => {
            const m = await setup();
            mockAdmin(m);
            m.approveClaim.mockResolvedValue(undefined);

            const result = await m.approveClaimAction("nonexistent");
            expect(result.success).toBe(false);
            expect(result.error).toBe("Claim not found");
        });
    });

    describe("rejectClaimAction", () => {
        it("rejects a claim when admin", async () => {
            const m = await setup();
            mockAdmin(m);
            m.rejectClaim.mockResolvedValue({ id: "c1", artistId: "a1", referenceCode: "MN-TEST" });

            const result = await m.rejectClaimAction("c1");
            expect(result.success).toBe(true);
            expect(m.rejectClaim).toHaveBeenCalledWith("c1");
        });

        it("rejects non-admin", async () => {
            const m = await setup();
            mockNonAdmin(m);

            const result = await m.rejectClaimAction("c1");
            expect(result.success).toBe(false);
            expect(result.error).toBe("Not authorized");
        });
    });

    describe("revokeClaimAction", () => {
        it("hard-deletes an approved claim + purges vault storage when admin", async () => {
            const m = await setup();
            mockAdmin(m);
            m.getClaimById.mockResolvedValue({ id: "c1", artistId: "a1", status: "approved", referenceCode: "MN-REVK" });
            m.revokeApprovedClaim.mockResolvedValue({ id: "c1", artistId: "a1", status: "approved", referenceCode: "MN-REVK" });
            m.storageList.mockResolvedValue({ data: [{ name: "123_file.pdf" }, { name: "456_image.png" }], error: null });
            m.storageRemove.mockResolvedValue({ error: null });

            const result = await m.revokeClaimAction("c1");
            expect(result.success).toBe(true);
            expect(m.getClaimById).toHaveBeenCalledWith("c1");
            expect(m.revokeApprovedClaim).toHaveBeenCalledWith("c1");
            expect(m.storageList).toHaveBeenCalledWith("a1", { limit: 1000, offset: 0 });
            expect(m.storageRemove).toHaveBeenCalledWith(["a1/123_file.pdf", "a1/456_image.png"]);
        });

        it("paginates storage purge for artists with >1000 files", async () => {
            const m = await setup();
            mockAdmin(m);
            m.getClaimById.mockResolvedValue({ id: "c1", artistId: "a1", status: "approved", referenceCode: "MN-REVK" });
            m.revokeApprovedClaim.mockResolvedValue({ id: "c1", artistId: "a1", status: "approved", referenceCode: "MN-REVK" });

            // First list() returns 1000 files (full page → another page may exist),
            // second returns 3 files (short page → done).
            const firstPage = Array.from({ length: 1000 }, (_, i) => ({ name: `file_${i}.pdf` }));
            const secondPage = [{ name: "final_a.pdf" }, { name: "final_b.pdf" }, { name: "final_c.pdf" }];
            m.storageList
                .mockResolvedValueOnce({ data: firstPage, error: null })
                .mockResolvedValueOnce({ data: secondPage, error: null });
            m.storageRemove.mockResolvedValue({ error: null });

            const result = await m.revokeClaimAction("c1");
            expect(result.success).toBe(true);
            expect(m.storageList).toHaveBeenCalledTimes(2);
            expect(m.storageRemove).toHaveBeenCalledTimes(2);
            expect(m.storageRemove).toHaveBeenNthCalledWith(2, ["a1/final_a.pdf", "a1/final_b.pdf", "a1/final_c.pdf"]);
        });

        it("succeeds even when vault storage is empty", async () => {
            const m = await setup();
            mockAdmin(m);
            m.getClaimById.mockResolvedValue({ id: "c1", artistId: "a1", status: "approved", referenceCode: "MN-REVK" });
            m.revokeApprovedClaim.mockResolvedValue({ id: "c1", artistId: "a1", status: "approved", referenceCode: "MN-REVK" });
            m.storageList.mockResolvedValue({ data: [], error: null });

            const result = await m.revokeClaimAction("c1");
            expect(result.success).toBe(true);
            expect(m.storageRemove).not.toHaveBeenCalled();
        });

        it("still succeeds when storage cleanup fails (best-effort)", async () => {
            const m = await setup();
            mockAdmin(m);
            m.getClaimById.mockResolvedValue({ id: "c1", artistId: "a1", status: "approved", referenceCode: "MN-REVK" });
            m.revokeApprovedClaim.mockResolvedValue({ id: "c1", artistId: "a1", status: "approved", referenceCode: "MN-REVK" });
            m.storageList.mockResolvedValue({ data: null, error: { message: "bucket unreachable" } });

            const result = await m.revokeClaimAction("c1");
            expect(result.success).toBe(true);
        });

        it("rejects revoking a pending claim", async () => {
            const m = await setup();
            mockAdmin(m);
            m.getClaimById.mockResolvedValue({ id: "c1", artistId: "a1", status: "pending" });

            const result = await m.revokeClaimAction("c1");
            expect(result.success).toBe(false);
            expect(result.error).toBe("Can only revoke approved claims");
            expect(m.revokeApprovedClaim).not.toHaveBeenCalled();
            expect(m.storageList).not.toHaveBeenCalled();
        });

        it("returns error when status changed between preflight and transaction", async () => {
            const m = await setup();
            mockAdmin(m);
            m.getClaimById.mockResolvedValue({ id: "c1", artistId: "a1", status: "approved", referenceCode: "MN-REVK" });
            m.revokeApprovedClaim.mockResolvedValue(undefined);

            const result = await m.revokeClaimAction("c1");
            expect(result.success).toBe(false);
            expect(result.error).toBe("Claim is no longer approved");
            expect(m.storageList).not.toHaveBeenCalled();
        });

        it("rejects non-admin", async () => {
            const m = await setup();
            mockNonAdmin(m);

            const result = await m.revokeClaimAction("c1");
            expect(result.success).toBe(false);
            expect(result.error).toBe("Not authorized");
        });

        it("returns error when claim not found", async () => {
            const m = await setup();
            mockAdmin(m);
            m.getClaimById.mockResolvedValue(undefined);

            const result = await m.revokeClaimAction("nonexistent");
            expect(result.success).toBe(false);
            expect(result.error).toBe("Claim not found");
        });
    });

    describe("getAdminAllClaims", () => {
        it("returns claims for admin", async () => {
            const m = await setup();
            mockAdmin(m);
            m.getAllClaims.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);

            const result = await m.getAdminAllClaims();
            expect(result).toHaveLength(2);
        });

        it("returns empty for non-admin", async () => {
            const m = await setup();
            mockNonAdmin(m);

            const result = await m.getAdminAllClaims();
            expect(result).toEqual([]);
        });
    });
});
