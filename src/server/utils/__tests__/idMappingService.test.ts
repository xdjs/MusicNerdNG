// @ts-nocheck
import { jest } from "@jest/globals";

describe("idMappingService", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function setup() {
    const { db } = await import("@/server/db/drizzle");
    db.execute = jest.fn().mockResolvedValue([]);
    (db as any).query.artists = {
      findFirst: jest.fn().mockResolvedValue({ id: "artist-123" }),
      findMany: jest.fn(),
    };
    (db as any).query.artistIdMappings = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    };

    const {
      getUnmappedArtists,
      resolveArtistMapping,
      resolveArtistMappingBatch,
      getMappingStats,
      getArtistMappings,
      excludeArtistMapping,
      excludeArtistMappingBatch,
      getMappingExclusions,
      VALID_MAPPING_PLATFORMS,
      VALID_SOURCES,
      VALID_EXCLUSION_REASONS,
    } = await import("../idMappingService");

    return {
      db,
      getUnmappedArtists,
      resolveArtistMapping,
      resolveArtistMappingBatch,
      getMappingStats,
      getArtistMappings,
      excludeArtistMapping,
      excludeArtistMappingBatch,
      getMappingExclusions,
      VALID_MAPPING_PLATFORMS,
      VALID_SOURCES,
      VALID_EXCLUSION_REASONS,
    };
  }

  // resolveArtistMapping validation
  it("rejects invalid platform", async () => {
    const { resolveArtistMapping } = await setup();
    await expect(
      resolveArtistMapping({ artistId: "artist-123", platform: "badplatform", platformId: "123", confidence: "high", source: "manual" })
    ).rejects.toThrow("Invalid platform: badplatform");
  });

  it("rejects invalid source", async () => {
    const { resolveArtistMapping } = await setup();
    await expect(
      resolveArtistMapping({ artistId: "artist-123", platform: "deezer", platformId: "123", confidence: "high", source: "badsource" })
    ).rejects.toThrow("Invalid source: badsource");
  });

  it("rejects invalid confidence level", async () => {
    const { resolveArtistMapping } = await setup();
    await expect(
      resolveArtistMapping({ artistId: "artist-123", platform: "deezer", platformId: "123", confidence: "invalid", source: "manual" })
    ).rejects.toThrow("Invalid confidence level: invalid");
  });

  it("rejects empty platformId", async () => {
    const { resolveArtistMapping } = await setup();
    await expect(
      resolveArtistMapping({ artistId: "artist-123", platform: "deezer", platformId: "", confidence: "high", source: "manual" })
    ).rejects.toThrow("platformId cannot be empty");
    await expect(
      resolveArtistMapping({ artistId: "artist-123", platform: "deezer", platformId: "   ", confidence: "high", source: "manual" })
    ).rejects.toThrow("platformId cannot be empty");
  });

  it("throws for non-existent artist", async () => {
    const { db, resolveArtistMapping } = await setup();
    (db as any).query.artists.findFirst.mockResolvedValue(null);
    await expect(
      resolveArtistMapping({ artistId: "nonexistent", platform: "deezer", platformId: "123", confidence: "high", source: "manual" })
    ).rejects.toThrow("Artist not found");
  });

  it("reports cross-artist conflict when platform_id_uniq constraint is violated", async () => {
    const { db, resolveArtistMapping } = await setup();
    const dbError = new Error("duplicate key value violates unique constraint");
    (dbError as any).code = "23505";
    (dbError as any).constraint = "artist_id_mappings_platform_id_uniq";
    db.execute = jest.fn().mockRejectedValue(dbError);
    await expect(
      resolveArtistMapping({ artistId: "artist-123", platform: "deezer", platformId: "456", confidence: "high", source: "manual" })
    ).rejects.toThrow("already mapped to a different artist");
  });

  it("throws MappingConcurrentWriteError when artist_platform_uniq constraint is violated", async () => {
    const { db, resolveArtistMapping } = await setup();
    const { MappingConcurrentWriteError } = await import("../idMappingService");
    const dbError = new Error("duplicate key value violates unique constraint");
    (dbError as any).code = "23505";
    (dbError as any).constraint = "artist_id_mappings_artist_platform_uniq";
    db.execute = jest.fn().mockRejectedValue(dbError);
    await expect(
      resolveArtistMapping({ artistId: "artist-123", platform: "deezer", platformId: "456", confidence: "high", source: "manual" })
    ).rejects.toThrow(MappingConcurrentWriteError);
  });

  it("throws MappingConflictError on unique constraint violation during update", async () => {
    const { db, resolveArtistMapping } = await setup();
    const { MappingConflictError } = await import("../idMappingService");
    (db as any).query.artistIdMappings.findFirst.mockResolvedValueOnce({
      artistId: "artist-123", platformId: "old-id", confidence: "low",
    });
    const dbError = new Error("duplicate key value violates unique constraint");
    (dbError as any).code = "23505";
    (dbError as any).constraint = "artist_id_mappings_platform_id_uniq";
    db.execute = jest.fn().mockRejectedValue(dbError);
    await expect(
      resolveArtistMapping({ artistId: "artist-123", platform: "deezer", platformId: "taken-id", confidence: "high", source: "manual" })
    ).rejects.toThrow(MappingConflictError);
  });

  it("detects unique violation in Drizzle-wrapped error (err.cause)", async () => {
    const { db, resolveArtistMapping } = await setup();
    const pgError = new Error("duplicate key value violates unique constraint");
    (pgError as any).code = "23505";
    (pgError as any).constraint_name = "artist_id_mappings_platform_id_uniq";
    const wrapperError = new Error("Failed query");
    (wrapperError as any).cause = pgError;
    db.execute = jest.fn().mockRejectedValue(wrapperError);
    await expect(
      resolveArtistMapping({ artistId: "artist-123", platform: "deezer", platformId: "456", confidence: "high", source: "manual" })
    ).rejects.toThrow("already mapped to a different artist");
  });

  it("accepts web_search as a valid source", async () => {
    const { db, resolveArtistMapping } = await setup();
    const result = await resolveArtistMapping({
      artistId: "artist-123", platform: "deezer", platformId: "456",
      confidence: "high", source: "web_search", reasoning: "Google search returned deezer.com/us/artist/456",
    });
    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.skipped).toBe(false);
    expect(db.execute).toHaveBeenCalled();
  });

  it("creates new mapping", async () => {
    const { db, resolveArtistMapping } = await setup();
    const result = await resolveArtistMapping({
      artistId: "artist-123", platform: "deezer", platformId: "456",
      confidence: "high", source: "wikidata", reasoning: "matched via ISNI",
    });
    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.skipped).toBe(false);
    expect(db.execute).toHaveBeenCalled();
  });

  it("updates existing mapping with equal confidence", async () => {
    const { db, resolveArtistMapping } = await setup();
    (db as any).query.artistIdMappings.findFirst
      .mockResolvedValueOnce({ artistId: "artist-123", platformId: "old-id", confidence: "medium" });
    const result = await resolveArtistMapping({
      artistId: "artist-123", platform: "deezer", platformId: "new-id",
      confidence: "medium", source: "musicbrainz",
    });
    expect(result.updated).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.previousMapping).toEqual({ platformId: "old-id", confidence: "medium" });
  });

  it("updates existing mapping with higher confidence", async () => {
    const { db, resolveArtistMapping } = await setup();
    (db as any).query.artistIdMappings.findFirst
      .mockResolvedValueOnce({ artistId: "artist-123", platformId: "old-id", confidence: "low" });
    const result = await resolveArtistMapping({
      artistId: "artist-123", platform: "deezer", platformId: "new-id",
      confidence: "high", source: "wikidata",
    });
    expect(result.updated).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it("skips update when existing has higher confidence", async () => {
    const { db, resolveArtistMapping } = await setup();
    (db as any).query.artistIdMappings.findFirst
      .mockResolvedValueOnce({ artistId: "artist-123", platformId: "existing-id", confidence: "manual" });
    const result = await resolveArtistMapping({
      artistId: "artist-123", platform: "deezer", platformId: "new-id",
      confidence: "high", source: "wikidata",
    });
    expect(result.skipped).toBe(true);
    expect(result.created).toBe(false);
    expect(result.updated).toBe(false);
    expect(result.previousMapping).toEqual({ platformId: "existing-id", confidence: "manual" });
  });

  // getUnmappedArtists
  it("returns unmapped artists for valid platform", async () => {
    const { db, getUnmappedArtists } = await setup();
    (db as any).execute = jest.fn()
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([{ id: "a1", name: "Artist 1", spotify: "sp1" }]);

    const result = await getUnmappedArtists("deezer", 10, 0);
    expect(result.totalUnmapped).toBe(2);
    expect(result.artists).toHaveLength(1);
    expect(result.artists[0].id).toBe("a1");
  });

  it("rejects invalid platform for getUnmappedArtists", async () => {
    const { getUnmappedArtists } = await setup();
    await expect(getUnmappedArtists("invalid", 10, 0)).rejects.toThrow("Invalid platform: invalid");
  });

  // getMappingStats
  it("returns stats for all platforms including unmapped ones", async () => {
    const { db, getMappingStats } = await setup();
    (db as any).execute = jest.fn()
      .mockResolvedValueOnce([{ total: 100 }])
      .mockResolvedValueOnce([{ total: 390 }])
      .mockResolvedValueOnce([{ platform: "deezer", mapped_count: 50 }]);

    const stats = await getMappingStats();
    expect(stats.totalArtistsWithSpotify).toBe(100);
    expect(stats.totalArtistsWithDeezer).toBe(390);
    // All valid platforms should be present
    expect(stats.platformStats).toHaveLength(11);
    const deezer = stats.platformStats.find(s => s.platform === "deezer");
    expect(deezer.mappedCount).toBe(50);
    expect(deezer.percentage).toBe(50);
    // Unmapped platforms should show 0
    const tidal = stats.platformStats.find(s => s.platform === "tidal");
    expect(tidal.mappedCount).toBe(0);
    expect(tidal.percentage).toBe(0);
  });

  // getArtistMappings
  it("returns mappings without artist existence check on happy path", async () => {
    const { db, getArtistMappings } = await setup();
    (db as any).query.artistIdMappings.findMany.mockResolvedValue([
      { id: "m1", platform: "deezer", platformId: "456", confidence: "high", source: "wikidata", reasoning: null, resolvedAt: "2026-01-01" },
    ]);

    const mappings = await getArtistMappings("artist-123");
    expect(mappings).toHaveLength(1);
    expect(mappings[0].platform).toBe("deezer");
    expect(mappings[0].platformId).toBe("456");
    // Should not have checked artist existence since mappings were found
    expect((db as any).query.artists.findFirst).not.toHaveBeenCalled();
  });

  it("throws for non-existent artist when no mappings found", async () => {
    const { db, getArtistMappings } = await setup();
    (db as any).query.artistIdMappings.findMany.mockResolvedValue([]);
    (db as any).query.artists.findFirst.mockResolvedValue(null);
    await expect(getArtistMappings("nonexistent")).rejects.toThrow("Artist not found");
  });

  it("returns empty array for valid artist with no mappings", async () => {
    const { db, getArtistMappings } = await setup();
    (db as any).query.artistIdMappings.findMany.mockResolvedValue([]);
    // Artist exists but has no mappings
    (db as any).query.artists.findFirst.mockResolvedValue({ id: "artist-123" });
    const mappings = await getArtistMappings("artist-123");
    expect(mappings).toEqual([]);
  });

  // excludeArtistMapping
  it("rejects invalid platform for excludeArtistMapping", async () => {
    const { excludeArtistMapping } = await setup();
    await expect(
      excludeArtistMapping({ artistId: "artist-123", platform: "badplatform", reason: "conflict" })
    ).rejects.toThrow("Invalid platform: badplatform");
  });

  it("rejects invalid reason for excludeArtistMapping", async () => {
    const { excludeArtistMapping } = await setup();
    await expect(
      excludeArtistMapping({ artistId: "artist-123", platform: "deezer", reason: "badreason" })
    ).rejects.toThrow("Invalid exclusion reason: badreason");
  });

  it("throws for non-existent artist in excludeArtistMapping", async () => {
    const { db, excludeArtistMapping } = await setup();
    (db as any).query.artists.findFirst.mockResolvedValue(null);
    await expect(
      excludeArtistMapping({ artistId: "nonexistent", platform: "deezer", reason: "conflict" })
    ).rejects.toThrow("Artist not found");
  });

  it("creates exclusion record", async () => {
    const { db, excludeArtistMapping } = await setup();
    db.execute = jest.fn().mockResolvedValue([{ xmax: "0" }]);
    const result = await excludeArtistMapping({
      artistId: "artist-123", platform: "deezer", reason: "name_mismatch",
      details: "MusicNerd 'X' vs Deezer 'Y'",
    });
    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(db.execute).toHaveBeenCalled();
  });

  it("upserts exclusion on duplicate", async () => {
    const { db, excludeArtistMapping } = await setup();
    db.execute = jest.fn().mockResolvedValue([{ xmax: "12345" }]);
    const result = await excludeArtistMapping({
      artistId: "artist-123", platform: "deezer", reason: "conflict",
      details: "updated details",
    });
    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
  });

  // getMappingExclusions
  it("returns exclusions with artist info", async () => {
    const { db, getMappingExclusions } = await setup();
    db.execute = jest.fn()
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{
        id: "excl-1", artist_id: "a1", artist_name: "Artist 1", spotify: "sp1",
        platform: "deezer", reason: "name_mismatch", details: "name mismatch details",
        created_at: "2026-01-01T00:00:00Z",
      }]);

    const result = await getMappingExclusions("deezer");
    expect(result.total).toBe(1);
    expect(result.exclusions).toHaveLength(1);
    expect(result.exclusions[0].artistName).toBe("Artist 1");
    expect(result.exclusions[0].reason).toBe("name_mismatch");
  });

  it("rejects invalid platform for getMappingExclusions", async () => {
    const { getMappingExclusions } = await setup();
    await expect(getMappingExclusions("invalid")).rejects.toThrow("Invalid platform: invalid");
  });

  // resolveArtistMappingBatch
  it("processes multiple items in batch, returns per-item results", async () => {
    const { db, resolveArtistMappingBatch } = await setup();
    const result = await resolveArtistMappingBatch([
      { artistId: "artist-123", platform: "deezer", platformId: "456", confidence: "high", source: "wikidata" },
      { artistId: "artist-123", platform: "apple_music", platformId: "789", confidence: "high", source: "wikidata" },
    ], "test-key-hash");
    expect(result.results).toHaveLength(2);
    expect(result.results[0].created).toBe(true);
    expect(result.results[1].created).toBe(true);
  });

  it("batch continues on individual failures", async () => {
    const { db, resolveArtistMappingBatch } = await setup();
    // First item: artist exists, second item: artist not found
    let callCount = 0;
    (db as any).query.artists.findFirst.mockImplementation(() => {
      callCount++;
      if (callCount === 2) return Promise.resolve(null);
      return Promise.resolve({ id: "artist-123" });
    });

    const result = await resolveArtistMappingBatch([
      { artistId: "artist-123", platform: "deezer", platformId: "456", confidence: "high", source: "wikidata" },
      { artistId: "nonexistent", platform: "deezer", platformId: "789", confidence: "high", source: "wikidata" },
    ], "test-key-hash");
    expect(result.results).toHaveLength(2);
    expect(result.results[0].created).toBe(true);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[1].error).toContain("Artist not found");
  });

  // excludeArtistMappingBatch
  it("processes multiple exclusions in batch", async () => {
    const { db, excludeArtistMappingBatch } = await setup();
    db.execute = jest.fn().mockResolvedValue([{ xmax: "0" }]);
    const result = await excludeArtistMappingBatch([
      { artistId: "artist-123", platform: "deezer", reason: "name_mismatch", details: "test 1" },
      { artistId: "artist-123", platform: "apple_music", reason: "conflict", details: "test 2" },
    ], "test-key-hash");
    expect(result.results).toHaveLength(2);
    expect(result.results[0].created).toBe(true);
    expect(result.results[1].created).toBe(true);
  });

  it("exclude batch continues on individual failures", async () => {
    const { db, excludeArtistMappingBatch } = await setup();
    db.execute = jest.fn().mockResolvedValue([{ xmax: "0" }]);
    let callCount = 0;
    (db as any).query.artists.findFirst.mockImplementation(() => {
      callCount++;
      if (callCount === 2) return Promise.resolve(null);
      return Promise.resolve({ id: "artist-123" });
    });

    const result = await excludeArtistMappingBatch([
      { artistId: "artist-123", platform: "deezer", reason: "name_mismatch" },
      { artistId: "nonexistent", platform: "deezer", reason: "conflict" },
    ], "test-key-hash");
    expect(result.results).toHaveLength(2);
    expect(result.results[0].created).toBe(true);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[1].error).toContain("Artist not found");
  });
});
