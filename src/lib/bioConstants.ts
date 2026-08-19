/** Max characters allowed in an artist bio (Save and Save-to-vault both enforce this). */
export const MAX_BIO_LENGTH = 10_000;

/** Hard cap on a synthesized artist doc's stored size. */
export const ARTIST_DOC_MAX_CHARS = 20_000;

/**
 * The length rule for a public About, wherever it gets written. The automatic
 * generator (artistBioQuery) and the onboarding flow (artistDocService) both write
 * to artists.bio and render in the same place on the page, so they must not disagree
 * about how long an About is. Onboarding used to ask for "2-4 short paragraphs,
 * roughly 600-1,200 characters" — a two-paragraph FLOOR, which read as padded next
 * to a generated bio. Kept as two constants because artistBioQuery places the second
 * sentence as a Structure bullet rather than beside the first.
 */
export const ABOUT_TARGET_WORDS = 100;

export const ABOUT_LENGTH_RULE =
  `Write ONE paragraph, up to ~${ABOUT_TARGET_WORDS} words. Shorter is better than padded: if verified facts are thin, write two or three honest sentences.`;

/** Anti-padding companion to ABOUT_LENGTH_RULE. */
export const ABOUT_STOP_RULE =
  'Stop when the facts run out. No closing "significance" flourish.';

/** Cap on the artist-doc slice injected into prompts (askArtist / funFacts / bio). */
export const ARTIST_DOC_CONTEXT_CAP = 8_000;

/**
 * The "About" empty-state / claim-nudge. Shown (and cached into artists.bio) when we
 * have no verified context to synthesize a real About from — never a hollow catalog
 * list. Kept as a single constant so the bio route, the generator, the Ask-About chat,
 * and the MCP transformer all agree on the exact text and can detect + exclude it
 * (e.g. so the nudge is never fed back in as an "existing bio").
 */
export const ABOUT_EMPTY_STATE =
  "We don't have enough verified information about this artist yet. If this is you, claim your profile and add a few sources to generate your About — or write your own. What you add helps Music Nerd tell your story to fans.";

/** True when `bio` IS the claim-nudge empty-state (trimmed, tolerant of stray whitespace). */
export function isAboutEmptyState(bio: string | null | undefined): boolean {
  return bio?.trim() === ABOUT_EMPTY_STATE;
}

/**
 * True when `bio` is a real, synthesized About — non-empty and not the claim-nudge
 * empty-state. Use this everywhere the nudge must not be treated as a bio (fed back
 * into the chat/MCP as context, or clobbered/overwritten as if it were real content).
 */
export function isRealBio(bio: string | null | undefined): boolean {
  return !!bio && bio.trim().length > 0 && !isAboutEmptyState(bio);
}
