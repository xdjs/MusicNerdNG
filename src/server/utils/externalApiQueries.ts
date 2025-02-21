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
}, ["spotify-headers"], { tags: ["spotify-headers"], revalidate: 60 * 60 * 1 });

export type SpotifyArtistApiResponse = {
    error: string | null,
    data: SpotifyArtist | null
}

export type SpotifyArtist = {
    name: string,
    id:string,
}

export const getSpotifyArtist = unstable_cache(async (artistId: string, headers: SpotifyHeaderType) : Promise<SpotifyArtistApiResponse> => {
    try {
        const {data}: {data: SpotifyArtist} = await axios.get(
            `https://api.spotify.com/v1/artists/${artistId}`,
            headers
        );
        return {data, error: null};
    } catch (e:any) {
        if(e.response.data.error.message === "invalid id"){
            return {error: "Invlid Spotify Id", data: null}
        }  
        console.error("Error fetching Spotify data for artist", e)
        throw new Error(`Error fetching Spotify data for artist ${artistId}`);
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
    }
}, ["spotify-releases"], { tags: ["spotify-releases"], revalidate: 60 * 60 * 24 });


