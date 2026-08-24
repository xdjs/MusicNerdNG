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

/**
 * Internal section headers, mapped to what an artist should see.
 *
 * A section absent from this map is not rendered: `Online Presence` is their
 * Links, already on the page, and editing one fact in two places is how the two
 * end up disagreeing.
 *
 * `Overview` used to be hidden on the same reasoning — it overlaps the About.
 * That was wrong. The About is public prose; the Overview is the identity
 * statement the whole document is built on, and hiding it meant the artist could
 * not correct the single most load-bearing sentence about them. Pete: "nowhere
 * do we say who you are in the knowledge base."
 *
 * `whole` keeps a section's paragraph intact instead of splitting it into
 * sentences. Who someone IS is one claim — offering three separate corrections
 * for "producer, creative director and web3 consultant / born in Bogota / moved
 * at 11" invites fixing a third of a sentence.
 */
const SECTIONS: Record<string, { label: string; whole?: boolean }> = {
    "Overview": { label: "Who you are", whole: true },
    "Career Highlights": { label: "What you've done" },
    "Story hooks": { label: "Things worth telling" },
    "Sound & Influences": { label: "Your sound" },
    "Discography Highlights": { label: "Your releases" },
    "Industry Connections": { label: "Who you've worked with" },
    "Recent Activity": { label: "Lately" },
    "Who They Are": { label: "What drives you" },
    "In Their Own Words": { label: "Things you've said" },
    "Audience & Fanbase": { label: "Your audience" },
};

/** How much claim text identifies a correction.
 *
 *  A correction is keyed by the claim's TEXT, so both sides must agree on the
 *  same string or the key silently stops matching. The server used to truncate
 *  to this while the client compared against the untruncated display text —
 *  fine for every sentence-split section, and broken for the `whole` Overview,
 *  which keeps a paragraph as one claim. An over-long Overview correction would
 *  save, never render as applied, and invite the artist to submit it again
 *  forever. Caught in review of #1176.
 *
 *  Also keeps the value clear of Postgres's btree entry limit on the unique
 *  index over (artist_id, claim). */
export const MAX_CLAIM_CHARS = 1000;

/** The exact string a correction is stored and looked up by. Use on BOTH sides
 *  of the wire; never compare raw claim text. */
export function claimKey(text: string): string {
    return text.trim().slice(0, MAX_CLAIM_CHARS);
}

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

type Pending = DocSection & { whole: boolean; buffer: string[] };

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
    let current: Pending | null = null;

    const push = (section: Pending, piece: string) => {
        const text = stripMarkers(piece);
        // A fragment that is only a citation, or a stub, is not something a
        // person can judge — dropping it beats rendering an empty row.
        if (text.length < 12) return;
        section.claims.push({
            key: `${section.header}:${section.claims.length}`,
            text,
            sourceIds: citedIds(piece),
        });
    };

    const flush = () => {
        if (current) {
            // A `whole` section held its lines back so it becomes one claim.
            if (current.whole && current.buffer.length > 0) push(current, current.buffer.join(" "));
            if (current.claims.length > 0) sections.push({ header: current.header, label: current.label, claims: current.claims });
        }
        current = null;
    };

    for (const rawLine of doc.split("\n")) {
        const line = rawLine.trim();

        const heading = line.match(/^##\s+(.+?)\s*$/);
        if (heading) {
            flush();
            const header = heading[1];
            const conf = SECTIONS[header];
            current = conf ? { header, label: conf.label, claims: [], whole: !!conf.whole, buffer: [] } : null;
            continue;
        }
        // The `# NAME - Artist Knowledge Document` title and anything before the
        // first known section.
        if (!current || !line || line.startsWith("#")) continue;

        if (current.whole) { current.buffer.push(line.replace(/^[-*]\s+/, "")); continue; }

        const pieces = line.startsWith("- ") || line.startsWith("* ")
            ? [line.slice(2).trim()]
            : splitSentences(line);
        for (const piece of pieces) push(current, piece);
    }
    flush();
    return sections;
}

/** Total claims across all sections — for the section header's count. */
export function countClaims(sections: DocSection[]): number {
    return sections.reduce((n, s) => n + s.claims.length, 0);
}
