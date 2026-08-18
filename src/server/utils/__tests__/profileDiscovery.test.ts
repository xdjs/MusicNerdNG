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

// Tier 2 needs direct access to the provider instances (musicPlatformData's
// own searchArtists always uses the primary/Deezer provider — see
// artistMusicPlatformDataProvider.ts — so tier 2 must reach spotifyProvider/
// deezerProvider directly to search a SPECIFIC platform). Both default to an
// empty result so any test that doesn't care about tier 2 gets a clean "no
// candidate" instead of an uncaught-by-design TypeError.
jest.mock('@/server/utils/musicPlatform', () => ({
    musicPlatformData: { getArtist: jest.fn() },
    spotifyProvider: { searchArtists: jest.fn().mockResolvedValue([]) },
    deezerProvider: { searchArtists: jest.fn().mockResolvedValue([]) },
}));

// Tier 1 reads cross-platform ID mappings via idMappingService.getArtistMappings.
// Defaults to no mappings so tests that don't care about tier 1 see a clean [].
jest.mock('@/server/utils/idMappingService', () => ({
    getArtistMappings: jest.fn().mockResolvedValue([]),
}));

const URLMAP_ROWS = [
    { siteName: 'spotify', cardPlatformName: 'Spotify', siteImage: 'https://cdn/spotify.png', colorHex: '#1DB954', appStringFormat: 'https://open.spotify.com/artist/%@' },
    { siteName: 'deezer', cardPlatformName: 'Deezer', siteImage: 'https://cdn/deezer.png', colorHex: '#FEAA2D', appStringFormat: 'https://www.deezer.com/artist/%@' },
    { siteName: 'instagram', cardPlatformName: 'Instagram', siteImage: 'https://cdn/instagram.png', colorHex: '#E1306C', appStringFormat: 'https://instagram.com/%@' },
    { siteName: 'tiktok', cardPlatformName: 'TikTok', siteImage: null, colorHex: '#000000', appStringFormat: 'https://tiktok.com/@%@' },
    { siteName: 'x', cardPlatformName: 'X', siteImage: null, colorHex: null, appStringFormat: 'https://x.com/%@' },
    { siteName: 'youtube', cardPlatformName: 'YouTube', siteImage: null, colorHex: '#FF0000', appStringFormat: 'https://youtube.com/@%@' },
    { siteName: 'facebook', cardPlatformName: 'Facebook', siteImage: null, colorHex: '#1877F2', appStringFormat: 'https://facebook.com/%@' },
];

// PROFILE_DISPLAY_COLUMNS minus spotify/deezer (those two always go through
// tier 2, win or lose — never tier 3). BASE_ARTIST below is missing all of
// these, so this is exactly the set of tier-3 calls a fully-missing artist
// triggers — used to size call-count assertions without hardcoding "8" bare.
const TIER3_PLATFORMS = ['instagram', 'tiktok', 'x', 'youtube', 'soundcloud', 'bandcamp', 'twitch', 'facebook'];

const BASE_ARTIST = { id: 'a1', name: 'Pete Rango', deezer: '94933462' };
const ENRICHMENT = {
    platform: 'deezer', platformId: '94933462', name: 'Pete Rango', imageUrl: null,
    followerCount: 6, albumCount: 14, genres: [], profileUrl: 'https://deezer.com/artist/94933462', topTrackName: null,
};

async function setup() {
    const artistQ = await import('@/server/utils/queries/artistQueries');
    const { extractArtistId } = await import('@/server/utils/services');
    const { fetchLinkPreview } = await import('@/server/utils/linkPreview');
    const { musicPlatformData, spotifyProvider, deezerProvider } = await import('@/server/utils/musicPlatform');
    const { getArtistMappings } = await import('@/server/utils/idMappingService');
    const { discoverArtistProfiles } = await import('../profileDiscovery');
    return { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, spotifyProvider, deezerProvider, getArtistMappings, discoverArtistProfiles };
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

    it('tier 3 makes one call PER remaining platform (no combined multi-platform call, no retry) and gives up cleanly on an unparseable response', async () => {
        const { artistQ, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({ text: 'not json at all' });

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
        // One single-platform attempt per tier-3 target, not one shared retry-once budget.
        expect(mockGenerate).toHaveBeenCalledTimes(TIER3_PLATFORMS.length);
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

    it('resolves the real artist name via musicPlatformData.getArtist (the bare-Deezer-ID case) and uses it in every tier-3 prompt', async () => {
        const { artistQ, extractArtistId, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: null, deezer: '94933462' });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT); // name: "Pete Rango"
        mockGenerate.mockResolvedValue({ text: 'NONE' });
        extractArtistId.mockResolvedValue(null);

        await discoverArtistProfiles('a1');
        expect(mockGenerate).toHaveBeenCalledTimes(TIER3_PLATFORMS.length); // one attempt per platform, no retry
        for (const call of mockGenerate.mock.calls) {
            expect(call[0].contents).toContain('Pete Rango');
        }
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
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, spotifyProvider, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        // Spotify is missing here, so tier 2 (not Gemini) is what's under test —
        // a search hit still has to clear the OG gate like any other candidate.
        spotifyProvider.searchArtists.mockResolvedValue([
            { platform: 'spotify', platformId: 'fake123', name: 'Pete Rango', imageUrl: null, followerCount: 10, albumCount: 1, genres: [], profileUrl: 'https://open.spotify.com/artist/fake123', topTrackName: null },
        ]);
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

    // --- Tier 1 — artist_id_mappings -----------------------------------

    describe('tier 1 — id mappings', () => {
        it('turns a high-confidence deezer mapping into a candidate without ever calling Gemini or a platform search', async () => {
            const { artistQ, extractArtistId, musicPlatformData, getArtistMappings, discoverArtistProfiles } = await setup();
            // Missing ONLY deezer — every other column already set, so tier 1
            // alone satisfies everything and tiers 2/3 never engage.
            artistQ.getArtistById.mockResolvedValue({
                id: 'a1', name: 'Pete Rango', spotify: 's1', instagram: 'i1', tiktok: 't1',
                x: 'x1', youtube: 'y1', soundcloud: 'sc1', bandcamp: 'b1', twitch: 'tw1', facebook: 'f1',
            });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            getArtistMappings.mockResolvedValue([
                { platform: 'deezer', platformId: '94933462', confidence: 'high', source: 'wikidata', reasoning: null },
            ]);
            extractArtistId.mockResolvedValue({ siteName: 'deezer', cardPlatformName: 'Deezer', id: '94933462' });

            const result = await discoverArtistProfiles('a1');

            expect(result).toEqual([{
                siteName: 'deezer',
                displayName: 'Deezer',
                value: '94933462',
                profileUrl: 'https://www.deezer.com/artist/94933462',
                logoUrl: 'https://cdn/deezer.png',
                colorHex: '#FEAA2D',
                previewImage: null,
                reasoning: 'Cross-platform ID mapping (high confidence, source: wikidata)',
            }]);
            // deezer was fully satisfied by tier 1 and every other column is
            // already present — nothing left for tier 2/3 to do.
            expect(musicPlatformData.getArtist).not.toHaveBeenCalled();
            expect(mockGenerate).not.toHaveBeenCalled();
        });

        it('skips a low-confidence mapping row', async () => {
            const { artistQ, musicPlatformData, getArtistMappings, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: 's1' });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            getArtistMappings.mockResolvedValue([
                { platform: 'deezer', platformId: '94933462', confidence: 'low', source: 'name_search', reasoning: null },
            ]);
            musicPlatformData.getArtist.mockResolvedValue({ ...ENRICHMENT, platform: 'spotify' });
            mockGenerate.mockResolvedValue({ text: 'NONE' });

            const result = await discoverArtistProfiles('a1');
            // The low-confidence deezer mapping must not appear as a candidate.
            expect(result.find(r => r.siteName === 'deezer')).toBeUndefined();
        });

        it('keeps a manual-confidence mapping (highest authority, human entered)', async () => {
            const { artistQ, extractArtistId, getArtistMappings, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue({
                id: 'a1', name: 'Pete Rango', spotify: 's1', instagram: 'i1', tiktok: 't1',
                x: 'x1', youtube: 'y1', soundcloud: 'sc1', bandcamp: 'b1', twitch: 'tw1', facebook: 'f1',
            });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            getArtistMappings.mockResolvedValue([
                { platform: 'deezer', platformId: '94933462', confidence: 'manual', source: 'manual', reasoning: null },
            ]);
            extractArtistId.mockResolvedValue({ siteName: 'deezer', cardPlatformName: 'Deezer', id: '94933462' });

            const result = await discoverArtistProfiles('a1');
            expect(result).toHaveLength(1);
            expect(result[0].siteName).toBe('deezer');
        });
    });

    // --- Tier 2 — platform search APIs -----------------------------------

    describe('tier 2 — platform search', () => {
        it('picks an exact case-insensitive name match found via Spotify search', async () => {
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, spotifyProvider, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: null, deezer: '94933462' });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT); // resolved name: "Pete Rango"
            spotifyProvider.searchArtists.mockResolvedValue([
                { platform: 'spotify', platformId: 'wrong1', name: 'Pete Rango Tribute', imageUrl: null, followerCount: 3, albumCount: 0, genres: [], profileUrl: 'https://open.spotify.com/artist/wrong1', topTrackName: null },
                { platform: 'spotify', platformId: 'right1', name: '  pete rango  ', imageUrl: null, followerCount: 500, albumCount: 2, genres: [], profileUrl: 'https://open.spotify.com/artist/right1', topTrackName: null },
            ]);
            extractArtistId.mockResolvedValue({ siteName: 'spotify', cardPlatformName: 'Spotify', id: 'right1' });
            fetchLinkPreview.mockResolvedValue({ imageUrl: 'https://cdn/preview.jpg', title: null }); // spotify is OG-reliable (gate d)
            mockGenerate.mockResolvedValue({ text: 'NONE' });

            const result = await discoverArtistProfiles('a1');
            expect(result.find(r => r.siteName === 'spotify')).toMatchObject({ siteName: 'spotify', value: 'right1' });
            // Never asked Gemini about spotify — tier 3 excludes spotify/deezer entirely.
            for (const call of mockGenerate.mock.calls) {
                expect(call[0].contents).not.toMatch(/Spotify/);
            }
        });

        it('rejects a clearly-different name and proposes nothing for that platform', async () => {
            const { artistQ, musicPlatformData, spotifyProvider, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: null, deezer: '94933462' });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT); // "Pete Rango"
            spotifyProvider.searchArtists.mockResolvedValue([
                { platform: 'spotify', platformId: 'wrong1', name: 'DJ Someone Else', imageUrl: null, followerCount: 100000, albumCount: 5, genres: [], profileUrl: 'https://open.spotify.com/artist/wrong1', topTrackName: null },
            ]);
            mockGenerate.mockResolvedValue({ text: 'NONE' });

            const result = await discoverArtistProfiles('a1');
            expect(result.find(r => r.siteName === 'spotify')).toBeUndefined();
        });

        it('treats a tied top result as ambiguous and proposes nothing', async () => {
            const { artistQ, musicPlatformData, spotifyProvider, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: null, deezer: '94933462' });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            spotifyProvider.searchArtists.mockResolvedValue([
                { platform: 'spotify', platformId: 'a', name: 'Pete Rango', imageUrl: null, followerCount: 50, albumCount: 1, genres: [], profileUrl: 'https://open.spotify.com/artist/a', topTrackName: null },
                { platform: 'spotify', platformId: 'b', name: 'Pete Rango', imageUrl: null, followerCount: 50, albumCount: 1, genres: [], profileUrl: 'https://open.spotify.com/artist/b', topTrackName: null },
            ]);
            mockGenerate.mockResolvedValue({ text: 'NONE' });

            const result = await discoverArtistProfiles('a1');
            expect(result.find(r => r.siteName === 'spotify')).toBeUndefined();
        });
    });

    // --- Tier 3 — per-platform grounded search, parallel, fault-tolerant --

    describe('tier 3 — per-platform grounded search', () => {
        it('runs one call per remaining platform in parallel and tolerates individual failures', async () => {
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST); // deezer only — every social platform missing
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockResolvedValue({ imageUrl: 'https://cdn/preview.jpg', title: null }); // instagram is OG-reliable (gate d)
            extractArtistId.mockImplementation(async (url: string) => {
                if (url.includes('instagram.com/peterango')) return { siteName: 'instagram', cardPlatformName: 'Instagram', id: 'peterango' };
                if (url.includes('youtube.com/@peterango')) return { siteName: 'youtube', cardPlatformName: 'YouTube', id: 'peterango' };
                return null;
            });
            mockGenerate.mockImplementation(async (args: { contents: string }) => {
                if (args.contents.includes('Instagram')) return { text: 'https://instagram.com/peterango' };
                if (args.contents.includes('YouTube')) throw new Error('network blip');
                if (args.contents.includes('X ')) return { text: 'not json, not a url, not NONE either' };
                return { text: 'NONE' };
            });

            const result = await discoverArtistProfiles('a1');

            expect(mockGenerate).toHaveBeenCalledTimes(TIER3_PLATFORMS.length); // one call per platform, run in parallel
            expect(result.map(r => r.siteName).sort()).toEqual(['instagram']);
            // The failing/malformed platforms degraded to "no candidate", not a thrown error.
        });

        it('rejects a response that resolves to a DIFFERENT platform than the one it was asked about', async () => {
            const { artistQ, extractArtistId, musicPlatformData, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            // Every call "helpfully" returns a TikTok URL regardless of which platform was asked about.
            mockGenerate.mockResolvedValue({ text: 'https://tiktok.com/@peterango' });
            extractArtistId.mockImplementation(async (url: string) =>
                url.includes('tiktok.com') ? { siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'peterango' } : null,
            );

            const result = await discoverArtistProfiles('a1');
            // Only the call that was actually asked about tiktok may keep its answer.
            expect(result).toHaveLength(1);
            expect(result[0].siteName).toBe('tiktok');
        });
    });

    // --- Cross-tier sequencing --------------------------------------------

    it('does not re-search a platform in a later tier once an earlier tier already proposed it', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, spotifyProvider, getArtistMappings, discoverArtistProfiles } = await setup();
        // Missing deezer (tier 1 satisfies it) and spotify (tier 2 satisfies it).
        artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango' });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        getArtistMappings.mockResolvedValue([
            { platform: 'deezer', platformId: '94933462', confidence: 'high', source: 'wikidata', reasoning: null },
        ]);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        fetchLinkPreview.mockResolvedValue({ imageUrl: 'https://cdn/preview.jpg', title: null }); // spotify is OG-reliable (gate d)
        spotifyProvider.searchArtists.mockResolvedValue([
            { platform: 'spotify', platformId: 'spot1', name: 'Pete Rango', imageUrl: null, followerCount: 10, albumCount: 1, genres: [], profileUrl: 'https://open.spotify.com/artist/spot1', topTrackName: null },
        ]);
        extractArtistId.mockImplementation(async (url: string) => {
            if (url.includes('deezer.com')) return { siteName: 'deezer', cardPlatformName: 'Deezer', id: '94933462' };
            if (url.includes('spotify.com')) return { siteName: 'spotify', cardPlatformName: 'Spotify', id: 'spot1' };
            return null;
        });
        mockGenerate.mockResolvedValue({ text: 'NONE' });

        const result = await discoverArtistProfiles('a1');

        expect(result.map(r => r.siteName).sort()).toEqual(['deezer', 'spotify']);
        // Tier 3 never asks about spotify or deezer (no search API platforms are never tier-3 targets),
        // and having already been satisfied by tiers 1/2 they aren't re-proposed by tier 3 either.
        for (const call of mockGenerate.mock.calls) {
            expect(call[0].contents).not.toMatch(/Spotify|Deezer/);
        }
    });

    it('total failure across every tier (DB throws, providers throw, Gemini throws) still resolves to [] without throwing', async () => {
        const { artistQ, musicPlatformData, spotifyProvider, deezerProvider, getArtistMappings, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockRejectedValue(new Error('urlmap down'));
        getArtistMappings.mockRejectedValue(new Error('mappings table down'));
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        spotifyProvider.searchArtists.mockRejectedValue(new Error('spotify down'));
        deezerProvider.searchArtists.mockRejectedValue(new Error('deezer down'));
        mockGenerate.mockRejectedValue(new Error('gemini down'));

        await expect(discoverArtistProfiles('a1')).resolves.toEqual([]);
    });
});
