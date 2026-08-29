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
/** Enough for "what have they released lately"; past this an answer is a
 *  discography rather than a sentence. */
const MAX_SONGS_LINKED = 8;
/** Pete Rango has 209 credited collaborators. Numbering all of them produced
 *  source markers in the hundreds and a prompt mostly made of names. */
const MAX_COLLABORATORS_IN_CONTEXT = 20;
/** Everything an artist has told us directly is worth carrying; the cap is
 *  only there so a prolific interviewee cannot crowd out the rest. */
const MAX_INTERVIEW_IN_CONTEXT = 12;
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
        // Include approved vault sources
        // Kept as {title, url} rather than bare urls: the answer has to be able
        // to SAY where something came from, and "voyagemia.com" means more to a
        // reader than a bare link, which is the whole point of showing it.
        const vaultUrls: string[] = [];
        const citable: { n: number; title: string; url: string }[] = [];
        /** The artist's releases, kept past the prompt so the answer's own
         *  words can be matched against real records afterwards. */
        let catalogue: { name: string; releaseDate: string | null; kind: string | null; url: string | null }[] = [];

        // NUMBERED, because these are the answer to a real question. "Where can
        // I buy their music" is answered entirely from these lines, and
        // unnumbered they produced no pill and the label "AI-generated
        // response" — presenting a link we hold on file as though we made it
        // up. Only the URL-shaped entries: a bare handle is identity, not a
        // place, and the posts behind it are already citable on their own.
        //
        // Bandcamp, Deezer and Linktree were simply missing before this, so an
        // answer could never say "you can buy it on Bandcamp" — it did not know
        // one existed. Discogs and MusicBrainz are here for a different reason:
        // not for reciting a discography, which Spotify and Deezer already
        // give us, but because they are where an artist's CREDITS live — the
        // records they played on, mixed or produced for somebody else. That
        // work is invisible everywhere else and is often most of what a
        // producer has actually done.
        const destinations: [string, string | null | undefined, string][] = [
            ["Bandcamp (buy/listen)", artist.bandcamp && `https://${artist.bandcamp}.bandcamp.com`, `${artistName} on Bandcamp`],
            ["Deezer", artist.deezer && `https://www.deezer.com/artist/${artist.deezer}`, `${artistName} on Deezer`],
            ["Linktree", artist.linktree && `https://linktr.ee/${artist.linktree}`, `${artistName}'s Linktree`],
            ["Discogs (credits on other artists' releases)", artist.discogs && `https://www.discogs.com/artist/${artist.discogs}`, `${artistName} on Discogs`],
            ["MusicBrainz", artist.musicbrainz && `https://musicbrainz.org/artist/${artist.musicbrainz}`, `${artistName} on MusicBrainz`],
        ];
        for (const [label, url, title] of destinations) {
            if (!url) continue;
            const n = citable.length + 1;
            citable.push({ n, title, url });
            contextParts.push(`[${n}] ${label}: ${url}`);
        }

        // Skip the claim-nudge empty-state — it isn't a real bio, so don't feed it back as context.
        if (isRealBio(artist.bio)) contextParts.push(`\nExisting bio:\n${artist.bio}`);
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
                    catalogue = dated;
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

            // THE INTERVIEW. The one part of this page the artist wrote on
            // purpose, and the ask never read it — it arrived second-hand
            // through the knowledge document, so an answer could not cite what
            // they actually said as a source of its own.
            //
            // Numbered like everything else, but with no url: there is nowhere
            // to send a reader except back to this page. The client renders a
            // citation without a link rather than pretending there is one.
            try {
                const { getInterviewAnswers } = await import("@/server/utils/queries/onboardingQueries");
                // NEWEST FIRST. getInterviewAnswers orders oldest-first, so
                // slicing kept the oldest twelve — an artist who kept talking
                // to us had every later answer dropped while their first ones
                // stayed, and the ask went on citing stale material.
                const answered = (await getInterviewAnswers(artistId) ?? [])
                    .filter(a => a.answer)
                    .sort((x, y) => String(y.createdAt ?? "").localeCompare(String(x.createdAt ?? "")));
                if (answered.length > 0) {
                    const lines = answered.slice(0, MAX_INTERVIEW_IN_CONTEXT).map(a => {
                        const n = citable.length + 1;
                        citable.push({ n, title: `${artistName}, asked "${a.question}"`, url: "" });
                        return `[${n}] Asked: ${a.question}\n    They said: "${a.answer}"`;
                    });
                    contextParts.push(
                        `\n--- ${artistName.toUpperCase()} ANSWERING US DIRECTLY (their own words, given on purpose — treat as ground truth and prefer it over anything inferred) ---\n`
                        + lines.join("\n"),
                    );
                    // A fan's next question should be able to go at something
                    // the artist actually chose to tell us.
                    for (const a of answered.slice(0, 6)) unexplored.push(`their answer about: ${a.question}`);
                }
            } catch (e) {
                console.error("[askArtist] Could not read interview answers:", e);
            }
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
            resolveMentions(artistId, answer, artistContext),
        ]);

        // Records the answer names that we can prove are theirs.
        //
        // Matched against the CATALOGUE rather than guessed from the prose: a
        // quoted phrase is as likely to be a lyric, a nickname or a project as
        // a release, and "we hold this record under this artist's Spotify id"
        // is the only evidence that settles it. Where else you can hear it is
        // resolved when a reader taps the title, not now — two lookups a song
        // is most of a second added to every answer for links most people
        // never open.
        const songs = catalogue
            .filter(r => r.url && namedInAnswer(answer, r.name))
            // `kind` travels with it. An album is not a song, and the provider
            // lookup needs different endpoints for the two — without this an
            // answer naming a record found no Apple link at all, and Spotify's
            // catalogue is mostly albums.
            .map(r => ({
                title: r.name,
                spotifyUrl: r.url as string,
                kind: r.kind === "single" ? "single" : "album",
            }))
            .slice(0, MAX_SONGS_LINKED);

        return Response.json({
            answer, suggestions, sources, mentions, songs,
            // The artist's store, for the "where can I hear this" menu under a
            // record. Bandcamp has no API, so this is their page and is
            // labelled as their page.
            bandcamp: artist.bandcamp ? `https://${artist.bandcamp}.bandcamp.com` : null,
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
async function resolveMentions(artistId: string, answer: string, context: string): Promise<AnswerMention[]> {
    try {
        const { getSocialCredits } = await import("@/server/utils/queries/socialCreditQueries");
        const { creditedCollaborators } = await import("@/server/utils/socialCredits");
        const { findArtistsByInstagram, findUniqueArtistsByName } = await import("@/server/utils/queries/artistQueries");

        // NO EARLY RETURN WHEN THERE ARE NO CAPTION CREDITS. This used to bail
        // here and again below when none of them were named — which meant the
        // directory pass, the only thing that can link someone we have no
        // Instagram handle for, never ran for an artist whose feed we have not
        // read. That is most artists on day one.
        const collaborators = creditedCollaborators(await getSocialCredits(artistId));

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
            // zavodskyalan -> alanzavodsky.
            //
            // The reversal used to split the SUBJECT on separators, which a
            // handle does not have: `zavodskyalan` is one part, so the reversal
            // never fired and Alan Zavodsky went unlinked in an answer that
            // named him as a production partner. Splitting at every position
            // instead catches the whole class of surname-first handles. A false
            // positive needs the full concatenation to appear in the answer,
            // which is a high bar.
            for (let i = 4; i <= needle.length - 4; i++) {
                if (foldedAnswer.includes(needle.slice(i) + needle.slice(0, i))) return true;
            }
            return false;
        });

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
            // EVERY SPELLING THE FILTER WOULD HAVE ACCEPTED, not just the
            // stored one. The filter accepts `zavodskyalan` because the answer
            // says "Alan Zavodsky"; this then looked for a phrase folding to
            // `zavodskyalan`, found none, and returned the raw handle — which
            // the client cannot find in the answer, so the collaborator the
            // filter just accepted stayed unlinked.
            const base = fold(subject);
            const accepted = new Set([base]);
            for (let i = 4; i <= base.length - 4; i++) {
                accepted.add(base.slice(i) + base.slice(0, i));
            }
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
                    if (accepted.has(fold(phrase))) return phrase;
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
        const fromCredits = named
            .filter(c => c.isHandle)
            .map(c => ({
                name: asWritten(c.subject),
                artistId: byHandle.get(c.subject.toLowerCase()),
                instagram: c.subject,
                role: c.roles[0],
            }));

        // AND ANYONE ELSE IN THE DIRECTORY THE ANSWER NAMES.
        //
        // The block above can only link people we hold an Instagram handle
        // for — a caption credit. Most of the people an answer names arrive
        // from the vault and the document instead: Nia Sultana, Kilo Kish,
        // Jesse Boykins III were all plain text next to a linked Dame Atlas,
        // which reads like a bug rather than a rule.
        const already = new Set(fromCredits.map(m => fold(m.name)));
        // A ONE-WORD NAME NEEDS CORROBORATION.
        //
        // Uniqueness in the directory is not enough on its own. Pharaoh
        // Sistare's answer mentions a Rhodes — the electric piano — and there
        // is exactly one artist here called Rhodes, so the guard passed and a
        // keyboard became a link to a stranger. Every common instrument, label
        // and place name is a potential artist name, and a stoplist of them
        // would always be one word short.
        //
        // So a single word only links when it is also somebody this artist has
        // actually credited; two or more words carry enough signal on their
        // own. This trades linking a few real one-word acts for never inventing
        // a collaborator, which is the right way round.
        const credited = new Set(collaborators.map(c => fold(c.subject)));
        // AND THE NAME HAS TO BE IN THE MATERIAL WE HANDED THE MODEL.
        //
        // Uniqueness in the directory proves one row has this spelling, not
        // that the sentence means that row. A relative called John Smith, or
        // Los Angeles, can each identify exactly one artist here. What
        // separates a real collaborator from a coincidence is where the name
        // came from: one we supplied in the vault, the document or the credits
        // is grounded, and one the model produced from its own weights is a
        // guess wearing a link.
        const grounded = fold(context);
        const linkable = (n: string) =>
            !already.has(fold(n))
            && grounded.includes(fold(n))
            && (n.trim().split(/\s+/).length > 1 || credited.has(fold(n)));

        const candidates = candidateNames(answer).filter(linkable);
        const byName = await findUniqueArtistsByName(candidates);
        const fromDirectory = candidates
            .filter(n => byName.has(fold(n)))
            .map(n => ({ name: n, artistId: byName.get(fold(n)) }));

        // Deduped on the folded name so the same person cannot be linked twice
        // under two spellings.
        //
        // And never the artist whose page this is. Every answer names them, and
        // they reach this list by BOTH routes — their own handle appears in
        // their own captions ("@p3t3rango mixed and mastered..."), which is a
        // self-credit, and their name is in the directory. A link from their
        // own page back to their own page is a dead end dressed as a
        // destination. Compared on id, so an alternate spelling is caught too.
        const seen = new Set<string>();
        return [...fromCredits, ...fromDirectory].filter(m => {
            if (m.artistId === artistId) return false;
            const k = fold(m.name);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    } catch (e) {
        console.error("[askArtist] Could not resolve mentions:", e);
        return [];
    }
}

/**
 * Spans of an answer that could be somebody's name.
 *
 * Deliberately blunt: capitalised runs of one to three words, which is what a
 * person or an act looks like in prose. Precision comes from the lookup, which
 * only returns names identifying exactly one artist here — so a wrong guess
 * costs a database row comparison and produces no link.
 *
 * TITLES ARE EXCLUDED. Every record in these answers is written in quotes, and
 * "Cast Out Of Hell" looks exactly like a band name. Anything inside quotes is
 * dropped before matching; song linking handles those separately.
 */
function candidateNames(answer: string): string[] {
    const withoutTitles = answer.replace(/["“”][^"“”]{1,120}["“”]/g, " ");
    const out = new Set<string>();
    // Allows the punctuation real names carry: A$AP Ferg, Hell'z Own, Jesse
    // Boykins III.
    //
    // [A-Z] would have been the third place in this file where ASCII stood in
    // for "a letter". It reduces "Édith Piaf" to the candidate "Piaf" and
    // produces nothing at all for a name in a script without capitals, so
    // those artists could never link. \p{Lu} is any uppercase letter; \p{Lo}
    // is a letter in a caseless script, which is how 宇多田ヒカル gets a look in.
    const word = "[\\p{Lu}\\p{Lo}][\\p{L}\\p{N}$'’.]*";
    const re = new RegExp(`${word}(?:\\s+${word}){0,2}`, "gu");
    for (const m of withoutTitles.matchAll(re)) {
        const span = m[0].replace(/[.,;:]+$/, "").trim();
        if (span.replace(/[^\p{L}\p{N}]/gu, "").length >= 2) out.add(span);
    }
    return [...out].slice(0, 40);
}

/**
 * Does this answer actually name this record?
 *
 * Case- and punctuation-insensitive, because the model writes a title the way a
 * writer would — "Cast Out Of Hell" for "Cast out of hell".
 *
 * BUT ON WORD BOUNDARIES. This folded both sides to bare letters and used
 * `includes`, which claimed to require the whole title and did not: a catalogue
 * containing "rush" matched an answer that only said "rushing", and the client
 * then rendered the "rush" inside "rushing" as a record button. So the title
 * becomes a pattern whose tokens are separated by whatever punctuation the
 * writer used, anchored at both ends.
 */
// Not exported: a route module may only export its HTTP handlers and Next's
// config values, and anything else fails the build with an unhelpful message
// about an index signature.
function titlePattern(title: string): RegExp | null {
    // UNICODE, not ASCII. [a-z0-9] tokenised "Beyoncé" to "beyonc" and then
    // matched the first six letters of it — so the client wrapped part of a
    // word as a record button — while a title in a non-Latin script produced
    // no tokens at all and could never link.
    const tokens = title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    if (tokens.length === 0) return null;
    // A single very short token is not a title anybody can match safely.
    if (tokens.length === 1 && tokens[0].length < 3) return null;
    const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    // \b is ASCII-only, so the edges are asserted as "not a letter or digit"
    // instead — otherwise "Été" would match inside a longer French word.
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped.join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`, "iu");
}

function namedInAnswer(answer: string, title: string): boolean {
    return titlePattern(title)?.test(answer) ?? false;
}
