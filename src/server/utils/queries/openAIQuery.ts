import { NextResponse } from "next/server";
import { openai } from "@/server/lib/openai";
import { getActivePrompt, getArtistById } from "@/server/utils/queries/artistQueries";
import { db } from "@/server/db/drizzle";
import { artists } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getArtistTopTrackName, getNumberOfSpotifyReleases, getSpotifyArtist, getSpotifyHeaders } from "@/server/utils/queries/externalApiQueries";

//Helper function that generates a bio using OpenAI with data drawn from Spotify
//Params:
    //artistID: The ID of the artist the bio should be generated for. 
            // Spotify data is pulled from the row associated with this ID.
export async function getOpenAIBio(artistId: string): Promise<NextResponse> {
  // Fetch artist row from database
  const artist = await getArtistById(artistId);
  if (!artist) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }
  const prompt = await getActivePrompt();
  if (!prompt) {
    return NextResponse.json({ error: "No prompt found"})
  }

  let spotifyBioData = ""; //empty string for spotify data

  //Compile Spotify Data
  if (artist.spotify) {
    try {
      //grab headers, get artist
      const headers = await getSpotifyHeaders();
      const {data} = await getSpotifyArtist(artist.spotify, headers);

      //if artist exists, get releases and top track
      if (data) {
        // Set timeout for individual Spotify API calls
        const spotifyTimeout = 8000; // 8 seconds per call
        
        const [releases, topTrack] = await Promise.allSettled([
          Promise.race([
            getNumberOfSpotifyReleases(artist.spotify, headers),
            new Promise<number>((_, reject) => 
              setTimeout(() => reject(new Error('Spotify releases timeout')), spotifyTimeout)
            )
          ]),
          Promise.race([
            getArtistTopTrackName(artist.spotify, headers),
            new Promise<string | null>((_, reject) => 
              setTimeout(() => reject(new Error('Spotify top track timeout')), spotifyTimeout)
            )
          ])
        ]);

        const releasesCount = releases.status === 'fulfilled' ? releases.value : 0;
        const topTrackName = topTrack.status === 'fulfilled' ? topTrack.value : null;

        //build spotify bio data
        spotifyBioData = [
          `Spotify name: ${data.name}`,
          `Followers: ${data.followers.total}`,
          data.genres.length > 0 ? `Genres: ${data.genres.join(", ")}` : "No genres found",
          releasesCount > 0 ? `Number of releases: ${releasesCount}` : "No releases found",
          topTrackName ? `Top track: ${topTrackName}` : "No top track found",
        ].filter(Boolean).join(",");
      }
    } catch (error) {
      console.error("Error fetching Spotify data for bio generation:", error);
      // Continue without Spotify data rather than failing entirely
    }
  }

    // Put all informational sections of prompt together
  const promptParts: string[] = [prompt.promptBeforeName, artist.name!, prompt.promptAfterName];
    if (artist.spotify) promptParts.push(`Spotify ID: ${artist.spotify}`);
    if (artist.instagram) promptParts.push(`Instagram: https://instagram.com/${artist.instagram}`);
    if (artist.x) promptParts.push(`Twitter: https://twitter.com/${artist.x}`);
    if (artist.soundcloud) promptParts.push(`SoundCloud: ${artist.soundcloud}`);
    if (artist.youtubechannel) promptParts.push(`YouTube Channel: ${artist.youtubechannel}`);
    if (spotifyBioData) promptParts.push(`Spotify Data: ${spotifyBioData}`);

    //build prompt from parts generated and parts from the aiprompts table
  try {
    // Set timeout for OpenAI API call
    const openaiTimeout = 15000; // 15 seconds
    
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", 
        content: 'You are an artifical intelligence whose sole purpose is to follow the provided prompt.' 
          +promptParts.join("\n") }],
        temperature:0.8,
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI timeout')), openaiTimeout)
      )
    ]);
    
    const bio = completion.choices[0]?.message?.content?.trim() ?? "";

    //If bio generation is successful, overwrite existing bio in the artist row/object
    if (bio) {
      await db.update(artists).set({ bio }).where(eq(artists.id, artistId));
    }

    //Error handling
    return NextResponse.json({ bio });
  } catch (err: any) {
    console.error("OpenAI error generating bio", err);
    if (err.message === 'OpenAI timeout') {
      return NextResponse.json({ error: "Bio generation timed out" }, { status: 408 });
    }
    return NextResponse.json({ error: "Failed to generate bio" }, { status: 500 });
  }
}
