import type { MusicPlatformArtist, MusicPlatformProvider } from './types';
import axios from 'axios';
import { unstable_cache } from 'next/cache';
import pLimit from 'p-limit';

const DEEZER_API = 'https://api.deezer.com';
const CACHE_TTL = 86400; // 24 hours
const BATCH_CONCURRENCY = 10;
const REQUEST_TIMEOUT = 5000; // 5s per request

interface DeezerArtistResponse {
    id: number;
    name: string;
    link: string;
    picture_medium: string;
    picture_xl: string;
    nb_fan: number;
    nb_album: number;
    error?: { type: string; message: string; code: number };
}

interface DeezerTopTrackResponse {
    data: { id: number; title: string }[];
    error?: { type: string; message: string; code: number };
}

interface DeezerSearchResponse {
    data: DeezerArtistResponse[];
    error?: { type: string; message: string; code: number };
}

function isDeezerError(data: unknown): data is { error: { type: string; message: string } } {
    return typeof data === 'object' && data !== null && 'error' in data && typeof (data as Record<string, unknown>).error === 'object';
}

function mapDeezerArtist(
    artist: DeezerArtistResponse,
    topTrackName: string | null,
): MusicPlatformArtist {
    return {
        platform: 'deezer',
        platformId: String(artist.id),
        name: artist.name,
        imageUrl: artist.picture_xl || null, // XL (1000x1000) for hero/OG contexts
        followerCount: artist.nb_fan,
        albumCount: artist.nb_album,
        genres: [], // Deezer only has genres on albums, not artists
        profileUrl: artist.link,
        topTrackName,
    };
}

function isValidDeezerId(id: string): boolean {
    return /^\d+$/.test(id);
}

const fetchDeezerArtist = unstable_cache(
    async (id: string): Promise<DeezerArtistResponse | null> => {
        if (!isValidDeezerId(id)) return null;
        try {
            const { data } = await axios.get<DeezerArtistResponse>(`${DEEZER_API}/artist/${id}`, { timeout: REQUEST_TIMEOUT });
            if (isDeezerError(data)) {
                console.error(`[DeezerProvider] Artist ${id} error:`, data.error);
                return null;
            }
            return data;
        } catch (error) {
            console.error(`[DeezerProvider] Artist ${id} network error:`, error);
            return null;
        }
    },
    ['deezer-artist'],
    { revalidate: CACHE_TTL },
);

const fetchDeezerTopTrack = unstable_cache(
    async (id: string): Promise<string | null> => {
        if (!isValidDeezerId(id)) return null;
        try {
            const { data } = await axios.get<DeezerTopTrackResponse>(`${DEEZER_API}/artist/${id}/top?limit=1`, { timeout: REQUEST_TIMEOUT });
            if (isDeezerError(data)) return null;
            return data.data?.[0]?.title ?? null;
        } catch {
            return null;
        }
    },
    ['deezer-top-track'],
    { revalidate: CACHE_TTL },
);

export class DeezerProvider implements MusicPlatformProvider {
    readonly platform = 'deezer' as const;

    async getArtist(id: string): Promise<MusicPlatformArtist | null> {
        const [artist, topTrackName] = await Promise.all([
            fetchDeezerArtist(id),
            fetchDeezerTopTrack(id),
        ]);
        if (!artist) return null;
        return mapDeezerArtist(artist, topTrackName);
    }

    async getArtistImage(id: string): Promise<string | null> {
        const artist = await fetchDeezerArtist(id);
        if (!artist) return null;
        return artist.picture_medium || null; // Medium (250x250) for thumbnails
    }

    async getTopTrackName(id: string): Promise<string | null> {
        return fetchDeezerTopTrack(id);
    }

    async searchArtists(query: string, limit: number): Promise<MusicPlatformArtist[]> {
        if (!query?.trim()) return [];
        try {
            const { data } = await axios.get<DeezerSearchResponse>(
                `${DEEZER_API}/search/artist?q=${encodeURIComponent(query)}&limit=${limit}`,
                { timeout: REQUEST_TIMEOUT },
            );
            if (isDeezerError(data)) {
                console.error('[DeezerProvider] Search error:', data.error);
                return [];
            }
            return (data.data ?? []).map((artist) => mapDeezerArtist(artist, null));
        } catch (error) {
            console.error('[DeezerProvider] Search network error:', error);
            return [];
        }
    }

    async getArtists(ids: string[]): Promise<MusicPlatformArtist[]> {
        if (ids.length === 0) return [];

        const limit = pLimit(BATCH_CONCURRENCY);
        const results = await Promise.all(
            ids.map((id) => limit(() => this.getArtist(id))),
        );
        return results.filter((a): a is MusicPlatformArtist => a != null);
    }
}

export const deezerProvider = new DeezerProvider();
