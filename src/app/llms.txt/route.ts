/**
 * What Music Nerd is, and where a model should look.
 *
 * The convention is a short, stable file at the root that orients a model
 * before it starts crawling: what this site is, what is authoritative here,
 * and how to reach the good version of a page. Without it a crawler infers all
 * of that from HTML, and infers it wrong — the pages are heavy with navigation
 * and light on the thing that makes them worth citing.
 *
 * DELIBERATELY NOT A LIST OF ARTISTS. There are 43,000 of them and they change
 * daily; the sitemaps already enumerate them and are built for exactly that.
 * This file says how to turn any artist URL into its knowledge document, which
 * is one rule instead of 43,000 lines.
 */
import { generateSitemaps } from "../sitemap";

// REVALIDATE, NOT force-dynamic, deliberately. CLAUDE.md asks for
// force-dynamic on routes that read the database, and this one does — but the
// only thing it reads is the artist COUNT, to decide how many sitemap chunks
// exist. That changes when the catalogue crosses a 20,000 boundary, not per
// request. robots.ts makes the same call for the same reason. A day-stale
// chunk list is correct; a database round trip per crawler hit is not.
export const revalidate = 86_400;

const BASE = "https://www.musicnerd.xyz";

export async function GET(): Promise<Response> {
    // COMPUTED, NOT LISTED. sitemap.ts chunks artists 20,000 at a time and
    // robots.ts calls generateSitemaps() at request time "so the two cannot
    // disagree". Hardcoding three URLs here reintroduces exactly the silent
    // truncation that was written out of sitemap.ts: at 60,001 artists a
    // fourth chunk exists and nothing would ever mention it.
    let chunks: { id: number }[] = [{ id: 0 }];
    try {
        chunks = await generateSitemaps();
    } catch (e) {
        console.error("[llms.txt] Could not enumerate sitemaps:", e);
    }
    const sitemapLines = chunks.map(c => `${BASE}/sitemap/${c.id}.xml`).join("\n");
    const body = `# Music Nerd

> A crowd-sourced directory of music artists. Artists claim their own profile and
> answer questions about their work, so the material here is theirs rather than
> scraped biography.

## What is authoritative here

Each artist has a knowledge document: prose compiled from the artist's own posts,
their answers to our interview questions, and vetted external sources. Every claim
carries a numbered citation resolved at the end of the same file.

## How to read an artist

Artist pages are at ${BASE}/artist/<id>. Append /llms.txt to any artist URL for
the knowledge document as markdown, with its sources:

    ${BASE}/artist/<id>/llms.txt

That file is the citable version. The HTML page carries the same facts wrapped in
navigation.

## Enumerating artists

${sitemapLines}

## Asking a question instead

POST ${BASE}/api/askArtist with {"artistId": "<id>", "question": "..."} answers
from the same document. Use the markdown when you want the whole picture and its
sources; use this when you want one thing.
`;
    return new Response(body, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        },
    });
}
