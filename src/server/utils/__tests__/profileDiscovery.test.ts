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
    const { discoverArtistProfiles, deriveNameSlugs, titleMatchesArtist, isProbeHit, stripHandleAndBoilerplate } = await import('../profileDiscovery');
    return {
        artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, spotifyProvider, deezerProvider, getArtistMappings,
        discoverArtistProfiles, deriveNameSlugs, titleMatchesArtist, isProbeHit, stripHandleAndBoilerplate,
    };
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

    // NOTE: this test used to run a Spotify match through TIER 2 (platform
    // search) and expect the OG gate to drop it. That's no longer correct —
    // tiers 1/2 are deterministic/DB-sourced and never hallucinate a URL, so
    // the OG gate (which exists specifically to catch a grounded MODEL
    // hallucinating a plausible-but-dead link) now only applies to tier 3.
    // Relocated here to keep exercising the SAME assertion (an OG-reliable
    // platform with no preview image gets dropped) against the tier it still
    // applies to — see the new tier-2-survives test right below for the
    // behavior change itself.
    it('drops a tier-3 (grounded-search) candidate on a platform that reliably serves OG data (instagram) when the preview has no image (gate e)', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockImplementation(async (args: { contents: string }) => (
            args.contents.includes('Instagram') ? { text: 'https://instagram.com/peterango' } : { text: 'NONE' }
        ));
        extractArtistId.mockResolvedValue({ siteName: 'instagram', cardPlatformName: 'Instagram', id: 'peterango' });
        fetchLinkPreview.mockResolvedValue({ imageUrl: null, title: null });

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
    });

    // Regression guard for the reported bug: a deterministic Spotify-API
    // exact-name match (tier 2) must NOT be discarded just because its
    // og:image preview didn't resolve (a Spotify oEmbed blip, a transient
    // fetch timeout, etc.) — the OG gate exists to catch model hallucination,
    // and a tier-2 platform-search hit was never a guess in the first place.
    it('keeps a tier-2 platform-search match (spotify) even when the preview has no og:image', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, spotifyProvider, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        spotifyProvider.searchArtists.mockResolvedValue([
            { platform: 'spotify', platformId: 'real123', name: 'Pete Rango', imageUrl: null, followerCount: 10, albumCount: 1, genres: [], profileUrl: 'https://open.spotify.com/artist/real123', topTrackName: null },
        ]);
        extractArtistId.mockResolvedValue({ siteName: 'spotify', cardPlatformName: 'Spotify', id: 'real123' });
        fetchLinkPreview.mockResolvedValue({ imageUrl: null, title: null }); // no og:image — must not disqualify a tier-2 hit
        mockGenerate.mockResolvedValue({ text: 'NONE' });

        const result = await discoverArtistProfiles('a1');
        expect(result.find(r => r.siteName === 'spotify')).toMatchObject({ siteName: 'spotify', value: 'real123', previewImage: null });
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
        // NOTE: this candidate is now resolved by tier-3 handle PROBING, not
        // Gemini (tier 4) — the name-derived slug "peterango" probes clean on
        // instagram before Gemini is ever consulted, so `reasoning` below is
        // probe-authored, not the (unused) Gemini "matches" string. Keyed to
        // one exact URL so exactly one probe hits, deterministically (every
        // other probed URL — other derived slugs, other platforms — misses).
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        mockGenerate.mockResolvedValue({ text: 'NONE' }); // tier 4 never needs to contribute anything here
        extractArtistId.mockImplementation(async (url: string) =>
            url === 'https://instagram.com/peterango' ? { siteName: 'instagram', cardPlatformName: 'Instagram', id: 'peterango' } : null,
        );
        fetchLinkPreview.mockImplementation(async (url: string) =>
            url === 'https://instagram.com/peterango'
                ? { imageUrl: 'https://cdn/preview.jpg', title: 'Pete Rango' }
                : { imageUrl: null, title: null },
        );

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([{
            siteName: 'instagram',
            displayName: 'Instagram',
            value: 'peterango',
            profileUrl: 'https://instagram.com/peterango',
            logoUrl: 'https://cdn/instagram.png',
            colorHex: '#E1306C',
            previewImage: 'https://cdn/preview.jpg',
            reasoning: 'Handle probe: og:title matched "Pete Rango" for @peterango (derived from artist name)',
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
        // Probing now runs BEFORE Gemini and resolves most/all platforms for
        // a well-behaved artist, so a call-count assertion against Gemini
        // must not leave that outcome to chance. Force every tier-3 probe to
        // miss (no title, no image at all — a miss under ANY handle-confirmed
        // vs -derived nuance) so this test isolates tier-4 (Gemini) behavior
        // specifically: Gemini's answer uses a handle ("petemusicofficial")
        // no probe would ever try, so the two tiers can't collide.
        it('runs one call per remaining platform in parallel and tolerates individual failures, once tier-3 probing has fully missed', async () => {
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST); // deezer only — every social platform missing
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockImplementation(async (url: string) =>
                url === 'https://instagram.com/petemusicofficial'
                    ? { imageUrl: 'https://cdn/preview.jpg', title: null } // instagram is OG-reliable (gate e)
                    : { imageUrl: null, title: null }, // every tier-3 probe URL — guaranteed miss
            );
            extractArtistId.mockImplementation(async (url: string) => {
                if (url.includes('instagram.com/petemusicofficial')) return { siteName: 'instagram', cardPlatformName: 'Instagram', id: 'petemusicofficial' };
                if (url.includes('youtube.com/@peterango')) return { siteName: 'youtube', cardPlatformName: 'YouTube', id: 'peterango' };
                return null;
            });
            mockGenerate.mockImplementation(async (args: { contents: string }) => {
                if (args.contents.includes('Instagram')) return { text: 'https://instagram.com/petemusicofficial' };
                if (args.contents.includes('YouTube')) throw new Error('network blip');
                if (args.contents.includes('X ')) return { text: 'not json, not a url, not NONE either' };
                return { text: 'NONE' };
            });

            const result = await discoverArtistProfiles('a1');

            expect(mockGenerate).toHaveBeenCalledTimes(TIER3_PLATFORMS.length); // one call per platform, run in parallel — tier 3 probing confirmed nothing
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

    // --- Tier 3 (NEW) — deterministic handle probing ----------------------
    // Replaces the old per-platform Gemini search (still exercised above,
    // now as the tier-4 last resort). No Gemini/network mocking needed for
    // the pure-function tests; the end-to-end ones drive the whole cascade
    // through the public `discoverArtistProfiles`, same as every test above.

    describe('deriveNameSlugs', () => {
        it('derives concatenated, hyphenated, dot- and underscore-joined variants for a two-word name', async () => {
            const { deriveNameSlugs } = await setup();
            expect(deriveNameSlugs('Pete Rango')).toEqual(['peterango', 'pete-rango', 'pete.rango', 'pete_rango']);
        });

        it('derives just a plain slug for a single-word name (no hyphen/dot/underscore variants to make)', async () => {
            const { deriveNameSlugs } = await setup();
            expect(deriveNameSlugs('Cher')).toEqual(['cher']);
        });

        it('never combinatorially explodes for a many-word name — capped, not one slug per permutation', async () => {
            const { deriveNameSlugs } = await setup();
            const slugs = deriveNameSlugs('The Long Winded Artist Name Here');
            expect(slugs.length).toBeLessThanOrEqual(4);
            expect(slugs).toEqual(['thelongwindedartistnamehere', 'the-long-winded-artist-name-here']);
        });

        it('is case- and punctuation-insensitive and dedupes identical slugs', async () => {
            const { deriveNameSlugs } = await setup();
            expect(deriveNameSlugs("Pete Rango!")).toEqual(['peterango', 'pete-rango', 'pete.rango', 'pete_rango']);
        });
    });

    describe('isProbeHit / titleMatchesArtist', () => {
        it('is a hit when the og:title plausibly matches the artist name (loose containment, taglines included)', async () => {
            const { isProbeHit } = await setup();
            expect(isProbeHit({ imageUrl: null, title: 'Pete Rango (@p3t3rango) • Instagram photos and videos' }, 'Pete Rango')).toBe(true);
        });

        it('is a MISS when the og:title clearly belongs to a different person, even with an image present', async () => {
            const { isProbeHit } = await setup();
            expect(isProbeHit({ imageUrl: 'https://cdn/some-image.jpg', title: 'DJ Someone Else' }, 'Pete Rango')).toBe(false);
        });

        it('trusts an og:image alone when no title came back to cross-check against', async () => {
            const { isProbeHit } = await setup();
            expect(isProbeHit({ imageUrl: 'https://cdn/pic.jpg', title: null }, 'Pete Rango')).toBe(true);
        });

        it('is a miss when the probe returns neither an image nor a title', async () => {
            const { isProbeHit } = await setup();
            expect(isProbeHit({ imageUrl: null, title: null }, 'Pete Rango')).toBe(false);
        });
    });

    // Regression coverage for the reported false-positive: a naive "does the
    // title contain the handle" check passes on nearly every profile page,
    // including a stranger's, because platforms echo the handle back into
    // the title. `stripHandleAndBoilerplate` removes the handle-echo AND
    // platform boilerplate so the name cross-check runs against real
    // evidence only.
    describe('stripHandleAndBoilerplate', () => {
        it('strips a bare handle followed by platform boilerplate down to nothing', async () => {
            const { stripHandleAndBoilerplate } = await setup();
            expect(stripHandleAndBoilerplate('peterango - Twitch', 'peterango')).toBe('');
        });

        it('strips a parenthesised @handle and Instagram boilerplate, leaving the real (wrong) name', async () => {
            const { stripHandleAndBoilerplate } = await setup();
            expect(stripHandleAndBoilerplate(
                'Peter Lyrøholm (@peterango) • Instagram photos and videos', 'peterango',
            )).toBe('Peter Lyrøholm');
        });

        it('leaves a genuine name untouched when the handle is not literally echoed (space-separated)', async () => {
            const { stripHandleAndBoilerplate } = await setup();
            expect(stripHandleAndBoilerplate('Pete Rango', 'peterango')).toBe('Pete Rango');
        });

        it('strips "| Facebook" boilerplate', async () => {
            const { stripHandleAndBoilerplate } = await setup();
            expect(stripHandleAndBoilerplate('Pete Rango | Facebook', 'peterango')).toBe('Pete Rango');
        });
    });

    // Live-verified acceptance cases (see the handle-probing report): the
    // exact five real URLs hand-verified for artist "Pete Rango" / handle
    // "peterango", each exercised end-to-end through `discoverArtistProfiles`
    // against the platform it was actually reported on, so the ACTUAL
    // decision `runHandleProbe` makes is what's under test. `URLMAP_ROWS`
    // carries no bandcamp/soundcloud/twitch rows (see its definition above),
    // so those three are added locally here — bandcamp's shape matches the
    // real `urlmap.app_string_format` value verified live (`https://%@.bandcamp.com`,
    // the correct subdomain form, not `bandcamp.com/<handle>`).
    describe('tier 3 — handle probing, real-world false-positive fixture', () => {
        const EXTRA_URLMAP_ROWS = [
            ...URLMAP_ROWS,
            { siteName: 'twitch', cardPlatformName: 'Twitch', siteImage: null, colorHex: '#6441A5', appStringFormat: 'https://www.twitch.tv/%@' },
            { siteName: 'soundcloud', cardPlatformName: 'SoundCloud', siteImage: null, colorHex: '#FF5500', appStringFormat: 'https://www.soundcloud.com/%@' },
            { siteName: 'bandcamp', cardPlatformName: 'Bandcamp', siteImage: null, colorHex: '#629AA9', appStringFormat: 'https://%@.bandcamp.com' },
        ];

        async function probeOneOf(scenario: { platform: string; url: string; title: string | null; image: string | null }) {
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST); // deezer only, name "Pete Rango" — every derived slug is UNCONFIRMED
            artistQ.getAllLinks.mockResolvedValue(EXTRA_URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockImplementation(async (u: string) =>
                u === scenario.url ? { imageUrl: scenario.image, title: scenario.title } : { imageUrl: null, title: null },
            );
            extractArtistId.mockImplementation(async (u: string) =>
                u === scenario.url ? { siteName: scenario.platform, cardPlatformName: scenario.platform, id: 'peterango' } : null,
            );
            mockGenerate.mockResolvedValue({ text: 'NONE' });
            return discoverArtistProfiles('a1');
        }

        it('instagram.com/peterango — title belongs to a different person ("Peter Lyrøholm") — MISS', async () => {
            const result = await probeOneOf({
                platform: 'instagram',
                url: 'https://instagram.com/peterango',
                title: 'Peter Lyrøholm (@peterango) • Instagram photos and videos',
                image: null,
            });
            expect(result).toEqual([]);
        });

        it('twitch.tv/peterango — og:title is only the handle + boilerplate, even WITH an image present — MISS', async () => {
            const result = await probeOneOf({
                platform: 'twitch',
                url: 'https://www.twitch.tv/peterango',
                title: 'peterango - Twitch',
                image: 'https://cdn/some-image.jpg', // image present must not rescue a derived slug with no name evidence
            });
            expect(result).toEqual([]);
        });

        it('peterango.bandcamp.com — no og:title at all, derived (unconfirmed) handle — MISS even with an image', async () => {
            const result = await probeOneOf({
                platform: 'bandcamp',
                url: 'https://peterango.bandcamp.com', // real Bandcamp URL shape: <handle>.bandcamp.com
                title: null,
                image: 'https://cdn/some-image.jpg',
            });
            expect(result).toEqual([]);
        });

        it('soundcloud.com/peterango — og:title is exactly the artist name — HIT', async () => {
            const result = await probeOneOf({
                platform: 'soundcloud',
                url: 'https://www.soundcloud.com/peterango',
                title: 'Pete Rango',
                image: null,
            });
            expect(result).toHaveLength(1);
            expect(result[0].siteName).toBe('soundcloud');
        });

        it('youtube.com/@peterango — og:title is exactly the artist name — HIT', async () => {
            const result = await probeOneOf({
                platform: 'youtube',
                url: 'https://youtube.com/@peterango',
                title: 'Pete Rango',
                image: null,
            });
            expect(result).toHaveLength(1);
            expect(result[0].siteName).toBe('youtube');
        });
    });

    describe('tier 3 — handle probing (end-to-end via discoverArtistProfiles)', () => {
        it('confirms a candidate when a probe returns an og:title matching the artist name', async () => {
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST); // deezer only, name "Pete Rango"
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockImplementation(async (url: string) =>
                url === 'https://youtube.com/@peterango'
                    ? { imageUrl: null, title: 'Pete Rango - Topic' }
                    : { imageUrl: null, title: null },
            );
            extractArtistId.mockImplementation(async (url: string) =>
                url === 'https://youtube.com/@peterango' ? { siteName: 'youtube', cardPlatformName: 'YouTube', id: 'peterango' } : null,
            );
            mockGenerate.mockResolvedValue({ text: 'NONE' }); // tier-4 last resort finds nothing extra

            const result = await discoverArtistProfiles('a1');
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ siteName: 'youtube', value: 'peterango' });
        });

        it('does not confirm a candidate when the probe title clearly belongs to a different person', async () => {
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockImplementation(async (url: string) =>
                url === 'https://youtube.com/@peterango'
                    ? { imageUrl: 'https://cdn/pic.jpg', title: 'DJ Someone Else - Official Channel' }
                    : { imageUrl: null, title: null },
            );
            extractArtistId.mockResolvedValue(null);
            mockGenerate.mockResolvedValue({ text: 'NONE' });

            const result = await discoverArtistProfiles('a1');
            expect(result).toEqual([]);
        });

        it('propagates a handle confirmed on one platform to other missing platforms it reuses the same handle on', async () => {
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
            // The artist's real handle ("p3t3rango") isn't derivable from the
            // name via slugification — it can ONLY enter the candidate set via
            // an existing handle-shaped link (twitch, already confirmed) — so
            // any OTHER platform confirmed here proves the handle propagated.
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', deezer: '94933462', twitch: 'p3t3rango' });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockImplementation(async (url: string) =>
                url.includes('p3t3rango') ? { imageUrl: 'https://cdn/real-pic.jpg', title: null } : { imageUrl: null, title: null },
            );
            extractArtistId.mockImplementation(async (url: string) => {
                if (url === 'https://instagram.com/p3t3rango') return { siteName: 'instagram', cardPlatformName: 'Instagram', id: 'p3t3rango' };
                if (url === 'https://facebook.com/p3t3rango') return { siteName: 'facebook', cardPlatformName: 'Facebook', id: 'p3t3rango' };
                return null;
            });
            mockGenerate.mockResolvedValue({ text: 'NONE' });

            const result = await discoverArtistProfiles('a1');
            expect(result.map(r => r.siteName).sort()).toEqual(['facebook', 'instagram']);
            expect(result.every(r => r.value === 'p3t3rango')).toBe(true);
        });

        it('never probes X — a platform known to block server-side OG scraping — so a miss there can never produce a false "found"', async () => {
            const { artistQ, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            mockGenerate.mockResolvedValue({ text: 'NONE' });

            await discoverArtistProfiles('a1');

            const probedUrls = fetchLinkPreview.mock.calls.map((call: unknown[]) => call[0]);
            expect(probedUrls.some((u: unknown) => typeof u === 'string' && u.includes('x.com'))).toBe(false);
        });

        it('never throws and still resolves to [] when every probe attempt rejects outright', async () => {
            const { artistQ, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockRejectedValue(new Error('network down'));
            mockGenerate.mockRejectedValue(new Error('gemini also down'));

            await expect(discoverArtistProfiles('a1')).resolves.toEqual([]);
        });
    });
});
