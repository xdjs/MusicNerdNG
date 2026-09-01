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
import { creditedCollaborators, type CaptionExtraction, type CaptionCredit, type ArtistStatement } from "@/server/utils/socialCredits";
import { getSocialCredits } from "@/server/utils/queries/socialCreditQueries";

export type GroundedQuestionKind =
    | "collaborator" | "theme" | "standout" | "music" | "credit" | "statement"
    /** A relationship COMPUTED from the posts rather than guessed: the same
     *  person credited across several of them, or two things said in one. */
    | "partnership" | "same_post";

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

/**
 * How many questions to DRAFT for every one we need.
 *
 * The fact-checker is strict on purpose and rejects most of what it is handed —
 * it is what stops "André introduced him to samplers and computers" reaching an
 * artist, which is a real thing this generator produced about Pete Rango. But
 * drafting exactly as many questions as we need means the yield is the pass
 * rate, not the number asked for.
 *
 * Measured on Pete Rango: 299 posts, 672 credits and 267 statements produce
 * roughly twenty-five candidate signals. We asked for three, three were
 * drafted, the checker rejected two, and one survived — so the interview
 * filled the other two slots with the generic fallbacks ("describe your
 * sound") while hundreds of specific things sat unused. That reads as the
 * generator having nothing to say when the truth is the opposite.
 *
 * Verification is ONE batched call regardless of how many questions go into
 * it, so drafting more costs no extra round-trip.
 */
const DRAFT_OVERSAMPLE = 2;   // 3 asked for nine questions and blew the budget

/** Ceiling on the oversample, so a large `max` cannot ask the model to write
 *  more questions than there are good signals to write them from. */
const MAX_DRAFTS = 6;
/**
 * MEASURED, not guessed. Three runs against Pete Rango's real feed took 17.8s,
 * 21.5s and 19.8s — this was 20s, so the call was already failing about a
 * third of the time and a timeout means ZERO grounded questions and three
 * generic fallbacks. That is exactly the symptom Pete reported, and drafting
 * more questions per run made it worse rather than causing it.
 *
 * 30s leaves real headroom above the observed spread. Worst case is this plus
 * VERIFIER_TIMEOUT_MS (12s) = 42s, inside the onboarding turn's ~55s deadline,
 * and both are races that degrade to "no grounded questions" rather than
 * hanging the turn.
 */
const GENERATION_TIMEOUT_MS = 30_000;
const TOP_COLLABORATORS = 3;
/** ONE, not three. Pete Rango's top recurring caption words are "music" (6
 *  posts), "artists" (5), "artist creative" (3) — a musician using the word
 *  "music" is the job, not a signal, and the instruction already tells the
 *  model to drop "a common word that just happens to repeat". Three of about
 *  twenty-five candidate slots went on material we had told it to reject.
 *  One rather than zero: the extraction is fine, the MATERIAL is thin, and
 *  that is worth revisiting rather than deleting. */
const TOP_THEMES = 1;
/** Raised with a slot the themes gave back. These are the strongest
 *  single-post signals — on Pete's feed the Colombia earthquake page (7.6x his
 *  usual plays) and losing his cousin André (3.1x likes) — and they got two. */
const TOP_STANDOUTS = 3;
const TOP_MUSIC = 3;
/** Credits are the strongest material we have — a named person, a stated role,
 *  in the artist's own words — so more of them are offered than of any counted
 *  signal. */
const TOP_CREDITS = 4;
/** Statements are the artist's own words about their own life, and they are the
 *  most numerous signal by far — Pete Rango has 268. Four was the narrowest
 *  window of any kind here, and unlike every other kind it was not even ranked:
 *  the first four in database order, forever. Widened so the model has a real
 *  choice to make. */
const TOP_STATEMENTS = 10;

/** No caption owns the window. One of Pete's produced twelve separate
 *  "statements" — the same reflection re-topiced — and would have taken the
 *  whole slice on its own. */
const MAX_STATEMENTS_PER_POST = 2;

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

/** Letters and digits of any script, so a name outside ASCII still identifies
 *  one person. `slug` below is ASCII-only and stays that way for the callers
 *  that key on urls and hashtags, where ASCII is the alphabet in use. */
function unicodeSlug(s: string): string {
    return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "").slice(0, 60) || "x";
}

/** Exported for tests only — the key-churn guarantee is the whole reason this
 *  regex is what it is, and it needs pinning. */
export const slugForTest = (s: string): string => slug(s);

function slug(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFKD")
        // `\w` IS ASCII-ONLY, so every non-Latin name collapsed to "x" and two
        // of them collided on one signalId — byId keeps the last, and their
        // answers overwrite each other under the unique (artist, questionKey)
        // index. The credit signal was moved to `unicodeSlug` for this and the
        // other five call sites were left behind; fixing the shared helper
        // covers all of them at once.
        //
        // UNDERSCORE STAYS IN THE CLASS. `\w` counts "_" as a word character,
        // so it never collapsed a run containing one; a bare \p{L}\p{N} class
        // does not, and folds "cool__guy" to "cool_guy" and "the_.kid" to
        // "the_kid". Instagram handles mix "." and "_" freely, so that is a
        // real shape, and a changed key silently orphans the answer stored
        // under the old one — the very churn this was written to avoid.
        //
        // ZERO KEY CHURN, which is why this rather than swapping call sites:
        // with "_" kept, ASCII input is byte-identical to the old output, so no
        // stored questionKey moves. `unicodeSlug` would have changed them via
        // its longer slice. Found in review — my first version dropped the
        // underscore and I verified byte-identity only against the strings we
        // happen to hold, which is not the same as verifying the rule.
        .replace(/[^\p{L}\p{N}_]+/gu, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "x";
}

/** Instagram shortcode from a `/p/<code>/` URL — stable identifier for a
 *  post that doesn't encode any count/rank (a re-scrape can't change it). */
function shortCodeFromUrl(url: string): string {
    const m = url.match(/\/p\/([^/]+)\/?/);
    return m ? m[1] : slug(url);
}

/** How many recurring-collaborator and same-post relationships to offer. These
 *  are the best material we have, so they get room, but a list of twenty
 *  crowds out everything else. */
const TOP_PARTNERSHIPS = 3;
const TOP_SAME_POST = 3;

/**
 * Which of an artist's statements are worth asking about, and in what order.
 *
 * This was `statements.slice(0, 4)` — no ranking, no dedup, whatever order
 * Postgres returned. Pete Rango has 268 statements and the same four were
 * offered on every run forever, which is exactly what he saw: "it just seems
 * like I'm getting the same questions every time."
 *
 * TWO PROBLEMS, and dedup is the bigger one. Those 268 come from 115 posts —
 * 2.33 per caption — and 88 repeat a quote already stored. One caption produced
 * TWELVE: "discovery of web3 and its impact", "...and its impact on art",
 * "...and its impact on creative process" — one sentence sliced three ways.
 * Any window spends its slots on the same caption rephrased.
 *
 * THE ORDER, measured against four candidates on Pete's real feed and chosen by
 * him: statements that NAME SOMEBODY or say something SUBSTANTIAL first, newest
 * breaking the tie. Naming a person is what turns "his philosophy on self" into
 * "why he chose SuperCollector" or "running a Hammond XB-2" — a decision only
 * the artist can explain. Length is a weak proxy for having actually said
 * something, so it ranks below naming and is bucketed rather than compared
 * outright: three long captions must not crowd out three interesting ones.
 *
 * Recency alone was rejected on the evidence — it clusters, and on this feed it
 * returned four near-identical statements about the same recent bereavement.
 */
export function rankStatements(statements: ArtistStatement[]): ArtistStatement[] {
    const seenQuote: string[] = [];
    const perPost = new Map<string, number>();
    const deduped: ArtistStatement[] = [];
    /** One of these is a re-cut of the other when either starts with the other.
     *  A fixed-length prefix key is not enough: the extractor's copies differ
     *  by where it stopped, so "...changed how I think about art" and
     *  "...changed how I think about art entirely" hash differently and both
     *  survive. The floor stops two genuinely different short statements
     *  collapsing because they open the same way. */
    const isRecutOf = (a: string, b: string): boolean =>
        Math.min(a.length, b.length) >= 40 && (a.startsWith(b) || b.startsWith(a));
    for (const s of statements) {
        const key = (s.quote ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!key || seenQuote.some(k => k === key || isRecutOf(k, key))) continue;
        // AND A CEILING PER CAPTION. Deduping quotes alone still let one post
        // contribute a dozen genuinely different sentences and crowd out 114
        // other posts.
        const used = perPost.get(s.url) ?? 0;
        if (used >= MAX_STATEMENTS_PER_POST) continue;
        seenQuote.push(key);
        perPost.set(s.url, used + 1);
        deduped.push(s);
    }

    const namesSomebody = (s: ArtistStatement): boolean => /@[A-Za-z0-9._]{3,}/.test(s.quote ?? "");
    const substance = (s: ArtistStatement): number => {
        const n = (s.quote ?? "").length;
        return n > 300 ? 2 : n > 120 ? 1 : 0;
    };
    const score = (s: ArtistStatement): number => (namesSomebody(s) ? 3 : 0) + substance(s);
    return [...deduped].sort((a, b) =>
        score(b) - score(a)
        || String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? "")));
}

/**
 * Relationships, joined here rather than guessed by the model.
 *
 * THIS IS THE FIX FOR THE WHOLE CLASS. Letting the model pick two signals and
 * hypothesise a link between them produced a question telling Pharaoh Sistare
 * that @p3t3rango engineered "Hourglass & The Flame". One signal said Pharaoh
 * credits p3t3rango; another said what Hourglass sounds like; the join was
 * invented, and the two facts come from four different posts. A fact-checker
 * could not see it either, because merging the two sources destroyed the only
 * evidence that would have shown it — which post each fact came from.
 *
 * So the interesting question still gets asked, and the connection inside it is
 * one we computed and can point at:
 *
 *   - the same person credited across SEVERAL posts, which is a working
 *     relationship rather than a one-off;
 *   - two things said in ONE post, which are connected because the artist put
 *     them together.
 *
 * Each asserts only what the join proves. Neither can put somebody on a record
 * they were not credited on, because the evidence travels with the claim.
 */
function relationshipCandidates(artistName: string, extraction: CaptionExtraction): SignalCandidate[] {
    const out: SignalCandidate[] = [];

    // A collaborator who keeps coming back. `creditedCollaborators` already
    // groups by person and collects every post they were credited on; two or
    // more is a relationship, one is an anecdote.
    for (const c of creditedCollaborators(extraction).filter(c => c.evidenceUrls.length >= 2).slice(0, TOP_PARTNERSHIPS)) {
        const subject = c.isHandle ? `@${c.subject}` : c.subject;
        // UNICODE. `slug` is ASCII-only and reduces a Japanese or Korean name
        // to "x", so two such collaborators would share a signalId — the byId
        // map would keep only the last, and their answers would overwrite each
        // other under the unique (artist, questionKey) index. Same bug as the
        // release keys, in the place I did not look.
        const id = unicodeSlug(c.subject);
        out.push({
            signalId: `partnership_${id}`,
            kind: "partnership",
            key: `social_partnership_${id}`,
            authoredBy: "artist",
            // ONLY THE ROLES THAT RECUR, and no number.
            //
            // This listed every label from every post — "main production
            // partner; created with; added some 808s; Prod by" — which
            // presents a ONE-OFF as a description of the whole relationship.
            // Those 808s were a single caption, and that caption says the
            // files were LOST and never used. The question that came out
            // asked Pete about "adding some 808s across many posts".
            //
            // Recurring roles are what the relationship IS. A one-off belongs
            // to the specific post it happened on, and there is a `credit`
            // signal for exactly that.
            //
            // The count is gone too. It was the source of "across 23 posts" in
            // every question of a real run: given a number, the model recites
            // it. `boilerplateReason` rejects that on the way out; not handing
            // it over in the first place is better.
            material: `${artistName} has credited ${subject} on several SEPARATE posts, in their own words each time`
                + (c.recurringRoles.length > 0
                    ? `, repeatedly as: ${c.recurringRoles.join("; ")}.`
                    : `.`)
                + ` That is a working relationship rather than a one-off. NOTE: this says only that ${subject} was credited on those posts — it does NOT say which records those posts were about, you must not attach ${subject} to any release you were told about elsewhere, and you must not describe them with a role that is not listed here.`,
            sourceUrls: c.evidenceUrls,
        });
    }

    // Two things the artist put in the SAME post. Connected because they said
    // them together, which is a fact rather than an inference.
    const byPost = new Map<string, { credits: CaptionCredit[]; statements: ArtistStatement[] }>();
    for (const c of extraction.credits) {
        if (c.isSelf || !c.url) continue;
        const at = byPost.get(c.url) ?? { credits: [], statements: [] };
        at.credits.push(c);
        byPost.set(c.url, at);
    }
    for (const st of extraction.statements) {
        if (!st.url) continue;
        const at = byPost.get(st.url) ?? { credits: [], statements: [] };
        at.statements.push(st);
        byPost.set(st.url, at);
    }
    const pairs = [...byPost.entries()]
        // EXACTLY ONE CREDIT. A post with several is a roundup — Pete Rango has
        // one covering a day in New York that names nine people across a
        // rehearsal, a house party, a trombonist he heard in the street and a
        // bar — and picking the first credit and the first statement out of
        // that pairs two things at random.
        //
        // One credit beside something the artist said is unambiguous: there is
        // only one person in the post and only one thing to be talking about.
        .filter(([, v]) => v.credits.length === 1 && v.statements.length > 0)
        .slice(0, TOP_SAME_POST);
    for (const [url, v] of pairs) {
        const credit = v.credits[0];
        const statement = v.statements[0];
        const subject = credit.isHandle ? `@${credit.subject}` : credit.subject;
        out.push({
            signalId: `same_post_${shortCodeFromUrl(url)}`,
            kind: "same_post",
            key: `social_same_post_${shortCodeFromUrl(url)}`,
            authoredBy: "artist",
            // STATES THE JOIN AND NOTHING MORE. The first version ended "so
            // they are genuinely about the same piece of work", which is an
            // inference, not the join — and asserting it in the material handed
            // the fact-checker a falsehood as evidence, so it could not
            // possibly have caught it. Co-occurrence in one post is the fact.
            // Whether they are about the same record is the artist's to say,
            // which is what makes it a question worth asking.
            material: `IN ONE POST, ${artistName} credited ${subject} as "${credit.role}" and also wrote, about ${statement.topic}: "${statement.quote}". The only thing this establishes is that they said both in the same post. It does NOT establish that ${subject} worked on whatever the writing is about — ask about that rather than asserting it.`,
            sourceUrls: [url],
        });
    }
    return out;
}

function buildCandidates(signals: SocialSignals, artistName: string, extraction: CaptionExtraction): SignalCandidate[] {
    // Relationships first: they are the only candidates that carry a verified
    // connection, and the prompt is told to reach for them.
    const candidates: SignalCandidate[] = relationshipCandidates(artistName, extraction);

    // Role credits first. "Mixing & Mastering Engineer: @p3t3rango" is a named
    // person doing a stated job, written by the artist — strictly better
    // material than any term we arrived at by counting, and for an artist who
    // never uses Instagram's coauthor tags it is the only collaboration
    // evidence that exists. Self-credits are excluded by creditedCollaborators:
    // "Recording Engineer: Pharaoh Sistare" is a fact about him, not a
    // relationship to ask him about.
    for (const c of creditedCollaborators(extraction).slice(0, TOP_CREDITS)) {
        const subject = c.isHandle ? `@${c.subject}` : c.subject;
        // `unicodeSlug`, not `slug`. The ASCII one reduces a Japanese or Korean
        // name to "x", so two such collaborators collide on signalId — byId
        // keeps only the last, and their answers overwrite each other under the
        // unique (artist, questionKey) index. Fixed in the partnership signal
        // and left live here, which is the half-fix this file keeps producing.
        const id = unicodeSlug(c.subject);
        // THE SENTENCE, NOT THE LABEL.
        //
        // This handed over bare labels — "main production partner; added some
        // 808s; breath church" — which is not what the artist wrote, and
        // stripping the sentence strips the only thing that makes the label
        // mean anything. Pete's caption says "Alan had added some 808s for the
        // outro BUT THOSE FILES WERE LOST...so we ended up leaving as is". From
        // the label alone the model asked which track his 808s changed the feel
        // of. They are not on any track.
        //
        // Quoting the artist is also the standing instruction elsewhere in this
        // prompt: "when in doubt, quote the artist's own words rather than
        // paraphrasing them".
        const quotes = [...new Set(c.quotes.map(q => q.trim()).filter(Boolean))].slice(0, 3);
        candidates.push({
            signalId: `credit_${id}`,
            kind: "credit",
            key: `social_credit_${id}`,
            authoredBy: "artist",
            material: `${artistName} wrote these about ${subject}. Each line below is ONE caption:\n`
                + quotes.map(q => `  "${q}"`).join("\n")
                + `\nAnything inside a single line was written together and belongs together. Facts from DIFFERENT lines do not: they are separate posts about separate occasions, so do not merge them into one description of ${subject}, and do not present something from one post as what they generally do. Read what the sentences actually say — they may contradict what the phrasing suggests.`,
            sourceUrls: c.evidenceUrls,
        });
    }

    // Things the artist said about their own work. The material IS the quote,
    // so a question built from it can respond to what they actually wrote
    // rather than to a word that appeared often.
    for (const s of rankStatements(extraction.statements).slice(0, TOP_STATEMENTS)) {
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

NOT EVERY QUESTION IS ABOUT SOMEBODY ELSE. Credits and partnerships are rich, and left alone they turn an interview into a tour of the artist's contact list. At most half your questions may be about a named collaborator; the rest must come from what ${artistName} said or made — a statement in their own words, a track, a thing they posted about. Prefer "credit" and "statement" signals over the others. A credit is a named person doing a stated job in ${artistName}'s own words; a statement is something ${artistName} actually wrote about their own work. Both are far better material than a term that merely recurred, and a good interviewer would reach for them first.

SOME SIGNALS ARE RELATIONSHIPS, AND THEY ARE YOUR BEST MATERIAL. A signal of kind "partnership" or "same_post" is a connection we have already verified against the posts — the same person credited across several records, or two things said in one post. Reach for those: they are how you ask a question that only somebody who read everything could ask.

NEVER BUILD A RELATIONSHIP YOURSELF. If a connection between two facts is not stated inside ONE signal's material, it is not a fact and you may not imply it. Two signals mentioning the same person do not put that person on both records. Two signals from the same artist do not make one the cause of the other. This is the single way these questions go wrong, and it is not recoverable: an artist asked about work they did not do knows immediately that nobody read anything.

ATTRIBUTION IS THE OTHER THING YOU WILL GET WRONG. When you say a NAMED PERSON did something, the material must say THAT PERSON did THAT THING. Do not compress a chain of causes into an agent: if the material says "she gave me the record, and the record made me pick up a sampler", then she gave you a record — she did NOT introduce you to samplers, and writing that puts words in the artist's mouth about somebody else. When in doubt, quote the artist's own words rather than paraphrasing them. Every accurate question you can write is one you could defend by pointing at a sentence.

Rules:
- You do NOT have to use every signal. Being grounded in a real fact is necessary but not sufficient — a signal can be 100% true and still make a bad question. DROP any signal that is technically real but would come across as a machine noticing a pattern rather than a person who actually paid attention: a common word that just happens to repeat, a burst of activity with nothing memorable to name, anything a generic analytics dashboard could have surfaced.
- ONLY the ones that clear the bar. One excellent question is a better outcome than three even ones, and returning fewer is correct rather than a failure. Padding to reach a count is the failure. Look hard for distinct collisions before settling — different pairs, different corners of their work, never three versions of the same question.
- BANNED, because they are what an interviewer who did not do the reading says: "what's the story behind", "what was that like", "what motivated you", "how did that come about", "tell me about", "can you talk about", "what inspired you", "walk me through", "what has that experience been like".
- DO NOT RECAP THEIR POST BACK TO THEM. They know what they posted. At most one short clause of context — roughly a dozen words — then the question. If you are quoting more than about ten words you are stalling. Written as a rule this gets ignored, so here it is as rewrites of real output:
    NO  "You wrote that your cousin André introduced you to 112's 'Part III' and Dr. Dre's '2001', which shifted your perspective on how to create music and brought samplers and computers into your process; what was the first thing you made after that?"
    YES "Your cousin André handed you 112's 'Part III' and Dr. Dre's '2001' — what's the first thing you made after?"
    NO  "You mentioned being a co-owner of Subvert feels like building the music ecosystem artists need; what does an artist actually get there that they didn't have before?"
    YES "You co-own Subvert — what does an artist get there they couldn't get anywhere else?"
    NO  "You described @zavodskyalan as one of your main production partners for years, going back to your first two tracks together; what do you remember about making those first two?"
    YES "@zavodskyalan has been your production partner for years — what do you remember about the first two tracks?"

  CUT THE INTERPRETATION, KEEP THE SPECIFICS. What goes is the part telling the artist what their own words meant — "which shifted your perspective", "which brought samplers into your process". What STAYS is every name, title, date and detail, because that is what lets them place the moment. "Those two albums" is not shorter, it is vaguer: they posted hundreds of times and may not remember which two you mean. Shortening is not the goal — being answerable is, and a question they cannot place is a question they cannot answer.
- Ask something ANSWERABLE and specific: a decision, a moment, a disagreement, a cost, a person. "Who pushed back on that?" beats "what was that process like". You may risk a hypothesis they can confirm or reject — being slightly wrong is better than being vacuous — but phrase it as a question about a possible connection, never as an assertion that the connection exists.
- If authoredBy is "artist", you may quote their own words.
- If authoredBy is "@handle" (NOT the artist), you must NEVER say or imply that ${artistName} wrote, said, or posted that caption/material — it belongs to the other account. Frame the question around the relationship instead.
- Never fabricate anything beyond what "material" states. If a signal doesn't give you enough for a real, specific question, skip it entirely.
- Never generalize a single post into a pattern — say what the post actually was, not a habit you are inferring from it.
- No engagement-metric language. Never say a number, "plays", "likes", or "views".
- NEVER COUNT ANYTHING. Not posts, not times, not years. "Across 23 posts" and "you've mentioned them repeatedly" are the same sentence a dashboard writes; a person who read the feed says "your main production partner" because that is what the artist called them. The counts in the material are for YOU, to decide what matters — they are never for the question.
- NAME THE PARTICULAR THING. The material contains actual specifics: a named track, a role in the artist's own words, a session, a thing that went wrong. Reach into it and ask about ONE of them. "What's a specific moment where their input shaped a track?" is BANNED, along with every variant of it — "what's a specific detail", "one specific example", "a particular instance". Those are "tell me about" with a coat on: they describe a subject and then hand the artist the job of being specific, which is the job you were supposed to do.
- EVERY QUESTION IN THE SET MUST BE A DIFFERENT SHAPE. Not just a different person — a different KIND of question. Four questions of the form "you credited @someone for X; what's a specific Y?" about four different collaborators is one question asked four times, and it reads as a template being filled. If credits are your strongest material, ask at most one or two about credits and find something else for the rest.
- SAY IT OUT LOUD FIRST. You are talking, not writing. If a sentence would sound odd spoken across a table, it is wrong — and "where you felt that shift truly take hold" is not something any person has ever said. Real interviewers use short words and ask about things, not about qualities of things. Contractions are good. Twenty words is plenty; thirty is too many.

  Rewrite anything that sounds like an essay:
    NO  "what was the first track you made where you felt that shift truly take hold?"
    YES "what's the first thing you made after that?"
    NO  "what does that look like in practice for artists using the platform?"
    YES "what does an artist actually get that they didn't have before?"
    NO  "what was a key creative decision they made that shaped the visual identity of the project?"
    YES "what did she want that you argued with?"
    NO  "what truth felt most urgent to express in that period?"
    YES "what did you finally say that you'd been sitting on?"

- BAN THE ABSTRACT NOUNS. "process", "approach", "practice", "identity", "dynamic", "journey", "aspect", "element", "experience", "impact", "vision" — these are the words of somebody describing music rather than making it. Ask about a track, a room, a person, a night, a decision, a thing that broke.
- One sentence. Plain spoken language, never clinical, never creepy, never over-familiar, and never flattering ("powerful", "amazing", "clearly struck a nerve").
- Use ONLY signalIds from the list you were given.

Return STRICT JSON ONLY — an array of objects: [{ "signalId": string, "question": string, "rationale": string }]. "signalId" is exactly one id, echoed exactly. "rationale" is one short internal phrase (not shown to the artist) noting why it's worth asking. Return [] if nothing in the signals is worth asking about. No markdown fences, no commentary, JSON only.`;

/**
 * The two habits the instruction bans and the model does anyway.
 *
 * Both were in the prompt already and both showed up in every question of a
 * real run on Pete Rango's feed, which is the argument for checking in code:
 * a rule the model can ignore is a preference, not a rule.
 *
 * Returns why a question is boilerplate, or null if it is fine.
 */
export function boilerplateReason(question: string): string | null {
    // "Across 23 posts", "on 12 posts", "across many posts" — a count of how
    // often something appears is the sentence an analytics dashboard writes.
    // The counts exist in the material to help CHOOSE what to ask about.
    if (/\b(?:across|over|on|in|through)\s+(?:\d+|many|multiple|several|numerous)\s+(?:posts?|captions?|times?)\b/i.test(question)
        || /\b\d+\s+(?:posts?|captions?)\b/i.test(question)) {
        return "counts how often something appears";
    }
    // "what's a specific moment", "one specific detail", "a particular instance"
    // — describes a subject, then hands the artist the job of being specific.
    if (/\b(?:a|one|any|some)\s+(?:specific|particular)\s+(?:moment|detail|example|instance|thing|time|challenge|decision|project|track|memory)\b/i.test(question)
        || /\bwhat(?:'s| is| was)\s+(?:a|one)\s+(?:specific|particular)\b/i.test(question)) {
        return "asks the artist to supply the specificity";
    }
    // Essay register. An interviewer talking across a table does not say
    // "the conceptual identity of the project" or "your approach to
    // songwriting" — those are the words of somebody describing music rather
    // than making it, and they turn a question into a survey item.
    const ABSTRACT = /\b(?:process|approach|practice|identity|dynamic|journey|aspect|element|experience|impact|vision|creative process|body of work)\b/i;
    if (ABSTRACT.test(question)) return "uses essay-register abstractions";

    // Length is the other tell. Spoken questions are short; a 38-word sentence
    // with two subordinate clauses is written prose. Measured against real
    // output: the good ones ran under twenty words, the bad ones over thirty.
    if (question.trim().split(/\s+/).length > 30) return "too long to be spoken";

    // "What was the process like", "what was that experience like". The
    // instruction bans "what was that like" by name and the model reaches for
    // it anyway with a noun wedged in. It is the emptiest question there is:
    // it asks the artist to decide what the question was.
    if (/\bwhat (?:was|is|were|are)\b[^?]{0,40}\blike\b/i.test(question)) {
        return "asks what something was like";
    }
    return null;
}

/**
 * One question per KIND of question, as far as the set allows.
 *
 * A real run returned four questions of the form "you credited @someone for X;
 * what's a specific Y?" about four different collaborators — one question asked
 * four times. The instruction already said not to; nothing enforced it.
 *
 * Greedy: take the best unused kind each pass, in the model's own ranking, and
 * only start allowing repeats once every kind has had a turn. So a set stays
 * varied when the material is varied, and an artist whose signals really are
 * all credits still gets a full set rather than one question.
 */
/** Kinds that are fundamentally "a question about another person". Four
 *  DIFFERENT kinds all ask about a collaborator, so spreading across kinds is
 *  not enough on its own — a set can be varied by kind and still be three
 *  questions about three of the artist's friends. */
const ABOUT_A_PERSON = new Set(["partnership", "same_post", "credit", "collaborator"]);

/**
 * At most half a set may be about somebody else.
 *
 * Credits are the richest signal we have and the prompt tells the model to
 * reach for them, so left alone the interview becomes a tour of the artist's
 * contact list. Pete: "I don't want every question to always have to do with a
 * collaborator, some could just be about things the artist posted."
 *
 * Applied to the RANKED, VERIFIED set — clean questions first — so the
 * collaborator questions it keeps are the best ones rather than the earliest.
 *
 * This is the second half of a pair. On its own it cannot work: it only sees
 * what was drafted, so if drafting never reached a non-person answer there is
 * nothing here to protect. The two-pass reservation inside
 * `generateGroundedQuestions` — `personSlots`, `deferred`, `deferring` — is
 * what guarantees it has something to work with.
 *
 * Only enforced while something else is actually available: an artist whose
 * material genuinely is all credits gets a full interview rather than one
 * question — Pete, asked directly: "its okay if the model returns only
 * collaborator answers."
 */
function capPersonQuestions<T extends { kind: string }>(items: T[], max: number): T[] {
    // Rounded UP, so an odd `max` allows a bare majority: 2 of 3, 3 of 5. The
    // alternative rounds a three-question interview down to one collaborator,
    // which is thinner than intended when credits are the strongest material
    // an artist has.
    const allowed = Math.max(1, Math.ceil(max / 2));
    // Nothing else to offer — an artist whose material genuinely is all
    // collaborators gets a full interview about collaborators. Pete, asked
    // directly: that is fine.
    if (!items.some(x => !ABOUT_A_PERSON.has(x.kind))) return items;
    const kept: T[] = [];
    let people = 0;
    for (const item of items) {
        if (ABOUT_A_PERSON.has(item.kind)) {
            if (people >= allowed) continue;
            people++;
        }
        kept.push(item);
    }
    return kept;
}

export function diversify<T extends { kind: string }>(items: T[], max: number): T[] {
    const picked: T[] = [];
    const used = new Set<string>();
    const remaining = [...items];
    while (picked.length < max && remaining.length > 0) {
        let i = remaining.findIndex(x => !used.has(x.kind));
        if (i === -1) { used.clear(); i = 0; }   // every kind spent — go round again
        const [item] = remaining.splice(i, 1);
        used.add(item.kind);
        picked.push(item);
    }
    return picked;
}

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
/**
 * Forget the cached questions for one artist.
 *
 * The cache holds for fifteen minutes, and caption extraction takes minutes on
 * a large feed. Onboarding waits for the POSTS to land before generating
 * questions, but not for the CREDITS read out of them — so a fresh run could
 * generate against an empty credits table, cache that answer, and go on asking
 * the three generic questions for the rest of the session even though the
 * credits arrived moments later. The artist gets one interview; it should not
 * be the worse one by a few seconds of timing.
 *
 * Called by ensureSocialCredits once the extraction is stored.
 */
export function forgetGroundedQuestions(artistId: string): void {
    if (!artistId) return;
    for (const key of [...groundedQuestionsCache.keys()]) {
        if (key.startsWith(`${artistId}::`)) groundedQuestionsCache.delete(key);
    }
}

/** A question that has been written but not yet checked. `materials` are the
 *  exact signal materials it claims to draw on — the only thing it may assert. */
interface DraftedQuestion extends GroundedQuestion {
    materials: string[];
    /** Why this question reads like a template rather than a person, if it
     *  does — see `boilerplateReason`. Kept rather than dropped: it ranks
     *  below the clean questions and is only used to avoid falling back to a
     *  generic one. */
    demotedFor?: string;
}

const VERIFIER_TIMEOUT_MS = 12_000;

const VERIFIER_INSTRUCTION = `You are fact-checking interview questions before they are put to the artist they are about. For each one you are given the question and the SOURCE material it was written from. The source is the only thing that is true; you know nothing else.

Mark a question UNSUPPORTED if any factual claim in it is not in the source. Be strict about two things in particular:

1. ATTRIBUTION. If the question says a named person did something, the source must say that person did that thing. A chain of causes is not an agent: source "she gave me the record, and that record made me pick up a sampler" supports "she gave you that record" and does NOT support "she introduced you to samplers". Collapsing the chain invents an action and credits it to a real person.

2. PARAPHRASE DRIFT. A restatement that adds a degree, a motive, a scale or a causal link the source does not state is unsupported, however plausible it sounds.

A question that merely ASKS about a possible connection between two things in the source is supported — "do you see these as connected?" asserts nothing. A question that ASSERTS the connection is not.

MOST QUESTIONS ARE SUPPORTED, and saying so is the normal answer. These were written FROM the source you are reading, so the usual case is that every claim in one is sitting in the text in front of you. Rejecting a supported question is not a safe default: it costs the artist a question about their actual life and replaces it with a generic one, which is a worse outcome than the question you were worried about.

Only the ASSERTIONS are yours to check. The part after the semicolon is usually the question itself — asking someone what they learned, or what was hard, or who pushed back, asserts nothing and cannot be unsupported. Judge what the question CLAIMS, not what it asks.

SHOW YOUR WORKING, because it is what keeps you honest:
- ok true: "support" is the sentence from the source, copied exactly, that states the question's main claim. If you can copy such a sentence, the question IS supported and you must mark it so.
- ok false: "problem" names the claim that is NOT in the source, and "support" is "". Do not restate a claim that IS in the source and call it a problem — if the words are there, it is supported.

Return STRICT JSON ONLY: [{ "i": number, "ok": boolean, "problem": string, "support": string }]. "i" is the question's index as given. No markdown.`;

/**
 * Drop any question that says something its source does not.
 *
 * This exists because of a real miss. Asked to draw on two signals at once, the
 * model wrote "your cousin's introduction to samplers and computers shifted
 * your perspective" from a caption that actually said he handed over two albums
 * and that THOSE shifted it. Every word was from the source and the sentence
 * was still false: a two-step chain compressed into one, crediting a real
 * person — a dead relative — with something the artist never said he did. The
 * artist caught it immediately, because he wrote it. Nobody else would have.
 *
 * That is the cost of letting questions cross signals, and it is worth paying
 * only with this in front of it. Single-signal questions were accurate in every
 * sample; the failure arrived with the collision.
 *
 * FAILS CLOSED. If the checker cannot run, nothing grounded goes out.
 *
 * It used to say it failed closed "asymmetrically" — keeping single-signal
 * questions and dropping crossed ones — and after cross-signal pairing was
 * removed EVERY draft has exactly one material, so that filter kept all of
 * them. The guard read as protective and did nothing, which is worse than not
 * having one, because it was the reason to feel safe.
 *
 * There is no safe subset to keep. The André sentence compressed a chain of
 * causes inside a SINGLE caption; single-signal questions were never immune,
 * they were just where the failure had not landed yet. So an unavailable
 * checker means no grounded questions this sitting — the static bank still
 * fills a first one, and a return visit stays quiet, which is the right way to
 * be wrong.
 */
async function keepOnlySupported(
    drafted: DraftedQuestion[],
    artistName: string,
): Promise<GroundedQuestion[]> {
    const strip = ({ materials, ...q }: DraftedQuestion): GroundedQuestion => { void materials; return q; };
    if (drafted.length === 0) return [];

    const payload = drafted
        .map((d, i) => `--- QUESTION ${i} ---\nQ: ${d.question}\nSOURCE:\n${d.materials.join("\n---\n")}`)
        .join("\n\n");

    let text = "";
    try {
        const res = await Promise.race([
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: `The artist is "${artistName}".\n\n${payload}`,
                config: {
                    systemInstruction: VERIFIER_INSTRUCTION,
                    temperature: 0,
                    responseMimeType: "application/json",
                    // Thinking was OFF here, on a task that is entirely
                    // judgement: read a caption, decide whether a sentence
                    // states a claim. It rejected "you put together a bilingual
                    // page to help after the earthquake" against a caption
                    // reading "I put together a simple bilingual page with
                    // vetted charities" — and named the supported claim as the
                    // problem, which is what answering without reading looks
                    // like. Small budget, because VERIFIER_TIMEOUT_MS is 12s.
                    thinkingConfig: { thinkingBudget: 512 },
                },
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("verifier timeout")), VERIFIER_TIMEOUT_MS)),
        ]);
        text = res.text ?? "";
    } catch (e) {
        console.error("[questionGenerator] verifier unavailable, dropping every grounded question:", e);
        return [];
    }

    let verdicts: { i?: unknown; ok?: unknown; problem?: unknown; support?: unknown }[];
    try {
        const parsed: unknown = JSON.parse(stripJsonFences(text));
        if (!Array.isArray(parsed)) throw new Error("not an array");
        verdicts = parsed as typeof verdicts;
    } catch (e) {
        console.error("[questionGenerator] unparseable verifier output, dropping every grounded question:", e);
        return [];
    }

    // A question with NO verdict is unverified, not approved — the same
    // direction the failure above ran in.
    const byIndex = new Map<number, boolean>();
    for (const v of verdicts) {
        if (typeof v?.i !== "number" || !Number.isInteger(v.i)) continue;
        byIndex.set(v.i, v.ok === true);
        if (v.ok !== true) {
            // The problem text is worth logging in full now that the checker
            // explains itself — "the albums introduced samplers, André handed
            // him the albums" is a reviewable judgement; "unsupported" was not.
            console.log(`[questionGenerator] dropped a question: ${String(v.problem ?? "unsupported")}`);
        }
    }
    return drafted.filter((_, i) => byIndex.get(i) === true).map(strip);
}

/**
 * The post a stored question came from, recovered from its key.
 *
 * A RESUMED question is rebuilt from the `questionKey` and text on its row, so
 * the panel had no post to link to and I claimed that needed a new column.
 * Pete: "don't we have links to all the posts in our database? why is that not
 * possible?" It is — the key already carries it, or the credits table does.
 *
 * TWO ROUTES, cheapest first:
 *  - `statement`, `standout` and `same_post` keys embed the Instagram
 *    shortcode, so the url rebuilds with no query at all.
 *  - `partnership`, `credit`, `collaborator` and `music` are keyed on a person
 *    or a track rather than a post. Those are looked up in the stored credits
 *    by re-deriving the same slug from each subject — the same function that
 *    built the key, so the two cannot drift.
 *
 * Returns undefined rather than guessing. A missing link is a small loss; a
 * link to the wrong post is the artist reading somebody else's caption.
 */
export async function sourceUrlForQuestionKey(artistId: string, key: string): Promise<string | undefined> {
    // NO SUFFIX on these two, so the rest of the key IS the shortcode and a
    // greedy match to the end is exact.
    const wholeTail = key.match(/^social_(?:standout|same_post)_(.+)$/);
    if (wholeTail?.[1]) return `https://www.instagram.com/p/${wholeTail[1]}/`;

    // A STATEMENT KEY CANNOT BE SPLIT BY REGEX. It is
    // `social_statement_<shortcode>_<topic>` and BOTH halves can contain
    // underscores — 29 of the 267 shortcodes in this database do, and a
    // non-greedy match turned "Czb_V_lxFMA" into "Czb", linking the artist to
    // instagram.com/p/Czb/. A wrong link is worse than no link, which is the
    // rule this function is written to.
    //
    // So it is resolved by rebuilding the key from each stored statement and
    // comparing — the same discipline as the person lookup below, and it
    // cannot drift from the format because it uses the format.
    const statement = key.startsWith("social_statement_");
    const person = key.match(/^social_(?:partnership|credit|collaborator)_(.+)$/);
    if (!statement && !person?.[1]) return undefined;
    try {
        const { credits, statements } = await getSocialCredits(artistId);
        if (statement) {
            const hit = statements.find(
                st => `social_statement_${shortCodeFromUrl(st.url)}_${slug(st.topic)}` === key);
            return hit?.url;
        }
        // FIRST MATCH IN STORED ORDER, deliberately not the newest.
        // `creditedCollaborators` collects evidenceUrls in exactly this order
        // and the question was built from evidenceUrls[0], so this returns the
        // post the question actually came from. Sorting by recency instead sent
        // a question about "those first two tracks" to a post from years later
        // — a real link to the wrong moment, which is worse than no link.
        const match = credits.find(c => !c.isSelf && unicodeSlug(c.subject) === person![1]);
        return match?.url;
    } catch (e) {
        console.error("[sourceUrlForQuestionKey] Could not resolve:", e);
        return undefined;
    }
}

export async function generateGroundedQuestions(
    artistId: string,
    opts?: {
        max?: number;
        since?: string | null;
        /**
         * Question keys this artist has already been asked. Dropped from the
         * candidate pool BEFORE the model sees it.
         *
         * The callers already filtered these out of the RESULT, which is too
         * late: the model had spent its picks writing questions that were then
         * thrown away, and the artist got the static bank instead. Removing
         * them from the pool is also what makes a second interview about
         * something new rather than a re-run of the first.
         */
        excludeKeys?: Iterable<string>;
    },
): Promise<GroundedQuestion[]> {
    const max = Math.max(0, opts?.max ?? DEFAULT_MAX_QUESTIONS);
    if (!artistId || max === 0) return [];

    const exclude = new Set(opts?.excludeKeys ?? []);
    // The exclusion set is part of the identity of the request: two calls that
    // exclude different questions are not the same call, and sharing a cache
    // entry between them would hand back questions the artist has answered.
    const cacheKey = `${artistId}::${max}::${opts?.since ?? ""}::${[...exclude].sort().join(",")}`;
    const now = Date.now();
    const cached = groundedQuestionsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

    try {
        const artist = await getArtistById(artistId);
        if (!artist) return [];
        const artistName = artist.name ?? "the artist";

        const all = await getSocialPostsForArtist(artistId);
        // SCOPED TO WHAT IS NEW, when the caller asks for it.
        //
        // A returning artist should be asked about what they have done since,
        // not handed the same three questions again — "we only come back when
        // we have something new to ask about" is the rule that makes a second
        // ask feel like interest rather than nagging.
        const since = opts?.since ? Date.parse(opts.since) : NaN;
        const posts = Number.isNaN(since)
            ? all
            : all.filter(p => {
                const at = Date.parse(p.postedAt ?? "");
                return !Number.isNaN(at) && at > since;
            });
        if (posts.length === 0) return [];

        const signals = deriveSocialSignals(posts, artist.instagram ?? "", artistName);
        // Stored, not recomputed — see socialCredits.ts. An artist whose
        // captions have not been read yet simply contributes no credit
        // candidates, exactly as before this existed.
        //
        // FILTERED BY `since` TOO. Filtering only the posts left the statement
        // and credit candidates unbounded, so a return interview scoped to the
        // last two months came back asking about a post from 2020 — the exact
        // "same questions again" this scoping exists to prevent. Measured on
        // Pete Rango: a pandemic reflection surfaced in a window that started
        // six years after it.
        const stored = await getSocialCredits(artistId);
        const newer = <T extends { postedAt?: string | null }>(rows: T[]): T[] =>
            Number.isNaN(since) ? rows : rows.filter(r => {
                const at = Date.parse(r.postedAt ?? "");
                return !Number.isNaN(at) && at > since;
            });
        const extraction = {
            ...stored,
            credits: newer(stored.credits),
            statements: newer(stored.statements),
        };
        const candidates = buildCandidates(signals, artistName, extraction)
            .filter(c => !exclude.has(c.key));
        if (candidates.length === 0) return [];

        // Draft more than we need — see DRAFT_OVERSAMPLE. Never more than there
        // are signals to draft from, so a thin artist is not asked to invent.
        const wantedDrafts = max * DRAFT_OVERSAMPLE;
        const draftTarget = Math.min(wantedDrafts, MAX_DRAFTS, candidates.length);
        // SAY SO WHEN THE OVERSAMPLE IS NOT ACTUALLY HAPPENING.
        //
        // MAX_DRAFTS is a latency ceiling, measured: nine drafts blew the
        // generation budget outright. But it silently swallows the oversample
        // for any `max` above MAX_DRAFTS / DRAFT_OVERSAMPLE — at max 6, the
        // module default, draftTarget clamps to exactly 6 and we are back to
        // drafting precisely what we need and letting the fact-checker eat it,
        // which is the bug this whole mechanism exists to fix.
        //
        // NOT hypothetical: scripts/ingest-social.ts passes `max` straight
        // from an optional --max flag, so running it without one lands on
        // DEFAULT_MAX_QUESTIONS (6) and wants twelve drafts against a ceiling
        // of six. The onboarding callers both pass 3 and are unaffected.
        // Found in review, after I described it as latent.
        if (draftTarget < wantedDrafts && draftTarget < candidates.length) {
            console.warn(`[questionGenerator] Oversampling degraded: wanted ${wantedDrafts} drafts for ${max} question(s), capped at ${draftTarget} by the latency ceiling — expect generic fallbacks to fill the gap.`);
        }

        const byId = new Map(candidates.map(c => [c.signalId, c]));
        const promptPayload = candidates.map(({ signalId, kind, authoredBy, material }) => ({ signalId, kind, authoredBy, material }));

        const response = await withTimeout(
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: `SIGNALS:\n${JSON.stringify(promptPayload, null, 2)}\n\nChoose at most ${draftTarget} of the most interesting, distinct signals and write one question each, BEST FIRST. Fewer than ${draftTarget} is fine — even zero — if the rest don't clear the bar.`,
                config: {
                    systemInstruction: QUESTION_SYSTEM_INSTRUCTION(artistName),
                    // This was 0.2, to keep WHICH signals get chosen stable
                    // across the repeated calls an interview makes — churn
                    // between calls would read as the interviewer changing its
                    // mind mid-conversation.
                    //
                    // That stability is bought elsewhere now, twice over: the
                    // questions actually put to an artist are PERSISTED when
                    // they are offered and resumed from those rows, and there
                    // is a TTL cache in front of this call. So 0.2 was no
                    // longer preventing churn, only flattening the writing —
                    // and with the candidate pool as narrow as it was, it
                    // guaranteed the same handful of questions forever.
                    // Pete: "that's so low and uncreative... we can't kill
                    // creativity."
                    temperature: 0.8,
                    responseMimeType: "application/json",
                },
            }),
        );

        const text = response.text;
        if (!text) return [];

        const answers = parseModelAnswers(text);
        const drafted: DraftedQuestion[] = [];

        // TWO PASSES, so a reservation cannot cost us a draft.
        //
        // The model is told credits are its best material, and TOP_PARTNERSHIPS
        // plus TOP_CREDITS alone can exceed the draft ceiling — so a
        // collaborator-heavy artist can fill every slot with person-kind
        // answers before a single statement is considered, and the cap below
        // then has nothing to protect. The interview goes out all-collaborator
        // while better material sat further down the list unread.
        //
        // Pass one holds back roughly half the slots for anything that is not
        // about a person. Pass two gives those slots straight back if nothing
        // claimed them, so an artist whose answers really are all collaborators
        // still gets a full set. Nothing is discarded either way, which is what
        // went wrong when this was a hard draft-time cap: skipped answers were
        // gone, and a clean one further down was lost to earlier flagged ones.
        // RESOLVE EVERYTHING FIRST, then choose. Deciding as we walk the
        // model's list means the order it happened to return things in decides
        // what gets drafted — and it is told collaborators are its best
        // material, so it returns those first.
        const eligible: { candidate: SignalCandidate; question: string; rationale: string; boilerplate: string | null }[] = [];
        const resolved = new Set<string>();
        for (const answer of answers) {
            const question = typeof answer.question === "string" ? answer.question.trim() : "";
            // ONE SIGNAL. Letting the model name two and hypothesise a link
            // between them is how it told Pharaoh Sistare that @p3t3rango
            // engineered "Hourglass & The Flame": one signal said Pharaoh
            // credits p3t3rango, another said what Hourglass sounds like, and
            // the join was invented. They are four different posts.
            //
            // Connections are computed in buildCandidates now, where they can
            // carry the evidence that makes them true. A model cannot invent a
            // relationship it was handed.
            const signalId = typeof answer.signalId === "string" ? answer.signalId : null;
            if (!signalId || !question || resolved.has(signalId)) continue;
            const candidate = byId.get(signalId);   // only signalIds WE supplied are honored
            if (!candidate) continue;
            resolved.add(signalId);
            eligible.push({
                candidate,
                question,
                rationale: typeof answer.rationale === "string" ? answer.rationale : "",
                // BOILERPLATE DEMOTES, IT DOES NOT DELETE. Dropping these made
                // the output worse rather than better: a rejected draft is not
                // replaced by a nicer question, it is replaced by "describe
                // your sound". Measured on Pete Rango's feed after the register
                // rules went in — six drafts, three killed here, three by the
                // fact-checker, ZERO grounded questions. He tested it and said
                // it made no sense, and he was right.
                boilerplate: boilerplateReason(question),
            });
        }

        // Clean ahead of flagged, model order preserved within each. Doing this
        // BEFORE the reservation is what stops a clean collaborator question
        // being deferred in favour of flagged ones the model happened to rank
        // higher.
        const ordered = [...eligible.filter(e => !e.boilerplate), ...eligible.filter(e => e.boilerplate)];

        // HALF THE SLOTS ARE HELD FOR ANYTHING THAT IS NOT ABOUT A PERSON.
        //
        // TOP_PARTNERSHIPS plus TOP_CREDITS alone can exceed the draft ceiling,
        // so a collaborator-heavy artist could fill every slot before a single
        // statement was considered — and the cap further down, which only sees
        // what was drafted, would then have nothing to protect and no-op. The
        // interview went out all-collaborator while better material sat unread.
        //
        // Pass two hands the reserved slots straight back if nothing claimed
        // them, so an artist whose answers really are all collaborators still
        // gets a full set. Nothing is discarded either way.
        const personSlots = Math.max(1, Math.ceil(draftTarget / 2));
        const deferred: typeof ordered = [];
        let people = 0;
        let deferring = true;
        const consider = (e: typeof ordered[number]): void => {
            if (drafted.length >= draftTarget) return;
            if (ABOUT_A_PERSON.has(e.candidate.kind)) {
                if (deferring && people >= personSlots) { deferred.push(e); return; }
                people++;
            }
            drafted.push({
                key: e.candidate.key,
                question: e.question,
                rationale: e.rationale,
                sourceUrls: e.candidate.sourceUrls,
                kind: e.candidate.kind,
                materials: [e.candidate.material],
                demotedFor: e.boilerplate ?? undefined,
            });
        };

        for (const e of ordered) consider(e);
        // Pass two: nothing else wanted the reserved slots, so give them back.
        deferring = false;
        for (const e of deferred) consider(e);

        // The model was told best-first and the checker preserves order, so
        // `diversify` walks that ranking and takes the strongest question of
        // each kind before it takes a second of any — the set stays in the
        // model's preference order without being four versions of one question.
        // CLEAN FIRST, FLAGGED ONLY IF NEEDED. The fact-checker still has an
        // absolute veto — a flagged question is merely inelegant, an
        // unsupported one is wrong — so this ranks what survived verification.
        //
        // AND IT IS THIS SPLIT THAT RE-ESTABLISHES THE ORDER, not the draft
        // array: the two-pass reservation interleaves clean and flagged as it
        // fills and gives back slots, so `drafted` carries no ranking of its
        // own. Removing the split would silently lose the guarantee.
        const demoted = new Map(drafted.filter(d => d.demotedFor).map(d => [d.key, d.demotedFor!]));
        const verified = await keepOnlySupported(drafted, artistName);
        const clean = verified.filter(q => !demoted.has(q.key));
        const flagged = verified.filter(q => demoted.has(q.key));
        const questions = diversify(capPersonQuestions([...clean, ...flagged], max), max);
        for (const q of questions) {
            const why = demoted.get(q.key);
            if (why) console.log(`[questionGenerator] using a question that ${why} — better than a generic fallback: ${q.question.slice(0, 70)}`);
        }

        pruneGroundedQuestionsCache(now);
        groundedQuestionsCache.set(cacheKey, { value: questions, expiresAt: now + GROUNDED_QUESTIONS_CACHE_TTL_MS });
        return questions;
    } catch (e) {
        console.error("[generateGroundedQuestions] Error:", e);
        return [];
    }
}
