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

/** Letters and digits of any script, so a name outside ASCII still identifies
 *  one person. `slug` below is ASCII-only and stays that way for the callers
 *  that key on urls and hashtags, where ASCII is the alphabet in use. */
function unicodeSlug(s: string): string {
    return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "").slice(0, 60) || "x";
}

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
        // ZERO KEY CHURN, which is why this rather than swapping call sites:
        // for ASCII input the two classes produce identical output (verified
        // across real topics, titles and handles), so no stored questionKey
        // moves. `unicodeSlug` would have changed them via its longer slice.
        .replace(/[^\p{L}\p{N}]+/gu, "_")
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
            material: `${artistName} wrote these about ${subject}, each in a DIFFERENT caption and each true only of the post it came from:\n`
                + quotes.map(q => `  "${q}"`).join("\n")
                + `\nRead what the sentences actually say — they may contradict what the phrasing suggests. Do not combine them into one description of ${subject}, and do not present something from one post as what they generally do.`,
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

NOT EVERY QUESTION IS ABOUT SOMEBODY ELSE. Credits and partnerships are rich, and left alone they turn an interview into a tour of the artist's contact list. At most half your questions may be about a named collaborator; the rest must come from what ${artistName} said or made — a statement in their own words, a track, a thing they posted about. Prefer "credit" and "statement" signals over the others. A credit is a named person doing a stated job in ${artistName}'s own words; a statement is something ${artistName} actually wrote about their own work. Both are far better material than a term that merely recurred, and a good interviewer would reach for them first.

SOME SIGNALS ARE RELATIONSHIPS, AND THEY ARE YOUR BEST MATERIAL. A signal of kind "partnership" or "same_post" is a connection we have already verified against the posts — the same person credited across several records, or two things said in one post. Reach for those: they are how you ask a question that only somebody who read everything could ask.

NEVER BUILD A RELATIONSHIP YOURSELF. If a connection between two facts is not stated inside ONE signal's material, it is not a fact and you may not imply it. Two signals mentioning the same person do not put that person on both records. Two signals from the same artist do not make one the cause of the other. This is the single way these questions go wrong, and it is not recoverable: an artist asked about work they did not do knows immediately that nobody read anything.

ATTRIBUTION IS THE OTHER THING YOU WILL GET WRONG. When you say a NAMED PERSON did something, the material must say THAT PERSON did THAT THING. Do not compress a chain of causes into an agent: if the material says "she gave me the record, and the record made me pick up a sampler", then she gave you a record — she did NOT introduce you to samplers, and writing that puts words in the artist's mouth about somebody else. When in doubt, quote the artist's own words rather than paraphrasing them. Every accurate question you can write is one you could defend by pointing at a sentence.

Rules:
- You do NOT have to use every signal. Being grounded in a real fact is necessary but not sufficient — a signal can be 100% true and still make a bad question. DROP any signal that is technically real but would come across as a machine noticing a pattern rather than a person who actually paid attention: a common word that just happens to repeat, a burst of activity with nothing memorable to name, anything a generic analytics dashboard could have surfaced.
- ONLY the ones that clear the bar. One excellent question is a better outcome than three even ones, and returning fewer is correct rather than a failure. Padding to reach a count is the failure. Look hard for distinct collisions before settling — different pairs, different corners of their work, never three versions of the same question.
- BANNED, because they are what an interviewer who did not do the reading says: "what's the story behind", "what was that like", "what motivated you", "how did that come about", "tell me about", "can you talk about", "what inspired you", "walk me through", "what has that experience been like".
- DO NOT RECAP THEIR POST BACK TO THEM. They know what they posted. At most one short clause of context — roughly a dozen words — then the question. If you are quoting more than about ten words you are stalling.
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
 * At most half the DRAFTS may be about somebody else.
 *
 * Credits are the richest signal we have and the prompt tells the model to
 * reach for them, so left alone the interview becomes a tour of the artist's
 * contact list. Pete: "I don't want every question to always have to do with a
 * collaborator, some could just be about things the artist posted."
 *
 * ENFORCED WHILE DRAFTING, not afterwards. Capping the finished set does
 * nothing when every draft is about a person — there is then nothing left to
 * balance with, and trimming just returns a shorter tour. Refusing the sixth
 * collaborator draft is what makes room for a statement.
 *
 * Only enforced while something else is actually available: an artist whose
 * material genuinely is all credits gets a full interview rather than one
 * question.
 */
function personDraftLimit(draftTarget: number, candidates: SignalCandidate[]): number {
    const hasOthers = candidates.some(c => !ABOUT_A_PERSON.has(c.kind));
    return hasOthers ? Math.max(1, Math.ceil(draftTarget / 2)) : draftTarget;
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
}

const VERIFIER_TIMEOUT_MS = 12_000;

const VERIFIER_INSTRUCTION = `You are fact-checking interview questions before they are put to the artist they are about. For each one you are given the question and the SOURCE material it was written from. The source is the only thing that is true; you know nothing else.

Mark a question UNSUPPORTED if any factual claim in it is not in the source. Be strict about two things in particular:

1. ATTRIBUTION. If the question says a named person did something, the source must say that person did that thing. A chain of causes is not an agent: source "she gave me the record, and that record made me pick up a sampler" supports "she gave you that record" and does NOT support "she introduced you to samplers". Collapsing the chain invents an action and credits it to a real person.

2. PARAPHRASE DRIFT. A restatement that adds a degree, a motive, a scale or a causal link the source does not state is unsupported, however plausible it sounds.

A question that merely ASKS about a possible connection between two things in the source is supported — "do you see these as connected?" asserts nothing. A question that ASSERTS the connection is not.

Return STRICT JSON ONLY: [{ "i": number, "ok": boolean, "problem": string }]. "i" is the question's index as given. "problem" is one short phrase naming the unsupported claim, or "" when ok. No markdown.`;

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
                    thinkingConfig: { thinkingBudget: 0 },
                },
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("verifier timeout")), VERIFIER_TIMEOUT_MS)),
        ]);
        text = res.text ?? "";
    } catch (e) {
        console.error("[questionGenerator] verifier unavailable, dropping every grounded question:", e);
        return [];
    }

    let verdicts: { i?: unknown; ok?: unknown; problem?: unknown }[];
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
            console.log(`[questionGenerator] dropped a question: ${String(v.problem ?? "unsupported")}`);
        }
    }
    return drafted.filter((_, i) => byIndex.get(i) === true).map(strip);
}

export async function generateGroundedQuestions(
    artistId: string,
    opts?: { max?: number; since?: string | null },
): Promise<GroundedQuestion[]> {
    const max = Math.max(0, opts?.max ?? DEFAULT_MAX_QUESTIONS);
    if (!artistId || max === 0) return [];

    const cacheKey = `${artistId}::${max}::${opts?.since ?? ""}`;
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
        const candidates = buildCandidates(signals, artistName, extraction);
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
        // Both callers pass 3 today so it is not live. It would go wrong the
        // moment somebody raised the question count, and quietly. Found in
        // review.
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
        const drafted: DraftedQuestion[] = [];
        const maxPeople = personDraftLimit(draftTarget, candidates);
        let people = 0;
        for (const answer of answers) {
            if (drafted.length >= draftTarget) break;
            const question = typeof answer.question === "string" ? answer.question.trim() : "";
            // ONE SIGNAL. Letting the model name two and hypothesise a link
            // between them is how it told Pharaoh Sistare that @p3t3rango
            // engineered "Hourglass & The Flame": one signal said Pharaoh
            // credits p3t3rango, another said what Hourglass sounds like, and
            // the join was invented. Nothing anywhere connected them — they are
            // four different posts.
            //
            // Connections are computed in buildCandidates now, where they can
            // carry the evidence that makes them true. A model cannot invent a
            // relationship it was handed.
            const signalId = typeof answer.signalId === "string" ? answer.signalId : null;
            if (!signalId || !question || seen.has(signalId)) continue;
            const candidate = byId.get(signalId); // only signalIds WE supplied are honored
            if (!candidate) continue;
            // BOILERPLATE FIRST, THEN THE CAP — the order matters.
            //
            // Counting a person-kind draft against the cap BEFORE checking
            // whether it survives means a rejected draft still spends a slot.
            // Three boilerplate collaborator drafts in a row would exhaust
            // `maxPeople` and silently drop a good fourth one, with zero person
            // questions actually in the set — the cap eating the very yield the
            // oversample exists to recover. Found in review.
            //
            // `seen` is already added after this check, for the same reason: a
            // draft that did not survive has not used anything up.
            const boilerplate = boilerplateReason(question);
            if (boilerplate) {
                console.log(`[questionGenerator] dropped a question — ${boilerplate}: ${question.slice(0, 70)}`);
                continue;
            }
            if (ABOUT_A_PERSON.has(candidate.kind)) {
                if (people >= maxPeople) continue;   // leave room for their own words
                people++;
            }
            seen.add(signalId);

            drafted.push({
                key: candidate.key,
                question,
                rationale: typeof answer.rationale === "string" ? answer.rationale : "",
                sourceUrls: candidate.sourceUrls,
                kind: candidate.kind,
                materials: [candidate.material],
            });
        }

        // The model was told best-first and the checker preserves order, so
        // `diversify` walks that ranking and takes the strongest question of
        // each kind before it takes a second of any — the set stays in the
        // model's preference order without being four versions of one question.
        const questions = diversify(await keepOnlySupported(drafted, artistName), max);

        pruneGroundedQuestionsCache(now);
        groundedQuestionsCache.set(cacheKey, { value: questions, expiresAt: now + GROUNDED_QUESTIONS_CACHE_TTL_MS });
        return questions;
    } catch (e) {
        console.error("[generateGroundedQuestions] Error:", e);
        return [];
    }
}
