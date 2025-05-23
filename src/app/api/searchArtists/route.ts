import { searchForArtistByName } from "@/server/utils/queriesTS";
import { getSpotifyHeaders } from "@/server/utils/externalApiQueries";
import axios from "axios";

interface SpotifyArtistImage {
  url: string;
  height: number;
  width: number;
}

interface SpotifyArtist {
  id: string;
  name: string;
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

interface SpotifySearchResponse {
  artists: {
    items: SpotifyArtist[];
  };
}

export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    
    if (!query || typeof query !== 'string') {
      return Response.json(
        { error: "Invalid query parameter" },
        { status: 400 }
      );
    }

    // Parallel execution of both searches
    const [dbResults, spotifyHeaders] = await Promise.all([
      searchForArtistByName(query),
      getSpotifyHeaders()
    ]);

    // Search Spotify
    const spotifyResponse = await axios.get<SpotifySearchResponse>(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=5`,
      spotifyHeaders
    );

    // Transform Spotify results to match your app's format
    const spotifyArtists = spotifyResponse.data.artists.items
      .filter((spotifyArtist: SpotifyArtist) => 
        // Filter out artists that are already in the database
        !dbResults.some(dbArtist => dbArtist.spotify === spotifyArtist.id)
      )
      .map((artist: SpotifyArtist) => ({
        id: null,
        name: artist.name,
        spotify: artist.id,
        images: artist.images,
        isSpotifyOnly: true // Flag to identify Spotify-only results
      }));

    // Combine results and sort them
    const combinedResults = [
      ...dbResults.map(artist => ({
        ...artist,
        isSpotifyOnly: false
      })),
      ...spotifyArtists
    ].sort((a, b) => {
      // Sort by source (database first) and then by name
      if (!a.isSpotifyOnly && b.isSpotifyOnly) return -1;
      if (a.isSpotifyOnly && !b.isSpotifyOnly) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    return Response.json({ results: combinedResults });
    
  } catch (error) {
    console.error('Error in search artists:', error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
