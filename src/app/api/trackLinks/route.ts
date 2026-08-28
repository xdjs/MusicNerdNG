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

/**
 * Is this search hit the song we asked for?
 *
 * The title has to match outright — a near-match is a different song, and
 * "close enough" is how a stranger's record ends up on an artist's page.
 *
 * The artist test is deliberately looser, because the strict version is wrong.
 * Deezer credits "crying on the floor (pete rango mix)" to Dame Atlas alone; it
 * is still Pete's mix, and the TITLE SAYS SO. So the name counts if it appears
 * in the credited artist or in the title itself, and a credited collaborator
 * counts too — a remix or a production credit is exactly the case where the
 * artist we are asking about is not the one on the label.
 */
function isTheSameTrack(
    hitTitle: string,
    hitArtist: string,
    wantTitle: string,
    wantArtist: string,
    collaborators: string[],
): boolean {
    if (fold(hitTitle) !== fold(wantTitle)) return false;
    const artist = fold(wantArtist);
    if (!artist) return false;
    const haystack = `${fold(hitArtist)} ${fold(hitTitle)}`;
    if (haystack.includes(artist)) return true;
    return collaborators.some(c => {
        const folded = fold(c);
        return folded.length >= 4 && fold(hitArtist).includes(folded);
    });
}

async function withTimeout<T>(p: Promise<T>): Promise<T | null> {
    return Promise.race([
        p,
        new Promise<null>(resolve => setTimeout(() => resolve(null), PROVIDER_TIMEOUT_MS)),
    ]).catch(() => null);
}

async function appleMusic(title: string, artist: string, collaborators: string[]): Promise<TrackLink | null> {
    const term = encodeURIComponent(`${artist} ${title}`);
    const res = await withTimeout(fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`));
    if (!res?.ok) return null;
    const body = await res.json().catch(() => null) as { results?: Array<{ trackName?: string; artistName?: string; trackViewUrl?: string }> } | null;
    for (const r of body?.results ?? []) {
        if (!r.trackName || !r.trackViewUrl) continue;
        if (isTheSameTrack(r.trackName, r.artistName ?? "", title, artist, collaborators)) {
            // The `uo=4` affiliate-ish parameter Apple appends is noise on a
            // link we are showing to a fan.
            return { service: "Apple Music", url: r.trackViewUrl.split("?")[0] };
        }
    }
    return null;
}

async function deezer(title: string, artist: string, collaborators: string[]): Promise<TrackLink | null> {
    const q = encodeURIComponent(`${artist} ${title}`);
    const res = await withTimeout(fetch(`https://api.deezer.com/search?q=${q}&limit=5`));
    if (!res?.ok) return null;
    const body = await res.json().catch(() => null) as { data?: Array<{ title?: string; link?: string; artist?: { name?: string } }> } | null;
    for (const r of body?.data ?? []) {
        if (!r.title || !r.link) continue;
        if (isTheSameTrack(r.title, r.artist?.name ?? "", title, artist, collaborators)) {
            return { service: "Deezer", url: r.link };
        }
    }
    return null;
}

export async function GET(req: NextRequest): Promise<Response> {
    const started = Date.now();
    const title = (req.nextUrl.searchParams.get("title") ?? "").trim();
    const artist = (req.nextUrl.searchParams.get("artist") ?? "").trim();
    // Handles and names we already know are connected to this record. Sent by
    // the caller because it knows the artist's credited collaborators and this
    // route does not.
    const collaborators = (req.nextUrl.searchParams.get("with") ?? "")
        .split(",").map(s => s.trim()).filter(Boolean).slice(0, 8);

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
        appleMusic(title, artist, collaborators).catch(() => null),
        deezer(title, artist, collaborators).catch(() => null),
    ]);
    const links = [apple, dz].filter((l): l is TrackLink => l !== null);

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), links });

    console.debug(`[trackLinks] "${title}" — ${links.length} link(s) in ${Date.now() - started}ms`);
    return Response.json({ links });
}
