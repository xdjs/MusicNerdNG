import { enableFetchMocks } from 'jest-fetch-mock';

// Enable fetch mocks
enableFetchMocks();

// Set up URL for test environment
if (typeof global.URL === 'undefined') {
    global.URL = URL;
}

// Set up URLSearchParams for test environment
if (typeof global.URLSearchParams === 'undefined') {
    global.URLSearchParams = URLSearchParams;
} 