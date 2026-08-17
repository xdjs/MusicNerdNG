import { NextResponse } from "next/server";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { generateArtistBio } from "@/server/utils/queries/artistBioQuery";
import { requireArtistEditor } from "@/lib/auth-helpers";
import { MAX_BIO_LENGTH, ABOUT_EMPTY_STATE, isRealBio, isAboutEmptyState } from "@/lib/bioConstants";

// This route reads from the DB (getArtistById + the self-heal vault lookup); force dynamic
// so Next.js never statically caches the response at build time (per CLAUDE.md convention).
export const dynamic = "force-dynamic";

// Bio generation runs inline: artist fetch + (concurrently) platform data / verified
// grounding / catalog / source discovery (discovery bounded ~38s — grounded Gemini calls
// measured ~12-33s and may retry) + Gemini synthesis (grounding OFF, ~8s). We race the whole
// thing against a 57s in-handler timeout (see below), under the 60s ceiling. Vercel's default
// serverless ceiling is 10s, which would kill the function long before our race fires;
// maxDuration lets Vercel allow up to 60s for this route (requires Pro plan — Hobby caps at 60s too).
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

// Re-wrap an auth failure (from requireArtistEditor) with this route's CORS headers so it
// matches every other response the route returns. Shared by GET (forced regen) and PUT.
async function corsAuthFailure(auth: { response: Response }): Promise<NextResponse> {
  return NextResponse.json(await auth.response.json(), {
    status: auth.response.status,
    headers: CORS_HEADERS,
  });
}



export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const forceRegenerate = url.searchParams.get("regenerate") === "true";

  // Set a timeout for the entire operation to prevent Vercel timeouts
  const timeoutPromise = new Promise<NextResponse>((_, reject) =>
    setTimeout(() => reject(new Error('Bio generation timeout')), 57000) // 57s: fits inline discovery (~38s) + synthesis under the 60s maxDuration ceiling
  );

  const bioOperation = async (): Promise<NextResponse> => {
    // Forced regeneration bypasses the cache and triggers the expensive discovery + Gemini
    // path, so gate it to admins / the artist who claimed the profile (same guard as PUT).
    // Normal cached reads stay public. Runs INSIDE the try/timeout race so a thrown or slow
    // auth check gets the same graceful (CORS'd, timed) handling as the rest of the route.
    if (forceRegenerate) {
      const auth = await requireArtistEditor(id);
      if (!auth.authenticated) return corsAuthFailure(auth);
    }

    // Fetch artist row/object
    const artist = await getArtistById(id);
    if (!artist) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404, headers: CORS_HEADERS });
    }

    // Empty-state only when there's NO usable identity anchor at all (no bio, no Spotify,
    // no socials) — there's nothing to research from. A Spotify ID alone is enough to try.
    if (!forceRegenerate && !artist.bio && !artist.spotify && !artist.youtubechannel && !artist.instagram && !artist.x && !artist.soundcloud) {
      return NextResponse.json({ bio: ABOUT_EMPTY_STATE }, { headers: CORS_HEADERS });
    }

    // A real cached About → return it.
    if (!forceRegenerate && isRealBio(artist.bio)) {
      return NextResponse.json({ bio: artist.bio }, { headers: CORS_HEADERS });
    }

    // A cached claim-nudge SELF-HEALS: discovery is slow/flaky and can time out after
    // inserting pending sources. If vault sources have since appeared, regenerate from them
    // (synthesis only — no re-discovery). If there are genuinely none, serve the nudge
    // without re-running the expensive discovery on every view.
    if (!forceRegenerate && isAboutEmptyState(artist.bio)) {
      const [approved, pending] = await Promise.all([
        getVaultSourcesByArtistId(id, "approved"),
        getVaultSourcesByArtistId(id, "pending"),
      ]);
      if (approved.length === 0 && pending.length === 0) {
        return NextResponse.json({ bio: ABOUT_EMPTY_STATE }, { headers: CORS_HEADERS });
      }
      // else fall through to generateArtistBio — it will use the now-present sources.
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
      return corsAuthFailure(auth);
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
