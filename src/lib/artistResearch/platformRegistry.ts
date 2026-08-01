import {
  RESEARCH_PLATFORM_VALUES,
  type ResearchFindingKind,
  type ResearchPlatform,
} from "./types";

export type ResearchArtistColumn =
  | "spotify"
  | "deezer"
  | "musicbrainz"
  | "wikidata"
  | "discogs"
  | "lastfm"
  | "soundcloud"
  | "imdb"
  | "youtubechannel"
  | "x"
  | "instagram"
  | "facebook"
  | "facebookID";

export type ResearchPlatformDefinition = {
  key: ResearchPlatform;
  label: string;
  kind: ResearchFindingKind;
  artistColumn?: ResearchArtistColumn;
  wikidataProperty?: `P${number}`;
  wikidataVariable?: string;
  buildUrl: (value: string) => string;
  extractFromUrl?: (url: URL) => string | null;
};

const stripAt = (value: string) => value.replace(/^@/, "");
const pathParts = (url: URL): string[] | null => {
  const parts = url.pathname.split("/");
  while (parts[0] === "") parts.shift();
  while (parts.at(-1) === "") parts.pop();

  try {
    // Preserve empty internal segments. Dropping them can turn a malformed
    // `/artist//later-value` URL into a valid-looking platform ID.
    return parts.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
};
const normalizedHost = (url: URL) =>
  url.hostname.toLowerCase().replace(/^www\./, "");
const encodePathValue = (value: string) =>
  value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

function hostMatches(url: URL, ...hosts: string[]): boolean {
  const host = normalizedHost(url);
  return hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

function segmentAfter(url: URL, segment: string): string | null {
  const parts = pathParts(url);
  if (!parts) return null;
  const index = parts.findIndex((part) => part.toLowerCase() === segment);
  return index >= 0 ? parts[index + 1] ?? null : null;
}

function firstPathSegment(url: URL): string | null {
  return pathParts(url)?.[0] ?? null;
}

// Wikidata P2397 stores a YouTube channel ID. The same channel ID resolves on
// both YouTube and YouTube Music, so those platforms intentionally share it.
const YOUTUBE_CHANNEL_ID_WIKIDATA_PROPERTY = "P2397";

function matchingValue(
  value: string | null,
  pattern: RegExp,
): string | null {
  return value && pattern.test(value) ? value : null;
}

function normalizeFacebookIdUrl(rawValue: string): string {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    return "";
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !hostMatches(url, "facebook.com")
  ) {
    return "";
  }

  const parts = pathParts(url);
  if (!parts) return "";
  if (parts[0]?.toLowerCase() === "profile.php") {
    const id = url.searchParams.get("id");
    return id && /^\d+$/.test(id)
      ? `https://www.facebook.com/profile.php?id=${id}`
      : "";
  }
  if (
    parts[0]?.toLowerCase() === "people" &&
    parts[1] &&
    parts[2] &&
    /^\d+$/.test(parts[2])
  ) {
    return `https://www.facebook.com/people/${encodeURIComponent(parts[1])}/${parts[2]}/`;
  }
  return "";
}

const DEFINITIONS: Record<ResearchPlatform, ResearchPlatformDefinition> = {
  spotify: {
    key: "spotify",
    label: "Spotify",
    kind: "platform_id",
    artistColumn: "spotify",
    wikidataProperty: "P1902",
    wikidataVariable: "spotify",
    buildUrl: (value) => `https://open.spotify.com/artist/${encodeURIComponent(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "open.spotify.com")
        ? matchingValue(segmentAfter(url, "artist"), /^[A-Za-z0-9]+$/)
        : null,
  },
  deezer: {
    key: "deezer",
    label: "Deezer",
    kind: "platform_id",
    artistColumn: "deezer",
    wikidataProperty: "P2722",
    wikidataVariable: "deezer",
    buildUrl: (value) => `https://www.deezer.com/artist/${encodeURIComponent(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "deezer.com")
        ? matchingValue(segmentAfter(url, "artist"), /^\d+$/)
        : null,
  },
  apple_music: {
    key: "apple_music",
    label: "Apple Music",
    kind: "platform_id",
    wikidataProperty: "P2850",
    wikidataVariable: "apple",
    buildUrl: (value) => `https://music.apple.com/artist/${encodeURIComponent(value)}`,
    extractFromUrl: (url) => {
      if (!hostMatches(url, "music.apple.com")) return null;
      const parts = pathParts(url);
      if (!parts) return null;
      const artistIndex = parts.findIndex((part) => part.toLowerCase() === "artist");
      return artistIndex >= 0
        ? matchingValue(parts.at(-1) ?? null, /^\d+$/)
        : null;
    },
  },
  musicbrainz: {
    key: "musicbrainz",
    label: "MusicBrainz",
    kind: "platform_id",
    artistColumn: "musicbrainz",
    wikidataProperty: "P434",
    wikidataVariable: "mbid",
    buildUrl: (value) => `https://musicbrainz.org/artist/${encodeURIComponent(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "musicbrainz.org") ? segmentAfter(url, "artist") : null,
  },
  wikidata: {
    key: "wikidata",
    label: "Wikidata",
    kind: "platform_id",
    artistColumn: "wikidata",
    buildUrl: (value) => `https://www.wikidata.org/wiki/${encodeURIComponent(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "wikidata.org") ? segmentAfter(url, "wiki") : null,
  },
  tidal: {
    key: "tidal",
    label: "TIDAL",
    kind: "platform_id",
    wikidataProperty: "P4576",
    wikidataVariable: "tidal",
    buildUrl: (value) => `https://tidal.com/browse/artist/${encodeURIComponent(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "tidal.com")
        ? matchingValue(segmentAfter(url, "artist"), /^\d+$/)
        : null,
  },
  amazon_music: {
    key: "amazon_music",
    label: "Amazon Music",
    kind: "platform_id",
    wikidataProperty: "P6276",
    wikidataVariable: "amazonMusic",
    buildUrl: (value) => `https://music.amazon.com/artists/${encodeURIComponent(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "music.amazon.com") ? segmentAfter(url, "artists") : null,
  },
  youtube_music: {
    key: "youtube_music",
    label: "YouTube Music",
    kind: "platform_id",
    wikidataProperty: YOUTUBE_CHANNEL_ID_WIKIDATA_PROPERTY,
    wikidataVariable: "youtubeMusic",
    buildUrl: (value) => `https://music.youtube.com/channel/${encodeURIComponent(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "music.youtube.com") ? segmentAfter(url, "channel") : null,
  },
  genius: {
    key: "genius",
    label: "Genius",
    kind: "platform_id",
    wikidataProperty: "P2373",
    wikidataVariable: "genius",
    buildUrl: (value) => `https://genius.com/artists/${encodePathValue(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "genius.com") ? segmentAfter(url, "artists") : null,
  },
  allmusic: {
    key: "allmusic",
    label: "AllMusic",
    kind: "platform_id",
    wikidataProperty: "P1728",
    wikidataVariable: "allmusic",
    buildUrl: (value) => `https://www.allmusic.com/artist/${encodeURIComponent(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "allmusic.com") ? segmentAfter(url, "artist") : null,
  },
  billboard: {
    key: "billboard",
    label: "Billboard",
    kind: "platform_id",
    wikidataProperty: "P4208",
    wikidataVariable: "billboard",
    buildUrl: (value) => `https://www.billboard.com/artist/${encodePathValue(value)}/`,
    extractFromUrl: (url) =>
      hostMatches(url, "billboard.com") ? segmentAfter(url, "artist") : null,
  },
  rolling_stone: {
    key: "rolling_stone",
    label: "Rolling Stone",
    kind: "platform_id",
    wikidataProperty: "P3017",
    wikidataVariable: "rollingStone",
    buildUrl: (value) =>
      `https://www.rollingstone.com/music/music-artists/${encodePathValue(value)}/`,
    extractFromUrl: (url) =>
      hostMatches(url, "rollingstone.com")
        ? segmentAfter(url, "music-artists")
        : null,
  },
  discogs: {
    key: "discogs",
    label: "Discogs",
    kind: "platform_id",
    artistColumn: "discogs",
    wikidataProperty: "P1953",
    wikidataVariable: "discogs",
    buildUrl: (value) => `https://www.discogs.com/artist/${encodeURIComponent(value)}`,
    extractFromUrl: (url) => {
      if (!hostMatches(url, "discogs.com")) return null;
      const value = segmentAfter(url, "artist");
      return matchingValue(value?.split("-")[0] ?? null, /^\d+$/);
    },
  },
  lastfm: {
    key: "lastfm",
    label: "Last.fm",
    kind: "platform_id",
    artistColumn: "lastfm",
    wikidataProperty: "P3192",
    wikidataVariable: "lastfm",
    buildUrl: (value) => `https://www.last.fm/music/${encodePathValue(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "last.fm") ? segmentAfter(url, "music") : null,
  },
  soundcloud: {
    key: "soundcloud",
    label: "SoundCloud",
    kind: "social_link",
    artistColumn: "soundcloud",
    wikidataProperty: "P3040",
    wikidataVariable: "soundcloud",
    buildUrl: (value) => `https://soundcloud.com/${encodePathValue(stripAt(value))}`,
    extractFromUrl: (url) =>
      hostMatches(url, "soundcloud.com") ? firstPathSegment(url) : null,
  },
  imdb: {
    key: "imdb",
    label: "IMDb",
    kind: "platform_id",
    artistColumn: "imdb",
    wikidataProperty: "P345",
    wikidataVariable: "imdb",
    buildUrl: (value) => `https://www.imdb.com/name/${encodeURIComponent(value)}/`,
    extractFromUrl: (url) =>
      hostMatches(url, "imdb.com") ? segmentAfter(url, "name") : null,
  },
  youtube_channel: {
    key: "youtube_channel",
    label: "YouTube",
    kind: "social_link",
    artistColumn: "youtubechannel",
    wikidataProperty: YOUTUBE_CHANNEL_ID_WIKIDATA_PROPERTY,
    wikidataVariable: "youtube",
    buildUrl: (value) => `https://www.youtube.com/channel/${encodeURIComponent(value)}`,
    extractFromUrl: (url) =>
      hostMatches(url, "youtube.com") ? segmentAfter(url, "channel") : null,
  },
  x: {
    key: "x",
    label: "X",
    kind: "social_link",
    artistColumn: "x",
    wikidataProperty: "P2002",
    wikidataVariable: "twitter",
    buildUrl: (value) => `https://x.com/${encodeURIComponent(stripAt(value))}`,
    extractFromUrl: (url) =>
      hostMatches(url, "x.com", "twitter.com") ? firstPathSegment(url) : null,
  },
  instagram: {
    key: "instagram",
    label: "Instagram",
    kind: "social_link",
    artistColumn: "instagram",
    wikidataProperty: "P2003",
    wikidataVariable: "instagram",
    buildUrl: (value) =>
      `https://www.instagram.com/${encodeURIComponent(stripAt(value))}/`,
    extractFromUrl: (url) =>
      hostMatches(url, "instagram.com") ? firstPathSegment(url) : null,
  },
  facebook: {
    key: "facebook",
    label: "Facebook",
    kind: "social_link",
    artistColumn: "facebook",
    wikidataProperty: "P2013",
    wikidataVariable: "facebook",
    buildUrl: (value) =>
      `https://www.facebook.com/${encodePathValue(stripAt(value))}`,
    extractFromUrl: (url) => {
      if (!hostMatches(url, "facebook.com")) return null;
      const parts = pathParts(url);
      if (!parts || parts.length !== 1) return null;
      const username = parts[0];
      if (
        !username ||
        /^(?:profile\.php|people|pages|groups|events|watch|marketplace)$/i.test(
          username,
        ) ||
        /^\d+$/.test(username) ||
        !/^[A-Za-z0-9.-]+$/.test(username)
      ) {
        return null;
      }
      return username;
    },
  },
  facebook_id: {
    key: "facebook_id",
    label: "Facebook",
    kind: "social_link",
    artistColumn: "facebookID",
    buildUrl: (value) => value,
    extractFromUrl: (url) => normalizeFacebookIdUrl(url.toString()) || null,
  },
  official_website: {
    key: "official_website",
    label: "Official website",
    kind: "official_website",
    wikidataProperty: "P856",
    wikidataVariable: "website",
    buildUrl: (value) => value,
  },
};

export const RESEARCH_PLATFORM_REGISTRY = Object.freeze(DEFINITIONS);

export const WIKIDATA_PLATFORM_DEFINITIONS = RESEARCH_PLATFORM_VALUES.map(
  (platform) => DEFINITIONS[platform],
).filter(
  (
    definition,
  ): definition is ResearchPlatformDefinition & {
    wikidataProperty: `P${number}`;
    wikidataVariable: string;
  } => Boolean(definition.wikidataProperty && definition.wikidataVariable),
);

export function isResearchPlatform(value: string): value is ResearchPlatform {
  return Object.prototype.hasOwnProperty.call(RESEARCH_PLATFORM_REGISTRY, value);
}

export function getResearchPlatformDefinition(
  platform: ResearchPlatform,
): ResearchPlatformDefinition {
  return RESEARCH_PLATFORM_REGISTRY[platform];
}

export function normalizeResearchPlatformValue(
  platform: ResearchPlatform,
  rawValue: string,
): string {
  const value = rawValue.trim();
  if (!value) return "";

  if (platform === "official_website") {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
    } catch {
      return "";
    }
  }

  if (platform === "facebook_id") {
    return normalizeFacebookIdUrl(value);
  }

  if (platform === "x" || platform === "instagram" || platform === "facebook") {
    return stripAt(value).toLowerCase();
  }

  return value;
}

export function buildResearchPlatformUrl(
  platform: ResearchPlatform,
  value: string,
): string {
  const normalized = normalizeResearchPlatformValue(platform, value);
  if (!normalized) return "";
  return RESEARCH_PLATFORM_REGISTRY[platform].buildUrl(normalized);
}

export function extractResearchPlatformFromUrl(
  rawUrl: string,
): { platform: ResearchPlatform; value: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  for (const platform of RESEARCH_PLATFORM_VALUES) {
    const definition = RESEARCH_PLATFORM_REGISTRY[platform];
    const extracted = definition.extractFromUrl?.(url);
    if (!extracted) continue;
    const value = normalizeResearchPlatformValue(platform, extracted);
    if (value) return { platform, value };
  }

  return null;
}
