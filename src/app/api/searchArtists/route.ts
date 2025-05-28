import { searchForArtistByName, getAllSpotifyIds } from "@/server/utils/queriesTS";
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

// Helper function to calculate match score for sorting
function getMatchScore(name: string, query: string) {
  const nameLower = name.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact match gets highest priority (0)
  if (nameLower === queryLower) return 0;
  
  // Starts with match gets second priority (1)
  if (nameLower.startsWith(queryLower)) return 1;
  
  // Contains match gets third priority (2)
  if (nameLower.includes(queryLower)) return 2;
  
  // No direct match, will be sorted by similarity (3)
  return 3;
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

    // Parallel execution of all needed operations
    const [dbResults, spotifyHeaders, allSpotifyIds] = await Promise.all([
      searchForArtistByName(query),
      getSpotifyHeaders(),
      getAllSpotifyIds()
    ]);

    // Create a Set for faster lookups
    const existingSpotifyIds = new Set(allSpotifyIds);

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
              isSpotifyOnly: false,
              matchScore: getMatchScore(artist.name || "", query)
            };
          } catch (error) {
            console.error(`Failed to fetch Spotify data for artist ${artist.spotify}:`, error);
            return {
              ...artist,
              isSpotifyOnly: false,
              matchScore: getMatchScore(artist.name || "", query)
            };
          }
        }
        return {
          ...artist,
          isSpotifyOnly: false,
          matchScore: getMatchScore(artist.name || "", query)
        };
      })
    );

    // Search Spotify's API for matching artists
    const spotifyResponse = await axios.get<SpotifySearchResponse>(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=10`,
      spotifyHeaders
    );

    // Transform Spotify results and filter out existing artists
    const spotifyArtists = spotifyResponse.data.artists.items
      .filter((spotifyArtist: SpotifyArtist) => !existingSpotifyIds.has(spotifyArtist.id))
      .map((artist: SpotifyArtist) => ({
        id: null,
        name: artist.name,
        spotify: artist.id,
        images: artist.images,
        isSpotifyOnly: true,
        matchScore: getMatchScore(artist.name, query)
      }));

    // Combine all results and sort them by match score and name
    const combinedResults = [...dbArtistsWithImages, ...spotifyArtists]
      .sort((a, b) => {
        // First sort by match score
        if (a.matchScore !== b.matchScore) {
          return a.matchScore - b.matchScore;
        }

        // For same match score, sort by name
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
