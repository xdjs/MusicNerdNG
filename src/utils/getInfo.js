import queryString from 'querystring';
import axios from 'axios'
import { SPOTIFY_WEB_CLIENT_ID, SPOTIFY_WEB_CLIENT_SECRET } from "@/env"

const getWiki = async (id) => {
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
      gsrsearch: id
    }

    const { data } = await axios.get(wikiUrl, { params });
    const pages = Object.values(data.query.pages);

    return {
      blurb: pages[0].extract,
      link: `https://en.wikipedia.org/?curid=${pages[0].pageid}`
    }
  } catch (e) {

  }

}

export const getSpotifyHeaders = async () => {
  
  try {
    const headers = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      }
    };

    let payload = {
      grant_type: "client_credentials",
      redirectUri: "http://localhost:8000/callback",
      client_id: SPOTIFY_WEB_CLIENT_ID,
      client_secret: SPOTIFY_WEB_CLIENT_SECRET,
    };
    debugger;    

    const { data } = await axios.post(
      "https://accounts.spotify.com/api/token",
      queryString.stringify(payload),
      headers
    )
    debugger;
    return {
      headers: { Authorization: `Bearer ${data.access_token}` }
    };
  } catch (e) {
    console.log(e)
  }

}

const getSpotify = async (id) => {
  debugger;
  
  try {
    const headers = await getSpotifyHeaders();
    const albumData = await axios.get(
      `https://api.spotify.com/v1/artists/${id}/albums?include_groups=album%2Csingle&market=US&limit=1`,
      headers
    );

    const artistData = await axios.get(
      `https://api.spotify.com/v1/artists/${id}`,
      headers
    );

    return {
      img: artistData.data.images[0].url,
      releases: albumData.data.total
    }

  } catch {

  }
}

export default async function getInfo(spotifyId, wikiId) {
  const wiki = wikiId === undefined ? null : await getWiki(wikiId);
  const spotifyData = spotifyId === undefined ? null : await getSpotify(spotifyId);
  return {
    spotify: spotifyData,
    wiki: wiki
  }
}