// @ts-nocheck
import { jest } from "@jest/globals";

// Static mocks BEFORE dynamic imports
jest.mock("@/server/auth", () => ({ getServerAuthSession: jest.fn() }));
jest.mock("@/server/utils/queries/userQueries", () => ({
  getUserById: jest.fn(),
  getUserDisplayName: jest.fn(),
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
    setArtistLink: jest.fn().mockResolvedValue({ oldValue: null }),
    clearArtistLink: jest.fn().mockResolvedValue({ oldValue: null }),
  };
});
jest.mock("@/server/utils/queries/discord", () => ({
  sendDiscordMessage: jest.fn(),
}));
jest.mock("@/server/utils/ugcDiscordNotifier", () => ({
  maybePingDiscordForPendingUGC: jest.fn(),
}));
jest.mock("@/server/utils/queries/externalApiQueries", () => ({
  getSpotifyHeaders: jest.fn(),
  getSpotifyArtist: jest.fn(),
}));
jest.mock("@/server/utils/queries/artistBioQuery", () => ({
  generateArtistBio: jest.fn(),
}));
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock("@/server/utils/services", () => ({
  isObjKey: jest.fn(),
  extractArtistId: jest.fn(),
}));

// Polyfill Response.json
if (!("json" in Response)) {
  Response.json = (data, init) =>
    new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      status: init?.status || 200,
    });
}

describe("artistQueries", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function setup() {
    const { db } = await import("@/server/db/drizzle");
    const { getServerAuthSession } = await import("@/server/auth");
    const { getUserById } = await import(
      "@/server/utils/queries/userQueries"
    );
    const { extractArtistId } = await import("@/server/utils/services");
    const { ArtistLinkConflictError, setArtistLink, clearArtistLink } = await import(
      "@/server/utils/artistLinkService"
    );
    const { addArtistData, approveUgcAdmin, approveUGC, removeArtistData } = await import(
      "../artistQueries"
    );

    // Setup default db mocks
    db.execute = jest.fn().mockResolvedValue([]);
    const mockWhere = jest.fn().mockResolvedValue([]);
    const mockSet = jest.fn().mockReturnValue({ where: mockWhere });
    db.update = jest.fn().mockReturnValue({ set: mockSet });

    return {
      db,
      getServerAuthSession: getServerAuthSession as jest.Mock,
      getUserById: getUserById as jest.Mock,
      extractArtistId: extractArtistId as jest.Mock,
      ArtistLinkConflictError,
      setArtistLink: setArtistLink as jest.Mock,
      clearArtistLink: clearArtistLink as jest.Mock,
      addArtistData,
      approveUgcAdmin,
      approveUGC,
      removeArtistData,
      mockSet,
      mockWhere,
    };
  }

  // ----------------------------------
  // approveUGC tests
  // ----------------------------------

  describe("approveUGC", () => {
    it("calls setArtistLink for normal platforms (e.g. instagram)", async () => {
      const { approveUGC, setArtistLink, db } = await setup();

      await approveUGC("ugc-1", "artist-1", "instagram", "testuser");

      expect(setArtistLink).toHaveBeenCalledWith(
        "artist-1",
        "instagram",
        "testuser"
      );
      // Should also mark UGC as accepted
      expect(db.update).toHaveBeenCalled();
    });

    it("calls setArtistLink for x platform", async () => {
      const { approveUGC, setArtistLink } = await setup();

      await approveUGC("ugc-1", "artist-1", "x", "handle123");

      expect(setArtistLink).toHaveBeenCalledWith(
        "artist-1",
        "x",
        "handle123"
      );
    });

    it("handles wallets siteName inline with array_append (not setArtistLink)", async () => {
      const { approveUGC, setArtistLink, db } = await setup();

      await approveUGC("ugc-1", "artist-1", "wallets", "0xABC123");

      expect(setArtistLink).not.toHaveBeenCalled();
      // Should call db.execute for the array_append SQL
      expect(db.execute).toHaveBeenCalled();
    });

    it("handles wallet siteName inline with array_append (not setArtistLink)", async () => {
      const { approveUGC, setArtistLink, db } = await setup();

      await approveUGC("ugc-1", "artist-1", "wallet", "0xDEF456");

      expect(setArtistLink).not.toHaveBeenCalled();
      expect(db.execute).toHaveBeenCalled();
    });

    it("normalizes youtube username from full URL", async () => {
      const { approveUGC, setArtistLink } = await setup();

      await approveUGC(
        "ugc-1",
        "artist-1",
        "youtube",
        "https://youtube.com/@coolartist"
      );

      expect(setArtistLink).toHaveBeenCalledWith(
        "artist-1",
        "youtube",
        "coolartist"
      );
    });

    it("normalizes youtube username by stripping @ prefix", async () => {
      const { approveUGC, setArtistLink } = await setup();

      await approveUGC("ugc-1", "artist-1", "youtube", "@coolartist");

      expect(setArtistLink).toHaveBeenCalledWith(
        "artist-1",
        "youtube",
        "coolartist"
      );
    });

    it("passes through plain youtube username unchanged", async () => {
      const { approveUGC, setArtistLink } = await setup();

      await approveUGC("ugc-1", "artist-1", "youtube", "coolartist");

      expect(setArtistLink).toHaveBeenCalledWith(
        "artist-1",
        "youtube",
        "coolartist"
      );
    });

    it("extracts channel ID from full youtubechannel URL", async () => {
      const { approveUGC, setArtistLink } = await setup();

      await approveUGC(
        "ugc-1",
        "artist-1",
        "youtubechannel",
        "https://www.youtube.com/channel/UC1234abcd"
      );

      expect(setArtistLink).toHaveBeenCalledWith(
        "artist-1",
        "youtubechannel",
        "UC1234abcd"
      );
    });

    it("passes through raw youtubechannel ID unchanged", async () => {
      const { approveUGC, setArtistLink } = await setup();

      await approveUGC(
        "ugc-1",
        "artist-1",
        "youtubechannel",
        "UC1234abcd"
      );

      expect(setArtistLink).toHaveBeenCalledWith(
        "artist-1",
        "youtubechannel",
        "UC1234abcd"
      );
    });

    it("marks UGC record as accepted", async () => {
      const { approveUGC, db, mockSet } = await setup();

      await approveUGC("ugc-1", "artist-1", "instagram", "testuser");

      // db.update is called to set accepted = true and date_processed
      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ accepted: true, dateProcessed: expect.any(String) })
      );
    });

    it("throws on DB error", async () => {
      const { approveUGC, setArtistLink } = await setup();
      setArtistLink.mockRejectedValue(new Error("DB connection failed"));

      await expect(
        approveUGC("ugc-1", "artist-1", "instagram", "testuser")
      ).rejects.toThrow("Error approving UGC");
    });

    it("preserves typed artist-link conflicts and does not accept the UGC", async () => {
      const {
        approveUGC,
        ArtistLinkConflictError,
        setArtistLink,
        db,
      } = await setup();
      const conflict = new ArtistLinkConflictError(
        "That spotify artist ID is already linked to a different artist",
      );
      setArtistLink.mockRejectedValue(conflict);

      await expect(
        approveUGC("ugc-1", "artist-1", "spotify", "spotify-123")
      ).rejects.toBe(conflict);
      expect(db.update).not.toHaveBeenCalled();
    });

    it("throws when db.update for UGC accepted flag fails", async () => {
      const { approveUGC, db } = await setup();
      const mockWhereFail = jest
        .fn()
        .mockRejectedValue(new Error("update failed"));
      const mockSetFail = jest
        .fn()
        .mockReturnValue({ where: mockWhereFail });
      db.update = jest.fn().mockReturnValue({ set: mockSetFail });

      await expect(
        approveUGC("ugc-1", "artist-1", "instagram", "testuser")
      ).rejects.toThrow("Error approving UGC");
    });
  });

  describe("approveUgcAdmin", () => {
    it("waits for every item and reports per-ID partial failures", async () => {
      const {
        approveUgcAdmin,
        ArtistLinkConflictError,
        getServerAuthSession,
        getUserById,
        setArtistLink,
        db,
      } = await setup();
      getServerAuthSession.mockResolvedValue({ user: { id: "admin-1" } });
      getUserById.mockResolvedValue({ id: "admin-1", isAdmin: true });
      db.query.ugcresearch.findMany.mockResolvedValue([
        {
          id: "ugc-conflict",
          artistId: "artist-1",
          siteName: "spotify",
          siteUsername: "spotify-taken",
        },
        {
          id: "ugc-success",
          artistId: "artist-2",
          siteName: "instagram",
          siteUsername: "available",
        },
      ]);
      setArtistLink
        .mockRejectedValueOnce(new ArtistLinkConflictError(
          "That spotify artist ID is already linked to a different artist",
        ))
        .mockResolvedValueOnce({ oldValue: null });

      const result = await approveUgcAdmin(["ugc-conflict", "ugc-success"]);

      expect(setArtistLink).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        status: "error",
        message:
          "Approved 1 of 2 UGC items. Failed: ugc-conflict (That spotify artist ID is already linked to a different artist)",
      });
    });
  });

  describe("addArtistData", () => {
    it("returns the typed conflict message for an immediately approved link", async () => {
      const {
        addArtistData,
        ArtistLinkConflictError,
        getServerAuthSession,
        getUserById,
        extractArtistId,
        setArtistLink,
        db,
      } = await setup();
      getServerAuthSession.mockResolvedValue({ user: { id: "editor-1" } });
      getUserById.mockResolvedValue({
        id: "editor-1",
        isAdmin: false,
        isWhiteListed: true,
      });
      extractArtistId.mockResolvedValue({
        siteName: "spotify",
        id: "spotify-taken",
        cardPlatformName: "Spotify",
      });
      db.query.ugcresearch.findFirst.mockResolvedValue(null);
      const returning = jest.fn().mockResolvedValue([{
        id: "ugc-conflict",
        createdAt: "2026-08-20T00:00:00.000Z",
      }]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({ returning }),
      });
      setArtistLink.mockRejectedValue(new ArtistLinkConflictError(
        "That spotify artist ID is already linked to a different artist",
      ));

      const result = await addArtistData(
        "https://open.spotify.com/artist/spotify-taken",
        { id: "artist-1", name: "Test Artist", spotify: null },
      );

      expect(result).toEqual({
        status: "error",
        message: "That spotify artist ID is already linked to a different artist",
      });
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------
  // removeArtistData tests
  // ----------------------------------

  describe("removeArtistData", () => {
    it("throws if not authenticated", async () => {
      const { removeArtistData, getServerAuthSession } = await setup();
      getServerAuthSession.mockResolvedValue(null);

      await expect(
        removeArtistData("artist-1", "instagram")
      ).rejects.toThrow("Not authenticated");
    });

    it("returns error if user is not whitelisted or admin", async () => {
      const { removeArtistData, getServerAuthSession, getUserById } =
        await setup();
      getServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      getUserById.mockResolvedValue({
        id: "user-1",
        isAdmin: false,
        isWhiteListed: false,
      });

      const result = await removeArtistData("artist-1", "instagram");

      expect(result).toEqual({
        status: "error",
        message: "Unauthorized",
      });
    });

    it("calls clearArtistLink for normal platforms when admin", async () => {
      const {
        removeArtistData,
        getServerAuthSession,
        getUserById,
        clearArtistLink,
      } = await setup();
      getServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      getUserById.mockResolvedValue({
        id: "user-1",
        isAdmin: true,
        isWhiteListed: false,
      });

      const result = await removeArtistData("artist-1", "instagram");

      expect(clearArtistLink).toHaveBeenCalledWith(
        "artist-1",
        "instagram"
      );
      expect(result).toEqual({
        status: "success",
        message: "Artist data removed",
      });
    });

    it("calls clearArtistLink for normal platforms when whitelisted", async () => {
      const {
        removeArtistData,
        getServerAuthSession,
        getUserById,
        clearArtistLink,
      } = await setup();
      getServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      getUserById.mockResolvedValue({
        id: "user-1",
        isAdmin: false,
        isWhiteListed: true,
      });

      const result = await removeArtistData("artist-1", "x");

      expect(clearArtistLink).toHaveBeenCalledWith("artist-1", "x");
      expect(result).toEqual({
        status: "success",
        message: "Artist data removed",
      });
    });

    it("handles wallets siteName with array_remove SQL (not clearArtistLink)", async () => {
      const {
        removeArtistData,
        getServerAuthSession,
        getUserById,
        clearArtistLink,
        db,
      } = await setup();
      getServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      getUserById.mockResolvedValue({
        id: "user-1",
        isAdmin: true,
        isWhiteListed: false,
      });

      const result = await removeArtistData("artist-1", "wallets");

      expect(clearArtistLink).not.toHaveBeenCalled();
      expect(db.execute).toHaveBeenCalled();
      expect(result).toEqual({
        status: "success",
        message: "Artist data removed",
      });
    });

    it("handles wallet siteName with array_remove SQL (not clearArtistLink)", async () => {
      const {
        removeArtistData,
        getServerAuthSession,
        getUserById,
        clearArtistLink,
        db,
      } = await setup();
      getServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      getUserById.mockResolvedValue({
        id: "user-1",
        isAdmin: true,
        isWhiteListed: false,
      });

      const result = await removeArtistData("artist-1", "wallet");

      expect(clearArtistLink).not.toHaveBeenCalled();
      expect(db.execute).toHaveBeenCalled();
      expect(result).toEqual({
        status: "success",
        message: "Artist data removed",
      });
    });

    it("catches whitelist validation errors from clearArtistLink and returns invalid platform message", async () => {
      const {
        removeArtistData,
        getServerAuthSession,
        getUserById,
        clearArtistLink,
      } = await setup();
      getServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      getUserById.mockResolvedValue({
        id: "user-1",
        isAdmin: true,
        isWhiteListed: false,
      });
      clearArtistLink.mockRejectedValue(
        new Error("Column not in writable whitelist: name")
      );

      const result = await removeArtistData("artist-1", "name");

      expect(result).toEqual({
        status: "error",
        message: "Invalid platform column",
      });
    });

    it("returns generic error for unexpected exceptions from clearArtistLink", async () => {
      const {
        removeArtistData,
        getServerAuthSession,
        getUserById,
        clearArtistLink,
      } = await setup();
      getServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      getUserById.mockResolvedValue({
        id: "user-1",
        isAdmin: true,
        isWhiteListed: false,
      });
      clearArtistLink.mockRejectedValue(new Error("Unexpected DB error"));

      const result = await removeArtistData("artist-1", "instagram");

      expect(result).toEqual({
        status: "error",
        message: "Error removing artist data",
      });
    });

    it("returns success on happy path", async () => {
      const {
        removeArtistData,
        getServerAuthSession,
        getUserById,
        clearArtistLink,
      } = await setup();
      getServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      getUserById.mockResolvedValue({
        id: "user-1",
        isAdmin: true,
        isWhiteListed: false,
      });
      clearArtistLink.mockResolvedValue({ oldValue: "old-handle" });

      const result = await removeArtistData("artist-1", "tiktok");

      expect(clearArtistLink).toHaveBeenCalledWith("artist-1", "tiktok");
      expect(result).toEqual({
        status: "success",
        message: "Artist data removed",
      });
    });

    it("returns error when session user id is missing (getUserById returns null)", async () => {
      const { removeArtistData, getServerAuthSession, getUserById } =
        await setup();
      getServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      getUserById.mockResolvedValue(null);

      const result = await removeArtistData("artist-1", "instagram");

      expect(result).toEqual({
        status: "error",
        message: "Unauthorized",
      });
    });
  });
});
