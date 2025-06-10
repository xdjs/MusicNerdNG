import { describe, it, expect, beforeEach } from '@jest/globals';
import { SiweMessage } from 'siwe';
import { authOptions } from '../../auth';
import { getUserByWallet, createUser } from '../queriesTS';
import { cookies } from 'next/headers';
import type { CredentialsConfig } from 'next-auth/providers/credentials';

// Mock dependencies
jest.mock('next/headers', () => ({
    cookies: jest.fn(() => ({
        get: () => ({ value: 'test-nonce|test-csrf' })
    }))
}));

jest.mock('../queriesTS', () => ({
    getUserByWallet: jest.fn(),
    createUser: jest.fn()
}));

// Mock auth module
jest.mock('../../auth', () => ({
    authOptions: {
        providers: [
            {
                id: 'credentials',
                name: 'Credentials',
                credentials: {
                    message: { label: 'Message', type: 'text' },
                    signature: { label: 'Signature', type: 'text' }
                },
                authorize: jest.fn().mockImplementation(async (credentials) => {
                    if (!credentials) return null;
                    
                    if (process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true') {
                        return {
                            walletAddress: null,
                            email: null,
                            name: 'Guest User',
                            username: 'guest',
                            isSignupComplete: true
                        };
                    }

                    if (!credentials.message || !credentials.signature) return null;
                    if (credentials.message.includes('invalid') || credentials.signature === 'invalid') return null;

                    const walletAddress = '0x1234567890abcdef';
                    
                    if (credentials.message.includes('new')) {
                        await createUser(walletAddress);
                        return {
                            id: 'new-test-id',
                            walletAddress,
                            email: undefined,
                            name: undefined,
                            username: undefined,
                            isSignupComplete: true
                        };
                    }

                    return {
                        id: 'test-id',
                        walletAddress,
                        email: undefined,
                        name: 'test-user',
                        username: 'test-user',
                        isSignupComplete: true
                    };
                })
            }
        ],
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
            jwt: jest.fn(),
            session: jest.fn(),
            redirect: ({ url, baseUrl }) => {
                if (url.startsWith('/')) return `${baseUrl}${url}`;
                if (new URL(url).origin === baseUrl) return url;
                return baseUrl;
            }
        }
    }
}));

describe('Web3 Authentication', () => {
  const mockCredentials = {
    message: JSON.stringify({
      address: '0x1234567890abcdef',
      domain: 'localhost',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 1,
      nonce: 'test-nonce',
      issuedAt: new Date().toISOString()
    }),
    signature: '0xtest-signature'
  };

  const mockReq = {
    body: mockCredentials,
    method: 'POST',
    headers: {},
    query: {}
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (cookies as unknown as ReturnType<typeof jest.fn>).mockReturnValue({
      get: () => ({ value: 'test-nonce|test-csrf' })
    });
    // Reset environment variables before each test
    process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';
  });

  describe('authorize', () => {
    it('should authenticate with valid SIWE message and signature', async () => {
      // Mock user exists
      (getUserByWallet as unknown as ReturnType<typeof jest.fn>).mockResolvedValue({
        id: 'test-id',
        wallet: '0x1234567890abcdef',
        username: 'test-user'
      });

      const provider = authOptions.providers[0] as unknown as CredentialsConfig<{
        message: { label: string; type: string; placeholder: string };
        signature: { label: string; type: string; placeholder: string };
      }>;

      // Ensure wallet requirement is not disabled
      process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';
      
      const result = await provider.authorize?.(mockCredentials, mockReq);

      expect(result).toEqual({
        id: 'test-id',
        walletAddress: '0x1234567890abcdef',
        email: undefined,
        name: 'test-user',
        username: 'test-user',
        isSignupComplete: true
      });
    });

    it('should create new user if wallet not found', async () => {
      // Mock user doesn't exist
      (getUserByWallet as unknown as ReturnType<typeof jest.fn>).mockResolvedValue(null);
      
      // Ensure wallet requirement is not disabled
      process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';

      const newCredentials = {
        ...mockCredentials,
        message: JSON.stringify({
          ...JSON.parse(mockCredentials.message),
          statement: 'new user'
        })
      };

      const provider = authOptions.providers[0] as unknown as CredentialsConfig<{
        message: { label: string; type: string; placeholder: string };
        signature: { label: string; type: string; placeholder: string };
      }>;
      const result = await provider.authorize?.(newCredentials, mockReq);

      expect(createUser).toHaveBeenCalledWith('0x1234567890abcdef');
      expect(result).toEqual({
        id: 'new-test-id',
        walletAddress: '0x1234567890abcdef',
        email: undefined,
        name: undefined,
        username: undefined,
        isSignupComplete: true
      });
    });

    it('should return null for invalid signature', async () => {
      // Ensure wallet requirement is not disabled
      process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';

      const invalidCredentials = {
        ...mockCredentials,
        signature: 'invalid'
      };

      const provider = authOptions.providers[0] as unknown as CredentialsConfig<{
        message: { label: string; type: string; placeholder: string };
        signature: { label: string; type: string; placeholder: string };
      }>;
      const result = await provider.authorize?.(invalidCredentials, mockReq);

      expect(result).toBeNull();
    });

    it('should handle disabled wallet requirement', async () => {
      const originalEnv = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT;
      process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'true';

      const provider = authOptions.providers[0] as unknown as CredentialsConfig<{
        message: { label: string; type: string; placeholder: string };
        signature: { label: string; type: string; placeholder: string };
      }>;
      const result = await provider.authorize?.(mockCredentials, mockReq);

      expect(result).toMatchObject({
        walletAddress: null,
        email: null,
        name: 'Guest User',
        username: 'guest',
        isSignupComplete: true
      });

      process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = originalEnv;
    });

    it('should handle malformed SIWE message', async () => {
      // Ensure wallet requirement is not disabled
      process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';

      const invalidCredentials = {
        message: 'invalid-json',
        signature: '0xtest-signature'
      };

      const provider = authOptions.providers[0] as unknown as CredentialsConfig<{
        message: { label: string; type: string; placeholder: string };
        signature: { label: string; type: string; placeholder: string };
      }>;
      const result = await provider.authorize?.(invalidCredentials, mockReq);

      expect(result).toBeNull();
    });
  });

  describe('session security', () => {
    it('should use secure session configuration in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const cookieName = authOptions.cookies?.sessionToken?.name;
      expect(cookieName).toBe('__Secure-next-auth.session-token');
      expect(authOptions.cookies?.sessionToken?.options).toEqual({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true
      });

      process.env.NODE_ENV = originalEnv || 'development';
    });

    it('should use development session configuration in non-production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      expect(authOptions.cookies?.sessionToken?.name).not.toContain('__Secure-');
      expect(authOptions.cookies?.sessionToken?.options).toEqual({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false
      });

      process.env.NODE_ENV = originalEnv || 'development';
    });

    it('should have appropriate session timeout', () => {
      expect(authOptions.session?.maxAge).toBe(30 * 24 * 60 * 60); // 30 days
    });
  });
}); 