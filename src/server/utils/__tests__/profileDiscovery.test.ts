// @ts-nocheck
import { jest } from '@jest/globals';

// Tier 4 — real web search (Tavily), replacing what used to be a per-platform
// Gemini call. Defaults to "no results" so any test that doesn't care about
// tier 4 gets a clean miss for every remaining platform, same as the old
// `mockGenerate.mockResolvedValue({ text: 'NONE' })` filler used to provide.
jest.mock('@/server/utils/webSearch', () => ({
    webSearch: jest.fn().mockResolvedValue([]),
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
    const { webSearch } = await import('@/server/utils/webSearch');
    const { discoverArtistProfiles, deriveNameSlugs, titleMatchesArtist, isProbeHit, stripHandleAndBoilerplate } = await import('../profileDiscovery');
    return {
        artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, spotifyProvider, deezerProvider, getArtistMappings, webSearch,
        discoverArtistProfiles, deriveNameSlugs, titleMatchesArtist, isProbeHit, stripHandleAndBoilerplate,
    };
}

describe('discoverArtistProfiles', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('returns [] and never throws when the web search provider fails on every attempt', async () => {
        const { artistQ, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        webSearch.mockRejectedValue(new Error('Tavily is down'));

        await expect(discoverArtistProfiles('a1')).resolves.toEqual([]);
    });

    it('tier 4 makes one search PER remaining platform (no combined multi-platform call, no retry) and gives up cleanly when nothing comes back', async () => {
        const { artistQ, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        webSearch.mockResolvedValue([]);

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
        // One single-platform search per tier-4 target, not one shared retry-once budget.
        expect(webSearch).toHaveBeenCalledTimes(TIER3_PLATFORMS.length);
    });

    it('never throws and returns [] when getArtistById throws', async () => {
        const { artistQ, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockRejectedValue(new Error('db down'));
        await expect(discoverArtistProfiles('a1')).resolves.toEqual([]);
        expect(webSearch).not.toHaveBeenCalled();
    });

    it('returns [] without calling web search when the artist already has every curated platform', async () => {
        const { artistQ, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue({
            id: 'a1', name: 'Pete Rango', spotify: 's1', deezer: 'd1', instagram: 'i1', tiktok: 't1',
            x: 'x1', youtube: 'y1', soundcloud: 'sc1', bandcamp: 'b1', twitch: 'tw1', facebook: 'f1',
        });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
        expect(webSearch).not.toHaveBeenCalled();
        expect(musicPlatformData.getArtist).not.toHaveBeenCalled(); // short-circuited before enrichment too
    });

    it('resolves the real artist name via musicPlatformData.getArtist (the bare-Deezer-ID case) and uses it in every tier-4 search query', async () => {
        const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: null, deezer: '94933462' });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT); // name: "Pete Rango"
        webSearch.mockResolvedValue([]);
        extractArtistId.mockResolvedValue(null);

        await discoverArtistProfiles('a1');
        expect(webSearch).toHaveBeenCalledTimes(TIER3_PLATFORMS.length); // one search per platform, no retry
        for (const call of webSearch.mock.calls) {
            expect(call[0]).toContain('Pete Rango');
        }
    });

    it('returns [] without calling web search when neither artist.name nor enrichment resolves a name', async () => {
        const { artistQ, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: null, deezer: '94933462' });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(null);

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
        expect(webSearch).not.toHaveBeenCalled();
    });

    it('drops a candidate whose URL fails extractArtistId (gate a)', async () => {
        const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        webSearch.mockResolvedValue([
            { url: 'https://x.com/not-a-real-profile', title: 'Pete Rango', snippet: 'guess' },
        ]);
        extractArtistId.mockResolvedValue(null); // couldn't parse a username/handle — filtered before it's even a candidate

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
    });

    it('drops a candidate that resolves to a platform the artist already has (gate b)', async () => {
        const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue({ ...BASE_ARTIST, instagram: 'already-linked' });
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        webSearch.mockResolvedValue([
            { url: 'https://instagram.com/petewrango', title: 'Pete Rango', snippet: 'looks right' },
        ]);
        extractArtistId.mockResolvedValue({ siteName: 'instagram', cardPlatformName: 'Instagram', id: 'petewrango' });

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
    });

    it('drops a candidate that resolves to a platform outside the curated/writable set (e.g. youtubechannel)', async () => {
        const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        webSearch.mockResolvedValue([
            { url: 'https://youtube.com/channel/UCabc123', title: 'Pete Rango', snippet: 'channel page' },
        ]);
        // A youtube-domain search resolving to the "youtubechannel" siteName (not
        // "youtube") mismatches the platform this search was scoped to — filtered
        // by the same platform-match rule as an outright wrong-platform result.
        extractArtistId.mockResolvedValue({ siteName: 'youtubechannel', cardPlatformName: 'YouTube', id: 'UCabc123' });

        const result = await discoverArtistProfiles('a1');
        expect(result).toEqual([]);
    });

    it('keeps the first-ranked web search result when multiple results resolve to the same platform (gate c / rank-order selection)', async () => {
        const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        webSearch.mockResolvedValue([
            { url: 'https://tiktok.com/@peterango', title: 'Pete Rango (first)', snippet: '' },
            { url: 'https://www.tiktok.com/@pete.rango', title: 'Pete Rango (second)', snippet: '' },
        ]);
        extractArtistId.mockImplementation(async (url: string) => {
            if (url.includes('@peterango')) return { siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'peterango' };
            if (url.includes('@pete.rango')) return { siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'pete.rango' };
            return null;
        });

        const result = await discoverArtistProfiles('a1');
        expect(result).toHaveLength(1);
        expect(result[0].value).toBe('peterango');
        expect(result[0].reasoning).toContain('(first)'); // the second result was never even tried
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
    it('drops a tier-4 (web-search) candidate on a platform that reliably serves OG data (instagram) when the preview has no image (gate e)', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        webSearch.mockImplementation(async (_query: string, opts: { includeDomains?: string[] }) => (
            opts?.includeDomains?.[0] === 'instagram.com'
                ? [{ url: 'https://instagram.com/peterango', title: 'Pete Rango', snippet: '' }]
                : []
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

        const result = await discoverArtistProfiles('a1');
        expect(result.find(r => r.siteName === 'spotify')).toMatchObject({ siteName: 'spotify', value: 'real123', previewImage: null });
    });

    it('keeps a candidate on a platform known NOT to serve OG data (x) even with no preview image', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        webSearch.mockResolvedValue([
            { url: 'https://x.com/peterango', title: 'Pete Rango', snippet: 'matches bio' },
        ]);
        extractArtistId.mockResolvedValue({ siteName: 'x', cardPlatformName: 'X', id: 'peterango' });
        fetchLinkPreview.mockResolvedValue({ imageUrl: null, title: null });

        const result = await discoverArtistProfiles('a1');
        expect(result).toHaveLength(1);
        expect(result[0].siteName).toBe('x');
        expect(result[0].previewImage).toBeNull();
    });

    it('enriches a surviving candidate with urlmap presentation metadata (displayName/logoUrl/colorHex) exactly like buildProfilesPayload', async () => {
        // NOTE: this candidate is now resolved by tier-3 handle PROBING, not
        // tier-4 web search — the name-derived slug "peterango" probes clean
        // on instagram before a search is ever needed, so `reasoning` below
        // is probe-authored, not a web-search hit. Keyed to one exact URL so
        // exactly one probe hits, deterministically (every other probed URL
        // — other derived slugs, other platforms — misses).
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT); // tier 4 never needs to contribute anything here (default: [])
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
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS); // tiktok row has colorHex: '#000000'
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        webSearch.mockResolvedValue([
            { url: 'https://tiktok.com/@peterango', title: 'Pete Rango', snippet: 'x' },
        ]);
        extractArtistId.mockResolvedValue({ siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'peterango' });
        fetchLinkPreview.mockResolvedValue({ imageUrl: null, title: null });

        const result = await discoverArtistProfiles('a1');
        expect(result[0].colorHex).toBeNull();
    });

    it('falls back to the original candidate URL as profileUrl when the urlmap-canonical URL does not round-trip through extractArtistId', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS); // x row: appStringFormat 'https://x.com/%@'
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        const originalUrl = 'https://twitter.com/peterango'; // web search found the legacy twitter.com domain
        webSearch.mockResolvedValue([
            { url: originalUrl, title: 'Pete Rango', snippet: 'legacy domain' },
        ]);
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
        it('turns a high-confidence deezer mapping into a candidate without ever calling web search or a platform search', async () => {
            const { artistQ, extractArtistId, musicPlatformData, getArtistMappings, webSearch, discoverArtistProfiles } = await setup();
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
            // already present — nothing left for tier 2/3/4 to do.
            expect(musicPlatformData.getArtist).not.toHaveBeenCalled();
            expect(webSearch).not.toHaveBeenCalled();
        });

        it('skips a low-confidence mapping row', async () => {
            const { artistQ, musicPlatformData, getArtistMappings, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Pete Rango', spotify: 's1' });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            getArtistMappings.mockResolvedValue([
                { platform: 'deezer', platformId: '94933462', confidence: 'low', source: 'name_search', reasoning: null },
            ]);
            musicPlatformData.getArtist.mockResolvedValue({ ...ENRICHMENT, platform: 'spotify' });

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
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, spotifyProvider, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: null, deezer: '94933462' });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT); // resolved name: "Pete Rango"
            spotifyProvider.searchArtists.mockResolvedValue([
                { platform: 'spotify', platformId: 'wrong1', name: 'Pete Rango Tribute', imageUrl: null, followerCount: 3, albumCount: 0, genres: [], profileUrl: 'https://open.spotify.com/artist/wrong1', topTrackName: null },
                { platform: 'spotify', platformId: 'right1', name: '  pete rango  ', imageUrl: null, followerCount: 500, albumCount: 2, genres: [], profileUrl: 'https://open.spotify.com/artist/right1', topTrackName: null },
            ]);
            extractArtistId.mockResolvedValue({ siteName: 'spotify', cardPlatformName: 'Spotify', id: 'right1' });
            fetchLinkPreview.mockResolvedValue({ imageUrl: 'https://cdn/preview.jpg', title: null }); // spotify is OG-reliable (gate d)

            const result = await discoverArtistProfiles('a1');
            expect(result.find(r => r.siteName === 'spotify')).toMatchObject({ siteName: 'spotify', value: 'right1' });
            // Never searched the web for spotify — tier 4 excludes spotify/deezer entirely.
            for (const call of webSearch.mock.calls) {
                expect(call[0]).not.toMatch(/Spotify/i);
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

            const result = await discoverArtistProfiles('a1');
            expect(result.find(r => r.siteName === 'spotify')).toBeUndefined();
        });
    });

    // --- Tier 3 — per-platform grounded search, parallel, fault-tolerant --

    describe('tier 4 — per-platform web search', () => {
        // Probing now runs BEFORE web search and resolves most/all platforms
        // for a well-behaved artist, so a call-count assertion against
        // `webSearch` must not leave that outcome to chance. Force every
        // tier-3 probe to miss (no title, no image at all — a miss under ANY
        // handle-confirmed vs -derived nuance) so this test isolates tier-4
        // (web search) behavior specifically: the search hit uses a handle
        // ("peterangomusic") no probe would ever try, so the two tiers
        // can't collide.
        it('runs one search per remaining platform in parallel and tolerates individual failures, once tier-3 probing has fully missed', async () => {
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST); // deezer only — every social platform missing
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockImplementation(async (url: string) =>
                url === 'https://instagram.com/peterangomusic'
                    ? { imageUrl: 'https://cdn/preview.jpg', title: null } // instagram is OG-reliable (gate e)
                    : { imageUrl: null, title: null }, // every tier-3 probe URL — guaranteed miss
            );
            extractArtistId.mockImplementation(async (url: string) => {
                if (url.includes('instagram.com/peterangomusic')) return { siteName: 'instagram', cardPlatformName: 'Instagram', id: 'peterangomusic' };
                if (url.includes('youtube.com/@peterango')) return { siteName: 'youtube', cardPlatformName: 'YouTube', id: 'peterango' };
                return null;
            });
            webSearch.mockImplementation(async (_query: string, opts: { includeDomains?: string[] }) => {
                const domain = opts?.includeDomains?.[0];
                if (domain === 'instagram.com') return [{ url: 'https://instagram.com/peterangomusic', title: 'Pete Rango - Official', snippet: '' }];
                if (domain === 'youtube.com') throw new Error('network blip'); // simulated provider failure
                if (domain === 'x.com') return [{ url: 'not a real url at all', title: 'Pete Rango', snippet: '' }]; // malformed, filtered by the https check
                return [];
            });

            const result = await discoverArtistProfiles('a1');

            expect(webSearch).toHaveBeenCalledTimes(TIER3_PLATFORMS.length); // one search per platform, run in parallel — tier 3 probing confirmed nothing
            expect(result.map(r => r.siteName).sort()).toEqual(['instagram']);
            // The failing/malformed platforms degraded to "no candidate", not a thrown error.
        });

        it('rejects a search hit that resolves to a DIFFERENT platform than the one it was asked about', async () => {
            const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            // Every search "helpfully" returns a TikTok URL regardless of which platform was asked about.
            webSearch.mockResolvedValue([{ url: 'https://tiktok.com/@peterango', title: 'Pete Rango', snippet: '' }]);
            extractArtistId.mockImplementation(async (url: string) =>
                url.includes('tiktok.com') ? { siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'peterango' } : null,
            );

            const result = await discoverArtistProfiles('a1');
            // Only the search that was actually scoped to tiktok.com may keep its answer.
            expect(result).toHaveLength(1);
            expect(result[0].siteName).toBe('tiktok');
        });

        it('rejects a search result whose page belongs to a different person, even though the URL/handle looks plausible', async () => {
            // Regression coverage for the reported live failure: a search-shaped
            // last resort must not accept a plausible-looking-but-wrong hit —
            // querying for artist "Pete Rango" must not surface an unrelated
            // band's page just because the URL is well-formed and resolvable.
            const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT); // "Pete Rango"
            webSearch.mockImplementation(async (_query: string, opts: { includeDomains?: string[] }) => (
                opts?.includeDomains?.[0] === 'instagram.com'
                    ? [{
                        url: 'https://instagram.com/sonsofsilverband',
                        title: 'Sons of Silver (@sonsofsilverband) • Instagram photos and videos',
                        snippet: 'Official page of the band Sons of Silver.',
                    }]
                    : []
            ));
            extractArtistId.mockImplementation(async (url: string) =>
                url === 'https://instagram.com/sonsofsilverband'
                    ? { siteName: 'instagram', cardPlatformName: 'Instagram', id: 'sonsofsilverband' }
                    : null,
            );

            const result = await discoverArtistProfiles('a1');
            // The name cross-check rejects it before it's even a candidate —
            // never reaches extractArtistId's downstream gates a second time.
            expect(result).toEqual([]);
        });

        it('restricts each platform search to that platform\'s own domain via includeDomains', async () => {
            const { artistQ, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST); // deezer only — every social platform missing
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            webSearch.mockResolvedValue([]);

            await discoverArtistProfiles('a1');

            const calledDomains = webSearch.mock.calls.map((call: unknown[]) => (call[1] as { includeDomains?: string[] })?.includeDomains);
            expect(calledDomains.sort()).toEqual([
                ['bandcamp.com'], ['facebook.com'], ['instagram.com'], ['soundcloud.com'],
                ['tiktok.com'], ['twitch.tv'], ['x.com'], ['youtube.com'],
            ].sort());
        });

        // --- Regression coverage for real false positives observed running
        // this tier live against the actual Tavily API (see the web-search
        // report) — these are not hypothetical, they're the exact URL
        // shapes and name collisions a live run produced before the
        // looksLikeProfileUrl / handleEchoesArtistName gates were added.

        it('rejects search results whose URLs are not genuine profile pages (reel/watch-query/extra-path-segment) — live Tavily regression', async () => {
            const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST); // "Pete Rango"
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            webSearch.mockImplementation(async (_query: string, opts: { includeDomains?: string[] }) => {
                const domain = opts?.includeDomains?.[0];
                // Live-observed, verbatim shapes (artist name swapped for the fixture's "Pete Rango"):
                if (domain === 'instagram.com') return [{ url: 'https://instagram.com/reel/DUYpZyADrM-', title: 'Instagram', snippet: 'Pete Rango' }];
                if (domain === 'youtube.com') return [{ url: 'https://www.youtube.com/watch?v=I15VFyYsSuw', title: 'Pete Rango - a video', snippet: '' }];
                if (domain === 'twitch.tv') return [{ url: 'https://www.twitch.tv/peterango/about', title: 'Pete Rango', snippet: '' }];
                return [];
            });
            // extractArtistId's DB-driven regexes would happily resolve all
            // three (that's the bug this regression guards) — the point is
            // they're rejected by the URL-shape check BEFORE this even runs
            // for the malformed candidates.
            extractArtistId.mockImplementation(async (url: string) => {
                if (url === 'https://instagram.com/reel/DUYpZyADrM-') return { siteName: 'instagram', cardPlatformName: 'Instagram', id: 'reel' };
                if (url === 'https://www.youtube.com/watch?v=I15VFyYsSuw') return { siteName: 'youtube', cardPlatformName: 'YouTube', id: 'watch?v=I15VFyYsSuw' };
                if (url === 'https://www.twitch.tv/peterango/about') return { siteName: 'twitch', cardPlatformName: 'Twitch', id: 'peterango' };
                return null;
            });

            const result = await discoverArtistProfiles('a1');
            expect(result).toEqual([]);
        });

        it('accepts Bandcamp\'s canonical bare-domain-root URL shape (<handle>.bandcamp.com, zero path segments)', async () => {
            // Bandcamp is the ONE platform where a bare `https://<domain>` (zero
            // path segments) is the CANONICAL profile shape — the subdomain,
            // not a path segment, is the handle. `looksLikeProfileUrl` has to
            // allow this case, not just exactly-one-segment.
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            webSearch.mockImplementation(async (_query: string, opts: { includeDomains?: string[] }) => (
                opts?.includeDomains?.[0] === 'bandcamp.com'
                    ? [{ url: 'https://peterango.bandcamp.com', title: 'Pete Rango', snippet: '' }]
                    : []
            ));
            extractArtistId.mockImplementation(async (url: string) =>
                url === 'https://peterango.bandcamp.com' ? { siteName: 'bandcamp', cardPlatformName: 'Bandcamp', id: 'peterango' } : null,
            );
            fetchLinkPreview.mockResolvedValue({ imageUrl: null, title: null }); // bandcamp isn't OG-reliable — gate e doesn't apply

            const result = await discoverArtistProfiles('a1');
            expect(result.find(r => r.siteName === 'bandcamp')).toMatchObject({ siteName: 'bandcamp', value: 'peterango' });
        });

        it('rejects a Bandcamp editorial/official subdomain (blog.bandcamp.com) even though it matches the bare-domain-root URL shape — live Tavily regression', async () => {
            const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            webSearch.mockImplementation(async (_query: string, opts: { includeDomains?: string[] }) => (
                opts?.includeDomains?.[0] === 'bandcamp.com'
                    ? [{ url: 'https://blog.bandcamp.com', title: 'Pete Rango — Bandcamp Daily', snippet: '' }]
                    : []
            ));
            extractArtistId.mockImplementation(async (url: string) =>
                url === 'https://blog.bandcamp.com' ? { siteName: 'bandcamp', cardPlatformName: 'Bandcamp', id: 'blog' } : null,
            );

            const result = await discoverArtistProfiles('a1');
            expect(result).toEqual([]);
        });

        it('rejects a handle with zero relation to the artist name even when the TITLE genuinely contains the artist name (same-surname stranger) — live Tavily regression', async () => {
            // Live-observed: artist on file "shumov" (a bare, generic surname)
            // matched an unrelated "Ivan Shumov" whose own handle ("inoise")
            // carries no relation to either name. The title alone ("Ivan
            // Shumov (@inoise) / X") is NOT contradictory evidence — it
            // genuinely contains "shumov" as a substring — so only a
            // handle-level check catches this; a title-only check does not.
            const { artistQ, extractArtistId, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'shumov', deezer: '94933462' });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue({ ...ENRICHMENT, name: 'shumov' });
            webSearch.mockImplementation(async (_query: string, opts: { includeDomains?: string[] }) => (
                opts?.includeDomains?.[0] === 'x.com'
                    ? [{ url: 'https://x.com/inoise', title: 'Ivan Shumov (@inoise) / X', snippet: '' }]
                    : []
            ));
            extractArtistId.mockImplementation(async (url: string) =>
                url === 'https://x.com/inoise' ? { siteName: 'x', cardPlatformName: 'X', id: 'inoise' } : null,
            );

            const result = await discoverArtistProfiles('a1');
            expect(result).toEqual([]);
        });

        it('accepts a handle-echo match even when the search result has no usable title text at all', async () => {
            // The handle itself is already strong evidence (see
            // handleEchoesArtistName) — a search result with no title/snippet
            // text to cross-check must not be treated as a failure, mirroring
            // tier 3's "confirmed handle -> image alone trusted" exception.
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue({ id: 'a1', name: 'Grimes', deezer: '94933462' });
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue({ ...ENRICHMENT, name: 'Grimes' });
            webSearch.mockImplementation(async (_query: string, opts: { includeDomains?: string[] }) => (
                opts?.includeDomains?.[0] === 'instagram.com'
                    ? [{ url: 'https://www.instagram.com/grimes', title: '', snippet: '' }]
                    : []
            ));
            extractArtistId.mockImplementation(async (url: string) =>
                url === 'https://www.instagram.com/grimes' ? { siteName: 'instagram', cardPlatformName: 'Instagram', id: 'grimes' } : null,
            );
            fetchLinkPreview.mockResolvedValue({ imageUrl: 'https://cdn/grimes.jpg', title: null }); // instagram is OG-reliable (gate e)

            const result = await discoverArtistProfiles('a1');
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ siteName: 'instagram', value: 'grimes' });
        });
    });

    // --- Cross-tier sequencing --------------------------------------------

    it('does not re-search a platform in a later tier once an earlier tier already proposed it', async () => {
        const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, spotifyProvider, getArtistMappings, webSearch, discoverArtistProfiles } = await setup();
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

        const result = await discoverArtistProfiles('a1');

        expect(result.map(r => r.siteName).sort()).toEqual(['deezer', 'spotify']);
        // Tier 4 never searches for spotify or deezer (no search API platforms are never tier-4 targets),
        // and having already been satisfied by tiers 1/2 they aren't re-proposed by tier 4 either.
        for (const call of webSearch.mock.calls) {
            expect(call[0]).not.toMatch(/Spotify|Deezer/i);
        }
    });

    it('total failure across every tier (DB throws, providers throw, web search throws) still resolves to [] without throwing', async () => {
        const { artistQ, musicPlatformData, spotifyProvider, deezerProvider, getArtistMappings, webSearch, discoverArtistProfiles } = await setup();
        artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
        artistQ.getAllLinks.mockRejectedValue(new Error('urlmap down'));
        getArtistMappings.mockRejectedValue(new Error('mappings table down'));
        musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
        spotifyProvider.searchArtists.mockRejectedValue(new Error('spotify down'));
        deezerProvider.searchArtists.mockRejectedValue(new Error('deezer down'));
        webSearch.mockRejectedValue(new Error('tavily down'));

        await expect(discoverArtistProfiles('a1')).resolves.toEqual([]);
    });

    // --- Tier 3 (NEW) — deterministic handle probing ----------------------
    // Replaces the old per-platform Gemini search (exercised above as the
    // tier-4 last resort, now a real web search instead). No webSearch/
    // network mocking needed for the pure-function tests; the end-to-end
    // ones drive the whole cascade through the public `discoverArtistProfiles`,
    // same as every test above.

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
            // tier-4 last resort finds nothing extra (default webSearch mock: [])

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

            const result = await discoverArtistProfiles('a1');
            expect(result.map(r => r.siteName).sort()).toEqual(['facebook', 'instagram']);
            expect(result.every(r => r.value === 'p3t3rango')).toBe(true);
        });

        // The highest-value interaction between the two tiers: a handle
        // CONFIRMED by tier 4's web search must feed back into tier 3's own
        // probe mechanism, resolving other platforms that reuse the same
        // handle WITHOUT a second search call for each of them.
        it('feeds a tier-4 search-confirmed handle back into the probe tier\'s propagation set, resolving another platform without a second search', async () => {
            const { artistQ, extractArtistId, fetchLinkPreview, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            // The artist's real handle ("p3t3rango") isn't derivable from the
            // name via slugification and isn't an existing link either — it
            // can ONLY enter the candidate set via a web search hit.
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST); // deezer only, name "Pete Rango"
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockImplementation(async (url: string) => {
                // Instagram is OG-reliable, so the tier-4 (web search) candidate
                // needs an og:image to clear gate (e) — same as any other search hit.
                if (url === 'https://instagram.com/p3t3rango') return { imageUrl: 'https://cdn/instagram-pic.jpg', title: null };
                // TikTok's urlmap appStringFormat is 'https://tiktok.com/@%@' — the
                // propagation probe hits THIS url, confirmed by image alone (no
                // title to cross-check), which is only trusted for a `confirmed`
                // handle — exactly the case a search-confirmed handle is.
                if (url === 'https://tiktok.com/@p3t3rango') return { imageUrl: 'https://cdn/tiktok-pic.jpg', title: null };
                return { imageUrl: null, title: null }; // every OTHER probe (seed pass, other platforms) misses
            });
            extractArtistId.mockImplementation(async (url: string) => {
                if (url === 'https://instagram.com/p3t3rango') return { siteName: 'instagram', cardPlatformName: 'Instagram', id: 'p3t3rango' };
                if (url === 'https://tiktok.com/@p3t3rango') return { siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'p3t3rango' };
                return null;
            });
            // Only Instagram's search turns anything up.
            webSearch.mockImplementation(async (_query: string, opts: { includeDomains?: string[] }) => (
                opts?.includeDomains?.[0] === 'instagram.com'
                    ? [{ url: 'https://instagram.com/p3t3rango', title: 'Pete Rango (@p3t3rango) • Instagram photos and videos', snippet: '' }]
                    : [] // every other platform's search comes up empty
            ));

            const result = await discoverArtistProfiles('a1');

            expect(result.map(r => r.siteName).sort()).toEqual(['instagram', 'tiktok']);
            expect(result.find(r => r.siteName === 'tiktok')?.value).toBe('p3t3rango');
            // TikTok was resolved by PROPAGATING the search-confirmed handle
            // through a probe fetch, not a second search — tiktok.com's search
            // was only ever called once (the normal per-platform tier-4 sweep),
            // and it returned nothing.
            const tiktokSearchCalls = webSearch.mock.calls.filter(
                (call: unknown[]) => (call[1] as { includeDomains?: string[] })?.includeDomains?.[0] === 'tiktok.com',
            );
            expect(tiktokSearchCalls).toHaveLength(1);
        });

        it('DOES probe X now that it returns og data again (re-measured 2026-08-21)', async () => {
            const { artistQ, fetchLinkPreview, musicPlatformData, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);

            await discoverArtistProfiles('a1');

            // X was excluded from probing on the grounds that it returns no
            // og:title/og:image to a bot. Re-measuring showed it now returns
            // both ("Pete Rango ... (@p3t3rango) on X", image present). While
            // excluded, X could never be found AT ALL: probing skipped it, and
            // tier 4 could not rescue it either.
            const probedUrls = fetchLinkPreview.mock.calls.map((call: unknown[]) => call[0]);
            expect(probedUrls.some((u: unknown) => typeof u === 'string' && u.includes('x.com'))).toBe(true);
        });

        it('never throws and still resolves to [] when every probe attempt rejects outright', async () => {
            const { artistQ, fetchLinkPreview, musicPlatformData, webSearch, discoverArtistProfiles } = await setup();
            artistQ.getArtistById.mockResolvedValue(BASE_ARTIST);
            artistQ.getAllLinks.mockResolvedValue(URLMAP_ROWS);
            musicPlatformData.getArtist.mockResolvedValue(ENRICHMENT);
            fetchLinkPreview.mockRejectedValue(new Error('network down'));
            webSearch.mockRejectedValue(new Error('tavily also down'));

            await expect(discoverArtistProfiles('a1')).resolves.toEqual([]);
        });
    });
});

describe("stripUrlQuery — tracking params are not part of a handle", () => {
    it("drops the query string a search result carries", async () => {
        // Tavily returns instagram.com/p3t3rango?hl=en as the top hit for the
        // artist's name. extractArtistId captures the first path segment
        // verbatim, so without this the artist's stored handle becomes
        // "p3t3rango?hl=en" — which then fails to round-trip through urlmap.
        const { stripUrlQuery } = await import("@/server/utils/profileDiscovery");
        expect(stripUrlQuery("https://www.instagram.com/p3t3rango?hl=en")).toBe("https://www.instagram.com/p3t3rango");
        expect(stripUrlQuery("https://x.com/p3t3rango?s=20&t=abc")).toBe("https://x.com/p3t3rango");
    });

    it("leaves a clean URL alone and never throws on a malformed one", async () => {
        const { stripUrlQuery } = await import("@/server/utils/profileDiscovery");
        expect(stripUrlQuery("https://x.com/p3t3rango")).toBe("https://x.com/p3t3rango");
        expect(stripUrlQuery("not a url?x=1")).toBe("not a url");
    });
});
