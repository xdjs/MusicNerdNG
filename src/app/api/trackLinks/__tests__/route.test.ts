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
async function ask({ title, artist, appleBody = apple([]), deezerBody = deezer([]) }) {
    global.fetch = jest.fn(async (url) =>
        String(url).includes('itunes.apple.com') ? appleBody : deezerBody);
    const { GET } = await import('../route');
    const q = new URLSearchParams({ title, artist });
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
});
