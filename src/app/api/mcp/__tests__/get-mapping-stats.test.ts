// @ts-nocheck
import { jest } from "@jest/globals";

// Mock dependencies
jest.mock("@/server/utils/idMappingService", () => ({
  getUnmappedArtists: jest.fn(),
  resolveArtistMapping: jest.fn(),
  getMappingStats: jest.fn().mockResolvedValue({ totalArtistsWithSpotify: 0, totalArtistsWithDeezer: 0, platformStats: [] }),
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

describe("get_mapping_stats MCP tool", () => {
  beforeEach(() => { jest.resetModules(); });

  async function setup() {
    const { getMappingStats } = await import("@/server/utils/idMappingService");
    const { server } = await import("../server");
    return { getMappingStats, server };
  }

  async function callTool(s) {
    const tool = (s.server as any)._registeredTools["get_mapping_stats"];
    return await tool.handler({}, {});
  }

  it("returns stats structure with platform breakdown", async () => {
    const s = await setup();
    (s.getMappingStats as jest.Mock).mockResolvedValue({
      totalArtistsWithSpotify: 1000,
      totalArtistsWithDeezer: 390,
      platformStats: [
        { platform: "deezer", mappedCount: 500, percentage: 50 },
        { platform: "apple_music", mappedCount: 300, percentage: 30 },
      ],
    });

    const result = await callTool(s);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalArtistsWithSpotify).toBe(1000);
    expect(parsed.totalArtistsWithDeezer).toBe(390);
    expect(parsed.platformStats).toHaveLength(2);
    expect(parsed.platformStats[0].platform).toBe("deezer");
    expect(parsed.platformStats[0].mappedCount).toBe(500);
    expect(result.isError).toBeUndefined();
  });
});
