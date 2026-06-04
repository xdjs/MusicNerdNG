// @ts-nocheck
import { jest } from "@jest/globals";

jest.mock("@/lib/auth-helpers", () => ({
    requireAuth: jest.fn(),
}));
jest.mock("@/server/utils/queries/userQueries", () => ({
    getUserById: jest.fn(),
}));
jest.mock("@/server/utils/queries/dashboardQueries", () => ({
    getApprovedClaimForArtistByUserId: jest.fn(),
}));
jest.mock("@/server/utils/artistLinkService", () => ({
    setArtistLink: jest.fn(),
    clearArtistLink: jest.fn(),
}));
jest.mock("@/server/utils/services", () => ({
    extractArtistId: jest.fn(),
}));

if (!("json" in Response)) {
    Response.json = (data, init) =>
        new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
            status: init?.status || 200,
        });
}

describe("POST /api/directEditLink", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    async function setup() {
        const { requireAuth } = await import("@/lib/auth-helpers");
        const { getUserById } = await import("@/server/utils/queries/userQueries");
        const { getApprovedClaimForArtistByUserId } = await import("@/server/utils/queries/dashboardQueries");
        const { setArtistLink, clearArtistLink } = await import("@/server/utils/artistLinkService");
        const { extractArtistId } = await import("@/server/utils/services");
        const { POST } = await import("../route");
        return {
            POST,
            requireAuth: requireAuth as jest.Mock,
            getUserById: getUserById as jest.Mock,
            getApprovedClaimForArtistByUserId: getApprovedClaimForArtistByUserId as jest.Mock,
            setArtistLink: setArtistLink as jest.Mock,
            clearArtistLink: clearArtistLink as jest.Mock,
            extractArtistId: extractArtistId as jest.Mock,
        };
    }

    function makeRequest(body: object) {
        return new Request("https://localhost/api/directEditLink", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    it("returns 401 when not authenticated", async () => {
        const { POST, requireAuth } = await setup();
        requireAuth.mockResolvedValue({
            authenticated: false,
            response: Response.json({ error: "Not authenticated" }, { status: 401 }),
        });

        const res = await POST(makeRequest({ artistId: "a1", action: "set", url: "https://x.com/test" }));
        expect(res.status).toBe(401);
    });

    it("returns 400 when artistId or action missing", async () => {
        const { POST, requireAuth } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });

        const res = await POST(makeRequest({ action: "set" }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.error).toMatch(/artistId/);
    });

    it("returns 403 when non-admin has no claim", async () => {
        const { POST, requireAuth, getUserById, getApprovedClaimForArtistByUserId } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", isAdmin: false });
        getApprovedClaimForArtistByUserId.mockResolvedValue(null);

        const res = await POST(makeRequest({ artistId: "a1", action: "set", url: "https://x.com/test" }));
        expect(res.status).toBe(403);
    });

    it("allows admin to edit any artist", async () => {
        const { POST, requireAuth, getUserById, extractArtistId, setArtistLink } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", isAdmin: true });
        extractArtistId.mockResolvedValue({ siteName: "x", id: "testuser", cardPlatformName: "X" });
        setArtistLink.mockResolvedValue(undefined);

        const res = await POST(makeRequest({ artistId: "a1", action: "set", url: "https://x.com/testuser" }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(setArtistLink).toHaveBeenCalledWith("a1", "x", "testuser");
    });

    it("allows claimed artist to edit own profile", async () => {
        const { POST, requireAuth, getUserById, getApprovedClaimForArtistByUserId, extractArtistId, setArtistLink } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", isAdmin: false });
        getApprovedClaimForArtistByUserId.mockResolvedValue({ id: "c1", artistId: "a1", userId: "u1" });
        extractArtistId.mockResolvedValue({ siteName: "instagram", id: "artist", cardPlatformName: "Instagram" });
        setArtistLink.mockResolvedValue(undefined);

        const res = await POST(makeRequest({ artistId: "a1", action: "set", url: "https://instagram.com/artist" }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
    });

    it("clears a link successfully", async () => {
        const { POST, requireAuth, getUserById, clearArtistLink } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", isAdmin: true });
        clearArtistLink.mockResolvedValue(undefined);

        const res = await POST(makeRequest({ artistId: "a1", action: "clear", siteName: "instagram" }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(clearArtistLink).toHaveBeenCalledWith("a1", "instagram");
    });

    it("returns 400 when url missing for set action", async () => {
        const { POST, requireAuth, getUserById } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", isAdmin: true });

        const res = await POST(makeRequest({ artistId: "a1", action: "set" }));
        expect(res.status).toBe(400);
    });

    it("returns 400 when siteName missing for clear action", async () => {
        const { POST, requireAuth, getUserById } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", isAdmin: true });

        const res = await POST(makeRequest({ artistId: "a1", action: "clear" }));
        expect(res.status).toBe(400);
    });

    it("returns 400 when extractArtistId fails", async () => {
        const { POST, requireAuth, getUserById, extractArtistId } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", isAdmin: true });
        extractArtistId.mockResolvedValue(null);

        const res = await POST(makeRequest({ artistId: "a1", action: "set", url: "https://unknown.com/foo" }));
        expect(res.status).toBe(400);
    });
});
