export type MusicPlatform = 'spotify' | 'deezer';

export interface MusicPlatformArtist {
  platform: MusicPlatform;
  platformId: string;
  name: string;
  imageUrl: string | null;
  followerCount: number | null;
  albumCount: number;
  genres: string[];
  profileUrl: string;
  topTrackName: string | null;
}

export interface MusicPlatformProvider {
  readonly platform: MusicPlatform;

  /** Full artist data including top track. */
  getArtist(id: string): Promise<MusicPlatformArtist | null>;

  /** Image only — lighter than getArtist when only image is needed. */
  getArtistImage(id: string): Promise<string | null>;

  /** Top track name. */
  getTopTrackName(id: string): Promise<string | null>;

  /** Search external catalog. Returns array of platform artists (without topTrackName). */
  searchArtists(query: string, limit: number): Promise<MusicPlatformArtist[]>;

  /** Batch fetch. */
  getArtists(ids: string[]): Promise<MusicPlatformArtist[]>;
}
