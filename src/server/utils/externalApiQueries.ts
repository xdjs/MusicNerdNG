import { SPOTIFY_WEB_CLIENT_ID, SPOTIFY_WEB_CLIENT_SECRET } from "@/env"
import axios from "axios";
import queryString from 'querystring';

type SpotifyHeaderType = {
    headers: { Authorization: string }
}

export type ArtistSpotifyImage = {
    artistImage: string,
    artistId: string
}

export async function getSpotifyHeaders(): Promise<SpotifyHeaderType> {
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
        throw new Error("Error fetching Spotify headers");
    }
}

export async function getSpotifyImage(artistSpotifyId: string, artistId: string="", spotifyHeaders: SpotifyHeaderType): Promise<ArtistSpotifyImage> {
    try {
        const artistData = await axios.get(
            `https://api.spotify.com/v1/artists/${artistSpotifyId}`,
            spotifyHeaders
        );
        return { artistImage: artistData.data.images[0].url, artistId };
    } catch (error) {
        throw new Error(`Error fetching image for artist ${artistSpotifyId}`);
    }
}

export async function getArtistWiki(wikiId: string) {
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
        const pages: any = Object.values(data.query.pages);

        return {
            blurb: pages[0].extract,
            link: `https://en.wikipedia.org/?curid=${pages[0].pageid}`
        }
    } catch (e) {

    }
}

export async function getNumberOfSpotifyReleases(id: string, headers: SpotifyHeaderType) {  
    try {
      const albumData = await axios.get(
        `https://api.spotify.com/v1/artists/${id}/albums?include_groups=album%2Csingle&market=US&limit=1`,
        headers
      );
  
      return albumData.data.total;
  
    } catch(e) {
        throw new Error(`Error fetching Spotify data for artist ${id}`);
    }
  }


