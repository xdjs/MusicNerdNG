import { SPOTIFY_WEB_CLIENT_ID, SPOTIFY_WEB_CLIENT_SECRET } from "@/env"
import axios from "axios";
import queryString from 'querystring';
import { cachedOrDirect } from '@/server/lib/cachedOrDirect';


type SpotifyHeaderType = {
    headers: { 
        Authorization: string;
        'x-token-expiry'?: string;
    }
}

export type ArtistSpotifyImage = {
    artistImage: string,
    artistId: string
}

export type SpotifyHeaders = {
    headers: { Authorization: string | null }
}

/** Helper function to check if a token is expired or about to expire. Declared
 *  above its first use (`getSpotifyHeaders` below) since `const` bindings are
 *  not hoisted. */
const isTokenExpired = (headers: SpotifyHeaderType): boolean => {
    const expiryTime = parseInt(headers.headers['x-token-expiry'] || '0');
    // Return true if token expires in less than 5 minutes
    return Date.now() + (5 * 60 * 1000) >= expiryTime;
};

/** The actual network round-trip to Spotify's client-credentials token
 *  endpoint — always fetches a brand-new token, bypassing any cache. Exported
 *  so callers that already hold a token and got a 401 anyway (a real request
 *  can fail even when our own expiry bookkeeping says "not yet expired" —
 *  clock skew, early revocation) can force a genuinely fresh one for a
 *  single self-heal retry, rather than re-reading a cache that may just hand
 *  back the same token. */
export async function refreshSpotifyToken(): Promise<SpotifyHeaderType> {
    try {
        if (!SPOTIFY_WEB_CLIENT_ID || !SPOTIFY_WEB_CLIENT_SECRET) {
            console.error("Missing Spotify credentials");
            throw new Error("Spotify credentials not configured");
        }

        const headers = {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            }
        };

        const payload = {
            grant_type: "client_credentials",
            client_id: SPOTIFY_WEB_CLIENT_ID,
            client_secret: SPOTIFY_WEB_CLIENT_SECRET,
        };

        const { data } = await axios.post(
            "https://accounts.spotify.com/api/token",
            queryString.stringify(payload),
            headers
        )

        if (!data.access_token) {
            console.error("No access token in Spotify response");
            throw new Error("Failed to get Spotify access token");
        }

        // Store the expiration time (default is 1 hour)
        const expiresAt = Date.now() + (data.expires_in * 1000);

        return {
            headers: {
                Authorization: `Bearer ${data.access_token}`,
                'x-token-expiry': expiresAt.toString()
            }
        };
    } catch (e) {
        console.error("Error fetching Spotify headers:", e);
        if (e instanceof Error) {
            throw e;
        }
        throw new Error("Error fetching Spotify headers");
    }
}

const cachedSpotifyToken = cachedOrDirect(refreshSpotifyToken, ["spotify-headers"], {
    tags: ["spotify-headers"],
    revalidate: 3300 // 55 minutes - refresh slightly before the token expires
});

/**
 * Returns Spotify client-credentials auth headers.
 *
 * BUG THIS FIXES: `unstable_cache`'s `revalidate` option is stale-while-
 * revalidate, not a hard TTL — once the window elapses, a read can still get
 * back the STALE (already-expired) token while a fresh one is fetched in the
 * background, so the caller's very next API call 401s. That was hitting the
 * whole app (SpotifyProvider.searchArtists, artist images, follower counts,
 * bio catalog data), not just onboarding.
 *
 * Fix: never trust the cache's own timing. Check the token's embedded
 * `x-token-expiry` on every read and, whenever it's expired or within 5
 * minutes of expiring, bypass the cache entirely for a synchronous fresh
 * fetch — so a caller is never handed a token that's already dead or about
 * to die mid-request.
 */
export async function getSpotifyHeaders(): Promise<SpotifyHeaderType> {
    // cachedOrDirect handles the no-request-context case for us: it falls back
    // to a direct call rather than throwing, and still rethrows anything that
    // is not that invariant. See src/server/lib/cachedOrDirect.ts.
    const cached = await cachedSpotifyToken();
    if (!isTokenExpired(cached)) return cached;
    return refreshSpotifyToken();
}

export type SpotifyArtistApiResponse = {
    error: string | null,
    data: SpotifyArtist | null
}

export type SpotifyArtist = {
    name: string;
    id: string;
    images: Array<{
        url: string;
        height: number;
        width: number;
    }>;
    followers: {
        total: number;
    };
    genres: string[];
    type: string;
    uri: string;
    external_urls: {
        spotify: string;
    };
}

export const getSpotifyArtist = cachedOrDirect(async (artistId: string, headers: SpotifyHeaderType): Promise<SpotifyArtistApiResponse> => {
    try {
        console.debug("Fetching Spotify artist with ID:", artistId);
        
        if (!headers?.headers?.Authorization) {
            console.error("Missing Spotify authorization header");
            return { error: "Spotify authentication failed", data: null };
        }

        // Check if token is expired or about to expire
        if (isTokenExpired(headers)) {
            console.debug("Token expired or about to expire, fetching new token");
            headers = await getSpotifyHeaders();
        }

        const { data } = await axios.get<SpotifyArtist>(
            `https://api.spotify.com/v1/artists/${artistId}`,
            headers
        );
        
        // Validate the response has all required fields
        if (!data) {
            console.error("No data returned from Spotify API");
            return { error: "No data returned from Spotify", data: null };
        }

        if (!data.name || !data.id) {
            console.error("Invalid Spotify artist data - missing required fields:", data);
            return { error: "Invalid artist data format from Spotify", data: null };
        }
        
        // Ensure arrays are initialized even if empty
        const safeData = {
            ...data,
            images: Array.isArray(data.images) ? data.images : [],
            genres: Array.isArray(data.genres) ? data.genres : [],
            followers: data.followers || { total: 0 }
        };
        
        return { data: safeData, error: null };
    } catch (e: any) {
        console.error("Error fetching Spotify data for artist", {
            artistId,
            error: e?.response?.data || e,
            status: e?.response?.status
        });
        
        if (!e.response) {
            return { error: "Network error while fetching artist data", data: null };
        }
        
        if (e.response?.status === 404 || e.response?.data?.error?.message === "invalid id") {
            return { error: "Invalid Spotify ID", data: null };
        }
        if (e.response?.status === 401) {
            return { error: "Spotify authentication failed", data: null };
        }
        if (e.response?.status === 429) {
            return { error: "Rate limit exceeded, please try again later", data: null };
        }
        
        return { error: "Failed to fetch artist data from Spotify", data: null };
    }
}, ["spotify-artist"], { tags: ["spotify-artist"], revalidate: 60 * 60 * 24 });

export const getSpotifyArtists = async (artistIds: string[], headers: SpotifyHeaderType) => {
    // Spotify allows max 50 IDs per request
    const chunks: string[][] = [];
    for (let i = 0; i < artistIds.length; i += 50) {
        chunks.push(artistIds.slice(i, i + 50));
    }
    
    const results = await Promise.all(
      chunks.map((chunk: string[]) => 
        axios.get(`https://api.spotify.com/v1/artists?ids=${chunk.join(',')}`, headers)
      )
    );
    // Combine and return results
    const allArtists = results.flatMap(response => response.data.artists);
    return allArtists;
  };

export const getSpotifyImage = cachedOrDirect(async (artistSpotifyId: string | null, artistId: string="", spotifyHeaders: SpotifyHeaderType): Promise<ArtistSpotifyImage> => {
    if(!artistSpotifyId) return { artistImage: "", artistId };
    try {
        const artistData = await axios.get(
            `https://api.spotify.com/v1/artists/${artistSpotifyId}`,
            spotifyHeaders
        );
        return { artistImage: artistData.data.images[0].url, artistId };
    } catch (error) {
        console.error(`Error fetching image for artist ${artistSpotifyId}`);
        return { artistImage: "", artistId };
    }
}, ["spotify-image"], { tags: ["spotify-image"], revalidate: 60 * 60 * 24 });

export const getArtistWiki = cachedOrDirect(async (wikiId: string) => {
    // Decode any percent-encoded characters (e.g. Yun%C3%A8_Pinku → Yunè_Pinku)
    let decodedId = wikiId;
    try {
        decodedId = decodeURIComponent(wikiId);
    } catch {
        // ignore malformed sequences – use original string
    }
    try {
        const wikiUrl = 'https://en.wikipedia.org/w/api.php'
        const params = {
            origin: '*',
            format: 'json',
            action: 'query',
            prop: 'extracts',
            exsentences: 2,
            exintro: true,
            explaintext: true,
            generator: 'search',
            gsrlimit: 1,
            gsrsearch: decodedId
        }

        const { data } = await axios.get(wikiUrl, { params });
        const pages: any = data.query?.pages ? Object.values(data.query.pages) : [];
        return {
            blurb: pages[0]?.extract,
            link: `https://en.wikipedia.org/?curid=${pages[0]?.pageid}`
        }
    } catch (e) {
        console.error(`Error fetching wiki for artist`, e);
    }
}, ["wiki"], { tags: ["wiki"], revalidate: 60 * 60 * 24 });

export const getNumberOfSpotifyReleases = cachedOrDirect(async (id: string | null, headers: SpotifyHeaderType) => {  
    if(!id) return 0;
    try {
      const albumData = await axios.get(
        `https://api.spotify.com/v1/artists/${id}/albums?include_groups=album%2Csingle`,
        headers
      );
  
      return albumData.data.total;
  
    } catch(e) {
        console.error(`Error fetching Spotify data for artist`, e);
        return 0;
    }
}, ["spotify-releases"], { tags: ["spotify-releases"], revalidate: 60 * 60 * 24 });

export const getArtistTopTrack = cachedOrDirect(async (id: string | null, headers: SpotifyHeaderType): Promise<string | null> => {  
    if(!id) return null;
    try {
        const response = await axios.get(
            `https://api.spotify.com/v1/artists/${id}/top-tracks`,
            headers
        );
        
        if (response.data.tracks && response.data.tracks.length > 0) {
            return response.data.tracks[0].id;
        }
        return null;
    } catch(e) {
        console.error(`Error fetching top track for artist`, e);
        return null;
    }
}, ["spotify-top-track"], { tags: ["spotify-top-track"], revalidate: 60 * 60 * 24 });

export const getArtistTopTrackName = cachedOrDirect(async (id: string | null, headers: SpotifyHeaderType): Promise<string | null> => {  
    if(!id) return null;
    try {
        const response = await axios.get(
            `https://api.spotify.com/v1/artists/${id}/top-tracks`,
            headers
        );
        
        if (response.data.tracks && response.data.tracks.length > 0) {
            return response.data.tracks[0].name;
        }
        return null;
    } catch(e) {
        console.error(`Error fetching top track for artist`, e);
        return null;
    }
}, ["spotify-top-track"], { tags: ["spotify-top-track"], revalidate: 60 * 60 * 24 });

/**
 * Real catalog NAMES (not just a count) for use as ground-truth in bio generation.
 * Returns the artist's actual release titles + top-track names so the generator
 * writes from the real discography instead of guessing from an open-web namesake.
 * Best-effort: returns empty arrays on any failure.
 */
export type SpotifyRelease = {
    name: string;
    /** Spotify's `release_date`: "2025-03-01", "2025-03" or "2025". */
    releaseDate: string | null;
    /** "album" | "single" | "compilation" | "appears_on" */
    kind: string | null;
};

/**
 * The artist's catalog WITH release dates, for grounding the knowledge document.
 *
 * `getSpotifyCatalogNames` returns titles only, which is all the relevance judge
 * needs. The document needs dates: it was naming releases scraped out of
 * Instagram captions and dating them by the publication year of whatever article
 * mentioned them — so a 2019 interview made a placement "as of 2019", and the
 * one release that did carry a date got it from a webpage rather than from the
 * catalog.
 *
 * Deliberately NOT a discography for the page. The artist's Spotify and Deezer
 * links already carry the full catalog and stay current, where a generated copy
 * goes stale the day they release something. This exists so the document can
 * name real titles with real dates when it has something to say about them.
 */
export async function getSpotifyCatalogDetail(
    id: string | null,
    headers: SpotifyHeaderType
): Promise<SpotifyRelease[]> {
    // Deliberately NOT wrapped in `unstable_cache`: the knowledge document is
    // rebuilt from detached background work where there is no Next request
    // context, and unstable_cache throws outright there. Document rebuilds are
    // rare and debounced, so one uncached Spotify call is the cheaper trade.
    if (!id) return [];
    try {
        const res = await axios.get(
            `https://api.spotify.com/v1/artists/${id}/albums?include_groups=album%2Csingle%2Cappears_on&limit=50&market=US`,
            headers,
        );
        const seen = new Set<string>();
        const out: SpotifyRelease[] = [];
        for (const a of ((res.data.items ?? []) as Array<{ name?: string; release_date?: string; album_group?: string }>)) {
            if (!a.name) continue;
            const key = a.name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ name: a.name, releaseDate: a.release_date ?? null, kind: a.album_group ?? null });
        }
        // Newest first: what an artist is asked about is usually recent.
        out.sort((x, y) => (y.releaseDate ?? "").localeCompare(x.releaseDate ?? ""));
        return out;
    } catch (e) {
        console.error("Error fetching Spotify catalog detail for artist", e);
        return [];
    }
}

export const getSpotifyCatalogNames = cachedOrDirect(async (
    id: string | null,
    headers: SpotifyHeaderType
): Promise<{ releases: string[]; topTracks: string[] }> => {
    if (!id) return { releases: [], topTracks: [] };
    try {
        const [albumsRes, tracksRes] = await Promise.allSettled([
            axios.get(`https://api.spotify.com/v1/artists/${id}/albums?include_groups=album%2Csingle&limit=20&market=US`, headers),
            axios.get(`https://api.spotify.com/v1/artists/${id}/top-tracks?market=US`, headers),
        ]);
        const releases = albumsRes.status === "fulfilled"
            ? Array.from(new Set(((albumsRes.value.data.items ?? []) as Array<{ name?: string }>).map(a => a.name).filter((n): n is string => !!n))).slice(0, 15)
            : [];
        const topTracks = tracksRes.status === "fulfilled"
            ? ((tracksRes.value.data.tracks ?? []) as Array<{ name?: string }>).map(t => t.name).filter((n): n is string => !!n).slice(0, 8)
            : [];
        return { releases, topTracks };
    } catch (e) {
        console.error(`Error fetching Spotify catalog names for artist`, e);
        return { releases: [], topTracks: [] };
    }
}, ["spotify-catalog-names"], { tags: ["spotify-catalog-names"], revalidate: 60 * 60 * 24 });


