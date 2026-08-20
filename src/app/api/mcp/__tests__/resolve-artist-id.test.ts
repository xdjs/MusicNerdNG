// @ts-nocheck
import { jest } from "@jest/globals";

// Typed error classes for mock — must match the real ones
class MappingNotFoundError extends Error {
  constructor(msg) { super(msg); this.name = "MappingNotFoundError"; }
}
class MappingConflictError extends Error {
  constructor(msg) { super(msg); this.name = "MappingConflictError"; }
}
class MappingValidationError extends Error {
  constructor(msg) { super(msg); this.name = "MappingValidationError"; }
}
class MappingConcurrentWriteError extends Error {
  constructor(msg) { super(msg); this.name = "MappingConcurrentWriteError"; }
}

// Mock dependencies
jest.mock("@/server/utils/idMappingService", () => ({
  getUnmappedArtists: jest.fn(),
  resolveArtistMapping: jest.fn().mockResolvedValue({ created: true, updated: false, skipped: false }),
  resolveArtistMappingBatch: jest.fn().mockResolvedValue({ results: [] }),
  getMappingStats: jest.fn(),
  getArtistMappings: jest.fn(),
  excludeArtistMapping: jest.fn(),
  excludeArtistMappingBatch: jest.fn(),
  getMappingExclusions: jest.fn(),
  VALID_MAPPING_PLATFORMS: new Set(["deezer", "apple_music", "musicbrainz", "wikidata", "tidal", "amazon_music", "youtube_music"]),
  VALID_SOURCES: new Set(["wikidata", "musicbrainz", "name_search", "manual"]),
  VALID_EXCLUSION_REASONS: new Set(["conflict", "name_mismatch", "too_ambiguous"]),
  EXCLUSION_REASON_VALUES: ["conflict", "name_mismatch", "too_ambiguous"],
  MappingNotFoundError,
  MappingConflictError,
  MappingConcurrentWriteError,
  MappingValidationError,
}));
jest.mock("@/server/utils/services", () => ({
  extractArtistId: jest.fn(),
}));
jest.mock("@/server/utils/artistLinkService", () => ({
  ArtistLinkConflictError: class ArtistLinkConflictError extends Error {},
  setArtistLink: jest.fn().mockResolvedValue({ oldValue: null }),
  clearArtistLink: jest.fn().mockResolvedValue({ oldValue: null }),
}));
jest.mock("../audit", () => ({
  logMcpAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../auth", () => ({
  requireMcpAuth: jest.fn(),
  McpAuthError: class McpAuthError extends Error {
    constructor(msg) { super(msg); this.name = "McpAuthError"; }
  },
}));

describe("resolve_artist_id MCP tool", () => {
  beforeEach(() => { jest.resetModules(); });

  async function setup() {
    const { resolveArtistMapping, resolveArtistMappingBatch } = await import("@/server/utils/idMappingService");
    const { logMcpAudit } = await import("../audit");
    const { requireMcpAuth, McpAuthError } = await import("../auth");
    const { server } = await import("../server");
    return { resolveArtistMapping, resolveArtistMappingBatch, logMcpAudit, requireMcpAuth, McpAuthError, server };
  }

  async function callTool(s, args) {
    const tool = (s.server as any)._registeredTools["resolve_artist_id"];
    return await tool.handler(args, {});
  }

  const validArgs = {
    artistId: "00000000-0000-0000-0000-000000000001",
    platform: "deezer",
    platformId: "12345",
    confidence: "high",
    source: "wikidata",
  };

  it("returns AUTH_REQUIRED when no auth", async () => {
    const s = await setup();
    const { McpAuthError } = s;
    (s.requireMcpAuth as jest.Mock).mockImplementation(() => { throw new McpAuthError("Authentication required"); });

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("AUTH_REQUIRED");
    expect(result.isError).toBe(true);
  });

  it("returns NOT_FOUND for nonexistent artist", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockRejectedValue(new MappingNotFoundError("Artist not found: 00000000-0000-0000-0000-000000000001"));

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
    expect(result.isError).toBe(true);
  });

  it("returns INVALID_INPUT for bad platform", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");

    const result = await callTool(s, { ...validArgs, platform: "badplatform" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
  });

  it("returns INVALID_INPUT for validation errors", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockRejectedValue(new MappingValidationError("platformId cannot be empty"));

    const result = await callTool(s, { ...validArgs, platformId: "" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
  });

  it("returns skipped with concurrent_write on race condition", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockRejectedValue(new MappingConcurrentWriteError("concurrent write"));

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.skipped).toBe(true);
    expect(parsed.reason).toBe("concurrent_write");
    expect(result.isError).toBeUndefined();
  });

  it("returns CONFLICT when platformId belongs to different artist", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockRejectedValue(new MappingConflictError("platformId 12345 on deezer is already mapped to a different artist"));

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("CONFLICT");
    expect(result.isError).toBe(true);
  });

  it("creates mapping successfully", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockResolvedValue({ created: true, updated: false, skipped: false });

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.created).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("updates mapping when same/higher confidence", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockResolvedValue({
      created: false, updated: true, skipped: false,
      previousMapping: { platformId: "old-id", confidence: "medium" },
    });

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.updated).toBe(true);
    expect(parsed.previousMapping.platformId).toBe("old-id");
  });

  it("skips when existing mapping has higher confidence", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockResolvedValue({
      created: false, updated: false, skipped: true,
      previousMapping: { platformId: "existing-id", confidence: "manual" },
    });

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.skipped).toBe(true);
  });

  it("does not write audit log when mapping is skipped", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockResolvedValue({
      created: false, updated: false, skipped: true,
      previousMapping: { platformId: "existing-id", confidence: "manual" },
    });

    await callTool(s, validArgs);
    expect(s.logMcpAudit).not.toHaveBeenCalled();
  });

  it("returns success even when audit log fails", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockResolvedValue({ created: true, updated: false, skipped: false });
    (s.logMcpAudit as jest.Mock).mockRejectedValue(new Error("DB connection failed"));

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it("writes audit log with correct fields", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMapping as jest.Mock).mockResolvedValue({
      created: false, updated: true, skipped: false,
      previousMapping: { platformId: "old-id", confidence: "medium" },
    });

    await callTool(s, validArgs);
    expect(s.logMcpAudit).toHaveBeenCalledWith({
      artistId: validArgs.artistId,
      field: "mapping:deezer",
      action: "resolve",
      oldValue: "old-id",
      newValue: "12345",
      apiKeyHash: "test-hash",
    });
  });

  // Batch tests
  it("processes batch input via items field", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMappingBatch as jest.Mock).mockResolvedValue({
      results: [
        { artistId: "00000000-0000-0000-0000-000000000001", created: true, updated: false, skipped: false },
        { artistId: "00000000-0000-0000-0000-000000000002", created: true, updated: false, skipped: false },
      ],
    });

    const batchArgs = {
      items: [
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000001" },
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000002", platformId: "67890" },
      ],
    };
    const result = await callTool(s, batchArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].created).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("returns per-item errors in batch mode", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMappingBatch as jest.Mock).mockResolvedValue({
      results: [
        { artistId: "00000000-0000-0000-0000-000000000001", created: true, updated: false, skipped: false },
        { artistId: "00000000-0000-0000-0000-000000000002", created: false, updated: false, skipped: false, error: "Artist not found: 00000000-0000-0000-0000-000000000002" },
      ],
    });

    const batchArgs = {
      items: [
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000001" },
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000002", platformId: "67890" },
      ],
    };
    const result = await callTool(s, batchArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.results[0].error).toBeUndefined();
    expect(parsed.results[1].error).toContain("Artist not found");
  });

  it("handles empty items array", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMappingBatch as jest.Mock).mockResolvedValue({ results: [] });

    const result = await callTool(s, { items: [] });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.results).toHaveLength(0);
    expect(result.isError).toBeUndefined();
    expect(s.logMcpAudit).not.toHaveBeenCalled();
  });

  it("batch audit log only includes successful mutations", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.resolveArtistMappingBatch as jest.Mock).mockResolvedValue({
      results: [
        { artistId: "00000000-0000-0000-0000-000000000001", created: true, updated: false, skipped: false },
        { artistId: "00000000-0000-0000-0000-000000000002", created: false, updated: false, skipped: true },
        { artistId: "00000000-0000-0000-0000-000000000003", created: false, updated: false, skipped: false, error: "Artist not found" },
      ],
    });

    const batchArgs = {
      items: [
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000001" },
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000002", platformId: "67890" },
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000003", platformId: "99999" },
      ],
    };
    await callTool(s, batchArgs);
    // Only the first item (created, not skipped, no error) should be audited
    expect(s.logMcpAudit).toHaveBeenCalledTimes(1);
    const auditArg = (s.logMcpAudit as jest.Mock).mock.calls[0][0];
    expect(auditArg).toHaveLength(1);
    expect(auditArg[0].artistId).toBe("00000000-0000-0000-0000-000000000001");
  });
});
