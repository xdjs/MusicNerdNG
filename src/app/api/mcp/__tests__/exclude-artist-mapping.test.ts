// @ts-nocheck
import { jest } from "@jest/globals";

class MappingNotFoundError extends Error {
  constructor(msg) { super(msg); this.name = "MappingNotFoundError"; }
}
class MappingValidationError extends Error {
  constructor(msg) { super(msg); this.name = "MappingValidationError"; }
}

jest.mock("@/server/utils/idMappingService", () => ({
  getUnmappedArtists: jest.fn(),
  resolveArtistMapping: jest.fn(),
  resolveArtistMappingBatch: jest.fn(),
  getMappingStats: jest.fn(),
  getArtistMappings: jest.fn(),
  excludeArtistMapping: jest.fn().mockResolvedValue({ created: true, updated: false }),
  excludeArtistMappingBatch: jest.fn().mockResolvedValue({ results: [] }),
  getMappingExclusions: jest.fn().mockResolvedValue({ exclusions: [], total: 0 }),
  VALID_MAPPING_PLATFORMS: new Set(["deezer", "apple_music", "musicbrainz", "wikidata", "tidal", "amazon_music", "youtube_music"]),
  VALID_SOURCES: new Set(["wikidata", "musicbrainz", "name_search", "web_search", "manual"]),
  VALID_EXCLUSION_REASONS: new Set(["conflict", "name_mismatch", "too_ambiguous"]),
  EXCLUSION_REASON_VALUES: ["conflict", "name_mismatch", "too_ambiguous"],
  MappingNotFoundError,
  MappingConflictError: class extends Error {},
  MappingConcurrentWriteError: class extends Error {},
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

describe("exclude_artist_mapping MCP tool", () => {
  beforeEach(() => { jest.resetModules(); });

  async function setup() {
    const { excludeArtistMapping, excludeArtistMappingBatch } = await import("@/server/utils/idMappingService");
    const { logMcpAudit } = await import("../audit");
    const { requireMcpAuth, McpAuthError } = await import("../auth");
    const { server } = await import("../server");
    return { excludeArtistMapping, excludeArtistMappingBatch, logMcpAudit, requireMcpAuth, McpAuthError, server };
  }

  async function callTool(s, args) {
    const tool = (s.server as any)._registeredTools["exclude_artist_mapping"];
    return await tool.handler(args, {});
  }

  const validArgs = {
    artistId: "00000000-0000-0000-0000-000000000001",
    platform: "deezer",
    reason: "name_mismatch",
    details: "MusicNerd 'X' vs Deezer 'Y' (id=123)",
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

  it("returns success on valid input", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.excludeArtistMapping as jest.Mock).mockResolvedValue({ created: true, updated: false });

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.created).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("returns NOT_FOUND for invalid artist", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.excludeArtistMapping as jest.Mock).mockRejectedValue(new MappingNotFoundError("Artist not found"));

    const result = await callTool(s, validArgs);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
    expect(result.isError).toBe(true);
  });

  it("returns INVALID_INPUT for bad platform", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.excludeArtistMapping as jest.Mock).mockRejectedValue(new MappingValidationError("Invalid platform: badplatform"));

    const result = await callTool(s, { ...validArgs, platform: "badplatform" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
  });

  it("returns INVALID_INPUT for bad reason", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.excludeArtistMapping as jest.Mock).mockRejectedValue(new MappingValidationError("Invalid exclusion reason: badreason"));

    const result = await callTool(s, { ...validArgs, reason: "badreason" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
  });

  it("writes audit log on success", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.excludeArtistMapping as jest.Mock).mockResolvedValue({ created: true, updated: false });

    await callTool(s, validArgs);
    expect(s.logMcpAudit).toHaveBeenCalledWith({
      artistId: validArgs.artistId,
      field: "mapping:deezer",
      action: "exclude",
      newValue: "name_mismatch: MusicNerd 'X' vs Deezer 'Y' (id=123)",
      apiKeyHash: "test-hash",
    });
  });

  // Batch tests
  it("processes batch input via items field", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.excludeArtistMappingBatch as jest.Mock).mockResolvedValue({
      results: [
        { artistId: "00000000-0000-0000-0000-000000000001", created: true, updated: false },
        { artistId: "00000000-0000-0000-0000-000000000002", created: true, updated: false },
      ],
    });

    const batchArgs = {
      items: [
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000001" },
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000002" },
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
    (s.excludeArtistMappingBatch as jest.Mock).mockResolvedValue({
      results: [
        { artistId: "00000000-0000-0000-0000-000000000001", created: true, updated: false },
        { artistId: "00000000-0000-0000-0000-000000000002", created: false, updated: false, error: "Artist not found" },
      ],
    });

    const batchArgs = {
      items: [
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000001" },
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000002" },
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
    (s.excludeArtistMappingBatch as jest.Mock).mockResolvedValue({ results: [] });

    const result = await callTool(s, { items: [] });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.results).toHaveLength(0);
    expect(result.isError).toBeUndefined();
    expect(s.logMcpAudit).not.toHaveBeenCalled();
  });

  it("batch audit log only includes successful items", async () => {
    const s = await setup();
    (s.requireMcpAuth as jest.Mock).mockReturnValue("test-hash");
    (s.excludeArtistMappingBatch as jest.Mock).mockResolvedValue({
      results: [
        { artistId: "00000000-0000-0000-0000-000000000001", created: true, updated: false },
        { artistId: "00000000-0000-0000-0000-000000000002", created: false, updated: false, error: "Artist not found" },
      ],
    });

    const batchArgs = {
      items: [
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000001" },
        { ...validArgs, artistId: "00000000-0000-0000-0000-000000000002" },
      ],
    };
    await callTool(s, batchArgs);
    expect(s.logMcpAudit).toHaveBeenCalledTimes(1);
    const auditArg = (s.logMcpAudit as jest.Mock).mock.calls[0][0];
    expect(auditArg).toHaveLength(1);
    expect(auditArg[0].artistId).toBe("00000000-0000-0000-0000-000000000001");
  });
});

describe("get_mapping_exclusions MCP tool", () => {
  beforeEach(() => { jest.resetModules(); });

  async function setup() {
    const { getMappingExclusions } = await import("@/server/utils/idMappingService");
    const { server } = await import("../server");
    return { getMappingExclusions, server };
  }

  async function callTool(s, args) {
    const tool = (s.server as any)._registeredTools["get_mapping_exclusions"];
    return await tool.handler(args, {});
  }

  it("returns exclusions list", async () => {
    const s = await setup();
    (s.getMappingExclusions as jest.Mock).mockResolvedValue({
      exclusions: [{ id: "e1", artistId: "a1", artistName: "Test", spotify: "sp1", platform: "deezer", reason: "conflict", details: "test", createdAt: "2026-01-01" }],
      total: 1,
    });

    const result = await callTool(s, { platform: "deezer", limit: 100 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.exclusions).toHaveLength(1);
    expect(parsed.total).toBe(1);
    expect(result.isError).toBeUndefined();
  });

  it("returns INVALID_INPUT for bad platform", async () => {
    const s = await setup();
    (s.getMappingExclusions as jest.Mock).mockRejectedValue(new MappingValidationError("Invalid platform: bad"));

    const result = await callTool(s, { platform: "bad", limit: 100 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
  });
});
