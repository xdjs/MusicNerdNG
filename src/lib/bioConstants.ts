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
