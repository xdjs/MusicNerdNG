import { NextResponse } from "next/server";
import { getGemini, GEMINI_MODEL_PRO } from "@/server/lib/gemini";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { db } from "@/server/db/drizzle";
import { artists } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { musicPlatformData } from "@/server/utils/musicPlatform";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { sanitizeBioText } from "@/lib/bioText";

/**
 * Generate an artist bio using Gemini Pro with Google Search grounding.
 * Unified function — used by the bio API route, dashboard actions, and artistLinkService.
 */
export async function generateArtistBio(artistId: string): Promise<NextResponse> {
  const artist = await getArtistById(artistId);
  if (!artist) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  // Compile platform data (Deezer primary, Spotify fallback)
  const PLATFORM_TIMEOUT_MS = 8000;
  let platformBioData = "";
  try {
    const platformArtist = await Promise.race([
      musicPlatformData.getArtist(artist),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PLATFORM_TIMEOUT_MS)),
    ]);
    if (platformArtist) {
      platformBioData = [
        `Name: ${platformArtist.name}`,
        platformArtist.followerCount ? `Followers: ${platformArtist.followerCount}` : null,
        platformArtist.genres.length > 0 ? `Genres: ${platformArtist.genres.join(", ")}` : null,
        platformArtist.albumCount > 0 ? `Number of releases: ${platformArtist.albumCount}` : null,
        platformArtist.topTrackName ? `Top track: ${platformArtist.topTrackName}` : null,
      ].filter(Boolean).join(", ");
    }
  } catch (error) {
    console.error("Error fetching platform data for bio generation:", error);
  }

  // Put all informational sections of prompt together
  const promptParts: string[] = [];
  if (artist.spotify) promptParts.push(`Spotify ID: ${artist.spotify}`);
  if (artist.instagram) promptParts.push(`Instagram: https://instagram.com/${artist.instagram}`);
  if (artist.x) promptParts.push(`X: https://x.com/${artist.x}`);
  if (artist.soundcloud) promptParts.push(`SoundCloud: ${artist.soundcloud}`);
  if (artist.youtube) promptParts.push(`YouTube: https://youtube.com/@${artist.youtube.replace(/^@/, '')}`);
  if (artist.youtubechannel) promptParts.push(`YouTube Channel: ${artist.youtubechannel}`);
  if (artist.wikipedia) promptParts.push(`Wikipedia: ${artist.wikipedia}`);
  if (platformBioData) promptParts.push(`Music Platform Data: ${platformBioData}`);

  // Include approved vault sources as additional context
  let hasVaultContext = false;
  const vaultUrls: string[] = [];
  try {
    const vaultSources = await getVaultSourcesByArtistId(artistId, "approved");
    console.log(`[bio] Found ${vaultSources.length} approved vault sources for artist ${artistId}`);
    if (vaultSources.length > 0) {
      hasVaultContext = true;
      const vaultContext = vaultSources.map(s => {
        if (s.url) vaultUrls.push(s.url);
        const parts = [`Source: ${s.title ?? s.url}`];
        if (s.snippet) parts.push(s.snippet);
        if (s.extractedText) parts.push(s.extractedText.slice(0, 2000));
        return parts.join(" — ");
      }).join("\n");
      promptParts.push(`\n--- ARTIST-PROVIDED VAULT CONTEXT (USE THIS AS PRIMARY SOURCE) ---\n${vaultContext}\n--- END VAULT CONTEXT ---`);
    }
  } catch (e) {
    console.error("Error fetching vault sources for bio:", e);
  }

  try {
    const artistData = promptParts.join("\n");
    console.debug("Gemini artistData:", JSON.stringify(artistData, null, 2));

    const geminiStartTime = Date.now();

    const musicNerdVoice = `You write for MusicNerd, a discovery platform for people who genuinely care about music. Write an artist bio the way the sharpest person at the record store talks about an artist they love: deeply informed, a little obsessive, genuinely excited — and never corporate.

Write ONE paragraph, 90-130 words. One paragraph only.

Voice:
- Open with an angle — a line that frames what makes this artist worth caring about. Never a job title, never "[Name] is a [genre] artist."
- Write like you're letting a fellow nerd in on something good. Pull the reader into the artist's world: the scene they come from, the lineage they're part of, the specific choices that make their work theirs.
- Active, vivid verbs. Sentences with rhythm — vary the length. Hold a point of view; have a take on why this work matters.
- Facts are your texture: names, places, labels, collaborators, songs, dates, and any artist-provided context. Specifics earn trust; adjectives don't. Let detail do the work.

Hard rules:
- No corporate/résumé register. Never use "leveraged", "spearheaded", "integrated campaigns", "secured placements", "career connects", "leading work in".
- Banned vanilla phrases: "emerging force", "pushing boundaries", "sonic territories", "artist to watch", "rising star", "carving out", "soundscape", "eclectic", "undeniable", "versatile", "seamlessly".
- Facts only — never invent credits, collaborators, scenes, or influences. If the data is thin, stay short and concrete instead of padding.
- No social links in the bio text.`;

    const systemPrompt = hasVaultContext
      ? `${musicNerdVoice}

The artist-provided vault context below is your PRIMARY source — mine it for the real names, places, labels, collaborators, credits, and timeline that make the bio specific. Treat platform stats (followers, releases, top track) as seasoning, not the story.`
      : `${musicNerdVoice}`;

    // Use Google Search grounding when vault sources exist (allows Gemini to visit those URLs)
    const useGrounding = hasVaultContext && vaultUrls.length > 0;

    const response = await Promise.race([
      getGemini().models.generateContent({
        model: GEMINI_MODEL_PRO,
        contents: `Write a bio for the artist "${artist.name!}". Here is what we know about them:\n${artistData}`,
        config: {
          systemInstruction: systemPrompt,
          ...(useGrounding ? { tools: [{ googleSearch: {} }] } : {}),
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timeout')), 45000)
      )
    ]);

    const geminiEndTime = Date.now();
    const geminiDurationMs = geminiEndTime - geminiStartTime;

    // Strip any link artifacts the model emitted despite the "no social links" rule —
    // grounded responses in particular like to append markdown citations.
    const bio = sanitizeBioText(response.text);
    console.debug("Gemini bio:", JSON.stringify(bio, null, 2));
    console.debug("Gemini call duration:", `${geminiDurationMs}ms`);

    if (bio) {
      await db.update(artists).set({ bio }).where(eq(artists.id, artistId));
    }

    return NextResponse.json({ bio });
  } catch (err: any) {
    console.error("Gemini error generating bio", err);
    if (err.message === 'Gemini timeout') {
      return NextResponse.json({ error: "Bio generation timed out" }, { status: 408 });
    }
    return NextResponse.json({ error: "Failed to generate bio" }, { status: 500 });
  }
}

/**
 * Simplified wrapper that returns just the bio string.
 * Used by artistLinkService for background bio regeneration.
 */
export async function regenerateArtistBio(artistId: string): Promise<string | null> {
  try {
    const response = await generateArtistBio(artistId);
    const data = await response.json();
    return data.bio ?? null;
  } catch (e) {
    console.error("[regenerateArtistBio] Error:", e);
    return null;
  }
}
