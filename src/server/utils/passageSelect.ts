/**
 * The parts of a source that answer THIS question.
 *
 * The ask used to send the first 2,000 characters of every stored source. We
 * store up to fifty thousand, so that was four per cent of what we have — and
 * the wrong four per cent: the opening of an article is the masthead, the
 * navigation and the standfirst, while the sentence that answers a question
 * about a particular record is usually thousands of characters in.
 *
 * Raising the cap would make prompts bigger without making them better. This
 * picks instead: score paragraphs against the question, keep the best, and put
 * the budget where the answer is.
 *
 * DELIBERATELY NOT EMBEDDINGS. That would mean an embedding call per source per
 * question, an index to maintain and a vector store to run, against a corpus of
 * a few dozen articles per artist. Term overlap with a length prior gets most
 * of the benefit for none of the infrastructure, and can be replaced later
 * without changing a caller.
 */

/** Words too common to say anything about which paragraph is relevant. */
const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
    "with", "from", "by", "as", "is", "are", "was", "were", "be", "been", "it",
    "its", "this", "that", "these", "those", "he", "she", "they", "them", "his",
    "her", "their", "what", "who", "when", "where", "why", "how", "did", "does",
    "do", "you", "your", "about", "into", "over", "than", "then", "there",
    "have", "has", "had", "not", "can", "could", "would", "will", "any", "some",
]);

/** Below this a paragraph is a caption, a byline or a nav crumb. */
const MIN_PARAGRAPH_CHARS = 80;
/** Above this it is almost certainly several paragraphs the extractor ran
 *  together; still usable, just capped when emitted. */
const MAX_PARAGRAPH_CHARS = 1_200;

function terms(text: string): string[] {
    return text.toLowerCase()
        .split(/[^\p{L}\p{N}']+/u)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

/** Split on blank lines, then on sentence runs when a source has no paragraph
 *  breaks left after extraction. */
function paragraphs(text: string): string[] {
    const byBlankLine = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const out: string[] = [];
    for (const p of byBlankLine) {
        if (p.length <= MAX_PARAGRAPH_CHARS) { out.push(p); continue; }
        // One long run: break it into sentence groups rather than dropping it.
        let buf = "";
        for (const sentence of p.split(/(?<=[.!?])\s+/)) {
            if (buf.length + sentence.length > MAX_PARAGRAPH_CHARS) { out.push(buf.trim()); buf = ""; }
            buf += `${sentence} `;
        }
        if (buf.trim()) out.push(buf.trim());
    }
    return out;
}

export interface SelectedPassages {
    /** Joined, ready to drop into a prompt. */
    text: string;
    /** How many paragraphs were considered and how many kept — worth logging,
     *  because "we sent the wrong part of the article" is invisible otherwise. */
    considered: number;
    kept: number;
}

/**
 * Choose the passages of `body` most relevant to `question`.
 *
 * Falls back to the opening of the text when nothing scores — a source that
 * shares no vocabulary with the question may still be the only thing we have,
 * and an empty context is worse than a generic one.
 */
export function selectPassages(
    body: string,
    question: string,
    opts?: { budgetChars?: number; alwaysIncludeOpening?: boolean },
): SelectedPassages {
    const budget = opts?.budgetChars ?? 2_400;
    const clean = (body ?? "").trim();
    if (!clean) return { text: "", considered: 0, kept: 0 };
    if (clean.length <= budget) return { text: clean, considered: 1, kept: 1 };

    const wanted = new Set(terms(question));
    const paras = paragraphs(clean).filter(p => p.length >= MIN_PARAGRAPH_CHARS);
    if (paras.length === 0) return { text: clean.slice(0, budget), considered: 0, kept: 0 };

    const scored = paras.map((p, i) => {
        const words = terms(p);
        if (words.length === 0) return { p, i, score: 0 };
        let hits = 0;
        const seen = new Set<string>();
        for (const w of words) {
            if (!wanted.has(w)) continue;
            hits += 1;
            seen.add(w);
        }
        // Distinct question terms matter more than repetition: a paragraph
        // covering three of the asked-about things beats one saying the same
        // word six times. Normalised by length so a long paragraph does not win
        // on volume alone.
        const score = (seen.size * 3 + hits) / Math.sqrt(words.length);
        return { p, i, score };
    }).sort((a, b) => b.score - a.score || a.i - b.i);

    const chosen: { p: string; i: number }[] = [];
    let used = 0;

    // The opening usually establishes who and what the piece is about, which
    // later paragraphs assume. Cheap insurance against a perfectly relevant
    // paragraph arriving with no idea who it is discussing.
    if (opts?.alwaysIncludeOpening !== false) {
        const first = paras[0];
        chosen.push({ p: first, i: 0 });
        used += first.length;
    }

    for (const s of scored) {
        if (s.score <= 0) break;
        if (chosen.some(c => c.i === s.i)) continue;
        if (used + s.p.length > budget) continue;
        chosen.push({ p: s.p, i: s.i });
        used += s.p.length;
    }

    if (chosen.length === 0) return { text: clean.slice(0, budget), considered: paras.length, kept: 0 };

    // Emitted in document order: passages read as an argument that way, and a
    // model handed them out of order will sometimes narrate the shuffling.
    chosen.sort((a, b) => a.i - b.i);
    const gapped = chosen.map((c, idx) => {
        const previous = chosen[idx - 1];
        const skipped = previous && c.i > previous.i + 1;
        return `${skipped ? "[…] " : ""}${c.p}`;
    });

    return { text: gapped.join("\n\n"), considered: paras.length, kept: chosen.length };
}
