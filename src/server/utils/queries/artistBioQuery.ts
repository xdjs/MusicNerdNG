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
  // Authoritative identity anchors — the IDs/links MusicNerd already stores.
  // Formatted as real URLs so Google Search grounding confirms exactly which
  // artist this is and reads the right sources.
  // Values are normally bare slugs/IDs (writes go through extractArtistId), but
  // guard against a legacy/future row already holding a full URL so we never
  // build a doubled ".../wiki/https://.../wiki/..." anchor.
  const anchorUrl = (base: string, value: string) =>
    /^https?:\/\//i.test(value) ? value : `${base}${value}`;
  const anchors: string[] = [];
  if (artist.wikipedia) anchors.push(`Wikipedia: ${anchorUrl("https://en.wikipedia.org/wiki/", artist.wikipedia)}`);
  if (artist.musicbrainz) anchors.push(`MusicBrainz: ${anchorUrl("https://musicbrainz.org/artist/", artist.musicbrainz)}`);
  if (artist.discogs) anchors.push(`Discogs: ${anchorUrl("https://www.discogs.com/artist/", artist.discogs)}`);
  if (artist.wikidata) anchors.push(`Wikidata: ${anchorUrl("https://www.wikidata.org/wiki/", artist.wikidata)}`);
  if (anchors.length > 0) {
    promptParts.push(
      `Authoritative identity anchors (use these to confirm exactly which artist this is; prefer facts they support):\n${anchors.join("\n")}`
    );
  }
  if (platformBioData) promptParts.push(`Music Platform Data: ${platformBioData}`);

  // Include approved vault sources as additional context
  let hasVaultContext = false;
  try {
    const vaultSources = await getVaultSourcesByArtistId(artistId, "approved");
    console.log(`[bio] Found ${vaultSources.length} approved vault sources for artist ${artistId}`);
    if (vaultSources.length > 0) {
      hasVaultContext = true;
      const vaultContext = vaultSources.map(s => {
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

    const musicNerdVoice = `You write clean, factual artist bios for MusicNerd, a music discovery platform. Think well-written encyclopedia entry, not a review or press release. Tell the reader who this artist is and what they're known for — accurately, without embellishment.

Write ONE paragraph, up to ~100 words. Shorter is better than padded: if verified facts are thin, write two or three honest sentences.

Structure:
- Open with the name and what they are: "[Name] is a [role/genre] from [place]." This is the one place a plain identity sentence is correct — lead with it.
- Follow with the most significant verifiable facts: bands, notable releases, collaborators, milestones, dates, well-documented activity outside music.
- Stop when the facts run out. No closing "significance" flourish.

Rules:
- Third person. Anchor on the name; use pronouns sparingly.
- Pronouns: use she/he/they only as the artist is clearly documented to use them in your sources. If unclear, use they/them. Never guess a gendered pronoun.
- State only what your sources support. Never invent bands, releases, collaborators, places, or dates. If unsure a fact is true, leave it out.
- If you genuinely cannot verify anything beyond the name, write ONE neutral sentence, e.g. "[Name] is a musician; limited verified information is currently available." Never explain your process, never refer to "the provided information", never output a refusal or an empty bio.
- No editorializing. Don't tell the reader why the work "matters," don't say the artist is "showing" or "proving" something, and don't append interpretive clauses to facts. Report the fact and stop.
- Banned hype words: "emerging", "rising", "boundary-pushing", "eclectic", "versatile", "undeniable", "sonic", "soundscape", "artist to watch", "cross-genre draw", "carving out". Banned resume-speak: "leveraged", "spearheaded", "secured", "integrated".
- Plain, direct sentences. No social links in the bio text.`;

    const systemPrompt = hasVaultContext
      ? `${musicNerdVoice}

The artist-provided vault context below is your PRIMARY source — mine it for the real names, places, labels, collaborators, credits, and timeline that make the bio specific. Treat platform stats (followers, releases, top track) as seasoning, not the story.`
      : `${musicNerdVoice}`;

    // Grounding is always on: bios must be factual, and grounding lets Gemini
    // read the anchor URLs and the open web. Bios are cached, so the added
    // latency is not on any user's critical path.
    const useGrounding = true;

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
