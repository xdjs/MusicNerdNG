export const MAX_ARTIST_PROFILE_URL_LENGTH = 2048;

export type SupportedArtistPlatform = "spotify" | "deezer";

export type ParsedArtistProfileUrl = {
    id: string;
    platform: SupportedArtistPlatform;
};

const SPOTIFY_ARTIST_PATH = /^\/artist\/([a-zA-Z0-9]+)\/?$/;
const DEEZER_ARTIST_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artist\/(\d+)\/?$/i;
const SPOTIFY_ARTIST_ID = /^[a-zA-Z0-9]+$/;
const DEEZER_ARTIST_ID = /^\d+$/;

/**
 * Parses the exact Spotify and Deezer artist URL shapes supported by Music Nerd.
 * Query strings and fragments are accepted but are not part of the returned ID.
 */
export function parseSupportedArtistUrl(value: string): ParsedArtistProfileUrl | null {
    const candidate = value.trim();
    if (!candidate || candidate.length > MAX_ARTIST_PROFILE_URL_LENGTH) return null;

    try {
        const url = new URL(candidate);
        const hostname = url.hostname.toLowerCase();

        if (url.username || url.password || url.port) return null;

        if (url.protocol === "https:" && hostname === "open.spotify.com") {
            const match = url.pathname.match(SPOTIFY_ARTIST_PATH);
            return match ? { id: match[1], platform: "spotify" } : null;
        }

        if (
            (url.protocol === "https:" || url.protocol === "http:")
            && (hostname === "deezer.com" || hostname === "www.deezer.com")
        ) {
            const match = url.pathname.match(DEEZER_ARTIST_PATH);
            return match ? { id: match[1], platform: "deezer" } : null;
        }
    } catch {
        return null;
    }

    return null;
}

/** Builds the canonical public artist URL after validating the platform ID. */
export function buildCanonicalArtistUrl(
    platform: SupportedArtistPlatform,
    platformId: string,
): string | null {
    const isValidId = platform === "spotify"
        ? SPOTIFY_ARTIST_ID.test(platformId)
        : platform === "deezer" && DEEZER_ARTIST_ID.test(platformId);

    if (!isValidId) return null;

    const url = platform === "spotify"
        ? `https://open.spotify.com/artist/${platformId}`
        : `https://www.deezer.com/artist/${platformId}`;

    return url.length <= MAX_ARTIST_PROFILE_URL_LENGTH ? url : null;
}
