/** Where the site is served from — metadata needs absolute URLs, pages don't. */
const SITE_ORIGIN = "https://www.musicnerd.xyz";

/**
 * The artist's own uploaded image, or null when they haven't set one.
 *
 * `artists.custom_image` is nullable and has historically also held the empty
 * string, so callers can't simply null-check it.
 */
export function customImageUrl(customImage: string | null | undefined): string | null {
    const trimmed = customImage?.trim();
    return trimmed ? trimmed : null;
}

/**
 * Absolute form of a stored image value, for metadata (OG / Twitter cards),
 * which cannot resolve a relative path.
 *
 * Anything uploaded through /api/artist/profile-image is already an absolute
 * Supabase Storage URL. Older rows stored a site-relative path instead, so this
 * has to handle both rather than assume one shape.
 */
export function absoluteImageUrl(value: string, origin: string = SITE_ORIGIN): string {
    if (/^https?:\/\//i.test(value)) return value;
    return `${origin}${value.startsWith("/") ? "" : "/"}${value}`;
}
