// @ts-nocheck
import { jest } from "@jest/globals";

// Mock dependencies
jest.mock("@/server/utils/idMappingService", () => ({
  getUnmappedArtists: jest.fn().mockResolvedValue({ artists: [], totalUnmapped: 0 }),
  resolveArtistMapping: jest.fn(),
  getMappingStats: jest.fn(),
  getArtistMappings: jest.fn(),
  VALID_MAPPING_PLATFORMS: new Set(["deezer", "apple_music", "musicbrainz", "wikidata", "tidal", "amazon_music", "youtube_music"]),
  VALID_SOURCES: new Set(["wikidata", "musicbrainz", "name_search", "manual"]),
  MappingNotFoundError: class extends Error { constructor(msg) { super(msg); this.name = "MappingNotFoundError"; } },
  MappingConflictError: class extends Error { constructor(msg) { super(msg); this.name = "MappingConflictError"; } },
  MappingConcurrentWriteError: class extends Error { constructor(msg) { super(msg); this.name = "MappingConcurrentWriteError"; } },
  MappingValidationError: class extends Error { constructor(msg) { super(msg); this.name = "MappingValidationError"; } },
}));
jest.mock("@/server/utils/services", () => ({
  extractArtistId: jest.fn(),
}));
jest.mock("@/server/utils/artistLinkService", () => ({
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

describe("get_unmapped_artists MCP tool", () => {
  beforeEach(() => { jest.resetModules(); });

  async function setup() {
    const { getUnmappedArtists } = await import("@/server/utils/idMappingService");
    const { server } = await import("../server");
    return { getUnmappedArtists, server };
  }

  async function callTool(s, args) {
    const tool = (s.server as any)._registeredTools["get_unmapped_artists"];
    return await tool.handler(args, {});
  }

  it("returns artists for valid platform", async () => {
    const s = await setup();
    (s.getUnmappedArtists as jest.Mock).mockResolvedValue({
      artists: [{ id: "a1", name: "Test Artist", spotify: "sp1" }],
      totalUnmapped: 42,
    });

    const result = await callTool(s, { platform: "deezer", limit: 10, offset: 0 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.platform).toBe("deezer");
    expect(parsed.artists).toHaveLength(1);
    expect(parsed.totalUnmapped).toBe(42);
    expect(result.isError).toBeUndefined();
  });

  it("returns INVALID_INPUT for bad platform", async () => {
    const s = await setup();
    const { MappingValidationError } = await import("@/server/utils/idMappingService");
    (s.getUnmappedArtists as jest.Mock).mockRejectedValue(new MappingValidationError("Invalid platform: invalid_platform"));

    const result = await callTool(s, { platform: "invalid_platform", limit: 10, offset: 0 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
  });

  it("respects pagination params", async () => {
    const s = await setup();
    (s.getUnmappedArtists as jest.Mock).mockResolvedValue({ artists: [], totalUnmapped: 100 });

    const result = await callTool(s, { platform: "deezer", limit: 25, offset: 50 });
    expect(s.getUnmappedArtists).toHaveBeenCalledWith("deezer", 25, 50, "spotify");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
  });

  it("clamps limit to max 200", async () => {
    const s = await setup();
    (s.getUnmappedArtists as jest.Mock).mockResolvedValue({ artists: [], totalUnmapped: 0 });

    await callTool(s, { platform: "deezer", limit: 500, offset: 0 });
    expect(s.getUnmappedArtists).toHaveBeenCalledWith("deezer", 200, 0, "spotify");
  });

  it("returns empty array when all mapped", async () => {
    const s = await setup();
    (s.getUnmappedArtists as jest.Mock).mockResolvedValue({ artists: [], totalUnmapped: 0 });

    const result = await callTool(s, { platform: "deezer", limit: 10, offset: 0 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.artists).toEqual([]);
    expect(parsed.totalUnmapped).toBe(0);
  });

  it("passes basePlatform 'deezer' to getUnmappedArtists", async () => {
    const s = await setup();
    (s.getUnmappedArtists as jest.Mock).mockResolvedValue({
      artists: [{ id: "a1", name: "Test", spotify: null, deezer: "11600" }],
      totalUnmapped: 1,
    });

    const result = await callTool(s, { platform: "apple_music", limit: 10, offset: 0, basePlatform: "deezer" });
    expect(s.getUnmappedArtists).toHaveBeenCalledWith("apple_music", 10, 0, "deezer");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.artists[0].deezer).toBe("11600");
  });
});
