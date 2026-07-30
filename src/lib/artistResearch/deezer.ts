import { artistNamesMatch } from "./normalization";

export type DeezerArtistIdentity = {
  id: string;
  name: string;
};

export async function fetchDeezerArtistIdentity(
  deezerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeezerArtistIdentity | null> {
  const response = await fetchImpl(
    `https://api.deezer.com/artist/${encodeURIComponent(deezerId)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) return null;

  const data = (await response.json()) as {
    id?: number | string;
    name?: string;
    error?: unknown;
  };
  if (data.error || !data.name) return null;

  return {
    id: String(data.id ?? deezerId),
    name: data.name,
  };
}

export function deezerArtistMatchesName(
  artist: DeezerArtistIdentity,
  expectedName: string,
): boolean {
  return artistNamesMatch(artist.name, expectedName);
}

/**
 * Boolean compatibility wrapper for the existing catalog resolver.
 * HTTP errors and identity mismatches intentionally remain indistinguishable.
 */
export async function verifyDeezerArtistId(
  deezerId: string,
  expectedName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const artist = await fetchDeezerArtistIdentity(deezerId, fetchImpl);
    return artist ? deezerArtistMatchesName(artist, expectedName) : false;
  } catch {
    return false;
  }
}
