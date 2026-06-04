export const SOURCE_TYPES = [
    "article",
    "interview",
    "review",
    "profile",
    "document",
    "image",
    "audio",
    "video",
    "data",
    "social",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_TYPE_COLORS: Record<SourceType, { bg: string; text: string; border: string }> = {
    article:   { bg: "bg-blue-100 dark:bg-blue-900/40",     text: "text-blue-700 dark:text-blue-300",     border: "border-blue-300 dark:border-blue-700" },
    interview: { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300", border: "border-purple-300 dark:border-purple-700" },
    review:    { bg: "bg-amber-100 dark:bg-amber-900/40",   text: "text-amber-700 dark:text-amber-300",   border: "border-amber-300 dark:border-amber-700" },
    profile:   { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-300 dark:border-emerald-700" },
    document:  { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300", border: "border-orange-300 dark:border-orange-700" },
    image:     { bg: "bg-cyan-100 dark:bg-cyan-900/40",     text: "text-cyan-700 dark:text-cyan-300",     border: "border-cyan-300 dark:border-cyan-700" },
    audio:     { bg: "bg-pink-100 dark:bg-pink-900/40",     text: "text-pink-700 dark:text-pink-300",     border: "border-pink-300 dark:border-pink-700" },
    video:     { bg: "bg-red-100 dark:bg-red-900/40",       text: "text-red-700 dark:text-red-300",       border: "border-red-300 dark:border-red-700" },
    data:      { bg: "bg-slate-100 dark:bg-slate-900/40",   text: "text-slate-700 dark:text-slate-300",   border: "border-slate-300 dark:border-slate-700" },
    social:    { bg: "bg-indigo-100 dark:bg-indigo-900/40", text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-300 dark:border-indigo-700" },
};

const DOMAIN_TYPE_MAP: Record<string, SourceType> = {
    // Reviews
    "pitchfork.com": "review",
    "albumoftheyear.org": "review",
    "metacritic.com": "review",
    // Interviews / long-form
    "rollingstone.com": "interview",
    "nme.com": "interview",
    "thefader.com": "interview",
    // Video
    "youtube.com": "video",
    "youtu.be": "video",
    "vimeo.com": "video",
    "tiktok.com": "video",
    // Social
    "twitter.com": "social",
    "x.com": "social",
    "instagram.com": "social",
    "facebook.com": "social",
    "threads.net": "social",
    // Audio
    "soundcloud.com": "audio",
    "bandcamp.com": "audio",
    "audiomack.com": "audio",
    // Profile / bio sites
    "allmusic.com": "profile",
    "genius.com": "profile",
    "last.fm": "profile",
    "rateyourmusic.com": "profile",
    "discogs.com": "profile",
    "wikipedia.org": "profile",
};

const PATH_KEYWORD_MAP: Record<string, SourceType> = {
    "interview": "interview",
    "interviews": "interview",
    "review": "review",
    "reviews": "review",
    "profile": "profile",
    "profiles": "profile",
    "video": "video",
    "videos": "video",
};

export function inferTypeFromUrl(url: string): SourceType {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

        // Check domain map
        for (const [domain, type] of Object.entries(DOMAIN_TYPE_MAP)) {
            if (host === domain || host.endsWith(`.${domain}`)) return type;
        }

        // Check path keywords
        const pathParts = parsed.pathname.toLowerCase().split("/");
        for (const part of pathParts) {
            if (PATH_KEYWORD_MAP[part]) return PATH_KEYWORD_MAP[part];
        }
    } catch {
        // malformed URL — fall through
    }
    return "article";
}
