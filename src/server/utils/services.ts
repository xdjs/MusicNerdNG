import { Artist } from "../db/DbTypes";

export const artistWeb3Platforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs'];
export const artistPlatforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs', 'x', 'audius', 'bandisintown', 'ens', 'facebook', 'instagram', 'lastfm', 'soundcloud', 'tiktok', 'youtubechannel'];


export const getArtistSplitPlatforms = (artist: Artist) => {
    let web3Platforms: string[] = [];
    let socialPlatforms: string[] = [];

    artistPlatforms.forEach(platform => {
        const formattedPlatform = platform.charAt(0).toUpperCase() + platform.slice(1);
        if (artistWeb3Platforms.includes(platform)) {
            if (artist[platform as keyof Artist]) {
                web3Platforms.push(formattedPlatform);
            }
        } else {
            if (artist[platform as keyof Artist]) {
                socialPlatforms.push(formattedPlatform);
            }
        }
    });

    return { web3Platforms, socialPlatforms };
}

type SpotifyDataType = {
    releases: number
}

export const getArtistDetailsText = (artist: Artist, spotifyData: SpotifyDataType) => {
    let web3Platforms = getArtistSplitPlatforms(artist).web3Platforms
    const numSpotifyReleases = (spotifyData != null && spotifyData.releases != null) ? spotifyData.releases : 0;
    if (web3Platforms.length <= 0 && numSpotifyReleases <= 0) return "";

    if (web3Platforms.length <= 0 && numSpotifyReleases > 0) return `${numSpotifyReleases} releases on Spotify`;

    const prefix = numSpotifyReleases > 0 ? `${numSpotifyReleases} releases on Spotify; NFT's released on ` : "NFT's released on "
    if (web3Platforms.length < 2) return prefix + web3Platforms[0]

    if (web3Platforms.length > 1)
        web3Platforms[-1] = `and ${web3Platforms[-1]}`
    return prefix + web3Platforms.join(", ")
}

export function isObjKey<T extends object>(key: PropertyKey, obj: T): key is keyof T {
    return key in obj;
}

export function extractArtistId(artistUrl: string) {
    const urlPatterns = [
        { regex: /^https:\/\/x\.com\/([^/]+)$/, sitename: "x" },
        { regex: /^https:\/\/instagram\.com\/([^/]+)$/, sitename: "instagram" },
        { regex: /^https:\/\/www\.facebook\.com\/([^/]+)$/, sitename: "facebook" },
        { regex: /^https:\/\/supercollector\.xyz\/([^/]+)$/, sitename: "supercollector" },
        { regex: /^https:\/\/www\.bandsintown\.com\/a\/([^/]+)$/, sitename: "bandsintown" },
        { regex: /^https:\/\/hey\.xyz\/u\/([^/]+)$/, sitename: "hey" },
        { regex: /^https:\/\/warpcast\.com\/([^/]+)$/, sitename: "warpcast" },
        { regex: /^https:\/\/www\.twitch\.tv\/([^/]+)$/, sitename: "twitch" },
        { regex: /^https:\/\/futuretape\.xyz\/([^/]+)$/, sitename: "futuretape" },
        { regex: /^https:\/\/linktr\.ee\/([^/]+)$/, sitename: "linktree" },
        { regex: /^https:\/\/audius\.co\/([^/]+)$/, sitename: "audius" },
        { regex: /^https:\/\/beta\.catalog\.works\/([^/]+)$/, sitename: "catalog" },
        { regex: /^https:\/\/([^/]+)\.bandcamp\.com$/, sitename: "bandcamp" },
        { regex: /^https:\/\/www\.youtube\.com\/channel\/([^/]+)$/, sitename: "youtube" },
        { regex: /^https:\/\/www\.sound\.xyz\/([^/]+)$/, sitename: "sound" },
        { regex: /^https:\/\/rainbow\.me\/([^/]+)$/, sitename: "rainbow" },
        { regex: /^https:\/\/wikipedia\.org\/wiki\/([^/]+)$/, sitename: "wikipedia" },
        { regex: /^https:\/\/superbadge\.xyz\/badges\/([^/]+)$/, sitename: "superbadge" },
        { regex: /^https:\/\/www\.tiktok\.com\/@([^/]+)$/, sitename: "tiktok" },
      ];

      for (const { regex, sitename } of urlPatterns) {
        const match = artistUrl.match(regex);
        if (match) {
          return { sitename, id: match[1] }; // Return both site name and captured ID
        }
      }
      return null;

}

