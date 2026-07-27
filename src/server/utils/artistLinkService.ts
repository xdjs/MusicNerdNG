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

export async function setArtistLink(
  artistId: string,
  siteName: string,
  value: string
): Promise<{ oldValue: string | null; artistName: string | null }> {
  const columnName = sanitizeColumnName(siteName);
  assertWritable(columnName);

  // Fetch full row to capture oldValue for audit trail (MCP callers use the return value)
  const artist = await db.query.artists.findFirst({
    where: eq(artists.id, artistId),
  });
  if (!artist) {
    throw new Error(`Artist not found: ${artistId}`);
  }

  if (!value) {
    throw new Error("Value must not be empty");
  }

  // Safe: assertWritable() above guarantees columnName is a known text column from the whitelist
  const oldValue = getArtistLinkValue(artist, columnName);

  // For bio-relevant columns, set value and null bio in a single statement
  if (BIO_RELEVANT_COLUMNS.includes(columnName)) {
    await db.execute(sql`UPDATE artists SET ${sql.identifier(columnName)} = ${value}, bio = NULL WHERE id = ${artistId}`);
    regenerateArtistBio(artistId).catch((e) => console.error("[artistLinkService] Bio regen failed", e));
  } else {
    await db.execute(sql`UPDATE artists SET ${sql.identifier(columnName)} = ${value} WHERE id = ${artistId}`);
  }

  return { oldValue, artistName: artist.name ?? null };
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
