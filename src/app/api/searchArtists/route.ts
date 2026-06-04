import { searchForArtistByName } from "@/server/utils/queries/artistQueries";
import { musicPlatformData } from "@/server/utils/musicPlatform";
import type { Artist } from "@/server/db/DbTypes";

// Simple in-memory cache for search results (5 minute TTL)
const searchCache = new Map<string, { results: any[], timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ----------------------------------
// Helper to calculate how much content an artist has
// ----------------------------------
const LINK_FIELDS = [
  "bandcamp",
  "youtube",
  "youtubechannel",
  "instagram",
  "x",
  "facebook",
  "tiktok",
  "soundcloud",
  "patreon",
  "twitter", // alias for x (legacy)
  "linktree",
  "spotifyusername",
  "bandsintown",
  "audius",
  "zora",
  "catalog",
  "opensea",
  "foundation",
  "mirror",
  "soundxyz",
  "twitch",
  "wikidata",
  "wikipedia"
] as const;

type LinkField = (typeof LINK_FIELDS)[number];

function getLinkCount(artist: Record<string, any>): number {
  return LINK_FIELDS.reduce((count, field) => {
    const val = artist[field as LinkField];
    return count + (val !== null && val !== undefined && val !== "" ? 1 : 0);
  }, 0);
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

// POST endpoint handler for combined artist search across local database and external platform
export async function POST(req: Request) {
  const start = performance.now();
  try {
    const { query, bookmarkedArtistIds = [] } = await req.json();

    if (!query || typeof query !== 'string') {
      return Response.json(
        { error: "Invalid query parameter" },
        { status: 400 }
      );
    }

    // Validate bookmarkedArtistIds if provided
    const bookmarkedIds = Array.isArray(bookmarkedArtistIds) ? bookmarkedArtistIds : [];

    // Create cache key including bookmarked IDs for personalized results
    const cacheKey = `${query}|${bookmarkedIds.sort().join(',')}`;
    const cachedResult = searchCache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
      return Response.json({ results: cachedResult.results });
    }

    // Set a timeout for the entire operation to prevent Vercel timeouts
    const timeoutPromise = new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('Search timeout')), 12000) // 12 second timeout
    );

    const searchOperation = async (): Promise<Response> => {
      // Parallel execution of database search and external platform search
      const [dbResults, externalResults] = await Promise.all([
        searchForArtistByName(query),
        musicPlatformData.searchArtists(query, 10).catch((err) => {
          console.error('External platform search failed:', err);
          return [];
        }),
      ]);

      // Dedup: filter out external results that already exist in DB
      // Check both deezer ID and normalized name to prevent visible duplicates
      // (only ~1% of artists have deezer populated, so name-matching is essential)
      const existingDeezerIds = new Set(
        (dbResults ?? []).map(artist => (artist as any).deezer).filter(Boolean)
      );
      const existingNames = new Set(
        (dbResults ?? []).map(artist => (artist.name || '').toLowerCase()).filter(Boolean)
      );

      const newExternalResults = externalResults
        .filter(ext => !existingDeezerIds.has(ext.platformId) && !existingNames.has(ext.name.toLowerCase()))
        .map(ext => ({
          id: null,
          name: ext.name,
          platformId: ext.platformId,
          platform: ext.platform,
          imageUrl: ext.imageUrl,
          profileUrl: ext.profileUrl,
          isExternalOnly: true,
          matchScore: getMatchScore(ext.name, query),
          linkCount: 0,
        }));

      // Fetch platform images for database artists
      const dbArtistsTyped = (dbResults ?? []) as Artist[];
      let imageMap = new Map<string, string>();
      try {
        imageMap = await musicPlatformData.getArtistImages(dbArtistsTyped);
      } catch (error) {
        console.error('Failed to fetch platform images:', error);
      }

      const dbArtistsWithImages = (dbResults ?? []).map((artist) => ({
        ...artist,
        isExternalOnly: false,
        imageUrl: imageMap.get(artist.id) ?? null,
        matchScore: getMatchScore(artist.name || "", query),
        linkCount: getLinkCount(artist),
      }));

      // Combine all results and sort them by match score, bookmark status, link count, and name
      const combinedResults = [...dbArtistsWithImages, ...newExternalResults]
        .sort((a, b) => {
          // First sort by match score (most important for relevance)
          if (a.matchScore !== b.matchScore) {
            return a.matchScore - b.matchScore;
          }

          // Within the same match score tier, prioritize bookmarked artists
          const aIsBookmarked = bookmarkedIds.includes(a.id || '');
          const bIsBookmarked = bookmarkedIds.includes(b.id || '');
          if (aIsBookmarked !== bIsBookmarked) {
            return bIsBookmarked ? 1 : -1; // Bookmarked artists come first
          }

          // Next, prefer artists with more content (higher linkCount)
          if ((a.linkCount ?? 0) !== (b.linkCount ?? 0)) {
            return (b.linkCount ?? 0) - (a.linkCount ?? 0);
          }

          // Fallback: alphabetical by name
          return (a.name || "").localeCompare(b.name || "");
        });

      // Cache the results
      searchCache.set(cacheKey, { results: combinedResults, timestamp: Date.now() });

      return Response.json({ results: combinedResults });
    };

    // Race between the search operation and timeout
    return await Promise.race([searchOperation(), timeoutPromise]);

  } catch (error) {
    console.error('Error in search artists:', error);

    if (error instanceof Error && error.message === 'Search timeout') {
      return Response.json(
        { error: "Search timed out. Please try a more specific search term." },
        { status: 408 }
      );
    }

    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    const end = performance.now();
    console.debug(`[searchArtists] POST took ${end - start}ms`);
  }
}
