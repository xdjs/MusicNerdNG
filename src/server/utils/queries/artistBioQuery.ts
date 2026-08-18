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
import { getArtistDoc } from "@/server/utils/queries/onboardingQueries";
import { ARTIST_DOC_CONTEXT_CAP } from "@/server/utils/artistDocService";

// Every I/O the generator does runs concurrently inside the route's budget, so each gets
// its own bound: no single slow dependency can starve synthesis and 408 the request.
// NOTE on DISCOVERY_TIMEOUT_MS: grounded Gemini discovery calls measured ~12-33s each and
// intermittently return empty (forcing a retry), so the full retry+redirect path is wide.
// Page-content enrichment was moved OFF this path (fire-and-forget) precisely so it fits.
// This bound must clear a normal 2-3 call run; it exists to cap RUNAWAY retries, not to
// truncate success. Discovery dominates; grounding/catalog/platform overlap it in <1s.
const PLATFORM_TIMEOUT_MS = 8000;   // Deezer/Spotify platform stats
const IDENTITY_TIMEOUT_MS = 10000;  // verified-ID grounding + real catalog
const DISCOVERY_TIMEOUT_MS = 38000; // source discovery (Gemini retries + redirects). Whatever
                                    // discovery inserted keeps running server-side and is
                                    // picked up (as pending) on the next generation.

/** Resolve `p`, or `fallback` if it doesn't settle within `ms` (never rejects). */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** Persist the generated About. Single writer so the update shape stays consistent. */
async function saveBio(artistId: string, bio: string): Promise<void> {
  await db.update(artists).set({ bio }).where(eq(artists.id, artistId));
}

/**
 * Gather the curated context for synthesis, tiered: approved vault sources (claimed) →
 * already-discovered pending sources → bounded web discovery.
 *
 * NOTE on transient DB errors: getVaultSourcesByArtistId degrades to [] on any DB error
 * (it never throws — the many read paths that use it, the artist page / chat / fun facts,
 * want graceful degradation, not a crash). We deliberately do NOT try to distinguish "DB
 * error" from "genuinely empty" here — it isn't observable at this layer, and a transient
 * vault-read failure is benign: it simply looks like an empty vault and triggers discovery
 * (which usually still yields a real bio). Any residual bad state is covered elsewhere — the
 * clobber-guard preserves an existing bio, and the route self-heal recovers a cached nudge
 * once the DB is healthy and sources exist.
 */
async function gatherContextualSources(artistId: string): Promise<ArtistVaultSource[]> {
  try {
    const [approved, pending] = await Promise.all([
      getVaultSourcesByArtistId(artistId, "approved"),
      getVaultSourcesByArtistId(artistId, "pending"),
    ]);
    if (approved.length > 0) {
      console.log(`[bio] Using ${approved.length} approved vault sources for artist ${artistId}`);
      return approved;
    }
    if (pending.length > 0) {
      // Already-discovered material awaiting curation — synthesize from it rather than
      // re-running discovery on every view (discovery dedups, so a re-run would return
      // nothing new and wrongly collapse to the nudge).
      console.log(`[bio] Using ${pending.length} pending (discovered) vault sources for artist ${artistId}`);
      return pending;
    }
    // Empty vault → research: discover sources (identity-anchored, retries internally,
    // writes to the vault as pending) and synthesize from what returns. Bounded by
    // withTimeout so a slow/hung run can't starve synthesis of the route's budget.
    const discovered = await withTimeout(
      searchAndPopulateVault(artistId).catch((e) => {
        console.error("[bio] discovery failed:", e);
        return [] as ArtistVaultSource[];
      }),
      DISCOVERY_TIMEOUT_MS,
      [] as ArtistVaultSource[],
    );
    console.log(`[bio] Discovered ${discovered.length} sources for artist ${artistId}`);
    return discovered;
  } catch (e) {
    console.error("[bio] source gathering failed:", e);
    return [];
  }
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

  // Run every independent I/O concurrently so they overlap inside the route's 57s budget
  // instead of summing. Platform stats (Deezer primary, Spotify fallback), verified-ID
  // grounding, the real catalog, and source-gathering all fire at once; each is bounded.
  const spotifyId = artist.spotify;
  const platformPromise: Promise<string> = (async () => {
    try {
      const platformArtist = await withTimeout(musicPlatformData.getArtist(artist), PLATFORM_TIMEOUT_MS, null);
      if (!platformArtist) return "";
      return [
        `Name: ${platformArtist.name}`,
        platformArtist.followerCount ? `Followers: ${platformArtist.followerCount}` : null,
        platformArtist.genres.length > 0 ? `Genres: ${platformArtist.genres.join(", ")}` : null,
        platformArtist.albumCount > 0 ? `Number of releases: ${platformArtist.albumCount}` : null,
        platformArtist.topTrackName ? `Top track: ${platformArtist.topTrackName}` : null,
      ].filter(Boolean).join(", ");
    } catch (error) {
      console.error("Error fetching platform data for bio generation:", error);
      return "";
    }
  })();
  // Verified encyclopedic grounding (conflation-safe: resolved by Spotify ID via Wikidata
  // → Wikipedia, never by name) + the artist's REAL catalog names — the strongest
  // anti-conflation levers: facts the generator can't invent around.
  const groundingPromise = spotifyId
    ? withTimeout(resolveVerifiedGrounding(spotifyId).catch(() => null), IDENTITY_TIMEOUT_MS, null)
    : Promise.resolve(null);
  const catalogPromise: Promise<{ releases: string[]; topTracks: string[] }> = spotifyId
    ? withTimeout((async () => {
        try {
          const headers = await getSpotifyHeaders();
          return await getSpotifyCatalogNames(spotifyId, headers);
        } catch (e) {
          console.error("[bio] Spotify catalog fetch failed:", e);
          return { releases: [], topTracks: [] };
        }
      })(), IDENTITY_TIMEOUT_MS, { releases: [], topTracks: [] })
    : Promise.resolve({ releases: [], topTracks: [] });
  // UNIFIED SOURCING — the About is synthesized from CURATED VAULT SOURCES, not the
  // model's own web search. Claimed artists use their approved vault; for an empty vault
  // we research (identity-anchored discovery, which also writes what it finds to the vault
  // as pending, for curation + the Ask-About chat + Press & Features). No contextual
  // sources → the claim-nudge, never a hollow catalog-only "bio". One source system.
  const sourcesPromise = gatherContextualSources(artistId);

  const [platformBioData, grounding, catalog, contextualSources] = await Promise.all([
    platformPromise, groundingPromise, catalogPromise, sourcesPromise,
  ]);

  // No contextual sources → don't flatten to a catalog list.
  if (contextualSources.length === 0) {
    // Don't clobber an existing real About with the nudge: discovery is flaky (it can
    // return sources one run and none the next), so a regenerate that happens to come up
    // empty must NOT wipe a good bio.
    if (isRealBio(artist.bio)) {
      console.log(`[bio] Discovery empty but preserving existing bio for artist ${artistId}`);
      return NextResponse.json({ bio: artist.bio });
    }
    // Cache the nudge so the profile invites the artist to add context (and we don't
    // re-run the expensive discovery on every view). An explicit regenerate retries.
    await saveBio(artistId, ABOUT_EMPTY_STATE);
    return NextResponse.json({ bio: ABOUT_EMPTY_STATE, empty: true });
  }

  // Assemble the prompt in order: identity links → anchors → verified facts → sources.
  const promptParts: string[] = [];
  if (artist.spotify) promptParts.push(`Spotify (verified identity): https://open.spotify.com/artist/${artist.spotify}`);
  if (artist.instagram) promptParts.push(`Instagram: https://instagram.com/${artist.instagram}`);
  if (artist.x) promptParts.push(`X: https://x.com/${artist.x}`);
  if (artist.soundcloud) promptParts.push(`SoundCloud: ${artist.soundcloud}`);
  if (artist.youtube) promptParts.push(`YouTube: https://youtube.com/@${artist.youtube.replace(/^@/, '')}`);
  if (artist.youtubechannel) promptParts.push(`YouTube Channel: ${artist.youtubechannel}`);
  // Authoritative identity anchors — the IDs/links MusicNerd already stores. Formatted as
  // real URLs. Values are normally bare slugs/IDs (writes go through extractArtistId), but
  // guard against a legacy/future row already holding a full URL so we never build a
  // doubled ".../wiki/https://.../wiki/..." anchor.
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
  if (grounding) {
    promptParts.push(`Verified encyclopedic source (facts only — do NOT copy wording):\n${grounding.extract}`);
  }
  if (catalog.releases.length > 0) {
    promptParts.push(`Verified releases (from their Spotify — these are their ONLY real releases; do NOT attribute any release not consistent with this list): ${catalog.releases.join(", ")}`);
  }
  if (catalog.topTracks.length > 0) {
    promptParts.push(`Verified top tracks: ${catalog.topTracks.join(", ")}`);
  }
  if (platformBioData) promptParts.push(`Music Platform Data: ${platformBioData}`);

  const vaultContext = contextualSources.map(s => {
    const parts = [`Source: ${s.title ?? s.url}`];
    if (s.snippet) parts.push(s.snippet);
    if (s.extractedText) parts.push(s.extractedText.slice(0, 2000));
    return parts.join(" — ");
  }).join("\n");
  promptParts.push(`\n--- SOURCES (synthesize the About ONLY from these + the verified data above; they are about this exact artist) ---\n${vaultContext}\n--- END SOURCES ---`);

  // The artist doc, when present, carries the artist's own words + curated story
  // hooks — highest-quality About material we have.
  const artistDoc = await getArtistDoc(artistId);
  if (artistDoc?.content) {
    promptParts.push(`\n--- ARTIST DOC (compiled with the artist during onboarding; interview quotes are their own words — quote, don't paraphrase) ---\n${artistDoc.content.slice(0, ARTIST_DOC_CONTEXT_CAP)}\n--- END ARTIST DOC ---`);
  }

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
        // Grounding-OFF synthesis measured ~8s; 15s is a generous cap that keeps
        // discovery(≤38s) + synthesis inside the route's 57s race and the 60s ceiling.
        setTimeout(() => reject(new Error('Gemini timeout')), 15000)
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
 * Simplified wrapper around generateArtistBio that returns just the bio string
 * (or null on failure). Used by updateArtistBio for admin-triggered regeneration.
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
