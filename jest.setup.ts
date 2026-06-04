// @ts-nocheck
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
import { configure } from '@testing-library/react';
import React from 'react';
import './src/test/setup/testEnv';

// Polyfill TextEncoder/TextDecoder for viem and web3 libraries
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Make React available globally for tests
global.React = React;

// Add clearImmediate polyfill
if (!global.clearImmediate) {
    global.clearImmediate = function(immediateId: any) {
        clearTimeout(immediateId);
    } as any;
}

if (!global.setImmediate) {
    global.setImmediate = Object.assign(
        function(callback: Function) {
            return setTimeout(callback, 0);
        },
        { __promisify__: () => Promise.resolve() }
    ) as any;
}

// Extend expect with jest-dom matchers
expect.extend({});

// Configure testing-library
configure({
    testIdAttribute: 'data-testid',
});

// Mock window.matchMedia (skip in node environment, e.g. API smoke tests)
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        })),
    });

    // Mock IntersectionObserver
    const mockIntersectionObserver = jest.fn();
    mockIntersectionObserver.mockReturnValue({
        observe: () => null,
        unobserve: () => null,
        disconnect: () => null
    });
    window.IntersectionObserver = mockIntersectionObserver;

    // Mock ResizeObserver
    window.ResizeObserver = jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
    }));
}

// Mock window.fetch
global.fetch = jest.fn(() =>
    Promise.resolve({
        json: () => Promise.resolve([]), // Return empty array by default for leaderboard APIs
        ok: true,
        status: 200,
        statusText: 'OK',
    })
) as jest.Mock;

// Mock next/router
jest.mock('next/router', () => ({
    useRouter: () => ({
        route: '/',
        pathname: '',
        query: '',
        asPath: '',
        push: jest.fn(),
        replace: jest.fn(),
        reload: jest.fn(),
        back: jest.fn(),
        prefetch: jest.fn(),
        beforePopState: jest.fn(),
        events: {
            on: jest.fn(),
            off: jest.fn(),
            emit: jest.fn(),
        },
        isFallback: false,
    }),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
    }),
    usePathname: () => '',
    useSearchParams: () => new URLSearchParams(),
}));

// next-auth mock removed - authentication disabled

// Mock database (drizzle) globally for tests
jest.mock('@/server/db/drizzle', () => {
    const jestFn = () => jest.fn();
    const makeTable = () => ({
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        insert: jest.fn(),
    });

    const baseDb = {
        query: {
            urlmap: makeTable(),
            artists: makeTable(),
            users: makeTable(),
            ugcresearch: makeTable(),
            artistClaims: makeTable(),
            artistVaultSources: makeTable(),
            artistIdMappings: makeTable(),
        },
        insert: jest.fn(),
        update: jest.fn(),
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        execute: jest.fn(),
    };
    return {
        db: baseDb,
        ...baseDb,
    };
});

// Ensure db mock has full surface even if overwritten in individual tests
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dbModule = require('@/server/db/drizzle');
    const { db } = dbModule;
    if (db) {
        const ensureFn = (obj: any, key: string) => {
            if (!obj[key]) obj[key] = jest.fn();
        };
        // top-level functions
        ['insert', 'update', 'delete', 'select', 'from', 'where', 'limit', 'execute'].forEach(k => ensureFn(db, k));

        const tables = ['urlmap', 'artists', 'users', 'ugcresearch', 'artistClaims', 'artistVaultSources', 'artistIdMappings'];
        tables.forEach(t => {
            if (!db.query[t]) db.query[t] = {};
            ['findFirst', 'findMany', 'update', 'insert', 'delete'].forEach(k => ensureFn(db.query[t], k));
        });

        // also ensure root-level helpers
        ['execute', 'insert', 'update'].forEach(k => ensureFn(dbModule, k));
    }
} catch (e) {
    // module may not be mocked yet in some environments – ignore
}

// Suppress console errors during tests
const originalError = console.error;
console.error = (...args) => {
    if (args[0]?.includes?.('Warning: ReactDOM.render is no longer supported')) {
        return;
    }
    originalError.call(console, ...args);
};

// Handle unhandled promise rejections to prevent Jest worker crashes
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process during tests, just log
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit the process during tests, just log
});

// Ensure no Discord webhook during unit tests unless explicitly set
// @ts-ignore
delete (process.env as any).DISCORD_WEBHOOK_URL;

// Mock the OpenAI SDK to avoid real API calls and environment errors in JSDOM
jest.mock('openai', () => {
    class MockChatCompletion {
        completions = {
            create: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'mocked response' } }] })
        };
    }
    return {
        __esModule: true,
        default: class MockOpenAI {
            constructor() {
                this.chat = new MockChatCompletion();
            }
        }
    };
});

// Mock the Google GenAI SDK to avoid real API calls
jest.mock('@google/genai', () => ({
    GoogleGenAI: class {
        models = {
            generateContent: jest.fn().mockResolvedValue({ text: 'mocked gemini response' })
        };
    }
}));

// Mock musicPlatformData to prevent ESM p-limit import chain in consumer tests.
// Tests for the providers themselves (spotifyProvider.test.ts, deezerProvider.test.ts,
// artistMusicPlatformDataProvider.test.ts) mock p-limit directly and use jest.resetModules().
jest.mock('@/server/utils/musicPlatform', () => ({
    musicPlatformData: {
        getArtist: jest.fn().mockResolvedValue(null),
        getArtistImage: jest.fn().mockResolvedValue(null),
        getTopTrackName: jest.fn().mockResolvedValue(null),
        searchArtists: jest.fn().mockResolvedValue([]),
        getArtistImages: jest.fn().mockResolvedValue(new Map()),
        getActivePlatform: jest.fn().mockReturnValue(null),
    },
    SpotifyProvider: jest.fn(),
    DeezerProvider: jest.fn(),
    ArtistMusicPlatformDataProvider: jest.fn(),
}));

// Mock server actions to prevent function not found errors
jest.mock('@/app/actions/serverActions', () => ({
    getUgcStatsInRangeAction: jest.fn().mockResolvedValue({ ugcCount: 0, artistsCount: 0 }),
    addArtistDataAction: jest.fn(),
    approveUgcAdminAction: jest.fn(),
    searchForUsersByWalletAction: jest.fn(),
    addUsersToWhitelistAction: jest.fn(),
    removeFromWhitelistAction: jest.fn(),
    addUsersToAdminAction: jest.fn(),
    removeFromAdminAction: jest.fn(),
})); 