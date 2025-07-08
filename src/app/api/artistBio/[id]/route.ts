import { NextResponse } from "next/server";
import { openai } from "@/server/lib/openai";
import { getActivePrompt, getArtistById, getYTStats } from "@/server/utils/queriesTS";
import { db } from "@/server/db/drizzle";
import { artists } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getArtistTopTrackName, getNumberOfSpotifyReleases, getSpotifyArtist, getSpotifyHeaders } from "@/server/utils/externalApiQueries";

export async function GET(_: Request, { params }: { params: { id: string, prompt: string } }) {
  // Fetch artist row
  const artist = await getArtistById(params.id);
  if (!artist) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }
  const prompt = await getActivePrompt();
  if (!prompt) {
    return NextResponse.json({ error: "No prompt found"})
  }

  // If bio already exists, return cached
  if (artist.bio && artist.bio.trim().length > 0) {
    return NextResponse.json({ bio: artist.bio });
  }

  let spotifyBioData = ""; //empty string for spotify data


  //Compile Spotify Data
  if (artist.spotify) {
    //grab headers, get artist
    const headers = await getSpotifyHeaders();
    const {data} = await getSpotifyArtist(artist.spotify, headers);

    //if artist exists, get releases and top track
    if (data) {
      const releases = await getNumberOfSpotifyReleases(artist.spotify, headers);
      const topTrack = await getArtistTopTrackName(artist.spotify, headers); 

      //build spotify bio data
      spotifyBioData = [
        `Spotify name: ${data.name}`,
        `Followers: ${data.followers.total}`,
        data.genres.length > 0 ? `Genres: ${data.genres.join(", ")}` : "No genres found",
        releases > 0 ? `Number of releases: ${releases}` : "No releases found",
        topTrack ? `Top track: ${topTrack}` : "No top track found",
      ].filter(Boolean).join(",");
    }
  }  

  //Compile YouTube Data
  let youtubeBioData = "";
  if (artist.youtubechannel) {
    const {data} = await getYTStats(artist.youtubechannel);
    if (data) {
      youtubeBioData = [
        `Youtube Subscribers: ${data.subCount.toLocaleString()}`,
        `Youtube Bio: ${data.description}`,
        `Youtube Name: ${data.title}`
      ]
      .filter(Boolean)
      .join(",");
    }
  }
  // Build prompt
  const promptParts: string[] = [prompt.promptBeforeName, artist.name!, prompt.promptAfterName];
  
  if (artist.spotify) promptParts.push(`Spotify ID: ${artist.spotify}`);
  if (artist.instagram) promptParts.push(`Instagram: https://instagram.com/${artist.instagram}`);
  if (artist.x) promptParts.push(`Twitter: https://twitter.com/${artist.x}`);
  if (artist.soundcloud) promptParts.push(`SoundCloud: ${artist.soundcloud}`);
  if (artist.youtubechannel) promptParts.push(`YouTube Channel: ${artist.youtubechannel}`);
  if (spotifyBioData) promptParts.push(`Spotify Bio: ${spotifyBioData}`);
  if (youtubeBioData) promptParts.push(`Youtube Data: ${youtubeBioData}`);
  promptParts.push(`Focus on genre, key achievements, and unique traits; avoid speculation.`);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", 
      content: 'You are an artifical intelligence whose sole purpose is to follow the provided prompt.' 
        +promptParts.join("\n") }],
      temperature:0.8,
    });
    const bio = completion.choices[0]?.message?.content?.trim() ?? "";

    if (bio) {
      await db.update(artists).set({ bio }).where(eq(artists.id, params.id));
    }

    return NextResponse.json({ bio });
  } catch (err: any) {
    console.error("OpenAI error generating bio", err);
    return NextResponse.json({ error: "Failed to generate bio" }, { status: 500 });
  }
}
