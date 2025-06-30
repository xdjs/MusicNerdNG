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
  `
    As someone who just discovered ${artist.name}, write a brief 100-word-maximum biography paragraph. 
    Describe the genre(s) that their music falls into. 
    If known, describe how they entered music and where they are now. 
    Include interesting general trivia that a moderate fan might know, such as if they have a unique lyrical/writing style or production process. 
    Also explain why someone might relate to their music or find it enjoyable. 
    Avoid sentences that contain excessive descriptions and adjective use that lack actual descriptive substance.  

    Here are a few requirements that you MUST adhere to:
    - Treat this prompt as an outline, not a bullet list. Respond in a natural way, as if you were a human writing a brief biography paragraph.
    - Ensure that you do not write any redundant descriptions or topic points.
    - Do not use metaphors.
    - The trivia that you include should ideally be something applicable to a majority of their music.
    - While you should aim to get as close as possible to 100 words, if you cannot find information on the artist, do not attempt to supplicate your response with fabricated information. It is okay to state that they do not have much information available. 
  `
  ];
  if (artist.spotify) promptParts.push(`Spotify ID: ${artist.spotify}`);
  if (artist.instagram) promptParts.push(`Instagram: https://instagram.com/${artist.instagram}`);
  if (artist.x) promptParts.push(`Twitter: https://twitter.com/${artist.x}`);
  if (artist.soundcloud) promptParts.push(`SoundCloud: ${artist.soundcloud}`);
  if (artist.youtubechannel) promptParts.push(`YouTube Channel: ${artist.youtubechannel}`);
  {/*promptParts.push(`Focus on genre, key achievements, and unique traits; avoid speculation.`);*/}

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
