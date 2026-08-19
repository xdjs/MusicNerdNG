/**
 * The artist doc: a markdown knowledgebase compiled during post-claim onboarding.
 * Synthesis mandate is "mine, don't summarize" — see the design spec §7.
 * Both Gemini calls here are UNGROUNDED (no web search): sources + the artist's
 * own words are the entire input, which is what keeps the doc trustworthy.
 *
 * CITATIONS (product-owner-caught defect: a real, sourced claim — "cited Ms Lauryn
 * Hill and Solange as influences", sourced from the artist's own SoundBetter profile —
 * read as fabricated because nothing was clickable). Every claim in the synthesized
 * doc and About is asked to carry an inline `[n]` marker referencing a numbered
 * SOURCES manifest built from real rows (buildDocContext). A marker that doesn't
 * resolve to a real source id is stripped before the text ever leaves this module —
 * see validateCitations. `synthesizeArtistDoc` / `generateAboutFromDoc` keep their
 * original `Promise<string>` signatures (only ever the validated text, markers
 * intact) so every existing caller keeps working untouched; `buildDocSources` is the
 * companion read-only export a caller uses to get the numbered manifest itself (for
 * storage and for rendering citation links) without re-running Gemini.
 */
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { getInterviewAnswers, getArtistDoc } from "@/server/utils/queries/onboardingQueries";
import { getSocialPostsForArtist } from "@/server/utils/socialIngest";
import { deriveSocialSignals } from "@/server/utils/socialSignals";
import { MAX_BIO_LENGTH, ARTIST_DOC_MAX_CHARS, ARTIST_DOC_CONTEXT_CAP } from "@/lib/bioConstants";

export { ARTIST_DOC_MAX_CHARS, ARTIST_DOC_CONTEXT_CAP };
/** Exported so callers (e.g. the publish-turn retry budget) can reason about
 *  worst-case Gemini call duration without re-declaring the constant. */
export const GEMINI_TIMEOUT_MS = 20_000;

/** A single numbered citation. `url` is null for an interview source — the
 *  artist's own words have no external link, so the client renders those as
 *  a labelled (non-link) superscript instead of an anchor. */
export type DocSource = {
    id: number;
    kind: "vault" | "interview" | "social";
    label: string;
    url: string | null;
};

// Collaborators are capped much tighter than track credits: a track credit
// ("Track credit — 'Song' (Artist)") is self-describing, but a bare
// "Instagram collaboration with @handle" says nothing about what the
// collaboration WAS — see the DOC_SYSTEM_INSTRUCTION rule that forbids
// listing one with nothing said about it. A long list of unexplained
// handles (worse: including the artist's OWN label/nonprofit accounts,
// which show up as `coauthors` on their own posts) is exactly the hollow
// catalog list this feature exists to avoid. `deriveCollaborators` already
// sorts by postCount desc, so this keeps only the most-repeated (most likely
// to be a real, explainable collaborator) handles.
const MAX_COLLABORATOR_SOURCES = 4;
const MAX_MUSIC_REF_SOURCES = 8;

type VaultSourceRow = Awaited<ReturnType<typeof getVaultSourcesByArtistId>>[number];
type InterviewAnswerRow = Awaited<ReturnType<typeof getInterviewAnswers>>[number];

/** Raw material fetched ONCE per doc-generation-adjacent call. Both the
 *  numbered source list and the prompt context text are pure derivations of
 *  this same object, so a source's [n] id and its material line always agree
 *  on which row they mean — no re-fetch-and-zip-by-index between two callers
 *  that each queried independently. */
type DocMaterial = {
    artist: NonNullable<Awaited<ReturnType<typeof getArtistById>>>;
    artistName: string;
    vaultSources: VaultSourceRow[];
    answers: InterviewAnswerRow[];
    socialCollaborators: { handle: string; url: string }[];
    socialMusicRefs: { title: string; artist: string; url: string }[];
};

async function gatherDocMaterial(artistId: string): Promise<DocMaterial> {
    const artist = await getArtistById(artistId);
    if (!artist) throw new Error(`Artist not found: ${artistId}`);
    const artistName = artist.name ?? "Unknown Artist";

    const vaultSources = await getVaultSourcesByArtistId(artistId, "approved");
    const answers = (await getInterviewAnswers(artistId)).filter(a => a.answer);

    // Social signals: confirmed mutual Instagram collaborations (co-authored /
    // tagged posts) plus real track credits — the "we have real collaborator
    // data now" material Industry Connections draws on. Themes/mentions/
    // standout posts aren't cited sources (too numerous, too weak a claim on
    // their own) — this stays scoped to what Industry Connections needs.
    const socialCollaborators: { handle: string; url: string }[] = [];
    const socialMusicRefs: { title: string; artist: string; url: string }[] = [];
    try {
        const posts = await getSocialPostsForArtist(artistId);
        if (posts.length > 0) {
            const signals = deriveSocialSignals(posts, artist.instagram ?? "", artistName);
            for (const c of signals.collaborators) {
                if (socialCollaborators.length >= MAX_COLLABORATOR_SOURCES) break;
                const url = c.evidenceUrls[0];
                if (url) socialCollaborators.push({ handle: c.handle, url });
            }
            for (const m of signals.musicReferences) {
                if (socialMusicRefs.length >= MAX_MUSIC_REF_SOURCES) break;
                const url = m.evidenceUrls[0];
                if (url) socialMusicRefs.push({ title: m.title, artist: m.artist, url });
            }
        }
    } catch (e) {
        console.error("[gatherDocMaterial] social signals error:", e);
    }

    return { artist, artistName, vaultSources, answers, socialCollaborators, socialMusicRefs };
}

/** The single numbered manifest both Gemini calls cite into and the client
 *  renders from. Order is fixed (vault, then interview, then social) so two
 *  calls against the same `DocMaterial` produce identical ids. */
function toSourceList(m: DocMaterial): DocSource[] {
    const sources: DocSource[] = [];
    let nextId = 1;
    for (const s of m.vaultSources) sources.push({ id: nextId++, kind: "vault", label: s.title ?? s.url, url: s.url });
    for (const a of m.answers) sources.push({ id: nextId++, kind: "interview", label: `Their own words — "${a.question}"`, url: null });
    for (const c of m.socialCollaborators) sources.push({ id: nextId++, kind: "social", label: `Instagram collaboration with @${c.handle}`, url: c.url });
    for (const r of m.socialMusicRefs) sources.push({ id: nextId++, kind: "social", label: `Track credit — "${r.title}" (${r.artist})`, url: r.url });
    return sources;
}

/** Read-only export: the numbered manifest a caller needs for storage
 *  (`artist_docs.sources`) and for rendering citation links — no Gemini
 *  call, just the same deterministic DB reads `synthesizeArtistDoc` uses
 *  internally to build its SOURCES prompt block. */
export async function buildDocSources(artistId: string): Promise<DocSource[]> {
    return toSourceList(await gatherDocMaterial(artistId));
}

/** Every `[n]` marker present in `text`, as a Set of ids. Exported so a
 *  caller can compute "which of the full candidate list did the model
 *  actually cite" across both the doc and the About without re-parsing the
 *  regex itself. */
export function extractCitedIds(text: string): Set<number> {
    const ids = new Set<number>();
    for (const m of text.matchAll(/\[(\d+)\]/g)) ids.add(Number(m[1]));
    return ids;
}

/** Strips any `[n]` marker that doesn't resolve to a real id in `sources` —
 *  the hard boundary that keeps a hallucinated citation from ever reaching
 *  the UI. Valid markers are left exactly as the model wrote them. */
function validateCitations(text: string, sources: DocSource[]): string {
    const validIds = new Set(sources.map(s => s.id));
    return text.replace(/\[(\d+)\]/g, (full, idStr) => (validIds.has(Number(idStr)) ? full : ""));
}

/** The public-facing counterpart to `validateCitations`: removes EVERY `[n]`
 *  marker regardless of validity, for text that must never carry citation
 *  litter — specifically `artists.bio` and its version history. The doc
 *  itself keeps its markers (it's shown with citations as its own artifact);
 *  only the About's clean, published form goes through this. */
export function stripCitationMarkers(text: string): string {
    // Markers are written with no space before them ("...influences[3]."), so a
    // straight removal never leaves a double space behind — no whitespace
    // collapsing needed beyond the final trim.
    return text.replace(/\[\d+\]/g, "").trim();
}

function sourceManifestBlock(sources: DocSource[]): string {
    if (sources.length === 0) return "";
    const lines = sources.map(s => {
        if (s.kind === "vault") return `[${s.id}] APPROVED SOURCE — "${s.label}" (${s.url})`;
        if (s.kind === "interview") return `[${s.id}] INTERVIEW — ${s.label}`;
        return `[${s.id}] SOCIAL SIGNAL — ${s.label} (${s.url})`;
    });
    return `\n--- NUMBERED SOURCES (cite these ids as [n]) ---\n${lines.join("\n")}\n--- END SOURCES ---`;
}

/**
 * The complete worked example injected into the doc prompt (Recoup's "Braden
 * Bales" technique — teach the shape and the citation convention by pasting a
 * finished report, not a list of section names). Fictional artist, fictional
 * sources, but every claim below carries the [n] it would actually need —
 * including the anti-inflation framing in Recent Activity (a genuinely new
 * direction is scoped to "on their last two releases", not retold as a
 * career-long trait) and the non-pitch framing of Who They Are.
 */
const WORKED_EXAMPLE = `
# MARISOL ECHOTHORNE - Artist Knowledge Document

## Overview
Marisol Echothorne is a Providence, Rhode Island singer-producer who self-releases guitar-and-synth songs about long-distance friendship and job-hopping in your twenties[1]. She started writing under this name in 2019 after leaving a touring cover band[2].

## Career Highlights
- Left the cover band Radio Static in early 2019 to write her own material[2]
- First single "Two Bus Transfer" picked up by a Spotify editorial playlist in 2021[3]
- Opened for Squirrel Flower at The Met in Pawtucket, RI (2022)[4]
- Self-released the "Late Bus" EP (4 tracks) in March 2024[1]

## Story hooks
- Wrote "Two Bus Transfer" entirely on the actual bus route it's named after, voice-memoing lines on her phone between stops[2]
- Named her home studio "the pantry" because it's a converted pantry off her kitchen — you can hear the fridge hum on early demos if you listen for it[2]
- Kept her old cover-band setlists taped inside her guitar case "so I remember what boring feels like"[2]

## Sound & Influences
Her records through 2024 sit in a lo-fi indie-rock lane — acoustic guitar, tape hiss, a drum machine mixed low[1][4]. In interviews she's named Sharon Van Etten and Alex G as the two songwriters she keeps returning to[2]. On "Late Bus" (2024), several reviewers flagged a new synth-bass layer as a departure from the earlier all-acoustic records[4] — that's a recent shift, not a description of her catalog as a whole.

## Discography Highlights
- "Two Bus Transfer" (2021) — her most-streamed single, ~40k streams on the Spotify editorial add[3]
- "Late Bus EP" (2024) — 4 tracks, first release with a full-time drummer[1]

## Industry Connections
Co-wrote two tracks on the "Late Bus" EP with producer Danny Okafor, credited on both as a mixing collaborator[1]. One confirmed Instagram collaboration post with fellow Providence artist Rowan Vex, tagged as a co-write on an unreleased song[5] — no other confirmed collaborators had enough material to say what the collaboration actually was, so they're left out rather than listed as bare handles.

## Recent Activity
On her last two releases (the "Late Bus" EP and its lead single), she's said in interviews that she's been experimenting with synth-bass and drum machine textures she hadn't used before[2][4] — a direction she describes as new for her, not a long-standing part of her sound.

## Online Presence
Spotify artist page linked and verified[1]. Instagram handle @marisolecho, used mostly to post short clips from "the pantry"[5].

## Who They Are
She still keeps her old cover-band setlists in her guitar case — a specific, small habit that says more about where she came from than any bio line would[2].
`.trim();
// NOTE: no "## Audience & Fanbase" section above — the fictional source
// material has no real signal for it, so the worked example demonstrates
// the omit rule directly rather than describing it. Writing a "not enough
// signal" placeholder here would teach the model the exact anti-pattern the
// omit rule forbids ("no placeholders, no 'TBD', no empty sections").

const DOC_SYSTEM_INSTRUCTION = (artistName: string) => `You compile an internal knowledge document about the music artist "${artistName}" for Music Nerd — a public artist directory, not a label's internal pitch deck.

Use ONLY these section headers, in this order, and OMIT any section entirely if you have no real, specific material for it (no placeholders, no "not enough signal" lines — just leave the section out):
## Overview
## Career Highlights
## Story hooks
## Sound & Influences
## Discography Highlights
## Industry Connections
## Recent Activity
## Online Presence
## Who They Are
## Audience & Fanbase

Here is a complete worked example for a fictional artist — follow its shape, density, and citation style exactly (but never reuse any of its facts):
${WORKED_EXAMPLE}

CITATIONS — every factual claim must carry a marker:
- The material below is numbered as a SOURCES manifest ([1], [2], [3]...). Immediately after each claim, add the [n] of the source it came from — e.g. "toured with Fana Hues[4]." Multiple sources for one claim: stack the markers, "[2][5]".
- If you cannot attribute a claim to a specific numbered source, DO NOT include the claim — omit it rather than stating it unattributed.
- Never invent a source number. Only cite ids that actually appear in the SOURCES manifest.
- INTERVIEW sources are the artist's own words — quote them verbatim in quotation marks, never paraphrase, and still cite them.

ANTI-INFLATION — characterize the artist's body of work only as far as the evidence actually supports:
- A trait, style, or interest shown in only recent material (a handful of posts, one interview answer, the latest release) is described as recent and scoped in time — "on his latest releases", "he's said recently" — never generalized into "his sound is X" or "known for X" when the evidence only covers a narrow recent window.
- Do not extrapolate a whole career or a stable identity from a few data points. If the material shows a shift or a new direction, say it's a shift, not a redescription of everything that came before it.
- ## Sound & Influences describes the stable, evidenced body of work; anything that reads as new or recent belongs in ## Recent Activity instead, scoped with a time-anchored phrase.

OTHER RULES:
- Mine, don't summarize: prefer one specific, tellable detail over three generic facts.
- Name real people, places, songs, venues, and dates whenever the material supports them.
- ## Story hooks: 2-5 bullet points, each one narratable specific a fan would repeat to a friend.
- ## Industry Connections: for each collaborator you name, say what the collaboration actually was (a track, a project, a mix credit) — never list a bare handle or name with nothing said about what happened. If the material gives you a handle with no indication of what the collaboration was, leave it out rather than padding a list with it.
- ## Who They Are: one or two sentences on something specific and human about them — not a marketing pitch, no "appeals to X demographic" or "multi-genre appeal" language.
- Never fabricate. No hype words ("rising star", "eclectic", "undeniable").
- Target under 900 words total.`;

const ABOUT_SYSTEM_INSTRUCTION = (artistName: string) => `You write the public "About" for the music artist "${artistName}" from their cited knowledge document.
- 2-4 short paragraphs, roughly 600-1,200 characters. Plain text only — no markdown, no headers.
- Concrete and specific: names, places, songs, dates. Let specifics do the work, not adjectives.
- Where the document quotes the artist, keep the quote — their words beat your words.
- CITATIONS: the document's claims already carry [n] markers referencing its SOURCES manifest. When you carry a claim over into the About, keep its [n] marker immediately after it. Do not add a marker to a sentence you wrote yourself with no corresponding cited claim in the document, and never invent a marker number that isn't in the document.
- ANTI-INFLATION: preserve the document's time-scoping — if the document describes something as recent ("on his latest releases", "he's said recently"), keep that framing rather than smoothing it into a general career description.
- No hype phrases ("rising star", "eclectic", "undeniable", "pushing boundaries").
- Never fabricate anything not in the document.`;

function withGeminiTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini timeout")), GEMINI_TIMEOUT_MS)),
    ]);
}

/** `presetSources`, when given, is used AS-IS instead of rebuilding the list
 *  from this call's own `gatherDocMaterial` read — this is what lets a caller
 *  (turnHandlers' publish step) build the manifest ONCE and hand the exact
 *  same array to both synthesizeArtistDoc and generateAboutFromDoc, so a
 *  background ingest landing between the two calls can't silently shift ids
 *  out from under one of them (a citation would then point at the wrong
 *  source — the exact failure this feature exists to prevent). The
 *  vault/interview material lines below are still zipped against a FRESH
 *  read (`material`) by array position, matched against `presetSources`'
 *  same-kind entries in the same fixed order `toSourceList` produces —
 *  correct as long as nothing changed between the preset build and now
 *  (true within one publish turn); a genuinely new row landing in that
 *  narrow window just gets a manifest line with no id to attach to, so
 *  Gemini simply can't cite it rather than mis-citing it. */
async function buildDocContext(artistId: string, presetSources?: DocSource[]): Promise<{ artistName: string; context: string; sources: DocSource[] }> {
    const material = await gatherDocMaterial(artistId);
    const { artist } = material;
    const sources = presetSources ?? toSourceList(material);
    // Same fixed order toSourceList used — ids line up with these slices by position.
    const vaultIds = sources.filter(s => s.kind === "vault");
    const interviewIds = sources.filter(s => s.kind === "interview");
    const socialIds = sources.filter(s => s.kind === "social");

    const parts: string[] = [];
    if (artist.spotify) parts.push(`Spotify (verified identity): https://open.spotify.com/artist/${artist.spotify}`);
    if (artist.instagram) parts.push(`Instagram: https://instagram.com/${artist.instagram}`);
    if (artist.x) parts.push(`X: https://x.com/${artist.x}`);
    if (artist.soundcloud) parts.push(`SoundCloud: ${artist.soundcloud}`);
    if (artist.youtube) parts.push(`YouTube: https://youtube.com/@${artist.youtube.replace(/^@/, "")}`);

    if (material.vaultSources.length > 0) {
        const sourceContext = material.vaultSources.map((s, i) => {
            // `?.id` defends the narrow presetSources-drift window described
            // above: a row with no corresponding preset id gets an
            // "[undefined]" line, which never matches the \[\d+\] marker
            // regex, so Gemini simply can't cite it — never a wrong id.
            const p = [`[${vaultIds[i]?.id}] Source: ${s.title ?? s.url}`];
            if (s.snippet) p.push(s.snippet);
            if (s.extractedText) p.push(s.extractedText.slice(0, 2000));
            return p.join(" — ");
        }).join("\n");
        parts.push(`\n--- APPROVED SOURCES (about this exact artist) ---\n${sourceContext}\n--- END SOURCES ---`);
    }

    if (material.answers.length > 0) {
        const interviewContext = material.answers
            .map((a, i) => `[${interviewIds[i]?.id}] Q: ${a.question}\nA (artist's own words): "${a.answer}"`)
            .join("\n\n");
        parts.push(`\n--- INTERVIEW ANSWERS (quote verbatim) ---\n${interviewContext}\n--- END INTERVIEW ---`);
    }

    if (socialIds.length > 0) {
        const socialContext = socialIds.map(s => `[${s.id}] ${s.label}`).join("\n");
        parts.push(`\n--- SOCIAL SIGNALS (confirmed collaborations / track credits) ---\n${socialContext}\n--- END SOCIAL SIGNALS ---`);
    }

    parts.push(sourceManifestBlock(sources));

    return { artistName: material.artistName, context: parts.join("\n"), sources };
}

export async function synthesizeArtistDoc(artistId: string, presetSources?: DocSource[]): Promise<string> {
    const { artistName, context, sources } = await buildDocContext(artistId, presetSources);
    const response = await withGeminiTimeout(
        getGemini().models.generateContent({
            model: GEMINI_MODEL_FLASH,
            contents: context,
            config: {
                systemInstruction: DOC_SYSTEM_INSTRUCTION(artistName),
                temperature: 0.4,
            },
        })
    );
    const raw = response.text?.trim();
    if (!raw) throw new Error("Doc synthesis returned empty text");
    const doc = validateCitations(raw, sources);
    return doc.slice(0, ARTIST_DOC_MAX_CHARS);
}

export async function generateAboutFromDoc(artistName: string, docContent: string, sources: DocSource[] = []): Promise<string> {
    const response = await withGeminiTimeout(
        getGemini().models.generateContent({
            model: GEMINI_MODEL_FLASH,
            contents: `ARTIST KNOWLEDGE DOCUMENT:\n${docContent}`,
            config: {
                systemInstruction: ABOUT_SYSTEM_INSTRUCTION(artistName),
                temperature: 0.5,
            },
        })
    );
    const raw = response.text?.trim();
    if (!raw) throw new Error("About generation returned empty text");
    const about = validateCitations(raw, sources);
    return about.slice(0, MAX_BIO_LENGTH);
}

/** Capped doc slice for prompt injection (askArtist / funFacts / bio). Null when no doc. */
export async function getArtistDocContext(artistId: string): Promise<string | null> {
    const doc = await getArtistDoc(artistId);
    if (!doc?.content) return null;
    // This context feeds funFacts/askArtist prompt injection, whose OUTPUT is
    // user-facing — a model handed "...influences[14]." has no source list to
    // resolve [14] against and will just echo the bracket into a fun fact or
    // chat answer. Citations belong to the doc-as-artifact and the About
    // review UI, not to every downstream consumer of this slice. Strip
    // BEFORE the length cap (not after) — stripping never lengthens text, but
    // capping first then stripping could return a slice shorter than the cap.
    return stripCitationMarkers(doc.content).slice(0, ARTIST_DOC_CONTEXT_CAP);
}
