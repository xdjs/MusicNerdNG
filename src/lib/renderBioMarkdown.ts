/**
 * Convert the limited markdown a bio may contain (**bold**, *italic*) to HTML,
 * escaping all other HTML first so bio text can never inject live markup.
 * Bios are AI-generated or artist-edited and rendered via dangerouslySetInnerHTML,
 * so escaping before formatting is what makes that render safe.
 */
export function renderBioMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}
