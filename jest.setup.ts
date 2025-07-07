// @ts-nocheck
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
import { configure } from '@testing-library/react';
import React from 'react';
import './src/test/setup/testEnv';

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

// Mock window.matchMedia
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

// Mock window.fetch
global.fetch = jest.fn(() =>
    Promise.resolve({
        json: () => Promise.resolve({}),
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

        const tables = ['urlmap', 'artists', 'users', 'ugcresearch'];
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