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

