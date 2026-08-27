import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { getArtistDocContext } from "@/server/utils/artistDocService";
import { byAuthority } from "@/lib/sourceAuthority";
import { isRealBio } from "@/lib/bioConstants";

// PUBLIC ENDPOINT — intentionally unauthenticated (rate-limited via middleware STRICT tier).
//
// Approved vault sources are treated as PUBLIC content for Q&A — their snippets and the
// first 2000 chars of extractedText flow into the answer context that any visitor can see.
//
// ⚠️ When approving a vault source in admin, treat it as public the moment it's approved.
//   Do NOT approve press kits, contracts, drafts, or anything else meant to stay internal.
//   If we ever need to store internal-only sources, add an isPublic flag on vault sources
//   and filter on it here instead of adding auth (which would break the Q&A feature).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const startTime = performance.now();

    try {
        const { artistId, question } = await req.json();

        if (!artistId || typeof artistId !== "string") {
            return Response.json({ error: "Missing artistId" }, { status: 400 });
        }
        if (!question || typeof question !== "string" || question.trim().length === 0) {
            return Response.json({ error: "Missing question" }, { status: 400 });
        }
        if (question.length > 500) {
            return Response.json({ error: "Question too long (max 500 chars)" }, { status: 400 });
        }

        const artist = await getArtistById(artistId);
        if (!artist) {
            return Response.json({ error: "Artist not found" }, { status: 404 });
        }

        const artistName = artist.name ?? "Unknown Artist";

        // Build context from artist data + vault sources
        const contextParts: string[] = [];
        if (artist.spotify) contextParts.push(`Spotify ID: ${artist.spotify}`);
        if (artist.instagram) contextParts.push(`Instagram: @${artist.instagram}`);
        if (artist.x) contextParts.push(`X/Twitter: @${artist.x}`);
        if (artist.soundcloud) contextParts.push(`SoundCloud: ${artist.soundcloud}`);
        if (artist.youtube) contextParts.push(`YouTube: @${artist.youtube?.replace(/^@/, "")}`);
        // Reference databases, when we hold them. Not for reciting a discography
        // — Spotify and Deezer already give us the catalogue — but because they
        // are where an artist's CREDITS live: the records they played on, mixed
        // or produced for somebody else. That work is invisible everywhere else
        // and it is often most of what a producer has actually done.
        if (artist.discogs) contextParts.push(`Discogs: https://www.discogs.com/artist/${artist.discogs} (credits on other artists' releases)`);
        if (artist.musicbrainz) contextParts.push(`MusicBrainz: https://musicbrainz.org/artist/${artist.musicbrainz}`);
        // Skip the claim-nudge empty-state — it isn't a real bio, so don't feed it back as context.
        if (isRealBio(artist.bio)) contextParts.push(`\nExisting bio:\n${artist.bio}`);

        // Include approved vault sources
        // Kept as {title, url} rather than bare urls: the answer has to be able
        // to SAY where something came from, and "voyagemia.com" means more to a
        // reader than a bare link, which is the whole point of showing it.
        const vaultUrls: string[] = [];
        const citable: { n: number; title: string; url: string }[] = [];
        try {
            const vaultSources = await getVaultSourcesByArtistId(artistId, "approved");
            if (vaultSources.length > 0) {
                const ranked = byAuthority(vaultSources, s => ({ url: s.url ?? "", type: null }));
                const vaultContext = ranked.map(s => {
                    if (s.url) vaultUrls.push(s.url);
                    const n = citable.length + 1;
                    if (s.url) citable.push({ n, title: s.title ?? s.url, url: s.url });
                    const parts = [`[${n}] Source: ${s.title ?? s.url}`];
                    if (s.snippet) parts.push(s.snippet);
                    if (s.extractedText) parts.push(s.extractedText.slice(0, 2000));
                    return parts.join(" — ");
                }).join("\n");
                contextParts.push(`\n--- VERIFIED SOURCES ---\n${vaultContext}\n--- END SOURCES ---`);
            }
        } catch (e) {
            console.error("[askArtist] Error fetching vault sources:", e);
        }

        // Artist doc (post-claim onboarding knowledgebase) — capped slice, ground truth
        // like the vault sources. Interview quotes inside it are the artist's own words.
        try {
            const docContext = await getArtistDocContext(artistId);
            if (docContext) {
                contextParts.push(`\n--- ARTIST DOC (compiled with the artist; treat as ground truth) ---\n${docContext}\n--- END ARTIST DOC ---`);
            }
        } catch (e) {
            console.error("[askArtist] Error fetching artist doc:", e);
        }

        const artistContext = contextParts.join("\n");

        const response = await Promise.race([
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: `Question about the music artist "${artistName}": ${question.trim()}`,
                config: {
                    systemInstruction: `You answer questions about the music artist "${artistName}". Write like a sharp music writer: concrete, specific, no filler.

- Answer in 2-4 sentences unless the question genuinely needs more. Don't pad.
- The verified sources below are ground truth — prioritize them.
- CITE THEM. Each verified source is numbered; put its [n] marker immediately after any sentence that uses it. A reader has no way to tell a researched fact from an invented one unless you show your work, and this product is asking them to trust it.
- Never invent a marker, and never cite a number you were not given.
- For any fact not in the verified sources, prefix it with "According to public sources, " so the reader knows where it came from.
- Name songs, projects, dates, and collaborators when you know them. Let specifics do the work, not adjectives.
- No hype phrases ("rising star", "eclectic", "undeniable", "pushing boundaries").
- If you don't know, say so in one line rather than guessing.
- No social media links in your answers.
- Never fabricate credits, collaborations, or achievements.

ARTIST CONTEXT:
${artistContext}`,
                    tools: [{ googleSearch: {} }],
                    temperature: 0.5,
                },
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Gemini timeout")), 20000)
            ),
        ]);

        const answer = response.text ?? "";
        const durationMs = Math.round(performance.now() - startTime);
        console.debug(`[askArtist] "${artistName}" — "${question.slice(0, 60)}" — ${durationMs}ms`);

        // Generate contextual follow-up suggestions based on the answer
        const suggestions = generateFollowUps(artistName, question, answer);

        // Only the sources the answer actually cited. Listing everything we
        // read would be provenance theatre: it looks like sourcing while
        // telling the reader nothing about THIS answer.
        const citedIds = new Set([...answer.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])));
        const sources = citable.filter(s => citedIds.has(s.n));

        return Response.json({ answer, suggestions, sources });
    } catch (err: any) {
        console.error("[askArtist] Error:", err);
        if (err.message === "Gemini timeout") {
            return Response.json({ error: "Request timed out. Try again." }, { status: 408 });
        }
        return Response.json({ error: "Failed to get answer" }, { status: 500 });
    }
}

/**
 * Generate contextual follow-up suggestion chips.
 * Template-based — no extra API call needed.
 */
function generateFollowUps(artistName: string, question: string, answer: string): string[] {
    const allSuggestions = [
        `What's ${artistName}'s latest project?`,
        `Who has ${artistName} collaborated with?`,
        `How did ${artistName} get started in music?`,
        `What genre is ${artistName}?`,
        `What is ${artistName} known for?`,
        `Where is ${artistName} from?`,
        `What are ${artistName}'s biggest songs?`,
        `Tell me something surprising about ${artistName}`,
        `What awards has ${artistName} won?`,
        `What influences ${artistName}'s sound?`,
        `Has ${artistName} toured recently?`,
        `What labels has ${artistName} worked with?`,
        `What's ${artistName}'s creative process like?`,
        `How has ${artistName}'s style evolved?`,
    ];

    // Filter out suggestions similar to the question already asked
    const questionLower = question.toLowerCase();
    const filtered = allSuggestions.filter(s => {
        const sLower = s.toLowerCase();
        // Simple overlap check — skip if >50% of words match
        const qWords = new Set(questionLower.split(/\s+/));
        const sWords = sLower.split(/\s+/);
        const overlap = sWords.filter(w => qWords.has(w)).length;
        return overlap / sWords.length < 0.5;
    });

    // Return 4 random suggestions
    const shuffled = filtered.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 4);
}
