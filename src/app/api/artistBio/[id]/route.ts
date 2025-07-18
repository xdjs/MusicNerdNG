import { NextResponse } from "next/server";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getOpenAIBio } from "@/server/utils/queries/openAIQuery";

export async function GET(_: Request, { params }: { params: { id: string, prompt: string } }) {
  // Set a timeout for the entire operation to prevent Vercel timeouts
  const timeoutPromise = new Promise<NextResponse>((_, reject) => 
    setTimeout(() => reject(new Error('Bio generation timeout')), 25000) // 25 second timeout
  );

  const bioOperation = async (): Promise<NextResponse> => {
    // Fetch artist row/object
    const artist = await getArtistById(params.id);
    if (!artist) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404 });
    }

    //If the artist lacks vital info (instagram, X, Youtube etc), then display a generic message from the aiprompts table
    if (!artist.bio && !artist.youtubechannel && !artist.instagram && !artist.x && !artist.soundcloud) {
      const testBio = "MusicNerd needs artist data to generate a summary. Try adding some to get started!";
      return NextResponse.json({ bio: testBio });
    }

    // If bio already exists in the database, return cached
    if (artist.bio && artist.bio.trim().length > 0) {
      return NextResponse.json({ bio: artist.bio });
    }

    //generate a bio and return it
    try {
      return await getOpenAIBio(params.id);
    //Error Handling
    } catch (err) {
      console.error("Error generating bio", err);
      return NextResponse.json({error: "failed to generate artist bio"}, {status: 500});
    }
  };

  try {
    // Race between the bio operation and timeout
    return await Promise.race([bioOperation(), timeoutPromise]);
  } catch (error: any) {
    console.error('Error in artist bio generation:', error);
    
    if (error instanceof Error && error.message === 'Bio generation timeout') {
      return NextResponse.json(
        { error: "Bio generation timed out. Please try again later.", bio: "Bio generation is taking longer than expected. Please refresh the page to try again." },
        { status: 408 }
      );
    }
    
    return NextResponse.json(
      { error: "Internal server error", bio: "Unable to generate bio at this time. Please try again later." },
      { status: 500 }
    );
  }
}
