// @ts-nocheck
import { jest } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

// Mock regenerateArtistBio before any dynamic imports
jest.mock("@/server/utils/queries/artistBioQuery", () => ({
  regenerateArtistBio: jest.fn().mockResolvedValue("mocked bio"),
}));

describe("artistLinkService", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function setup() {
    const { db } = await import("@/server/db/drizzle");
    db.execute = jest.fn().mockResolvedValue([]);
    db.transaction = jest.fn(async (callback) => callback(db));
    // Mock artist existence check - return a found artist by default
    (db as any).query.artists.findFirst = jest.fn().mockResolvedValue({ id: "artist-123", name: "Test Artist" });
    (db as any).query.artistIdMappings = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
    };
    const { regenerateArtistBio } = await import("@/server/utils/queries/artistBioQuery");
    const {
      ArtistLinkConflictError,
      setArtistLink,
      clearArtistLink,
      sanitizeColumnName,
    } = await import("../artistLinkService");
    return {
      db,
      ArtistLinkConflictError,
      setArtistLink,
      clearArtistLink,
      sanitizeColumnName,
      regenerateArtistBio,
    };
  }

  // 1. sanitizeColumnName strips non-alphanumeric/underscore
  it("sanitizeColumnName strips non-alphanumeric/underscore characters", async () => {
    const { sanitizeColumnName } = await setup();
    expect(sanitizeColumnName("site.name!@#")).toBe("sitename");
  });

  // 2. sanitizeColumnName passes through clean names unchanged
  it("sanitizeColumnName passes through clean names unchanged", async () => {
    const { sanitizeColumnName } = await setup();
    expect(sanitizeColumnName("instagram")).toBe("instagram");
    expect(sanitizeColumnName("youtube_channel")).toBe("youtube_channel");
  });

  // 3. setArtistLink sets a generic text column and returns artist context
  it("setArtistLink sets a generic text column via sql.identifier", async () => {
    const { db, setArtistLink } = await setup();
    const result = await setArtistLink("artist-123", "instagram", "testuser");
    expect(db.execute).toHaveBeenCalled();
    expect(result).toEqual({ oldValue: null, artistName: "Test Artist" });
  });

  // 4. setArtistLink sets ens directly
  it("setArtistLink sets ens directly", async () => {
    const { db, setArtistLink, regenerateArtistBio } = await setup();
    const result = await setArtistLink("artist-123", "ens", "vitalik.eth");
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(regenerateArtistBio).not.toHaveBeenCalled();
    expect(result).toEqual({ oldValue: null, artistName: "Test Artist" });
  });

  // 5. setArtistLink no longer auto-regenerates the bio on a link change (it used
  // to, which clobbered artist edits + re-ran generation on every submission).
  it("setArtistLink does NOT regenerate the bio on a prompt-relevant column change", async () => {
    const { db, setArtistLink, regenerateArtistBio } = await setup();
    await setArtistLink("artist-123", "instagram", "testuser");
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(regenerateArtistBio).not.toHaveBeenCalled();
  });

  // 6. setArtistLink does NOT trigger bio regen for non-relevant column
  it("setArtistLink does NOT trigger bio regeneration for non-relevant column", async () => {
    const { db, setArtistLink, regenerateArtistBio } = await setup();
    await setArtistLink("artist-123", "tiktok", "testuser");
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(regenerateArtistBio).not.toHaveBeenCalled();
  });

  // 7. setArtistLink throws for wallets
  it("setArtistLink throws for wallets siteName", async () => {
    const { setArtistLink } = await setup();
    await expect(setArtistLink("artist-123", "wallets", "0x123")).rejects.toThrow("Wallets must be managed");
  });

  // 8. setArtistLink throws for system column
  it("setArtistLink throws for system column siteName", async () => {
    const { setArtistLink } = await setup();
    await expect(setArtistLink("artist-123", "name", "test")).rejects.toThrow("Column not in writable whitelist");
    await expect(setArtistLink("artist-123", "id", "test")).rejects.toThrow("Column not in writable whitelist");
    await expect(setArtistLink("artist-123", "bio", "test")).rejects.toThrow("Column not in writable whitelist");
  });

  // 9. setArtistLink throws for empty value
  it("setArtistLink throws for empty value", async () => {
    const { setArtistLink } = await setup();
    await expect(setArtistLink("artist-123", "instagram", "")).rejects.toThrow("Value must not be empty");
  });

  // 10. clearArtistLink nulls a generic text column and returns oldValue
  it("clearArtistLink nulls a generic text column", async () => {
    const { db, clearArtistLink } = await setup();
    const result = await clearArtistLink("artist-123", "instagram");
    expect(db.execute).toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(result).toEqual({ oldValue: null });
  });

  // 11. clearArtistLink no longer auto-regenerates the bio on a link change.
  it("clearArtistLink does NOT regenerate the bio on a prompt-relevant column change", async () => {
    const { db, clearArtistLink, regenerateArtistBio } = await setup();
    await clearArtistLink("artist-123", "x");
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(regenerateArtistBio).not.toHaveBeenCalled();
  });

  // 12. clearArtistLink does NOT trigger bio regen for non-relevant column
  it("clearArtistLink does NOT trigger bio regeneration for non-relevant column", async () => {
    const { db, clearArtistLink, regenerateArtistBio } = await setup();
    await clearArtistLink("artist-123", "tiktok");
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(regenerateArtistBio).not.toHaveBeenCalled();
  });

  // 13. clearArtistLink throws for wallets
  it("clearArtistLink throws for wallets siteName", async () => {
    const { clearArtistLink } = await setup();
    await expect(clearArtistLink("artist-123", "wallets")).rejects.toThrow("Wallets must be managed");
  });

  // 14. clearArtistLink throws for system column
  it("clearArtistLink throws for system column siteName", async () => {
    const { clearArtistLink } = await setup();
    await expect(clearArtistLink("artist-123", "name")).rejects.toThrow("Column not in writable whitelist");
  });

  // 15. setArtistLink throws for empty sanitized column name
  it("setArtistLink throws for empty sanitized column name", async () => {
    const { setArtistLink } = await setup();
    await expect(setArtistLink("artist-123", "!@#", "val")).rejects.toThrow("Invalid column name");
  });

  // 16. setArtistLink throws for non-existent artist
  it("setArtistLink throws for non-existent artist", async () => {
    const { db, setArtistLink } = await setup();
    (db as any).query.artists.findFirst.mockResolvedValue(null);
    await expect(setArtistLink("nonexistent-id", "instagram", "testuser")).rejects.toThrow("Artist not found");
  });

  // 17. clearArtistLink throws for non-existent artist
  it("clearArtistLink throws for non-existent artist", async () => {
    const { db, clearArtistLink } = await setup();
    (db as any).query.artists.findFirst.mockResolvedValue(null);
    await expect(clearArtistLink("nonexistent-id", "instagram")).rejects.toThrow("Artist not found");
  });

  // 18. setArtistLink returns old value when column has existing data
  it("setArtistLink returns old value when overwriting", async () => {
    const { db, setArtistLink } = await setup();
    (db as any).query.artists.findFirst.mockResolvedValue({ id: "artist-123", name: "Test Artist", instagram: "old-user" });
    const result = await setArtistLink("artist-123", "instagram", "new-user");
    expect(result).toEqual({ oldValue: "old-user", artistName: "Test Artist" });
  });

  it("serializes a first-class ID write inside a transaction", async () => {
    const { db, setArtistLink } = await setup();

    await setArtistLink("artist-123", "spotify", "spotify-123");

    expect(db.transaction).toHaveBeenCalledTimes(1);
    // Stable artist/platform lock + external ID lock + artist update.
    expect(db.execute).toHaveBeenCalledTimes(3);
    expect(
      db.execute.mock.calls.slice(0, 2).map(([query]) =>
        dialect.sqlToQuery(query).params[0]
      ),
    ).toEqual([
      "musicnerd:artist-platform-slot:artist-123:spotify",
      "musicnerd:artist-platform:spotify:spotify-123",
    ]);
    expect(db.execute.mock.invocationCallOrder[1]).toBeLessThan(
      (db as any).query.artists.findFirst.mock.invocationCallOrder[0],
    );
  });

  it.each(["spotify", "deezer"])(
    "rejects a %s ID directly owned by another artist",
    async (platform) => {
      const { db, ArtistLinkConflictError, setArtistLink } = await setup();
      (db as any).query.artists.findFirst
        .mockResolvedValueOnce({ id: "artist-123", name: "Test Artist" })
        .mockResolvedValueOnce({ id: "other-artist" });

      const result = setArtistLink(
        "artist-123",
        platform,
        `${platform}-123`,
      );
      await expect(result).rejects.toBeInstanceOf(ArtistLinkConflictError);
      await expect(result).rejects.toThrow(
        `That ${platform} artist ID is already linked to a different artist`,
      );
      expect(db.execute).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects a first-class ID mapped to another artist", async () => {
    const { db, ArtistLinkConflictError, setArtistLink } = await setup();
    (db as any).query.artistIdMappings.findFirst
      .mockResolvedValueOnce({ artistId: "other-artist" })
      .mockResolvedValueOnce(null);

    const result = setArtistLink("artist-123", "spotify", "spotify-123");
    await expect(result).rejects.toBeInstanceOf(ArtistLinkConflictError);
    await expect(result).rejects.toThrow(
      "That spotify artist ID conflicts with an existing artist mapping",
    );
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("rejects a direct ID that diverges from the artist's existing mapping", async () => {
    const { db, ArtistLinkConflictError, setArtistLink } = await setup();
    (db as any).query.artistIdMappings.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ platformId: "mapped-spotify-id" });

    const result = setArtistLink(
      "artist-123",
      "spotify",
      "different-spotify-id",
    );
    await expect(result).rejects.toBeInstanceOf(ArtistLinkConflictError);
    await expect(result).rejects.toThrow(
      "That spotify artist ID conflicts with an existing artist mapping",
    );
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it.each(["spotify", "deezer"])(
    "allows a %s ID directly owned by the same artist",
    async (platform) => {
      const { db, setArtistLink } = await setup();
      (db as any).query.artists.findFirst
        .mockResolvedValueOnce({ id: "artist-123", name: "Test Artist" })
        .mockResolvedValueOnce({ id: "artist-123" });

      await expect(
        setArtistLink("artist-123", platform, `${platform}-123`),
      ).resolves.toEqual({ oldValue: null, artistName: "Test Artist" });
      expect(db.execute).toHaveBeenCalledTimes(3);
    },
  );

  it.each(["spotify", "deezer"])(
    "serializes a %s clear under the artist/platform slot lock",
    async (platform) => {
      const { db, clearArtistLink } = await setup();
      (db as any).query.artists.findFirst.mockResolvedValue({
        id: "artist-123",
        name: "Test Artist",
        [platform]: `${platform}-123`,
      });

      await expect(
        clearArtistLink("artist-123", platform),
      ).resolves.toEqual({ oldValue: `${platform}-123` });

      expect(db.transaction).toHaveBeenCalledTimes(1);
      // Stable artist/platform slot lock, followed by the artist update.
      expect(db.execute).toHaveBeenCalledTimes(2);
      expect(dialect.sqlToQuery(db.execute.mock.calls[0][0]).params[0]).toBe(
        `musicnerd:artist-platform-slot:artist-123:${platform}`,
      );
      expect(db.execute.mock.invocationCallOrder[0]).toBeLessThan(
        (db as any).query.artists.findFirst.mock.invocationCallOrder[0],
      );
      expect(
        (db as any).query.artistIdMappings.findFirst,
      ).not.toHaveBeenCalled();
    },
  );

  // 19. setArtistLink reads the aliased facebookID property
  it("setArtistLink returns the old value for facebookID", async () => {
    const { db, setArtistLink } = await setup();
    (db as any).query.artists.findFirst.mockResolvedValue({ id: "artist-123", name: "Test Artist", facebookId: "old-facebook-id" });
    const result = await setArtistLink("artist-123", "facebookID", "old-facebook-id");
    expect(result).toEqual({ oldValue: "old-facebook-id", artistName: "Test Artist" });
  });

  // 20. setArtistLink reads the aliased tiktokID property
  it("setArtistLink returns the old value for tiktokID", async () => {
    const { db, setArtistLink } = await setup();
    (db as any).query.artists.findFirst.mockResolvedValue({ id: "artist-123", name: "Test Artist", tiktokId: "old-tiktok-id" });
    const result = await setArtistLink("artist-123", "tiktokID", "old-tiktok-id");
    expect(result).toEqual({ oldValue: "old-tiktok-id", artistName: "Test Artist" });
  });

  // 21. clearArtistLink returns old value when column has existing data
  it("clearArtistLink returns old value when clearing", async () => {
    const { db, clearArtistLink } = await setup();
    (db as any).query.artists.findFirst.mockResolvedValue({ id: "artist-123", x: "old-handle" });
    const result = await clearArtistLink("artist-123", "x");
    expect(result).toEqual({ oldValue: "old-handle" });
  });
});
