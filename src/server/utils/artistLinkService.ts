/**
 * Shared helpers for writing/clearing platform links on artist records.
 * Used by MCP tools and artistQueries.ts (approveUGC, removeArtistData).
 */
import { db } from "@/server/db/drizzle";
import { ARTIST_ROW_PROPERTY_BY_COLUMN } from "@/server/db/artistRowProperties";
import { and, eq, sql } from "drizzle-orm";
import { artists, artistIdMappings } from "@/server/db/schema";
import {
  acquireArtistPlatformLock,
  acquireArtistPlatformWriteLocks,
} from "./artistIdentityLocks";

export class ArtistLinkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtistLinkConflictError";
  }
}

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

// Drizzle row properties can differ from the physical column names used in
// SQL. The map lives in its own module because the suite mocks this service
// wholesale, and a constant with no behaviour has no reason to sit behind a
// mock — see src/server/db/artistRowProperties.ts.

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

type ArtistLinkExecutor = Pick<typeof db, "query" | "execute">;

async function setArtistLinkWithExecutor(
  database: ArtistLinkExecutor,
  artistId: string,
  columnName: string,
  value: string,
): Promise<{ oldValue: string | null; artistName: string | null }> {
  // Fetch full row to capture oldValue for audit trail (MCP callers use the return value)
  const artist = await database.query.artists.findFirst({
    where: eq(artists.id, artistId),
  });
  if (!artist) {
    throw new Error(`Artist not found: ${artistId}`);
  }

  const oldValue = getArtistLinkValue(artist, columnName);
  if (columnName === "spotify" || columnName === "deezer") {
    const directColumn = columnName === "spotify" ? artists.spotify : artists.deezer;
    const [directOwner, mappingOwner, artistMapping] = await Promise.all([
      database.query.artists.findFirst({
        where: eq(directColumn, value),
        columns: { id: true },
      }),
      database.query.artistIdMappings.findFirst({
        where: and(
          eq(artistIdMappings.platform, columnName),
          eq(artistIdMappings.platformId, value),
        ),
        columns: { artistId: true },
      }),
      database.query.artistIdMappings.findFirst({
        where: and(
          eq(artistIdMappings.artistId, artistId),
          eq(artistIdMappings.platform, columnName),
        ),
        columns: { platformId: true },
      }),
    ]);
    if (directOwner && directOwner.id !== artistId) {
      throw new ArtistLinkConflictError(
        `That ${columnName} artist ID is already linked to a different artist`,
      );
    }
    if (
      (mappingOwner && mappingOwner.artistId !== artistId) ||
      (artistMapping && artistMapping.platformId !== value)
    ) {
      throw new ArtistLinkConflictError(
        `That ${columnName} artist ID conflicts with an existing artist mapping`,
      );
    }
  }

  // Update the link column only. We intentionally do NOT null or regenerate the
  // bio on link changes — that overwrote artist edits and re-ran generation on
  // every UGC/agent submission. The About refreshes on explicit regenerate, or
  // lazily when it's absent (see the artistBio route).
  await database.execute(sql`UPDATE artists SET ${sql.identifier(columnName)} = ${value} WHERE id = ${artistId}`);

  return { oldValue, artistName: artist.name ?? null };
}

export async function setArtistLink(
  artistId: string,
  siteName: string,
  value: string
): Promise<{ oldValue: string | null; artistName: string | null }> {
  const columnName = sanitizeColumnName(siteName);
  assertWritable(columnName);

  if (!value) {
    throw new Error("Value must not be empty");
  }

  if (columnName === "spotify" || columnName === "deezer") {
    return db.transaction(async (transaction) => {
      await acquireArtistPlatformWriteLocks(
        transaction,
        artistId,
        columnName,
        value,
      );
      return setArtistLinkWithExecutor(transaction, artistId, columnName, value);
    });
  }

  return setArtistLinkWithExecutor(db, artistId, columnName, value);
}

export async function clearArtistLink(
  artistId: string,
  siteName: string
): Promise<{ oldValue: string | null }> {
  const columnName = sanitizeColumnName(siteName);
  assertWritable(columnName);

  if (columnName === "spotify" || columnName === "deezer") {
    return db.transaction(async (transaction) => {
      await acquireArtistPlatformLock(transaction, artistId, columnName);
      return clearArtistLinkWithExecutor(transaction, artistId, columnName);
    });
  }

  return clearArtistLinkWithExecutor(db, artistId, columnName);
}

async function clearArtistLinkWithExecutor(
  database: ArtistLinkExecutor,
  artistId: string,
  columnName: string,
): Promise<{ oldValue: string | null }> {
  // Fetch full row to capture oldValue for audit trail (MCP callers use the return value)
  const artist = await database.query.artists.findFirst({
    where: eq(artists.id, artistId),
  });
  if (!artist) {
    throw new Error(`Artist not found: ${artistId}`);
  }

  // Safe: assertWritable() above guarantees columnName is a known text column from the whitelist
  const oldValue = getArtistLinkValue(artist, columnName);

  // See setArtistLink: link changes no longer null/regenerate the bio.
  await database.execute(sql`UPDATE artists SET ${sql.identifier(columnName)} = NULL WHERE id = ${artistId}`);

  return { oldValue };
}
