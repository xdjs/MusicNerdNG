"use server"

import { SPOTIFY_WEB_CLIENT_ID, SPOTIFY_WEB_CLIENT_SECRET } from "@/env"
import axios from "axios";
import queryString from 'querystring';
import { unstable_cache } from 'next/cache';

// Type definitions
type SpotifyHeaderType = {
    headers: { Authorization: string }
}

export type SpotifyHeaders = {
    headers: { Authorization: string | null }
}

export type ArtistSpotifyImage = {
    artistImage: string,
    artistId: string
}

export type SpotifyImage = {
    url: string;
    height: number | null;
    width: number | null;
}

export type SpotifyExternalUrls = {
    spotify: string;
    [key: string]: string;
}

export type SpotifyFollowers = {
    href: string | null;
    total: number;
}

export type SpotifyArtist = {
    id: string;
    name: string;
    type: string;
    uri: string;
    href: string;
    external_urls: SpotifyExternalUrls;
    followers?: SpotifyFollowers;
    genres?: string[];
    images?: SpotifyImage[];
    popularity?: number;
}

export type SpotifyArtistApiResponse = {
    error: string | null,
    data: SpotifyArtist | null
}

export type SpotifySearchResponse = {
    artists: {
        href: string;
        items: SpotifyArtist[];
        limit: number;
        next: string | null;
        offset: number;
        previous: string | null;
        total: number;
    };
}

export type SpotifySearchResult = {
    artists: SpotifyArtist[];
    total: number;
    error: string | null;
}

// Functions
export const getSpotifyHeaders = unstable_cache(
    async (): Promise<SpotifyHeaderType> => {
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
    },
    [],
    { revalidate: 1800 } // 30 minutes
);

export const getSpotifyArtist = unstable_cache(
    async (artistId: string): Promise<SpotifyArtistApiResponse> => {
        try {
            const headers = await getSpotifyHeaders();
            const {data}: {data: SpotifyArtist} = await axios.get(
                `https://api.spotify.com/v1/artists/${artistId}`,
                headers
            );
            return {data, error: null};
        } catch (e:any) {
            if(e.response.data.error.message === "invalid id"){
                return {error: "Invalid Spotify Id", data: null}
            }  
            console.error("Error fetching Spotify data for artist", e)
            throw new Error(`Error fetching Spotify data for artist ${artistId}`);
        }
    },
    ['spotify-artist'],
    { revalidate: 43200 } // 12 hours
);

export const getSpotifyImage = unstable_cache(
    async (artistSpotifyId: string | null, artistId: string=""): Promise<ArtistSpotifyImage> => {
        if(!artistSpotifyId) return { artistImage: "", artistId };
        try {
            const spotifyHeaders = await getSpotifyHeaders();
            const artistData = await axios.get(
                `https://api.spotify.com/v1/artists/${artistSpotifyId}`,
                spotifyHeaders
            );
            return { artistImage: artistData.data.images[0]?.url || "", artistId };
        } catch (error) {
            console.error(`Error fetching image for artist ${artistSpotifyId}`);
            return { artistImage: "", artistId };
        }
    },
    ['spotify-image'],
    { revalidate: 43200 } // 12 hours
);

export const getNumberOfSpotifyReleases = unstable_cache(
    async (id: string | null) => {  
        if(!id) return 0;
        try {
            const headers = await getSpotifyHeaders();
            const albumData = await axios.get(
                `https://api.spotify.com/v1/artists/${id}/albums?include_groups=album%2Csingle&market=US&limit=1`,
                headers
            );
        
            return albumData.data.total;
        
        } catch(e) {
            console.error(`Error fetching Spotify data for artist`, e);
        }
    },
    ['spotify-releases'],
    { revalidate: 43200 } // 12 hours
);

export const searchSpotifyArtists = unstable_cache(
    async (query: string): Promise<SpotifySearchResult> => {
        try {
            const headers = await getSpotifyHeaders();
            const { data }: { data: SpotifySearchResponse } = await axios.get(
                `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=5`,
                headers
            );
            
            // Extract the full artist objects with all available data
            const artists = data.artists.items.map(artist => ({
                id: artist.id,
                name: artist.name,
                type: artist.type,
                uri: artist.uri,
                href: artist.href,
                external_urls: artist.external_urls,
                followers: artist.followers,
                genres: artist.genres,
                images: artist.images,
                popularity: artist.popularity
            }));
            return {
                artists,
                total: data.artists.total,
                error: null
            };
        } catch (e) {
            console.error("Error searching Spotify artists:", e);
            return {
                artists: [],
                total: 0,
                error: "Failed to search Spotify"
            };
        }
    },
    ['spotify-search'],
    { revalidate: 43200 } // 12 hours
);

export const getArtistWiki = unstable_cache(
    async (wikiId: string) => {
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
    },
    ['wiki-artist'],
    { revalidate: 43200 } // 12 hours
);


