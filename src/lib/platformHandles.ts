/**
 * Path segments that look like a handle to a URL pattern but never are.
 *
 * The urlmap regexes capture the first path segment as the artist's id, so
 * `instagram.com/p/DUtSSjnCYcU` — a POST — comes back as
 * `{ siteName: "instagram", id: "p" }`. Anything that then writes that to the
 * artist row sets their Instagram handle to "p".
 *
 * Discovery surfaces post and status URLs constantly (they are what a search for
 * an artist's name mostly returns), so this is not a hypothetical: it is one
 * readable post page away from firing.
 */
const RESERVED_HANDLES: Record<string, Set<string>> = {
    instagram: new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct"]),
    facebook: new Set(["photo", "photos", "groups", "events", "pages", "watch", "story.php", "permalink.php", "sharer"]),
    x: new Set(["i", "status", "intent", "search", "hashtag", "home", "explore", "notifications"]),
    tiktok: new Set(["video", "tag", "search", "discover", "music", "effect"]),
    youtube: new Set(["watch", "shorts", "playlist", "results", "feed", "channel", "embed"]),
    youtubechannel: new Set(["watch", "shorts", "playlist", "results", "feed", "embed"]),
    soundcloud: new Set(["search", "discover", "stream", "you", "tags", "charts"]),
    twitch: new Set(["videos", "directory", "settings", "downloads"]),
    spotify: new Set(["track", "album", "playlist", "search", "user", "episode", "show"]),
    deezer: new Set(["album", "track", "playlist", "search", "profile", "show"]),
};

/**
 * Is this "handle" actually a platform route rather than someone's account?
 *
 * Case-insensitive, and treats a bare single character as reserved regardless of
 * platform: no artist's handle is one character on any of these services, and a
 * one-character id is far more likely to be a truncated path than a real name.
 */
export function isReservedHandle(siteName: string, id: string): boolean {
    const handle = id.trim().toLowerCase().replace(/^@/, "");
    if (!handle || handle.length < 2) return true;
    return RESERVED_HANDLES[siteName.toLowerCase()]?.has(handle) ?? false;
}
