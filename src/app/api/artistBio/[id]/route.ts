import { NextResponse } from "next/server";
import { openai } from "@/server/lib/openai";
import { getActivePrompt, getArtistById } from "@/server/utils/queries/artistQueries";
import { db } from "@/server/db/drizzle";
import { aiPrompts, artists } from "@/server/db/schema";
import { eq } from "drizzle-orm";

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

  if (!artist.bio && !artist.youtubechannel && !artist.instagram && !artist.x && !artist.soundcloud) {
    const testBio = "MusicNerd needs artist data to generate a summary. Try adding some to get started!";
    return NextResponse.json({ bio: testBio });
  }

  // If bio already exists, return cached
  if (artist.bio && artist.bio.trim().length > 0) {
    return NextResponse.json({ bio: artist.bio });
  }

  // Build prompt
  const promptParts: string[] = [prompt.promptBeforeName, artist.name!, prompt.promptAfterName];
    if (artist.spotify) promptParts.push(`Spotify ID: ${artist.spotify}`);
    if (artist.instagram) promptParts.push(`Instagram: https://instagram.com/${artist.instagram}`);
    if (artist.x) promptParts.push(`Twitter: https://twitter.com/${artist.x}`);
    if (artist.soundcloud) promptParts.push(`SoundCloud: ${artist.soundcloud}`);
    if (artist.youtubechannel) promptParts.push(`YouTube Channel: ${artist.youtubechannel}`);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", 
      content: 'You are an artifical intelligence whose sole purpose is to follow the provided prompt.' +promptParts.join("\n") }],
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
