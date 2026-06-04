export type { MusicPlatform, MusicPlatformArtist, MusicPlatformProvider } from './types';
export { SpotifyProvider, spotifyProvider } from './spotifyProvider';
export { DeezerProvider, deezerProvider } from './deezerProvider';
export { ArtistMusicPlatformDataProvider } from './artistMusicPlatformDataProvider';

import { deezerProvider } from './deezerProvider';
import { spotifyProvider } from './spotifyProvider';
import { ArtistMusicPlatformDataProvider } from './artistMusicPlatformDataProvider';

export const musicPlatformData = new ArtistMusicPlatformDataProvider(
    deezerProvider,
    spotifyProvider,
);
