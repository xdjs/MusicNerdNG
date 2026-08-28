import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { getArtistDocContext } from "@/server/utils/artistDocService";
import { byAuthority, isBlockedSourceHost } from "@/lib/sourceAuthority";
import { selectPassages } from "@/server/utils/passageSelect";
import { getSocialCredits } from "@/server/utils/queries/socialCreditQueries";
import { getRecentOwnPosts } from "@/server/utils/socialIngest";
import { getSpotifyCatalogDetail, getSpotifyHeaders } from "@/server/utils/queries/externalApiQueries";
import { creditedCollaborators, selfCredits } from "@/server/utils/socialCredits";

/** Per source. Roughly what the old flat slice cost, spent on the relevant
 *  paragraphs instead of the opening ones. */
const PASSAGE_BUDGET_CHARS = 2_400;
/** The artist's own words are the best material we have and the cheapest to
 *  include, but a feed yields hundreds; enough to be substantial, bounded so
 *  one artist's Instagram cannot crowd out every article about them. */
const MAX_STATEMENTS_IN_CONTEXT = 24;
/** The answer is already written when this runs, so it gets what is left of a
 *  reader's patience and no more. */
const FOLLOWUP_TIMEOUT_MS = 4_000;
/** Enough to cover "lately" without spending the prompt on a year of feed. */
const MAX_RECENT_POSTS = 12;
/** Enough to answer "what is the latest" and "what should I hear". */
const MAX_RELEASES_IN_CONTEXT = 12;
/** Pete Rango has 209 credited collaborators. Numbering all of them produced
 *  source markers in the hundreds and a prompt mostly made of names. */
const MAX_COLLABORATORS_IN_CONTEXT = 20;
/** The fallback runs only when we already failed, so it gets what is left of
 *  a reader's patience. */
const GROUNDED_TIMEOUT_MS = 15_000;
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
        // Bandcamp, Deezer and Linktree were simply missing, so an answer could
        // never say "you can buy it on Bandcamp" — it did not know one existed.
        // Given as URLs rather than bare handles, so the answer can offer a
        // place to listen instead of reciting an identifier.
        if (artist.bandcamp) contextParts.push(`Bandcamp (buy/listen): https://${artist.bandcamp}.bandcamp.com`);
        if (artist.deezer) contextParts.push(`Deezer: https://www.deezer.com/artist/${artist.deezer}`);
        if (artist.linktree) contextParts.push(`Linktree: https://linktr.ee/${artist.linktree}`);
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

        // THE CATALOGUE, with dates.
        //
        // getSpotifyCatalogDetail exists and the ask never called it, so
        // "what is their latest release" was unanswerable from the one source
        // that actually knows. Context, NOT a discography to recite: the
        // artist's own Spotify link stays current and a generated copy goes
        // stale the day they release something.
        try {
            if (artist.spotify) {
                const headers = await getSpotifyHeaders();
                const releases = await getSpotifyCatalogDetail(artist.spotify, headers);
                if (releases.length > 0) {
                    const dated = releases
                        .filter(r => r.releaseDate)
                        .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""))
                        .slice(0, MAX_RELEASES_IN_CONTEXT);
                    if (dated.length > 0) {
                        // NUMBERED, like everything else the prompt asks to be
                        // cited. Without a marker, a question answered purely
                        // from the catalogue — "what is their latest release?"
                        // — came back with no source pill and the label
                        // "AI-generated response", which is exactly wrong: it
                        // is the best-sourced answer we can give. One number
                        // for the catalogue rather than one per release, so an
                        // answer naming three records does not produce three
                        // pills pointing at the same page.
                        const n = citable.length + 1;
                        citable.push({
                            n,
                            title: `${artistName}'s catalogue on Spotify`,
                            url: `https://open.spotify.com/artist/${artist.spotify}`,
                        });
                        contextParts.push(`\n--- [${n}] ${artistName.toUpperCase()}'S RELEASES, NEWEST FIRST (from Spotify) ---\n`
                            + dated.map(r => `${r.releaseDate} — "${r.name}"${r.kind ? ` (${r.kind})` : ""}`).join("\n")
                            + `\nCite these as [${n}].`);
                    }
                }
            }
        } catch (e) {
            console.error("[askArtist] Error fetching catalogue:", e);
        }

        // THE POSTS THEMSELVES, newest first.
        //
        // Everything below this reads what was EXTRACTED from the feed — the
        // durable facts, deliberately not time-ordered. None of it can answer
        // "what have they been up to lately", which is the most obvious
        // question anyone asks. That needs the posts.
        try {
            const recent = await getRecentOwnPosts(artistId, MAX_RECENT_POSTS);
            if (recent.length > 0) {
                const lines = recent.map(p => {
                    const n = citable.length + 1;
                    const when = p.postedAt ? p.postedAt.slice(0, 10) : "undated";
                    citable.push({ n, title: `${artistName} on Instagram, ${when}`, url: p.url });
                    const caption = (p.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
                    return `[${n}] ${when} — "${caption}"`;
                });
                contextParts.push(`\n--- ${artistName.toUpperCase()}'S RECENT POSTS, NEWEST FIRST ---\n${lines.join("\n")}`);
            }
        } catch (e) {
            console.error("[askArtist] Error fetching recent posts:", e);
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
                const lines = collaborators.slice(0, MAX_COLLABORATORS_IN_CONTEXT).map(c => {
                    const n = citable.length + 1;
                    citable.push({
                        n,
                        title: `${artistName} credits ${c.isHandle ? "@" : ""}${c.subject} — ${c.roles.join("; ")}`,
                        url: c.evidenceUrls[0],
                    });
                    return `[${n}] ${c.isHandle ? "@" : ""}${c.subject} — ${c.roles.join("; ")} (${c.evidenceUrls.length} post${c.evidenceUrls.length === 1 ? "" : "s"})`;
                });
                contextParts.push(`\n--- WHO ${artistName.toUpperCase()} HAS CREDITED, IN THEIR OWN CAPTIONS ---\n${lines.join("\n")}`);
            }
            const own = selfCredits(extraction);
            if (own.length > 0) {
                // Numbered like the rest. Statements and collaborators became
                // citable and these did not, so an answer about what the artist
                // does themselves still came back with no source pill.
                const lines = own.map(c => {
                    const n = citable.length + 1;
                    citable.push({ n, title: `${artistName} on their own role — ${c.role}`, url: c.url });
                    return `[${n}] ${c.role}`;
                });
                contextParts.push(`\n--- WHAT ${artistName.toUpperCase()} SAYS THEY DO THEMSELVES ---\n${lines.join("\n")}`);
            }
            for (const s of extraction.statements.slice(0, 12)) unexplored.push(s.topic);
            if (extraction.statements.length > 0) {
                // NUMBERED like any other source. Without this an answer built
                // entirely from the artist's own captions — the best evidence
                // we have about them — came back with no pills and the words
                // "AI-generated response", which is the exact impression the
                // citations exist to correct.
                const lines = extraction.statements.slice(0, MAX_STATEMENTS_IN_CONTEXT).map(s => {
                    const n = citable.length + 1;
                    citable.push({ n, title: `Their own words — ${s.topic}`, url: s.url });
                    const when = s.postedAt ? ` (${s.postedAt.slice(0, 10)})` : "";
                    return `[${n}]${when} ${s.topic}: "${s.quote}"`;
                });
                contextParts.push(`\n--- ${artistName.toUpperCase()} IN THEIR OWN WORDS ---\n${lines.join("\n")}`);
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
- The verified sources below are ground truth — prioritize them. That includes the artist's own captions, which are quoted verbatim and are the best evidence about them that exists.
- CITE THEM. Each verified source is numbered; put its [n] marker immediately after any sentence that uses it. A reader has no way to tell a researched fact from an invented one unless you show your work, and this product is asking them to trust it.
- A marker is a NUMBER in square brackets and nothing else. "[Bandcamp]" or "[Instagram]" is not a citation; cite the numbered source, or name the platform in plain words with no brackets.
- Never invent a marker, and never cite a number you were not given.
- Use what you were given. Releases, recent posts, credits and the artist's own words are all above; a question about their latest release, their collaborators or what they have been doing is answerable from them.
- ONLY if the sources contain nothing relevant at all, reply with EXACTLY the single word INSUFFICIENT and nothing else. Do not guess, and do not answer from general knowledge — something else handles that case. Answering thinly from unrelated sources is worse than saying we do not have it.
- Name songs, projects, dates, and collaborators when you know them. Let specifics do the work, not adjectives.
- No hype phrases ("rising star", "eclectic", "undeniable", "pushing boundaries").
- If you don't know, say so in one line rather than guessing.
- No social media links in your answers.
- Never fabricate credits, collaborations, or achievements.

ARTIST CONTEXT:
${artistContext}`,
                    // NO GROUNDING HERE, deliberately. Google Search grounding
                    // suppresses custom [n] markers entirely — measured: the same
                    // prompt and sources emit "[1] [3] [2]" with it off and
                    // nothing at all with it on. This call answers from what we
                    // hold and cites it; the grounded fallback below handles
                    // questions we cannot answer.
                    temperature: 0.5,
                },
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Gemini timeout")), 20000)
            ),
        ]);

        let answer = (response.text ?? "").trim();
        /** True when this answer came from the open web rather than from us. */
        let fromOpenWeb = false;
        /** Domains Google actually used, when it did. */
        let webDomains: string[] = [];

        // OUR SOURCES DID NOT COVER IT — go outside, and say so.
        //
        // Grounding is asked for only here, because it cannot coexist with our
        // citations. The cost is a second call on questions we cannot answer,
        // which is also a useful signal: a high fallback rate for an artist
        // means our research on them is thin.
        //
        // THE BLOCKLIST REACHES THIS SURFACE TOO. The vault refuses scrape
        // farms; without the checks below this path would happily answer from
        // one and name it underneath, which is the same page on the same
        // artist's screen by a different route. Pete's instruction was that he
        // does not want them anywhere.
        if (/^INSUFFICIENT\b/i.test(answer) || answer.length === 0) {
            const grounded = await Promise.race([
                getGemini().models.generateContent({
                    model: GEMINI_MODEL_FLASH,
                    contents: question,
                    config: {
                        systemInstruction: `You answer questions about the music artist "${artistName}". Write like a sharp music writer: concrete, specific, no filler. Answer in 2-4 sentences. No hype phrases. If you do not know, say so in one line rather than guessing. Never fabricate credits, collaborations or achievements. Rely on publications, the artist's own pages and credits databases. Do not rely on streaming-stat dashboards, follower counters, chart scrapers or catalogue-listing sites — they carry no reporting and saying "I don't know" is better than repeating one.`,
                        tools: [{ googleSearch: {} }],
                        temperature: 0.4,
                    },
                }),
                new Promise<null>(resolve => setTimeout(() => resolve(null), GROUNDED_TIMEOUT_MS)),
            ]).catch(() => null);

            answer = (grounded?.text ?? "").trim();
            fromOpenWeb = answer.length > 0;
            // What it actually used, so a grounded answer still shows provenance.
            //
            // `web.title` on a Google-grounded chunk is the registrable domain,
            // not a page title — measured: "stereogum.com", "peterango.com",
            // "reddit.com". So the same host check the vault uses applies here
            // directly, and there is no page URL to check instead: `web.uri` is
            // an opaque vertexaisearch redirect.
            const chunks = (grounded as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: string } }> } }> } | null)
                ?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
            const domains = [...new Set(chunks.map(c => c.web?.title).filter((d): d is string => !!d))];
            const usable = domains.filter(d => !isBlockedSourceHost(`https://${d}`));
            webDomains = usable.slice(0, 6);

            // Grounded ONLY on sites with no author. Dropping the pill and
            // keeping the answer would be worse than either: the claim still
            // came from a scrape, and hiding where it came from is how an
            // unsourced sentence ends up looking like reporting.
            if (domains.length > 0 && usable.length === 0) {
                console.log(`[askArtist] Grounded only on blocked hosts (${domains.join(", ")}) — abstaining`);
                answer = "";
                fromOpenWeb = false;
            }

            if (!answer) {
                answer = `I don't have anything on that for ${artistName} yet.`;
                fromOpenWeb = false;
            }
        }
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
        // Raced against a short deadline. The answer is already written by
        // this point and these are a nicety; a stalled second model call must
        // not withhold a usable answer until the platform gives up.
        //
        // Started here and awaited below, alongside mention resolution. These
        // were sequential, so a reader waited for the suggestion chips and THEN
        // for a database round trip before seeing a word of the answer. Neither
        // needs the other; both need only the answer.
        const suggestionsPromise = Promise.race([
            suggestFollowUps({ artistName, question, answer, unexplored }),
            new Promise<string[]>(resolve =>
                setTimeout(() => resolve(generateFollowUps(artistName, question, answer)), FOLLOWUP_TIMEOUT_MS)),
        ]).catch(() => generateFollowUps(artistName, question, answer));

        // Only the sources the answer actually cited. Listing everything we
        // read would be provenance theatre: it looks like sourcing while
        // telling the reader nothing about THIS answer.
        // The model writes "[1]", "[13, 8, 86]" and occasionally "[2026-05-13]".
        // Only the first two are citations; a date in brackets is the model
        // inventing a marker shape, and matching it would map a year to a
        // source number.
        const citedIds = new Set<number>();
        for (const m of answer.matchAll(/\[([^\]]+)\]/g)) {
            const body = m[1];
            if (/\d{4}-\d{2}/.test(body)) continue;      // a date, not a citation
            // Mixed groups are common — "[1, Releases]", "[19, 21, Artist Doc]".
            // Take the numbers and ignore the prose rather than dropping the
            // whole citation, which is how a real source stopped being shown.
            for (const part of body.split(",")) {
                const n = Number(part.trim());
                if (Number.isInteger(n) && n > 0) citedIds.add(n);
            }
        }
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
        const [suggestions, mentions] = await Promise.all([
            suggestionsPromise,
            resolveMentions(artistId, answer),
        ]);

        return Response.json({
            answer, suggestions, sources, mentions,
            // The reader must be able to tell "this is from Pete's own posts
            // and his vault" from "this is from the open web".
            fromOpenWeb, webDomains,
        });
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
            // Writing four short questions from a list is formatting, not
            // reasoning, and the default thinking budget was costing seconds on
            // the critical path — the answer was ready and the reader was
            // watching "Thinking..." while the model deliberated over chips it
            // had not been asked for.
            thinkingConfig: { thinkingBudget: 0 },
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

        // MATCH THE NAME AS WRITTEN, not only the handle as stored.
        //
        // An answer says "Dame Atlas" and "Alan Zavodsky"; we hold `dameatlas`
        // and `zavodskyalan`. Matching the raw handle found two of the eight
        // people named in a real answer. Compare on letters and digits only, so
        // a handle matches the spaced-out name a writer would actually use, and
        // try the reversed word order because handles often invert it.
        const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const foldedAnswer = fold(answer);
        const named = collaborators.filter(c => {
            const needle = fold(c.subject);
            if (needle.length < 4) return false;
            if (foldedAnswer.includes(needle)) return true;
            // zavodskyalan -> alanzavodsky
            const parts = c.subject.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
            if (parts.length > 1 && foldedAnswer.includes(fold([...parts].reverse().join("")))) return true;
            return false;
        });
        if (named.length === 0) return [];

        // A collaborator who is already an artist here is worth a profile link;
        // one who is not is a person who probably should be, which is a
        // discovery list as much as a navigation aid.
        const handles = named.filter(c => c.isHandle).map(c => c.subject.toLowerCase());
        const known = handles.length > 0 ? await findArtistsByInstagram(handles) : [];
        const byHandle = new Map(known.map(a => [String(a.instagram ?? "").toLowerCase().replace(/^@/, ""), a.id]));

        // Hand back the string as it appears IN THE ANSWER where we can find
        // it, so the client links the words a reader is actually looking at
        // rather than a handle that never appears on screen.
        const asWritten = (subject: string): string => {
            const needle = fold(subject);
            // Scan word windows of one to three words and return the span that
            // folds to the handle. The previous version sliced a split-with-
            // separators array by the wrong stride and returned fragments like
            // " Dame Atlas" and "Chas".
            const words = [...answer.matchAll(/[\p{L}\p{N}_]+/gu)];
            for (let i = 0; i < words.length; i++) {
                for (let span = 1; span <= 3 && i + span <= words.length; span++) {
                    const start = words[i].index ?? 0;
                    const last = words[i + span - 1];
                    const end = (last.index ?? 0) + last[0].length;
                    const phrase = answer.slice(start, end);
                    if (fold(phrase) === needle) return phrase;
                }
            }
            return subject;
        };

        // A HANDLE, or nothing.
        //
        // The extraction files anything credited with a role, and a role can be
        // a life story: Pete Rango's cousin André, who died, is stored as a
        // credit with the role "introduced him to music". There is nowhere to
        // send a reader who clicks his name, and turning him into a link would
        // be grotesque. Requiring a handle removes him and every other bare
        // name without us having to judge which names are appropriate.
        return named
            .filter(c => c.isHandle)
            .map(c => ({
                name: asWritten(c.subject),
                artistId: byHandle.get(c.subject.toLowerCase()),
                instagram: c.subject,
                role: c.roles[0],
            }));
    } catch (e) {
        console.error("[askArtist] Could not resolve mentions:", e);
        return [];
    }
}
