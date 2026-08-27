/**
 * How much a source is worth, so the good ones come first.
 *
 * Until now every vault source was equal and they were ordered by when they
 * happened to be discovered. Pete Rango, looking at his own vault: "the
 * clubhouse link in the vault seems pointless and isn't adding any value... I
 * show up in credits for Nia Sultana's project on Discogs, and that should take
 * precedence over a 'clubhouse' link."
 *
 * He is right, and the distinction is not about correctness. clubhousedb.com/
 * user/peterango is genuinely his profile, correctly verified, and worth almost
 * nothing: an aggregator scraped a handle. A Discogs credit is a record of work
 * he actually did on somebody else's release. Both pass every identity check we
 * have; only one belongs near the top of a page about him.
 *
 * WHAT THIS IS NOT. It is not a filter. Nothing is dropped for scoring low — a
 * low rank means "further down the list", and the artist still decides. Ranking
 * something out of existence is the kind of quiet judgement that loses a real
 * source, and the whole point of the vault is that they get to look.
 */

/** Higher is better. Absolute values are meaningless; only the order matters. */
export const AUTHORITY = {
    /** A publication wrote about them: interviews, features, reviews. The
     *  strongest thing a stranger can say about an artist. */
    EDITORIAL: 100,
    /** A credits database — Discogs, MusicBrainz, AllMusic. Not prose, but a
     *  record of work done, often on somebody else's release, and the only
     *  place a producer or engineer's catalogue is visible at all. */
    CREDITS: 90,
    /** Their own site. Authoritative about them by definition, and the one page
     *  they control. */
    OWN_SITE: 80,
    /** Their own words, from their own feed. */
    OWN_WORDS: 70,
    /** A streaming or store page: real, useful, and says nothing a listener
     *  could not already see. */
    CATALOGUE: 50,
    /** A directory that scraped a handle. Verified, harmless, and empty. */
    AGGREGATOR: 20,
    /** Anything we could not place. Sits between catalogue and aggregator so an
     *  unrecognised publication is not buried under a scraper. */
    UNKNOWN: 40,
} as const;

/** Hosts that publish credits rather than prose. */
const CREDITS_HOSTS = [
    "discogs.com", "musicbrainz.org", "allmusic.com", "secondhandsongs.com",
    "whosampled.com", "genius.com", "45worlds.com", "rateyourmusic.com",
];

/** Hosts that exist to re-list other platforms' data. A profile here is a
 *  scrape, not a statement. Kept explicit rather than inferred: an unknown host
 *  should rank as unknown, not be guessed into the basement. */
const AGGREGATOR_HOSTS = [
    "clubhousedb.com", "socialblade.com", "musicbrainz-mirror.org",
    "last.fm/user", "kworb.net", "chartmasters.org", "starngage.com",
    "hypeauditor.com", "influencermarketinghub.com", "viewstats.com",
];

/** Streaming, stores and video: the artist's catalogue as anyone can see it. */
const CATALOGUE_HOSTS = [
    "open.spotify.com", "music.apple.com", "deezer.com", "tidal.com",
    "music.amazon.com", "soundcloud.com", "bandcamp.com", "audiomack.com",
    "music.youtube.com", "beatport.com", "traxsource.com",
];

function hostOf(url: string): string {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { return ""; }
}

const matches = (host: string, url: string, list: string[]): boolean =>
    list.some(h => (h.includes("/") ? url.toLowerCase().includes(h) : host === h || host.endsWith(`.${h}`)));

/**
 * Rank one source.
 *
 * `type` is what `inferTypeFromUrl` decided; `ownDomain` is true when the URL is
 * the artist's own site, which the caller knows and this function cannot.
 */
export function sourceAuthority(
    url: string,
    type?: string | null,
    opts?: { ownDomain?: boolean },
): number {
    const host = hostOf(url);
    if (!host) return AUTHORITY.UNKNOWN;

    if (opts?.ownDomain) return AUTHORITY.OWN_SITE;
    if (matches(host, url, CREDITS_HOSTS)) return AUTHORITY.CREDITS;
    if (matches(host, url, AGGREGATOR_HOSTS)) return AUTHORITY.AGGREGATOR;
    if (host === "instagram.com" || host === "x.com" || host === "twitter.com") return AUTHORITY.OWN_WORDS;
    if (matches(host, url, CATALOGUE_HOSTS)) return AUTHORITY.CATALOGUE;

    // An interview or a review is editorial wherever it ran — that judgement
    // comes from the URL shape, not from a list of publications we happen to
    // have heard of. A list would rank a local zine below a scraper.
    if (type === "interview" || type === "review" || type === "article") return AUTHORITY.EDITORIAL;

    return AUTHORITY.UNKNOWN;
}

/** Sort a list of sources best-first, stably. Ties keep their existing order,
 *  which for the vault means "most recently discovered". */
export function byAuthority<T>(
    items: T[],
    read: (item: T) => { url: string; type?: string | null; ownDomain?: boolean },
): T[] {
    return items
        .map((item, i) => ({ item, i, rank: (() => { const r = read(item); return sourceAuthority(r.url, r.type, { ownDomain: r.ownDomain }); })() }))
        .sort((a, b) => (b.rank - a.rank) || (a.i - b.i))
        .map(x => x.item);
}
