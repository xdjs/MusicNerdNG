// @ts-nocheck
import { extractPublishedDate } from "@/server/utils/fetchPageContent";
import { sourceAgeLabel } from "@/server/utils/artistDocService";

const NOW = new Date("2026-08-22T00:00:00Z");

describe("extractPublishedDate", () => {
    it("reads article:published_time", () => {
        expect(
            extractPublishedDate('<meta property="article:published_time" content="2019-01-10T14:00:00+00:00">', NOW)
        ).toBe("2019-01-10");
    });

    it("reads the attributes in either order", () => {
        expect(
            extractPublishedDate('<meta content="2024-01-24" name="date">', NOW)
        ).toBe("2024-01-24");
    });

    it("reads datePublished out of JSON-LD, which is often the only place it appears", () => {
        const html = `<script type="application/ld+json">
            {"@type":"NewsArticle","headline":"Meet Pete Rango","datePublished":"2019-01-10T09:30:00Z"}
        </script>`;
        expect(extractPublishedDate(html, NOW)).toBe("2019-01-10");
    });

    it("prefers a real meta date over a <time> tag elsewhere on the page", () => {
        // <time> marks any date on the page, including a comment's or a sidebar
        // article's — it is the last resort, not the first.
        const html = '<meta property="article:published_time" content="2019-01-10"><time datetime="2026-08-01">today</time>';
        expect(extractPublishedDate(html, NOW)).toBe("2019-01-10");
    });

    it("falls back to <time datetime> when nothing better exists", () => {
        expect(extractPublishedDate('<time datetime="2022-06-05">June</time>', NOW)).toBe("2022-06-05");
    });

    it("returns null rather than a guess when the page says nothing", () => {
        // A wrong date is worse than none: it would let the doc confidently scope
        // a claim to the wrong era. Directory pages legitimately have no date.
        expect(extractPublishedDate("<html><body><p>Filters. Genre. EDM.</p></body></html>", NOW)).toBeNull();
    });

    it("rejects a future date as a template placeholder, not a publication date", () => {
        expect(extractPublishedDate('<meta name="date" content="2099-01-01">', NOW)).toBeNull();
    });

    it("rejects a pre-web year and unparseable junk", () => {
        expect(extractPublishedDate('<meta name="date" content="1900-01-01">', NOW)).toBeNull();
        expect(extractPublishedDate('<meta name="date" content="not a date">', NOW)).toBeNull();
    });

    it("skips an unparseable candidate and takes the next real one", () => {
        const html = '<meta property="article:published_time" content="{{date}}"><meta name="date" content="2021-03-04">';
        expect(extractPublishedDate(html, NOW)).toBe("2021-03-04");
    });
});

describe("sourceAgeLabel", () => {
    it("says how old a source is, so 'is' can become 'was'", () => {
        // The real case: "Parris Pierce is my production partner" came from a
        // VoyageMIA interview published 2019-01-10 and was written as current.
        expect(sourceAgeLabel("2019-01-10", NOW)).toBe("published 2019-01-10, 8 years ago");
    });

    it("marks a recent source as recent", () => {
        expect(sourceAgeLabel("2026-05-01", NOW)).toBe("published 2026-05-01, within the last year");
    });

    it("uses the singular for one year", () => {
        expect(sourceAgeLabel("2025-04-01", NOW)).toBe("published 2025-04-01, 1 year ago");
    });

    it("says the date is unknown rather than leaving it unmarked", () => {
        // "We know this is old" and "we do not know how old this is" call for
        // different hedging; conflating them is how a guess becomes a fact.
        expect(sourceAgeLabel(null, NOW)).toBe("date unknown");
        expect(sourceAgeLabel(undefined, NOW)).toBe("date unknown");
        expect(sourceAgeLabel("garbage", NOW)).toBe("date unknown");
    });
});
