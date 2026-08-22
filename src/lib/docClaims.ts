/**
 * Turns the knowledge document into the thing an artist can actually act on: a
 * list of claims, each carrying the sources it came from.
 *
 * The document is markdown with `##` sections and `[n]` citation markers, and it
 * is written for a model to read. Showing an artist that file would be showing
 * them our internals and asking them to be a copy editor for a machine. Worse,
 * the document is REGENERATED whenever their sources change (see
 * refreshArtistDoc), so anything they typed into it would be destroyed the next
 * time they added a source.
 *
 * So the artist never edits the document. They correct CLAIMS, and those
 * corrections live outside the document and are re-applied on every rebuild —
 * the same durability the source rejections already have.
 *
 * A claim is a bullet, or a sentence in a paragraph. Both are units a person can
 * look at and say "that's wrong" about, which is the whole point.
 */

/** Internal section headers, mapped to what an artist should see. A section
 *  absent from this map is not rendered at all: `Overview` is their About and
 *  `Online Presence` is their Links, both already on the page, and showing them
 *  twice invites contradictory edits in two places. */
const SECTION_LABELS: Record<string, string> = {
    "Career Highlights": "What you've done",
    "Story hooks": "Things worth telling",
    "Sound & Influences": "Your sound",
    "Discography Highlights": "Your releases",
    "Industry Connections": "Who you've worked with",
    "Recent Activity": "Lately",
    "Who They Are": "You, off the record",
    "In Their Own Words": "Things you've said",
    "Audience & Fanbase": "Your audience",
};

export type DocClaim = {
    /** Stable within a rebuild: section + index. Used as a React key only —
     *  corrections are keyed by the claim TEXT, which survives regeneration far
     *  better than a position does. */
    key: string;
    /** Display text, citation markers removed. */
    text: string;
    /** Source ids cited by this claim, in the order they appeared. */
    sourceIds: number[];
};

export type DocSection = {
    /** The raw `##` header, for keying corrections and debugging. */
    header: string;
    /** What the artist sees. */
    label: string;
    claims: DocClaim[];
};

const MARKER = /\[(\d+)\](?:\[(\d+)\])*/g;

/** Citation ids inside one claim, deduped, in order of appearance. */
function citedIds(text: string): number[] {
    const ids: number[] = [];
    for (const m of text.matchAll(/\[(\d+)\]/g)) {
        const n = Number(m[1]);
        if (!ids.includes(n)) ids.push(n);
    }
    return ids;
}

/** Strip `[3]`, `[2][5]`, and the space that precedes them, plus the markdown
 *  emphasis the document uses for titles. `*Bartholomew WAVE I*` is how a file
 *  writes an album name; a person reading their own profile should just see
 *  Bartholomew WAVE I. */
function stripMarkers(text: string): string {
    return text
        .replace(new RegExp(`\\s*${MARKER.source}`, "g"), "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

/** A full stop that belongs to an abbreviation, not to a sentence.
 *
 *  `.I.V.` catches initialisms letter by letter, which is how a real artist's
 *  non-profit "L.I.V. (Life Is Valuable)" was being torn into two claims neither
 *  of which said anything. The named list covers the ordinary titles and
 *  credits that show up in music writing. */
const ABBREVIATION_END = /(?:\.[A-Za-z]|\b(?:mr|mrs|ms|dr|prof|st|jr|sr|vs|etc|feat|ft|inc|ltd|co|no|vol|ep|approx|dept))\.$/i;

/**
 * Split a paragraph into sentences without breaking inside a quotation.
 *
 * The document quotes artists verbatim, and those quotes contain their own
 * full stops — "Make a plan, release your art, and don't hoard it forever." A
 * naive split on `.` turns one thing the artist said into three fragments they
 * cannot recognise, let alone correct.
 */
function splitSentences(paragraph: string): string[] {
    const out: string[] = [];
    let buf = "";
    let inQuote = false;
    const chars = [...paragraph];
    for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        buf += c;
        if (c === '"' || c === "“" || c === "”") inQuote = !inQuote;
        if (inQuote || !/[.!?]/.test(c)) continue;
        if (ABBREVIATION_END.test(buf)) continue;
        // A terminator only ends a sentence when followed by space + a capital,
        // which keeps "i-Standard's" and "Ep774." style fragments intact.
        const rest = chars.slice(i + 1).join("");
        if (rest === "" || /^\s+["“(]?[A-Z0-9]/.test(rest)) {
            out.push(buf.trim());
            buf = "";
        }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(Boolean);
}

/**
 * Parse a knowledge document into artist-facing sections of claims.
 *
 * Unknown sections are dropped rather than rendered with a raw header — a
 * header we have no human name for is one we have not decided how to present,
 * and a leaking `## Audience & Fanbase` is exactly the markdown-file look this
 * exists to avoid.
 */
export function parseDocClaims(doc: string): DocSection[] {
    if (!doc?.trim()) return [];
    const sections: DocSection[] = [];
    let current: DocSection | null = null;

    const flush = () => {
        if (current && current.claims.length > 0) sections.push(current);
        current = null;
    };

    for (const rawLine of doc.split("\n")) {
        const line = rawLine.trim();

        const heading = line.match(/^##\s+(.+?)\s*$/);
        if (heading) {
            flush();
            const header = heading[1];
            const label = SECTION_LABELS[header];
            current = label ? { header, label, claims: [] } : null;
            continue;
        }
        // The `# NAME - Artist Knowledge Document` title and anything before the
        // first known section.
        if (!current || !line || line.startsWith("#")) continue;

        const pieces = line.startsWith("- ") || line.startsWith("* ")
            ? [line.slice(2).trim()]
            : splitSentences(line);

        for (const piece of pieces) {
            const text = stripMarkers(piece);
            // A fragment that is only a citation, or a stub, is not something a
            // person can judge — dropping it beats rendering an empty row.
            if (text.length < 12) continue;
            current.claims.push({
                key: `${current.header}:${current.claims.length}`,
                text,
                sourceIds: citedIds(piece),
            });
        }
    }
    flush();
    return sections;
}

/** Total claims across all sections — for the section header's count. */
export function countClaims(sections: DocSection[]): number {
    return sections.reduce((n, s) => n + s.claims.length, 0);
}
