// @ts-nocheck
import { jest } from '@jest/globals';

const mockGenerate = jest.fn();
jest.mock('@/server/lib/gemini', () => ({
    getGemini: jest.fn(() => ({ models: { generateContent: mockGenerate } })),
    GEMINI_MODEL_FLASH: 'gemini-2.5-flash',
}));

jest.mock('@/server/utils/queries/artistQueries', () => ({
    getArtistById: jest.fn(),
    getAllLinks: jest.fn(),
}));

jest.mock('@/server/utils/services', () => ({ extractArtistId: jest.fn() }));

jest.mock('@/server/utils/linkPreview', () => ({
    fetchLinkPreview: jest.fn().mockResolvedValue({ imageUrl: null, title: null }),
}));

jest.mock('@/server/utils/musicPlatform', () => ({
    musicPlatformData: { getArtist: jest.fn() },
}));

const URLMAP_ROWS = [
    { siteName: 'spotify', cardPlatformName: 'Spotify', siteImage: 'https://cdn/spotify.png', colorHex: '#1DB954', appStringFormat: 'https://open.spotify.com/artist/%@' },
    { siteName: 'instagram', cardPlatformName: 'Instagram', siteImage: 'https://cdn/instagram.png', colorHex: '#E1306C', appStringFormat: 'https://instagram.com/%@' },
    { siteName: 'tiktok', cardPlatformName: 'TikTok', siteImage: null, colorHex: '#000000', appStringFormat: 'https://tiktok.com/@%@' },
    { siteName: 'x', cardPlatformName: 'X', siteImage: null, colorHex: null, appStringFormat: 'https://x.com/%@' },
    { siteName: 'youtube', cardPlatformName: 'YouTube', siteImage: null, colorHex: '#FF0000', appStringFormat: 'https://youtube.com/@%@' },
    { siteName: 'facebook', cardPlatformName: 'Facebook', siteImage: null, colorHex: '#1877F2', appStringFormat: 'https://facebook.com/%@' },
];

const BASE_ARTIST = { id: 'a1', name: 'Pete Rango', deezer: '94933462' };
const ENRICHMENT = {
    platform: 'deezer', platformId: '94933462', name: 'Pete Rango', imageUrl: null,
    followerCount: 6, albumCount: 14, genres: [], profileUrl: 'https://deezer.com/artist/94933462', topTrackName: null,
};

async function setup() {
    const artistQ = await import('@/server/utils/queries/artistQueries');
    const { extractArtistId } = await import('@/server/utils/services');
    const { fetchLinkPreview } = await import('@/server/utils/linkPreview');
    const { musicPlatformData } = await import('@/server/utils/musicPlatform');
    const { discoverArtistProfiles } = await import('../profileDiscovery');
    return { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles };
}

describe('discoverArtistProfiles', () => {
    beforeEach(() => {
        jest.resetModules();
        mockGenerate.mockReset();
    });

    it('returns [] and never throws when Gemini fails on every attempt', async () => {
        const { artistQ, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockRejectedValue(new Error('Gemini is down'));

        await expect(discoverArtistProfiles('a1')).resolves.toEqual([]);
    });

    it('retries once (not vaultWebSearch\'s 4x) on an empty/unparseable response, then gives up', async () => {
        const { artistQ, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({ text: 'not json at all' });

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
        expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    it('never throws and returns [] when getArtistById throws', async () => {
        const { artistQ, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockRejectedValue(new Error('db down'));
        await expect(discoverArtistProfiles('a1')).resolves.toEqual([]);
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('returns [] without calling Gemini when the artist already has every curated platform', async () => {
        const { artistQ, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue({
            id: 'a1', name: 'Pete Rango', spotify: 's1', deezer: 'd1', instagram: 'i1', tiktok: 't1',
            x: 'x1', youtube: 'y1', soundcloud: 'sc1', bandcamp: 'b1', twitch: 'tw1', facebook: 'f1',
        });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
        expect(mockGenerate).not.toHaveBeenCalled();
        expect(musicPlatformData.getArtist).not.toHaveBeenCalled(); // short-circuited before enrichment too
    });

    it('resolves the real artist name via musicPlatformData.getArtist (the bare-Deezer-ID case) and uses it to search', async () => {
        const { artistQ, extractArtistId, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: null, deezer: '94933462' });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT); // name: "Pete Rango"
        mockGenerate.mockResolvedValue({ text: '[]' });
        extractArtistId.mockResolvedValue(null);

        await discoverArtistProfiles('a1');
        expect(mockGenerate).toHaveBeenCalledTimes(1); // "[]" parses as a valid empty array — no retry
        const call = mockGenerate.mock.calls[0][0];
        expect(call.contents).toContain('Pete Rango');
    });

    it('returns [] without calling Gemini when neither artist.name nor enrichment resolves a name', async () => {
        const { artistQ, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: null, deezer: '94933462' });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(null);

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('drops a candidate whose URL fails extractArtistId (gate a)', async () => {
        const { artistQ, extractArtistId, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({
            text: '[{"platform":"X","url":"https://x.com/not-a-real-profile","reasoning":"guess"}]',
        });
        extractArtistId.mockResolvedValue(null); // couldn't parse a username/handle

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
    });

    it('drops a candidate that resolves to a platform the artist already has (gate b)', async () => {
        const { artistQ, extractArtistId, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue({ ...BASE_ARTIST, instagram: 'already-linked' });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({
            text: '[{"platform":"Instagram","url":"https://instagram.com/petewrango","reasoning":"looks right"}]',
        });
        extractArtistId.mockResolvedValue({ siteName: 'instagram', cardPlatformName: 'Instagram', id: 'petewrango' });

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
    });

    it('drops a candidate that resolves to a platform outside the curated/writable set (e.g. youtubechannel)', async () => {
        const { artistQ, extractArtistId, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({
            text: '[{"platform":"YouTube","url":"https://youtube.com/channel/UCabc123","reasoning":"channel page"}]',
        });
        extractArtistId.mockResolvedValue({ siteName: 'youtubechannel', cardPlatformName: 'YouTube', id: 'UCabc123' });

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
    });

    it('dedupes by siteName, keeping the first/highest-confidence hit (gate c)', async () => {
        const { artistQ, extractArtistId, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({
            text: '[{"url":"https://tiktok.com/@peterango","reasoning":"first"},{"url":"https://www.tiktok.com/@pete.rango","reasoning":"second"}]',
        });
        extractArtistId.mockImplementation(async (url: string) => {
            if (url.includes('@peterango')) return { siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'peterango' };
            if (url.includes('@pete.rango')) return { siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'pete.rango' };
            return null;
        });

        const result = await discoverArtistProfiles('a1');
        expect(result).toHaveLength(1);
        expect(result[0].value).toBe('peterango');
        expect(result[0].reasoning).toBe('first');
    });

    it('drops a candidate on a platform that reliably serves OG data (spotify) when the preview has no image (gate d)', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({
            text: '[{"url":"https://open.spotify.com/artist/fake123","reasoning":"maybe"}]',
        });
        extractArtistId.mockResolvedValue({ siteName: 'spotify', cardPlatformName: 'Spotify', id: 'fake123' });
        fetchLinkPreview.mockResolvedValue({ imageUrl: null, title: null });

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
    });

    it('keeps a candidate on a platform known NOT to serve OG data (x) even with no preview image', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({
            text: '[{"url":"https://x.com/peterango","reasoning":"matches bio"}]',
        });
        extractArtistId.mockResolvedValue({ siteName: 'x', cardPlatformName: 'X', id: 'peterango' });
        fetchLinkPreview.mockResolvedValue({ imageUrl: null, title: null });

        const result = await discoverArtistProfiles('a1');
        expect(result).toHaveLength(1);
        expect(result[0].siteName).toBe('x');
        expect(result[0].previewImage).toBeNull();
    });

    it('enriches a surviving candidate with urlmap presentation metadata (displayName/logoUrl/colorHex) exactly like buildProfilesPayload', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({
            text: '[{"url":"https://instagram.com/peterango","reasoning":"matches"}]',
        });
        extractArtistId.mockResolvedValue({ siteName: 'instagram', cardPlatformName: 'Instagram', id: 'peterango' });
        fetchLinkPreview.mockResolvedValue({ imageUrl: 'https://cdn/preview.jpg', title: 'Pete Rango' });

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([{
            siteName: 'instagram',
            displayName: 'Instagram',
            value: 'peterango',
            profileUrl: 'https://instagram.com/peterango',
            logoUrl: 'https://cdn/instagram.png',
            colorHex: '#E1306C',
            previewImage: 'https://cdn/preview.jpg',
            reasoning: 'matches',
        }]);
    });

    it('normalizes the urlmap placeholder color (#000000) to null, same as buildProfilesPayload', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS); // tiktok row has colorHex: '#000000'
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({ text: '[{"url":"https://tiktok.com/@peterango","reasoning":"x"}]' });
        extractArtistId.mockResolvedValue({ siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'peterango' });
        fetchLinkPreview.mockResolvedValue({ imageUrl: null, title: null });

        const result = await discoverArtistProfiles('a1');
        expect(result[0].colorHex).toBeNull();
    });

    it('falls back to the original candidate URL as profileUrl when the urlmap-canonical URL does not round-trip through extractArtistId', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS); // x row: appStringFormat 'https://x.com/%@'
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        const originalUrl = 'https://twitter.com/peterango'; // Gemini found the legacy twitter.com domain
        mockGenerate.mockResolvedValue({ text: `[{"url":"${originalUrl}","reasoning":"legacy domain"}]` });
        extractArtistId.mockImplementation(async (url: string) => {
            if (url === originalUrl) return { siteName: 'x', cardPlatformName: 'X', id: 'peterango' };
            if (url === 'https://x.com/peterango') return { siteName: 'x', cardPlatformName: 'X', id: 'SOMETHING-ELSE' }; // simulated non-invertible regex
            return null;
        });
        fetchLinkPreview.mockResolvedValue({ imageUrl: null, title: null });

        const result = await discoverArtistProfiles('a1');
        expect(result).toHaveLength(1);
        expect(result[0].profileUrl).toBe(originalUrl); // NOT the urlmap-canonical 'https://x.com/peterango'
    });
});
