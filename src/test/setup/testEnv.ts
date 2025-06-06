import { enableFetchMocks } from 'jest-fetch-mock';

// Enable fetch mocks
enableFetchMocks();

// Set up Spotify credentials from environment variables
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID || 'test-client-id';
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET = process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET || 'test-client-secret';

// Set up URL for test environment
if (typeof global.URL === 'undefined') {
    global.URL = URL;
}

// Set up URLSearchParams for test environment
if (typeof global.URLSearchParams === 'undefined') {
    global.URLSearchParams = URLSearchParams;
} 