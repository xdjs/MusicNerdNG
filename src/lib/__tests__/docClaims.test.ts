// @ts-nocheck
import { parseDocClaims, countClaims } from "@/lib/docClaims";

const DOC = `# PETE RANGO - Artist Knowledge Document

## Overview
Pete Rango is a music producer[4]. He founded XUE RECORDS[4].

## Career Highlights
- Won the i-Standard's Music Producers competition with Parris Pierce[3].
- Placed "Vi$ions" on HBO's *Insecure*[3][4].

## Online Presence
Instagram handle @p3t3rango[instagram].

## In Their Own Words
- On releasing art: "Make a plan, release your art, and don't hoard it forever. Your art will never be perfect."[3]
`;

describe("parseDocClaims", () => {
    it("drops Online Presence, which is the artist's Links section", () => {
        // Editing one fact in two places is how the two end up disagreeing.
        const headers = parseDocClaims(DOC).map(s => s.header);
        expect(headers).not.toContain("Online Presence");
        expect(headers).toContain("Career Highlights");
    });

    it("SHOWS the Overview, as one claim, under a heading that says who you are", () => {
        // Overview was hidden on the grounds that it overlaps the About. Wrong:
        // the About is public prose, the Overview is the identity statement the
        // rest of the document rests on, and hiding it meant the artist could
        // not correct the single most load-bearing sentence about them. Pete:
        // "nowhere do we say who you are in the knowledge base."
        //
        // One claim, not three: offering separate corrections for "producer" /
        // "born in Bogota" / "moved at 11" invites fixing a third of a sentence.
        const section = parseDocClaims(DOC).find(s => s.header === "Overview");
        expect(section.label).toBe("Who you are");
        expect(section.claims).toHaveLength(1);
        expect(section.claims[0].text).toContain("Pete Rango is a music producer");
        expect(section.claims[0].text).toContain("He founded XUE RECORDS");
        expect(section.claims[0].sourceIds).toEqual([4]);
    });

    it("gives every section a human label instead of the internal header", () => {
        // A leaking "## Industry Connections" is exactly the markdown-file look
        // this exists to avoid.
        const s = parseDocClaims(DOC).find(x => x.header === "Career Highlights");
        expect(s.label).toBe("What you've done");
    });

    it("makes one claim per bullet and strips the citation markers from the text", () => {
        const s = parseDocClaims(DOC).find(x => x.header === "Career Highlights");
        expect(s.claims).toHaveLength(2);
        expect(s.claims[0].text).toBe("Won the i-Standard's Music Producers competition with Parris Pierce.");
        expect(s.claims[0].text).not.toMatch(/\[\d+\]/);
    });

    it("keeps the source ids so a claim can show where it came from", () => {
        const s = parseDocClaims(DOC).find(x => x.header === "Career Highlights");
        expect(s.claims[0].sourceIds).toEqual([3]);
        expect(s.claims[1].sourceIds).toEqual([3, 4]);
    });

    it("never splits a quotation into fragments at its own full stops", () => {
        // The doc quotes artists verbatim and those quotes contain full stops.
        // Splitting them turns one thing the artist said into three pieces they
        // cannot recognise, let alone correct.
        const s = parseDocClaims(DOC).find(x => x.header === "In Their Own Words");
        expect(s.claims).toHaveLength(1);
        expect(s.claims[0].text).toContain("Make a plan, release your art, and don't hoard it forever.");
        expect(s.claims[0].text).toContain("Your art will never be perfect.");
    });

    it("splits a paragraph section into one claim per sentence", () => {
        const doc = `## Who They Are\nHe describes his interest as human psychology[3]. He wanted to study child development[3].`;
        const s = parseDocClaims(doc)[0];
        expect(s.claims).toHaveLength(2);
        expect(s.claims[0].text).toBe("He describes his interest as human psychology.");
    });

    it("does not split on a full stop mid-name", () => {
        const doc = `## Who They Are\nHe founded the non-profit L.I.V. (Life Is Valuable) in Miami[4].`;
        expect(parseDocClaims(doc)[0].claims).toHaveLength(1);
    });

    it("drops a fragment too short for a person to judge", () => {
        const doc = `## Career Highlights\n- [3]\n- Won a real competition in Miami with a partner[3].`;
        expect(parseDocClaims(doc)[0].claims).toHaveLength(1);
    });

    it("omits a section with no claims rather than rendering an empty heading", () => {
        expect(parseDocClaims(`## Career Highlights\n\n## Lately`)).toEqual([]);
    });

    it("returns nothing for an empty or missing doc instead of throwing", () => {
        expect(parseDocClaims("")).toEqual([]);
        expect(parseDocClaims(undefined)).toEqual([]);
    });

    it("strips the markdown emphasis the document uses for titles", () => {
        // "*Bartholomew WAVE I*" is how a file writes an album name. A person
        // reading their own profile should not be shown the asterisks.
        const doc = `## Career Highlights\n- Landed a song on the EP *Bartholomew WAVE I* with **Abjo**[3].`;
        const text = parseDocClaims(doc)[0].claims[0].text;
        expect(text).toBe("Landed a song on the EP Bartholomew WAVE I with Abjo.");
    });

    it("counts claims across sections", () => {
        expect(countClaims(parseDocClaims(DOC))).toBe(4); // + the Overview, as one
    });
});
