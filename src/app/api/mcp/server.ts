import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { searchForArtistByName, getArtistById } from "@/server/utils/queries/artistQueries";
import { toArtistSummary } from "./transformers/artist-summary";
import { toArtistDetail } from "./transformers/artist-detail";
import { extractArtistId } from "@/server/utils/services";
import { setArtistLink, clearArtistLink } from "@/server/utils/artistLinkService";
import { getUnmappedArtists, resolveArtistMapping, resolveArtistMappingBatch, getMappingStats, getArtistMappings, excludeArtistMapping, excludeArtistMappingBatch, getMappingExclusions, VALID_MAPPING_PLATFORMS, EXCLUSION_REASON_VALUES, MappingNotFoundError, MappingConflictError, MappingConcurrentWriteError, MappingValidationError } from "@/server/utils/idMappingService";

import { requireMcpAuth, McpAuthError } from "./auth";
import { logMcpAudit } from "./audit";

// Create the MCP server instance
const server = new McpServer({
  name: "Music Nerd",
  version: "1.0.0",
});

// Register the search_artists tool
server.registerTool(
  "search_artists",
  {
    title: "Search Artists",
    description: "Search for artists in the MusicNerd database by name",
    inputSchema: {
      query: z.string().describe("The search query to find artists by name"),
      limit: z.number().optional().default(10).describe("Maximum number of results to return (default 10, max 50)"),
    },
  },
  async ({ query, limit }) => {
    console.log(`[MCP] search_artists called with query="${query}", limit=${limit}`);

    try {
      // Handle empty query string - return empty results per PRD spec
      const trimmedQuery = query?.trim() ?? "";
      if (trimmedQuery === "") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                artists: [],
                totalResults: 0,
              }, null, 2),
            },
          ],
        };
      }

      // Clamp limit to max 50
      const effectiveLimit = Math.min(limit ?? 10, 50);

      const artists = await searchForArtistByName(trimmedQuery);
      const limitedArtists = artists.slice(0, effectiveLimit);
      const artistSummaries = limitedArtists.map(toArtistSummary);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              artists: artistSummaries,
              totalResults: artistSummaries.length,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error("[MCP] search_artists error:", error);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Failed to search artists",
              code: "INTERNAL_ERROR",
            }),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register the get_artist tool
server.registerTool(
  "get_artist",
  {
    title: "Get Artist",
    description: "Get detailed information about an artist by their MusicNerd ID",
    inputSchema: {
      id: z.string().uuid().describe("The UUID of the artist in MusicNerd"),
    },
  },
  async ({ id }) => {
    console.log(`[MCP] get_artist called with id="${id}"`);

    try {
      const artist = await getArtistById(id);

      if (!artist) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Artist not found",
                code: "NOT_FOUND",
              }),
            },
          ],
          isError: true,
        };
      }

      const artistDetail = await toArtistDetail(artist);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              artist: artistDetail,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error("[MCP] get_artist error:", error);

      // Check if it's a validation error (invalid UUID)
      if (error instanceof z.ZodError) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Invalid artist ID format - must be a valid UUID",
                code: "INVALID_INPUT",
              }),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Failed to get artist",
              code: "INTERNAL_ERROR",
            }),
          },
        ],
        isError: true,
      };
    }
  }
);

// CONVENTION: All mutating tools MUST call requireMcpAuth() as their first
// operation before any DB work. Read-only tools do not require auth.

// Register the set_artist_link tool
server.registerTool(
  "set_artist_link",
  {
    title: "Set Artist Link",
    description: "Set a platform link on an artist record. The platform is automatically inferred from the URL.",
    inputSchema: {
      artistId: z.string().uuid().describe("The UUID of the artist in MusicNerd"),
      url: z.string().url().describe("The platform URL to set (e.g. https://instagram.com/username)"),
    },
  },
  async ({ artistId, url }) => {
    console.log(`[MCP] set_artist_link called with artistId="${artistId}", url="${url}"`);

    try {
      const apiKeyHash = requireMcpAuth();

      // Extract platform and ID from URL
      const extracted = await extractArtistId(url);
      if (!extracted || !extracted.id) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "URL does not match any approved platform", code: "INVALID_URL" }) }],
          isError: true,
        };
      }

      const { siteName, id: extractedId } = extracted;

      // Set the link (validates artist exists, returns old value)
      const { oldValue } = await setArtistLink(artistId, siteName, extractedId);

      // Audit is best-effort — mutation succeeded, log failure shouldn't hide that
      try {
        await logMcpAudit({
          artistId,
          field: siteName,
          action: "set",
          submittedUrl: url,
          oldValue,
          newValue: extractedId,
          apiKeyHash,
        });
      } catch (auditError) {
        console.error("[MCP] Audit log failed (mutation succeeded):", auditError);
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            siteName,
            extractedId,
            oldValue,
          }, null, 2),
        }],
      };
    } catch (error) {
      if (error instanceof McpAuthError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, code: "AUTH_REQUIRED" }) }],
          isError: true,
        };
      }
      if (error instanceof Error && error.message.startsWith("Artist not found")) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Artist not found", code: "NOT_FOUND" }) }],
          isError: true,
        };
      }
      console.error("[MCP] set_artist_link error:", error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to set artist link", code: "INTERNAL_ERROR" }) }],
        isError: true,
      };
    }
  }
);

// Register the delete_artist_link tool
server.registerTool(
  "delete_artist_link",
  {
    title: "Delete Artist Link",
    description: "Remove a platform link from an artist record",
    inputSchema: {
      artistId: z.string().uuid().describe("The UUID of the artist in MusicNerd"),
      siteName: z.string().describe("The platform name (e.g. instagram, x, spotify, youtube)"),
    },
  },
  async ({ artistId, siteName }) => {
    console.log(`[MCP] delete_artist_link called with artistId="${artistId}", siteName="${siteName}"`);

    try {
      const apiKeyHash = requireMcpAuth();

      // Clear the link (validates artist exists + column whitelist, returns old value)
      const { oldValue } = await clearArtistLink(artistId, siteName);

      if (oldValue === null) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Link is not set", code: "NOT_SET" }) }],
          isError: true,
        };
      }

      // Audit is best-effort — mutation succeeded, log failure shouldn't hide that
      try {
        await logMcpAudit({
          artistId,
          field: siteName,
          action: "delete",
          oldValue,
          apiKeyHash,
        });
      } catch (auditError) {
        console.error("[MCP] Audit log failed (mutation succeeded):", auditError);
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            siteName,
            oldValue,
          }, null, 2),
        }],
      };
    } catch (error) {
      if (error instanceof McpAuthError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, code: "AUTH_REQUIRED" }) }],
          isError: true,
        };
      }
      if (error instanceof Error && error.message.startsWith("Artist not found")) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Artist not found", code: "NOT_FOUND" }) }],
          isError: true,
        };
      }
      if (error instanceof Error && error.message.startsWith("Column not in writable whitelist")) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid platform name", code: "INVALID_PLATFORM" }) }],
          isError: true,
        };
      }
      console.error("[MCP] delete_artist_link error:", error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to delete artist link", code: "INTERNAL_ERROR" }) }],
        isError: true,
      };
    }
  }
);

// Register the get_unmapped_artists tool
server.registerTool(
  "get_unmapped_artists",
  {
    title: "Get Unmapped Artists",
    description: "Get artists that have a platform ID but no mapping for a given target platform. Use basePlatform to select the source (default: spotify, use 'deezer' for Deezer-primary workflows).",
    inputSchema: {
      platform: z.string().describe("The target platform to check for missing mappings (e.g. deezer, apple_music, musicbrainz, wikidata, tidal, amazon_music, youtube_music)"),
      limit: z.number().optional().default(50).describe("Maximum number of results to return (default 50, max 200)"),
      offset: z.number().optional().default(0).describe("Offset for pagination (default 0)"),
      basePlatform: z.enum(["spotify", "deezer"]).optional().default("spotify").describe("Which platform ID to require on source artists (default: spotify). Use 'deezer' to find artists with Deezer IDs that lack mappings."),
    },
  },
  async ({ platform, limit, offset, basePlatform }) => {
    console.log(`[MCP] get_unmapped_artists called with platform="${platform}", basePlatform="${basePlatform}", limit=${limit}, offset=${offset}`);

    try {
      const effectiveLimit = Math.min(Math.max(limit ?? 50, 1), 200);
      const effectiveOffset = Math.max(offset ?? 0, 0);

      const effectiveBasePlatform = (basePlatform === 'deezer' ? 'deezer' : 'spotify') as 'spotify' | 'deezer';
      const result = await getUnmappedArtists(platform, effectiveLimit, effectiveOffset, effectiveBasePlatform);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            platform,
            artists: result.artists,
            totalUnmapped: result.totalUnmapped,
            limit: effectiveLimit,
            offset: effectiveOffset,
          }, null, 2),
        }],
      };
    } catch (error) {
      if (error instanceof MappingValidationError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, code: "INVALID_INPUT" }) }],
          isError: true,
        };
      }
      console.error("[MCP] get_unmapped_artists error:", error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to get unmapped artists", code: "INTERNAL_ERROR" }) }],
        isError: true,
      };
    }
  }
);

// Register the get_mapping_stats tool
server.registerTool(
  "get_mapping_stats",
  {
    title: "Get Mapping Stats",
    description: "Get statistics about cross-platform artist ID mapping coverage across all platforms.",
    inputSchema: {},
  },
  async () => {
    console.log("[MCP] get_mapping_stats called");

    try {
      const stats = await getMappingStats();

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(stats, null, 2),
        }],
      };
    } catch (error) {
      console.error("[MCP] get_mapping_stats error:", error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to get mapping stats", code: "INTERNAL_ERROR" }) }],
        isError: true,
      };
    }
  }
);

// Register the get_artist_mappings tool
server.registerTool(
  "get_artist_mappings",
  {
    title: "Get Artist Mappings",
    description: "Get all cross-platform ID mappings for a specific artist.",
    inputSchema: {
      artistId: z.string().uuid().describe("The UUID of the artist in MusicNerd"),
    },
  },
  async ({ artistId }) => {
    console.log(`[MCP] get_artist_mappings called with artistId="${artistId}"`);

    try {
      const mappings = await getArtistMappings(artistId);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            artistId,
            mappings,
            totalMappings: mappings.length,
          }, null, 2),
        }],
      };
    } catch (error) {
      if (error instanceof MappingNotFoundError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Artist not found", code: "NOT_FOUND" }) }],
          isError: true,
        };
      }
      console.error("[MCP] get_artist_mappings error:", error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to get artist mappings", code: "INTERNAL_ERROR" }) }],
        isError: true,
      };
    }
  }
);

// Shared schema for a single resolve_artist_id item (used by batch items array)
const resolveItemSchema = z.object({
  artistId: z.string().uuid().describe("The UUID of the artist in MusicNerd"),
  platform: z.string().describe("The target platform (e.g. deezer, apple_music, musicbrainz, wikidata, tidal, amazon_music, youtube_music)"),
  platformId: z.string().describe("The artist's ID on the target platform"),
  confidence: z.enum(["high", "medium", "low", "manual"]).describe("Confidence level of the mapping (manual > high > medium > low)"),
  source: z.enum(["wikidata", "musicbrainz", "name_search", "web_search", "manual"]).describe("How the mapping was determined"),
  reasoning: z.string().optional().describe("Optional explanation of how the mapping was determined"),
});

// Register the resolve_artist_id tool
server.registerTool(
  "resolve_artist_id",
  {
    title: "Resolve Artist ID",
    description: "Store cross-platform ID mapping(s) for artist(s). For a single item, provide the fields directly. For batch mode, provide an 'items' array instead. Each batch item is processed independently — partial failures do not roll back successful items.",
    inputSchema: {
      artistId: z.string().uuid().optional().describe("The UUID of the artist (single-item mode)"),
      platform: z.string().optional().describe("The target platform (single-item mode)"),
      platformId: z.string().optional().describe("The artist's ID on the target platform (single-item mode)"),
      confidence: z.enum(["high", "medium", "low", "manual"]).optional().describe("Confidence level (single-item mode)"),
      source: z.enum(["wikidata", "musicbrainz", "name_search", "web_search", "manual"]).optional().describe("How the mapping was determined (single-item mode)"),
      reasoning: z.string().optional().describe("Optional explanation of how the mapping was determined"),
      items: z.array(resolveItemSchema).max(100).optional().describe("Array of items for batch mode (max 100). When provided, the individual fields above are ignored."),
    },
  },
  async ({ artistId, platform, platformId, confidence, source, reasoning, items }) => {
    console.log(`[MCP] resolve_artist_id called with ${items !== undefined ? items.length + " item(s) (batch)" : "1 item(s)"}`);

    try {
      const apiKeyHash = requireMcpAuth();

      if (items === undefined) {
        // Single-item path — preserve original behavior exactly
        if (!artistId || !platform || !platformId || !confidence || !source) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Missing required fields: artistId, platform, platformId, confidence, source", code: "INVALID_INPUT" }) }],
            isError: true,
          };
        }

        if (!VALID_MAPPING_PLATFORMS.has(platform)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid platform. Valid platforms: ${[...VALID_MAPPING_PLATFORMS].join(", ")}`, code: "INVALID_INPUT" }) }],
            isError: true,
          };
        }

        const result = await resolveArtistMapping({
          artistId, platform, platformId, confidence, source, reasoning, apiKeyHash,
        });

        if (!result.skipped) {
          try {
            await logMcpAudit({
              artistId, field: `mapping:${platform}`, action: "resolve",
              oldValue: result.previousMapping?.platformId ?? null, newValue: platformId, apiKeyHash,
            });
          } catch (auditError) {
            console.error("[MCP] Audit log failed (mutation succeeded):", auditError);
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, ...result }, null, 2),
          }],
        };
      }

      // Batch path
      const batchResult = await resolveArtistMappingBatch(items, apiKeyHash);

      // Batch audit for all successful mutations
      const auditEntries = batchResult.results
        .map((r, i) => ({ r, item: items[i] }))
        .filter(({ r }) => !r.skipped && !r.error)
        .map(({ r, item }) => ({
          artistId: item.artistId,
          field: `mapping:${item.platform}`,
          action: "resolve" as const,
          oldValue: r.previousMapping?.platformId ?? null,
          newValue: item.platformId,
          apiKeyHash,
        }));

      if (auditEntries.length > 0) {
        try {
          await logMcpAudit(auditEntries);
        } catch (auditError) {
          console.error("[MCP] Batch audit log failed (mutations succeeded):", auditError);
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: true, results: batchResult.results }, null, 2),
        }],
      };
    } catch (error) {
      if (error instanceof McpAuthError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, code: "AUTH_REQUIRED" }) }],
          isError: true,
        };
      }
      // Single-item error handling (batch errors are captured per-item)
      if (error instanceof MappingNotFoundError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Artist not found", code: "NOT_FOUND" }) }],
          isError: true,
        };
      }
      if (error instanceof MappingConflictError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, code: "CONFLICT" }) }],
          isError: true,
        };
      }
      // Race condition — another request already wrote this mapping. Not an error for the caller.
      if (error instanceof MappingConcurrentWriteError) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, created: false, updated: false, skipped: true, reason: "concurrent_write" }, null, 2),
          }],
        };
      }
      if (error instanceof MappingValidationError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, code: "INVALID_INPUT" }) }],
          isError: true,
        };
      }
      console.error("[MCP] resolve_artist_id error:", error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to resolve artist ID", code: "INTERNAL_ERROR" }) }],
        isError: true,
      };
    }
  }
);

// Shared schema for a single exclude_artist_mapping item (used by batch items array)
const excludeItemSchema = z.object({
  artistId: z.string().uuid().describe("The UUID of the artist in MusicNerd"),
  platform: z.string().describe(`The target platform (e.g. ${[...VALID_MAPPING_PLATFORMS].join(", ")})`),
  reason: z.enum(EXCLUSION_REASON_VALUES).describe("Why the artist is being excluded"),
  details: z.string().optional().describe("Human-readable explanation (e.g. \"MusicNerd '1010 Benja SL' vs Deezer '1010benja' (id=12029768)\")"),
});

// Register the exclude_artist_mapping tool
server.registerTool(
  "exclude_artist_mapping",
  {
    title: "Exclude Artist Mapping",
    description: "Mark artist(s) as excluded from future mapping batches for a given platform. For a single item, provide the fields directly. For batch mode, provide an 'items' array instead. Each batch item is processed independently — partial failures do not roll back successful items.",
    inputSchema: {
      artistId: z.string().uuid().optional().describe("The UUID of the artist (single-item mode)"),
      platform: z.string().optional().describe(`The target platform (single-item mode, e.g. ${[...VALID_MAPPING_PLATFORMS].join(", ")})`),
      reason: z.enum(EXCLUSION_REASON_VALUES).optional().describe("Why the artist is being excluded (single-item mode)"),
      details: z.string().optional().describe("Human-readable explanation"),
      items: z.array(excludeItemSchema).max(100).optional().describe("Array of items for batch mode (max 100). When provided, the individual fields above are ignored."),
    },
  },
  async ({ artistId, platform, reason, details, items }) => {
    console.log(`[MCP] exclude_artist_mapping called with ${items !== undefined ? items.length + " item(s) (batch)" : "1 item(s)"}`);

    try {
      const apiKeyHash = requireMcpAuth();

      if (items === undefined) {
        // Single-item path — preserve original behavior exactly
        if (!artistId || !platform || !reason) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Missing required fields: artistId, platform, reason", code: "INVALID_INPUT" }) }],
            isError: true,
          };
        }

        const result = await excludeArtistMapping({
          artistId, platform, reason, details, apiKeyHash,
        });

        try {
          await logMcpAudit({
            artistId, field: `mapping:${platform}`, action: "exclude",
            newValue: details ? `${reason}: ${details}` : reason, apiKeyHash,
          });
        } catch (auditError) {
          console.error("[MCP] Audit log failed (mutation succeeded):", auditError);
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, ...result }, null, 2),
          }],
        };
      }

      // Batch path
      const batchResult = await excludeArtistMappingBatch(items, apiKeyHash);

      // Batch audit for all successful items
      const auditEntries = batchResult.results
        .map((r, i) => ({ r, item: items[i] }))
        .filter(({ r }) => !r.error)
        .map(({ item }) => ({
          artistId: item.artistId,
          field: `mapping:${item.platform}`,
          action: "exclude" as const,
          newValue: item.details ? `${item.reason}: ${item.details}` : item.reason,
          apiKeyHash,
        }));

      if (auditEntries.length > 0) {
        try {
          await logMcpAudit(auditEntries);
        } catch (auditError) {
          console.error("[MCP] Batch audit log failed (mutations succeeded):", auditError);
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: true, results: batchResult.results }, null, 2),
        }],
      };
    } catch (error) {
      if (error instanceof McpAuthError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, code: "AUTH_REQUIRED" }) }],
          isError: true,
        };
      }
      // Single-item error handling (batch errors are captured per-item)
      if (error instanceof MappingNotFoundError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Artist not found", code: "NOT_FOUND" }) }],
          isError: true,
        };
      }
      if (error instanceof MappingValidationError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, code: "INVALID_INPUT" }) }],
          isError: true,
        };
      }
      console.error("[MCP] exclude_artist_mapping error:", error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to exclude artist mapping", code: "INTERNAL_ERROR" }) }],
        isError: true,
      };
    }
  }
);

// Register the get_mapping_exclusions tool
server.registerTool(
  "get_mapping_exclusions",
  {
    title: "Get Mapping Exclusions",
    description: "List artists that have been excluded from mapping for a given platform. Useful for reviewing skipped artists. Clearing exclusions requires direct database access.",
    inputSchema: {
      platform: z.string().describe(`The target platform (e.g. ${[...VALID_MAPPING_PLATFORMS].join(", ")})`),
      limit: z.number().int().min(1).max(500).optional().default(100).describe("Maximum number of results to return (default 100, max 500)"),
    },
  },
  async ({ platform, limit }) => {
    console.log(`[MCP] get_mapping_exclusions called with platform="${platform}", limit=${limit}`);

    try {
      const result = await getMappingExclusions(platform, limit);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            platform,
            exclusions: result.exclusions,
            total: result.total,
          }, null, 2),
        }],
      };
    } catch (error) {
      if (error instanceof MappingValidationError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, code: "INVALID_INPUT" }) }],
          isError: true,
        };
      }
      console.error("[MCP] get_mapping_exclusions error:", error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to get mapping exclusions", code: "INTERNAL_ERROR" }) }],
        isError: true,
      };
    }
  }
);

export { server };
