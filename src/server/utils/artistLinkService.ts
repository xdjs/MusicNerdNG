/**
 * Shared helpers for writing/clearing platform links on artist records.
 * Used by MCP tools and artistQueries.ts (approveUGC, removeArtistData).
 */
import { db } from "@/server/db/drizzle";
import { eq, sql } from "drizzle-orm";
import { artists } from "@/server/db/schema";
import { regenerateArtistBio } from "./queries/artistBioQuery";

export const BIO_RELEVANT_COLUMNS = ["spotify", "deezer", "instagram", "x", "soundcloud", "youtube", "youtubechannel"];

// Whitelist of platform columns that can be written via link helpers.
// Derived from the artists table schema — only platform/social columns.
// System columns (id, name, bio, etc.) are excluded by omission.
const WRITABLE_LINK_COLUMNS = new Set([
  "bandcamp", "deezer", "facebook", "x", "soundcloud", "patreon", "instagram",
  "youtube", "youtubechannel", "spotify", "twitch", "imdb", "musicbrainz",
  "wikidata", "mixcloud", "facebookID", "discogs", "tiktok", "tiktokID",
  "jaxsta", "famousbirthdays", "songexploder", "colorsxstudios", "bandsintown",
  "linktree", "onlyfans", "wikipedia", "audius", "zora", "catalog", "opensea",
  "foundation", "lastfm", "linkedin", "soundxyz", "mirror", "glassnode",
  "spotifyusername", "bandcampfan", "tellie", "lens", "cameo", "farcaster",
  "supercollector", "ens", "subvert", "bluesky",
]);

// Drizzle row properties can differ from the physical column names used in SQL.
const ARTIST_ROW_PROPERTY_BY_COLUMN: Record<string, string> = {
  facebookID: "facebookId",
  tiktokID: "tiktokId",
};

export type ArtistLinkExecutor = Pick<typeof db, "query" | "execute">;
export type ArtistLinkWriteMode = "overwrite" | "fill_empty";
export type ArtistLinkBioMode = "invalidate" | "preserve";
export type ArtistLinkWriteResult = {
  oldValue: string | null;
  artistName: string | null;
  status: "written" | "unchanged" | "conflict";
};

export function sanitizeColumnName(siteName: string): string {
  return siteName.replace(/[^a-zA-Z0-9_]/g, "");
}

function assertWritable(columnName: string): void {
  if (!columnName) {
    throw new Error("Invalid column name");
  }
  if (columnName === "wallets" || columnName === "wallet") {
    throw new Error("Wallets must be managed through dedicated array operations");
  }
  if (!WRITABLE_LINK_COLUMNS.has(columnName)) {
    throw new Error(`Column not in writable whitelist: ${columnName}`);
  }
}

function getArtistLinkValue(artist: object, columnName: string): string | null {
  const propertyName = ARTIST_ROW_PROPERTY_BY_COLUMN[columnName] ?? columnName;
  return ((artist as Record<string, unknown>)[propertyName] as string | null | undefined) ?? null;
}

/**
 * Transaction-aware primitive for artist link/ID columns.
 *
 * Existing edit flows use overwrite + invalidate. Automated research uses
 * fill_empty + preserve so it cannot replace curated data or trigger content
 * work that is outside the research phase.
 */
export async function writeArtistLinkValue(params: {
  database: ArtistLinkExecutor;
  artistId: string;
  siteName: string;
  value: string;
  mode: ArtistLinkWriteMode;
  bioMode: ArtistLinkBioMode;
  replaceIfValue?: string;
}): Promise<ArtistLinkWriteResult> {
  const {
    database,
    artistId,
    siteName,
    value,
    mode,
    bioMode,
    replaceIfValue,
  } = params;
  const columnName = sanitizeColumnName(siteName);
  assertWritable(columnName);

  const artist = await database.query.artists.findFirst({
    where: eq(artists.id, artistId),
  });
  if (!artist) {
    throw new Error(`Artist not found: ${artistId}`);
  }
  if (!value) {
    throw new Error("Value must not be empty");
  }

  const oldValue = getArtistLinkValue(artist, columnName);
  const hasExistingValue = Boolean(oldValue?.trim());
  if (mode === "fill_empty" && hasExistingValue) {
    if (oldValue === value) {
      return {
        oldValue,
        artistName: artist.name ?? null,
        status: "unchanged",
      };
    }
    if (replaceIfValue === undefined || oldValue !== replaceIfValue) {
      return {
        oldValue,
        artistName: artist.name ?? null,
        status: "conflict",
      };
    }
  }

  const shouldInvalidateBio =
    bioMode === "invalidate" && BIO_RELEVANT_COLUMNS.includes(columnName);
  if (mode === "fill_empty") {
    const canReplaceExpectedValue = replaceIfValue !== undefined;
    const writtenRows = shouldInvalidateBio
      ? await database.execute<{ id: string }>(
          sql`UPDATE artists
              SET ${sql.identifier(columnName)} = ${value}, bio = NULL
              WHERE id = ${artistId}
                AND (
                  ${sql.identifier(columnName)} IS NULL
                  OR BTRIM(${sql.identifier(columnName)}) = ''
                  OR (${canReplaceExpectedValue} AND ${sql.identifier(columnName)} = ${replaceIfValue ?? ""})
                )
              RETURNING id`,
        )
      : await database.execute<{ id: string }>(
          sql`UPDATE artists
              SET ${sql.identifier(columnName)} = ${value}
              WHERE id = ${artistId}
                AND (
                  ${sql.identifier(columnName)} IS NULL
                  OR BTRIM(${sql.identifier(columnName)}) = ''
                  OR (${canReplaceExpectedValue} AND ${sql.identifier(columnName)} = ${replaceIfValue ?? ""})
                )
              RETURNING id`,
        );

    if (writtenRows.length === 0) {
      // A concurrent write populated the field after the read above. Re-read
      // rather than overwriting it.
      const latestArtist = await database.query.artists.findFirst({
        where: eq(artists.id, artistId),
      });
      if (!latestArtist) {
        throw new Error(`Artist not found: ${artistId}`);
      }
      const latestValue = getArtistLinkValue(latestArtist, columnName);
      return {
        oldValue: latestValue,
        artistName: latestArtist.name ?? null,
        status: latestValue === value ? "unchanged" : "conflict",
      };
    }
  } else if (shouldInvalidateBio) {
    await database.execute(
      sql`UPDATE artists SET ${sql.identifier(columnName)} = ${value}, bio = NULL WHERE id = ${artistId}`,
    );
  } else {
    await database.execute(
      sql`UPDATE artists SET ${sql.identifier(columnName)} = ${value} WHERE id = ${artistId}`,
    );
  }

  return {
    oldValue,
    artistName: artist.name ?? null,
    status: "written",
  };
}

export async function setArtistLink(
  artistId: string,
  siteName: string,
  value: string
): Promise<{ oldValue: string | null; artistName: string | null }> {
  const columnName = sanitizeColumnName(siteName);
  const result = await writeArtistLinkValue({
    database: db,
    artistId,
    siteName: columnName,
    value,
    mode: "overwrite",
    bioMode: "invalidate",
  });

  if (BIO_RELEVANT_COLUMNS.includes(columnName)) {
    regenerateArtistBio(artistId).catch((e) => console.error("[artistLinkService] Bio regen failed", e));
  }

  return { oldValue: result.oldValue, artistName: result.artistName };
}

export async function clearArtistLink(
  artistId: string,
  siteName: string
): Promise<{ oldValue: string | null }> {
  const columnName = sanitizeColumnName(siteName);
  assertWritable(columnName);

  // Fetch full row to capture oldValue for audit trail (MCP callers use the return value)
  const artist = await db.query.artists.findFirst({
    where: eq(artists.id, artistId),
  });
  if (!artist) {
    throw new Error(`Artist not found: ${artistId}`);
  }

  // Safe: assertWritable() above guarantees columnName is a known text column from the whitelist
  const oldValue = getArtistLinkValue(artist, columnName);

  if (BIO_RELEVANT_COLUMNS.includes(columnName)) {
    await db.execute(sql`UPDATE artists SET ${sql.identifier(columnName)} = NULL, bio = NULL WHERE id = ${artistId}`);
    regenerateArtistBio(artistId).catch((e) => console.error("[artistLinkService] Bio regen failed", e));
  } else {
    await db.execute(sql`UPDATE artists SET ${sql.identifier(columnName)} = NULL WHERE id = ${artistId}`);
  }

  return { oldValue };
}
