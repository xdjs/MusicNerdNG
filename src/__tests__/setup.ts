import '@testing-library/jest-dom/extend-expect';
import { describe, it, expect } from '@jest/globals';

// Mock environment variables
Object.defineProperty(process, 'env', {
    value: {
        ...process.env,
        NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID: 'test_client_id',
        SPOTIFY_WEB_CLIENT_SECRET: 'test_client_secret',
        NEXTAUTH_SECRET: 'test_secret',
        NEXTAUTH_URL: 'http://localhost:3000',
        NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT: 'true',
        NODE_ENV: 'test'
    }
});

// Mock next/headers since it's not available in test environment
jest.mock('next/headers', () => ({
    cookies: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
    })),
    headers: jest.fn(),
}));

// Mock next-auth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

// Mock auth options
jest.mock('@/server/auth', () => ({
    authOptions: {
        providers: [
            {
                id: 'credentials',
                name: 'Credentials',
                credentials: {
                    message: { label: 'Message', type: 'text' },
                    signature: { label: 'Signature', type: 'text' }
                },
                authorize: jest.fn()
            }
        ],
        session: {
            strategy: 'jwt',
            maxAge: 30 * 24 * 60 * 60,
        },
        cookies: {
            sessionToken: {
                name: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
                options: {
                    httpOnly: true,
                    sameSite: 'lax',
                    path: '/',
                    secure: process.env.NODE_ENV === 'production'
                },
            },
        },
        callbacks: {
            jwt: jest.fn(),
            session: jest.fn(),
            redirect: jest.fn((params) => {
                const { url, baseUrl } = params;
                if (url.startsWith('/')) return url;
                if (new URL(url).origin === baseUrl) return url;
                return baseUrl;
            }),
        },
    }
}));

// Reset all mocks before each test
beforeEach(() => {
    jest.clearAllMocks();
});

describe('Test Environment Setup', () => {
    it('should have proper environment variables', () => {
        expect(process.env.NODE_ENV).toBeDefined();
    });

    it('should have proper global mocks', () => {
        expect(global.fetch).toBeDefined();
        expect(global.Request).toBeDefined();
        expect(global.Response).toBeDefined();
    });
}); 