import { NextResponse } from "next/server";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { openai } from "@/server/lib/openai";
import { funFacts } from "@/server/db/schema";
import { db } from "@/server/db/drizzle";
import { eq, sql } from "drizzle-orm";

async function getPrompts() {
  try {
    console.log("=== getPrompts() Debug ===");
    console.log("1. About to query funFacts table...");
    console.log("2. funFacts schema check:");
    console.log("   - funFacts object exists:", !!funFacts);
    console.log("   - isActive field exists:", !!funFacts.isActive);
    console.log("3. Database connection check:");
    console.log("   - db object exists:", !!db);
    console.log("   - db.query exists:", !!db.query);
    console.log("   - db.query.funFacts exists:", !!db.query.funFacts);
    
    console.log("4. Making database query...");
    const result = await db.query.funFacts.findFirst({
      where: eq(funFacts.isActive, true),
    });
    
    console.log("5. Query completed. Result:", result);
    console.log("6. Result type:", typeof result);
    console.log("7. Result is null:", result === null);
    console.log("8. Result is undefined:", result === undefined);
    console.log("9. Result is truthy:", !!result);
    
    if (result) {
      console.log("10. Result structure:");
      console.log("    - id:", result.id, typeof result.id);
      console.log("    - isActive:", result.isActive, typeof result.isActive);
      console.log("    - loreDrop exists:", !!result.loreDrop, "length:", result.loreDrop?.length);
      console.log("    - behindTheScenes exists:", !!result.behindTheScenes, "length:", result.behindTheScenes?.length);
      console.log("    - recentActivity exists:", !!result.recentActivity, "length:", result.recentActivity?.length);
      console.log("    - surpriseMe exists:", !!result.surpriseMe, "length:", result.surpriseMe?.length);
    } else {
      console.log("11. No result found, trying alternative queries...");
      
      // Try a broader query to see if any funFacts exist at all
      try {
        const allFunFacts = await db.query.funFacts.findMany({});
        console.log("12. All funFacts count:", allFunFacts.length);
        if (allFunFacts.length > 0) {
          console.log("13. Sample funFact:", allFunFacts[0]);
          console.log("14. isActive values:", allFunFacts.map(f => f.isActive));
        }
      } catch (allError) {
        console.error("15. Error querying all funFacts:", allError);
      }
      
      // Try raw SQL as fallback
      try {
        const rawResult = await db.execute(sql`SELECT * FROM funfacts WHERE is_active = true LIMIT 1`);
        console.log("16. Raw SQL result:", rawResult);
      } catch (sqlError) {
        console.error("17. Raw SQL error:", sqlError);
      }
    }
    
    return result;
  } catch (error) {
    console.error("Error fetching funFacts prompts:", error);
    console.error("Error details:", {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    return null;
  }
}

export async function GET(req: Request, { params }: { params: { type: string } }) {
  // Set a timeout for the entire operation to prevent Vercel timeouts
  const timeoutPromise = new Promise<NextResponse>((_, reject) => 
    setTimeout(() => reject(new Error('Fun fact generation timeout')), 20000) // 20 second timeout
  );

  const funFactOperation = async (): Promise<NextResponse> => {
    const { type } = params;
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

    const promptMap: Record<string, string> = {
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

    // Replace placeholder with actual artist name
    const finalPrompt = basePrompt.replace("ARTIST_NAME", artist.name ?? "");

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not configured");
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    try {
      // Set timeout for OpenAI API call
      const openaiTimeout = 15000; // 15 seconds
      
      const completion = await Promise.race([
        openai.chat.completions.create({
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
        }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('OpenAI timeout')), openaiTimeout)
        )
      ]);
      
      const text = completion.choices[0]?.message?.content?.trim() ?? "";
      return NextResponse.json({ text });
    } catch (err: any) {
      console.error("OpenAI error generating fun fact", err);
      if (err.message === 'OpenAI timeout') {
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