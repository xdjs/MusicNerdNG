/**
 * Strip link artifacts out of an artist bio.
 *
 * Bios are prose — the prompt in `generateArtistBio` explicitly says "No social links
 * in the bio text" — but models still emit inline citations, and rows written by the
 * pre-Gemini (OpenAI web-search) generator are full of them:
 *   "...listed on Apple Music. ([music.apple.com](https://music.apple.com/...?utm_source=openai))"
 * `BlurbSection` only renders bold/italic, so those citations show up as raw markdown.
 *
 * Applied both when a bio is generated and when one is read, so stored legacy rows
 * render clean without a backfill.
 */
export function sanitizeBioText(text: string | null | undefined): string {
  if (!text) return "";

  return (
    text
      // Parenthesized citations — "( [label](url) )" — drop the whole group.
      .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
      // Inline markdown links carrying real sentence content — keep just the label.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Bare URLs left in the prose. The final char class excludes trailing
      // sentence punctuation so "Visit https://example.com. Next" keeps its period.
      .replace(/https?:\/\/[^\s)\]]*[^\s)\].,;:!?]/g, "")
      // Parens/brackets emptied out by the removals above.
      .replace(/\(\s*\)/g, "")
      .replace(/\[\s*\]/g, "")
      // Whitespace left behind: collapse runs, pull punctuation back onto the word.
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([.,;:!?])/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
