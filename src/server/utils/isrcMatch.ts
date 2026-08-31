import { getSpotifyHeaders } from "@/server/utils/queries/externalApiQueries";
import { foldName } from "@/server/utils/nameFold";

/**
 * Which Spotify artist is this, given their Deezer id?
 *
 * Discovery already found Spotify for a Deezer-only artist, by searching the
 * catalogue for their NAME and taking an exact match. That works for "Pete
 * Rango" and fails exactly where it matters: three artists in this directory
 * are called Black Dave, and a name search cannot say which Spotify entry
 * belongs to which of them. The search either picks one or, correctly,
 * abstains — and abstaining is what a heavily-namesaked artist gets.
 *
 * AN ISRC IS NOT A NAME. It identifies a RECORDING, globally and uniquely, and
 * both services expose it: Deezer on /track/{id}, Spotify via `q=isrc:`. So
 * take the recordings Deezer already attributes to this artist id, look up who
 * Spotify says performs those same recordings, and the answer does not depend
 * on anyone's name being distinctive.
 *
 * WHAT IT DOES NOT DO IS TRUST THE FIRST ARTIST ON THE TRACK. Measured on Pete
 * Rango: his top Deezer track is "crying on the floor (pete rango mix)", whose
 * Spotify entry credits `Dame Atlas` FIRST and Pete Rango second. Taking
 * artists[0] would have written a collaborator's id onto him. So candidates are
 * scored across several recordings and the name is used to break a tie —
 * still a name check, but over a set already restricted to people who play on
 * this artist's records, rather than over the whole of Spotify.
 *
 * Fails closed: no ISRCs, no Spotify match, or an unresolvable tie all return
 * null and leave the existing name search to try.
 */

/** Deezer's top-tracks endpoint does not include ISRCs, so each track costs a
 *  second call. Five is enough to out-vote a featured collaborator and small
 *  enough to stay inside a discovery tier's budget. */
const MAX_TRACKS = 5;

/** Per-request ceiling. Both APIs are normally fast; a hang here must not eat
 *  the onboarding turn. */
const FETCH_TIMEOUT_MS = 4_000;


async function getJson(url: string, headers?: Record<string, string>): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) return null;
        return await res.json() as Record<string, unknown>;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** The ISRCs of an artist's most popular Deezer recordings. */
async function isrcsFromDeezer(deezerArtistId: string): Promise<string[]> {
    const top = await getJson(`https://api.deezer.com/artist/${encodeURIComponent(deezerArtistId)}/top?limit=${MAX_TRACKS}`);
    const tracks = (top?.data as { id?: unknown }[] | undefined) ?? [];
    const ids = tracks.map(t => t.id).filter(id => typeof id === "number" || typeof id === "string").slice(0, MAX_TRACKS);
    // Concurrent: five sequential round-trips would cost more than the whole
    // tier is budgeted for.
    const isrcs = await Promise.all(ids.map(async id => {
        const track = await getJson(`https://api.deezer.com/track/${encodeURIComponent(String(id))}`);
        const isrc = track?.isrc;
        return typeof isrc === "string" && isrc ? isrc : null;
    }));
    return [...new Set(isrcs.filter((v): v is string => !!v))];
}

export interface IsrcSpotifyMatch {
    spotifyId: string;
    /** How many of the artist's recordings Spotify also credits them on. */
    recordings: number;
    /** True when the name broke a tie rather than the count deciding it. */
    byName: boolean;
}

/**
 * Resolve a Spotify artist id from a Deezer artist id, via shared recordings.
 * Returns null rather than guessing.
 */
export async function spotifyArtistFromDeezer(
    deezerArtistId: string,
    artistName: string,
): Promise<IsrcSpotifyMatch | null> {
    try {
        const isrcs = await isrcsFromDeezer(deezerArtistId);
        if (isrcs.length === 0) return null;

        const headers = (await getSpotifyHeaders()).headers as unknown as Record<string, string>;
        const counts = new Map<string, { n: number; name: string }>();
        await Promise.all(isrcs.map(async isrc => {
            const found = await getJson(
                `https://api.spotify.com/v1/search?q=${encodeURIComponent(`isrc:${isrc}`)}&type=track&limit=1`,
                { Authorization: headers.Authorization },
            );
            const track = ((found?.tracks as { items?: unknown[] } | undefined)?.items ?? [])[0] as
                { artists?: { id?: string; name?: string }[] } | undefined;
            for (const a of track?.artists ?? []) {
                if (!a?.id) continue;
                const prev = counts.get(a.id) ?? { n: 0, name: a.name ?? "" };
                counts.set(a.id, { n: prev.n + 1, name: prev.name || (a.name ?? "") });
            }
        }));
        if (counts.size === 0) return null;

        const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
        const [topId, top] = ranked[0];
        const contested = ranked.filter(([, v]) => v.n === top.n);

        // AGREEMENT ACROSS RECORDINGS IS THE STRONG EVIDENCE — the artist is on
        // all of them and a guest features once — and it means nothing at all
        // when there is only one recording to agree. `top.n >= 2` is the whole
        // point of the rule.
        //
        // Without that clause a single resolvable ISRC crediting a single
        // artist was "uncontested" and got returned with no name check
        // whatsoever, which is the opposite of what this module's own comment
        // promises. Not hypothetical: Pete Rango has exactly ONE resolvable
        // ISRC, and it was only verified because that track happens to credit
        // two people. A solo track — or a cover, a remix credited to the
        // remixer, a Deezer mis-attribution — would have been written straight
        // onto the artist. Found in review.
        if (contested.length === 1 && top.n >= 2) return { spotifyId: topId, recordings: top.n, byName: false };

        // Everything else has to be confirmed by the name: a tie, or a single
        // recording. Still far stronger than searching the catalogue by name,
        // because this set only contains people who perform this artist's
        // records.
        const want = foldName(artistName);
        const named = contested.filter(([, v]) => foldName(v.name) === want);
        if (named.length === 1) return { spotifyId: named[0][0], recordings: named[0][1].n, byName: true };

        // A single recording whose credited artist is not named like ours, several
        // collaborators with none of them named like ours, or two with the same
        // name. Nothing here identifies them.
        return null;
    } catch (e) {
        console.error("[isrcMatch] Deezer -> Spotify resolution failed:", e);
        return null;
    }
}
