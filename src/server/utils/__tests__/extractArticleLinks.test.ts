// @ts-nocheck
import { extractArticleLinks } from "@/server/utils/fetchPageContent";

const BASE = "https://rvamag.com/tags/pete-rango-kevin-carroll";

describe("extractArticleLinks", () => {
    it("finds the article an index page points at", () => {
        // Pete: "rvamag was a good article, it's just that it was presenting an
        // index and the article as separate links." The tag page leads to a 2026
        // piece naming him as a documentary's co-director — the most current
        // coverage of him anywhere, and it was lost both by storing the index
        // and by discarding it.
        const html = `<a href="/community/big-scouse-how-a-liverpool-native.html">Big Scouse</a>`;
        expect(extractArticleLinks(html, BASE)).toEqual([
            "https://rvamag.com/community/big-scouse-how-a-liverpool-native.html",
        ]);
    });

    it("skips other listings rather than walking the whole site", () => {
        const html = `
            <a href="/tags/something-else">Tag</a>
            <a href="/category/music">Category</a>
            <a href="/author/r-anthony-harris">Author</a>
            <a href="/page/2">Next page</a>
            <a href="/feed">RSS</a>
            <a href="/community/a-real-piece.html">Real piece</a>`;
        expect(extractArticleLinks(html, BASE)).toEqual(["https://rvamag.com/community/a-real-piece.html"]);
    });

    it("never leaves the host", () => {
        // An index's off-site links are ads, social buttons and syndication;
        // following those turns one page into the open web.
        const html = `
            <a href="https://facebook.com/rvamag">Facebook</a>
            <a href="https://rvamag.com/community/piece.html">Piece</a>`;
        expect(extractArticleLinks(html, BASE)).toEqual(["https://rvamag.com/community/piece.html"]);
    });

    it("does not return the index page itself", () => {
        const html = `<a href="/tags/pete-rango-kevin-carroll">This page</a><a href="/community/x.html">X</a>`;
        expect(extractArticleLinks(html, BASE)).not.toContain(BASE);
    });

    it("ignores mailto, tel, javascript and fragments", () => {
        const html = `
            <a href="mailto:a@b.com">Mail</a><a href="tel:+1">Call</a>
            <a href="javascript:void(0)">JS</a><a href="#top">Top</a>`;
        expect(extractArticleLinks(html, BASE)).toEqual([]);
    });

    it("dedupes and respects the cap", () => {
        const html = Array.from({ length: 40 }, (_, i) => `<a href="/community/p${i}.html">P</a>`).join("")
            + `<a href="/community/p0.html">dup</a>`;
        const out = extractArticleLinks(html, BASE, 5);
        expect(out).toHaveLength(5);
        expect(new Set(out).size).toBe(5);
    });

    it("returns nothing for a malformed base rather than throwing", () => {
        expect(extractArticleLinks('<a href="/x/y.html">x</a>', "not a url")).toEqual([]);
    });
});
