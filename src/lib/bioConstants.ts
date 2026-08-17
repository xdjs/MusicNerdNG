/** Max characters allowed in an artist bio (Save and Save-to-vault both enforce this). */
export const MAX_BIO_LENGTH = 10_000;

/**
 * The "About" empty-state / claim-nudge. Shown (and cached into artists.bio) when we
 * have no verified context to synthesize a real About from — never a hollow catalog
 * list. Kept as a single constant so the bio route, the generator, the Ask-About chat,
 * and the MCP transformer all agree on the exact text and can detect + exclude it
 * (e.g. so the nudge is never fed back in as an "existing bio").
 */
export const ABOUT_EMPTY_STATE =
  "We couldn't find enough verified information about this artist yet — and Music Nerd won't guess. If this is you, claim your profile and add a few sources, and your About will fill in within seconds.";

/**
 * True when `bio` is a real, synthesized About — non-empty and not the claim-nudge
 * empty-state. Use this everywhere the nudge must not be treated as a bio (fed back
 * into the chat/MCP as context, or clobbered/overwritten as if it were real content).
 */
/** True when `bio` IS the claim-nudge empty-state (trimmed, tolerant of stray whitespace). */
export function isAboutEmptyState(bio: string | null | undefined): boolean {
  return bio?.trim() === ABOUT_EMPTY_STATE;
}

export function isRealBio(bio: string | null | undefined): boolean {
  return !!bio && bio.trim().length > 0 && !isAboutEmptyState(bio);
}
