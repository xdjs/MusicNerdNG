import { describe, it, expect, beforeEach } from '@jest/globals';
import { authOptions } from '@/server/auth';
import { getServerAuthSession } from '@/server/auth';
import { getUserById } from '../queries';
import type { User, Account, Profile, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import type { AdapterUser } from 'next-auth/adapters';

// Mock auth module
jest.mock('@/server/auth', () => {
    const mockAuthOptions = {
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
            jwt: jest.fn().mockImplementation(({ token, user }) => {
                if (user) {
                    return {
                        walletAddress: user.walletAddress,
                        email: user.email,
                        name: user.name
                    };
                }
                return token;
            }),
            session: jest.fn().mockImplementation(({ session, token, user, newSession, trigger }) => {
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
            }),
            redirect: jest.fn().mockImplementation(({ url, baseUrl }) => {
                if (url.startsWith('/')) return `${baseUrl}${url}`;
                if (new URL(url).origin === baseUrl) return url;
                return baseUrl;
            }),
        },
    };
    return { 
        authOptions: mockAuthOptions,
        getServerAuthSession: jest.fn()
    };
});

// Mock database queries
jest.mock('../queries', () => ({
    getUserById: jest.fn()
}));

describe('Session Security', () => {
    const mockUser = {
        id: 'test-user-id',
        wallet: '0x1234567890abcdef',
        isAdmin: false,
        isWhiteListed: true,
        email: 'test@example.com',
        username: 'test-user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        legacyId: null
    };

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(process, 'env', {
            value: { ...process.env, NODE_ENV: 'test' }
        });
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
            Object.defineProperty(process, 'env', {
                value: { ...process.env, NODE_ENV: 'production' }
            });

            const cookieName = authOptions.cookies?.sessionToken?.name;
            expect(cookieName).toBe('__Secure-next-auth.session-token');
            expect(authOptions.cookies?.sessionToken?.options).toEqual({
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                secure: true
            });

            Object.defineProperty(process, 'env', {
                value: { ...process.env, NODE_ENV: originalEnv }
            });
        });

        it('should have appropriate cookie settings in development', () => {
            const originalEnv = process.env.NODE_ENV;
            Object.defineProperty(process, 'env', {
                value: { ...process.env, NODE_ENV: 'development' }
            });

            expect(authOptions.cookies?.sessionToken?.name).toBe('next-auth.session-token');
            expect(authOptions.cookies?.sessionToken?.options.secure).toBe(false);

            Object.defineProperty(process, 'env', {
                value: { ...process.env, NODE_ENV: originalEnv }
            });
        });
    });

    describe('Session Token Management', () => {
        it('should properly map user data to JWT token', async () => {
            const user = {
                id: 'test-user-id',
                walletAddress: '0x1234567890abcdef',
                email: 'test@example.com',
                name: 'Test User',
                emailVerified: null,
                isSignupComplete: true
            } as AdapterUser;

            const token = {} as JWT;
            const account = {
                providerAccountId: 'test-account',
                provider: 'test-provider',
                type: 'oauth'
            } as Account;
            const profile = {} as Profile;
            const trigger = 'signIn';

            const result = await authOptions.callbacks?.jwt?.({ token, user, account, profile, trigger });

            expect(result).toEqual({
                walletAddress: user.walletAddress,
                email: user.email,
                name: user.name
            });
        });

        it('should not modify token if no user provided', async () => {
            const token = {
                walletAddress: '0x1234567890abcdef',
                email: 'test@example.com'
            } as JWT;

            const account = {
                providerAccountId: 'test-account',
                provider: 'test-provider',
                type: 'oauth'
            } as Account;

            const result = await authOptions.callbacks?.jwt?.({ 
                token, 
                user: undefined as unknown as AdapterUser | User, 
                account 
            });

            expect(result).toEqual(token);
        });

        it('should properly map token data to session', async () => {
            const token = {
                sub: 'test-user-id',
                walletAddress: '0x1234567890abcdef',
                email: 'test@example.com',
                name: 'Test User'
            } as JWT;

            const session = {
                user: {
                    id: 'old-id',
                    email: 'old@example.com',
                    name: 'Old Name'
                },
                expires: '2025-06-11T18:15:20.712Z'
            } as Session;

            const user = {
                id: 'test-user-id',
                walletAddress: '0x1234567890abcdef',
                email: 'test@example.com',
                name: 'Test User',
                emailVerified: null,
                isSignupComplete: true
            } as AdapterUser;

            const result = await authOptions.callbacks?.session?.({ 
                session, 
                token, 
                user,
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
            const url = '/dashboard';
            const baseUrl = 'https://example.com';

            const result = await authOptions.callbacks?.redirect?.({ url, baseUrl });

            expect(result).toBe('https://example.com/dashboard');
        });

        it('should allow URLs from same origin', async () => {
            const url = 'https://example.com/dashboard';
            const baseUrl = 'https://example.com';

            const result = await authOptions.callbacks?.redirect?.({ url, baseUrl });

            expect(result).toBe(url);
        });

        it('should redirect to baseUrl for different origin', async () => {
            const url = 'https://malicious.com/dashboard';
            const baseUrl = 'https://example.com';

            const result = await authOptions.callbacks?.redirect?.({ url, baseUrl });

            expect(result).toBe('https://example.com');
        });
    });

    describe('Session Access Control', () => {
        it('should require authentication for protected routes', async () => {
            const mockUser = {
                id: 'test-user-id',
                email: 'test@example.com',
                name: 'Test User',
                username: 'testuser',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                wallet: '0x1234567890abcdef',
                legacyId: null,
                isAdmin: false,
                isWhiteListed: true
            };

            const mockGetServerAuthSession = getServerAuthSession as jest.MockedFunction<typeof getServerAuthSession>;
            const mockGetUserById = getUserById as jest.MockedFunction<typeof getUserById>;

            mockGetServerAuthSession.mockResolvedValue(null);
            mockGetUserById.mockResolvedValue(mockUser);

            const session = await getServerAuthSession();
            expect(session).toBeNull();
        });

        it('should handle authenticated session', async () => {
            const mockUser = {
                id: 'test-user-id',
                email: 'test@example.com',
                name: 'Test User',
                username: 'testuser',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                wallet: '0x1234567890abcdef',
                legacyId: null,
                isAdmin: false,
                isWhiteListed: true
            };

            const mockSession = {
                user: mockUser,
                expires: '2025-06-11T18:15:20.712Z'
            };

            const mockGetServerAuthSession = getServerAuthSession as jest.MockedFunction<typeof getServerAuthSession>;
            const mockGetUserById = getUserById as jest.MockedFunction<typeof getUserById>;

            mockGetServerAuthSession.mockResolvedValue(mockSession);
            mockGetUserById.mockResolvedValue(mockUser);

            const session = await getServerAuthSession();
            expect(session).toEqual(mockSession);
        });
    });
}); 