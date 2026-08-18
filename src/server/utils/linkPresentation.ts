/**
 * Shared presentation helpers for onboarding "profile card" UI — used by both
 * the confirmed-links payload (`turnHandlers.buildProfilesPayload`) and the
 * discovered-candidates payload (`profileDiscovery.discoverArtistProfiles`)
 * so the two surfaces render identically (same display-name/logo/color rules).
 */

/** Link columns surfaced as profile cards — the curated subset MusicNerd's
 *  onboarding UI treats as "your profiles" (a display/discovery subset of the
 *  full 40+ column writable whitelist in `artistLinkService.ts`). Discovery
 *  targets exactly this set: every candidate a search proposes must land on
 *  one of these columns to ever be writable via `setArtistLink`. */
export const PROFILE_DISPLAY_COLUMNS = [
    "spotify", "deezer", "instagram", "tiktok", "x", "youtube",
    "soundcloud", "bandcamp", "twitch", "facebook",
] as const;

export type ProfileDisplayColumn = (typeof PROFILE_DISPLAY_COLUMNS)[number];

/** Drizzle row properties can differ from the physical/urlmap column names
 *  (mirrors `ARTIST_ROW_PROPERTY_BY_COLUMN` in `artistLinkService.ts`). None
 *  of `PROFILE_DISPLAY_COLUMNS` currently need remapping, but this keeps the
 *  raw-column lookup correct if that ever changes. */
const ARTIST_ROW_PROPERTY_BY_SITENAME: Record<string, string> = {
    facebookID: "facebookId",
    tiktokID: "tiktokId",
};

/** Does the artist already have a non-empty value for this siteName's raw
 *  column? Deliberately the SAME simple truthy check `buildProfilesPayload`
 *  and the confirm_profiles "at least one link" guard use — NOT
 *  `getArtistLinks()`, which applies display-only preference/dedup rules
 *  (e.g. it hides a numeric `soundcloud` value, and hides `youtubechannel`
 *  when a `youtube` username also exists) that would make an already-set
 *  column look "missing" and let a proposed candidate silently overwrite it. */
export function artistHasRawLinkValue(artist: Record<string, unknown>, siteName: string): boolean {
    const propertyName = ARTIST_ROW_PROPERTY_BY_SITENAME[siteName] ?? siteName;
    const value = artist[propertyName];
    return typeof value === "string" && value.length > 0;
}

/** Fallback used only when urlmap has no row (or the lookup itself failed) for a
 *  siteName — a plain capitalized column name, same as the old bare-card look. */
export function fallbackDisplayName(siteName: string): string {
    return siteName.charAt(0).toUpperCase() + siteName.slice(1);
}

export interface UrlmapPresentationRow {
    cardPlatformName?: string | null;
    siteImage?: string | null;
    colorHex?: string | null;
    appStringFormat?: string | null;
}

export interface LinkPresentationMeta {
    displayName: string;
    logoUrl: string | null;
    colorHex: string | null;
    profileUrl: string | null;
}

/** Presentation metadata (logo/color/display name/profile URL) for a single
 *  {siteName, value} pair, given its urlmap row (or `undefined` if the
 *  lookup failed / has no row) — the exact rule `buildProfilesPayload` uses
 *  for confirmed links. */
export function buildLinkPresentationMeta(
    row: UrlmapPresentationRow | undefined,
    siteName: string,
    value: string,
): LinkPresentationMeta {
    const displayName = row?.cardPlatformName || fallbackDisplayName(siteName);
    const logoUrl = row?.siteImage || null;
    // The urlmap column defaults to '#000000' for rows that never got a real
    // brand color — treat that placeholder as "no color" so the client's tint
    // doesn't render a black ring in dark mode.
    const trimmedColor = row?.colorHex?.trim() || null;
    const colorHex = trimmedColor && trimmedColor.toLowerCase() !== "#000000" ? trimmedColor : null;
    const profileUrl = row?.appStringFormat ? row.appStringFormat.replace("%@", value) : null;
    return { displayName, logoUrl, colorHex, profileUrl };
}
