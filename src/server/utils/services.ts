import { Artist } from "../db/DbTypes";

import { getAllLinks } from "./queriesTS";

export const artistWeb3Platforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs', 'supercollector'];
export const artistPlatforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs', 'x', 'audius', 'bandisintown', 'ens', 'facebook', 'instagram', 'lastfm', 'soundcloud', 'tiktok', 'youtubechannel', 'supercollector'];


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

    const prefix = numSpotifyReleases > 0 ? `${numSpotifyReleases} releases on Spotify; NFTs released on ` : "NFTs released on "
    if (web3Platforms.length < 2) return prefix + web3Platforms[0]

    if (web3Platforms.length > 1)
        web3Platforms[-1] = `and ${web3Platforms[-1]}`
    return prefix + web3Platforms.join(", ")
}

export function isObjKey<T extends object>(key: PropertyKey, obj: T): key is keyof T {
    return key in obj;
}

export async function extractArtistId(artistUrl: string) {
    const allLinks = await getAllLinks();
    for (const { regex, siteName, cardPlatformName } of allLinks) {
        // Special-case Wikipedia: only allow English (en.wikipedia.org)
        if (siteName === 'wikipedia') {
            try {
                // Ensure the URL is valid by prepending protocol if missing
                const provisionalUrl = artistUrl.startsWith('http') ? artistUrl : `https://${artistUrl}`;
                const { hostname } = new URL(provisionalUrl);
                // Accept only en.wikipedia.org and its mobile counterpart en.m.wikipedia.org
                if (!(hostname === 'en.wikipedia.org' || hostname === 'en.m.wikipedia.org')) {
                    // Skip non-English Wikipedia links
                    continue;
                }
            } catch {
                // If URL parsing fails, treat as non-matching and continue
                continue;
            }
        }
        const match = artistUrl.match(regex);
        if (match) {
            // For YouTube channel URLs, keep channel IDs as is and ensure usernames have @ prefix
            if (siteName === 'youtubechannel') {
                const channelId = match[1];
                const username = match[2];
                if (username) {
                    return { 
                        siteName, 
                        cardPlatformName, 
                        id: username.startsWith('@') ? username : `@${username}` 
                    };
                }
                return {
                    siteName,
                    cardPlatformName,
                    id: channelId
                };
            }
            let extractedId = match[1] || match[2];

            // For X (formerly Twitter) links, strip query parameters like ?si=...
            if (siteName === 'x' && extractedId && extractedId.includes('?')) {
                extractedId = extractedId.split('?')[0];
            }

            return { 
                siteName, 
                cardPlatformName, 
                id: extractedId 
            };
        }
    }
    return null;
}

