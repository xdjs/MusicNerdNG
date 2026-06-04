export interface ArtistSummary {
  id: string;
  name: string;
}

export interface SocialLink {
  handle: string;
  url: string;
}

export interface ArtistDetail {
  id: string;
  name: string;
  bio: string | null;
  spotifyId: string | null;
  deezerId: string | null;
  socialLinks: Record<string, SocialLink>;
}

export interface SearchResponse {
  artists: ArtistSummary[];
  totalResults: number;
}

export interface GetArtistResponse {
  artist: ArtistDetail;
}

export interface ErrorResponse {
  error: string;
  code: "NOT_FOUND" | "INVALID_INPUT" | "INTERNAL_ERROR";
}
