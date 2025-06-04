import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authOptions } from '../../auth';
import { getServerAuthSession } from '../../auth';
import { getUserById } from '../queriesTS';
import type { JWT } from 'next-auth/jwt';
import type { User, Account, Profile, Session } from 'next-auth';
import type { AdapterUser } from 'next-auth/adapters';

// Mock auth module
vi.mock('../../auth', () => ({
  authOptions: {
    session: {
      strategy: 'jwt',
      maxAge: 30 * 24 * 60 * 60,
    },
    cookies: {
      sessionToken: {
        get name() {
          return process.env.NODE_ENV === 'production' 
            ? '__Secure-next-auth.session-token' 
            : 'next-auth.session-token';
        },
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          get secure() {
            return process.env.NODE_ENV === 'production';
          }
        },
      },
    },
    callbacks: {
      jwt: async ({ token, user }: { token: JWT; user?: User }) => {
        if (user) {
          return {
            walletAddress: user.walletAddress,
            email: user.email,
            name: user.name
          };
        }
        return token;
      },
      session: async ({ session, token, user }: { session: Session; token: JWT; user?: AdapterUser }) => {
        return {
          ...session,
          user: {
            ...session.user,
            id: token.sub,
            walletAddress: token.walletAddress,
            email: token.email,
            name: token.name
          }
        };
      },
      redirect: ({ url, baseUrl }: { url: string; baseUrl: string }) => {
        if (url.startsWith('/')) return `${baseUrl}${url}`;
        if (new URL(url).origin === baseUrl) return url;
        return baseUrl;
      },
    },
  },
  getServerAuthSession: vi.fn()
}));

vi.mock('../queriesTS', () => ({
  getUserById: vi.fn()
}));

describe('Session Security', () => {
  const mockUser = {
    id: 'test-user-id',
    wallet: '0x1234567890abcdef',
    isAdmin: false,
    isWhiteListed: true
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Session Configuration', () => {
    it('should use JWT strategy', () => {
      expect(authOptions.session?.strategy).toBe('jwt');
    });

    it('should have appropriate session timeout', () => {
      expect(authOptions.session?.maxAge).toBe(30 * 24 * 60 * 60); // 30 days
    });

    it('should have secure cookie settings in production', () => {
      const originalEnv = process.env.NODE_ENV;
      vi.stubEnv('NODE_ENV', 'production');

      const cookieName = authOptions.cookies?.sessionToken?.name;
      expect(cookieName).toBe('__Secure-next-auth.session-token');
      expect(authOptions.cookies?.sessionToken?.options).toEqual({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true
      });

      vi.stubEnv('NODE_ENV', originalEnv || 'development');
    });

    it('should have appropriate cookie settings in development', () => {
      const originalEnv = process.env.NODE_ENV;
      vi.stubEnv('NODE_ENV', 'development');

      expect(authOptions.cookies?.sessionToken?.name).not.toContain('__Secure-');
      expect(authOptions.cookies?.sessionToken?.options).toEqual({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false
      });

      vi.stubEnv('NODE_ENV', originalEnv || 'development');
    });
  });

  describe('Session Token Management', () => {
    it('should properly map user data to JWT token', async () => {
      const user: User = {
        id: mockUser.id,
        walletAddress: mockUser.wallet,
        email: 'test@example.com',
        name: 'Test User',
        isSignupComplete: true
      };

      const token: JWT = {};
      const account: Account | null = null;
      const profile: Profile | undefined = undefined;
      const trigger: "signIn" | "signUp" | "update" | undefined = "signIn";

      const result = await authOptions.callbacks?.jwt?.({ token, user, account, profile, trigger });

      expect(result).toEqual({
        walletAddress: user.walletAddress,
        email: user.email,
        name: user.name
      });
    });

    it('should not modify token if no user provided', async () => {
      const token: JWT = {
        walletAddress: mockUser.wallet,
        email: 'test@example.com'
      };
      const user: User = {
        id: mockUser.id,
        walletAddress: mockUser.wallet,
        email: 'test@example.com',
        isSignupComplete: true
      };
      const account: Account | null = null;

      const result = await authOptions.callbacks?.jwt?.({ token, user, account });

      expect(result).toEqual(token);
    });

    it('should properly map token data to session', async () => {
      const token: JWT = {
        sub: mockUser.id,
        walletAddress: mockUser.wallet,
        email: 'test@example.com',
        name: 'Test User'
      };

      const session: Session = {
        user: {
          id: 'old-id',
          email: 'old@example.com'
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
      };

      const adapterUser = {
        id: mockUser.id,
        email: 'test@example.com',
        emailVerified: null,
        walletAddress: mockUser.wallet,
        isSignupComplete: true
      } as AdapterUser;

      const result = await authOptions.callbacks?.session?.({ 
        session, 
        token, 
        user: adapterUser,
        newSession: session,
        trigger: 'update'
      });

      expect(result).toEqual({
        ...session,
        user: {
          ...session.user,
          id: token.sub,
          walletAddress: token.walletAddress,
          email: token.email,
          name: token.name
        }
      });
    });
  });

  describe('URL Security', () => {
    it('should allow relative URLs in redirect', async () => {
      const result = await authOptions.callbacks?.redirect?.({
        url: '/dashboard',
        baseUrl: 'https://example.com'
      });

      expect(result).toBe('https://example.com/dashboard');
    });

    it('should allow URLs from same origin', async () => {
      const url = 'https://example.com/dashboard';
      const result = await authOptions.callbacks?.redirect?.({
        url,
        baseUrl: 'https://example.com'
      });

      expect(result).toBe(url);
    });

    it('should redirect to baseUrl for different origin', async () => {
      const result = await authOptions.callbacks?.redirect?.({
        url: 'https://malicious.com',
        baseUrl: 'https://example.com'
      });

      expect(result).toBe('https://example.com');
    });
  });

  describe('Session Access Control', () => {
    it('should require authentication for protected routes', async () => {
      (getServerAuthSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (getUserById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      const session = await getServerAuthSession();
      expect(session).toBeNull();
    });

    it('should provide user data for authenticated sessions', async () => {
      const mockSession: Session = {
        user: {
          id: mockUser.id,
          walletAddress: mockUser.wallet
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
      };

      (getServerAuthSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
      (getUserById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      const session = await getServerAuthSession();
      expect(session).toEqual(mockSession);
    });
  });
}); 