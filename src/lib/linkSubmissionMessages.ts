/** UI label for the dropdown that lists the platforms we currently accept. */
export const TIPS_BUTTON_LABEL = "Supported links";

/** Friendly rejection copy used in the AddArtistData modal (Tips button is visible). */
export const LINK_NOT_SUPPORTED =
    `We don't support that link yet. Tap "${TIPS_BUTTON_LABEL}" to see what we accept.`;

/**
 * Friendly rejection copy for server responses. Intentionally context-agnostic
 * (no "in the dialog" wording) so it stays correct if surfaced from a toast,
 * a future API consumer, or anywhere else outside the AddArtistData modal.
 */
export const LINK_NOT_SUPPORTED_LONG =
    `We don't support that link yet — we currently accept links from a fixed set of platforms. Check the "${TIPS_BUTTON_LABEL}" list to see them.`;

/** Twitter/X-specific rejection — kept here so all link rejection copy lives in one place. */
export const LINK_TWITTER_INVALID =
    "That Twitter/X profile link doesn't look valid. Double-check the URL and try again.";
