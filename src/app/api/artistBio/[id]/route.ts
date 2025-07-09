import { NextResponse } from "next/server";
import { getActivePrompt, getArtistById } from "@/server/utils/queries/artistQueries";
import { getOpenAIBio } from "@/server/utils/openAIQuery";
import { db } from "@/server/db/drizzle";
import { aiPrompts, artists } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_: Request, { params }: { params: { id: string, prompt: string } }) {
  // Fetch artist row/object
  const artist = await getArtistById(params.id);
  if (!artist) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  //If the artist lacks vital info (instagram, X, Youtube etc), then display a generic message from the aiprompts table
  if (!artist.bio && !artist.youtubechannel && !artist.instagram && !artist.x && !artist.soundcloud) {
    const testBio = "MusicNerd needs artist data to generate a summary. Try adding some to get started!";
    return NextResponse.json({ bio: testBio });
  }

  // If bio already exists in the database, return cached
  if (artist.bio && artist.bio.trim().length > 0) {
    return NextResponse.json({ bio: artist.bio });
  }

  //generate a bio and return it
  try {
    return await getOpenAIBio(params.id);
  //Error Handling
  }catch (err) {
    console.error("Error generating bio", err);
    return NextResponse.json({error: "failed to generate artist bio"}, {status: 500});
  }
}
