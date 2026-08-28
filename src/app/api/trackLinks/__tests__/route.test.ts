// @ts-nocheck
/**
 * A search returns A result, not THE result.
 *
 * Both providers answer with their best guess rather than with nothing, so the
 * whole value of this route is in refusing most of what it is told.
 */
import { jest } from '@jest/globals';

if (!('json' in Response)) {
    Response.json = (data, init) =>
        new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            status: init?.status || 200,
        });
}

const apple = (results) => ({ ok: true, json: async () => ({ results }) });
const deezer = (data) => ({ ok: true, json: async () => ({ data }) });

/** Distinct titles per test so the route's cache cannot answer for us. */
let n = 0;
async function ask({ title, artist, kind = 'song', appleBody = apple([]), deezerBody = deezer([]) }) {
    global.fetch = jest.fn(async (url) =>
        String(url).includes('itunes.apple.com') ? appleBody : deezerBody);
    const { GET } = await import('../route');
    const q = new URLSearchParams({ title, artist, kind });
    const res = await GET({ nextUrl: { searchParams: q } });
    return { status: res.status, body: await res.json() };
}

describe('GET /api/trackLinks', () => {
    beforeEach(() => { jest.resetModules(); n++; });

    it('returns the track on both services when they agree it is the right one', async () => {
        const { body } = await ask({
            title: `rush ${n}`, artist: 'Pete Rango',
            appleBody: apple([{ trackName: `rush ${n}`, artistName: 'Pete Rango', trackViewUrl: 'https://music.apple.com/x?uo=4' }]),
            deezerBody: deezer([{ title: `rush ${n}`, artist: { name: 'Pete Rango' }, link: 'https://www.deezer.com/track/1' }]),
        });
        expect(body.links).toEqual([
            { service: 'Apple Music', url: 'https://music.apple.com/x' },   // the uo=4 noise is stripped
            { service: 'Deezer', url: 'https://www.deezer.com/track/1' },
        ]);
    });

    it("accepts a track credited to someone else when the TITLE carries the artist's name", async () => {
        // Pete, on his own remix: "crying in the floor says Pete Rango mix
        // should show up." Deezer credits it to Dame Atlas alone; it is still
        // his mix and the title says so.
        const { body } = await ask({
            title: `crying on the floor (pete rango mix) ${n}`, artist: 'Pete Rango',
            deezerBody: deezer([{
                title: `crying on the floor (pete rango mix) ${n}`,
                artist: { name: 'Dame Atlas' },
                link: 'https://www.deezer.com/track/4094333431',
            }]),
        });
        expect(body.links).toEqual([{ service: 'Deezer', url: 'https://www.deezer.com/track/4094333431' }]);
    });

    it('accepts the artist as one name among several credited', async () => {
        const { body } = await ask({
            title: `some song ${n}`, artist: 'Pete Rango',
            deezerBody: deezer([{ title: `some song ${n}`, artist: { name: 'Dame Atlas & Pete Rango' }, link: 'https://www.deezer.com/track/9' }]),
        });
        expect(body.links).toEqual([{ service: 'Deezer', url: 'https://www.deezer.com/track/9' }]);
    });

    it('will not accept a longer name that merely starts with the artist', async () => {
        // A substring check accepts "Dave East" for an artist called "Dave" —
        // the exact namesake failure this route exists to prevent, and three
        // artists in this directory are some version of "Black Dave".
        const { body } = await ask({
            title: `some song ${n}`, artist: 'Dave',
            deezerBody: deezer([{ title: `some song ${n}`, artist: { name: 'Dave East' }, link: 'https://www.deezer.com/track/11' }]),
        });
        expect(body.links).toEqual([]);
    });

    it('ignores a collaborator list a caller tries to smuggle in', async () => {
        // `with` used to RELAX the match on an endpoint anyone can call, and
        // the cache key did not mention it — so one crafted request poisoned
        // the answer for every later caller for an hour.
        global.fetch = jest.fn(async () =>
            deezer([{ title: `Thriller ${n}`, artist: { name: 'Michael Jackson' }, link: 'https://www.deezer.com/track/12' }]));
        const { GET } = await import('../route');
        const q = new URLSearchParams({ title: `Thriller ${n}`, artist: 'Pete Rango', with: 'Michael Jackson' });
        const body = await (await GET({ nextUrl: { searchParams: q } })).json();
        expect(body.links).toEqual([]);
    });

    it("refuses a stranger's record with the same title", async () => {
        // The failure this route exists to prevent: "Thriller" is a real song
        // and it is not Pete Rango's.
        const { body } = await ask({
            title: `Thriller ${n}`, artist: 'Pete Rango',
            appleBody: apple([{ trackName: `Thriller ${n}`, artistName: 'Michael Jackson', trackViewUrl: 'https://music.apple.com/mj' }]),
            deezerBody: deezer([{ title: `Thriller ${n}`, artist: { name: 'Michael Jackson' }, link: 'https://www.deezer.com/track/2' }]),
        });
        expect(body.links).toEqual([]);
    });

    it('refuses a near-miss title, because a near-miss is a different song', async () => {
        const { body } = await ask({
            title: `rush ${n}`, artist: 'Pete Rango',
            deezerBody: deezer([{ title: `rush hour ${n}`, artist: { name: 'Pete Rango' }, link: 'https://www.deezer.com/track/3' }]),
        });
        expect(body.links).toEqual([]);
    });

    it('keeps the provider that answered when the other one fails', async () => {
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes('itunes.apple.com')) throw new Error('down');
            return deezer([{ title: `rush ${n}`, artist: { name: 'Pete Rango' }, link: 'https://www.deezer.com/track/4' }]);
        });
        const { GET } = await import('../route');
        const q = new URLSearchParams({ title: `rush ${n}`, artist: 'Pete Rango' });
        const body = await (await GET({ nextUrl: { searchParams: q } })).json();
        expect(body.links).toEqual([{ service: 'Deezer', url: 'https://www.deezer.com/track/4' }]);
    });

    it('needs both a title and an artist', async () => {
        const { status } = await ask({ title: '', artist: 'Pete Rango' });
        expect(status).toBe(400);
    });

    it('will not let a self-titled request stand in for an artist check', async () => {
        // The title exception is for a name carried INSIDE a longer title —
        // "crying on the floor (pete rango mix)". When the artist's name IS the
        // whole title, it would otherwise accept any track called "Dave" by
        // anyone: the same-title failure, arrived at from the other direction.
        const { body } = await ask({
            title: 'Dave', artist: 'Dave',
            deezerBody: deezer([{ title: 'Dave', artist: { name: 'Somebody Else' }, link: 'https://www.deezer.com/track/13' }]),
        });
        expect(body.links).toEqual([]);
    });

    it('searches albums as albums, not as songs', async () => {
        // Spotify's catalogue is mostly albums, and `entity=song` returns their
        // tracks or nothing — so an answer naming a record found no Apple link
        // at all.
        const asked = [];
        global.fetch = jest.fn(async (url) => {
            asked.push(String(url));
            return String(url).includes('itunes.apple.com')
                ? { ok: true, json: async () => ({ results: [{
                    collectionName: `Cast Out Of Hell ${n}`,
                    artistName: 'Pete Rango',
                    collectionViewUrl: 'https://music.apple.com/us/album/coh?uo=4',
                  }] }) }
                : deezer([]);
        });
        const { GET } = await import('../route');
        const q = new URLSearchParams({ title: `Cast Out Of Hell ${n}`, artist: 'Pete Rango', kind: 'album' });
        const body = await (await GET({ nextUrl: { searchParams: q } })).json();

        // Both providers, each at its album endpoint.
        expect(asked.some(u => u.includes('itunes.apple.com') && u.includes('entity=album'))).toBe(true);
        expect(asked.some(u => u.includes('api.deezer.com/search/album'))).toBe(true);
        expect(body.links).toContainEqual({ service: 'Apple Music', url: 'https://music.apple.com/us/album/coh' });
    });

    it('does not treat two different non-Latin titles as the same song', async () => {
        // Folding to [a-z0-9] reduced both to the empty string, so they
        // compared equal and shared a cache key — the first hit for either
        // would have been served for both.
        const { body } = await ask({
            title: '사랑', artist: 'Pete Rango',
            deezerBody: deezer([{ title: '恋', artist: { name: 'Pete Rango' }, link: 'https://www.deezer.com/track/99' }]),
        });
        expect(body.links).toEqual([]);
    });

    it('matches a band whose own name contains a separator', async () => {
        // "Earth, Wind & Fire" is one band containing two of the separators.
        // Splitting first left three names, none equal to it, so a band like
        // that could never match its own record.
        const { body } = await ask({
            title: `September ${n}`, artist: 'Earth, Wind & Fire',
            deezerBody: deezer([{ title: `September ${n}`, artist: { name: 'Earth, Wind & Fire' }, link: 'https://www.deezer.com/track/14' }]),
        });
        expect(body.links).toEqual([{ service: 'Deezer', url: 'https://www.deezer.com/track/14' }]);
    });

    it('does not cache a provider failure as a definitive miss', async () => {
        // A timeout or a 5xx came back as the same null a genuine no-match
        // does, so one bad minute at Apple pinned an empty result in front of
        // every later click for an hour.
        const title = `retry me ${n}`;
        const { GET } = await import('../route');
        const q = () => new URLSearchParams({ title, artist: 'Pete Rango' });

        global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
        const first = await (await GET({ nextUrl: { searchParams: q() } })).json();
        expect(first.links).toEqual([]);
        expect(first.cached).toBeUndefined();

        // Both recover. The second click must actually search again.
        global.fetch = jest.fn(async (url) =>
            String(url).includes('itunes.apple.com')
                ? apple([{ trackName: title, artistName: 'Pete Rango', trackViewUrl: 'https://music.apple.com/ok' }])
                : deezer([]));
        const second = await (await GET({ nextUrl: { searchParams: q() } })).json();
        expect(second.links).toEqual([{ service: 'Apple Music', url: 'https://music.apple.com/ok' }]);
    });
});
