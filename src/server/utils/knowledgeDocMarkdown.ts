/**
 * The knowledge document as one self-contained markdown file.
 *
 * ONE FILE, CITATIONS RESOLVED. The document body is full of [n] markers, so a
 * doc and a separate source list are a document with dangling references and a
 * spreadsheet with no context. Numbered at the end of the same file, every
 * citation means something wherever it is read — pasted into a chat window, or
 * fetched by a crawler that will never see the page it came from.
 *
 * Shared by two callers with different doors:
 *   - the owner's export, which is a download and says "take your profile"
 *   - the public /artist/<id>/llms.txt, which is a page and says "here is what
 *     we know and where each part came from"
 * The text is identical on purpose. Two renderers would drift, and the whole
 * value of the thing is that a citation resolves to the same source either way.
 */

// REUSED, NOT REDECLARED. artistDocService already exports this with
// `kind: "vault" | "interview" | "social"` and a required `label`. A local
// copy that widened both would let a caller pass an invalid kind or omit the
// label, and the two would drift with nothing to catch it.
export type { DocSource } from "@/server/utils/artistDocService";
import type { DocSource } from "@/server/utils/artistDocService";

export function renderKnowledgeMarkdown(input: {
    name: string;
    content: string;
    sources: DocSource[];
    /** What the reader is holding. The owner's copy is dated because it is a
     *  snapshot they took; the public one is dated because a crawler needs to
     *  know how stale it is. */
    header: string;
}): string {
    const lines: string[] = [
        `# ${input.name}`,
        "",
        input.header,
        `> Bracketed numbers in the text refer to the numbered sources at the end.`,
        "",
        input.content.trim(),
        "",
        "## Sources",
        "",
    ];
    for (const s of input.sources) {
        const label = s.label ?? s.url ?? "(untitled)";
        const when = s.publishedAt ? ` (${s.publishedAt.slice(0, 10)})` : "";
        lines.push(s.url ? `${s.id}. ${label}${when} — ${s.url}` : `${s.id}. ${label}${when}`);
    }
    return lines.join("\n");
}
