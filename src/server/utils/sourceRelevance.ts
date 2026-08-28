/**
 * Is this fetched page actually about THIS artist?
 *
 * Relevance used to be decided by `nameAppearsIn` — does the page contain the
 * literal artist name. That is a substring test standing in for a judgement, and
 * it cannot distinguish:
 *   - a Chord DAVE amplifier review from Black Dave the artist
 *   - a Peter Calandra interview from Pete Rango
 *   - Dave the UK rapper's Guardian piece from Black Dave MK2
 * All three reached real artists' vaults.
 *
 * Meanwhile a VERIFIED identity anchor sat unused: the artist's platform ID,
 * their real catalog from Spotify, their confirmed handles. A model reading the
 * page against that anchor can answer the question the substring check was
 * pretending to answer. This is the division already established for retrieval —
 * a search API retrieves, the model judges — finally applied to judgement.
 *
 * BINDING BY INDEX, NOT URL. The model is given numbered candidates and returns
 * verdicts by number. It is never asked to echo a URL: a model that echoes
 * identifiers can invent them, which is exactly how this pipeline previously
 * ended up storing a YouTube video that does not exist. An index outside the
 * supplied range is discarded rather than guessed at.
 *
 * NEVER THROWS, and never silently rejects on failure. If the model is
 * unavailable, malformed, or times out, every candidate comes back `undecided`
 * and the caller falls back to the existing name check. A relevance judge that
 * deletes an artist's real press when Gemini has a bad day is worse than no
 * judge at all.
 */
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { sourceTier } from "@/lib/sourceAuthority";

/** Per-page text handed to the judge. Enough to tell who a page is about —
 *  a page that hasn't said whose it is in 1,500 characters is not a source. */
const EXCERPT_CHARS = 1_500;
/** Generous on purpose. A timeout here does not degrade gracefully — every
 *  candidate comes back `undecided` and the caller falls through to a substring
 *  name check, which is the exact path that lets "Pharaoh Overlord" through for
 *  Pharaoh Sistare. Measured 1.5-4s for a full batch; the benchmark caught this
 *  blowing at 8s once verification made runs longer. Judging slowly beats not
 *  judging. */
const JUDGE_TIMEOUT_MS = 20_000;
/** Above this, judging costs more than the sources are worth; the extras keep
 *  the name-check behaviour rather than being dropped. */
export const MAX_JUDGED_CANDIDATES = 12;

export type RelevanceVerdict = "about-artist" | "lists-artist" | "not-about-artist" | "undecided";

export type RelevanceCandidate = {
    url: string;
    title: string | null;
    text: string | null;
    /** True when the URL is the artist's own domain, which the caller knows and
     *  a hostname cannot tell. Only affects the tier shown to the model. */
    ownDomain?: boolean;
};

/** What we can prove about who the artist is, independent of their name. */
export type ArtistAnchor = {
    name: string;
    /** Real release/track names from the artist's verified platform catalog. */
    catalog?: string[];
    /** Confirmed handles/IDs, e.g. "instagram: p3t3rango". */
    identifiers?: string[];
};

/**
 * How much of a page is actually about the artist: paragraphs naming them, over
 * paragraphs total.
 *
 * This is the evidence that separates coverage from an index. Measured on one
 * real artist's four approved sources:
 *
 *   lifechangesnetwork   8/58   13.8%   interview
 *   voyagemia            6/67    9.0%   interview
 *   rvamag               1/15    6.7%   tag archive
 *   soundbetter          2/173   1.2%   marketplace directory
 *
 * Handed to the model as a fact to weigh, NOT thresholded here. 6.7% and 9.0%
 * are too close to split on, and the number means different things on a
 * four-paragraph review than on a long interview. The model has the excerpt and
 * the title as well; this is the signal it cannot get from an excerpt, since a
 * directory page's first screen looks like a headline about the artist.
 *
 * Returns null when the text has no paragraph structure to count — sources
 * stored before extractReadableText landed are a single line, and "1 of 1"
 * would be a lie rather than a missing value.
 */
export function mentionDensity(
    text: string,
    artistName: string,
    /** Confirmed handles, in the anchor's "instagram: p3t3rango" form. A page
     *  that calls the artist @p3t3rango is talking about them just as much as one
     *  that writes their name — counting only the display name undercounts a real
     *  interview and pushes it toward looking like an index. */
    identifiers: string[] = [],
): { hits: number; total: number } | null {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length < 4) return null;
    const name = artistName.trim().toLowerCase();
    if (!name) return null;
    const handles = identifiers
        .map(i => i.split(":").pop()?.trim().toLowerCase().replace(/^@/, "") ?? "")
        .filter(h => h.length >= 4 && !/^https?$/.test(h));
    // Flexible whitespace: "Pete  Rango" and "Pete\nRango" are the same mention.
    const nameRe = new RegExp(name.split(/\s+/).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i");
    const longest = name.split(/\s+/).filter(t => t.length >= 4).sort((a, b) => b.length - a.length)[0];
    const tokenRe = longest ? new RegExp(`\\b${longest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") : null;
    const hits = paragraphs.filter(p => {
        const low = p.toLowerCase();
        return nameRe.test(p) || (tokenRe?.test(p) ?? false) || handles.some(h => low.includes(h));
    }).length;
    return { hits, total: paragraphs.length };
}

function anchorBlock(anchor: ArtistAnchor): string {
    const lines = [`NAME: ${anchor.name}`];
    if (anchor.catalog?.length) lines.push(`VERIFIED RELEASES: ${anchor.catalog.slice(0, 12).join(", ")}`);
    if (anchor.identifiers?.length) lines.push(`CONFIRMED ACCOUNTS: ${anchor.identifiers.slice(0, 12).join(", ")}`);
    return lines.join("\n");
}

const SYSTEM_INSTRUCTION = `You classify each numbered page against ONE specific music artist.

The artist is identified by the anchor block: their name, their verified releases, and accounts confirmed to be theirs. The name alone is NOT sufficient evidence — people and products share names.

Give each page exactly one verdict:

"about" — the page is COVERAGE OF THIS ARTIST. An interview, a review, a feature, a profile written about them, their own page about themselves. Someone set out to write about this person.

"lists" — the page is real and does concern this artist, but it INDEXES rather than covers. A directory, a tag or category archive, a search-results page, a marketplace listing, a chart, a roster, a credits index, a "related artists" page. The tell is that the page's purpose is enumeration: most of it is about OTHER people, or it is navigation and filters, and the artist is one entry among many. Titles like "Producers who worked with X", "X Archives", "Artists similar to X" are this. So is a page that names the artist in a tiny fraction of its paragraphs while listing many other names.
This is NOT a lesser "about". A page that merely lists the artist is worthless as a source and its other names are actively dangerous, because they read as this artist's collaborators when they are competitors on the same index.

"no" — not this artist at all. A different person or band with the same or similar name; a PRODUCT sharing the name (audio hardware, software, a film); a page that mentions them once in passing while being about something else; or a page you cannot tell either way.

Each page carries a MENTIONS line giving how many of its paragraphs name the artist. Weigh it — a very low share is strong evidence of "lists" — but it is one signal, not a rule: a short review can be entirely about the artist while naming them twice, and a long interview refers to them as "I" throughout.

Each page also carries a TIER line describing the site it came from. "low-signal" means the site generates its pages from scraped or catalogue data rather than publishing written work, so treat it as "lists" unless the page itself shows a human wrote it about this artist. "preferred" and "unknown" carry no such presumption; judge them on the page. The tier is about the SITE and never settles which person a page is about — a low-signal page about somebody else is still "no".

Reply with ONLY a JSON array, one object per numbered page, no other text:
[{"i": 0, "v": "about"}, {"i": 1, "v": "lists"}, {"i": 2, "v": "no"}]

Use the page's NUMBER. Never write a URL.`;

const VERDICT_BY_TOKEN: Record<string, RelevanceVerdict> = {
    about: "about-artist",
    lists: "lists-artist",
    no: "not-about-artist",
};

/**
 * Judges up to MAX_JUDGED_CANDIDATES pages against the anchor.
 * Returns a verdict per input url; anything not judged is `undecided`.
 */
export async function judgeSourceRelevance(
    anchor: ArtistAnchor,
    candidates: RelevanceCandidate[],
): Promise<Map<string, RelevanceVerdict>> {
    const verdicts = new Map<string, RelevanceVerdict>();
    for (const c of candidates) verdicts.set(c.url, "undecided");

    // Only pages we could actually read are judgeable — there is nothing to
    // reason about in an empty body, and guessing from a URL is the failure
    // mode this module exists to remove.
    const judgeable = candidates.filter(c => (c.text?.trim().length ?? 0) > 0).slice(0, MAX_JUDGED_CANDIDATES);
    if (judgeable.length === 0) return verdicts;

    const pages = judgeable
        .map((c, i) => {
            const density = mentionDensity(c.text ?? "", anchor.name, anchor.identifiers ?? []);
            // Omitted rather than faked when the text has no paragraphs to count.
            const mentions = density
                ? `MENTIONS: names the artist in ${density.hits} of ${density.total} paragraphs`
                : `MENTIONS: unknown (no paragraph structure)`;
            // The site, as a fact to weigh alongside the page. A stats dashboard
            // reads like coverage in its first 1,500 characters — Pharaoh
            // Sistare's Viberate page did, and was affirmed as "about" — because
            // the thing that gives it away is who publishes it, which is not on
            // the page.
            const tier = `TIER: ${sourceTier(c.url, null, { ownDomain: c.ownDomain })}`;
            return `--- PAGE ${i} ---\nTITLE: ${c.title ?? "(none)"}\n${tier}\n${mentions}\n${(c.text ?? "").slice(0, EXCERPT_CHARS)}`;
        })
        .join("\n\n");

    let text = "";
    try {
        const response = await Promise.race([
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: `ARTIST ANCHOR:\n${anchorBlock(anchor)}\n\nPAGES:\n${pages}`,
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                    temperature: 0,
                    responseMimeType: "application/json",
                    thinkingConfig: { thinkingBudget: 0 },
                },
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("relevance judge timeout")), JUDGE_TIMEOUT_MS)),
        ]);
        text = response.text ?? "";
    } catch (e) {
        console.error("[sourceRelevance] judge failed, every candidate stays undecided:", e);
        return verdicts;
    }

    try {
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return verdicts;
        const parsed: unknown = JSON.parse(match[0]);
        if (!Array.isArray(parsed)) return verdicts;
        for (const row of parsed) {
            if (!row || typeof row !== "object") continue;
            const { i, v } = row as { i?: unknown; v?: unknown };
            // Index must land inside the batch we actually sent. An out-of-range
            // number is a model error, never a source we quietly guess about.
            if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= judgeable.length) continue;
            // An unrecognised verdict string stays `undecided` — the caller then
            // falls back to the name check, which is the safe direction.
            const mapped = VERDICT_BY_TOKEN[String(v).toLowerCase()];
            if (!mapped) continue;
            verdicts.set(judgeable[i].url, mapped);
        }
    } catch (e) {
        console.error("[sourceRelevance] unparseable judge output:", e);
    }

    return verdicts;
}
