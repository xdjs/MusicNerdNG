/**
 * An artist's links, from a database that already knows them.
 *
 * We had been inferring social accounts from web search: issue queries, fetch
 * pages, judge whether each is about the right person, probe handles, abstain
 * when two answer. Every one of those steps can be wrong, and most of them have
 * been. Meanwhile MusicBrainz is a free, community-curated database whose whole
 * purpose is holding exactly this, and it has entries for six of the seven
 * artists we test against — including the two obscure ones.
 *
 * On those seven it returns the artist's own website (which our corroboration
 * machinery spends a whole search pass hunting for), their Instagram, X,
 * Facebook, SoundCloud, Bandcamp and YouTube, curated by people rather than
 * inferred by us. Hardwell's four match our hand-verified truth exactly,
 * including facebook=djhardwell, which no probe of "hardwell" would ever reach.
 *
 * MATCHING IS THE WHOLE PROBLEM, so it is done by identifier where possible.
 * MusicBrainz links many artists to Spotify and Deezer; where it does and the id
 * is one we already hold, the entry is certainly the right person and its links
 * can be trusted outright. Where it does not — which is the common case for
 * small artists — we require a single candidate whose name matches exactly, and
 * we hand its links to the same verification the search path uses rather than
 * trusting them. Three artists called Black Dave are in our own directory; a
 * name is not an identifier.
 *
 * Rate limited to one request a second by MusicBrainz's terms, and this makes
 * two per artist, so it costs a little over two seconds. It is not on a
 * user-facing path.
 */

const MB = "https://musicbrainz.org/ws/2";
/** MusicBrainz asks for a contactable agent and blocks generic ones. */
const HEADERS = { "User-Agent": "MusicNerd/1.0 (https://musicnerd.xyz)" };
/** Their published limit is one request per second, averaged. */
const RATE_LIMIT_MS = 1_100;
const TIMEOUT_MS = 8_000;
/** Below this, MusicBrainz's own scorer does not think the name really matched. */
const MIN_SCORE = 90;

export type MusicBrainzLinks = {
    /** How we know this entry is the right artist. */
    matchedBy: "identifier" | "exact-name";
    /** Every url MusicBrainz holds, for the caller to resolve and verify. */
    urls: string[];
    /** Their official site, if it names one — the hub our search pass hunts for. */
    homepage: string | null;
};

const fold = (v: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function mb(path: string): Promise<Record<string, unknown> | null> {
    try {
        const res = await fetch(`${MB}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Paces every call in this process, not just the ones inside a single lookup. */
let lastCallAt = 0;
async function sinceLastCall(): Promise<void> {
    const gap = Date.now() - lastCallAt;
    if (gap < RATE_LIMIT_MS) await wait(RATE_LIMIT_MS - gap);
    lastCallAt = Date.now();
}

/**
 * Look an artist up and return what MusicBrainz holds, or null when it cannot
 * say confidently who they mean.
 *
 * Never throws: this is an enrichment, and losing it should cost a few links,
 * not the run.
 */
export async function fetchMusicBrainzLinks(
    artistName: string,
    held: { spotify?: string | null; deezer?: string | null },
): Promise<MusicBrainzLinks | null> {
    if (!artistName?.trim()) return null;

    // Their limit is averaged, so back-to-back lookups across several artists
    // exhaust it even when each lookup paces itself internally. A run that gets
    // throttled comes back with an entry and no relations, which reads exactly
    // like an artist MusicBrainz has never heard of — the benchmark saw Pete
    // Rango score 6/7 and 3/7 on consecutive runs for this reason alone.
    await sinceLastCall();

    const search = await mb(`/artist?query=${encodeURIComponent(`artist:"${artistName}"`)}&fmt=json&limit=5`);
    const candidates = ((search?.artists as Array<Record<string, unknown>>) ?? [])
        .filter(a => Number(a.score ?? 0) >= MIN_SCORE);
    if (candidates.length === 0) return null;

    const wantName = fold(artistName);
    let fallback: MusicBrainzLinks | null = null;

    for (const cand of candidates.slice(0, 3)) {
        await sinceLastCall();
        const detail = await mb(`/artist/${String(cand.id)}?inc=url-rels&fmt=json`);
        const relations = (detail?.relations as Array<Record<string, unknown>>) ?? [];
        const urls = relations
            .map(r => (r.url as Record<string, unknown> | undefined)?.resource)
            .filter((u): u is string => typeof u === "string" && u.length > 0);
        if (urls.length === 0) continue;

        const homepage = relations
            .filter(r => r.type === "official homepage")
            .map(r => (r.url as Record<string, unknown> | undefined)?.resource)
            .find((u): u is string => typeof u === "string") ?? null;

        // An id we already hold settles it — this is certainly the same artist,
        // whoever else shares the name.
        const identifies = urls.some(u =>
            (held.spotify && u.includes(`open.spotify.com/artist/${held.spotify}`))
            || (held.deezer && u.includes(`deezer.com/artist/${held.deezer}`)));
        if (identifies) return { matchedBy: "identifier", urls, homepage };

        // Otherwise remember the first exact-name match and keep looking for an
        // identifier, which outranks it.
        if (!fallback && fold(String(cand.name ?? "")) === wantName) {
            fallback = { matchedBy: "exact-name", urls, homepage };
        }
    }

    // Only when the name is unambiguous here. If several entries scored highly,
    // MusicBrainz is telling us the name is shared and we should not guess.
    if (fallback && candidates.filter(c => fold(String(c.name ?? "")) === wantName).length === 1) {
        return fallback;
    }
    return null;
}
