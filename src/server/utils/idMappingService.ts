/**
 * Service layer for cross-platform artist ID mappings.
 * Maps Spotify artist IDs to Deezer, Apple Music, MusicBrainz, etc.
 */
import { db } from "@/server/db/drizzle";
import { eq, and, sql, asc } from "drizzle-orm";
import { artists, artistIdMappings, artistMappingExclusions } from "@/server/db/schema";

export class MappingNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "MappingNotFoundError"; }
}

export class MappingConflictError extends Error {
  constructor(message: string) { super(message); this.name = "MappingConflictError"; }
}

export class MappingConcurrentWriteError extends Error {
  constructor(message: string) { super(message); this.name = "MappingConcurrentWriteError"; }
}

export class MappingValidationError extends Error {
  constructor(message: string) { super(message); this.name = "MappingValidationError"; }
}

export const VALID_MAPPING_PLATFORMS = new Set([
  "deezer", "apple_music", "musicbrainz", "wikidata",
  "tidal", "amazon_music", "youtube_music",
  "genius", "allmusic", "billboard", "rolling_stone",
]);

export const VALID_SOURCES = new Set([
  "wikidata", "musicbrainz", "name_search", "web_search", "manual",
]);

// z.enum requires a readonly array; VALID_EXCLUSION_REASONS is the Set for O(1) lookups
export const EXCLUSION_REASON_VALUES = ["conflict", "name_mismatch", "too_ambiguous"] as const;
export type ExclusionReason = typeof EXCLUSION_REASON_VALUES[number];
export const VALID_EXCLUSION_REASONS = new Set<ExclusionReason>(EXCLUSION_REASON_VALUES);

export type MappingConfidence = "high" | "medium" | "low" | "manual";
export type MappingSource = "wikidata" | "musicbrainz" | "name_search" | "web_search" | "manual";

const CONFIDENCE_PRIORITY: Record<string, number> = {
  manual: 4, high: 3, medium: 2, low: 1,
};

function extractPgError(err: unknown): { code: string; constraint: string } | null {
  // Check the error itself, then err.cause (Drizzle wraps Postgres errors)
  for (const obj of [err, err && typeof err === "object" && "cause" in err ? (err as { cause: unknown }).cause : null]) {
    if (obj && typeof obj === "object" && "code" in obj && typeof (obj as { code: unknown }).code === "string") {
      return {
        code: (obj as { code: string }).code,
        constraint: "constraint_name" in obj ? String((obj as { constraint_name: unknown }).constraint_name) :
                    "constraint" in obj ? String((obj as { constraint: unknown }).constraint) : "",
      };
    }
  }
  return null;
}

function handleUniqueViolation(err: unknown, platform: string, platformId: string): never {
  const pg = extractPgError(err);
  if (pg && pg.code === "23505") {
    if (pg.constraint === "artist_id_mappings_platform_id_uniq") {
      throw new MappingConflictError(`platformId ${platformId} on ${platform} is already mapped to a different artist`);
    }
    // artist_id_mappings_artist_platform_uniq — concurrent insert race for same artist+platform
    throw new MappingConcurrentWriteError(`A mapping for ${platform} already exists for this artist (concurrent write)`);
  }
  throw err;
}

export async function getUnmappedArtists(
  platform: string,
  limit: number,
  offset: number,
  basePlatform: 'spotify' | 'deezer' = 'spotify',
): Promise<{ artists: { id: string; name: string | null; spotify: string | null; deezer: string | null }[]; totalUnmapped: number }> {
  if (!VALID_MAPPING_PLATFORMS.has(platform)) {
    throw new MappingValidationError(`Invalid platform: ${platform}`);
  }

  const baseFilter = basePlatform === 'deezer'
    ? sql`a.deezer IS NOT NULL`
    : sql`a.spotify IS NOT NULL`;

  const [countResult, result] = await Promise.all([
    db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total
      FROM artists a
      WHERE ${baseFilter}
        AND NOT EXISTS (
          SELECT 1 FROM artist_id_mappings m
          WHERE m.artist_id = a.id AND m.platform = ${platform}
        )
        AND NOT EXISTS (
          SELECT 1 FROM artist_mapping_exclusions e
          WHERE e.artist_id = a.id AND e.platform = ${platform}
        )
    `),
    db.execute<{ id: string; name: string | null; spotify: string | null; deezer: string | null }>(sql`
      SELECT a.id, a.name, a.spotify, a.deezer
      FROM artists a
      WHERE ${baseFilter}
        AND NOT EXISTS (
          SELECT 1 FROM artist_id_mappings m
          WHERE m.artist_id = a.id AND m.platform = ${platform}
        )
        AND NOT EXISTS (
          SELECT 1 FROM artist_mapping_exclusions e
          WHERE e.artist_id = a.id AND e.platform = ${platform}
        )
      ORDER BY MD5(a.id || CURRENT_DATE::text)
      LIMIT ${limit} OFFSET ${offset}
    `),
  ]);

  return {
    artists: [...result],
    totalUnmapped: countResult[0]?.total ?? 0,
  };
}

export async function resolveArtistMapping(params: {
  artistId: string;
  platform: string;
  platformId: string;
  confidence: string;
  source: string;
  reasoning?: string;
  apiKeyHash?: string;
}): Promise<{ created: boolean; updated: boolean; skipped: boolean; previousMapping?: { platformId: string; confidence: string } }> {
  const { artistId, platform, platformId, confidence, source, reasoning, apiKeyHash } = params;

  if (!VALID_MAPPING_PLATFORMS.has(platform)) {
    throw new MappingValidationError(`Invalid platform: ${platform}`);
  }
  if (!VALID_SOURCES.has(source)) {
    throw new MappingValidationError(`Invalid source: ${source}`);
  }
  if (!(confidence in CONFIDENCE_PRIORITY)) {
    throw new MappingValidationError(`Invalid confidence level: ${confidence}`);
  }
  if (!platformId.trim()) {
    throw new MappingValidationError("platformId cannot be empty");
  }

  // Verify artist exists
  const artist = await db.query.artists.findFirst({
    where: eq(artists.id, artistId),
    columns: { id: true },
  });
  if (!artist) {
    throw new MappingNotFoundError(`Artist not found: ${artistId}`);
  }

  // Check for existing mapping on this artist+platform
  const existing = await db.query.artistIdMappings.findFirst({
    where: and(eq(artistIdMappings.artistId, artistId), eq(artistIdMappings.platform, platform)),
  });

  if (existing) {
    const existingPriority = CONFIDENCE_PRIORITY[existing.confidence] ?? 0;
    const newPriority = CONFIDENCE_PRIORITY[confidence] ?? 0;

    // Equal confidence overwrites intentionally — latest submission wins at the same tier
    if (newPriority < existingPriority) {
      return {
        created: false,
        updated: false,
        skipped: true,
        previousMapping: { platformId: existing.platformId, confidence: existing.confidence },
      };
    }

    try {
      await db.execute(sql`
        UPDATE artist_id_mappings
        SET platform_id = ${platformId},
            confidence = ${confidence}::confidence_level,
            source = ${source},
            reasoning = ${reasoning ?? null},
            api_key_hash = ${apiKeyHash ?? null},
            resolved_at = now(),
            updated_at = now()
        WHERE artist_id = ${artistId} AND platform = ${platform}
      `);
    } catch (err: unknown) {
      handleUniqueViolation(err, platform, platformId);
    }

    return {
      created: false,
      updated: true,
      skipped: false,
      previousMapping: { platformId: existing.platformId, confidence: existing.confidence },
    };
  }

  try {
    await db.execute(sql`
      INSERT INTO artist_id_mappings (artist_id, platform, platform_id, confidence, source, reasoning, api_key_hash)
      VALUES (${artistId}, ${platform}, ${platformId}, ${confidence}::confidence_level, ${source}, ${reasoning ?? null}, ${apiKeyHash ?? null})
    `);
  } catch (err: unknown) {
    handleUniqueViolation(err, platform, platformId);
  }

  return { created: true, updated: false, skipped: false };
}

export async function getMappingStats(): Promise<{
  totalArtistsWithSpotify: number;
  totalArtistsWithDeezer: number;
  platformStats: { platform: string; mappedCount: number; percentage: number }[];
}> {
  const [totalResult, totalDeezerResult, statsResult] = await Promise.all([
    db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total FROM artists WHERE spotify IS NOT NULL
    `),
    db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total FROM artists WHERE deezer IS NOT NULL
    `),
    db.execute<{ platform: string; mapped_count: number }>(sql`
      SELECT platform, COUNT(*)::int AS mapped_count
      FROM artist_id_mappings
      GROUP BY platform
      ORDER BY mapped_count DESC
    `),
  ]);

  const totalArtistsWithSpotify = totalResult[0]?.total ?? 0;
  const totalArtistsWithDeezer = totalDeezerResult[0]?.total ?? 0;

  // Build a map of DB results, then ensure all valid platforms are represented
  const dbStats = new Map([...statsResult].map(row => [row.platform, row.mapped_count]));
  const platformStats = [...VALID_MAPPING_PLATFORMS].map(platform => {
    const mappedCount = dbStats.get(platform) ?? 0;
    return {
      platform,
      mappedCount,
      percentage: totalArtistsWithSpotify > 0
        ? Math.round((mappedCount / totalArtistsWithSpotify) * 10000) / 100
        : 0,
    };
  });

  return { totalArtistsWithSpotify, totalArtistsWithDeezer, platformStats };
}

export async function getArtistMappings(artistId: string) {
  // Single query — FK constraint means results imply artist exists.
  // Empty result could mean no mappings or unknown artist, so check the artist table only on empty.
  const mappings = await db.query.artistIdMappings.findMany({
    where: eq(artistIdMappings.artistId, artistId),
    orderBy: [asc(artistIdMappings.platform)],
    columns: {
      id: true,
      platform: true,
      platformId: true,
      confidence: true,
      source: true,
      reasoning: true,
      resolvedAt: true,
    },
  });

  if (mappings.length === 0) {
    const artist = await db.query.artists.findFirst({
      where: eq(artists.id, artistId),
      columns: { id: true },
    });
    if (!artist) {
      throw new MappingNotFoundError(`Artist not found: ${artistId}`);
    }
  }

  return mappings;
}

export async function excludeArtistMapping(params: {
  artistId: string;
  platform: string;
  reason: ExclusionReason;
  details?: string;
  apiKeyHash?: string;
}): Promise<{ created: boolean; updated: boolean }> {
  const { artistId, platform, reason, details, apiKeyHash } = params;

  if (!VALID_MAPPING_PLATFORMS.has(platform)) {
    throw new MappingValidationError(`Invalid platform: ${platform}`);
  }
  if (!VALID_EXCLUSION_REASONS.has(reason)) {
    throw new MappingValidationError(`Invalid exclusion reason: ${reason}`);
  }

  const artist = await db.query.artists.findFirst({
    where: eq(artists.id, artistId),
    columns: { id: true },
  });
  if (!artist) {
    throw new MappingNotFoundError(`Artist not found: ${artistId}`);
  }

  const result = await db.execute<{ xmax: string }>(sql`
    INSERT INTO artist_mapping_exclusions (artist_id, platform, reason, details, api_key_hash)
    VALUES (${artistId}, ${platform}, ${reason}::exclusion_reason, ${details ?? null}, ${apiKeyHash ?? null})
    ON CONFLICT (artist_id, platform) DO UPDATE SET
      reason = EXCLUDED.reason,
      details = EXCLUDED.details,
      api_key_hash = EXCLUDED.api_key_hash
    RETURNING xmax
  `);

  // xmax = '0' means INSERT, non-zero means UPDATE
  const wasInsert = result[0]?.xmax === "0";
  return { created: wasInsert, updated: !wasInsert };
}

export type ResolveItem = {
  artistId: string;
  platform: string;
  platformId: string;
  confidence: MappingConfidence;
  source: MappingSource;
  reasoning?: string;
};

export type ResolveBatchResult = {
  artistId: string;
  created: boolean;
  updated: boolean;
  skipped: boolean;
  previousMapping?: { platformId: string; confidence: string };
  error?: string;
};

export async function resolveArtistMappingBatch(
  items: ResolveItem[],
  apiKeyHash: string,
): Promise<{ results: ResolveBatchResult[] }> {
  const results: ResolveBatchResult[] = [];

  for (const item of items) {
    try {
      const result = await resolveArtistMapping({ ...item, apiKeyHash });
      results.push({
        artistId: item.artistId,
        ...result,
      });
    } catch (err: unknown) {
      results.push({
        artistId: item.artistId,
        created: false,
        updated: false,
        skipped: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results };
}

export type ExcludeItem = {
  artistId: string;
  platform: string;
  reason: ExclusionReason;
  details?: string;
};

export type ExcludeBatchResult = {
  artistId: string;
  created: boolean;
  updated: boolean;
  error?: string;
};

export async function excludeArtistMappingBatch(
  items: ExcludeItem[],
  apiKeyHash: string,
): Promise<{ results: ExcludeBatchResult[] }> {
  const results: ExcludeBatchResult[] = [];

  for (const item of items) {
    try {
      const result = await excludeArtistMapping({ ...item, apiKeyHash });
      results.push({
        artistId: item.artistId,
        ...result,
      });
    } catch (err: unknown) {
      results.push({
        artistId: item.artistId,
        created: false,
        updated: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results };
}

export async function getMappingExclusions(
  platform: string,
  limit: number = 100,
): Promise<{ exclusions: { id: string; artistId: string; artistName: string | null; spotify: string | null; platform: string; reason: string; details: string | null; createdAt: string }[]; total: number }> {
  if (!VALID_MAPPING_PLATFORMS.has(platform)) {
    throw new MappingValidationError(`Invalid platform: ${platform}`);
  }

  const effectiveLimit = Math.min(Math.max(limit, 1), 500);

  const [countResult, result] = await Promise.all([
    db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total
      FROM artist_mapping_exclusions
      WHERE platform = ${platform}
    `),
    db.execute<{ id: string; artist_id: string; artist_name: string | null; spotify: string | null; platform: string; reason: string; details: string | null; created_at: string }>(sql`
      SELECT e.id, e.artist_id, a.name AS artist_name, a.spotify, e.platform, e.reason, e.details, e.created_at
      FROM artist_mapping_exclusions e
      JOIN artists a ON a.id = e.artist_id
      WHERE e.platform = ${platform}
      ORDER BY e.created_at DESC
      LIMIT ${effectiveLimit}
    `),
  ]);

  return {
    exclusions: [...result].map(row => ({
      id: row.id,
      artistId: row.artist_id,
      artistName: row.artist_name,
      spotify: row.spotify,
      platform: row.platform,
      reason: row.reason,
      details: row.details,
      createdAt: row.created_at,
    })),
    total: countResult[0]?.total ?? 0,
  };
}
