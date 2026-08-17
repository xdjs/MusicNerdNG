import { NextResponse } from "next/server";
import { getGemini, GEMINI_MODEL_PRO } from "@/server/lib/gemini";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { db } from "@/server/db/drizzle";
import { artists } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { musicPlatformData } from "@/server/utils/musicPlatform";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { sanitizeBioText } from "@/lib/bioText";
import { ABOUT_EMPTY_STATE, isRealBio } from "@/lib/bioConstants";
import type { ArtistVaultSource } from "@/server/db/DbTypes";
import { resolveVerifiedGrounding } from "@/server/utils/verifiedGrounding";
import { getSpotifyHeaders, getSpotifyCatalogNames } from "@/server/utils/queries/externalApiQueries";
import { searchAndPopulateVault } from "@/server/utils/queries/vaultWebSearch";

// Cap inline discovery so a slow (not hung) run can't starve synthesis of the route's
// 45s budget. Whatever discovery has inserted keeps running server-side and is picked
// up (as pending) on the next generation.
const DISCOVERY_TIMEOUT_MS = 22000;

/** Persist the generated About. Single writer so the update shape stays consistent. */
async function saveBio(artistId: string, bio: string): Promise<void> {
  await db.update(artists).set({ bio }).where(eq(artists.id, artistId));
}

/**
 * Generate an artist's "About" via the UNIFIED SOURCING flow:
 *   1. Gather curated context — approved vault sources (claimed artists), else
 *      already-discovered pending sources, else RESEARCH (identity-anchored web
 *      discovery that also writes what it finds to the vault as pending).
 *   2. No contextual sources → return the claim-nudge (never a hollow catalog bio).
 *   3. Synthesize the About from those sources + verified-ID grounding + the real
 *      catalog, with Gemini's own Google Search OFF (live search pulls same-name
 *      namesakes — the conflation bug this flow fixes).
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
  if (artist.spotify) promptParts.push(`Spotify (verified identity): https://open.spotify.com/artist/${artist.spotify}`);
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
  // Verified encyclopedic grounding (conflation-safe: resolved by Spotify ID via
  // Wikidata → Wikipedia, never by name) + the artist's REAL catalog names. These
  // are the strongest anti-conflation levers: facts the generator can't invent around.
  if (artist.spotify) {
    const grounding = await resolveVerifiedGrounding(artist.spotify).catch(() => null);
    if (grounding) {
      promptParts.push(`Verified encyclopedic source (facts only — do NOT copy wording):\n${grounding.extract}`);
    }
    try {
      const headers = await getSpotifyHeaders();
      const catalog = await getSpotifyCatalogNames(artist.spotify, headers);
      if (catalog.releases.length > 0) {
        promptParts.push(`Verified releases (from their Spotify — these are their ONLY real releases; do NOT attribute any release not consistent with this list): ${catalog.releases.join(", ")}`);
      }
      if (catalog.topTracks.length > 0) {
        promptParts.push(`Verified top tracks: ${catalog.topTracks.join(", ")}`);
      }
    } catch (e) {
      console.error("[bio] Spotify catalog fetch failed:", e);
    }
  }

  if (platformBioData) promptParts.push(`Music Platform Data: ${platformBioData}`);

  // UNIFIED SOURCING — the About is synthesized from CURATED VAULT SOURCES, not the
  // model's own web search. Claimed artists use their approved vault; for an empty
  // vault we research (identity-anchored discovery, which also writes what it finds
  // to the vault as pending, for curation + the Ask-About chat + Press & Features)
  // and synthesize from those. If no contextual sources can be found, we return the
  // claim-nudge — never a hollow catalog-only "bio". One source system, end to end.
  let contextualSources: ArtistVaultSource[] = [];
  try {
    const [approved, pending] = await Promise.all([
      getVaultSourcesByArtistId(artistId, "approved"),
      getVaultSourcesByArtistId(artistId, "pending"),
    ]);
    if (approved.length > 0) {
      // Claimed/curated: the artist's approved set is authoritative.
      contextualSources = approved;
      console.log(`[bio] Using ${approved.length} approved vault sources for artist ${artistId}`);
    } else if (pending.length > 0) {
      // Already-discovered material awaiting curation — synthesize from it rather
      // than re-running discovery on every view (discovery dedups, so a re-run would
      // return nothing new and wrongly collapse to the nudge).
      contextualSources = pending;
      console.log(`[bio] Using ${pending.length} pending (discovered) vault sources for artist ${artistId}`);
    } else {
      // Empty vault → research: discover sources (identity-anchored, retries
      // internally, writes to the vault as pending) and synthesize from what returns.
      // Bound it with its own timeout: discovery now runs inline (up to 4 Gemini
      // calls + page fetches) and shares the route's 45s budget with synthesis, so a
      // slow (not hung) run must not starve synthesis and 408 the whole request.
      const discovered = await Promise.race([
        searchAndPopulateVault(artistId).catch(e => {
          console.error("[bio] discovery failed:", e);
          return [] as ArtistVaultSource[];
        }),
        new Promise<ArtistVaultSource[]>(resolve =>
          setTimeout(() => { console.warn("[bio] discovery timed out; falling back"); resolve([]); }, DISCOVERY_TIMEOUT_MS)
        ),
      ]);
      contextualSources = discovered;
      console.log(`[bio] Discovered ${discovered.length} sources for artist ${artistId}`);
    }
  } catch (e) {
    console.error("[bio] source gathering failed:", e);
  }

  // No contextual sources → don't flatten to a catalog list. Cache + return the
  // claim-nudge so the profile invites the artist to add context (and we don't
  // re-run the expensive discovery on every view). An explicit regenerate retries.
  if (contextualSources.length === 0) {
    // Don't clobber an existing real About with the nudge: discovery is flaky (it can
    // return sources one run and none the next), so a regenerate that happens to come
    // up empty must NOT wipe a good bio. Only cache the nudge when there's nothing real
    // to preserve.
    if (isRealBio(artist.bio)) {
      console.log(`[bio] Discovery empty but preserving existing bio for artist ${artistId}`);
      return NextResponse.json({ bio: artist.bio });
    }
    await saveBio(artistId, ABOUT_EMPTY_STATE);
    return NextResponse.json({ bio: ABOUT_EMPTY_STATE, empty: true });
  }

  const vaultContext = contextualSources.map(s => {
    const parts = [`Source: ${s.title ?? s.url}`];
    if (s.snippet) parts.push(s.snippet);
    if (s.extractedText) parts.push(s.extractedText.slice(0, 2000));
    return parts.join(" — ");
  }).join("\n");
  promptParts.push(`\n--- SOURCES (synthesize the About ONLY from these + the verified data above; they are about this exact artist) ---\n${vaultContext}\n--- END SOURCES ---`);

  try {
    const artistData = promptParts.join("\n");
    console.debug("Gemini artistData:", JSON.stringify(artistData, null, 2));

    const geminiStartTime = Date.now();

    const musicNerdVoice = `You write clean, factual artist bios for Music Nerd, a music discovery platform. Think well-written encyclopedia entry, not a review or press release. Tell the reader who this artist is and what they're known for — accurately, without embellishment.

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
- Plain, direct sentences. No social links in the bio text.

GUARDRAILS (critical — accuracy over completeness):
- IDENTITY: The Spotify page, linked socials, and any verified releases provided ABOVE identify this exact artist. Use only facts consistent with them. Other artists may share this name — ignore them entirely; when unsure whether a fact is about THIS artist, omit it.
- CATALOG IS GROUND TRUTH: The "Verified releases" listed above are this artist's ACTUAL catalog. If a source or web result describes a different body of work — releases, hits, or a career timeline that do NOT match the verified releases — it is about a DIFFERENT artist who shares the name; discard it entirely. Never merge another artist's history, releases, or biography onto this one. If, after discarding mismatched material, you cannot verify real context about this artist beyond the bare release list, do NOT pad with a track listing — say limited verified information is available.
- RELATIONSHIP PRECISION: Do not say the artist "collaborated with", "worked with", "produced", "featured", or is "part of" another artist/group unless the exact nature is explicitly documented. Two names appearing together is NOT collaboration — never upgrade an association into a collaboration. Omit if unsure.
- ORIGINALITY: Write entirely in your own words. Never copy sentences or phrasing from any source.`;

    const systemPrompt = `${musicNerdVoice}

You have NO web access for this task. Write the About using ONLY the curated sources and verified data provided below — the sources are your PRIMARY material; mine them for the real names, places, labels, collaborators, credits, and timeline that make the About specific. Treat platform stats (followers, releases, top track) as seasoning, not the story. Do not add facts from outside knowledge; if the provided material doesn't support a claim, leave it out.`;

    // Grounding (Gemini's own Google Search) is OFF by design. The About is
    // synthesized from the CURATED sources we fetched + verified-ID data — never the
    // model's live web search, which pulls in same-name namesakes (the conflation
    // bug this whole flow fixes). Bios are cached, so latency isn't on the hot path.
    const useGrounding = false;

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
      await saveBio(artistId, bio);
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
