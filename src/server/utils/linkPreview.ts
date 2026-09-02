/**
 * Shared link-preview helper for onboarding cards — makes profile/vault rows
 * look like a real iMessage/Slack link unfurl (thumbnail + title) instead of
 * a bare text row.
 *
 * NEVER throws. Every failure mode (unsafe URL, network error, timeout,
 * unexpected shape) resolves to `{ imageUrl: null, title: null }` so a slow
 * or hostile link can never take down an onboarding turn.
 */
import { isUnsafeUrl, extractOgImage, extractOgTitle } from "@/server/utils/fetchPageContent";

export interface LinkPreview {
    imageUrl: string | null;
    title: string | null;
}

const EMPTY_PREVIEW: LinkPreview = { imageUrl: null, title: null };

/** Per-fetch hard timeout. Two fetches can chain for a Spotify URL (oEmbed,
 *  then the scrape fallback) — kept short so that worst case still fits well
 *  inside the ~5s overall budget the caller (buildProfilesPayload) enforces
 *  across ALL links in parallel. */
const FETCH_TIMEOUT_MS = 4000;

const SPOTIFY_OEMBED_ENDPOINT = "https://open.spotify.com/oembed?url=";

function isSpotifyUrl(url: string): boolean {
    try {
        return new URL(url).hostname.toLowerCase() === "open.spotify.com";
    } catch {
        return false;
    }
}

/** fetch() with a hard AbortController timeout. Returns null (never throws)
 *  on any network failure, abort, or non-fetch exception. */
async function fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { headers, signal: controller.signal });
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** Official Spotify oEmbed endpoint — no scraping, no auth. Preferred source
 *  for Spotify URLs since it reliably returns the real artist photo. */
async function fetchSpotifyOEmbed(url: string): Promise<LinkPreview> {
    try {
        const res = await fetchWithTimeout(`${SPOTIFY_OEMBED_ENDPOINT}${encodeURIComponent(url)}`);
        if (!res || !res.ok) return EMPTY_PREVIEW;
        const data = await res.json();
        const imageUrl = typeof data?.thumbnail_url === "string" && data.thumbnail_url.startsWith("https://")
            ? data.thumbnail_url
            : null;
        const title = typeof data?.title === "string" ? data.title : null;
        return { imageUrl, title };
    } catch {
        return EMPTY_PREVIEW;
    }
}

/** Generic og:image/og:title scrape via the bot UA that successfully clears
 *  Spotify's and Instagram's anti-bot checks (a browser UA gets blocked by
 *  both — verified against the live sites, do not switch this). */
async function fetchOgPreview(url: string): Promise<LinkPreview> {
    try {
        const res = await fetchWithTimeout(url, { "User-Agent": "MusicNerdBot/1.0" });
        if (!res || !res.ok) return EMPTY_PREVIEW;
        const html = await res.text();
        return { imageUrl: extractOgImage(html), title: extractOgTitle(html) };
    } catch {
        return EMPTY_PREVIEW;
    }
}

/** oEmbed first; if it didn't yield an image (X/Twitter-style JS walls don't
 *  apply here, but a thin/empty oEmbed response can happen), fall back to
 *  scraping the page directly. */
async function fetchSpotifyPreview(url: string): Promise<LinkPreview> {
    const oembed = await fetchSpotifyOEmbed(url);
    if (oembed.imageUrl) return oembed;
    const scraped = await fetchOgPreview(url);
    return { imageUrl: scraped.imageUrl, title: scraped.title ?? oembed.title };
}

/** Fetch a link preview (image + title) for a user-controlled URL.
 *  - SSRF-guarded via `isUnsafeUrl` (link values come from artist input).
 *  - Spotify URLs prefer the official oEmbed endpoint, falling back to a
 *    tolerant og:image/og:title scrape.
 *  - Everything else goes straight to the scrape.
 *  - X/Twitter and Apple Music are JS-rendered/walled and return no
 *    og:image — this resolves to nulls, not an error; callers must degrade
 *    gracefully (verified against the live sites).
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
    try {
        if (!url || isUnsafeUrl(url)) return EMPTY_PREVIEW;
        return isSpotifyUrl(url) ? await fetchSpotifyPreview(url) : await fetchOgPreview(url);
    } catch {
        return EMPTY_PREVIEW;
    }
}
