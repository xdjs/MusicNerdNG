import { NextResponse } from "next/server";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { openai } from "@/server/lib/openai";
import { funFacts } from "@/server/db/schema";
import { db } from "@/server/db/drizzle";
import { eq } from "drizzle-orm";

async function getPrompts() {
  try {
    const result = await db.query.funFacts.findFirst({
      where: eq(funFacts.isActive, true),
    });
    return result;
  } catch (error) {
    console.error("Error fetching funFacts prompts:", error);
    return null;
  }
}

export async function GET(req: Request, { params }: { params: { type: string } }) {
  const { type } = params;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing artist id" }, { status: 400 });
  }

  const artist = await getArtistById(id);
  if (!artist) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  const prompts = await getPrompts();
  if (!prompts) {
    return NextResponse.json({ error: "Failed to fetch prompts" }, { status: 500 });
  }

  const promptMap: Record<string, string> = {
    surprise: prompts.surpriseMe,
    lore: prompts.loreDrop,
    bts: prompts.behindTheScenes,
    activity: prompts.recentActivity,
  };

  const basePrompt = promptMap[type];
  if (!basePrompt) {
    return NextResponse.json({ error: "Invalid fun fact type" }, { status: 400 });
  }

  // Replace placeholder with actual artist name
  const finalPrompt = basePrompt.replace("ARTIST_NAME", artist.name ?? "");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are an intelligent assistant. Follow the user prompt closely and do not fabricate information.",
        },
        {
          role: "user",
          content: finalPrompt,
        },
      ],
      temperature: 0.8,
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    return NextResponse.json({ text });
  } catch (err) {
    console.error("OpenAI error generating fun fact", err);
    return NextResponse.json({ error: "Failed to generate fun fact" }, { status: 500 });
  }
} 


sdlkfhgkljdfsgkljsdfgkljhsdfklghfdsklghdsfghkldrshg