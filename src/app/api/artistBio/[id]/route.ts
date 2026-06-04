import { NextResponse } from "next/server";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { generateArtistBio } from "@/server/utils/queries/artistBioQuery";
import { requireArtistEditor } from "@/lib/auth-helpers";
import { MAX_BIO_LENGTH } from "@/lib/bioConstants";

// Bio generation does Gemini + Google Search grounding; we race against a 45s in-handler
// timeout (see below). Vercel's default serverless function ceiling is 10s, which would
// kill the function long before our 45s race ever fires. Declaring maxDuration tells
// Vercel to allow up to 60s for this route (requires Pro plan — Hobby caps at 60s too).
export const maxDuration = 60;

// CORS configuration for this route
const ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_ALLOWED_ORIGIN || "*";
const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}



export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const forceRegenerate = url.searchParams.get("regenerate") === "true";

  // Set a timeout for the entire operation to prevent Vercel timeouts
  const timeoutPromise = new Promise<NextResponse>((_, reject) =>
    setTimeout(() => reject(new Error('Bio generation timeout')), 45000) // 45 second timeout for Gemini + Google Search grounding
  );

  const bioOperation = async (): Promise<NextResponse> => {
    // Fetch artist row/object
    const artist = await getArtistById(id);
    if (!artist) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404, headers: CORS_HEADERS });
    }

    //If the artist lacks vital info (instagram, X, Youtube etc), then display a generic message from the aiprompts table
    if (!forceRegenerate && !artist.bio && !artist.youtubechannel && !artist.instagram && !artist.x && !artist.soundcloud) {
      const testBio = "MusicNerd needs artist data to generate a summary. Try adding some to get started!";
      return NextResponse.json({ bio: testBio }, { headers: CORS_HEADERS });
    }

    // If bio already exists in the database and not forcing regeneration, return cached
    if (!forceRegenerate && artist.bio && artist.bio.trim().length > 0) {
      return NextResponse.json({ bio: artist.bio }, { headers: CORS_HEADERS });
    }

    //generate a bio and return it
    try {
      const response = await generateArtistBio(id);
      Object.entries(CORS_HEADERS).forEach(([key, value]) => response.headers.set(key, String(value)));
      return response;
    //Error Handling
    } catch (err) {
      console.error("Error generating bio", err);
      return NextResponse.json({error: "failed to generate artist bio"}, {status: 500, headers: CORS_HEADERS});
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
        { status: 408, headers: CORS_HEADERS }
      );
    }
    
    return NextResponse.json(
      { error: "Internal server error", bio: "Unable to generate bio at this time. Please try again later." },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// ----------------------------------
// PUT /api/artistBio/[id]
// ----------------------------------
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireArtistEditor(id);
    if (!auth.authenticated) {
      const body = await auth.response.text();
      return new Response(body, {
        status: auth.response.status,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      });
    }
    const body = await request.json();
    const bio: string = body?.bio;
    const regenerate: boolean = body?.regenerate || false;

    // For regeneration, bio can be empty
    if (!regenerate && (!bio || typeof bio !== "string" || bio.trim().length === 0)) {
      return NextResponse.json({ message: "Invalid bio" }, { status: 400, headers: CORS_HEADERS });
    }

    if (!regenerate && bio.length > MAX_BIO_LENGTH) {
      return NextResponse.json(
        { message: `Bio must be ${MAX_BIO_LENGTH} characters or fewer` },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const { updateArtistBio } = await import("@/server/utils/queries/artistQueries");

    const result = await updateArtistBio(id, bio, regenerate);

    if (result.status === "success") {
      return NextResponse.json({ 
        message: result.message,
        bio: result.data // Include generated bio for regeneration
      }, { headers: CORS_HEADERS });
    }

    return NextResponse.json({ message: result.message }, { status: 500, headers: CORS_HEADERS });
  } catch (e) {
    console.error("[artistBio] PUT error", e);
    return NextResponse.json({ message: "Error updating bio" }, { status: 500, headers: CORS_HEADERS });
  }
}
