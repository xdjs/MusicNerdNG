import { NextResponse } from "next/server";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { openai } from "@/server/lib/openai";

// Helper function to determine artist type based on available platforms
function getArtistType(artist: any): string {
  // Check for indicators of different artist types
  if (artist.imdb) {
    return "film/TV soundtrack";
  }
  
  // Check for traditional music platforms
  if (artist.spotify || artist.soundcloud || artist.bandcamp || artist.audius) {
    return "musician";
  }
  
  // Default to more general term
  return "artist";
}

// Check if response indicates this is about a video game
function isVideoGameResponse(response: string): boolean {
  const lowerResponse = response.toLowerCase();
  return (
    lowerResponse.includes("video game") ||
    lowerResponse.includes("game soundtrack") ||
    lowerResponse.includes("however, this might be a video game") ||
    lowerResponse.includes("this might be a video game") ||
    lowerResponse.includes("however, this is a video game") ||
    lowerResponse.includes("this is a video game") ||
    lowerResponse.includes("game music") ||
    lowerResponse.includes("game composer") ||
    lowerResponse.includes("game developer") ||
    lowerResponse.includes("game development")
  );
}

// Check if response indicates this is about a film/TV soundtrack
function isFilmTVSoundtrackResponse(response: string): boolean {
  const lowerResponse = response.toLowerCase();
  return (
    lowerResponse.includes("film soundtrack") ||
    lowerResponse.includes("movie soundtrack") ||
    lowerResponse.includes("tv soundtrack") ||
    lowerResponse.includes("television soundtrack") ||
    lowerResponse.includes("film score") ||
    lowerResponse.includes("movie score") ||
    lowerResponse.includes("tv score") ||
    lowerResponse.includes("television score") ||
    lowerResponse.includes("however, this might be a film") ||
    lowerResponse.includes("this might be a movie") ||
    lowerResponse.includes("however, this is a film") ||
    lowerResponse.includes("this is a film") ||
    lowerResponse.includes("however, this might be a tv") ||
    lowerResponse.includes("this might be a tv") ||
    lowerResponse.includes("however, this is a tv") ||
    lowerResponse.includes("this is a tv") ||
    lowerResponse.includes("film music") ||
    lowerResponse.includes("movie music") ||
    lowerResponse.includes("tv music") ||
    lowerResponse.includes("television music") ||
    lowerResponse.includes("soundtrack album") ||
    lowerResponse.includes("original soundtrack") ||
    lowerResponse.includes("motion picture soundtrack")
  );
}

// Generate adaptive prompts based on artist type
function getAdaptivePrompts(artistType: string): Record<string, string> {
  const basePrompts = {
    surprise: `Generate a random fun fact about ${artistType === "video game" ? "the game" : `the ${artistType}`} (ARTIST_NAME) that would be interesting to both new fans and superfans. This should not be a well-known fact. Do not provide or make up any false information.`,
    activity: `Generate one concise paragraph about ${artistType === "video game" ? "the game" : `the ${artistType}`} (ARTIST_NAME)'s recent news, announcements, and releases. ${artistType === "video game" ? "Based on official game channels and community posts, write about recent updates, patches, events, or content releases." : "Based on their posts on social media, write about what they have been up to lately."} Write this in a singular, SHORT, and CONCISE paragraph. Do not provide or make up any false information.`
  };

  if (artistType === "video game") {
    return {
      ...basePrompts,
      lore: `Generate one concise paragraph about the game (ARTIST_NAME) including its development background, release history, and what inspired its creation. Focus on the game's origins and development story. Do not provide or make up any false information.`,
      bts: `Generate one concise paragraph about the game (ARTIST_NAME)'s development process, including information about the development team, the game's design philosophy, and how the game was created. Include details about the game's mechanics, art style, or unique features. Do not provide or make up any false information.`
    };
  } else if (artistType === "musician") {
    return {
      ...basePrompts,
      lore: `Generate one concise paragraph about the ${artistType} (ARTIST_NAME) and their childhood/early life, as well as their reasons/motivations for getting into music. Do not provide or make up any false information.`,
      bts: `Generate one concise paragraph about the ${artistType} (ARTIST_NAME)'s process for making music, what roles they execute (ex: singer, producer, and songwriter), and how they get their inspiration for making music. Make sure you include their process for writing, producing, and creating their music. Do not provide or make up any false information.`
    };
  } else if (artistType === "film/TV soundtrack") {
    return {
      ...basePrompts,
      lore: `Generate one concise paragraph about the ${artistType} (ARTIST_NAME) including its creation background, release history, and what inspired its compilation. Focus on the soundtrack's origins and the film/TV show it accompanies. Do not provide or make up any false information.`,
      bts: `Generate one concise paragraph about the ${artistType} (ARTIST_NAME)'s creation process, including information about the artists and composers involved, the selection process for tracks, and how the soundtrack enhances the visual media. Include details about the music style, notable tracks, or unique features. Do not provide or make up any false information.`
    };
  } else {
    // Generic prompts for other types of artists
    return {
      ...basePrompts,
      lore: `Generate one concise paragraph about the ${artistType} (ARTIST_NAME) and their childhood/early life, as well as their reasons/motivations for getting into their creative field. Do not provide or make up any false information.`,
      bts: `Generate one concise paragraph about the ${artistType} (ARTIST_NAME)'s creative process, what roles they execute in their work, and how they get their inspiration for their art. Make sure you include their process for creating and producing their work. Do not provide or make up any false information.`
    };
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

  // Start with initial artist type detection
  const initialArtistType = getArtistType(artist);
  let promptMap = getAdaptivePrompts(initialArtistType);

  let basePrompt = promptMap[type];
  if (!basePrompt) {
    return NextResponse.json({ error: "Invalid fun fact type" }, { status: 400 });
  }

  // Replace placeholder with actual artist name
  let finalPrompt = basePrompt.replace("ARTIST_NAME", artist.name ?? "");

  try {
    // Generate initial response for detection purposes
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are an intelligent assistant. Follow the user prompt closely and do not fabricate information. If you don't have enough information about the subject, be honest about it rather than making up details. When discussing video games, focus on factual information about the game itself, its development, gameplay, and official updates.",
        },
        {
          role: "user",
          content: finalPrompt,
        },
      ],
      temperature: 0.8,
    });
    
    let initialResponse = completion.choices[0]?.message?.content?.trim() ?? "";
    let finalResponse = initialResponse;
    
    // Check if the response indicates this is about a video game
    if (isVideoGameResponse(initialResponse) && initialArtistType !== "video game") {
      // Regenerate with video game-specific prompts
      const videoGamePrompts = getAdaptivePrompts("video game");
      const videoGamePrompt = videoGamePrompts[type];
      
      if (videoGamePrompt) {
        const finalVideoGamePrompt = videoGamePrompt.replace("ARTIST_NAME", artist.name ?? "");
        
        const videoGameCompletion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are an intelligent assistant. Follow the user prompt closely and do not fabricate information. If you don't have enough information about the subject, be honest about it rather than making up details. When discussing video games, focus on factual information about the game itself, its development, gameplay, and official updates.",
            },
            {
              role: "user",
              content: finalVideoGamePrompt,
            },
          ],
          temperature: 0.8,
        });
        
        finalResponse = videoGameCompletion.choices[0]?.message?.content?.trim() ?? "";
      }
    }
    // Check if the response indicates this is about a film/TV soundtrack
    else if (isFilmTVSoundtrackResponse(initialResponse) && initialArtistType !== "film/TV soundtrack") {
      // Regenerate with film/TV soundtrack-specific prompts
      const filmTVPrompts = getAdaptivePrompts("film/TV soundtrack");
      const filmTVPrompt = filmTVPrompts[type];
      
      if (filmTVPrompt) {
        const finalFilmTVPrompt = filmTVPrompt.replace("ARTIST_NAME", artist.name ?? "");
        
        const filmTVCompletion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are an intelligent assistant. Follow the user prompt closely and do not fabricate information. If you don't have enough information about the subject, be honest about it rather than making up details. When discussing film/TV soundtracks, focus on factual information about the soundtrack album, its creation, the media it accompanies, and its musical content.",
            },
            {
              role: "user",
              content: finalFilmTVPrompt,
            },
          ],
          temperature: 0.8,
        });
        
        finalResponse = filmTVCompletion.choices[0]?.message?.content?.trim() ?? "";
      }
    }
    
    // Only return the final response after all checks and regenerations are complete
    return NextResponse.json({ text: finalResponse });
  } catch (err) {
    console.error("OpenAI error generating fun fact", err);
    return NextResponse.json({ error: "Failed to generate fun fact" }, { status: 500 });
  }
} 