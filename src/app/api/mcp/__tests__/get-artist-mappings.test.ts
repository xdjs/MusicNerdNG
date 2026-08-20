// @ts-nocheck
import { jest } from "@jest/globals";

class MappingNotFoundError extends Error {
  constructor(msg) { super(msg); this.name = "MappingNotFoundError"; }
}

// Mock dependencies
jest.mock("@/server/utils/idMappingService", () => ({
  getUnmappedArtists: jest.fn(),
  resolveArtistMapping: jest.fn(),
  getMappingStats: jest.fn(),
  getArtistMappings: jest.fn().mockResolvedValue([]),
  VALID_MAPPING_PLATFORMS: new Set(["deezer", "apple_music", "musicbrainz", "wikidata", "tidal", "amazon_music", "youtube_music"]),
  VALID_SOURCES: new Set(["wikidata", "musicbrainz", "name_search", "manual"]),
  MappingNotFoundError,
  MappingConflictError: class MappingConflictError extends Error { constructor(msg) { super(msg); this.name = "MappingConflictError"; } },
  MappingConcurrentWriteError: class MappingConcurrentWriteError extends Error { constructor(msg) { super(msg); this.name = "MappingConcurrentWriteError"; } },
  MappingValidationError: class MappingValidationError extends Error { constructor(msg) { super(msg); this.name = "MappingValidationError"; } },
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

describe("get_artist_mappings MCP tool", () => {
  beforeEach(() => { jest.resetModules(); });

  async function setup() {
    const { getArtistMappings } = await import("@/server/utils/idMappingService");
    const { server } = await import("../server");
    return { getArtistMappings, server };
  }

  async function callTool(s, args) {
    const tool = (s.server as any)._registeredTools["get_artist_mappings"];
    return await tool.handler(args, {});
  }

  it("returns mappings for valid artist", async () => {
    const s = await setup();
    (s.getArtistMappings as jest.Mock).mockResolvedValue([
      { id: "m1", platform: "deezer", platformId: "456", confidence: "high", source: "wikidata", reasoning: null, resolvedAt: "2026-01-01" },
      { id: "m2", platform: "apple_music", platformId: "789", confidence: "medium", source: "name_search", reasoning: "matched by name", resolvedAt: "2026-01-02" },
    ]);

    const result = await callTool(s, { artistId: "00000000-0000-0000-0000-000000000001" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.artistId).toBe("00000000-0000-0000-0000-000000000001");
    expect(parsed.mappings).toHaveLength(2);
    expect(parsed.totalMappings).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  it("returns NOT_FOUND for nonexistent artist", async () => {
    const s = await setup();
    (s.getArtistMappings as jest.Mock).mockRejectedValue(new MappingNotFoundError("Artist not found: 00000000-0000-0000-0000-000000000099"));

    const result = await callTool(s, { artistId: "00000000-0000-0000-0000-000000000099" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
    expect(result.isError).toBe(true);
  });
});
