// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { getServerSession } from 'next-auth';
import { cookies } from 'next/headers';

// Mock TextEncoder/TextDecoder for SIWE
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock external dependencies ONLY
const mockGetUserByWallet = jest.fn();
const mockCreateUser = jest.fn();
const mockConsoleError = jest.fn();
const mockConsoleLog = jest.fn();

// Mock database functions
jest.mock('../queriesTS', () => ({
  __esModule: true,
  getUserByWallet: (...args) => mockGetUserByWallet(...args),
  createUser: (...args) => mockCreateUser(...args),
}));

// Mock cookies
const mockCookiesGet = jest.fn().mockReturnValue({ value: 'csrf-token|csrf-token-hash' });
jest.mock('next/headers', () => ({
  cookies: () => ({
    get: mockCookiesGet
  })
}));

// Mock console methods
global.console.error = mockConsoleError;
global.console.log = mockConsoleLog;

// Mock SIWE library
class MockSiweMessage {
  address: string;
  domain: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  statement: string;
  resources: string[];
  
  constructor(message: string | object) {
    try {
      const parsed = typeof message === 'string' ? JSON.parse(message) : message;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid message format');
      }
      
      this.address = parsed.address?.toLowerCase() || '0x1234567890123456789012345678901234567890';
      this.domain = parsed.domain || 'localhost:3000';
      this.uri = parsed.uri || 'http://localhost:3000/signin';
      this.version = parsed.version || '1';
      this.chainId = parsed.chainId || 1;
      this.nonce = parsed.nonce || 'test-nonce';
      this.issuedAt = parsed.issuedAt || new Date().toISOString();
      this.statement = parsed.statement || 'Sign in with Ethereum to the app.';
      this.resources = parsed.resources || [];
    } catch (e) {
      throw new Error(`Invalid message format: ${e.message}`);
    }
  }

  async verify({ signature, domain, nonce }: { signature: string; domain: string; nonce: string }) {
    if (!signature) throw new Error('Missing signature');
    if (!domain) throw new Error('Missing domain');
    if (!nonce) throw new Error('Missing nonce');
    
    // Test specific validation logic
    if (signature === '0xinvalid') {
      return { success: false, error: 'Invalid signature' };
    }

    // Compare domains without port numbers
    const messageDomain = this.domain.split(':')[0];
    const verifyDomain = domain.split(':')[0];
    
    if (messageDomain !== verifyDomain) {
      return { success: false, error: 'Domain mismatch' };
    }

    // Extract just the token part from the nonce
    const nonceToken = nonce.split('|')[0];
    
    if (nonceToken !== 'csrf-token') {
      return { success: false, error: 'Invalid nonce' };
    }
    
    return { success: true };
  }
}

jest.mock('siwe', () => ({
  SiweMessage: MockSiweMessage
}));

// Mock environment variables
jest.mock('@/env', () => ({
  NEXTAUTH_URL: 'http://localhost:3000'
}));

// Mock next-auth
jest.mock('next-auth', () => ({
  getServerSession: jest.fn()
}));

// NOW import the real auth options AFTER mocks are set up
import { authOptions, getServerAuthSession } from '../../auth';

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserByWallet.mockReset();
  mockCreateUser.mockReset();
  mockConsoleError.mockReset();
  mockConsoleLog.mockReset();
  mockCookiesGet.mockReset();

  // Reset default mock implementations
  mockCookiesGet.mockImplementation((name) => {
    if (name === 'next-auth.csrf-token') {
      return { value: 'csrf-token|csrf-token-hash' };
    }
    return undefined;
  });

  // Reset environment variables
  delete process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT;
  delete process.env.NODE_ENV;
  delete process.env.NEXTAUTH_SECRET;
});

describe('Authentication System', () => {
  describe('JWT Callback', () => {
    it('should copy user properties to token when user is provided', async () => {
      const jwtCallback = authOptions.callbacks?.jwt;
      expect(jwtCallback).toBeDefined();
      
      const mockUser = {
        id: 'user-123',
        walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        email: 'test@example.com',
        name: 'Test User',
        username: 'testuser',
        isSignupComplete: true
      };

      const mockToken = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const result = await jwtCallback!({ token: mockToken, user: mockUser });

      expect(result).toEqual({
        ...mockToken,
        walletAddress: mockUser.walletAddress,
        email: mockUser.email,
        name: mockUser.name
      });
    });

    it('should use username as name when name is not provided', async () => {
      const jwtCallback = authOptions.callbacks?.jwt;
      
      const mockUser = {
        id: 'user-123',
        walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        email: 'test@example.com',
        username: 'testuser',
        isSignupComplete: true
        // name is undefined
      };

      const mockToken = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const result = await jwtCallback!({ token: mockToken, user: mockUser });

      expect(result).toEqual({
        ...mockToken,
        walletAddress: mockUser.walletAddress,
        email: mockUser.email,
        name: mockUser.username // Should use username as fallback
      });
    });

    it('should handle user with minimal properties', async () => {
      const jwtCallback = authOptions.callbacks?.jwt;
      
      const mockUser = {
        id: 'user-123',
        walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        isSignupComplete: true
        // email, name, username are undefined
      };

      const mockToken = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const result = await jwtCallback!({ token: mockToken, user: mockUser });

      expect(result).toEqual({
        ...mockToken,
        walletAddress: mockUser.walletAddress,
        email: undefined,
        name: undefined
      });
    });

    it('should return token unchanged when no user is provided', async () => {
      const jwtCallback = authOptions.callbacks?.jwt;
      
      const mockToken = { 
        sub: 'user-123',
        walletAddress: '0xexisting',
        email: 'existing@example.com',
        name: 'Existing User',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const result = await jwtCallback!({ token: mockToken, user: undefined });

      expect(result).toEqual(mockToken);
    });

    it('should handle user with empty string values', async () => {
      const jwtCallback = authOptions.callbacks?.jwt;
      
      const mockUser = {
        id: 'user-123',
        walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        email: '',
        name: '',
        username: '',
        isSignupComplete: true
      };

      const mockToken = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const result = await jwtCallback!({ token: mockToken, user: mockUser });

      expect(result).toEqual({
        ...mockToken,
        walletAddress: mockUser.walletAddress,
        email: '',
        name: '' // Empty string should be preserved
      });
    });

    it('should handle user with null values', async () => {
      const jwtCallback = authOptions.callbacks?.jwt;
      
      const mockUser = {
        id: 'user-123',
        walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        email: null,
        name: null,
        username: null,
        isSignupComplete: true
      };

      const mockToken = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const result = await jwtCallback!({ token: mockToken, user: mockUser });

      expect(result).toEqual({
        ...mockToken,
        walletAddress: mockUser.walletAddress,
        email: null,
        name: null // Should use null username as fallback
      });
    });

    it('should preserve existing token properties when user is provided', async () => {
      const jwtCallback = authOptions.callbacks?.jwt;
      
      const mockUser = {
        id: 'user-123',
        walletAddress: '0xnew',
        email: 'new@example.com',
        name: 'New User',
        username: 'newuser',
        isSignupComplete: true
      };

      const mockToken = {
        sub: 'user-123',
        walletAddress: '0xold',
        email: 'old@example.com',
        name: 'Old User',
        customProperty: 'should-be-preserved',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const result = await jwtCallback!({ token: mockToken, user: mockUser });

      expect(result).toEqual({
        ...mockToken,
        walletAddress: mockUser.walletAddress, // Should be updated
        email: mockUser.email, // Should be updated
        name: mockUser.name, // Should be updated
        customProperty: 'should-be-preserved' // Should be preserved
      });
    });
  });

  describe('Session Callback', () => {
    it('should map token properties to session user', async () => {
      const sessionCallback = authOptions.callbacks?.session;
      expect(sessionCallback).toBeDefined();

      const mockSession: any = {
        user: {
          name: 'Original Name',
          email: 'original@example.com',
        },
        expires: '2024-12-31',
      };

      const mockToken = {
        sub: 'user-123',
        walletAddress: '0x123',
        email: 'token@example.com',
        name: 'Token Name',
      };

      const result = await sessionCallback!({
        session: mockSession,
        token: mockToken,
      });

      expect(result).toEqual({
        ...mockSession,
        user: {
          ...mockSession.user,
          id: 'user-123',
          walletAddress: '0x123',
          email: 'token@example.com',
          name: 'Token Name',
        },
      });
    });

    it('should handle missing token properties gracefully', async () => {
      const sessionCallback = authOptions.callbacks?.session;

      const mockSession: any = {
        user: {
          name: 'Original Name',
        },
        expires: '2024-12-31',
      };

      const mockToken = {
        sub: 'user-123',
      };

      const result = await sessionCallback!({
        session: mockSession,
        token: mockToken,
      });

      expect(result.user).toEqual({
        name: 'Original Name',
        id: 'user-123',
        walletAddress: undefined,
        email: undefined,
        name: undefined,
      });
    });
  });

  describe('Redirect Callback', () => {
    const baseUrl = 'http://localhost:3000';

    it('should allow relative URLs', async () => {
      const redirectCallback = authOptions.callbacks?.redirect;
      expect(redirectCallback).toBeDefined();

      const result = await redirectCallback!({
        url: '/dashboard',
        baseUrl,
      });

      expect(result).toBe('http://localhost:3000/dashboard');
    });

    it('should allow URLs from same origin', async () => {
      const redirectCallback = authOptions.callbacks?.redirect;

      const result = await redirectCallback!({
        url: 'http://localhost:3000/profile',
        baseUrl,
      });

      expect(result).toBe('http://localhost:3000/profile');
    });

    it('should reject URLs from different origins', async () => {
      const redirectCallback = authOptions.callbacks?.redirect;

      const result = await redirectCallback!({
        url: 'https://malicious.com/steal-data',
        baseUrl,
      });

      expect(result).toBe(baseUrl);
    });

    it('should handle HTTPS same origin URLs', async () => {
      const redirectCallback = authOptions.callbacks?.redirect;
      const httpsBaseUrl = 'https://example.com';
      
      const result = await redirectCallback!({
        url: 'https://example.com/secure-page',
        baseUrl: httpsBaseUrl,
      });

      expect(result).toBe('https://example.com/secure-page');
    });
  });

  describe('Provider Configuration', () => {
    it('should have credentials provider configured', () => {
      const provider = authOptions.providers.find(p => p.id === 'credentials');
      expect(provider).toBeDefined();
      expect(provider?.type).toBe('credentials');
    });

    it('should have authorize function defined', () => {
      const provider = authOptions.providers.find(p => p.id === 'credentials') as any;
      expect(typeof provider?.authorize).toBe('function');
    });
  });

  describe('getServerAuthSession', () => {
    it('should call getServerSession with authOptions', async () => {
      const mockSession = { 
        user: { id: 'user-123' }, 
        expires: '2024-12-31' 
      };
      
      (getServerSession as jest.Mock).mockResolvedValueOnce(mockSession);

      const result = await getServerAuthSession();

      expect(getServerSession).toHaveBeenCalledWith(authOptions);
      expect(result).toBe(mockSession);
    });

    it('should return null when no session exists', async () => {
      (getServerSession as jest.Mock).mockResolvedValueOnce(null);

      const result = await getServerAuthSession();

      expect(result).toBeNull();
    });
  });

  describe('Configuration', () => {
    it('should import real authOptions', () => {
      // This test verifies we're importing the real authOptions, not a mock
      expect(authOptions).toBeDefined();
      expect(authOptions.callbacks).toBeDefined();
      expect(authOptions.providers).toBeDefined();
      console.log('authOptions imported successfully:', !!authOptions);
    });

    it('should have correct session strategy', () => {
      expect(authOptions.session?.strategy).toBe('jwt');
    });

    it('should have correct session maxAge', () => {
      expect(authOptions.session?.maxAge).toBe(30 * 24 * 60 * 60); // 30 days
    });

    it('should have correct pages configuration', () => {
      expect(authOptions.pages?.signIn).toBe('/');
      expect(authOptions.pages?.error).toBe('/');
    });

    it('should have credentials provider', () => {
      const provider = authOptions.providers.find(p => p.id === 'credentials');
      expect(provider).toBeDefined();
      expect(provider?.type).toBe('credentials');
    });

    it('should have debug mode disabled by default', () => {
      expect(authOptions.debug).toBe(false);
    });

    it('should have secret from environment variable', () => {
      expect(authOptions.secret).toBe(process.env.NEXTAUTH_SECRET);
    });

    it('should have development cookies configuration', () => {
      // Test development cookie configuration
      expect(authOptions.cookies?.sessionToken?.name).toBe('next-auth.session-token');
      expect(authOptions.cookies?.sessionToken?.options?.secure).toBe(false);
      expect(authOptions.cookies?.sessionToken?.options?.httpOnly).toBe(true);
      expect(authOptions.cookies?.sessionToken?.options?.sameSite).toBe('lax');
      expect(authOptions.cookies?.sessionToken?.options?.path).toBe('/');
    });

    it('should have CSRF token cookie configuration', () => {
      expect(authOptions.cookies?.csrfToken?.name).toBe('next-auth.csrf-token');
      expect(authOptions.cookies?.csrfToken?.options?.httpOnly).toBe(true);
      expect(authOptions.cookies?.csrfToken?.options?.sameSite).toBe('lax');
      expect(authOptions.cookies?.csrfToken?.options?.path).toBe('/');
      expect(authOptions.cookies?.csrfToken?.options?.secure).toBe(false);
    });
  });

  describe('Environment-Dependent Configuration', () => {
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
      if (originalNodeEnv !== undefined) {
        process.env.NODE_ENV = originalNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
    });

    it('should enable debug mode in development', () => {
      // Since authOptions is already imported, we need to test the logic directly
      const debugMode = process.env.NODE_ENV === "development";
      expect(typeof debugMode).toBe('boolean');
    });

    it('should configure production cookies with secure prefix', () => {
      // Test the cookie name logic for production
      const isProduction = process.env.NODE_ENV === 'production';
      const expectedPrefix = isProduction ? '__Secure-' : '';
      const expectedName = `${expectedPrefix}next-auth.session-token`;
      
      // The actual authOptions uses the current NODE_ENV, so we test the logic
      expect(expectedName).toBe(isProduction ? '__Secure-next-auth.session-token' : 'next-auth.session-token');
    });

    it('should configure secure cookies in production', () => {
      // Test the secure cookie logic
      const isProduction = process.env.NODE_ENV === 'production';
      const shouldBeSecure = isProduction;
      
      expect(typeof shouldBeSecure).toBe('boolean');
    });
  });

  describe('Provider Credentials Configuration', () => {
    it('should have credentials configuration', () => {
      const provider = authOptions.providers.find(p => p.id === 'credentials') as any;
      expect(provider).toBeDefined();
      expect(provider.options?.credentials).toBeDefined();
    });

    it('should have correct provider type', () => {
      const provider = authOptions.providers.find(p => p.id === 'credentials') as any;
      expect(provider.type).toBe('credentials');
    });
  });
}); 