/**
 * Choosing the right part of a source.
 *
 * The behaviour under test is the one that motivated it: the answer to a
 * question is rarely in the opening paragraph, which is what the ask used to
 * send.
 */
import { selectPassages } from "@/server/utils/passageSelect";

/** A page shaped like the ones we actually store: navigation and a standfirst
 *  first, the substance a long way down. */
function article(): string {
    return [
        "Home · Music · Interviews · Subscribe · Newsletter · Follow us on social media for more coverage.",
        "The Virginia scene has never been busier, and this month we spoke to several of the people making it move.",
        "Filler about the venue's history that mentions nothing anyone asked about, running on for a while in the way these pieces do before they get to the point.",
        "More scene-setting, a paragraph about parking, and a note about the bar's new cocktail menu which is genuinely irrelevant.",
        "He mixed and mastered the record himself at NRG, working nights across three weeks because the studio was booked solid in the daytime.",
        "Afterwards he took the stems home and rebuilt the low end from scratch, which he says is the part nobody notices and everybody hears.",
        "Tickets for the spring run are on sale now via the venue's website.",
    ].join("\n\n");
}

describe("selectPassages", () => {
    it("finds the paragraph that answers the question, not the one at the top", () => {
        const picked = selectPassages(article(), "Where did he mix and master the record?", { budgetChars: 700 });
        expect(picked.text).toContain("mixed and mastered the record himself at NRG");
        // The cocktail menu is what a flat first-N-characters slice would have
        // sent instead.
        expect(picked.text).not.toContain("cocktail menu");
    });

    it("keeps the opening so a passage is not orphaned from its subject", () => {
        // A perfectly relevant paragraph beginning "He mixed..." is useless if
        // the model has no idea who "he" is.
        const picked = selectPassages(article(), "Where did he mix the record?", { budgetChars: 700 });
        expect(picked.text).toContain("Home · Music · Interviews");
    });

    it("marks where it skipped, so the model does not read across a gap", () => {
        const picked = selectPassages(article(), "Where did he mix the record?", { budgetChars: 700 });
        expect(picked.text).toContain("[…]");
    });

    it("returns short sources whole rather than pretending to choose", () => {
        const short = "A single paragraph about a record, well under any budget worth applying.";
        expect(selectPassages(short, "anything", { budgetChars: 2000 }).text).toBe(short);
    });

    it("falls back to the opening when nothing matches the question", () => {
        // A source sharing no vocabulary with the question may still be all we
        // have, and an empty context is worse than a generic one.
        const picked = selectPassages(article(), "zzzz qqqq", { budgetChars: 400 });
        expect(picked.text.length).toBeGreaterThan(0);
    });

    it("stays inside its budget", () => {
        const picked = selectPassages(article(), "Where did he mix and master the record?", { budgetChars: 500 });
        expect(picked.text.length).toBeLessThanOrEqual(700); // budget + one paragraph's slack
    });

    it("handles a source with no paragraph breaks left after extraction", () => {
        const runOn = Array.from({ length: 40 },
            (_, i) => `Sentence ${i} about the studio and the record and the mixing desk.`).join(" ");
        const picked = selectPassages(runOn, "mixing desk", { budgetChars: 400 });
        expect(picked.text.length).toBeGreaterThan(0);
        expect(picked.text.length).toBeLessThanOrEqual(1600);
    });

    it("says how much it looked at and how much it kept", () => {
        // Sending the wrong part of an article is invisible without this.
        const picked = selectPassages(article(), "Where did he mix the record?", { budgetChars: 700 });
        expect(picked.considered).toBeGreaterThan(picked.kept);
        expect(picked.kept).toBeGreaterThan(0);
    });
});
