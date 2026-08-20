// @ts-nocheck
import { jest } from "@jest/globals";

jest.mock("@/lib/auth-helpers", () => ({
    requireAuth: jest.fn(),
}));
jest.mock("@/server/utils/queries/userQueries", () => ({
    getUserDisplayName: jest.requireActual("@/server/utils/queries/userQueries").getUserDisplayName,
    getUserById: jest.fn(),
}));
jest.mock("@/server/utils/queries/discord", () => ({
    sendDiscordMessage: jest.fn(),
}));
jest.mock("@/server/utils/queries/dashboardQueries", () => ({
    getApprovedClaimForArtistByUserId: jest.fn(),
}));
jest.mock("@/server/utils/artistLinkService", () => {
    class ArtistLinkConflictError extends Error {
        constructor(message) {
            super(message);
            this.name = "ArtistLinkConflictError";
        }
    }

    return {
        ArtistLinkConflictError,
        setArtistLink: jest.fn(),
        clearArtistLink: jest.fn(),
    };
});
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
        const { sendDiscordMessage } = await import("@/server/utils/queries/discord");
        const { getApprovedClaimForArtistByUserId } = await import("@/server/utils/queries/dashboardQueries");
        const { ArtistLinkConflictError, setArtistLink, clearArtistLink } = await import("@/server/utils/artistLinkService");
        const { extractArtistId } = await import("@/server/utils/services");
        const { POST } = await import("../route");
        return {
            POST,
            ArtistLinkConflictError,
            requireAuth: requireAuth as jest.Mock,
            getUserById: getUserById as jest.Mock,
            sendDiscordMessage: sendDiscordMessage as jest.Mock,
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

    it("allows admin to edit any artist and notifies Discord", async () => {
        const { POST, requireAuth, getUserById, sendDiscordMessage, extractArtistId, setArtistLink } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", username: "admin-user", isAdmin: true });
        extractArtistId.mockResolvedValue({ siteName: "x", id: "testuser", cardPlatformName: "X" });
        setArtistLink.mockResolvedValue({ oldValue: null, artistName: "Test Artist" });

        const res = await POST(makeRequest({ artistId: "a1", action: "set", url: "https://x.com/testuser" }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(setArtistLink).toHaveBeenCalledWith("a1", "x", "testuser");
        expect(sendDiscordMessage).toHaveBeenCalledWith(
            expect.stringMatching(
                /^admin-user added Test Artist's X: testuser \(Submitted URL: https:\/\/x\.com\/testuser\) \d{4}-\d{2}-\d{2}T/
            )
        );
    });

    it("allows claimed artist to edit own profile", async () => {
        const { POST, requireAuth, getUserById, sendDiscordMessage, getApprovedClaimForArtistByUserId, extractArtistId, setArtistLink } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", username: "claimed-artist", isAdmin: false });
        getApprovedClaimForArtistByUserId.mockResolvedValue({ id: "c1", artistId: "a1", userId: "u1" });
        extractArtistId.mockResolvedValue({ siteName: "instagram", id: "artist", cardPlatformName: "Instagram" });
        setArtistLink.mockResolvedValue({ oldValue: null, artistName: "Claimed Artist" });

        const res = await POST(makeRequest({ artistId: "a1", action: "set", url: "https://instagram.com/artist" }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(sendDiscordMessage).toHaveBeenCalledWith(
            expect.stringMatching(
                /^claimed-artist added Claimed Artist's Instagram: artist \(Submitted URL: https:\/\/instagram\.com\/artist\) \d{4}-\d{2}-\d{2}T/
            )
        );
    });

    it("does not notify Discord when the link value is unchanged", async () => {
        const { POST, requireAuth, getUserById, sendDiscordMessage, extractArtistId, setArtistLink } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", username: "admin-user", isAdmin: true });
        extractArtistId.mockResolvedValue({ siteName: "x", id: "testuser", cardPlatformName: "X" });
        setArtistLink.mockResolvedValue({ oldValue: "testuser", artistName: "Test Artist" });

        const res = await POST(makeRequest({ artistId: "a1", action: "set", url: "https://x.com/testuser" }));

        expect(res.status).toBe(200);
        expect(sendDiscordMessage).not.toHaveBeenCalled();
    });

    it("clears a link successfully", async () => {
        const { POST, requireAuth, getUserById, sendDiscordMessage, clearArtistLink } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", isAdmin: true });
        clearArtistLink.mockResolvedValue(undefined);

        const res = await POST(makeRequest({ artistId: "a1", action: "clear", siteName: "instagram" }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(clearArtistLink).toHaveBeenCalledWith("a1", "instagram");
        expect(sendDiscordMessage).not.toHaveBeenCalled();
    });

    it("does not notify Discord when setting the link fails", async () => {
        const { POST, requireAuth, getUserById, sendDiscordMessage, extractArtistId, setArtistLink } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", username: "admin-user", isAdmin: true });
        extractArtistId.mockResolvedValue({ siteName: "x", id: "testuser", cardPlatformName: "X" });
        setArtistLink.mockRejectedValue(new Error("Database write failed"));

        const res = await POST(makeRequest({ artistId: "a1", action: "set", url: "https://x.com/testuser" }));

        expect(res.status).toBe(500);
        expect(sendDiscordMessage).not.toHaveBeenCalled();
    });

    it("returns 409 with a conflict message when the platform identity belongs elsewhere", async () => {
        const {
            POST,
            ArtistLinkConflictError,
            requireAuth,
            getUserById,
            sendDiscordMessage,
            extractArtistId,
            setArtistLink,
        } = await setup();
        requireAuth.mockResolvedValue({ authenticated: true, session: {}, userId: "u1" });
        getUserById.mockResolvedValue({ id: "u1", username: "admin-user", isAdmin: true });
        extractArtistId.mockResolvedValue({ siteName: "spotify", id: "spotify-123", cardPlatformName: "Spotify" });
        setArtistLink.mockRejectedValue(
            new ArtistLinkConflictError(
                "That spotify artist ID is already linked to a different artist",
            ),
        );

        const res = await POST(makeRequest({
            artistId: "a1",
            action: "set",
            url: "https://open.spotify.com/artist/spotify-123",
        }));
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data).toEqual({
            error: "That spotify artist ID is already linked to a different artist",
            code: "CONFLICT",
        });
        expect(sendDiscordMessage).not.toHaveBeenCalled();
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
