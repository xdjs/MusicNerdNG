/**
 * Post-claim onboarding: turns an artist's ingested social signals (see
 * socialSignals.ts) into a handful of specific, warm interview questions.
 * Gemini is UNGROUNDED — we already have the facts (the signals); its only
 * job is to phrase a good question, never to introduce new claims.
 *
 * Framing rule (product-owner-caught, see design doc): a scraped feed
 * includes posts authored by OTHER people where the artist is a
 * collaborator. Never let a question attribute a foreign owner's caption or
 * words to the artist. This is enforced twice:
 *   1. By construction — `key`, `sourceUrls`, and `kind` are always taken
 *      from OUR signal object, never from the model's output. The model
 *      only supplies `question` + `rationale`, and only for a `signalId` we
 *      handed it; anything else is dropped.
 *   2. By prompt — each candidate is labelled `authoredBy: "artist"` or
 *      `authoredBy: "@handle"`, with explicit instructions on how to frame
 *      each case.
 */
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getSocialPostsForArtist } from "@/server/utils/socialIngest";
import { deriveSocialSignals, type SocialSignals } from "@/server/utils/socialSignals";
import { creditedCollaborators, type CaptionExtraction } from "@/server/utils/socialCredits";
import { getSocialCredits } from "@/server/utils/queries/socialCreditQueries";

export type GroundedQuestionKind = "collaborator" | "theme" | "standout" | "music" | "credit" | "statement";

/** Every GroundedQuestion `key` is built as `social_${kind}_...` (see
 *  buildCandidates below) — exported so callers (turnHandlers.ts) can tell a
 *  grounded key apart from a static ONBOARDING_QUESTIONS key without
 *  re-deriving the full candidate list. */
export const GROUNDED_QUESTION_KEY_PREFIX = "social_";

export interface GroundedQuestion {
    key: string;
    question: string;
    rationale: string;
    sourceUrls: string[];
    kind: GroundedQuestionKind;
}

const DEFAULT_MAX_QUESTIONS = 6;
const GENERATION_TIMEOUT_MS = 20_000;
const TOP_COLLABORATORS = 3;
const TOP_THEMES = 3;
const TOP_STANDOUTS = 2;
const TOP_MUSIC = 3;
/** Credits are the strongest material we have — a named person, a stated role,
 *  in the artist's own words — so more of them are offered than of any counted
 *  signal. */
const TOP_CREDITS = 4;
const TOP_STATEMENTS = 4;

// Short-lived in-process cache for generateGroundedQuestions, keyed by
// artistId (+ requested `max`, see below). Onboarding chat turns are
// stateless — the interview step (turnHandlers.ts) calls this fresh on every
// turn it re-enters, so without a cache a single 3-question interview pays a
// ~12s Gemini round trip up to THREE times. Same shape as `bioRegenTimestamps`
// in dashboardActions.ts: a module-level Map with a TTL, a soft size cap, and
// prune-on-write.
//
// Serverless caveat: this lives in the Node process's memory, not shared
// across workers/regions and wiped on a cold start — best-effort only.
// Correctness never depends on it: a miss (cold start, TTL expiry, or an
// artist not seen yet) just regenerates via the normal path below, with the
// exact same deterministic candidate keys.
//
// Keyed by `${artistId}::${max}`, not artistId alone, so a cache entry can
// never be handed back for a different `max` than it was generated for — in
// practice every caller today passes the same INTERVIEW_QUESTION_CAP, so this
// is a correctness safety net more than a real dimension of variation.
//
// Only a successful generation is cached — including a Gemini call that
// legitimately returns [] (the model dropped every candidate signal). That
// result cost the full ~12s and is stable for the rest of the session, so
// it's worth caching. A thrown/timed-out Gemini call is NOT cached: that's a
// transient failure, and the next turn should get a fresh attempt rather than
// being stuck replaying a failure for the full TTL.
interface GroundedQuestionsCacheEntry {
    value: GroundedQuestion[];
    expiresAt: number;
}
const groundedQuestionsCache = new Map<string, GroundedQuestionsCacheEntry>();
const GROUNDED_QUESTIONS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes — comfortably longer than one onboarding session
const GROUNDED_QUESTIONS_CACHE_SOFT_CAP = 1_000;
function pruneGroundedQuestionsCache(now: number): void {
    if (groundedQuestionsCache.size <= GROUNDED_QUESTIONS_CACHE_SOFT_CAP) return;
    // First pass: drop entries that have already expired — those can't
    // possibly be served again.
    for (const [k, entry] of groundedQuestionsCache) {
        if (entry.expiresAt <= now) groundedQuestionsCache.delete(k);
    }
    // Belt and suspenders: if a worker somehow racked up 1k live entries
    // anyway, nuke the whole map. Worst case is one extra regeneration per
    // artist on the next request — best-effort cache, by design.
    if (groundedQuestionsCache.size > GROUNDED_QUESTIONS_CACHE_SOFT_CAP) groundedQuestionsCache.clear();
}

/** One candidate handed to Gemini. `key`/`sourceUrls`/`kind` never come back
 *  from the model — they're read off this object after the model picks a
 *  `signalId`, which is what makes fabrication structurally impossible
 *  rather than merely prompt-discouraged. */
interface SignalCandidate {
    signalId: string;
    kind: GroundedQuestionKind;
    key: string;
    authoredBy: string; // "artist" or "@handle"
    material: string;
    sourceUrls: string[];
}

function slug(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "x";
}

/** Instagram shortcode from a `/p/<code>/` URL — stable identifier for a
 *  post that doesn't encode any count/rank (a re-scrape can't change it). */
function shortCodeFromUrl(url: string): string {
    const m = url.match(/\/p\/([^/]+)\/?/);
    return m ? m[1] : slug(url);
}

function buildCandidates(signals: SocialSignals, artistName: string, extraction: CaptionExtraction): SignalCandidate[] {
    const candidates: SignalCandidate[] = [];

    // Role credits first. "Mixing & Mastering Engineer: @p3t3rango" is a named
    // person doing a stated job, written by the artist — strictly better
    // material than any term we arrived at by counting, and for an artist who
    // never uses Instagram's coauthor tags it is the only collaboration
    // evidence that exists. Self-credits are excluded by creditedCollaborators:
    // "Recording Engineer: Pharaoh Sistare" is a fact about him, not a
    // relationship to ask him about.
    for (const c of creditedCollaborators(extraction).slice(0, TOP_CREDITS)) {
        const subject = c.isHandle ? `@${c.subject}` : c.subject;
        candidates.push({
            signalId: `credit_${slug(c.subject)}`,
            kind: "credit",
            key: `social_credit_${slug(c.subject)}`,
            authoredBy: "artist",
            material: `In their own caption${c.evidenceUrls.length > 1 ? "s" : ""}, ${artistName} credits ${subject} as: ${c.roles.join("; ")}. This is ${artistName}'s own wording, on ${c.evidenceUrls.length} post(s).`,
            sourceUrls: c.evidenceUrls,
        });
    }

    // Things the artist said about their own work. The material IS the quote,
    // so a question built from it can respond to what they actually wrote
    // rather than to a word that appeared often.
    for (const s of extraction.statements.slice(0, TOP_STATEMENTS)) {
        candidates.push({
            signalId: `statement_${shortCodeFromUrl(s.url)}_${slug(s.topic)}`,
            kind: "statement",
            key: `social_statement_${shortCodeFromUrl(s.url)}_${slug(s.topic)}`,
            authoredBy: "artist",
            material: `${artistName} wrote, about ${s.topic}: "${s.quote}"`,
            sourceUrls: [s.url],
        });
    }

    for (const c of [...signals.collaborators].sort((a, b) => b.postCount - a.postCount).slice(0, TOP_COLLABORATORS)) {
        candidates.push({
            signalId: `collab_${slug(c.handle)}`,
            kind: "collaborator",
            key: `social_collaborator_${slug(c.handle)}`,
            authoredBy: `@${c.handle}`,
            material: `${artistName} has collaborated with / appeared in posts with @${c.handle} across ${c.postCount} Instagram post(s). This is a real, mutual collaboration (co-authored or cross-posted), not a one-way mention.`,
            sourceUrls: c.evidenceUrls,
        });
    }

    // The same term can legitimately surface as both a hashtag and a caption
    // word (e.g. a caption literally containing "#midjourney"). Dedupe by
    // term so the artist is never asked near-identical questions about the
    // same word twice under two different keys — hashtag wins ties since
    // it's the more deliberate signal.
    const themesByTerm = new Map<string, SocialSignals["themes"][number]>();
    for (const t of signals.themes) {
        const termKey = slug(t.term);
        const existing = themesByTerm.get(termKey);
        if (!existing || t.count > existing.count || (t.count === existing.count && t.kind === "hashtag")) {
            themesByTerm.set(termKey, t);
        }
    }
    for (const t of [...themesByTerm.values()].sort((a, b) => b.count - a.count).slice(0, TOP_THEMES)) {
        const termNoun = t.kind === "hashtag" ? "hashtag" : t.kind === "caption_phrase" ? "phrase" : "word";
        candidates.push({
            signalId: `theme_${t.kind}_${slug(t.term)}`,
            kind: "theme",
            key: `social_theme_${t.kind}_${slug(t.term)}`,
            authoredBy: "artist",
            material: `${artistName} recurringly uses the ${termNoun} "${t.term}" in their own Instagram captions (appears in ${t.count} of their own posts).`,
            sourceUrls: t.evidenceUrls,
        });
    }

    for (const s of [...signals.standoutPosts].sort((a, b) => b.multiple - a.multiple).slice(0, TOP_STANDOUTS)) {
        candidates.push({
            signalId: `standout_${shortCodeFromUrl(s.url)}`,
            kind: "standout",
            key: `social_standout_${shortCodeFromUrl(s.url)}`,
            authoredBy: "artist",
            material: `One of ${artistName}'s own posts noticeably outperformed their typical ${s.metric} on Instagram (roughly ${s.multiple}x their usual). Its caption: ${s.caption ? `"${s.caption}"` : "(no caption)"}`,
            sourceUrls: [s.url],
        });
    }

    for (const m of [...signals.musicReferences].sort((a, b) => b.evidenceUrls.length - a.evidenceUrls.length).slice(0, TOP_MUSIC)) {
        candidates.push({
            signalId: `music_${slug(m.title)}_${slug(m.artist)}`,
            kind: "music",
            key: `social_music_${slug(m.title)}_${slug(m.artist)}`,
            authoredBy: m.postedByOwn ? "artist" : `@${m.ownerUsername}`,
            material: m.postedByOwn
                ? `${artistName} tagged the track "${m.title}" by ${m.artist} on their own Instagram post.`
                : `The track "${m.title}" by ${m.artist} appears on a post from @${m.ownerUsername} that ${artistName} is connected to (NOT ${artistName}'s own post).`,
            sourceUrls: m.evidenceUrls,
        });
    }

    return candidates;
}

const QUESTION_SYSTEM_INSTRUCTION = (artistName: string) => `You are a warm, well-prepared music journalist about to interview the artist "${artistName}". Below is a JSON array of SIGNALS — real, verified facts pulled from their Instagram. This is the ONLY material you may draw on; you know nothing else about them.

Each signal has:
- signalId: an opaque id you MUST echo back EXACTLY as given. Never invent a signalId.
- kind: collaborator | theme | standout | music | credit | statement
- authoredBy: "artist" if this is ${artistName}'s own post/words, or "@handle" if the material comes from SOMEONE ELSE's post (a collaborator's post that ${artistName} appears in or is connected to)
- material: what you actually know about this signal

Prefer "credit" and "statement" signals over the others. A credit is a named person doing a stated job in ${artistName}'s own words; a statement is something ${artistName} actually wrote about their own work. Both are far better material than a term that merely recurred, and a good interviewer would reach for them first.

Rules:
- You do NOT have to use every signal. Being grounded in a real fact is necessary but not sufficient — a signal can be 100% true and still make a bad question. DROP any signal that is technically real but would come across as a machine noticing a pattern rather than a person who actually paid attention: a common word that just happens to repeat, a burst of activity with nothing memorable to name, anything a generic analytics dashboard could have surfaced. Keep only the ones a genuinely curious, well-prepared journalist would actually ask about.
- It is strictly better to return 2-3 sharp, specific questions than 5-6 uneven ones. Do not pad the list to cover more signals — quality and hit rate matter more than count.
- Write ONE short, specific, curious interview question per signal you choose to keep — the kind of question that shows you actually looked, not a generic one that could apply to anyone.
- If authoredBy is "artist", you may reference or lightly quote their own words/caption.
- If authoredBy is "@handle" (NOT the artist), you must NEVER say or imply that ${artistName} wrote, said, or posted that caption/material — it belongs to the other account. Frame the question around the relationship or collaboration instead. Example: material from @dameatlas's post about a joint track → "You and @dameatlas put out that track together — what's the story behind it?" NOT "You said/posted...".
- Never fabricate anything beyond what "material" states. If a signal doesn't give you enough for a real, specific question, skip it entirely — do not force one.
- A question must be about the specific post(s) named in that signal's material — nothing else. Never generalize a single post into a pattern (e.g. turning one post that used a track into "you posted quite a bit about X" or "you post about X a lot") — say what the post actually was, not a habit you're inferring from it.
- No engagement-metric language in the question text itself. Never say a number, "plays", "likes", or "views" in the question. Describe the feeling or moment instead — "that one clearly struck a nerve" is fine, "your post got 8,285 plays" is not.
- Plain spoken language, one sentence, never clinical, never creepy, never over-familiar.
- Use ONLY signalIds from the list you were given. Do not process the same signalId twice.

Return STRICT JSON ONLY — an array of objects: [{ "signalId": string, "question": string, "rationale": string }]. "rationale" is one short internal phrase (not shown to the artist) noting why it's worth asking. Return [] if nothing in the signals is worth asking about. No markdown fences, no commentary, JSON only.`;

function withTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("questionGenerator timeout")), GENERATION_TIMEOUT_MS)),
    ]);
}

function stripJsonFences(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1] : trimmed;
}

interface ModelAnswer {
    signalId?: unknown;
    question?: unknown;
    rationale?: unknown;
}

function parseModelAnswers(text: string): ModelAnswer[] {
    try {
        const parsed = JSON.parse(stripJsonFences(text));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Generates up to `opts.max` (default 6) grounded interview questions from
 * an artist's ingested social posts. Every question traces back to a real
 * signal with real source URLs — nothing the model says is trusted for
 * `key`/`sourceUrls`/`kind`, only for `question`/`rationale`, and only for a
 * `signalId` we ourselves supplied. Bound to ~20s; degrades to `[]` on any
 * failure (missing artist, no posts, Gemini down/timeout/bad output) so the
 * interview always falls back to the static three questions.
 *
 * Cached per `artistId`+`max` for `GROUNDED_QUESTIONS_CACHE_TTL_MS` — see the
 * cache comment above — so repeated calls within one onboarding session (the
 * interview step calls this on every turn it re-enters) reuse the first
 * result instead of paying another ~12s Gemini round trip.
 */
export async function generateGroundedQuestions(
    artistId: string,
    opts?: { max?: number },
): Promise<GroundedQuestion[]> {
    const max = Math.max(0, opts?.max ?? DEFAULT_MAX_QUESTIONS);
    if (!artistId || max === 0) return [];

    const cacheKey = `${artistId}::${max}`;
    const now = Date.now();
    const cached = groundedQuestionsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

    try {
        const artist = await getArtistById(artistId);
        if (!artist) return [];
        const artistName = artist.name ?? "the artist";

        const posts = await getSocialPostsForArtist(artistId);
        if (posts.length === 0) return [];

        const signals = deriveSocialSignals(posts, artist.instagram ?? "", artistName);
        // Stored, not recomputed — see socialCredits.ts. An artist whose
        // captions have not been read yet simply contributes no credit
        // candidates, exactly as before this existed.
        const extraction = await getSocialCredits(artistId);
        const candidates = buildCandidates(signals, artistName, extraction);
        if (candidates.length === 0) return [];

        const byId = new Map(candidates.map(c => [c.signalId, c]));
        const promptPayload = candidates.map(({ signalId, kind, authoredBy, material }) => ({ signalId, kind, authoredBy, material }));

        const response = await withTimeout(
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: `SIGNALS:\n${JSON.stringify(promptPayload, null, 2)}\n\nChoose at most ${max} of the most interesting, distinct signals and write one question each. Fewer than ${max} is fine — even zero — if the rest don't clear the bar.`,
                config: {
                    systemInstruction: QUESTION_SYSTEM_INSTRUCTION(artistName),
                    // Low, not zero: enough room for natural phrasing, but low
                    // enough that WHICH signals get selected stays stable
                    // across repeated calls in the same onboarding (the
                    // interview step regenerates on every question — see
                    // turnHandlers.ts — so signal-selection churn between
                    // calls would read as the interviewer changing its mind).
                    temperature: 0.2,
                    responseMimeType: "application/json",
                },
            }),
        );

        const text = response.text;
        if (!text) return [];

        const answers = parseModelAnswers(text);
        const seen = new Set<string>();
        const questions: GroundedQuestion[] = [];

        for (const answer of answers) {
            if (questions.length >= max) break;
            const signalId = typeof answer.signalId === "string" ? answer.signalId : null;
            const question = typeof answer.question === "string" ? answer.question.trim() : "";
            if (!signalId || !question || seen.has(signalId)) continue;
            const candidate = byId.get(signalId); // join-back: only signalIds WE supplied are honored
            if (!candidate) continue;
            seen.add(signalId);
            questions.push({
                key: candidate.key,
                question,
                rationale: typeof answer.rationale === "string" ? answer.rationale : "",
                sourceUrls: candidate.sourceUrls,
                kind: candidate.kind,
            });
        }

        pruneGroundedQuestionsCache(now);
        groundedQuestionsCache.set(cacheKey, { value: questions, expiresAt: now + GROUNDED_QUESTIONS_CACHE_TTL_MS });
        return questions;
    } catch (e) {
        console.error("[generateGroundedQuestions] Error:", e);
        return [];
    }
}
