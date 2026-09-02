/**
 * Every platform we store an id for, and where that id lives.
 *
 * WAS ELEVEN OF THIRTY. urlmap configures thirty platforms and this listed
 * eleven, so discovery was blind to nineteen — including discogs (22,862
 * artists), wikipedia (7,606), imdb (5,201) and linktree (2,238). The visible
 * cost: an artist's own Linktree could be filed as press about them, because
 * the "is this a profile we already hold" check had never heard of linktree.
 *
 * NOT DERIVED FROM urlmap, though it is checked against it. Deriving the host
 * from the url template gives the wrong answer for the platforms that matter
 * most: bandcamp's template is `%@.bandcamp.com`, so a substituted host reads
 * `x.bandcamp.com`; spotify's resolves to `open.spotify.com`, which is
 * NARROWER than the correct `spotify.com` and would stop matching the bare
 * domain. `ens` and `wallet` carry placeholder urls. Derivation would have
 * shipped a subtler version of the bug it was meant to fix.
 *
 * So it stays explicit, and scripts/check-platform-coverage.ts fails loudly
 * when urlmap holds a platform this does not classify — drift becomes a
 * failure rather than a silence.
 */
const PLATFORM_DOMAINS_EXTRA: Record<string, string[]> = {
    audius: ["audius.co"],
    bandsintown: ["bandsintown.com"],
    bluesky: ["bsky.app"],
    catalog: ["catalog.works"],
    discogs: ["discogs.com"],
    facebookID: ["facebook.com", "fb.com"],
    farcaster: ["farcaster.xyz", "warpcast.com"],
    foundation: ["foundation.app"],
    imdb: ["imdb.com"],
    lens: ["hey.xyz", "lens.xyz"],
    linktree: ["linktr.ee"],
    mirror: ["mirror.xyz"],
    patreon: ["patreon.com"],
    soundxyz: ["sound.xyz"],
    subvert: ["subvert.fm"],
    supercollector: ["supercollector.xyz"],
    wikipedia: ["wikipedia.org"],
    zora: ["zora.co"],
};

export const PROFILE_LINK_COLUMNS = [
    "spotify", "deezer", "instagram", "tiktok", "x", "youtube",
    "youtubechannel", "soundcloud", "bandcamp", "twitch", "facebook",
    ...Object.keys(PLATFORM_DOMAINS_EXTRA),
] as const;

/**
 * The subset worth handing the relevance judge as evidence of WHO the artist is.
 *
 * Narrower than the list above on purpose, and the reason is mentionDensity:
 * it treats every identifier as a handle to look for in a page's paragraphs, so
 * an opaque value poisons the count. discogs is `1967268` and facebookID is
 * `399778650221956` — any page containing that digit string would read as
 * being about the artist. imdb is `nm8483808`, which is not a name either.
 *
 * What is in here is name-shaped, checked against real rows: wikipedia is
 * `Billie_Eilish`, bandsintown is `12895856-billie-eilish`, and the rest are
 * handles a person chose. Crypto identities (ens, mirror, zora, lens,
 * farcaster) are left out: they are wallet names rather than artist names, and
 * ".eth" appearing in a paragraph says nothing about whose page it is.
 */
export const IDENTITY_ANCHOR_COLUMNS = [
    "spotify", "deezer", "instagram", "tiktok", "x", "youtube",
    "youtubechannel", "soundcloud", "bandcamp", "twitch", "facebook",
    "wikipedia", "bandsintown", "linktree", "audius", "catalog",
    "patreon", "supercollector", "subvert", "soundxyz",
] as const;

export const PLATFORM_DOMAINS: Record<string, string[]> = {
    spotify: ["spotify.com"],
    deezer: ["deezer.com"],
    instagram: ["instagram.com"],
    tiktok: ["tiktok.com"],
    x: ["x.com", "twitter.com"],
    youtube: ["youtube.com", "youtu.be"],
    youtubechannel: ["youtube.com"],
    soundcloud: ["soundcloud.com"],
    bandcamp: ["bandcamp.com"],
    twitch: ["twitch.tv"],
    facebook: ["facebook.com", "fb.com"],
    ...PLATFORM_DOMAINS_EXTRA,
};
