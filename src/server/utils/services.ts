import { Artist, UrlMap } from "../db/DbTypes";

// Import directly from the artist queries module to ensure the symbol is recognised by TypeScript’s type checker
import { getAllLinks } from "./queriesTS"; // Wrapper maintains compatibility with existing mocks

export const artistWeb3Platforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs', 'supercollector', 'wallets', 'ens'];
export const artistPlatforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs', 'x', 'audius', 'bandisintown', 'ens', 'wallets', 'facebook', 'instagram', 'lastfm', 'soundcloud', 'tiktok', 'youtubechannel', 'supercollector'];

//pluh
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

    // Remove ENS and Wallets from web3Platforms
    web3Platforms = web3Platforms.filter(p => p !== 'Ens' && p !== 'Wallets');

    return { web3Platforms, socialPlatforms };
}

type SpotifyDataType = {
    releases: number
}

export const getArtistDetailsText = (artist: Artist, spotifyData: SpotifyDataType) => {
    const numSpotifyReleases = (spotifyData != null && spotifyData.releases != null) ? spotifyData.releases : 0;
    if (numSpotifyReleases <= 0) return "";

    if (numSpotifyReleases > 0) return `${numSpotifyReleases} releases on Spotify`;
    return `${numSpotifyReleases} releases on Spotify`;
}

export function isObjKey<T extends object>(key: PropertyKey, obj: T): key is keyof T {
    return key in obj;
}

export async function extractArtistId(artistUrl: string) {
    // Attempt to decode any percent-encoded characters in the submitted URL so regexes work on human-readable text
    let decodedUrl = artistUrl;
    try {
        decodedUrl = decodeURIComponent(artistUrl);
    } catch {
        // Ignore decoding errors and continue with original string
    }
    const allLinks = await getAllLinks();

    // First attempt existing regex-based matching
    for (const { regex, siteName, cardPlatformName } of allLinks) {
        // Enforce English-only Wikipedia domains
        if (siteName === 'wikipedia') {
            try {
                const provisional = decodedUrl.startsWith('http') ? decodedUrl : `https://${decodedUrl}`;
                const hostname = new URL(provisional).hostname;
                if (!(hostname === 'en.wikipedia.org' || hostname === 'en.m.wikipedia.org')) {
                    // Skip non-English Wikipedia links
                    continue;
                }
            } catch {
                // If URL parsing fails, skip matching for Wikipedia
                continue;
            }
        }
        // Ensure regex is a RegExp instance; DB stores it as text
        let pattern: RegExp;
        try {
            pattern = new RegExp(regex as string, 'i');
            if (siteName === 'ens' || siteName === 'wallets') {
                console.log('[extractArtistId] Compiled regex for', siteName, ':', pattern.source);
            }
        } catch (err) {
            console.error('[extractArtistId] Invalid regex in urlmap row', siteName, ':', regex, err);
            continue; // skip malformed pattern
        }
        const match = decodedUrl.match(pattern);
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
            let extractedId = match[1] || match[2] || match[3];

            // Decode any percent-encoded characters in the captured ID as well
            try {
                if (extractedId) {
                    extractedId = decodeURIComponent(extractedId);
                }
            } catch {
                // ignore errors
            }

            // For X (formerly Twitter) links, strip query parameters like ?si=...
            if (siteName === 'x' && extractedId && extractedId.includes('?')) {
                extractedId = extractedId.split('?')[0];
            }

            // Reject numeric-only SoundCloud IDs (we only accept usernames)
            if (siteName === 'soundcloud' && /^\d+$/.test(extractedId ?? "")) {
                return null;
            }

            // Wallet address (EVM) – rely solely on regex match; no additional validation
            if (siteName === 'wallets') {
                // No API or checksum validation – the regex match above is considered sufficient
            }

            // ENS name – rely solely on regex match; trim and lowercase for consistency
            if (siteName === 'ens' && extractedId) {
                const ensName = extractedId.trim().toLowerCase();
                extractedId = ensName;
            }

            if (!extractedId) return null;

            return { 
                siteName, 
                cardPlatformName, 
                id: extractedId 
            };
        }
    }

    // Reject SoundCloud numeric user-id links (they cannot be converted to profile URLs)
    if (/soundcloud\.com\/user-\d+/i.test(artistUrl)) {
        return null; // Invalid SoundCloud profile URL for our purposes
    }

    // Fallback for SoundCloud username URLs not caught by DB regex
    const soundCloudRow = allLinks.find((l: UrlMap) => l.siteName === 'soundcloud');
    if (soundCloudRow && artistUrl.includes('soundcloud.com')) {
        try {
            const url = new URL(artistUrl.startsWith('http') ? artistUrl : `https://${artistUrl}`);
            const pathSegment = url.pathname.split('/').filter(Boolean)[0];
            if (pathSegment && !/^user-?\d+$/i.test(pathSegment) && !/^\d+$/.test(pathSegment)) {
                return {
                    siteName: 'soundcloud',
                    cardPlatformName: soundCloudRow.cardPlatformName,
                    id: pathSegment
                };
            }
        } catch {
            /* invalid URL */
        }
    }
    // If we exit the loop with no match we log the failure
    console.log('[extractArtistId] No matching platform for URL:', artistUrl);
    return null;
}

