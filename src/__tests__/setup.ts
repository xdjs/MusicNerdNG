import '@testing-library/jest-dom/vitest';
import { vi, beforeEach } from 'vitest';

// Mock environment variables
vi.stubEnv('NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID', 'test_client_id');
vi.stubEnv('SPOTIFY_WEB_CLIENT_SECRET', 'test_client_secret');
vi.stubEnv('NEXTAUTH_SECRET', 'test_secret');
vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
vi.stubEnv('NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT', 'true');
vi.stubEnv('NODE_ENV', 'test');

// Mock next/headers since it's not available in test environment
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(),
}));

// Mock next-auth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

// Mock auth options
vi.mock('@/server/auth', () => ({
  authOptions: {
    providers: [
      {
        id: 'credentials',
        name: 'Credentials',
        credentials: {
          message: { label: 'Message', type: 'text' },
          signature: { label: 'Signature', type: 'text' }
        },
        authorize: vi.fn()
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
      jwt: vi.fn(),
      session: vi.fn(),
      redirect: vi.fn((params) => {
        const { url, baseUrl } = params;
        // Allow relative URLs
        if (url.startsWith('/')) return url;
        // Allow URLs from same origin
        if (new URL(url).origin === baseUrl) return url;
        return baseUrl;
      }),
    },
  }
}));

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
}); 