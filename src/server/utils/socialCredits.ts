/**
 * Reading captions instead of counting them.
 *
 * `socialSignals.ts` is a word-frequency counter, and the corpus it runs over
 * is prose. Pharaoh Sistare's feed contains "Mixing & Mastering Engineer:
 * @p3t3rango", "@gradylisiousness who I didn't know at the time would became my
 * first bassist for all of my shows thus far", and a caption explaining that he
 * wrote a Christmas record about spending the holidays without someone who had
 * died. We stored every word of that and represented it as the term `single`,
 * counted eleven times. Twelve of his sixty captions carry a role credit next to
 * a handle, and none of them could become a question, a collaborator, or a line
 * in his profile.
 *
 * A regular expression handles "Mixed by @x". It does not handle the bassist
 * sentence, and that sentence is the reason this is a model call.
 *
 * WHAT STOPS IT INVENTING PEOPLE. The model is given captions and asked to
 * report what is in them, and every claim it returns is then checked against
 * the post it claims to have come from:
 *
 *   1. The cited url must be one we passed in.
 *   2. The quote must actually appear in that post's caption.
 *   3. The person must appear in that post — in its stored `mentions`, or by
 *      name in the caption text.
 *
 * A claim failing any of these is dropped, not repaired. This is the same
 * entity-grounding rule discovery uses: the model may only tell us about things
 * that were already in front of it.
 *
 * OWN POSTS ONLY. A scraped feed contains posts authored by other people. A
 * caption written by someone else is not the artist's statement and is never
 * read here, which is the same rule `socialSignals.ts` follows for the same
 * reason.
 *
 * SELF-CREDITS ARE FACTS, NOT EDGES. "Recording Engineer: Pharaoh Sistare" says
 * something real about how he works and belongs on his profile. It must never
 * become a collaboration between him and himself.
 *
 * NOT SCOPED TO RECENT ACTIVITY. `selectRecentPosts` exists so that questions
 * are about what an artist is doing now. Credits are biographical: a first
 * bassist is permanently a first bassist. This reads the whole history.
 */
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import type { SocialPostRow } from "@/server/utils/socialSignals";

/** One person credited with a role, in the artist's own words. */
export interface CaptionCredit {
    /** An instagram handle without the @, or a name as written when no handle was used. */
    subject: string;
    /** True when `subject` is a handle we could link to, false when it is a bare name. */
    isHandle: boolean;
    /** The role as the artist wrote it: "Mixing & Mastering Engineer", "first bassist". */
    role: string;
    /** The sentence the credit was read from, verified to appear in the caption. */
    quote: string;
    /** The post this came from. */
    url: string;
    /** True when the artist is crediting themselves. Keep the fact, never draw the edge. */
    isSelf: boolean;
}

/** Something the artist said about their own work, worth asking or writing about. */
export interface ArtistStatement {
    /** Their words, verified to appear in the caption. */
    quote: string;
    /** A few words naming what it is about, for grouping and for prompts. */
    topic: string;
    url: string;
}

export interface CaptionExtraction {
    credits: CaptionCredit[];
    statements: ArtistStatement[];
}

export const EMPTY_EXTRACTION: CaptionExtraction = { credits: [], statements: [] };

/** Captions per model call.
 *
 *  Forty was the first guess and it was wrong: a forty-caption batch took over
 *  45 seconds and timed out, which cost the whole batch rather than one caption.
 *  Fifteen keeps a call to roughly twenty seconds, makes a timeout cheap, and
 *  lets several batches run at once. */
const POSTS_PER_BATCH = 15;
/** Batches in flight at once. This runs in a background ingest so wall-clock is
 *  not critical, but a 300-post artist is twenty batches and running those one
 *  at a time would take several minutes for no reason. */
const BATCH_CONCURRENCY = 3;
/** Below this there is no sentence left once hashtags and dot-padding are
 *  stripped, so there is nothing for a model to read.
 *
 *  Deliberately low. The first value here was 25, which would have discarded
 *  "Shot by @moneaofthemoon" — a real credit, 23 characters long. This filter
 *  exists to skip emoji and hashtag dumps, not to judge whether a caption is
 *  interesting; that judgement belongs to the model and to verification. */
const MIN_CAPTION_CHARS = 12;
/** Generous: this runs in a background ingest, not in a chat turn. */
const TIMEOUT_MS = 45_000;
/** Per batch. Well above what a real feed produces; a backstop on a model that
 *  decides every sentence is a credit. */
const MAX_CLAIMS_PER_BATCH = 60;

/** First-person stand-ins an artist uses to credit themselves. Pharaoh Sistare
 *  writes "Produced/directed/edited by moi", which is a self-credit that folds
 *  to nothing like his name and would otherwise become a collaboration between
 *  him and a person called Moi. */
const SELF_WORDS = new Set(["moi", "me", "myself", "self", "yourstruly", "mua", "muah", "i"]);

/** Roles that are only a grammatical hinge. "for" and "with" survive the
 *  has-two-letters test and say nothing about what anybody did. */
const EMPTY_ROLES = new Set(["for", "with", "by", "to", "and", "at", "on", "in", "of", "from", "via", "ft", "the", "a"]);

/** Alphanumerics only, so a display name and a handle can be compared:
 *  "Pharaoh Sistare" and "pharaohsistare" collapse to the same string. */
function fold(value: string): string {
    return (value ?? "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
}

/** Whitespace-insensitive containment. Models reflow line breaks and collapse
 *  runs of spaces when quoting, and a quote that is otherwise verbatim should
 *  not fail verification over a newline. Everything else must match exactly. */
function containsQuote(haystack: string, needle: string): boolean {
    const flat = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
    const h = flat(haystack);
    const n = flat(needle);
    return n.length > 0 && h.includes(n);
}

const SYSTEM_INSTRUCTION = (artistName: string, artistHandle: string) => `
You are reading Instagram captions written by the musician ${artistName}${artistHandle ? ` (@${artistHandle})` : ""}.

Report what the captions SAY. Do not infer, summarise, or add anything that is not written there.

Return JSON: {"credits": [...], "statements": [...]}

A CREDIT is a person given a role in making something. Examples of the form:
  "Mixing & Mastering Engineer: @someone"     -> subject "someone", role "Mixing & Mastering Engineer"
  "Shot by @someone"                          -> subject "someone", role "Shot by"
  "@someone playing the chord progression"    -> subject "someone", role "playing the chord progression"
  "@someone became my first bassist"          -> subject "someone", role "first bassist"
  "feat. @someone"                            -> subject "someone", role "featured artist"
Each credit: {"subject", "isHandle", "role", "quote", "url"}
  subject  - the @handle WITHOUT the @, or the person's name if no handle was used
  isHandle - true if you took it from an @handle, false if it is a bare name
  role     - the role in ${artistName}'s OWN WORDS, as short as it can be while staying theirs
  quote    - the sentence or line you read it from, copied EXACTLY from the caption
  url      - the url of the post the caption belongs to

${artistName} often credits THEMSELVES ("Written & Produced by: ${artistName}"). Report these too, exactly the same way. Do not skip them and do not mark them differently; they will be handled downstream.

A STATEMENT is ${artistName} saying something about their own work, life or intent that a fan would find worth knowing: what a song is about, why they made it, what changed for them, what they are working towards. Not announcements ("out now", "link in bio"), not thanks, not hashtags.
Each statement: {"quote", "topic", "url"}
  quote - their words, copied EXACTLY from the caption, one to three sentences
  topic - a few words naming what it is about ("why he wrote My Dear")
  url   - the url of the post

Rules:
- Copy quotes character for character from the caption you were given. Do not tidy, trim, join, or paraphrase them.
- Use only the url that was given with that caption.
- A caption with no credit and nothing worth quoting contributes nothing. Empty arrays are the correct answer for a feed of announcements.
- Never report a person who is not named in that caption.
`.trim();

function withTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error("caption extraction timed out")), TIMEOUT_MS)),
    ]);
}

interface RawCredit { subject?: unknown; isHandle?: unknown; role?: unknown; quote?: unknown; url?: unknown }
interface RawStatement { quote?: unknown; topic?: unknown; url?: unknown }

function parse(text: string): { credits: RawCredit[]; statements: RawStatement[] } {
    try {
        // Models occasionally wrap JSON in a fence despite responseMimeType.
        const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const obj = JSON.parse(cleaned) as Record<string, unknown>;
        return {
            credits: Array.isArray(obj.credits) ? (obj.credits as RawCredit[]) : [],
            statements: Array.isArray(obj.statements) ? (obj.statements as RawStatement[]) : [],
        };
    } catch {
        return { credits: [], statements: [] };
    }
}

/**
 * Check one batch of model output against the posts it was given.
 *
 * Exported for tests: this is the part that has to be right, and it is pure.
 */
export function verifyClaims(
    raw: { credits: RawCredit[]; statements: RawStatement[] },
    posts: SocialPostRow[],
    artistName: string,
    artistHandle: string,
): CaptionExtraction {
    const byUrl = new Map(posts.map(p => [p.url, p]));
    const selfKeys = new Set([fold(artistName), fold(artistHandle)].filter(Boolean));

    const credits: CaptionCredit[] = [];
    for (const c of raw.credits.slice(0, MAX_CLAIMS_PER_BATCH)) {
        const url = typeof c.url === "string" ? c.url : "";
        const subject = typeof c.subject === "string" ? c.subject.trim().replace(/^@/, "") : "";
        const role = typeof c.role === "string" ? c.role.trim() : "";
        // A role has to say something. Real captions credit people with a bare
        // camera emoji, which is a credit to a human reader and nothing at all
        // once it is a label on a graph edge.
        if (!/\p{L}{2}/u.test(role)) continue;
        if (EMPTY_ROLES.has(role.toLowerCase().replace(/[^a-z]/g, ""))) continue;
        const quote = typeof c.quote === "string" ? c.quote.trim() : "";
        if (!url || !subject || !role || !quote) continue;

        const post = byUrl.get(url);
        if (!post) continue;                                     // cited a post we never sent
        const caption = post.caption ?? "";
        if (!containsQuote(caption, quote)) continue;            // quote is not in that caption

        // The person has to be IN the post. A handle counts when Instagram
        // recorded it as a mention or when it is written in the caption; a bare
        // name counts only when it is written in the caption.
        const folded = fold(subject);
        const inMentions = post.mentions.some(m => fold(m) === folded);
        const inCaption = fold(caption).includes(folded) && folded.length >= 3;
        if (!inMentions && !inCaption) continue;

        credits.push({
            subject,
            // Only a handle if the model said so AND we can see the @ ourselves.
            isHandle: c.isHandle === true && (inMentions || caption.includes(`@${subject}`)),
            role,
            quote,
            url,
            isSelf: selfKeys.has(folded) || SELF_WORDS.has(folded),
        });
    }

    const statements: ArtistStatement[] = [];
    for (const s of raw.statements.slice(0, MAX_CLAIMS_PER_BATCH)) {
        const url = typeof s.url === "string" ? s.url : "";
        const quote = typeof s.quote === "string" ? s.quote.trim() : "";
        const topic = typeof s.topic === "string" ? s.topic.trim() : "";
        if (!url || !quote || !topic) continue;
        const post = byUrl.get(url);
        if (!post) continue;
        if (!containsQuote(post.caption ?? "", quote)) continue;
        statements.push({ quote, topic, url });
    }

    return { credits, statements };
}

/** Posts worth sending to the model: the artist's own, with prose in them. */
export function captionBearingPosts(posts: SocialPostRow[]): SocialPostRow[] {
    return posts.filter(p => {
        if (!p.isOwnPost) return false;
        const caption = (p.caption ?? "").replace(/#\w+/g, "").replace(/[\s.·]+/g, " ").trim();
        return caption.length >= MIN_CAPTION_CHARS;
    });
}

/** One model call over one batch, verified. Never throws: a batch that fails
 *  costs its own captions and nothing else. */
async function runBatch(
    batch: SocialPostRow[],
    artistName: string,
    artistHandle: string,
    index: number,
): Promise<CaptionExtraction> {
    const payload = batch.map(p => ({ url: p.url, postedAt: p.postedAt, caption: p.caption }));
    try {
        const response = await withTimeout(
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: `CAPTIONS:\n${JSON.stringify(payload, null, 2)}`,
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION(artistName, artistHandle),
                    // Copying text back verbatim is the job; creativity here
                    // shows up as paraphrase, and paraphrase fails verification.
                    temperature: 0,
                    responseMimeType: "application/json",
                },
            }),
        );
        const text = response.text;
        if (!text) return EMPTY_EXTRACTION;
        return verifyClaims(parse(text), batch, artistName, artistHandle);
    } catch (e) {
        console.error(`[socialCredits] Batch ${index} failed for ${artistName}:`, e);
        return EMPTY_EXTRACTION;
    }
}

/**
 * Read an artist's own captions and return the credits and statements in them.
 *
 * Never throws: this is enrichment on a background path, and losing it should
 * cost some profile detail, not the ingest.
 */
export async function extractCaptionCredits(
    allPosts: SocialPostRow[],
    artistName: string,
    artistHandle: string,
): Promise<CaptionExtraction> {
    const posts = captionBearingPosts(allPosts);
    if (posts.length === 0) return EMPTY_EXTRACTION;

    const batches: SocialPostRow[][] = [];
    for (let i = 0; i < posts.length; i += POSTS_PER_BATCH) batches.push(posts.slice(i, i + POSTS_PER_BATCH));

    const out: CaptionExtraction = { credits: [], statements: [] };
    for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
        const results = await Promise.all(
            batches.slice(i, i + BATCH_CONCURRENCY).map((batch, n) => runBatch(batch, artistName, artistHandle, i + n)),
        );
        for (const r of results) {
            out.credits.push(...r.credits);
            out.statements.push(...r.statements);
        }
    }

    console.debug(`[socialCredits] ${artistName}: ${out.credits.length} credit(s), ${out.statements.length} statement(s) from ${posts.length} caption(s)`);
    return out;
}

/**
 * Collaborators as the artist described them: everyone credited with a role in
 * their own captions, other than the artist themselves, strongest first.
 *
 * This is deliberately a different object from `socialSignals.Collaborator`,
 * which counts Instagram coauthor tags. A coauthor tag says two accounts agreed
 * to share a post. A credit says what somebody did, in the artist's own words.
 * The second is better evidence about a working relationship, and for an artist
 * who does not use coauthor tags at all it is the only evidence there is.
 */
export interface CreditedCollaborator {
    subject: string;
    isHandle: boolean;
    /** Every distinct role the artist has given them, in their words. */
    roles: string[];
    evidenceUrls: string[];
}

export function creditedCollaborators(extraction: CaptionExtraction): CreditedCollaborator[] {
    const by = new Map<string, CreditedCollaborator>();
    for (const c of extraction.credits) {
        if (c.isSelf) continue;                                  // a fact about them, not an edge
        const key = fold(c.subject);
        if (!key) continue;
        const existing = by.get(key);
        if (existing) {
            if (!existing.roles.some(r => r.toLowerCase() === c.role.toLowerCase())) existing.roles.push(c.role);
            if (!existing.evidenceUrls.includes(c.url)) existing.evidenceUrls.push(c.url);
            // A handle is more useful than a bare name; upgrade if we later see one.
            if (c.isHandle && !existing.isHandle) { existing.isHandle = true; existing.subject = c.subject; }
        } else {
            by.set(key, { subject: c.subject, isHandle: c.isHandle, roles: [c.role], evidenceUrls: [c.url] });
        }
    }
    return [...by.values()].sort((a, b) => b.evidenceUrls.length - a.evidenceUrls.length);
}

/** What the artist says they do themselves. "Recording Engineer: Pharaoh
 *  Sistare" is worth knowing and is not a collaboration. */
export function selfCredits(extraction: CaptionExtraction): CaptionCredit[] {
    return extraction.credits.filter(c => c.isSelf);
}
