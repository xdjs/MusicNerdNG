import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { getArtistDocContext } from "@/server/utils/artistDocService";
import { byAuthority } from "@/lib/sourceAuthority";
import { selectPassages } from "@/server/utils/passageSelect";
import { getSocialCredits } from "@/server/utils/queries/socialCreditQueries";
import { creditedCollaborators, selfCredits } from "@/server/utils/socialCredits";

/** Per source. Roughly what the old flat slice cost, spent on the relevant
 *  paragraphs instead of the opening ones. */
const PASSAGE_BUDGET_CHARS = 2_400;
/** The artist's own words are the best material we have and the cheapest to
 *  include, but a feed yields hundreds; enough to be substantial, bounded so
 *  one artist's Instagram cannot crowd out every article about them. */
const MAX_STATEMENTS_IN_CONTEXT = 24;
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
        const passageStats: string[] = [];
        /** Concrete things we hold that a question could go at next. */
        const unexplored: string[] = [];
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
                    // The parts of this source that answer THIS question,
                    // rather than its first two thousand characters. We store
                    // up to fifty thousand, and the opening of an article is
                    // the masthead and the standfirst — the sentence about a
                    // particular record is usually thousands of characters in.
                    if (s.extractedText) {
                        const picked = selectPassages(s.extractedText, question, { budgetChars: PASSAGE_BUDGET_CHARS });
                        if (picked.text) parts.push(picked.text);
                        passageStats.push(`${picked.kept}/${picked.considered}`);
                    }
                    return parts.join(" — ");
                }).join("\n");
                contextParts.push(`\n--- VERIFIED SOURCES ---\n${vaultContext}\n--- END SOURCES ---`);
            }
        } catch (e) {
            console.error("[askArtist] Error fetching vault sources:", e);
        }

        // The artist's own captions: who they credited, and what they said.
        //
        // We have hundreds of these rows and the ask never opened the table —
        // it saw only whatever leaked through into the knowledge document. So
        // the thing an artist most wants a question answered from, their own
        // account of their own work, was the one source not being read.
        //
        // Credits are the collaboration graph in their words ("Mixing &
        // Mastering Engineer: @p3t3rango"), statements are everything else they
        // chose to say. Both quote the caption verbatim and carry the post they
        // came from, so an answer built on them is as citable as one built on
        // an article.
        try {
            const extraction = await getSocialCredits(artistId);
            const collaborators = creditedCollaborators(extraction);
            for (const c of collaborators.slice(0, 8)) {
                unexplored.push(`${c.isHandle ? "@" : ""}${c.subject}, credited as ${c.roles[0]}`);
            }
            if (collaborators.length > 0) {
                contextParts.push(`\n--- WHO ${artistName.toUpperCase()} HAS CREDITED, IN THEIR OWN CAPTIONS ---\n`
                    + collaborators.map(c => `${c.isHandle ? "@" : ""}${c.subject} — ${c.roles.join("; ")} (${c.evidenceUrls.length} post${c.evidenceUrls.length === 1 ? "" : "s"})`).join("\n"));
            }
            const own = selfCredits(extraction);
            if (own.length > 0) {
                contextParts.push(`\n--- WHAT ${artistName.toUpperCase()} SAYS THEY DO THEMSELVES ---\n`
                    + own.map(c => c.role).join(", "));
            }
            for (const s of extraction.statements.slice(0, 12)) unexplored.push(s.topic);
            if (extraction.statements.length > 0) {
                contextParts.push(`\n--- ${artistName.toUpperCase()} IN THEIR OWN WORDS ---\n`
                    + extraction.statements.slice(0, MAX_STATEMENTS_IN_CONTEXT)
                        .map(s => `${s.topic}: "${s.quote}" (${s.url})`).join("\n"));
            }
        } catch (e) {
            console.error("[askArtist] Error fetching caption credits:", e);
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
        // Follow-ups pointed at what has NOT been covered yet.
        //
        // These were a fixed list of fourteen strings with the artist's name
        // dropped in, filtered by word overlap and shuffled — so an artist
        // whose feed contains a bassist, a harpist and a story about why they
        // made a Christmas record got offered "What genre is X?".
        //
        // Grounded in the material the answer left on the table, and falling
        // back to the old list when there is nothing specific to reach for,
        // which is the right answer for an artist we know little about.
        const suggestions = await suggestFollowUps({
            artistName, question, answer, unexplored,
        }).catch(() => generateFollowUps(artistName, question, answer));

        // Only the sources the answer actually cited. Listing everything we
        // read would be provenance theatre: it looks like sourcing while
        // telling the reader nothing about THIS answer.
        const citedIds = new Set([...answer.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])));
        const sources = citable.filter(s => citedIds.has(s.n));

        // People the answer names, resolved to somewhere worth going.
        //
        // ONLY CREDITED COLLABORATORS. Not names lifted out of prose, and
        // explicitly not names from the artist's STATEMENTS — those include
        // people talked about rather than worked with. Pete Rango's statements
        // name his cousin André, who died. Turning a dead relative into a link
        // to whoever holds a matching handle because two strings matched is the
        // kind of thing this restriction exists to make impossible.
        //
        // Same discipline as the citations: only link what we can back.
        const mentions = await resolveMentions(artistId, answer);

        return Response.json({ answer, suggestions, sources, mentions });
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

/**
 * Ask the model for follow-ups it can actually answer.
 *
 * The material list is the point: a suggestion is only worth offering if the
 * next answer will be good, and the next answer is good when it rests on
 * something we hold. Anything already covered by this answer is filtered out
 * afterwards rather than in the prompt, because a model told to avoid a topic
 * will circle it.
 */
async function suggestFollowUps(input: {
    artistName: string;
    question: string;
    answer: string;
    unexplored: string[];
}): Promise<string[]> {
    const { artistName, question, answer, unexplored } = input;
    if (unexplored.length === 0) return generateFollowUps(artistName, question, answer);

    const res = await getGemini().models.generateContent({
        model: GEMINI_MODEL_FLASH,
        contents: `THINGS WE KNOW ABOUT ${artistName} AND HAVE NOT DISCUSSED:\n${unexplored.slice(0, 20).map(u => `- ${u}`).join("\n")}\n\nJUST ASKED: ${question}\n\nJUST ANSWERED: ${answer.slice(0, 1200)}`,
        config: {
            systemInstruction: `Write 4 short follow-up questions a curious listener would ask next about ${artistName}.

- Each must be answerable from the material listed. Do not ask about anything not on that list.
- Do not repeat what the answer already covered.
- Name the specific thing — a person, a record, a moment. "Who has ${artistName} worked with?" is worse than "What did @dameatlas bring to that record?" every time.
- Short, spoken, no preamble.

Return STRICT JSON: an array of 4 strings. No markdown, no commentary.`,
            temperature: 0.4,
            responseMimeType: "application/json",
        },
    });

    const parsed = JSON.parse((res.text ?? "[]").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    const list = Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string" && s.length > 8) : [];
    // A suggestion answered by the text in front of them is not a follow-up.
    const covered = answer.toLowerCase();
    const fresh = list.filter(s => {
        const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 4);
        return words.length === 0 || words.some(w => !covered.includes(w));
    });
    return (fresh.length >= 2 ? fresh : list).slice(0, 4);
}

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

export type AnswerMention = {
    /** Exactly as it appears in the answer, so the client can match it. */
    name: string;
    /** A Music Nerd artist, when they are one. */
    artistId?: string;
    /** Otherwise their instagram handle, if the credit carried one. */
    instagram?: string;
    /** How the artist described what they did. */
    role?: string;
};

/**
 * Which credited collaborators the answer actually names.
 *
 * Matching is whole-word and case-insensitive over the handle and the subject
 * as written. A substring match here would relink "Art" inside "started" — the
 * same failure the caption verification had, one layer up and far more visible.
 */
async function resolveMentions(artistId: string, answer: string): Promise<AnswerMention[]> {
    try {
        const { getSocialCredits } = await import("@/server/utils/queries/socialCreditQueries");
        const { creditedCollaborators } = await import("@/server/utils/socialCredits");
        const { findArtistsByInstagram } = await import("@/server/utils/queries/artistQueries");

        const collaborators = creditedCollaborators(await getSocialCredits(artistId));
        if (collaborators.length === 0) return [];

        const named = collaborators.filter(c => {
            const needle = c.subject.replace(/^@/, "");
            if (needle.length < 3) return false;
            return new RegExp(`(^|[^\\p{L}\\p{N}_@])@?${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}_]|$)`, "iu").test(answer);
        });
        if (named.length === 0) return [];

        // A collaborator who is already an artist here is worth a profile link;
        // one who is not is a person who probably should be, which is a
        // discovery list as much as a navigation aid.
        const handles = named.filter(c => c.isHandle).map(c => c.subject.toLowerCase());
        const known = handles.length > 0 ? await findArtistsByInstagram(handles) : [];
        const byHandle = new Map(known.map(a => [String(a.instagram ?? "").toLowerCase().replace(/^@/, ""), a.id]));

        return named.map(c => ({
            name: c.subject,
            artistId: c.isHandle ? byHandle.get(c.subject.toLowerCase()) : undefined,
            instagram: c.isHandle ? c.subject : undefined,
            role: c.roles[0],
        }));
    } catch (e) {
        console.error("[askArtist] Could not resolve mentions:", e);
        return [];
    }
}
