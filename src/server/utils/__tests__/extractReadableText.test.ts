// @ts-nocheck
import { extractReadableText } from "@/server/utils/fetchPageContent";
import { selectSourceText } from "@/server/utils/artistDocService";

describe("extractReadableText", () => {
    it("keeps blank lines between blocks, so paragraph selection can run at all", () => {
        // The whole reason this function exists. The previous extractor ended in
        // `.replace(/\s+/g, " ")`, which flattened every page to ONE line — and
        // selectSourceText splits on blank lines, so it saw a single paragraph,
        // bailed, and head-sliced. Its unit tests passed because they fed it
        // text that still had newlines. Nothing scraped ever did.
        const text = extractReadableText(
            "<p>First paragraph about the artist.</p><p>Second paragraph.</p>"
        );
        expect(text.split(/\n{2,}/).length).toBeGreaterThan(1);
        expect(text).toContain("First paragraph about the artist.");
        expect(text).toContain("Second paragraph.");
    });

    it("drops a cookie-consent policy", () => {
        // Everything past character 4,700 of a real stored source
        // (lifechangesnetwork) was this: Google Analytics cookie durations,
        // stored as an artist's press coverage.
        const text = extractReadableText(`
            <article><p>Pete Rango produced the record in Miami.</p></article>
            <form id="cookie-prefs">
              <p>Manage your cookie preferences below:</p>
              <p>_ga ID used to identify users 2 years</p>
              <button>Accept All</button>
            </form>`);
        expect(text).toContain("Pete Rango produced the record in Miami.");
        expect(text).not.toMatch(/cookie preferences/i);
        expect(text).not.toContain("_ga ID used to identify users");
    });

    it("drops nav, footer, aside and comment forms", () => {
        const text = extractReadableText(`
            <nav><a href="/">Home</a><a href="/about">About</a></nav>
            <article><p>The interview itself.</p></article>
            <aside><h3>Related Items</h3><p>Meet Chelsea Jay</p></aside>
            <form><label>Comment *</label><label>Email *</label></form>
            <footer><p>Terms Privacy Contact Us</p></footer>`);
        expect(text).toContain("The interview itself.");
        expect(text).not.toContain("Meet Chelsea Jay");
        expect(text).not.toContain("Terms Privacy Contact Us");
        expect(text).not.toContain("Comment *");
    });

    it("decodes entities instead of storing them raw", () => {
        // Stored sources were full of `people&#8217;s souls` and `&quot;`, which
        // is what the model then read.
        const text = extractReadableText("<p>to touch people&#8217;s souls, he &quot;said&quot;&nbsp;once</p>");
        expect(text).toContain("to touch people’s souls");
        expect(text).toContain('"said"');
        expect(text).not.toContain("&#8217;");
    });

    it("keeps a substantial article a site wrapped in chrome, rather than storing nothing", () => {
        // Safety net: some sites put the body inside <aside> or <form>. Furniture
        // beats an empty source — but only for a real page we clearly gutted.
        const body = `<aside><p>${"Real article text about the artist. ".repeat(40)}</p></aside>`;
        expect(extractReadableText(body)).toContain("Real article text about the artist.");
    });

    it("leaves a short page stripped rather than putting its nav back", () => {
        // The rescue above must not fire just because a page is small; that would
        // reintroduce the chrome on every brief article.
        const text = extractReadableText("<nav>Home About Contact</nav><p>A brief note about the record.</p>");
        expect(text).toBe("A brief note about the record.");
    });

    it("does not cut a sentence at an inline tag", () => {
        const text = extractReadableText("<p>He worked with <a href='#'>Cherele</a> on the track.</p>");
        expect(text).toContain("He worked with Cherele on the track.");
    });

    it("produces text selectSourceText can actually filter", () => {
        // The two halves together: extraction emits paragraphs, selection keeps
        // the ones naming the artist. Neither works without the other.
        const junk = "<p>" + "Unrelated marketplace boilerplate about nobody. ".repeat(140) + "</p>";
        const hit = "<p>Pete Rango placed a song on HBO's Insecure.</p>";
        const selected = selectSourceText(extractReadableText(junk + hit + junk), "Pete Rango");
        expect(selected).toContain("Pete Rango placed a song on HBO's Insecure.");
    });
});
