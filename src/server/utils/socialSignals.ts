/**
 * Pure analysis over an artist's stored social posts. No LLM, no I/O — every
 * function here takes rows in and returns signals out, so it is fully
 * unit-testable against fixtures extracted from a real scrape.
 *
 * Correctness rule (see socialIngest.ts and the design doc): a scraped feed
 * includes posts authored by OTHER people where the artist is a collaborator
 * (tagged / co-authored). `isOwnPost` is the load-bearing field — caption and
 * "in their own words" analysis (themes, standouts) is scoped to the
 * artist's OWN posts only. Collaboration is read from `coauthors` and from
 * the `ownerUsername` of posts NOT authored by the artist.
 *
 * Every returned item carries at least one source post URL (`evidenceUrls`,
 * or a single `url`) so a downstream consumer can always trace a claim back
 * to a real post.
 *
 * EVIDENCE INVARIANT (product-owner-caught defect, see the design doc and
 * `.superpowers/sdd/2026-08-17-post-claim-onboarding/signal-integrity-report.md`):
 * a signal's `evidenceUrls` (or `url`) MUST be the URL(s) of the exact
 * post(s) the signal's claim is actually about — never a different post
 * that merely shares a time window, a topic, or a rank (e.g. "top post that
 * month"). A downstream question built from a signal is only as honest as
 * this mapping. Every derive* function below enforces this structurally: it
 * only ever pushes `post.url` for the SAME post it just read the claim's
 * content from — never a URL picked by a separate ranking/sort over a
 * different set of posts. Do not add a signal that assembles its evidence
 * from anything other than the post(s) it directly read the claim from.
 */

/** Shape of a stored row, independent of the Drizzle table type — kept
 *  hand-written so this module has zero dependency on `@/server/db`, which
 *  is what makes it trivially testable against plain-object fixtures. */
export interface SocialPostRow {
    platform: string;
    platformPostId: string;
    ownerUsername: string;
    isOwnPost: boolean;
    caption: string | null;
    url: string;
    postedAt: string; // ISO 8601
    likeCount: number | null;
    commentCount: number | null;
    playCount: number | null;
    hashtags: string[];
    mentions: string[];
    coauthors: string[];
    musicTitle: string | null;
    musicArtist: string | null;
}

export interface Collaborator {
    handle: string;
    postCount: number;
    evidenceUrls: string[];
}

export interface MentionedAccount {
    handle: string;
    count: number;
    evidenceUrls: string[];
}

export interface Theme {
    term: string;
    kind: "hashtag" | "caption_term" | "caption_phrase";
    count: number;
    evidenceUrls: string[];
}

export interface StandoutPost {
    url: string;
    metric: "likes" | "plays";
    value: number;
    median: number;
    multiple: number;
    caption: string | null;
}

export interface MusicReference {
    title: string;
    artist: string;
    evidenceUrls: string[];
    postedByOwn: boolean; // true if at least one referencing post is the artist's own
    /** ownerUsername of the first post that carried this credit — lets a downstream
     *  consumer (questionGenerator) address the right handle when postedByOwn is false. */
    ownerUsername: string;
}

export interface SocialSignals {
    collaborators: Collaborator[];
    mentionedAccounts: MentionedAccount[];
    themes: Theme[];
    standoutPosts: StandoutPost[];
    musicReferences: MusicReference[];
}

const MAX_EVIDENCE_URLS = 5;
const MIN_SAMPLES_FOR_MEDIAN = 5;
const STANDOUT_MULTIPLE = 3;
// Hashtags and multi-word phrases are deliberate/specific enough that a low
// bar is fine. A single plain caption word with no other corroborating
// evidence (see CAPITALIZED_EVIDENCE below) needs a much higher bar before
// it's trusted as a real theme rather than incidental word frequency — see
// MIN_THEME_COUNT_GENERIC_WORD.
const MIN_THEME_COUNT = 2;
const MIN_THEME_COUNT_GENERIC_WORD = 5;
const MAX_THEME_TERM_LEN = 40;
const MIN_PHRASE_WORD_LEN = 4;

/** Deliberately broad: reflexives, auxiliaries/copulas, and vague fillers.
 *  These are exactly the words that survive naive frequency counting
 *  ("myself", "just", "thing") without ever being a real interest or theme —
 *  the failure mode this list exists to kill (see the design doc's live-run
 *  notes: "myself" surfaced as a theme purely from token frequency). */
const CAPTION_STOPWORDS = new Set([
    // original core list
    "this", "that", "with", "from", "have", "just", "your", "about", "when",
    "what", "really", "there", "their", "been", "will", "were", "they",
    "them", "then", "than", "also", "some", "more", "much", "very", "like",
    "only", "even", "into", "over", "after", "before", "because", "while",
    "where", "which", "would", "could", "should", "being", "doing", "going",
    "gonna", "wanna", "dont", "cant", "didnt", "youre", "here",
    "come", "came", "make", "made", "know", "knew", "want", "need", "getting",
    "back", "still", "many", "these", "those", "always", "never",
    "such", "everyone", "everybody", "something", "someone", "thank", "thanks",
    // reflexives — the specific defect this task exists to fix
    "myself", "yourself", "himself", "herself", "itself",
    "ourselves", "yourselves", "themselves",
    // auxiliaries / copulas
    "was", "are", "am", "does", "did", "doing", "done", "shall", "must",
    "might", "wont", "isnt", "arent", "wasnt", "werent", "hasnt", "hadnt",
    "doesnt", "havent", "couldnt", "wouldnt", "shouldnt",
    // vague fillers / hedges — content-free even when repeated
    "thing", "things", "stuff", "lot", "lots", "bit", "way", "ways",
    "gotta", "yeah", "okay", "alright", "totally", "honestly", "definitely",
    "probably", "maybe", "pretty", "actually", "basically", "literally",
    "kind", "sort", "little", "big", "good", "great", "nice", "cool",
]);

function norm(handle: string): string {
    return handle.trim().toLowerCase().replace(/^@/, "");
}

function pushEvidence(urls: string[], url: string): void {
    if (urls.length < MAX_EVIDENCE_URLS && !urls.includes(url)) urls.push(url);
}

function median(nums: number[]): number {
    if (nums.length === 0) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

/**
 * Collaborators: the strongest signal. A tagged co-author or a post authored
 * by someone else on the artist's feed is a mutual, IG-accepted collaboration
 * — unlike a one-way mention. Ranked by post count.
 */
function deriveCollaborators(posts: SocialPostRow[], handle: string): Collaborator[] {
    const self = norm(handle);
    const byHandle = new Map<string, { display: string; postCount: number; evidenceUrls: string[] }>();

    const bump = (rawHandle: string, url: string) => {
        const key = norm(rawHandle);
        if (!key || key === self) return; // never let the artist collaborate with themselves
        const entry = byHandle.get(key) ?? { display: rawHandle.trim().replace(/^@/, ""), postCount: 0, evidenceUrls: [] };
        entry.postCount += 1;
        pushEvidence(entry.evidenceUrls, url);
        byHandle.set(key, entry);
    };

    for (const post of posts) {
        for (const co of post.coauthors) bump(co, post.url);
        if (!post.isOwnPost) bump(post.ownerUsername, post.url);
    }

    return Array.from(byHandle.values())
        .map(({ display, postCount, evidenceUrls }) => ({ handle: display, postCount, evidenceUrls }))
        .sort((a, b) => b.postCount - a.postCount || a.handle.localeCompare(b.handle));
}

/**
 * Mentioned accounts: a one-way mention/tag on the artist's OWN posts only.
 * Weaker than a collaboration (the mentioned account didn't co-author
 * anything), so kept as a separate, lower-confidence signal.
 */
function deriveMentionedAccounts(posts: SocialPostRow[], handle: string): MentionedAccount[] {
    const self = norm(handle);
    const byHandle = new Map<string, { display: string; count: number; evidenceUrls: string[] }>();

    for (const post of posts) {
        if (!post.isOwnPost) continue;
        for (const mention of post.mentions) {
            const key = norm(mention);
            if (!key || key === self) continue;
            const entry = byHandle.get(key) ?? { display: mention.trim().replace(/^@/, ""), count: 0, evidenceUrls: [] };
            entry.count += 1;
            pushEvidence(entry.evidenceUrls, post.url);
            byHandle.set(key, entry);
        }
    }

    return Array.from(byHandle.values())
        .map(({ display, count, evidenceUrls }) => ({ handle: display, count, evidenceUrls }))
        .sort((a, b) => b.count - a.count || a.handle.localeCompare(b.handle));
}

/** Word-tokenizes an artist's display name ("Pete Rango" → {pete, rango}) so
 *  deriveThemes can drop the artist naming/signing themselves without also
 *  eating real interests. Deliberately NOT handle-substring matching — a
 *  handle like "housemusicdj" or "soft_core.music" contains real theme
 *  words ("house", "music") as substrings, so filtering against the handle
 *  itself would silently delete an artist's core theme. */
function nameTokens(name: string): Set<string> {
    return new Set((name.toLowerCase().match(/[a-z']{2,}/g) ?? []));
}

/** True (not Title/ALL-CAPS) proper-noun-style capitalization: first letter
 *  upper, rest lower — "Colombia" counts, "HOUSE" (shouting) doesn't. */
function isProperNounStyle(token: string): boolean {
    return /^[A-Z][a-z']*$/.test(token);
}

/** Recurring hashtags, salient caption words, and repeated multi-word
 *  phrases — own posts only. A single plain caption word is trusted as a
 *  theme in one of two ways: it clears a HIGH frequency bar on its own
 *  (MIN_THEME_COUNT_GENERIC_WORD), or it clears the normal low bar AND has
 *  "content-bearing" evidence — seen capitalized mid-caption (a name, a
 *  place, a proper noun) at least once. Hashtags and repeated two-word
 *  phrases are inherently more deliberate/specific, so they keep the low
 *  bar unconditionally. This is what keeps a real signal (a place name, a
 *  recurring hashtag, "black church") over a word-frequency artifact like
 *  "myself" or "just". */
function deriveThemes(posts: SocialPostRow[], artistNameTokens: Set<string>): Theme[] {
    const own = posts.filter(p => p.isOwnPost);
    const byTerm = new Map<string, { kind: Theme["kind"]; count: number; evidenceUrls: string[] }>();
    // Words seen capitalized (Title-case) somewhere other than the very
    // first token of a caption — sentence-initial capitalization is not
    // evidence of a proper noun, mid-caption capitalization usually is.
    const capitalizedEvidence = new Set<string>();

    const bump = (term: string, kind: Theme["kind"], url: string) => {
        const key = `${kind}:${term}`;
        const entry = byTerm.get(key) ?? { kind, count: 0, evidenceUrls: [] };
        entry.count += 1;
        pushEvidence(entry.evidenceUrls, url);
        byTerm.set(key, entry);
    };

    for (const post of own) {
        for (const tag of post.hashtags) {
            const term = tag.trim().toLowerCase();
            if (term && !artistNameTokens.has(term)) bump(term, "hashtag", post.url);
        }
        if (!post.caption) continue;

        const rawTokens = post.caption.match(/[A-Za-z']{4,}/g) ?? [];
        rawTokens.forEach((token, i) => {
            if (i > 0 && isProperNounStyle(token)) capitalizedEvidence.add(token.toLowerCase());
        });
        const words = rawTokens.map(t => t.toLowerCase());

        // Single content words, deduped within this post.
        const seenInThisPost = new Set<string>();
        for (const word of words) {
            if (word.length > MAX_THEME_TERM_LEN || CAPTION_STOPWORDS.has(word) || seenInThisPost.has(word)) continue;
            if (artistNameTokens.has(word)) continue; // e.g. "rango" from "Pete Rango"
            seenInThisPost.add(word);
            bump(word, "caption_term", post.url);
        }

        // Repeated two-word phrases — true adjacency in the original caption
        // (short filler words like "a"/"is"/"on" are already excluded by the
        // 4-char token regex above, so "black church on a tuesday" yields the
        // adjacent pair "black church"). Prefer these over single common
        // words: a phrase repeating verbatim across posts is much stronger
        // evidence of a real, specific theme than any one word in it.
        const seenPhrasesInThisPost = new Set<string>();
        for (let i = 0; i < words.length - 1; i++) {
            const w1 = words[i];
            const w2 = words[i + 1];
            if (w1.length < MIN_PHRASE_WORD_LEN || w2.length < MIN_PHRASE_WORD_LEN) continue;
            if (CAPTION_STOPWORDS.has(w1) || CAPTION_STOPWORDS.has(w2)) continue;
            if (artistNameTokens.has(w1) || artistNameTokens.has(w2)) continue;
            const phrase = `${w1} ${w2}`;
            if (phrase.length > MAX_THEME_TERM_LEN || seenPhrasesInThisPost.has(phrase)) continue;
            seenPhrasesInThisPost.add(phrase);
            bump(phrase, "caption_phrase", post.url);
        }
    }

    return Array.from(byTerm.entries())
        .map(([key, v]) => ({ term: key.slice(v.kind.length + 1), ...v }))
        .filter(t => {
            if (t.kind !== "caption_term") return t.count >= MIN_THEME_COUNT; // hashtag, caption_phrase
            if (t.count >= MIN_THEME_COUNT_GENERIC_WORD) return true; // frequent enough to trust alone
            return t.count >= MIN_THEME_COUNT && capitalizedEvidence.has(t.term); // proper-noun-like
        })
        .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}

/** Own posts whose engagement is a large multiple of the artist's own median. */
function deriveStandoutPosts(posts: SocialPostRow[]): StandoutPost[] {
    const own = posts.filter(p => p.isOwnPost);
    const byUrl = new Map<string, StandoutPost>();

    const scan = (metric: StandoutPost["metric"], pick: (p: SocialPostRow) => number | null) => {
        const withMetric = own
            .map(p => ({ p, value: pick(p) }))
            .filter((x): x is { p: SocialPostRow; value: number } => typeof x.value === "number" && x.value > 0);
        if (withMetric.length < MIN_SAMPLES_FOR_MEDIAN) return;
        const med = median(withMetric.map(x => x.value));
        if (med <= 0) return;
        for (const { p, value } of withMetric) {
            if (value < med * STANDOUT_MULTIPLE) continue;
            const multiple = round1(value / med);
            const existing = byUrl.get(p.url);
            if (!existing || multiple > existing.multiple) {
                byUrl.set(p.url, { url: p.url, metric, value, median: med, multiple, caption: p.caption });
            }
        }
    };

    scan("likes", p => p.likeCount);
    scan("plays", p => p.playCount);

    return Array.from(byUrl.values()).sort((a, b) => b.multiple - a.multiple);
}

/** True if `musicArtist`'s credit plausibly includes the artist themselves —
 *  i.e. every word of the artist's own name appears somewhere in the
 *  credit's tokens ("Dame Atlas, Pete Rango" / "Pete Rango, Elle Symone" for
 *  artist "Pete Rango"). This is the bar for "the artist's OWN work" vs.
 *  third-party/trending audio the artist merely used on a post (see the
 *  design doc: a track credited to someone else — "Los Caracuchos", "Brian
 *  Eno" — is NOT a music signal about the artist, no matter how it was
 *  used). `artistNameTokens` empty (no name available to check against) is
 *  treated as "cannot verify" and passes everything through unfiltered
 *  rather than dropping everything — see deriveSocialSignals. */
function creditIncludesArtist(musicArtist: string, artistNameTokens: Set<string>): boolean {
    if (artistNameTokens.size === 0) return true;
    const creditTokens = nameTokens(musicArtist);
    for (const token of artistNameTokens) {
        if (!creditTokens.has(token)) return false;
    }
    return true;
}

/** Real track credits that are plausibly the artist's OWN work (see
 *  creditIncludesArtist) — own or collab posts alike, since this is
 *  metadata about a song, not an attribution of anyone's caption. Evidence
 *  URLs are only ever the post(s) that actually carry that exact
 *  title+artist credit (the EVIDENCE INVARIANT at the top of this file). */
function deriveMusicReferences(posts: SocialPostRow[], artistNameTokens: Set<string>): MusicReference[] {
    const byKey = new Map<string, MusicReference>();
    for (const post of posts) {
        if (!post.musicTitle || !post.musicArtist) continue;
        if (!creditIncludesArtist(post.musicArtist, artistNameTokens)) continue;
        const key = `${post.musicTitle.toLowerCase()}::${post.musicArtist.toLowerCase()}`;
        const entry = byKey.get(key) ?? { title: post.musicTitle, artist: post.musicArtist, evidenceUrls: [], postedByOwn: false, ownerUsername: post.ownerUsername };
        pushEvidence(entry.evidenceUrls, post.url);
        entry.postedByOwn = entry.postedByOwn || post.isOwnPost;
        byKey.set(key, entry);
    }
    return Array.from(byKey.values()).sort((a, b) => b.evidenceUrls.length - a.evidenceUrls.length || a.title.localeCompare(b.title));
}

/** How far back a post can be and still be worth asking about.
 *
 *  `postedAt` was stored from the start and then used by nothing — no sort, no
 *  window, no weighting — so a 2020 post competed on equal footing with last
 *  week's. Two different artists were asked to reflect on posts from years ago;
 *  the second time, the artist's reaction was "how is it relevant now?".
 *
 *  Eighteen months is deliberately generous: an album cycle is long, and a
 *  release from last year is still live for an independent artist. */
const RECENT_WINDOW_DAYS = 548;

/** How much recent activity counts as "enough to work from". Below this we fall
 *  back to the artist's whole history rather than an arbitrary slice of it: the
 *  window exists to stop old posts crowding out new ones, not to throw data away
 *  from someone who simply posts rarely. A stale question beats silence. */
const MIN_POSTS_FOR_SIGNALS = 30;

/** Most recent first; undated posts sort last rather than being dropped. */
function byRecency(a: SocialPostRow, b: SocialPostRow): number {
    return (Date.parse(b.postedAt || "") || 0) - (Date.parse(a.postedAt || "") || 0);
}

/**
 * The posts worth deriving signals from: everything inside the recency window,
 * or the most recent `MIN_POSTS_FOR_SIGNALS` if the window is thinner than that.
 *
 * Exported for testing — the selection rule is the part that decides whether an
 * artist gets asked about this year or about 2020.
 */
export function selectRecentPosts(posts: SocialPostRow[], now: number = Date.now()): SocialPostRow[] {
    const sorted = [...posts].sort(byRecency);
    const cutoff = now - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const inWindow = sorted.filter(p => {
        const t = Date.parse(p.postedAt || "");
        return Number.isFinite(t) && t >= cutoff;
    });
    // Fall back to EVERYTHING, not to the most recent N — truncating a sparse
    // artist's history to an arbitrary count loses real signal and buys nothing.
    return inWindow.length >= MIN_POSTS_FOR_SIGNALS ? inWindow : sorted;
}

export function deriveSocialSignals(allPosts: SocialPostRow[], handle: string, artistName?: string): SocialSignals {
    const artistNameTokens = nameTokens(artistName ?? "");
    // Signals come from RECENT activity. Engagement medians are computed over
    // the same subset on purpose: a standout post should stand out against what
    // the artist does now, not against a five-year average.
    const posts = selectRecentPosts(allPosts);
    return {
        collaborators: deriveCollaborators(posts, handle),
        mentionedAccounts: deriveMentionedAccounts(posts, handle),
        themes: deriveThemes(posts, artistNameTokens),
        standoutPosts: deriveStandoutPosts(posts),
        musicReferences: deriveMusicReferences(posts, artistNameTokens),
    };
}
