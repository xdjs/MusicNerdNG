/**
 * Take your profile with you.
 *
 * The stated purpose is portability to another LLM, and that decides the shape:
 * ONE self-contained markdown file. The document is full of [n] markers, so a
 * doc and a separate source list are a document with dangling references and a
 * spreadsheet with no context. Resolved inside a single file, every citation
 * means something wherever it is pasted.
 *
 * A short header says what the file is. Pasted cold into a chat window an
 * undated document reads as unsourced prose, and being sourced is precisely
 * what is being carried.
 *
 * `?format=csv` returns the sources as a table instead, which is a different
 * job — checking coverage, spotting that a profile rests on four aggregator
 * listings and one interview. Not the default, because no LLM wants a
 * spreadsheet of source metadata.
 *
 * Gated to people who can already read the document. The knowledge document
 * contains whatever the artist said about themselves, including things they
 * may not want portable; the export must never be a wider door than the page.
 */
import { getArtistDoc } from "@/server/utils/queries/onboardingQueries";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import { getServerAuthSession } from "@/server/auth";

export const dynamic = "force-dynamic";

type DocSource = { id: number; kind: string; label?: string; url?: string | null; publishedAt?: string | null };

/** RFC 4180: quote everything, double internal quotes. Titles contain commas
 *  and quotation marks constantly. */
function csvCell(value: unknown): string {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "artist";
}

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
    const { id } = await params;
    try {
        // The same gate the document itself uses. An artist's own words are
        // theirs to take; nobody else's to download.
        const session = await getServerAuthSession();
        const userId = session?.user?.id;
        if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
        if (!(await canEditArtist(userId, id))) {
            return Response.json({ error: "Not your artist" }, { status: 403 });
        }

        const [artist, doc] = await Promise.all([getArtistById(id), getArtistDoc(id)]);
        if (!artist || !doc?.content) {
            return Response.json({ error: "No knowledge document yet" }, { status: 404 });
        }

        const name = artist.name ?? "Unknown Artist";
        const sources = (doc.sources ?? []) as DocSource[];
        const url = new URL(req.url);
        const stamp = new Date().toISOString().slice(0, 10);

        if (url.searchParams.get("format") === "csv") {
            const header = ["id", "kind", "label", "url", "published"].join(",");
            const rows = sources.map(s =>
                [s.id, s.kind, s.label ?? "", s.url ?? "", s.publishedAt ?? ""].map(csvCell).join(","));
            return new Response([header, ...rows].join("\n"), {
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename="${slug(name)}-sources-${stamp}.csv"`,
                },
            });
        }

        // Sources resolved at the end, numbered to match the [n] markers in the
        // body. An LLM follows that without being told; a human can click it.
        const lines: string[] = [
            `# ${name}`,
            "",
            `> Verified profile compiled by Music Nerd from ${sources.length} source${sources.length === 1 ? "" : "s"}, exported ${stamp}.`,
            `> Bracketed numbers in the text refer to the numbered sources at the end.`,
            "",
            doc.content.trim(),
            "",
            "## Sources",
            "",
        ];
        for (const s of sources) {
            const label = s.label ?? s.url ?? "(untitled)";
            const when = s.publishedAt ? ` (${s.publishedAt.slice(0, 10)})` : "";
            lines.push(s.url ? `${s.id}. ${label}${when} — ${s.url}` : `${s.id}. ${label}${when}`);
        }

        return new Response(lines.join("\n"), {
            headers: {
                "Content-Type": "text/markdown; charset=utf-8",
                "Content-Disposition": `attachment; filename="${slug(name)}-${stamp}.md"`,
            },
        });
    } catch (e) {
        console.error("[knowledge-doc/export] Error:", e);
        return Response.json({ error: "Export failed" }, { status: 500 });
    }
}
