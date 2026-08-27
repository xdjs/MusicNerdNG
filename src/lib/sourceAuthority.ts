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
 * RANKING DOES NOT FILTER, WITH ONE EXCEPTION. Nothing is dropped for scoring
 * low — a low rank means "further down the list", and the artist still decides.
 * Ranking something out of existence is the kind of quiet judgement that loses a
 * real source, and the whole point of the vault is that they get to look.
 *
 * The exception is BLOCKED_HOSTS, added 27 August after Pete found a Boomplay
 * page filed as press about him: "I don't want boom play anywhere so please get
 * rid of that. I don't want any links like that. That seems like just an
 * aggregator of music or something. Not a legit source." Those hosts do not
 * enter the vault at all. The line is not quality — it is authorship: every page
 * on them is generated from a scrape or a catalogue feed, so there is no article
 * to read, no writer, and nothing the artist said. Ranking such a page low still
 * leaves it on their page.
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

/**
 * Hosts with no author. Every page is generated from a scrape, a chart feed or a
 * catalogue dump: streaming-stat dashboards, follower counters, handle
 * directories, "songs MP3 download" catalogue pages. There is no article on
 * them, so there is nothing for the vault to hold and nothing for the document
 * to cite.
 *
 * These are BLOCKED, not merely ranked low — see the note at the top of the
 * file. Blocking is a strong action and the list stays deliberately short and
 * explicit: a host earns a place here by generating every page mechanically, not
 * by being small, foreign or unfamiliar. Boomplay is a real streaming service in
 * Africa and its artist pages are still a catalogue dump; both things are true.
 *
 * To add one, add the registrable domain. That is the whole change.
 */
const BLOCKED_HOSTS = [
    "boomplay.com", "viberate.com", "soundcharts.com", "clubhousedb.com",
    "socialblade.com", "kworb.net", "chartmasters.org", "starngage.com",
    "hypeauditor.com", "influencermarketinghub.com", "viewstats.com",
];

/** Hosts that exist to re-list other platforms' data but are not blocked: a
 *  profile here is a scrape rather than a statement, and it ranks accordingly.
 *  Kept explicit rather than inferred — an unknown host should rank as unknown,
 *  not be guessed into the basement. */
const AGGREGATOR_HOSTS = [
    "musicbrainz-mirror.org", "last.fm/user",
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
    if (matches(host, url, BLOCKED_HOSTS) || matches(host, url, AGGREGATOR_HOSTS)) return AUTHORITY.AGGREGATOR;
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

/**
 * Should this URL be kept out of the vault entirely?
 *
 * Checked at discovery, before a page is fetched or judged — a blocked host is
 * not a source we rank badly, it is not a source. Callers that take URLs FROM
 * THE ARTIST do not consult this: if they paste their own Boomplay page, that is
 * their page and their call.
 */
export function isBlockedSourceHost(url: string): boolean {
    const host = hostOf(url);
    return !!host && matches(host, url, BLOCKED_HOSTS);
}

/**
 * The three tiers the relevance judge is told about.
 *
 * Rank orders a list that already exists; a tier is a fact about the host handed
 * to the model WHILE it decides, so a thin page on a low-signal host has to prove
 * itself where a thin page on an unfamiliar one only has to be readable.
 *
 * The judge calls this with no `type`, deliberately. Whether a page is an
 * interview is a fact about the PAGE, which the judge is reading; passing the
 * search result's guessed type would feed a guess back in as evidence. So a
 * publication we do not recognise is "unknown" here even when its page is
 * plainly editorial, and the judge decides that from the page.
 */
export type SourceTier = "preferred" | "unknown" | "low-signal";

export function sourceTier(
    url: string,
    type?: string | null,
    opts?: { ownDomain?: boolean },
): SourceTier {
    const rank = sourceAuthority(url, type, opts);
    if (rank >= AUTHORITY.OWN_WORDS) return "preferred";
    if (rank <= AUTHORITY.AGGREGATOR) return "low-signal";
    return "unknown";
}
