/**
 * Programmatic ID Mapping & Enrichment (Tier 1 + 2)
 *
 * Replaces LLM-driven Wikidata/MusicBrainz lookups with deterministic API calls.
 * See docs/programmatic-id-mapping-plan.md for full design.
 *
 * Usage:
 *   source .env.local
 *   npx tsx agents/id-mapping/programmatic-resolver.ts collect --out data/wikidata-enrichment.jsonl
 *   npx tsx agents/id-mapping/programmatic-resolver.ts import --file data/wikidata-enrichment.jsonl
 */

import postgres from "postgres";
import {
  readFileSync,
  appendFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { dirname } from "path";
import {
  WIKIDATA_PLATFORM_DEFINITIONS,
} from "../../src/lib/artistResearch/platformRegistry";
import {
  filterSafeWikidataLookupIds,
  lookupWikidataArtists,
} from "../../src/lib/artistResearch/wikidata";
import { verifyDeezerArtistId } from "../../src/lib/artistResearch/deezer";
import {
  queryMusicBrainzByMbid,
  queryMusicBrainzByName,
  type MusicBrainzResult,
} from "../../src/lib/artistResearch/musicbrainz";

// --- Config ---

const DB_URL = process.env.SUPABASE_DB_CONNECTION;
const WIKIDATA_BATCH = parseInt(process.env.WIKIDATA_BATCH || "80", 10);
const DRY_RUN = process.env.DRY_RUN === "1";

// --- Types ---

interface Artist {
  id: string;
  name: string;
  spotifyId: string;
}

interface PlatformMapping {
  platform: string;
  id: string;
  verified?: boolean;
}

interface ArtistLink {
  column: string;
  value: string;
}

interface CollectedArtist {
  artistId: string;
  name: string;
  spotifyId: string;
  source: "wikidata" | "musicbrainz" | "both";
  wikidataId?: string;
  mappings: Record<string, { id: string; verified?: boolean }>;
  artistLinks: Record<string, string>;
}

interface CollectStats {
  totalArtists: number;
  wikidataMatched: number;
  wikidataDeezerVerified: number;
  musicbrainzDeezerResolved: number;
  totalDeezerResolved: number;
  skippedMultiEntity: number;
  errors: number;
}

// Preserve the legacy JSONL shape while deriving Wikidata property metadata
// from the shared registry. New research flows store every allowlisted finding;
// the catalog importer intentionally retains its historical targets.
const LEGACY_MAPPING_PLATFORMS = new Set([
  "deezer",
  "apple_music",
  "musicbrainz",
  "tidal",
  "amazon_music",
  "youtube_music",
  "genius",
  "allmusic",
  "billboard",
  "rolling_stone",
]);

const LEGACY_ARTIST_COLUMN_PLATFORMS = new Set([
  "musicbrainz",
  "discogs",
  "lastfm",
  "soundcloud",
  "imdb",
  "youtube_channel",
  "x",
  "instagram",
  "facebook",
]);

const LEGACY_WIKIDATA_DEFINITIONS = WIKIDATA_PLATFORM_DEFINITIONS.filter(
  (definition) =>
    definition.key !== "spotify" && definition.key !== "official_website",
);

const WIKIDATA_PROPS: Record<
  string,
  { sparqlVar: string; platform?: string; artistColumn?: string }
> = Object.fromEntries(
  LEGACY_WIKIDATA_DEFINITIONS.map((definition) => [
    definition.key,
    {
      sparqlVar: definition.wikidataVariable,
      platform: LEGACY_MAPPING_PLATFORMS.has(definition.key)
        ? definition.key
        : undefined,
      artistColumn: LEGACY_ARTIST_COLUMN_PLATFORMS.has(definition.key)
        ? definition.artistColumn
        : undefined,
    },
  ]),
);

// --- Helpers ---

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function warn(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.warn(`[${ts}] [WARN] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- External API helpers ---

async function queryWikidata(
  spotifyIds: string[],
): Promise<{ results: Map<string, Record<string, string[]>>; skippedMultiEntity: number }> {
  const safeIds = filterSafeWikidataLookupIds(spotifyIds, "spotify");
  if (safeIds.length === 0) {
    return { results: new Map(), skippedMultiEntity: 0 };
  }

  const lookup = await lookupWikidataArtists({
    sourcePlatform: "spotify",
    sourceIds: safeIds,
    targetPlatforms: LEGACY_WIKIDATA_DEFINITIONS.map(
      (definition) => definition.key,
    ),
  });
  const results = new Map<string, Record<string, string[]>>();
  for (const [spotifyId, match] of lookup.matches) {
    const values: Record<string, string[]> = {
      wikidata: [match.entityId],
    };
    for (const definition of LEGACY_WIKIDATA_DEFINITIONS) {
      const platformValues = match.values[definition.key];
      if (platformValues) {
        values[definition.wikidataVariable] = platformValues;
      }
    }
    results.set(spotifyId, values);
  }

  for (const [spotifyId, entityIds] of lookup.ambiguous) {
    warn(
      `Spotify ID ${spotifyId} matched ${entityIds.length} Wikidata entities (${entityIds.join(", ")}) — skipping`,
    );
  }

  return {
    results,
    skippedMultiEntity: lookup.ambiguous.size,
  };
}

// --- Collect command ---

async function collect(outFile: string): Promise<void> {
  if (!DB_URL) {
    console.error("SUPABASE_DB_CONNECTION env var is required");
    process.exit(1);
  }

  const sql = postgres(DB_URL, { prepare: false });
  ensureDir(outFile);

  // Load already-processed spotify IDs for resumability
  // Skip artists with source "error" so they get retried on resume
  const processed = new Set<string>();
  if (existsSync(outFile)) {
    const lines = readFileSync(outFile, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.spotifyId && obj.source !== "error") processed.add(obj.spotifyId);
      } catch {
        // skip malformed lines
      }
    }
    if (processed.size > 0) {
      log(`Resuming: ${processed.size} artists already in ${outFile}`);
    }
  }

  // Load all artists with Spotify IDs
  log("Loading artists from DB...");
  const allArtists = await sql<
    { id: string; name: string; spotify: string }[]
  >`
    SELECT id, name, spotify
    FROM artists
    WHERE spotify IS NOT NULL AND spotify != ''
    ORDER BY name
  `;
  log(`Loaded ${allArtists.length} artists with Spotify IDs`);

  const artists: Artist[] = allArtists
    .filter((a) => !processed.has(a.spotify))
    .map((a) => ({ id: a.id, name: a.name, spotifyId: a.spotify }));
  log(`${artists.length} remaining to process`);

  if (artists.length === 0) {
    log("Nothing to do");
    await sql.end();
    return;
  }

  const stats: CollectStats = {
    totalArtists: allArtists.length,
    wikidataMatched: 0,
    wikidataDeezerVerified: 0,
    musicbrainzDeezerResolved: 0,
    totalDeezerResolved: 0,
    skippedMultiEntity: 0,
    errors: 0,
  };

  // Build spotify→artist lookup
  const spotifyToArtist = new Map<string, Artist>();
  for (const a of artists) spotifyToArtist.set(a.spotifyId, a);

  // Track which artists still need Deezer resolution after Tier 1
  const needsDeezer = new Set<string>(artists.map((a) => a.spotifyId));

  // --- TIER 1: Wikidata SPARQL ---
  const totalBatches = Math.ceil(artists.length / WIKIDATA_BATCH);
  log(`Tier 1: Wikidata SPARQL — ${totalBatches} batches of ${WIKIDATA_BATCH}`);

  for (let i = 0; i < artists.length; i += WIKIDATA_BATCH) {
    const batch = artists.slice(i, i + WIKIDATA_BATCH);
    const batchNum = Math.floor(i / WIKIDATA_BATCH) + 1;
    let batchDeezer = 0;
    let batchMappings = 0;
    let batchLinks = 0;

    try {
      const { results: wikidataResults, skippedMultiEntity } = await queryWikidata(
        batch.map((a) => a.spotifyId),
      );
      stats.skippedMultiEntity += skippedMultiEntity;

      for (const artist of batch) {
        const wdValues = wikidataResults.get(artist.spotifyId);
        if (!wdValues) {
          // No Wikidata match — write empty line so resumability tracks it
          appendFileSync(
            outFile,
            JSON.stringify({
              artistId: artist.id,
              name: artist.name,
              spotifyId: artist.spotifyId,
              source: "none",
              mappings: {},
              artistLinks: {},
            }) + "\n",
          );
          continue;
        }

        stats.wikidataMatched++;
        const collected: CollectedArtist = {
          artistId: artist.id,
          name: artist.name,
          spotifyId: artist.spotifyId,
          source: "wikidata",
          wikidataId: wdValues.wikidata?.[0],
          mappings: {},
          artistLinks: {},
        };

        // Always save wikidata entity ID
        if (wdValues.wikidata?.[0]) {
          collected.artistLinks.wikidata = wdValues.wikidata[0];
          batchLinks++;
        }

        // Process each property
        for (const [, prop] of Object.entries(WIKIDATA_PROPS)) {
          const values = wdValues[prop.sparqlVar];
          if (!values || values.length === 0) continue;
          const val = values[0]; // Pick first for multi-value (Case 2)

          // Platform ID mapping
          if (prop.platform) {
            if (prop.platform === "deezer") {
              // Deezer requires name verification
              const verified = await verifyDeezerArtistId(val, artist.name);
              if (verified) {
                collected.mappings.deezer = { id: val, verified: true };
                needsDeezer.delete(artist.spotifyId);
                stats.wikidataDeezerVerified++;
                batchDeezer++;
                batchMappings++;
              }
            } else {
              collected.mappings[prop.platform] = { id: val };
              batchMappings++;
            }
          }

          // Artist table column
          if (prop.artistColumn) {
            collected.artistLinks[prop.artistColumn] = val;
            batchLinks++;
          }
        }

        appendFileSync(outFile, JSON.stringify(collected) + "\n");
      }
    } catch (err) {
      stats.errors++;
      warn(`Tier 1 batch ${batchNum} failed: ${err}`);
      // Write unprocessed artists as empty so resumability tracks them
      for (const artist of batch) {
        if (!processed.has(artist.spotifyId)) {
          appendFileSync(
            outFile,
            JSON.stringify({
              artistId: artist.id,
              name: artist.name,
              spotifyId: artist.spotifyId,
              source: "error",
              mappings: {},
              artistLinks: {},
            }) + "\n",
          );
        }
      }
    }

    if (batchNum % 10 === 0 || batchNum === totalBatches) {
      log(
        `Tier 1: batch ${batchNum}/${totalBatches} — ${batchDeezer} deezer, ${batchMappings} mappings, ${batchLinks} links`,
      );
    }

    // Rate limit: 1s between Wikidata batches
    if (i + WIKIDATA_BATCH < artists.length) await sleep(1000);
  }

  log(
    `Tier 1 complete: ${stats.wikidataMatched} Wikidata matches, ${stats.wikidataDeezerVerified} Deezer verified, ${needsDeezer.size} still need Deezer`,
  );

  // --- TIER 2: MusicBrainz ---
  // Re-scan JSONL to find artists that still need Deezer (including resumed ones)
  // and build MBID lookup for Path A
  const mbidLookup = new Map<string, string>();
  if (existsSync(outFile)) {
    const existingLines = readFileSync(outFile, "utf-8").split("\n").filter(Boolean);
    for (const line of existingLines) {
      try {
        const obj = JSON.parse(line);
        if (!obj.spotifyId || obj._summary) continue;
        const mbid = obj.mappings?.musicbrainz?.id || obj.artistLinks?.musicbrainz;
        if (mbid) mbidLookup.set(obj.spotifyId, mbid);
        // If this artist has a Deezer mapping already, remove from needsDeezer
        if (obj.mappings?.deezer?.id) needsDeezer.delete(obj.spotifyId);
        // If this artist was processed but has no Deezer, ensure it's in needsDeezer
        if (!obj.mappings?.deezer?.id && obj.source !== "error") {
          needsDeezer.add(obj.spotifyId);
        }
      } catch {
        // skip
      }
    }
  }

  // Build Tier 2 artist list from all artists needing Deezer (including resumed source:"none" ones)
  const allArtistLookup = new Map(allArtists.map((a) => [a.spotify, a]));
  const mbArtists: Artist[] = [];
  for (const spotifyId of needsDeezer) {
    const dbArtist = allArtistLookup.get(spotifyId);
    if (dbArtist) mbArtists.push({ id: dbArtist.id, name: dbArtist.name, spotifyId });
  }
  log(
    `Tier 2: MusicBrainz — ${mbArtists.length} artists (est. ~${Math.ceil(mbArtists.length / 3600)}h at 1 req/s, may be longer if name searches needed)`,
  );

  // We write a second JSONL line with source="musicbrainz" for artists that get data.
  // The import step merges lines for the same artistId.

  let mbProcessed = 0;
  for (const artist of mbArtists) {
    mbProcessed++;
    try {
      const mbid = mbidLookup.get(artist.spotifyId);
      let mbResult: MusicBrainzResult | null = null;

      if (mbid) {
        // Path A: has MBID from Wikidata
        mbResult = await queryMusicBrainzByMbid(mbid);
      } else {
        // Path B: name search
        const searchResult = await queryMusicBrainzByName(artist.name);
        if (searchResult) {
          await sleep(1000); // Rate limit before relationship fetch
          mbResult = await queryMusicBrainzByMbid(searchResult.mbid);
        }
      }

      if (mbResult?.deezerId) {
        const verified = await verifyDeezerArtistId(
          mbResult.deezerId,
          artist.name,
        );
        if (verified) {
          const mbLine: CollectedArtist = {
            artistId: artist.id,
            name: artist.name,
            spotifyId: artist.spotifyId,
            source: "musicbrainz",
            mappings: {
              deezer: { id: mbResult.deezerId, verified: true },
            },
            artistLinks: {},
          };
          // Add any other URLs found
          for (const url of mbResult.otherUrls) {
            // Preserve the legacy importer behavior; the reusable resolver
            // exposes all allowlisted URLs through mbResult.findings.
            if (url.platform === "tidal") {
              mbLine.mappings[url.platform] = { id: url.id };
            }
          }
          appendFileSync(outFile, JSON.stringify(mbLine) + "\n");
          stats.musicbrainzDeezerResolved++;
          needsDeezer.delete(artist.spotifyId);
        }
      }
    } catch (err) {
      if (String(err).includes("503") || String(err).includes("429")) {
        warn(`MusicBrainz rate limited on ${artist.name}, waiting 2s...`);
        await sleep(2000);
      } else {
        stats.errors++;
        warn(`MusicBrainz error for ${artist.name}: ${err}`);
      }
    }

    if (mbProcessed % 100 === 0) {
      log(
        `Tier 2: [${mbProcessed}/${mbArtists.length}] ${stats.musicbrainzDeezerResolved} deezer resolved`,
      );
    }

    // Rate limit: 1s between MusicBrainz requests
    await sleep(1000);
  }

  stats.totalDeezerResolved =
    stats.wikidataDeezerVerified + stats.musicbrainzDeezerResolved;

  // Write summary line
  const summary = {
    _summary: true,
    collectedAt: new Date().toISOString(),
    totalArtists: stats.totalArtists,
    wikidataMatched: stats.wikidataMatched,
    wikidataDeezerVerified: stats.wikidataDeezerVerified,
    musicbrainzDeezerResolved: stats.musicbrainzDeezerResolved,
    totalDeezerResolved: stats.totalDeezerResolved,
    skippedMultiEntity: stats.skippedMultiEntity,
    errors: stats.errors,
    remainingForClaude: artists.length - stats.totalDeezerResolved,
  };
  appendFileSync(outFile, JSON.stringify(summary) + "\n");

  log("");
  log("=== Collect Summary ===");
  log(`Duration:              ${process.uptime().toFixed(0)}s`);
  log(`Wikidata matches:      ${stats.wikidataMatched} / ${stats.totalArtists}`);
  log(`Deezer resolved:       ${stats.totalDeezerResolved} (Wikidata: ${stats.wikidataDeezerVerified} + MusicBrainz: ${stats.musicbrainzDeezerResolved})`);
  log(`Remaining for Claude:  ${artists.length - stats.totalDeezerResolved}`);
  log(`Errors:                ${stats.errors}`);
  log(`Output:                ${outFile}`);

  await sql.end();
}

// --- Import command ---

async function importData(inFile: string): Promise<void> {
  if (!DB_URL) {
    console.error("SUPABASE_DB_CONNECTION env var is required");
    process.exit(1);
  }
  if (!existsSync(inFile)) {
    console.error(`File not found: ${inFile}`);
    process.exit(1);
  }

  const sql = postgres(DB_URL, { prepare: false });

  log(`Reading ${inFile}...`);
  const lines = readFileSync(inFile, "utf-8").split("\n").filter(Boolean);

  // Parse all artist lines (skip summary)
  const artistMap = new Map<string, CollectedArtist>();
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj._summary) continue;
      if (!obj.artistId) continue;

      // Merge multiple lines for the same artist (Tier 1 + Tier 2)
      const existing = artistMap.get(obj.artistId);
      if (existing) {
        existing.source = "both";
        // Merge mappings, tagging new ones with their source
        for (const [platform, mapping] of Object.entries(obj.mappings ?? {})) {
          if (!existing.mappings[platform]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (mapping as any)._source = obj.source;
            existing.mappings[platform] = mapping as { id: string; verified?: boolean };
          }
        }
        // Don't overwrite existing artistLinks — Tier 1 (wikidata) is more comprehensive
        for (const [k, v] of Object.entries(obj.artistLinks ?? {})) {
          if (!existing.artistLinks[k]) existing.artistLinks[k] = v as string;
        }
      } else {
        artistMap.set(obj.artistId, {
          artistId: obj.artistId,
          name: obj.name,
          spotifyId: obj.spotifyId,
          source: obj.source,
          wikidataId: obj.wikidataId,
          mappings: obj.mappings ?? {},
          artistLinks: obj.artistLinks ?? {},
        });
      }
    } catch {
      // skip malformed lines
    }
  }

  log(`Parsed ${artistMap.size} artists from JSONL`);

  // --- Bulk insert: artist_id_mappings ---
  log("Inserting platform ID mappings...");

  let mappingsInserted = 0;
  let mappingsSkipped = 0;

  // Collect all mapping rows
  const mappingRows: {
    artistId: string;
    platform: string;
    platformId: string;
    confidence: string;
    source: string;
  }[] = [];

  for (const artist of artistMap.values()) {
    for (const [platform, mapping] of Object.entries(artist.mappings)) {
      if (!mapping.id) continue;
      // Use per-mapping source if tagged during merge, otherwise derive from artist source
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappingSource = (mapping as any)._source ?? artist.source;
      mappingRows.push({
        artistId: artist.artistId,
        platform,
        platformId: mapping.id,
        confidence: "high",
        source: mappingSource === "both" ? "wikidata" : mappingSource,
      });
    }
  }

  // Batch insert in chunks
  const CHUNK = 500;
  for (let i = 0; i < mappingRows.length; i += CHUNK) {
    const chunk = mappingRows.slice(i, i + CHUNK);
    if (DRY_RUN) {
      mappingsInserted += chunk.length;
      continue;
    }

    // Use a CTE to get which rows were actually inserted vs skipped
    const result = await sql`
      INSERT INTO artist_id_mappings (artist_id, platform, platform_id, confidence, source)
      SELECT artist_id::uuid, platform, platform_id, confidence::confidence_level, source FROM (VALUES
        ${sql(chunk.map((r) => [r.artistId, r.platform, r.platformId, r.confidence, r.source]))}
      ) AS v(artist_id, platform, platform_id, confidence, source)
      ON CONFLICT DO NOTHING
      RETURNING artist_id, platform
    `;
    mappingsInserted += result.length;
    mappingsSkipped += chunk.length - result.length;
  }

  log(
    `Mappings: ${mappingsInserted} inserted, ${mappingsSkipped} skipped`,
  );

  // --- Update artists table columns ---
  log("Updating artist columns...");

  // Load current artist data for conflict detection
  const artistIds = [...artistMap.keys()];

  const currentData = new Map<
    string,
    Record<string, string | null>
  >();

  // Fetch in batches
  for (let i = 0; i < artistIds.length; i += 1000) {
    const idChunk = artistIds.slice(i, i + 1000);
    const rows = await sql`
      SELECT id, wikidata, musicbrainz, discogs, lastfm, soundcloud, imdb,
             youtubechannel, x, instagram, facebook, "facebookID"
      FROM artists
      WHERE id = ANY(${idChunk}::uuid[])
    `;
    for (const row of rows) {
      currentData.set(row.id, row as Record<string, string | null>);
    }
  }

  let columnsUpdated = 0;
  let columnsSkippedMatch = 0;
  let columnsSkippedPopulated = 0;
  const conflicts: {
    artistId: string;
    artistName: string;
    field: string;
    currentValue: string;
    wikidataValue: string;
    wikidataEntityId?: string;
  }[] = [];

  // Map from JSONL key → DB column name
  const jsonKeyToDbColumn: Record<string, string> = {
    wikidata: "wikidata",
    musicbrainz: "musicbrainz",
    discogs: "discogs",
    lastfm: "lastfm",
    soundcloud: "soundcloud",
    imdb: "imdb",
    youtubechannel: "youtubechannel",
    x: "x",
    instagram: "instagram",
    facebook: "facebook",
    facebookID: "facebookID",
  };

  for (const artist of artistMap.values()) {
    const current = currentData.get(artist.artistId);
    if (!current) continue;

    const updates: Record<string, string> = {};

    for (const [jsonKey, value] of Object.entries(artist.artistLinks)) {
      const dbCol = jsonKeyToDbColumn[jsonKey];
      if (!dbCol) continue;

      const currentVal = current[dbCol];
      if (!currentVal || currentVal === "") {
        // Column is empty — write
        updates[dbCol] = value;
      } else if (currentVal === value) {
        // Already matches — skip
        columnsSkippedMatch++;
      } else {
        // Conflict — log it
        conflicts.push({
          artistId: artist.artistId,
          artistName: artist.name,
          field: dbCol,
          currentValue: currentVal,
          wikidataValue: value,
          wikidataEntityId: artist.wikidataId,
        });
        columnsSkippedPopulated++;
      }
    }

    if (Object.keys(updates).length > 0 && !DRY_RUN) {
      // Use parameterized query via postgres tagged template
      await sql`UPDATE artists SET ${sql(updates)}, updated_at = NOW() WHERE id = ${artist.artistId}::uuid`;
      columnsUpdated += Object.keys(updates).length;
    } else if (DRY_RUN) {
      columnsUpdated += Object.keys(updates).length;
    }
  }

  // Write conflicts file
  if (conflicts.length > 0) {
    const conflictsFile = inFile.replace(/\.jsonl$/, "-conflicts.json");
    ensureDir(conflictsFile);
    writeFileSync(
      conflictsFile,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          totalConflicts: conflicts.length,
          conflicts,
        },
        null,
        2,
      ),
    );
    log(`Conflicts: ${conflicts.length} (written to ${conflictsFile})`);
  }

  log("");
  log("=== Import Summary ===");
  log(`Mappings inserted:     ${mappingsInserted}`);
  log(`Mappings skipped:      ${mappingsSkipped}`);
  log(`Columns updated:       ${columnsUpdated}`);
  log(`Columns skipped:       ${columnsSkippedMatch} (already match) + ${columnsSkippedPopulated} (conflicts)`);
  if (DRY_RUN) log("(DRY RUN — no writes performed)");

  await sql.end();
}

// --- CLI ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "collect") {
    const outIdx = args.indexOf("--out");
    const outFile = outIdx >= 0 ? args[outIdx + 1] : "data/wikidata-enrichment.jsonl";
    if (!outFile) {
      console.error("Usage: programmatic-resolver.ts collect --out <file.jsonl>");
      process.exit(1);
    }
    await collect(outFile);
  } else if (cmd === "import") {
    const fileIdx = args.indexOf("--file");
    const inFile = fileIdx >= 0 ? args[fileIdx + 1] : undefined;
    if (!inFile) {
      console.error(
        "Usage: programmatic-resolver.ts import --file <file.jsonl>",
      );
      process.exit(1);
    }
    await importData(inFile);
  } else {
    console.error("Usage: programmatic-resolver.ts <collect|import> [options]");
    console.error("");
    console.error("Commands:");
    console.error(
      "  collect --out <file.jsonl>   Collect data from Wikidata/MusicBrainz",
    );
    console.error(
      "  import --file <file.jsonl>   Import collected data into DB",
    );
    console.error("");
    console.error("Environment variables:");
    console.error(
      "  SUPABASE_DB_CONNECTION       Postgres connection string (required)",
    );
    console.error(
      "  WIKIDATA_BATCH               Spotify IDs per SPARQL query (default: 80)",
    );
    console.error(
      "  DRY_RUN=1                    Skip writes in import step",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
