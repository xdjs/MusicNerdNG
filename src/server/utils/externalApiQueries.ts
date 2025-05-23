import { SPOTIFY_WEB_CLIENT_ID, SPOTIFY_WEB_CLIENT_SECRET } from "@/env"
import axios from "axios";
import queryString from 'querystring';
import { unstable_cache } from 'next/cache';


type SpotifyHeaderType = {
    headers: { Authorization: string }
}

export type ArtistSpotifyImage = {
    artistImage: string,
    artistId: string
}

export type SpotifyHeaders = {
    headers: { Authorization: string | null }
}

export const getSpotifyHeaders = unstable_cache(async () => {
    try {
        const headers = {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            }
        };
        let payload = {
            grant_type: "client_credentials",
            redirectUri: "https://localhost:8000/callback",
            client_id: SPOTIFY_WEB_CLIENT_ID,
            client_secret: SPOTIFY_WEB_CLIENT_SECRET,
        };

        const { data } = await axios.post(
            "https://accounts.spotify.com/api/token",
            queryString.stringify(payload),
            headers
        )

        return {
            headers: { Authorization: `Bearer ${data.access_token}` }
        };
    } catch (e) {
        console.error("Error fetching Spotify headers", e)
        throw new Error("Error fetching Spotify headers");
    }
}, ["spotify-headers"], { tags: ["spotify-headers"], revalidate: 60 * 60 });

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

export const getSpotifyArtist = unstable_cache(async (artistId: string, headers: SpotifyHeaderType): Promise<SpotifyArtistApiResponse> => {
    try {
        console.log("Fetching Spotify artist with ID:", artistId); // Debug log
        
        if (!headers?.headers?.Authorization) {
            console.error("Missing Spotify authorization header");
            return { error: "Spotify authentication failed", data: null };
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

export const getSpotifyImage = unstable_cache(async (artistSpotifyId: string | null, artistId: string="", spotifyHeaders: SpotifyHeaderType): Promise<ArtistSpotifyImage> => {
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

export const getArtistWiki = unstable_cache(async (wikiId: string) => {
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
            gsrsearch: wikiId
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

export const getNumberOfSpotifyReleases = unstable_cache(async (id: string | null, headers: SpotifyHeaderType) => {  
    if(!id) return 0;
    try {
      const albumData = await axios.get(
        `https://api.spotify.com/v1/artists/${id}/albums?include_groups=album%2Csingle&market=US&limit=1`,
        headers
      );
  
      return albumData.data.total;
  
    } catch(e) {
        console.error(`Error fetching Spotify data for artist`, e);
        return 0;
    }
}, ["spotify-releases"], { tags: ["spotify-releases"], revalidate: 60 * 60 * 24 });


