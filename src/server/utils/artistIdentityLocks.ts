import { sql } from "drizzle-orm";
import type { db } from "@/server/db/drizzle";

export type ArtistIdentityLockExecutor = Pick<typeof db, "execute">;

async function acquireArtistIdentityLock(
  database: ArtistIdentityLockExecutor,
  key: string,
): Promise<void> {
  await database.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

/**
 * Serializes ownership decisions for a single external platform identity.
 * The executor must belong to the transaction that performs the protected
 * ownership read/write; PostgreSQL releases the lock when that transaction ends.
 */
export async function acquirePlatformIdentityLock(
  database: ArtistIdentityLockExecutor,
  platform: string,
  platformId: string,
): Promise<void> {
  await acquireArtistIdentityLock(
    database,
    `musicnerd:artist-platform:${platform}:${platformId}`,
  );
}

/**
 * Serializes every ID write for one artist/platform slot, even when competing
 * writers propose different external IDs. This lock must be acquired before
 * the external platform-ID lock to keep lock ordering consistent.
 */
export async function acquireArtistPlatformLock(
  database: ArtistIdentityLockExecutor,
  artistId: string,
  platform: string,
): Promise<void> {
  await acquireArtistIdentityLock(
    database,
    `musicnerd:artist-platform-slot:${artistId}:${platform}`,
  );
}

/**
 * Acquires both locks needed to change an artist's platform identity. Keeping
 * the ordering here prevents direct-link and mapping writers from drifting.
 */
export async function acquireArtistPlatformWriteLocks(
  database: ArtistIdentityLockExecutor,
  artistId: string,
  platform: string,
  platformId: string,
): Promise<void> {
  await acquireArtistPlatformLock(database, artistId, platform);
  await acquirePlatformIdentityLock(database, platform, platformId);
}

/** Serializes the same-name candidate check and artist insert. */
export async function acquireArtistNameLock(
  database: ArtistIdentityLockExecutor,
  normalisedName: string,
): Promise<void> {
  await acquireArtistIdentityLock(
    database,
    `musicnerd:artist-name:${normalisedName}`,
  );
}
