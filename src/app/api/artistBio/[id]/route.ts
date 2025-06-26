import { NextResponse } from "next/server";
import { openai } from "@/server/lib/openai";
import { getArtistById } from "@/server/utils/queriesTS";
import { db } from "@/server/db/drizzle";
import { artists } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  // Fetch artist row
  const artist = await getArtistById(params.id);
  if (!artist) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  // If bio already exists, return cached
  if (artist.bio && artist.bio.trim().length > 0) {
    return NextResponse.json({ bio: artist.bio });
  }

  // Build prompt
  const promptParts: string[] = [
    
    `As someone who just discovered {artist_name}, write a 50-word paragraph that reveals the most compelling and hidden aspect of their artistry. 
Include facts only die-hard fans would know. Also explain why someone should become a fan of them, and what qualities are needed to be a true fan. 
Channel the emotional tone of their music without saying it directly—express it through style, mood, and metaphor.`,
    `Name: ${artist.name ?? "Unknown"}`,
  ];
  if (artist.spotify) promptParts.push(`Spotify ID: ${artist.spotify}`);
  if (artist.instagram) promptParts.push(`Instagram: https://instagram.com/${artist.instagram}`);
  if (artist.x) promptParts.push(`Twitter: https://twitter.com/${artist.x}`);
  if (artist.soundcloud) promptParts.push(`SoundCloud: ${artist.soundcloud}`);
  if (artist.youtubechannel) promptParts.push(`YouTube Channel: ${artist.youtubechannel}`);
  promptParts.push(`Focus on genre, key achievements, and unique traits; avoid speculation.`);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: 'You are a poetic, emotionally intuitive music writer. You craft 50-word reflections about artists that include deep fan knowledge, symbolic language, and emotional resonance. Avoid clichés and write with vivid, metaphorical flair. Write for fans who crave both insight and feeling.' +promptParts.join("\n") }],
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
