import type { Artist } from '@/server/db/DbTypes';
import type { MusicPlatformArtist, MusicPlatformProvider } from './types';
import pLimit from 'p-limit';

export class ArtistMusicPlatformDataProvider {
    constructor(
        private primaryProvider: MusicPlatformProvider,
        private fallbackProvider: MusicPlatformProvider,
    ) {}

    private resolveIds(artist: Artist): { primaryId: string | null; fallbackId: string | null } {
        return {
            primaryId: artist.deezer?.trim() || null,
            fallbackId: artist.spotify?.trim() || null,
        };
    }

    // Try primary, fall back to fallback on null/error. Both calls are wrapped
    // so callers never need their own try/catch.
    private async withFallback<T>(
        primaryId: string | null,
        fallbackId: string | null,
        fn: (provider: MusicPlatformProvider, id: string) => Promise<T | null>,
    ): Promise<T | null> {
        if (primaryId) {
            try {
                const result = await fn(this.primaryProvider, primaryId);
                if (result != null) return result;
            } catch (error) {
                console.error('[AMPDP] Primary provider error, trying fallback:', error);
            }
            if (fallbackId) {
                try {
                    return await fn(this.fallbackProvider, fallbackId);
                } catch (error) {
                    console.error('[AMPDP] Fallback provider error:', error);
                    return null;
                }
            }
            return null;
        }

        if (fallbackId) {
            try {
                return await fn(this.fallbackProvider, fallbackId);
            } catch (error) {
                console.error('[AMPDP] Fallback provider error:', error);
                return null;
            }
        }
        return null;
    }

    async getArtist(artist: Artist): Promise<MusicPlatformArtist | null> {
        const { primaryId, fallbackId } = this.resolveIds(artist);
        return this.withFallback(primaryId, fallbackId, (p, id) => p.getArtist(id));
    }

    async getArtistImage(artist: Artist): Promise<string | null> {
        const { primaryId, fallbackId } = this.resolveIds(artist);
        return this.withFallback(primaryId, fallbackId, (p, id) => p.getArtistImage(id));
    }

    async getTopTrackName(artist: Artist): Promise<string | null> {
        const { primaryId, fallbackId } = this.resolveIds(artist);
        return this.withFallback(primaryId, fallbackId, (p, id) => p.getTopTrackName(id));
    }

    // Search always uses primary provider (Deezer). No fallback: we want consistent
    // search source, and Spotify search will be removed in Phase 5.
    async searchArtists(query: string, limit: number): Promise<MusicPlatformArtist[]> {
        return this.primaryProvider.searchArtists(query, limit);
    }

    async getArtistImages(artists: Artist[]): Promise<Map<string, string>> {
        const imageMap = new Map<string, string>();
        const limit = pLimit(10);

        const tasks = artists.map((artist) => limit(async () => {
            const image = await this.getArtistImage(artist);
            if (image) imageMap.set(artist.id, image);
        }));

        await Promise.all(tasks);
        return imageMap;
    }

    getActivePlatform(artist: Artist): 'deezer' | 'spotify' | null {
        const { primaryId, fallbackId } = this.resolveIds(artist);
        if (primaryId) return this.primaryProvider.platform;
        if (fallbackId) return this.fallbackProvider.platform;
        return null;
    }
}
