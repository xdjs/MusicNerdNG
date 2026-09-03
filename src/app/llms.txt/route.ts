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
export const dynamic = "force-static";
export const revalidate = 86_400;

const BASE = "https://www.musicnerd.xyz";

export function GET(): Response {
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

${BASE}/sitemap/0.xml
${BASE}/sitemap/1.xml
${BASE}/sitemap/2.xml

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
