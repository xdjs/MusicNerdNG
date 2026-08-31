// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/externalApiQueries', () => ({
    getSpotifyHeaders: jest.fn().mockResolvedValue({ headers: { Authorization: 'Bearer test' } }),
}));

/** Stands in for Deezer + Spotify. `tracks` maps a Deezer track id to its
 *  ISRC; `isrcs` maps an ISRC to the artists Spotify credits on it. */
function stubApis({ top = [], tracks = {}, isrcs = {} } = {}) {
    global.fetch = jest.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, json: async () => body });
        if (url.includes('/top?')) return ok({ data: top.map(id => ({ id })) });
        const t = url.match(/api\.deezer\.com\/track\/(\d+)/);
        if (t) return ok(tracks[t[1]] ? { isrc: tracks[t[1]] } : {});
        const s = url.match(/isrc%3A([A-Z0-9]+)/i) ?? url.match(/isrc:([A-Z0-9]+)/i);
        if (s) {
            const artists = isrcs[s[1]];
            return ok({ tracks: { items: artists ? [{ artists }] : [] } });
        }
        return { ok: false, json: async () => ({}) };
    });
}

async function subject() {
    const { spotifyArtistFromDeezer } = await import('../isrcMatch');
    return spotifyArtistFromDeezer;
}

describe('spotifyArtistFromDeezer', () => {
    beforeEach(() => { jest.resetModules(); });

    it('does not take the first artist on the track — that is often a collaborator', async () => {
        // Measured on the real APIs: Pete Rango's top Deezer track is "crying
        // on the floor (pete rango mix)", and Spotify credits `Dame Atlas`
        // FIRST, Pete Rango second. artists[0] writes a collaborator's id onto
        // the artist. With one recording the counts tie, so the name decides —
        // over a set containing only people who play on his records, not over
        // the whole of Spotify.
        stubApis({
            top: [1], tracks: { 1: 'CA5KR2659261' },
            isrcs: { CA5KR2659261: [{ id: 'dame-atlas', name: 'Dame Atlas' }, { id: 'pete', name: 'Pete Rango' }] },
        });
        expect(await (await subject())('94933462', 'Pete Rango'))
            .toEqual({ spotifyId: 'pete', recordings: 1, byName: true });
    });

    it('lets the recordings decide when they can, without needing the name', async () => {
        // The artist is on all of them; a guest features once. This is the case
        // a name search cannot handle at all — three artists called Black Dave.
        stubApis({
            top: [1, 2, 3], tracks: { 1: 'AAA', 2: 'BBB', 3: 'CCC' },
            isrcs: {
                AAA: [{ id: 'them', name: 'Black Dave MK2' }, { id: 'guest', name: 'A Guest' }],
                BBB: [{ id: 'them', name: 'Black Dave MK2' }],
                CCC: [{ id: 'them', name: 'Black Dave MK2' }],
            },
        });
        // Name deliberately NOT matching, to prove the count alone decided it.
        expect(await (await subject())('1', 'totally different name'))
            .toEqual({ spotifyId: 'them', recordings: 3, byName: false });
    });

    it('will not accept a lone recording by a lone artist without checking the name', async () => {
        // Found in review, and the coverage gap was real: every "trusted" case
        // here was either three-recordings-agree or a genuine tie broken by
        // name, so nothing exercised ONE recording crediting ONE artist. That
        // path returned `byName: false` with no name check at all — the
        // opposite of what this module promises.
        //
        // Agreement across recordings is the evidence, and one recording cannot
        // agree with itself. Pete Rango has exactly one resolvable ISRC.
        stubApis({
            top: [1], tracks: { 1: 'AAA' },
            isrcs: { AAA: [{ id: 'someone-else', name: 'Somebody Entirely Different' }] },
        });
        expect(await (await subject())('1', 'Pete Rango')).toBeNull();
    });

    it('accepts a lone recording when its lone artist IS the artist', async () => {
        stubApis({
            top: [1], tracks: { 1: 'AAA' },
            isrcs: { AAA: [{ id: 'them', name: 'Pete Rango' }] },
        });
        expect(await (await subject())('1', 'Pete Rango'))
            .toEqual({ spotifyId: 'them', recordings: 1, byName: true });
    });

    it('abstains when tied collaborators include nobody with the artist name', async () => {
        // Two names, neither theirs. A gap beats a wrong link.
        stubApis({
            top: [1], tracks: { 1: 'AAA' },
            isrcs: { AAA: [{ id: 'a', name: 'One Person' }, { id: 'b', name: 'Another Person' }] },
        });
        expect(await (await subject())('1', 'Pete Rango')).toBeNull();
    });

    it('returns null when Deezer exposes no ISRCs, so the name search still runs', async () => {
        stubApis({ top: [1], tracks: {} });
        expect(await (await subject())('1', 'Pete Rango')).toBeNull();
    });

    it('returns null when Spotify knows none of the recordings', async () => {
        stubApis({ top: [1], tracks: { 1: 'AAA' }, isrcs: {} });
        expect(await (await subject())('1', 'Pete Rango')).toBeNull();
    });

    it('never throws when the APIs do', async () => {
        global.fetch = jest.fn(async () => { throw new Error('network down'); });
        await expect((await subject())('1', 'Pete Rango')).resolves.toBeNull();
    });
});
