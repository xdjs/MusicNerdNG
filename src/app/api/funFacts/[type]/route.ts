import { NextResponse } from "next/server";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { openai } from "@/server/lib/openai";

// Map type param to descriptive prompt and section label
const promptMap: Record<string, string> = {
  surprise:
    "Generate a random fun fact about the artist (ARTIST_NAME) that would be interesting to both new fans and superfans. This should not be a well-known fact. Do not provide or make up any false information.",
  lore:
    "Generate one concise paragraph about the artist (ARTIST_NAME) and their childhood/early life, as well as their reasons/motivations for getting into music. Do not provide or make up any false information.",
  bts:
    "Generate one concise paragraph about the artist (ARTIST_NAME)'s process for making music, what roles they execute (ex: singer, producer, and songwriter), and how they get their inspiration for making music. Make sure you include their process for writing, producing, and creating their music. Do not provide or make up any false information.",
  activity:
    "Generate one concise paragraph about the artist (ARTIST_NAME)'s recent news, announcements, and releases. Based on their posts on social media, write about what they have been up to lately. Write this in a singular, SHORT, and CONCISE paragraph. Do not provide or make up any false information.",
};

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