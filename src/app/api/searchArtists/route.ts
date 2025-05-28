import { searchForArtistByName } from "@/server/utils/queriesTS";
import { getSpotifyHeaders, getSpotifyArtist } from "@/server/utils/externalApiQueries";
import axios from "axios";

// Defines the structure of a Spotify artist's image metadata
interface SpotifyArtistImage {
  url: string;
  height: number;
  width: number;
}

// Defines the complete structure of a Spotify artist object from their API
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

// Defines the structure of the Spotify search API response
interface SpotifySearchResponse {
  artists: {
    items: SpotifyArtist[];
  };
}

// POST endpoint handler for combined artist search across local database and Spotify
// Params:
//      req: Request object containing search query in the body
// Returns:
//      Response with combined and sorted search results or error message
export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    
    if (!query || typeof query !== 'string') {
      return Response.json(
        { error: "Invalid query parameter" },
        { status: 400 }
      );
    }

    // Parallel execution of both searches for better performance
    const [dbResults, spotifyHeaders] = await Promise.all([
      searchForArtistByName(query),
      getSpotifyHeaders()
    ]);

    // Fetch Spotify data for database artists that have Spotify IDs
    const dbArtistsWithImages = await Promise.all(
      dbResults.map(async (artist) => {
        if (artist.spotify) {
          try {
            const spotifyData = await axios.get<SpotifyArtist>(
              `https://api.spotify.com/v1/artists/${artist.spotify}`,
              spotifyHeaders
            );
            return {
              ...artist,
              images: spotifyData.data.images,
              isSpotifyOnly: false
            };
          } catch (error) {
            console.error(`Failed to fetch Spotify data for artist ${artist.spotify}:`, error);
            return {
              ...artist,
              isSpotifyOnly: false
            };
          }
        }
        return {
          ...artist,
          isSpotifyOnly: false
        };
      })
    );

    // Search Spotify's API for matching artists
    const spotifyResponse = await axios.get<SpotifySearchResponse>(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=5`,
      spotifyHeaders
    );

    // Transform Spotify results to match the application's format
    // Filters out artists that already exist in the database
    const spotifyArtists = spotifyResponse.data.artists.items
      .filter((spotifyArtist: SpotifyArtist) => 
        !dbResults.some(dbArtist => dbArtist.spotify === spotifyArtist.id)
      )
      .map((artist: SpotifyArtist) => ({
        id: null,
        name: artist.name,
        spotify: artist.id,
        images: artist.images,
        isSpotifyOnly: true // Flag to identify Spotify-only results
      }));

    // Combine and sort results with database entries appearing first
    const combinedResults = [
      ...dbArtistsWithImages,
      ...spotifyArtists
    ].sort((a, b) => {
      // First, prioritize database results over Spotify results
      if (!a.isSpotifyOnly && b.isSpotifyOnly) return -1;
      if (a.isSpotifyOnly && !b.isSpotifyOnly) return 1;

      // For items from the same source, prioritize exact matches
      const aNameLower = (a.name || '').toLowerCase();
      const bNameLower = (b.name || '').toLowerCase();
      const queryLower = query.toLowerCase();

      // Exact string match gets highest priority
      if (aNameLower === queryLower && bNameLower !== queryLower) return -1;
      if (bNameLower === queryLower && aNameLower !== queryLower) return 1;

      // Starts with match gets second priority
      if (aNameLower.startsWith(queryLower) && !bNameLower.startsWith(queryLower)) return -1;
      if (bNameLower.startsWith(queryLower) && !aNameLower.startsWith(queryLower)) return 1;

      // Contains match gets third priority
      if (aNameLower.includes(queryLower) && !bNameLower.includes(queryLower)) return -1;
      if (bNameLower.includes(queryLower) && !aNameLower.includes(queryLower)) return 1;

      // If both have same match type, sort alphabetically
      return aNameLower.localeCompare(bNameLower);
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
