/**
 * Where else can you hear this song?
 *
 * The ask can name a record; until now it could not send anyone to it. We hold
 * the artist's Spotify catalogue and nothing else at track level — there is no
 * track table, and the artist's Bandcamp and Deezer are handles for the ARTIST,
 * not for a song.
 *
 * RESOLVED ON CLICK, NOT ON ANSWER. Two lookups per song, on an answer naming
 * three of them, is most of a second added to every question for links most
 * readers never open. The title renders immediately and this runs when somebody
 * actually taps it.
 *
 * WHAT WE USE, AND WHY NOT THE OBVIOUS THING. Odesli/Songlink resolves every
 * platform from one URL and was the right answer until they retired the free
 * tier — it now answers 401 PUBLIC_API_ACCESS_DEPRECATED. Apple's iTunes Search
 * and Deezer's public API are both still open with no key and no account, and
 * between them they covered every track tested, including one each missed.
 * Tidal needs registered OAuth credentials; Bandcamp has no API at all, so the
 * artist's Bandcamp stays an artist-level link the caller adds.
 */
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** A search returns A result, not THE result, and both providers answer with
 *  their best guess rather than nothing. Everything below is about not
 *  believing them. */
const PROVIDER_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

export type TrackLink = { service: string; url: string };

const cache = new Map<string, { at: number; links: TrackLink[] }>();

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Letters and digits, single-spaced — keeps word boundaries, which folding
 *  away every space destroys. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The people a provider credits, one per entry.
 *
 * Split on the raw string BEFORE normalising, because normalising is what
 * removes the "&" that separates them. "Dame Atlas & Pete Rango" is two people;
 * "Dave East" is one, and that difference is the whole point.
 */
function creditedNames(credit: string): string[] {
    return credit
        .split(/\s*(?:&|\/|,|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\band\b)\s*/i)
        .map(norm)
        .filter(Boolean);
}

/**
 * Is this search hit the song we asked for?
 *
 * The title has to match outright — a near-match is a different song, and
 * "close enough" is how a stranger's record ends up on an artist's page.
 *
 * THE ARTIST TEST IS TWO TESTS, and neither is a substring check. A substring
 * check accepts "Dave East" for an artist called "Dave", which is precisely the
 * namesake failure this route exists to prevent.
 *
 *   1. The artist is one of the people credited. Compared against each credited
 *      name in full, so "Pete Rango" matches "Dame Atlas & Pete Rango" and
 *      "Dave" does not match "Dave East".
 *
 *   2. Or their name is in the TITLE. Pete, on his own remix: "crying in the
 *      floor says Pete Rango mix should show up." Deezer credits that track to
 *      Dame Atlas alone; it is still his mix, and the title says so. Matched on
 *      word boundaries so "Dave" does not match "Dave East" here either.
 */
function isTheSameTrack(
    hitTitle: string,
    hitArtist: string,
    wantTitle: string,
    wantArtist: string,
): boolean {
    if (fold(hitTitle) !== fold(wantTitle)) return false;
    const artist = norm(wantArtist);
    if (!artist) return false;
    if (creditedNames(hitArtist).includes(artist)) return true;
    const escaped = artist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(norm(hitTitle));
}

async function withTimeout<T>(p: Promise<T>): Promise<T | null> {
    return Promise.race([
        p,
        new Promise<null>(resolve => setTimeout(() => resolve(null), PROVIDER_TIMEOUT_MS)),
    ]).catch(() => null);
}

async function appleMusic(title: string, artist: string): Promise<TrackLink | null> {
    const term = encodeURIComponent(`${artist} ${title}`);
    const res = await withTimeout(fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`));
    if (!res?.ok) return null;
    const body = await res.json().catch(() => null) as { results?: Array<{ trackName?: string; artistName?: string; trackViewUrl?: string }> } | null;
    for (const r of body?.results ?? []) {
        if (!r.trackName || !r.trackViewUrl) continue;
        if (isTheSameTrack(r.trackName, r.artistName ?? "", title, artist)) {
            // The `uo=4` affiliate-ish parameter Apple appends is noise on a
            // link we are showing to a fan.
            return { service: "Apple Music", url: r.trackViewUrl.split("?")[0] };
        }
    }
    return null;
}

async function deezer(title: string, artist: string): Promise<TrackLink | null> {
    const q = encodeURIComponent(`${artist} ${title}`);
    const res = await withTimeout(fetch(`https://api.deezer.com/search?q=${q}&limit=5`));
    if (!res?.ok) return null;
    const body = await res.json().catch(() => null) as { data?: Array<{ title?: string; link?: string; artist?: { name?: string } }> } | null;
    for (const r of body?.data ?? []) {
        if (!r.title || !r.link) continue;
        if (isTheSameTrack(r.title, r.artist?.name ?? "", title, artist)) {
            return { service: "Deezer", url: r.link };
        }
    }
    return null;
}

export async function GET(req: NextRequest): Promise<Response> {
    const started = Date.now();
    const title = (req.nextUrl.searchParams.get("title") ?? "").trim();
    const artist = (req.nextUrl.searchParams.get("artist") ?? "").trim();
    // NO CALLER-SUPPLIED COLLABORATOR LIST. It used to take a `with` parameter
    // that RELAXED the match, on an endpoint anyone can call — so
    // `?artist=Pete Rango&title=Thriller&with=Michael Jackson` would resolve,
    // and then sit in the cache for an hour under a key that did not mention
    // it, handing that link to every later caller. Untrusted input must not
    // loosen a safety check. The remix case it existed for is already covered
    // by the title rule; if production credits need it back, the artist's
    // collaborators should be looked up HERE from an artist id, not passed in.

    if (!title || !artist) {
        return Response.json({ error: "title and artist are required" }, { status: 400 });
    }
    if (title.length > 200 || artist.length > 200) {
        return Response.json({ error: "title or artist too long" }, { status: 400 });
    }

    const key = `${fold(artist)}::${fold(title)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return Response.json({ links: hit.links, cached: true });
    }

    // Both at once — they are independent, and the slower one should not add to
    // the faster one.
    const [apple, dz] = await Promise.all([
        appleMusic(title, artist).catch(() => null),
        deezer(title, artist).catch(() => null),
    ]);
    const links = [apple, dz].filter((l): l is TrackLink => l !== null);

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), links });

    console.debug(`[trackLinks] "${title}" — ${links.length} link(s) in ${Date.now() - started}ms`);
    return Response.json({ links });
}
