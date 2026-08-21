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

/** Per-page text handed to the judge. Enough to tell who a page is about —
 *  a page that hasn't said whose it is in 1,500 characters is not a source. */
const EXCERPT_CHARS = 1_500;
const JUDGE_TIMEOUT_MS = 8_000;
/** Above this, judging costs more than the sources are worth; the extras keep
 *  the name-check behaviour rather than being dropped. */
export const MAX_JUDGED_CANDIDATES = 12;

export type RelevanceVerdict = "about-artist" | "not-about-artist" | "undecided";

export type RelevanceCandidate = {
    url: string;
    title: string | null;
    text: string | null;
};

/** What we can prove about who the artist is, independent of their name. */
export type ArtistAnchor = {
    name: string;
    /** Real release/track names from the artist's verified platform catalog. */
    catalog?: string[];
    /** Confirmed handles/IDs, e.g. "instagram: p3t3rango". */
    identifiers?: string[];
};

function anchorBlock(anchor: ArtistAnchor): string {
    const lines = [`NAME: ${anchor.name}`];
    if (anchor.catalog?.length) lines.push(`VERIFIED RELEASES: ${anchor.catalog.slice(0, 12).join(", ")}`);
    if (anchor.identifiers?.length) lines.push(`CONFIRMED ACCOUNTS: ${anchor.identifiers.slice(0, 12).join(", ")}`);
    return lines.join("\n");
}

const SYSTEM_INSTRUCTION = `You decide whether each numbered page is about ONE specific music artist.

The artist is identified by the anchor block: their name, their verified releases, and accounts confirmed to be theirs. The name alone is NOT sufficient evidence — people and products share names.

Answer "yes" only if the page is about this artist. Answer "no" for:
- a different person or band with the same or a similar name
- a PRODUCT that shares the name (audio hardware, software, a film)
- a page that merely mentions them in passing without being about them
- a page you cannot tell either way

Reply with ONLY a JSON array, one object per numbered page, no other text:
[{"i": 0, "about": true}, {"i": 1, "about": false}]

Use the page's NUMBER. Never write a URL.`;

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
        .map((c, i) => `--- PAGE ${i} ---\nTITLE: ${c.title ?? "(none)"}\n${(c.text ?? "").slice(0, EXCERPT_CHARS)}`)
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
            const { i, about } = row as { i?: unknown; about?: unknown };
            // Index must land inside the batch we actually sent. An out-of-range
            // number is a model error, never a source we quietly guess about.
            if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= judgeable.length) continue;
            if (typeof about !== "boolean") continue;
            verdicts.set(judgeable[i].url, about ? "about-artist" : "not-about-artist");
        }
    } catch (e) {
        console.error("[sourceRelevance] unparseable judge output:", e);
    }

    return verdicts;
}
