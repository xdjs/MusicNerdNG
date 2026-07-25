/**
 * Queries for the Artist Data admin tab.
 * Surfaces artist link coverage, platform ID coverage,
 * data completeness distribution, and enrichment readiness.
 */
import { db } from "@/server/db/drizzle";
import { sql } from "drizzle-orm";

// --- Column config ---

// Spotify is excluded — it's already shown as the denominator in Platform ID Coverage
// and in totalWithSpotify. Including it here would double-count across sections.
const TRACKED_COLUMNS = [
  { column: "instagram", category: "social" },
  { column: "x", category: "social" },
  { column: "facebook", category: "social" },
  { column: "tiktok", category: "social" },
  { column: "youtube", category: "social" },
  { column: "youtubechannel", category: "social" },
  { column: "soundcloud", category: "listen" },
  { column: "bandcamp", category: "listen" },
  { column: "subvert", category: "listen" },
  { column: "discogs", category: "reference" },
  { column: "lastfm", category: "reference" },
  { column: "musicbrainz", category: "reference" },
  { column: "wikidata", category: "reference" },
  { column: "imdb", category: "reference" },
  { column: "wikipedia", category: "reference" },
  { column: "bio", category: "content" },
  { column: "linkedin", category: "social" },
  { column: "farcaster", category: "social" },
  { column: "twitch", category: "social" },
  { column: "patreon", category: "social" },
] as const;

type Category = (typeof TRACKED_COLUMNS)[number]["category"];

// --- Types ---

export interface PlatformIdCoverageItem {
  platform: string;
  count: number;
  percentage: number;
  todayCount: number;
}

export interface ArtistLinkCoverageItem {
  column: string;
  category: Category;
  count: number;
  percentage: number;
  todayCount: number;
}

export interface CompletenessBucket {
  bucket: string;
  count: number;
  percentage: number;
}

export interface EnrichmentReadiness {
  hasWikidata: number;
  hasSpotifyNoWikidata: number;
  noSpotify: number;
}

export interface ArtistDataSummary {
  totalArtists: number;
  totalWithSpotify: number;
  platformIdCoverage: PlatformIdCoverageItem[];
  artistLinkCoverage: ArtistLinkCoverageItem[];
  completenessDistribution: CompletenessBucket[];
  medianFields: number;
  averageFields: number;
  enrichmentReadiness: EnrichmentReadiness;
}

// --- Sub-queries ---

/**
 * Combined query: total counts, per-column coverage (Section 2), and enrichment readiness (Section 4).
 * Single table scan of `artists`. Uses explicit aliases for reliable key-based access.
 */
async function getArtistTotalsAndCoverage() {
  // Build dynamic FILTER clauses with explicit aliases (col_<name>)
  const columnFilters = TRACKED_COLUMNS.map(
    ({ column }) =>
      sql`COUNT(*) FILTER (WHERE ${sql.identifier(column)} IS NOT NULL AND ${sql.identifier(column)} != '')::int AS ${sql.raw(`col_${column}`)}`
  );

  const query = sql`
    SELECT
      COUNT(*)::int AS total_artists,
      COUNT(*) FILTER (WHERE spotify IS NOT NULL AND spotify != '')::int AS total_with_spotify,
      ${sql.join(columnFilters, sql`, `)},
      COUNT(*) FILTER (WHERE wikidata IS NOT NULL AND wikidata != '')::int AS has_wikidata,
      COUNT(*) FILTER (WHERE spotify IS NOT NULL AND spotify != '' AND (wikidata IS NULL OR wikidata = ''))::int AS has_spotify_no_wikidata,
      COUNT(*) FILTER (WHERE spotify IS NULL OR spotify = '')::int AS no_spotify
    FROM artists
  `;

  const rows = await db.execute(query);
  const row = rows[0] as Record<string, number> | undefined;
  if (!row) {
    return {
      totalArtists: 0,
      totalWithSpotify: 0,
      columnCounts: {} as Record<string, number>,
      enrichment: { hasWikidata: 0, hasSpotifyNoWikidata: 0, noSpotify: 0 },
    };
  }

  const totalArtists = row.total_artists ?? 0;
  const totalWithSpotify = row.total_with_spotify ?? 0;

  const columnCounts: Record<string, number> = {};
  for (const { column } of TRACKED_COLUMNS) {
    columnCounts[column] = row[`col_${column}`] ?? 0;
  }

  return {
    totalArtists,
    totalWithSpotify,
    columnCounts,
    enrichment: {
      hasWikidata: row.has_wikidata ?? 0,
      hasSpotifyNoWikidata: row.has_spotify_no_wikidata ?? 0,
      noSpotify: row.no_spotify ?? 0,
    },
  };
}

/** Section 1: Platform ID mapping counts + today counts in a single query. */
async function getPlatformIdStats(): Promise<Map<string, { count: number; todayCount: number }>> {
  const rows = await db.execute<{ platform: string; count: number; today_count: number }>(sql`
    SELECT platform,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today_count
    FROM artist_id_mappings
    GROUP BY platform
    ORDER BY count DESC
  `);
  return new Map([...rows].map(r => [r.platform, { count: r.count, todayCount: r.today_count }]));
}

/**
 * Section 2: Today counts for artist link columns (from audit log).
 * Only captures MCP-driven writes (set_artist_link via MCP tools).
 * Manual edits, UGC approvals, and direct DB writes are not tracked.
 */
async function getLinkTodayCounts(): Promise<Map<string, number>> {
  const rows = await db.execute<{ field: string; today: number }>(sql`
    SELECT field, COUNT(DISTINCT artist_id)::int AS today
    FROM mcp_audit_log
    WHERE action = 'set'
      AND created_at >= CURRENT_DATE
    GROUP BY field
  `);
  return new Map([...rows].map(r => [r.field, r.today]));
}

/** Section 3: Completeness distribution with median and average. */
async function getCompletenessDistribution() {
  // Build the SUM of CASE expressions for field_count
  const caseExpressions = TRACKED_COLUMNS.map(
    ({ column }) =>
      sql`CASE WHEN ${sql.identifier(column)} IS NOT NULL AND ${sql.identifier(column)} != '' THEN 1 ELSE 0 END`
  );
  const fieldCountExpr = sql.join(caseExpressions, sql` + `);

  const rows = await db.execute<{
    bucket: string;
    count: number;
    sort_order: number;
    median_fields: string;
    avg_fields: string;
  }>(sql`
    WITH field_counts AS (
      SELECT (${fieldCountExpr}) AS field_count
      FROM artists
    ),
    stats AS (
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY field_count)::numeric(5,1) AS median_fields,
        AVG(field_count)::numeric(5,1) AS avg_fields
      FROM field_counts
    )
    SELECT
      CASE
        WHEN fc.field_count <= 1 THEN '0-1'
        WHEN fc.field_count <= 3 THEN '2-3'
        WHEN fc.field_count <= 6 THEN '4-6'
        WHEN fc.field_count <= 10 THEN '7-10'
        ELSE '11+'
      END AS bucket,
      CASE
        WHEN fc.field_count <= 1 THEN 1
        WHEN fc.field_count <= 3 THEN 2
        WHEN fc.field_count <= 6 THEN 3
        WHEN fc.field_count <= 10 THEN 4
        ELSE 5
      END AS sort_order,
      COUNT(*)::int AS count,
      s.median_fields,
      s.avg_fields
    FROM field_counts fc, stats s
    GROUP BY bucket, sort_order, s.median_fields, s.avg_fields
    ORDER BY sort_order
  `);

  const allRows = [...rows];
  const totalArtists = allRows.reduce((sum, r) => sum + r.count, 0);
  // median_fields and avg_fields are identical across all rows because the
  // `stats` CTE is cross-joined — safe to read from any row.
  const medianFields = parseFloat(allRows[0]?.median_fields ?? "0");
  const averageFields = parseFloat(allRows[0]?.avg_fields ?? "0");

  const buckets: CompletenessBucket[] = allRows.map(r => ({
    bucket: r.bucket,
    count: r.count,
    percentage: totalArtists > 0
      ? Math.round((r.count / totalArtists) * 10000) / 100
      : 0,
  }));

  return { buckets, medianFields, averageFields };
}

// --- Main export ---

export async function getArtistDataSummary(): Promise<ArtistDataSummary> {
  const [
    totalsAndCoverage,
    platformStats,
    linkTodayCounts,
    completeness,
  ] = await Promise.all([
    getArtistTotalsAndCoverage(),
    getPlatformIdStats(),
    getLinkTodayCounts(),
    getCompletenessDistribution(),
  ]);

  const { totalArtists, totalWithSpotify, columnCounts, enrichment } = totalsAndCoverage;

  // Section 1: Platform ID coverage (mapped IDs from artist_id_mappings)
  const platformIdCoverage: PlatformIdCoverageItem[] = [...platformStats.entries()].map(
    ([platform, stats]) => ({
      platform,
      count: stats.count,
      percentage: totalWithSpotify > 0
        ? Math.round((stats.count / totalWithSpotify) * 10000) / 100
        : 0,
      todayCount: stats.todayCount,
    })
  );

  // Section 2: Artist link coverage
  const artistLinkCoverage: ArtistLinkCoverageItem[] = TRACKED_COLUMNS.map(
    ({ column, category }) => {
      const count = columnCounts[column] ?? 0;
      return {
        column,
        category,
        count,
        percentage: totalArtists > 0
          ? Math.round((count / totalArtists) * 10000) / 100
          : 0,
        todayCount: linkTodayCounts.get(column) ?? 0,
      };
    }
  );

  return {
    totalArtists,
    totalWithSpotify,
    platformIdCoverage,
    artistLinkCoverage,
    completenessDistribution: completeness.buckets,
    medianFields: completeness.medianFields,
    averageFields: completeness.averageFields,
    enrichmentReadiness: enrichment,
  };
}
