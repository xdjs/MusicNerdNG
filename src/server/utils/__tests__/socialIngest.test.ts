// @ts-nocheck
import { jest } from '@jest/globals';

describe('mapApifyPost (pure)', () => {
    let mapApifyPost: typeof import('@/server/utils/socialIngest').mapApifyPost;

    beforeAll(async () => {
        ({ mapApifyPost } = await import('@/server/utils/socialIngest'));
    });

    const ARTIST_ID = 'artist-1';
    const HANDLE = 'p3t3rango';

    it('drops Apify error placeholder items', () => {
        expect(mapApifyPost({ error: 'not found', errorDescription: 'x' }, ARTIST_ID, HANDLE)).toBeNull();
    });

    it('drops items missing id, url, or ownerUsername', () => {
        expect(mapApifyPost({ url: 'https://x', ownerUsername: 'a' }, ARTIST_ID, HANDLE)).toBeNull();
        expect(mapApifyPost({ id: '1', ownerUsername: 'a' }, ARTIST_ID, HANDLE)).toBeNull();
        expect(mapApifyPost({ id: '1', url: 'https://x' }, ARTIST_ID, HANDLE)).toBeNull();
        expect(mapApifyPost(null, ARTIST_ID, HANDLE)).toBeNull();
    });

    it('marks isOwnPost case-insensitively against the handle', () => {
        const own = mapApifyPost({ id: '1', url: 'https://x/1', ownerUsername: 'P3t3rango' }, ARTIST_ID, HANDLE);
        expect(own.isOwnPost).toBe(true);
        const collab = mapApifyPost({ id: '2', url: 'https://x/2', ownerUsername: 'dameatlas' }, ARTIST_ID, HANDLE);
        expect(collab.isOwnPost).toBe(false);
        expect(collab.ownerUsername).toBe('dameatlas'); // never overwritten with the artist's handle
    });

    it('excludes the artist from coauthorProducers and merges mentions + taggedUsers', () => {
        const row = mapApifyPost({
            id: '3', url: 'https://x/3', ownerUsername: 'dameatlas',
            coauthorProducers: [{ username: 'p3t3rango' }, { username: 'dear_rod' }],
            mentions: ['pressurefiles'],
            taggedUsers: [{ username: 'p3t3rango' }, { username: 'pressurefiles' }],
        }, ARTIST_ID, HANDLE);
        expect(row.coauthors).toEqual(['dear_rod']); // self dropped
        expect(row.mentions.sort()).toEqual(['pressurefiles']); // self dropped, dedup across mentions+taggedUsers
    });

    it('keeps a real track credit', () => {
        const row = mapApifyPost({
            id: '4', url: 'https://x/4', ownerUsername: 'p3t3rango',
            musicInfo: { artist_name: 'Brian Eno', song_name: 'Signals', uses_original_audio: false },
        }, ARTIST_ID, HANDLE);
        expect(row.musicTitle).toBe('Signals');
        expect(row.musicArtist).toBe('Brian Eno');
    });

    it('drops musicInfo noise: original audio, self-credited, or missing song/artist name', () => {
        const originalAudio = mapApifyPost({
            id: '5', url: 'https://x/5', ownerUsername: 'p3t3rango',
            musicInfo: { artist_name: 'p3t3rango', song_name: 'Original audio', uses_original_audio: true },
        }, ARTIST_ID, HANDLE);
        expect(originalAudio.musicTitle).toBeNull();

        const selfCredited = mapApifyPost({
            id: '6', url: 'https://x/6', ownerUsername: 'p3t3rango',
            musicInfo: { artist_name: 'P3T3RANGO', song_name: 'Some Track', uses_original_audio: false },
        }, ARTIST_ID, HANDLE);
        expect(selfCredited.musicTitle).toBeNull();

        const shapeB = mapApifyPost({
            id: '7', url: 'https://x/7', ownerUsername: 'p3t3rango',
            musicInfo: { audio_type: null, music_canonical_id: '0', music_info: null },
        }, ARTIST_ID, HANDLE);
        expect(shapeB.musicTitle).toBeNull();
        expect(shapeB.musicArtist).toBeNull();
    });

    it('drops a self-credit written as a DISPLAY NAME, not just a handle', () => {
        // Regression: the guard compared a display name against a handle using
        // a normaliser that keeps spaces, so "Pharaoh Sistare" never matched
        // "pharaohsistare" and the audio was kept as a third-party credit.
        // A real artist was then asked how a "collaboration and remix" he had
        // no part in came about. The old test only covered the handle-shaped
        // case ('P3T3RANGO'), which is why this survived.
        const displayNameSelfCredit = mapApifyPost({
            id: '9', url: 'https://x/9', ownerUsername: 'pharaohsistare',
            musicInfo: {
                artist_name: 'Pharaoh Sistare',
                song_name: "Don't Let Me Go Alone (feat. Jameir Thompson) (Yamumoto Remix)",
                uses_original_audio: false,
            },
        }, ARTIST_ID, 'pharaohsistare');
        expect(displayNameSelfCredit.musicTitle).toBeNull();
        expect(displayNameSelfCredit.musicArtist).toBeNull();

        // Punctuation and casing in the display name shouldn't rescue it either.
        const punctuated = mapApifyPost({
            id: '10', url: 'https://x/10', ownerUsername: 'p3t3rango',
            musicInfo: { artist_name: 'P3T3.RANGO', song_name: 'Some Track', uses_original_audio: false },
        }, ARTIST_ID, HANDLE);
        expect(punctuated.musicTitle).toBeNull();
    });

    it('drops a self-credit when the handle looks nothing like the artist name', () => {
        // The case that matters most: a handle is NOT a name. "Black Dave"
        // posts as @worstgeneration, "Pete Rango" as @p3t3rango. Matching only
        // on the handle would keep working for artists whose handle happens to
        // be their name minus the spaces, and silently fail for everyone else.
        const unrelatedHandle = mapApifyPost({
            id: '12', url: 'https://x/12', ownerUsername: 'worstgeneration',
            musicInfo: { artist_name: 'Black Dave', song_name: 'Some Track', uses_original_audio: false },
        }, ARTIST_ID, 'worstgeneration', 'Black Dave');
        expect(unrelatedHandle.musicTitle).toBeNull();
        expect(unrelatedHandle.musicArtist).toBeNull();

        // Leetspeak handle, real name credited.
        const leet = mapApifyPost({
            id: '13', url: 'https://x/13', ownerUsername: 'p3t3rango',
            musicInfo: { artist_name: 'Pete Rango', song_name: 'Some Track', uses_original_audio: false },
        }, ARTIST_ID, 'p3t3rango', 'Pete Rango');
        expect(leet.musicTitle).toBeNull();
    });

    it('still keeps a genuine third-party credit whose name merely resembles the artist', () => {
        // The loose comparison must not become so lossy it eats real credits.
        const realCredit = mapApifyPost({
            id: '11', url: 'https://x/11', ownerUsername: 'pharaohsistare',
            musicInfo: { artist_name: 'Pharaoh Sistare & The Others', song_name: 'A Real Track', uses_original_audio: false },
        }, ARTIST_ID, 'pharaohsistare', 'Pharaoh Sistare');
        expect(realCredit.musicTitle).toBe('A Real Track');
        expect(realCredit.musicArtist).toBe('Pharaoh Sistare & The Others');
    });

    it('preserves the full raw item for provenance', () => {
        const raw = { id: '8', url: 'https://x/8', ownerUsername: 'p3t3rango', caption: 'hi' };
        const row = mapApifyPost(raw, ARTIST_ID, HANDLE);
        expect(row.raw).toEqual(raw);
        expect(row.artistId).toBe(ARTIST_ID);
        expect(row.platform).toBe('instagram');
        expect(row.platformPostId).toBe('8');
    });
});

describe('ingestInstagramPosts', () => {
    const ARTIST_ID = 'artist-1';
    const HANDLE = 'p3t3rango';
    const ORIGINAL_TOKEN = process.env.APIFY_API_TOKEN;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env.APIFY_API_TOKEN = ORIGINAL_TOKEN;
    });

    it('returns zeroes immediately with no network call when APIFY_API_TOKEN is unset', async () => {
        delete process.env.APIFY_API_TOKEN;
        const { ingestInstagramPosts } = await import('@/server/utils/socialIngest');
        const result = await ingestInstagramPosts(ARTIST_ID, HANDLE);
        expect(result).toEqual({ ingested: 0, ownPosts: 0, collabPosts: 0 });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('upserts mapped rows and reports own vs. collab counts', async () => {
        process.env.APIFY_API_TOKEN = 'test-token';
        const { db } = await import('@/server/db/drizzle');
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate }) });

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve([
                { id: '1', url: 'https://x/1', ownerUsername: 'p3t3rango', caption: 'own' },
                { id: '2', url: 'https://x/2', ownerUsername: 'dameatlas', caption: 'collab' },
                { error: 'not found' }, // must be dropped, not upserted
            ]),
        });

        const { ingestInstagramPosts } = await import('@/server/utils/socialIngest');
        const result = await ingestInstagramPosts(ARTIST_ID, HANDLE);

        expect(result).toEqual({ ingested: 2, ownPosts: 1, collabPosts: 1 });
        expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
        const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
        expect(url).toContain('apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items');
        expect(url).toContain('token=test-token');
        const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(body.directUrls).toEqual(['https://www.instagram.com/p3t3rango/']);
        expect(body.resultsLimit).toBe(200); // default
    });

    it('clamps an oversized limit to the hard cap', async () => {
        process.env.APIFY_API_TOKEN = 'test-token';
        const { db } = await import('@/server/db/drizzle');
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) }) });
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve([]) });

        const { ingestInstagramPosts } = await import('@/server/utils/socialIngest');
        await ingestInstagramPosts(ARTIST_ID, HANDLE, { limit: 100000 });
        const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(body.resultsLimit).toBeLessThanOrEqual(300);
    });

    it('never throws and returns zeroes on a non-OK Apify response', async () => {
        process.env.APIFY_API_TOKEN = 'test-token';
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error', json: () => Promise.resolve([]) });
        const { ingestInstagramPosts } = await import('@/server/utils/socialIngest');
        await expect(ingestInstagramPosts(ARTIST_ID, HANDLE)).resolves.toEqual({ ingested: 0, ownPosts: 0, collabPosts: 0 });
    });

    it('never throws and returns zeroes when fetch itself rejects', async () => {
        process.env.APIFY_API_TOKEN = 'test-token';
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
        const { ingestInstagramPosts } = await import('@/server/utils/socialIngest');
        await expect(ingestInstagramPosts(ARTIST_ID, HANDLE)).resolves.toEqual({ ingested: 0, ownPosts: 0, collabPosts: 0 });
    });

    it('never throws and returns zeroes when the response is not an array', async () => {
        process.env.APIFY_API_TOKEN = 'test-token';
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ notAnArray: true }) });
        const { ingestInstagramPosts } = await import('@/server/utils/socialIngest');
        await expect(ingestInstagramPosts(ARTIST_ID, HANDLE)).resolves.toEqual({ ingested: 0, ownPosts: 0, collabPosts: 0 });
    });

    it('returns zeroes for missing artistId/handle without a network call', async () => {
        process.env.APIFY_API_TOKEN = 'test-token';
        const { ingestInstagramPosts } = await import('@/server/utils/socialIngest');
        await expect(ingestInstagramPosts('', HANDLE)).resolves.toEqual({ ingested: 0, ownPosts: 0, collabPosts: 0 });
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('ingestInstagramPostsFromItems', () => {
    const ARTIST_ID = 'artist-1';
    const HANDLE = 'p3t3rango';

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('maps and upserts local items through the same write path, bypassing Apify entirely', async () => {
        const { db } = await import('@/server/db/drizzle');
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate }) });

        const { ingestInstagramPostsFromItems } = await import('@/server/utils/socialIngest');
        const result = await ingestInstagramPostsFromItems(ARTIST_ID, HANDLE, [
            { id: '1', url: 'https://x/1', ownerUsername: 'p3t3rango' },
            { id: '2', url: 'https://x/2', ownerUsername: 'dameatlas' },
        ]);

        expect(result).toEqual({ ingested: 2, ownPosts: 1, collabPosts: 1 });
        expect(global.fetch).not.toHaveBeenCalled();
        expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
    });
});
