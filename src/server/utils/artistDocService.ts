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
import { getSpotifyCatalogDetail, getSpotifyHeaders } from "@/server/utils/queries/externalApiQueries";
import { getInterviewAnswers, getArtistDoc, upsertArtistDoc, upsertArtistDocSources } from "@/server/utils/queries/onboardingQueries";
import { getDocCorrections } from "@/server/utils/queries/docCorrectionQueries";
import { getSocialPostsForArtist } from "@/server/utils/socialIngest";
import { deriveSocialSignals } from "@/server/utils/socialSignals";
import { MAX_BIO_LENGTH, ARTIST_DOC_MAX_CHARS, ARTIST_DOC_CONTEXT_CAP, ABOUT_LENGTH_RULE, ABOUT_STOP_RULE, ABOUT_OPENING_RULE } from "@/lib/bioConstants";
import { isCitableSource } from "@/server/utils/sourceVerification";

export { ARTIST_DOC_MAX_CHARS, ARTIST_DOC_CONTEXT_CAP };
/** Exported so callers (e.g. the publish-turn retry budget) can reason about
 *  worst-case Gemini call duration without re-declaring the constant.
 *  Measured p95 with thinking off is ~6.5s (n=8, artist 50f23458-...) — 15s
 *  is ~2.3x headroom. See the knowledge-doc report for the full before/after
 *  measurement; the ORIGINAL 20s budget was sized for a call that no longer
 *  runs anywhere near that long, now that thinking is off (see
 *  synthesizeArtistDoc) — the timeout didn't need raising, it needed
 *  tightening once the real cost (default thinking) was found and cut. */
export const GEMINI_TIMEOUT_MS = 15_000;
/** About is a much lighter call (a plain paragraph from an already-built
 *  doc) — measured p95 ~2.9s, so it gets its own tighter bound rather than
 *  inheriting the doc's. This matters for the retry-budget math in
 *  turnHandlers: a tighter per-call bound means an About failure is
 *  detected (and becomes retry/fallback-eligible) well before it alone
 *  could burn the whole publish-turn deadline. */
export const GEMINI_ABOUT_TIMEOUT_MS = 12_000;
/** Bound for `synthesizeFallbackAbout` — a lighter prompt than either call
 *  above (no worked example, no citation manifest), so the same generous
 *  ~4x-headroom-over-About logic applies. */
export const FALLBACK_TIMEOUT_MS = 12_000;

/** A single numbered citation. `url` is null for an interview source — the
 *  artist's own words have no external link, so the client renders those as
 *  a labelled (non-link) superscript instead of an anchor. */
export type DocSource = {
    id: number;
    kind: "vault" | "interview" | "social";
    label: string;
    url: string | null;
    /** ISO date the source says it was published, when it says. Persisted with
     *  the manifest so the artist's own review surface can show "VoyageMIA ·
     *  2019" against a claim — which is usually the whole explanation for why a
     *  claim reads stale. Only vault sources have one. */
    publishedAt?: string | null;
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

    // CITABLE SOURCES ONLY — filtered here, at the single point where doc material
    // is read, rather than downstream in `toSourceList`. Everything after this
    // (the numbered manifest AND the prompt's material lines) is zipped against
    // `vaultSources` by array position, so a filter applied to one and not the
    // other would silently point citations at the wrong source. One filter, one
    // array, no way for the two to disagree.
    //
    // What this excludes: sources whose page we never successfully read. Their
    // stored snippet is a language model's description of a search result, not
    // text from the page — citing one presents model output as a verified fact,
    // which is worse than having no citation at all. They remain in the vault and
    // remain visible to the artist as unverified leads; they just cannot be
    // evidence for a published claim.
    const approvedSources = await getVaultSourcesByArtistId(artistId, "approved");
    const vaultSources = approvedSources.filter(isCitableSource);
    const uncitable = approvedSources.length - vaultSources.length;
    if (uncitable > 0) {
        console.log(`[gatherDocMaterial] ${uncitable}/${approvedSources.length} approved source(s) excluded from citation for ${artistName} — page content never verified`);
    }
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
    for (const s of m.vaultSources) sources.push({ id: nextId++, kind: "vault", label: s.title ?? s.url, url: s.url, publishedAt: s.publishedAt ?? null });
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
    return text
        .replace(/\[(\d+)\]/g, (full, idStr) => (validIds.has(Number(idStr)) ? full : ""))
        // A marker that isn't a number at all. The model cited the catalog block
        // as "[VERIFIED CATALOG]" — reference data presented to the reader as a
        // source, and one that resolves to nothing. Only numbered ids from the
        // manifest are citations; anything else in brackets is model litter.
        // Deliberately narrow: real prose uses brackets for asides, so this only
        // removes ALL-CAPS bracket tokens, which prose does not produce.
        .replace(/\s*\[[A-Z][A-Z \-_]{2,}\]/g, "")
        // "(date unknown)" is OUR label for the model, telling it we could not
        // establish a date. It has now twice been copied into the document as
        // though it were a fact about the release — '"Vi$ions" (date unknown)'.
        // The prompt forbids it and the model does it anyway, so remove it here
        // rather than adding a third sentence asking nicely. A missing date
        // should simply be absent, not announced.
        .replace(/\s*\((?:date unknown|year unknown|no date)\)/gi, "");
}

/** The public-facing counterpart to `validateCitations`: removes EVERY `[n]`
 *  marker regardless of validity, for text that must never carry citation
 *  litter — specifically `artists.bio` and its version history. The doc
 *  itself keeps its markers (it's shown with citations as its own artifact);
 *  only the About's clean, published form goes through this. */
export function stripCitationMarkers(text: string): string {
    // The prompt asks for markers with no space before them ("...influences[3]."),
    // and the model does not always comply — real output included "based in
    // Miami, FL [1]." A straight removal then leaves " ." in the PUBLISHED About,
    // since the auto-build stores exactly this string as the artist's bio.
    //
    // Only spaces and tabs are eaten before a marker, never newlines: a marker at
    // the start of a line must not pull the paragraph break out with it.
    return text
        .replace(/[ \t]*\[\d+\]/g, "")
        .replace(/[ \t]+([.,;:!?)\]])/g, "$1")
        // A marker that opened a line leaves its trailing space behind.
        .replace(/(^|\n)[ \t]+/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
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

## In Their Own Words
- On working alone: "I like that nobody's waiting on me. If a song's bad, it's bad on my own time."[2]
- On why she left the cover band: "I remember what boring feels like. That's the whole reason I write anything."[2]
- On the pantry studio: "Everyone keeps telling me to treat the room. I think the fridge is on the record now."[2]
`.trim();
// NOTE: no "## Audience & Fanbase" section above — the fictional source
// material has no real signal for it, so the worked example demonstrates
// the omit rule directly rather than describing it. Writing a "not enough
// signal" placeholder here would teach the model the exact anti-pattern the
// omit rule forbids ("no placeholders, no 'TBD', no empty sections").

/** Today, for the model.
 *
 *  Without it, a source written before a release date describes that release in
 *  its own future tense and the document copies it straight through. A real
 *  artist's page read "his latest release, 'rush', was scheduled to drop on
 *  Subvert on March 1" in late August — the record was out, and we were
 *  announcing it. A model cannot reconcile tense against a date it does not
 *  have. */
function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

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
## In Their Own Words
## Audience & Fanbase

Here is a complete worked example for a fictional artist — follow its shape, density, and citation style exactly (but never reuse any of its facts):
${WORKED_EXAMPLE}

CITATIONS — every factual claim must carry a marker:
- The material below is numbered as a SOURCES manifest ([1], [2], [3]...). Immediately after each claim, add the [n] of the source it came from — e.g. "toured with Fana Hues[4]." Multiple sources for one claim: stack the markers, "[2][5]".
- If you cannot attribute a claim to a specific numbered source, DO NOT include the claim — omit it rather than stating it unattributed.
- Never invent a source number. Only cite ids that actually appear in the SOURCES manifest.
- INTERVIEW sources are the artist's own words — quote them verbatim in quotation marks, never paraphrase, and still cite them.

CORRECTIONS — if a CORRECTIONS FROM THE ARTIST block is present, it is the highest authority in this document, above every source:
- A claim the artist marked REMOVE must not appear in any form. Do not rephrase it, do not soften it, do not keep the part you think is still true. They read it and said it was wrong about them.
- Where the artist supplied a correction, state THEIR version. A source saying otherwise is out of date or mistaken, not a second opinion to balance.
- Corrections carry no [n] marker. Write the corrected claim without one rather than citing a source that contradicts it.
- Never argue with a correction in the text ("though one source says..."). The artist is the authority on their own life.

TIME — today is ${todayISO()}. Read every source against that date.

MOST FACTS ARE PERMANENT. State them plainly, with no hedge and no year attached to them:
- A release, a track, a credit, a placement, a feature, an award, a competition won, a band formed, a label founded, where someone was born or grew up. These happened. They do not stop having happened.
- "He has a song on Jesse Boykins III's EP Bartholomew WAVE I" is permanent. Writing "as of 2019, he had a song on..." is WRONG — it reads as though the song might have since come off the record.

ONLY SCOPE WHAT ACTUALLY DECAYS: a current role or job title, an ongoing partnership, where someone lives now, who they are signed to, who they are "currently" developing or working with, and anything phrased as latest/newest/upcoming. Those can quietly stop being true, so they take the year the source was written: "as of 2019, Parris Pierce was his production partner."

"As of YEAR" attaches to a STATE, never to an action. "As of 2026, he co-directed a documentary" is wrong twice over — co-directing is a completed act, and the phrase reads as though it might be undone. Say when it happened instead: "he co-directed Big Scouse (2026)". If you find yourself writing "as of" in front of a past-tense verb, you want a date in brackets.

THE SOURCE'S DATE IS NOT THE EVENT'S DATE. A 2019 interview mentioning a placement does NOT mean the placement happened in 2019 — it means that by 2019 it had happened. Never attach a source's publication year to an event as if it were the event's year. If a source does not say when something happened, write it with no date at all. A missing date is honest; a wrong one is not.

RECONCILE AGAINST TODAY. Sources were written in the past and describe the future in their own present tense. A release "dropping March 1st", read from a page written before that date, has already come out — write it as released, or drop the date language entirely. NEVER carry "will", "is scheduled to", "upcoming", "coming soon" or a future-dated plan into this document for a date that has already passed. This is a music database: saying a released record is forthcoming is worse than saying nothing about it.

- Two sources disagreeing is usually one being older, not a contradiction. Prefer the newer.
- "date unknown" means you do not know whether a DECAYING claim is current — attribute rather than assert. It changes nothing about permanent facts.
- Never invent a date. Never write a year that appears nowhere in the material.
- The source labels are for YOU, not the reader. Never copy "date unknown", "published ...", or "N years ago" into the document.

ANTI-INFLATION — characterize the artist's body of work only as far as the evidence actually supports:
- A trait, style, or interest shown in only recent material (a handful of posts, one interview answer, the latest release) is described as recent and scoped in time — "on his latest releases", "he's said recently" — never generalized into "his sound is X" or "known for X" when the evidence only covers a narrow recent window.
- Do not extrapolate a whole career or a stable identity from a few data points. If the material shows a shift or a new direction, say it's a shift, not a redescription of everything that came before it.
- ## Sound & Influences describes the stable, evidenced body of work; anything that reads as new or recent belongs in ## Recent Activity instead, scoped with a time-anchored phrase.

OTHER RULES:
- Mine, don't summarize: prefer one specific, tellable detail over three generic facts.
- Name real people, places, songs, venues, and dates whenever the material supports them.
- ## Story hooks: 2-5 bullet points, each one narratable specific a fan would repeat to a friend.
- ## Discography Highlights: HIGHLIGHTS, NOT A CATALOG. AT MOST 6 ENTRIES. The artist's streaming links already list every release and stay current, so copying the catalog in here adds nothing and goes stale the day they put something out.
  DO NOT DESCRIBE THE FORMAT. Never write that something is a single, an EP, an album, a mix or a solo release. The reader can see that, and it is the padding this section keeps filling up with.
  EVERY ENTRY MUST CONTAIN AT LEAST ONE OF: a named collaborator, a named placement (a show, a film, a label, a playlist), or something that actually happened around it. An entry with a title, a year and nothing else FAILS THIS TEST and must be deleted, however much room is left. Check each line you write against that before you keep it.
  Good: "Vi$ions" (2019) — co-produced with Cherele, placed on HBO's Insecure. Bad: "Por Tu Barrio" (2023) — a single.
  Three entries that pass beats six that do not. If fewer than two pass, omit the section entirely; the artist's streaming links already list everything.
  The VERIFIED CATALOG is for TITLES AND DATES, not a list to reproduce. It outranks any date a webpage gives: a release the catalog dates gets that date plainly, "rush (2026)". A release it does not carry gets no date at all.
- ## Industry Connections: for each collaborator you name, say what the collaboration actually was (a track, a project, a mix credit) — never list a bare handle or name with nothing said about what happened. If the material gives you a handle with no indication of what the collaboration was, leave it out rather than padding a list with it.
- ## Who They Are: one or two sentences on something specific and human about them — not a marketing pitch, no "appeals to X demographic" or "multi-genre appeal" language.
- ## In Their Own Words: 2-6 direct quotations, VERBATIM and in quotation marks, each with a short lead-in saying what it is about — how they work, what they believe, advice they have given. This is the section a fan's question is most often answered from, so prefer what the artist actually said to any paraphrase of it. Interviews are full of this material and it is the first thing a summary throws away. Quote only what a source actually contains; never smooth a quote into better English. Biography belongs in the sections above, not here.
- Never fabricate. No hype words ("rising star", "eclectic", "undeniable").
- LENGTH: aim for 1,100-1,400 words where the material genuinely supports it. This is a knowledge base that a fan-facing Q&A reads from, not a summary — a specific you leave out is a question that cannot be answered later. But never pad to reach it: an unsourced or generic line is worse than a shorter document, and a thin source set should produce a short one.`;

/** How much of one source's text reaches the document prompt.
 *
 *  Sized against what the model can actually read, not against habit: a handful
 *  of full-length sources is roughly twenty thousand tokens against a context of
 *  about a million. The previous 2,000 was cutting an artist's best credit out
 *  of his own profile. selectSourceText only has to choose at all when a source
 *  runs longer than this. */
export const SOURCE_TEXT_BUDGET = 12_000;

/** How many catalog rows reach the prompt. Grounding, not a discography — the
 *  artist's Spotify and Deezer links carry the full catalog and stay current,
 *  where a copy baked into a generated document goes stale the day they release
 *  something. Pete, on seeing three Instagram-derived tracks: "that's only a few
 *  from over a hundred songs I've been a part of" — and then, on the fix:
 *  "we don't need to shove all the releases into the knowledge doc, if we have
 *  access to deezer and spotify right?" */
const CATALOG_LINES = 40;

/**
 * The most relevant `SOURCE_TEXT_BUDGET` characters of a source, not the first.
 *
 * Taking the head systematically favours whatever a page opens with, which for
 * an interview is the childhood and for an article is the boilerplate. A real
 * artist's best credit — "featured in HBO's Insecure" — sat at character 2,466
 * of a 5,000-character profile and was cut by a 2,000-character head slice, so
 * his About read as a summary of his childhood and never mentioned the credit.
 *
 * Paragraphs that name the artist are kept first, in their original order, then
 * the rest fill whatever budget remains. Order is preserved so the model still
 * reads a coherent narrative rather than a pile of ranked fragments.
 */
export function selectSourceText(text: string, artistName: string): string {
    if (text.length <= SOURCE_TEXT_BUDGET) return text;

    const paragraphs = text.split(/\n{2,}|(?<=\.)\s{2,}/).filter(p => p.trim());
    if (paragraphs.length < 2) return text.slice(0, SOURCE_TEXT_BUDGET);

    const tokens = artistName.toLowerCase().split(/\s+/).filter(t => t.length >= 4);
    const mentionsArtist = (p: string) => {
        const low = p.toLowerCase();
        return low.includes(artistName.toLowerCase()) || tokens.some(t => low.includes(t));
    };

    const kept = new Set<number>();
    let used = 0;
    // Pass 1: paragraphs that actually talk about this artist.
    paragraphs.forEach((para, i) => {
        if (!mentionsArtist(para)) return;
        if (used + para.length > SOURCE_TEXT_BUDGET) return;
        kept.add(i);
        used += para.length;
    });
    // Pass 2: fill the remainder with surrounding context, still in order.
    paragraphs.forEach((para, i) => {
        if (kept.has(i)) return;
        if (used + para.length > SOURCE_TEXT_BUDGET) return;
        kept.add(i);
        used += para.length;
    });
    if (kept.size === 0) return text.slice(0, SOURCE_TEXT_BUDGET);

    return paragraphs.filter((_, i) => kept.has(i)).join("\n\n");
}

const ABOUT_SYSTEM_INSTRUCTION = (artistName: string) => `You are a music writer. Write the public "About" for "${artistName}" from their cited knowledge document.

WHAT THIS IS: a short editorial paragraph a music publication would run. Not a summary, not a changelog, not a list of true facts with verbs attached. A reader should finish it knowing who this artist IS — not merely what they have done.
- ${ABOUT_LENGTH_RULE} ${ABOUT_STOP_RULE} Plain text only — no markdown, no headers.
- ${ABOUT_OPENING_RULE}
- SELECT — do not inventory. The document holds far more than belongs here. Choose the two or three things that actually say something about this person and leave the rest out. A detail earns its place by revealing something, not by being true. Dates, version numbers and product names are usually the first things to cut.
- FIND THE THROUGH-LINE. These facts belong to one person; say what connects them. If the material shows someone doing several apparently unrelated things, that IS the story — write it as one, not as a list.
- VARY THE SENTENCES. A paragraph of identically shaped declaratives reads as a database dump. That is the most common failure here — reread what you wrote and fix it before answering.
- Concrete over abstract: names, places, songs, scenes. But a specific with no reason to be there is still filler.
- The document quotes the artist's own words. Use what they said as fact, in plain third person — no quotation marks in the About. Their own framing of their work is usually the best line in the document; prefer it to your own.
- CITATIONS: the document's claims already carry [n] markers referencing its SOURCES manifest. When you carry a claim over into the About, keep its [n] marker immediately after it. Do not add a marker to a sentence you wrote yourself with no corresponding cited claim in the document, and never invent a marker number that isn't in the document.
- ANTI-INFLATION: preserve the document's time-scoping — if the document describes something as recent ("on his latest releases", "he's said recently"), keep that framing rather than smoothing it into a general career description.
- No hype phrases ("rising star", "eclectic", "undeniable", "pushing boundaries").
- Never fabricate anything not in the document.`;

function withGeminiTimeout<T>(p: Promise<T>, ms: number = GEMINI_TIMEOUT_MS): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini timeout")), ms)),
    ]);
}


/**
 * How a source's age is described to the model: "published 2019-01-10, 7 years ago".
 *
 * A real artist's profile stated "Parris Pierce is my production partner" in the
 * present tense. It came from an interview published in January 2019 — true when
 * written, and presented as a current fact seven years later. The document had an
 * anti-inflation rule telling it to scope claims in time, and no way to obey it,
 * because nothing in its material said when anything happened.
 *
 * An undated source says so rather than going unmarked, so the model can tell
 * "we know this is old" apart from "we do not know how old this is" — those call
 * for different hedging, and conflating them is how a guess becomes a fact.
 */
export function sourceAgeLabel(publishedAt: string | null | undefined, now: Date = new Date()): string {
    if (!publishedAt) return "date unknown";
    const then = new Date(publishedAt);
    if (isNaN(then.getTime())) return "date unknown";
    const years = (now.getTime() - then.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years < 0) return `published ${publishedAt}`;
    if (years < 1) return `published ${publishedAt}, within the last year`;
    const rounded = Math.round(years);
    return `published ${publishedAt}, ${rounded} year${rounded === 1 ? "" : "s"} ago`;
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

    // The artist's real catalog, with real release dates. Before this, releases
    // came from whatever Instagram captions happened to mention and got dated by
    // the publication year of the article that referenced them — so a placement
    // read "as of 2019" because an interview from 2019 mentioned it. Spotify is
    // authoritative for both the title and the date; a webpage is not.
    if (artist.spotify) {
        try {
            const catalog = await getSpotifyCatalogDetail(artist.spotify, await getSpotifyHeaders());
            if (catalog.length > 0) {
                const lines = catalog.slice(0, CATALOG_LINES).map(r =>
                    `${(r.releaseDate ?? "date unknown").padEnd(12)} ${(r.kind ?? "release").padEnd(11)} ${r.name}`);
                parts.push(
                    `\n--- VERIFIED CATALOG (the artist's own Spotify — authoritative for titles and release dates) ---\n`
                    + `This is reference data, NOT a numbered source. Never cite it. Never write "[VERIFIED CATALOG]" or any marker for it.\n`
                    + `${lines.join("\n")}\n--- END CATALOG ---`
                );
            }
        } catch (e) {
            // Never fail a document build over the catalog: the sources are the
            // substance, this is grounding.
            console.error("[buildDocContext] Spotify catalog unavailable:", e);
        }
    }

    if (material.vaultSources.length > 0) {
        const sourceContext = material.vaultSources.map((s, i) => {
            // `?.id` defends the narrow presetSources-drift window described
            // above: a row with no corresponding preset id gets an
            // "[undefined]" line, which never matches the \[\d+\] marker
            // regex, so Gemini simply can't cite it — never a wrong id.
            // The date is the difference between "is" and "was". A source with no
            // date says so explicitly rather than being silently undated, so the
            // model can tell "we know it is old" from "we do not know".
            const age = sourceAgeLabel(s.publishedAt);
            const p = [`[${vaultIds[i]?.id}] Source (${age}): ${s.title ?? s.url}`];
            if (s.snippet) p.push(s.snippet);
            if (s.extractedText) p.push(selectSourceText(s.extractedText, artist.name ?? ""));
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

    // The artist's own corrections, LAST so they are the final word before the
    // manifest. Everything above is what we read about them; this is what they
    // told us, and it outranks the lot.
    const corrections = await getDocCorrections(artistId);
    if (corrections.length > 0) {
        const lines = corrections.map(c => c.kind === "fix" && c.correction
            ? `- WRONG: "${c.claim}"\n  THE ARTIST SAYS: ${c.correction}`
            : `- REMOVE, the artist says this is not true or not them: "${c.claim}"`);
        parts.push(
            `\n--- CORRECTIONS FROM THE ARTIST (these OVERRIDE the sources above) ---\n`
            + `${lines.join("\n")}\n--- END CORRECTIONS ---`
        );
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
                // Flash runs extended thinking by default, which measured
                // 16-21s+ on this call (against sources this size) and blew
                // the publish turn's budget outright. Off cuts it to ~6s
                // p95 with no observed drop in citation accuracy or "mine,
                // don't summarize" specificity — see the knowledge-doc
                // report for the measured A/B (thinking off vs bounded
                // budgets vs default) and side-by-side doc quality.
                thinkingConfig: { thinkingBudget: 0 },
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
                thinkingConfig: { thinkingBudget: 0 }, // see synthesizeArtistDoc
            },
        }),
        GEMINI_ABOUT_TIMEOUT_MS,
    );
    const raw = response.text?.trim();
    if (!raw) throw new Error("About generation returned empty text");
    const about = validateCitations(raw, sources);
    return about.slice(0, MAX_BIO_LENGTH);
}

const FALLBACK_ABOUT_SYSTEM_INSTRUCTION = (artistName: string) => `You write the public "About" for the music artist "${artistName}" from the material below (curated sources, the artist's own interview answers, and/or an existing knowledge document about them).
- ${ABOUT_LENGTH_RULE} ${ABOUT_STOP_RULE} Plain text only — no markdown, no headers, no citation markers or bracketed numbers.
- ${ABOUT_OPENING_RULE}
- Concrete and specific: names, places, songs, dates. Let specifics do the work, not adjectives.
- Where the material quotes the artist directly, use what they said as fact, in plain third person — no quotation marks in the About.
- No hype phrases ("rising star", "eclectic", "undeniable", "pushing boundaries").
- Never fabricate anything not in the material.`;

/** Last-resort, non-cited fallback — the pre-citation-feature synthesis shape,
 *  kept alive as the safety net for when the cited pipeline
 *  (synthesizeArtistDoc / generateAboutFromDoc) fails on BOTH its normal
 *  attempt and its retry (see turnHandlers' publish step). Deliberately
 *  simple: no worked example, no citation manifest, no thinking — just the
 *  material in, a plain About paragraph out. A degraded About beats none at
 *  all (spec: "a degraded publish beats a broken one").
 *
 *  `docContent`, when given, is used AS-IS as the material (the doc already
 *  synthesized fine — only About failed, so no need to re-read the vault).
 *  Omitted (doc synthesis itself failed), this rebuilds the same raw context
 *  synthesizeArtistDoc would have used — one extra DB read, but only on this
 *  already-rare double-failure path. */
export async function synthesizeFallbackAbout(artistId: string, artistName: string, docContent?: string, presetSources?: DocSource[]): Promise<string> {
    const materialText = docContent ?? (await buildDocContext(artistId, presetSources)).context;
    const response = await withGeminiTimeout(
        getGemini().models.generateContent({
            model: GEMINI_MODEL_FLASH,
            contents: `ARTIST MATERIAL:\n${materialText}`,
            config: {
                systemInstruction: FALLBACK_ABOUT_SYSTEM_INSTRUCTION(artistName),
                temperature: 0.5,
                thinkingConfig: { thinkingBudget: 0 },
            },
        }),
        FALLBACK_TIMEOUT_MS,
    );
    const raw = response.text?.trim();
    if (!raw) throw new Error("Fallback About generation returned empty text");
    // Defensive: materialText may itself be a cited doc carrying [n] markers
    // the model could echo back — this fallback never has a manifest for
    // them to resolve against, so strip unconditionally rather than validate.
    return stripCitationMarkers(raw).slice(0, MAX_BIO_LENGTH);
}

/** Capped doc slice for prompt injection (askArtist / funFacts / bio). Null when no doc. */
/**
 * Rebuild the knowledge document from the artist's CURRENT sources.
 *
 * The document was written once, at publish, and then never again — while the
 * sources under it stayed editable. So an artist who removed a bad source kept a
 * document that cited it forever, and the Ask section kept answering from it.
 * Removing a marketplace directory from the vault did nothing whatsoever. The
 * document is invisible in the product (there is no view or edit surface for
 * it), so there was no way to notice, either.
 *
 * Deliberately does NOT touch `artists.bio`. The About belongs to the artist and
 * may have been hand-edited; the document is ours. Publish stays the only moment
 * that writes a bio implicitly.
 *
 * No-ops when the artist has no document — nothing to refresh, and creating one
 * outside onboarding would be a different feature. Never throws: this runs
 * fire-and-forget behind a user action that has already succeeded, so a Gemini
 * failure must not turn a successful removal into an error.
 */
export async function refreshArtistDoc(artistId: string): Promise<boolean> {
    try {
        if (!(await getArtistDoc(artistId))) return false;
        const sources = await buildDocSources(artistId);
        const doc = await synthesizeArtistDoc(artistId, sources);
        await upsertArtistDoc(artistId, doc);
        await upsertArtistDocSources(artistId, sources);
        console.log(`[refreshArtistDoc] Rebuilt doc for ${artistId} from ${sources.length} sources`);
        return true;
    } catch (e) {
        console.error("[refreshArtistDoc] Failed:", e);
        return false;
    }
}

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
