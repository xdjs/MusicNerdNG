import { NextResponse } from "next/server";
import { openai } from "@/server/lib/openai";
import { getArtistById } from "@/server/utils/queriesTS";
import { db } from "@/server/db/drizzle";
import { artists } from "@/server/db/schema";
import { sql } from "drizzle-orm";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const artist = await getArtistById(params.id);
    if (!artist) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404 });
    }

    // If a bio already exists (stored in bio), just return it
    if (artist.bio && artist.bio.trim().length > 0) {
      return NextResponse.json({ bio: artist.bio });
    }

    // Build prompt parts from available data
    const lines: string[] = [
      `Name: ${artist.name ?? "Unknown"}`,
    ];
    if (artist.spotify) lines.push(`Spotify ID: ${artist.spotify}`);
    if (artist.instagram) lines.push(`Instagram handle: ${artist.instagram}`);
    if (artist.x) lines.push(`Twitter handle: ${artist.x}`);
    if (artist.soundcloud) lines.push(`SoundCloud: ${artist.soundcloud}`);
    if (artist.youtubechannel) lines.push(`YouTube: ${artist.youtubechannel}`);

    const prompt = `Write a concise, engaging third-person musician biography (120-150 words).\n${lines.join("\n")}\nFocus on genre, key achievements and unique traits, avoid speculation.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const bio = completion.choices[0]?.message?.content?.trim() ?? "";

    // Persist the bio in the bio column
    if (bio) {
      await db
        .update(artists)
        .set({ bio, updatedAt: sql`now()` })
        .where(sql`${artists.id} = ${params.id}`);
    }

    return NextResponse.json({ bio });
  } catch (e: any) {
    console.error("Artist bio generation error", e);
    return NextResponse.json({ error: "Failed to generate bio" }, { status: 500 });
  }
} 