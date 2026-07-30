export const RESEARCH_PLATFORM_VALUES = [
  "spotify",
  "deezer",
  "apple_music",
  "musicbrainz",
  "wikidata",
  "tidal",
  "amazon_music",
  "youtube_music",
  "genius",
  "allmusic",
  "billboard",
  "rolling_stone",
  "discogs",
  "lastfm",
  "soundcloud",
  "imdb",
  "youtube_channel",
  "x",
  "instagram",
  "facebook",
  "facebook_id",
  "official_website",
] as const;

export type ResearchPlatform = (typeof RESEARCH_PLATFORM_VALUES)[number];

export const ID_MAPPING_PLATFORM_VALUES = [
  "spotify",
  "deezer",
  "apple_music",
  "musicbrainz",
  "wikidata",
  "tidal",
  "amazon_music",
  "youtube_music",
  "genius",
  "allmusic",
  "billboard",
  "rolling_stone",
  "discogs",
  "lastfm",
  "imdb",
] as const satisfies readonly ResearchPlatform[];

export const RESEARCH_SOURCE_VALUES = [
  "wikidata",
  "musicbrainz",
  "name_search",
  "web_search",
  "manual",
] as const;

export type ResearchSource = (typeof RESEARCH_SOURCE_VALUES)[number];

export const RESEARCH_CONFIDENCE_VALUES = [
  "high",
  "medium",
  "low",
  "manual",
] as const;

export type ResearchConfidence = (typeof RESEARCH_CONFIDENCE_VALUES)[number];

export type ResearchFindingKind =
  | "platform_id"
  | "social_link"
  | "official_website";

export type ResearchEvidence = {
  type: "entity" | "url" | "name_match" | "identifier";
  value: string;
  label?: string;
};

/**
 * Source-neutral output shared by deterministic resolvers and the future
 * asynchronous research worker.
 *
 * `value` is the platform-native value (ID, handle, slug, or URL), not a
 * rendered public URL. The platform registry owns normalization/rendering.
 */
export type ResearchFinding = {
  kind: ResearchFindingKind;
  platform: ResearchPlatform;
  value: string;
  confidence: ResearchConfidence;
  source: ResearchSource;
  reasoning?: string;
  evidence?: ResearchEvidence[];
};
