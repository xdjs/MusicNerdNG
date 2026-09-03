/**
 * The artist's knowledge document, public, for machines.
 *
 * WHY THIS EXISTS. The document is the best thing we have — prose assembled
 * from the artist's own posts, their interview answers and vetted sources, with
 * every claim carrying a citation. Until now the only ways to reach it were the
 * owner's export (401 to everyone else) and `/api/askArtist`, which answers
 * questions about it but never hands it over. So a model could be told what we
 * know only by asking one question at a time, and could not cite us.
 *
 * NOT A NEW DISCLOSURE. `askArtist` is already public and already grounded in
 * this document; what it says in paraphrase, this says verbatim and with the
 * sources attached. Publishing it makes the citation trail visible, which is
 * the opposite of leaking — a reader can now check us.
 *
 * WHAT IS DELIBERATELY NOT HERE. The owner's export at
 * /api/artist/<id>/knowledge-doc/export stays gated and keeps `?format=csv`.
 * That door is "take your profile with you" and is the artist's alone. This one
 * is "here is what Music Nerd knows about this artist, and where each part came
 * from". Same text, different promise.
 *
 * SERVED INLINE, NOT AS A DOWNLOAD. A Content-Disposition attachment makes a
 * crawler save a file instead of reading a page.
 */
import { getArtistDoc } from "@/server/utils/queries/onboardingQueries";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { renderKnowledgeMarkdown, type DocSource } from "@/server/utils/knowledgeDocMarkdown";

export const dynamic = "force-dynamic";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
    const { id } = await params;
    try {
        const [artist, doc] = await Promise.all([getArtistById(id), getArtistDoc(id)]);

        // 404, NOT AN EMPTY FILE. An artist with no document yet is not the
        // same as an artist we know nothing about, and a crawler that caches a
        // blank page will not come back for the real one.
        if (!artist) {
            return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        if (!doc?.content) {
            return new Response(
                `# ${artist.name ?? "Unknown Artist"}\n\nNo knowledge document has been compiled for this artist yet.\n`,
                { status: 404, headers: { "Content-Type": "text/markdown; charset=utf-8" } },
            );
        }

        const sources = (doc.sources ?? []) as DocSource[];
        const updated = doc.updatedAt ? String(doc.updatedAt).slice(0, 10) : null;

        const body = renderKnowledgeMarkdown({
            name: artist.name ?? "Unknown Artist",
            content: doc.content,
            sources,
            header: `> Compiled by Music Nerd from ${sources.length} source${sources.length === 1 ? "" : "s"}`
                + `${updated ? `, last updated ${updated}` : ""}.`,
        });

        return new Response(body, {
            headers: {
                "Content-Type": "text/markdown; charset=utf-8",
                // A document changes when a source is approved or the artist
                // answers something — minutes at the fastest, never per-request.
                // Serving a slightly stale copy instantly beats rebuilding it
                // for every crawler that asks.
                "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
                "X-Robots-Tag": "index, follow",
            },
        });
    } catch (e) {
        console.error("[artist/llms.txt] Error:", e);
        return new Response("Temporarily unavailable\n", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
    }
}
