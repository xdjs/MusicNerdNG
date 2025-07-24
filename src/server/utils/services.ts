import { Artist, UrlMap } from "../db/DbTypes";

// Import directly from the artist queries module to ensure the symbol is recognised by TypeScript’s type checker
import { getAllLinks } from "./queries/queriesTS"; // Wrapper maintains compatibility with existing mocks

export const artistWeb3Platforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs', 'supercollector', 'wallets', 'ens'];
export const artistPlatforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs', 'x', 'audius', 'bandisintown', 'ens', 'wallets', 'facebook', 'instagram', 'lastfm', 'soundcloud', 'tiktok', 'youtube', 'youtubechannel', 'supercollector'];


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
                console.debug('[extractArtistId] Compiled regex for', siteName, ':', pattern.source);
            }
        } catch (err) {
            console.error('[extractArtistId] Invalid regex in urlmap row', siteName, ':', regex, err);
            continue; // skip malformed pattern
        }
        const match = decodedUrl.match(pattern);
        if (match) {
            // Enhanced YouTube URL handling to distinguish between channel IDs and usernames
            if (siteName === 'youtubechannel') {
                // Handle multiple YouTube URL formats
                // Pattern should match: 
                // - https://youtube.com/channel/CHANNEL_ID or https://www.youtube.com/channel/CHANNEL_ID
                // - https://youtube.com/@USERNAME or https://www.youtube.com/@USERNAME  
                // - https://youtube.com/USERNAME or https://www.youtube.com/USERNAME (new format)
                
                const channelId = match[2]; // From /channel/ID pattern (group 2)
                const atUsername = match[3]; // From /@username pattern (group 3)
                const plainUsername = match[4]; // From /username pattern (group 4)
                
                // If it's a channel ID (starts with UC typically, or matches /channel/ pattern)
                if (channelId) {
                    return {
                        siteName: 'youtubechannel',
                        cardPlatformName,
                        id: channelId
                    };
                }
                
                // If it's an @username format
                if (atUsername) {
                    return { 
                        siteName: 'youtube', 
                        cardPlatformName, 
                        id: atUsername.startsWith('@') ? atUsername : `@${atUsername}` 
                    };
                }
                
                // If it's a plain username format (new support for youtube.com/USERNAME)
                if (plainUsername) {
                    return { 
                        siteName: 'youtube', 
                        cardPlatformName, 
                        id: plainUsername.startsWith('@') ? plainUsername : `@${plainUsername}` 
                    };
                }
            }
            
            // Handle dedicated YouTube username platform parsing
            if (siteName === 'youtube') {
                // YouTube username platform regex: ^https://(www\.)?youtube\.com/(?:@([^/]+)|([^/]+))$
                // Group 1: optional www
                // Group 2: @username capture group  
                // Group 3: plain username capture group
                
                const atUsername = match[2]; // From @([^/]+) pattern
                const plainUsername = match[3]; // From ([^/]+) pattern
                
                // Extract the actual username (prefer @username over plain username)
                if (atUsername) {
                    return {
                        siteName: 'youtube',
                        cardPlatformName,
                        id: atUsername.startsWith('@') ? atUsername : `@${atUsername}`
                    };
                }
                
                if (plainUsername) {
                    return {
                        siteName: 'youtube', 
                        cardPlatformName,
                        id: plainUsername.startsWith('@') ? plainUsername : `@${plainUsername}`
                    };
                }
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
    console.debug('[extractArtistId] No matching platform for URL:', artistUrl);
    return null;
}

