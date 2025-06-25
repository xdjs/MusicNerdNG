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
    `Write a concise, engaging third-person musician biography (120-150 words).`,
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
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: promptParts.join("\n") }],
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
