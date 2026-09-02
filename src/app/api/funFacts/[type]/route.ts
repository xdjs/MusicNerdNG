import { NextResponse } from "next/server";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { funfacts } from "@/server/db/schema";
import { db } from "@/server/db/drizzle";
import { eq } from "drizzle-orm";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { getArtistDocContext } from "@/server/utils/artistDocService";

async function getPrompts() {
  try {
    const result = await db.query.funfacts.findFirst({
      where: eq(funfacts.isActive, true),
    });
    return result;
  } catch (error) {
    console.error("Error fetching funFacts prompts:", error);
    return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;

  // Set a timeout for the entire operation to prevent Vercel timeouts
  const timeoutPromise = new Promise<NextResponse>((_, reject) =>
    setTimeout(() => reject(new Error('Fun fact generation timeout')), 20000) // 20 second timeout
  );

  const funFactOperation = async (): Promise<NextResponse> => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      console.error("Missing artist id");
      return NextResponse.json({ error: "Missing artist id" }, { status: 400 });
    }

    const artist = await getArtistById(id);
    if (!artist) {
      console.error("Artist not found");
      return NextResponse.json({ error: "Artist not found" }, { status: 404 });
    }

    const prompts = await getPrompts();
    if (!prompts) {
      console.error("Failed to fetch prompts");
      return NextResponse.json({ error: "Failed to fetch prompts" }, { status: 500 });
    }

    const promptMap: Record<string, string | null> = {
      surprise: prompts.surpriseMe,
      lore: prompts.loreDrop,
      bts: prompts.behindTheScenes,
      activity: prompts.recentActivity,
    };

    const basePrompt = promptMap[type];
    if (!basePrompt) {
      console.error("Invalid fun fact type");
      return NextResponse.json({ error: "Invalid fun fact type" }, { status: 400 });
    }

    // Replace placeholders with actual artist information
    let finalPrompt = basePrompt.replace("ARTIST_NAME", artist.name ?? "");
    if (artist.spotify) {
      finalPrompt = finalPrompt.replace("SPOTIFY_ID", artist.spotify);
    }

    // Append approved vault sources as additional context
    try {
      const vaultSources = await getVaultSourcesByArtistId(id, "approved");
      if (vaultSources.length > 0) {
        const vaultContext = vaultSources.map(s => {
          const parts = [`Source: ${s.title ?? s.url}`];
          if (s.snippet) parts.push(s.snippet);
          if (s.extractedText) parts.push(s.extractedText.slice(0, 1000));
          return parts.join(" — ");
        }).join("\n");
        finalPrompt += `\n\nAdditional context provided by the artist:\n${vaultContext}`;
      }
    } catch (e) {
      console.error("Error fetching vault sources for fun facts:", e);
    }

    // Artist doc — its "Story hooks" section is exactly what fun facts want.
    try {
      const docContext = await getArtistDocContext(id);
      if (docContext) {
        finalPrompt += `\n\nArtist knowledge doc (compiled with the artist — prefer its "Story hooks"):\n${docContext}`;
      }
    } catch (e) {
      console.error("Error fetching artist doc for fun facts:", e);
    }

    try {
      // Set timeout for Gemini API call
      const geminiTimeout = 15000; // 15 seconds

      const response = await Promise.race([
        getGemini().models.generateContent({
          model: GEMINI_MODEL_FLASH,
          contents: finalPrompt,
          config: {
            systemInstruction: "You are a sharp music writer. Follow the user's prompt exactly. Be concrete and specific — name real songs, people, places, and dates. Keep it tight: no filler or hype phrases like \"rising star\", \"eclectic\", or \"undeniable\". Never fabricate or speculate; if you're unsure, leave it out.",
            temperature: 0.8,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini timeout')), geminiTimeout)
        )
      ]);

      const text = response.text ?? "";
      return NextResponse.json({ text });
    } catch (err: any) {
      console.error("Gemini error generating fun fact", err);
      if (err.message === 'Gemini timeout') {
        return NextResponse.json({ error: "Fun fact generation timed out" }, { status: 408 });
      }
      return NextResponse.json({ error: "Failed to generate fun fact" }, { status: 500 });
    }
  };

  try {
    // Race between the fun fact operation and timeout
    return await Promise.race([funFactOperation(), timeoutPromise]);
  } catch (error: any) {
    console.error('Error in fun fact generation:', error);

    if (error instanceof Error && error.message === 'Fun fact generation timeout') {
      return NextResponse.json(
        { error: "Fun fact generation timed out. Please try again later." },
        { status: 408 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
