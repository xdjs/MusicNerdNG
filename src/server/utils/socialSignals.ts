/**
 * Pure analysis over an artist's stored social posts. No LLM, no I/O — every
 * function here takes rows in and returns signals out, so it is fully
 * unit-testable against fixtures extracted from a real scrape.
 *
 * Correctness rule (see socialIngest.ts and the design doc): a scraped feed
 * includes posts authored by OTHER people where the artist is a collaborator
 * (tagged / co-authored). `isOwnPost` is the load-bearing field — caption and
 * "in their own words" analysis (themes, standouts, bursts) is scoped to the
 * artist's OWN posts only. Collaboration is read from `coauthors` and from
 * the `ownerUsername` of posts NOT authored by the artist.
 *
 * Every returned item carries at least one source post URL (`evidenceUrls`,
 * or a single `url`/`topPostUrl`) so a downstream consumer can always trace
 * a claim back to a real post.
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
    kind: "hashtag" | "caption_term";
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

export interface Burst {
    month: string; // YYYY-MM
    postCount: number;
    baseline: number;
    topPostUrl: string;
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
    bursts: Burst[];
    musicReferences: MusicReference[];
}

const MAX_EVIDENCE_URLS = 5;
const MIN_SAMPLES_FOR_MEDIAN = 5;
const STANDOUT_MULTIPLE = 3;
const MIN_THEME_COUNT = 2;
const MAX_THEME_TERM_LEN = 40;
const BURST_MULTIPLE = 2;
const BURST_FLOOR = 3;
const MIN_MONTHS_FOR_BASELINE = 3;

const CAPTION_STOPWORDS = new Set([
    "this", "that", "with", "from", "have", "just", "your", "about", "when",
    "what", "really", "there", "their", "been", "will", "were", "they",
    "them", "then", "than", "also", "some", "more", "much", "very", "like",
    "only", "even", "into", "over", "after", "before", "because", "while",
    "where", "which", "would", "could", "should", "being", "doing", "going",
    "gonna", "wanna", "dont", "cant", "didnt", "youre", "were", "here",
    "come", "came", "make", "made", "know", "knew", "want", "need", "getting",
    "back", "still", "much", "many", "these", "those", "always", "never",
    "such", "everyone", "everybody", "something", "someone", "thank", "thanks",
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

/** Recurring hashtags and salient caption words — own posts only. */
function deriveThemes(posts: SocialPostRow[], artistNameTokens: Set<string>): Theme[] {
    const own = posts.filter(p => p.isOwnPost);
    const byTerm = new Map<string, { kind: Theme["kind"]; count: number; evidenceUrls: string[] }>();

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
        if (post.caption) {
            const words = post.caption.toLowerCase().match(/[a-z']{4,}/g) ?? [];
            const seenInThisPost = new Set<string>();
            for (const word of words) {
                if (word.length > MAX_THEME_TERM_LEN || CAPTION_STOPWORDS.has(word) || seenInThisPost.has(word)) continue;
                if (artistNameTokens.has(word)) continue; // e.g. "rango" from "Pete Rango"
                seenInThisPost.add(word);
                bump(word, "caption_term", post.url);
            }
        }
    }

    return Array.from(byTerm.entries())
        .map(([key, v]) => ({ term: key.slice(v.kind.length + 1), ...v }))
        .filter(t => t.count >= MIN_THEME_COUNT)
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

/** Months where the artist posted (own posts) at an unusual multiple of their own baseline. */
function deriveBursts(posts: SocialPostRow[]): Burst[] {
    const own = posts.filter(p => p.isOwnPost);
    const byMonth = new Map<string, SocialPostRow[]>();
    for (const post of own) {
        const month = post.postedAt.slice(0, 7); // YYYY-MM
        if (!month || month.length !== 7) continue;
        const arr = byMonth.get(month) ?? [];
        arr.push(post);
        byMonth.set(month, arr);
    }

    if (byMonth.size < MIN_MONTHS_FOR_BASELINE) return [];

    const counts = Array.from(byMonth.values()).map(arr => arr.length);
    const baseline = median(counts);
    if (baseline <= 0) return [];

    const bursts: Burst[] = [];
    for (const [month, arr] of byMonth.entries()) {
        if (arr.length < BURST_FLOOR || arr.length < baseline * BURST_MULTIPLE) continue;
        const top = [...arr].sort((a, b) => (b.likeCount ?? b.playCount ?? 0) - (a.likeCount ?? a.playCount ?? 0))[0];
        bursts.push({ month, postCount: arr.length, baseline: round1(baseline), topPostUrl: top.url });
    }

    return bursts.sort((a, b) => b.postCount - a.postCount);
}

/** Real track credits, own or collab posts alike — this is metadata about a
 *  song, not an attribution of anyone's caption, so both count. */
function deriveMusicReferences(posts: SocialPostRow[]): MusicReference[] {
    const byKey = new Map<string, MusicReference>();
    for (const post of posts) {
        if (!post.musicTitle || !post.musicArtist) continue;
        const key = `${post.musicTitle.toLowerCase()}::${post.musicArtist.toLowerCase()}`;
        const entry = byKey.get(key) ?? { title: post.musicTitle, artist: post.musicArtist, evidenceUrls: [], postedByOwn: false, ownerUsername: post.ownerUsername };
        pushEvidence(entry.evidenceUrls, post.url);
        entry.postedByOwn = entry.postedByOwn || post.isOwnPost;
        byKey.set(key, entry);
    }
    return Array.from(byKey.values()).sort((a, b) => b.evidenceUrls.length - a.evidenceUrls.length || a.title.localeCompare(b.title));
}

export function deriveSocialSignals(posts: SocialPostRow[], handle: string, artistName?: string): SocialSignals {
    return {
        collaborators: deriveCollaborators(posts, handle),
        mentionedAccounts: deriveMentionedAccounts(posts, handle),
        themes: deriveThemes(posts, nameTokens(artistName ?? "")),
        standoutPosts: deriveStandoutPosts(posts),
        bursts: deriveBursts(posts),
        musicReferences: deriveMusicReferences(posts),
    };
}
