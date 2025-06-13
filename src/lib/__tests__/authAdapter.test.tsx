import { getCsrfToken, signIn, signOut } from 'next-auth/react';
import { SiweMessage } from 'siwe';

// Mock RainbowKit
jest.mock('@rainbow-me/rainbowkit', () => ({
  createAuthenticationAdapter: jest.fn((config) => config),
}));

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
  getCsrfToken: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));

// Mock SiweMessage
jest.mock('siwe', () => ({
  SiweMessage: jest.fn().mockImplementation((params) => ({
    ...params,
    prepareMessage: jest.fn().mockReturnValue('mocked-message-body'),
  })),
}));

// Mock window.location
const mockLocation = {
  hostname: 'localhost',
  origin: 'http://localhost:3000',
  reload: jest.fn(),
};

Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
});

// Mock storage
const mockSessionStorage = {
  removeItem: jest.fn(),
  clear: jest.fn(),
};

const mockLocalStorage = {
  removeItem: jest.fn(),
};

Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
  writable: true,
});

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// Import after mocks
import { authenticationAdapter } from '../authAdapter';

describe('authenticationAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getNonce', () => {
    it('should return CSRF token on first attempt', async () => {
      const mockToken = 'test-csrf-token';
      (getCsrfToken as jest.Mock).mockResolvedValue(mockToken);

      const result = await authenticationAdapter.getNonce();

      expect(result).toBe(mockToken);
      expect(getCsrfToken).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed on second attempt', async () => {
      const mockToken = 'test-csrf-token';
      (getCsrfToken as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockToken);

      // Mock setTimeout to resolve immediately
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return 1 as any;
      });

      const result = await authenticationAdapter.getNonce();

      expect(result).toBe(mockToken);
      expect(getCsrfToken).toHaveBeenCalledTimes(2);

      jest.restoreAllMocks();
    });

    it('should throw error after max attempts', async () => {
      (getCsrfToken as jest.Mock).mockResolvedValue(null);

      // Mock setTimeout to resolve immediately
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return 1 as any;
      });

      await expect(authenticationAdapter.getNonce()).rejects.toThrow('Failed to get CSRF token');
      
      expect(getCsrfToken).toHaveBeenCalledTimes(3);

      jest.restoreAllMocks();
    });
  });

  describe('createMessage', () => {
    const mockParams = {
      nonce: 'test-nonce',
      address: '0x1234567890123456789012345678901234567890',
      chainId: 1,
    };

    beforeEach(() => {
      // Reset SiweMessage mock
      (SiweMessage as jest.Mock).mockClear();
    });

    it('should create SIWE message with correct parameters', () => {
      const mockMessage = { prepareMessage: jest.fn() };
      (SiweMessage as jest.Mock).mockReturnValue(mockMessage);

      const result = authenticationAdapter.createMessage(mockParams);

      expect(SiweMessage).toHaveBeenCalledWith({
        domain: 'localhost',
        address: mockParams.address,
        statement: 'Sign in to MusicNerd to add artists and manage your collection.',
        uri: 'http://localhost:3000',
        version: '1',
        chainId: mockParams.chainId,
        nonce: mockParams.nonce,
        issuedAt: expect.any(String),
        expirationTime: expect.any(String),
      });

      expect(result).toBe(mockMessage);
    });

    it('should clear existing SIWE data from storage', () => {
      authenticationAdapter.createMessage(mockParams);

      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('siwe-nonce');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('siwe.session');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.siwe.message');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.siwe.signature');
    });

    it('should handle domain with port number', () => {
      // Mock location with port
      Object.defineProperty(window, 'location', {
        value: { ...mockLocation, hostname: 'localhost:3000' },
        writable: true,
      });

      authenticationAdapter.createMessage(mockParams);

      expect(SiweMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'localhost',
        })
      );

      // Restore original location
      Object.defineProperty(window, 'location', {
        value: mockLocation,
        writable: true,
      });
    });

    it('should set correct expiration time (5 minutes)', () => {
      const beforeTime = Date.now();
      authenticationAdapter.createMessage(mockParams);
      const afterTime = Date.now();

      const siweCall = (SiweMessage as jest.Mock).mock.calls[0][0];
      const expirationTime = new Date(siweCall.expirationTime).getTime();
      const issuedTime = new Date(siweCall.issuedAt).getTime();

      // Should be approximately 5 minutes (300,000 ms)
      const timeDiff = expirationTime - issuedTime;
      expect(timeDiff).toBeGreaterThanOrEqual(299000); // Allow some tolerance
      expect(timeDiff).toBeLessThanOrEqual(301000);

      // Issued time should be within test execution time
      expect(issuedTime).toBeGreaterThanOrEqual(beforeTime);
      expect(issuedTime).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('getMessageBody', () => {
    it('should return prepared message body', () => {
      const mockMessage = {
        prepareMessage: jest.fn().mockReturnValue('prepared-message-body'),
      } as any;

      const result = authenticationAdapter.getMessageBody({ message: mockMessage });

      expect(mockMessage.prepareMessage).toHaveBeenCalled();
      expect(result).toBe('prepared-message-body');
    });
  });

  describe('verify', () => {
    const mockMessage = {
      domain: 'localhost',
      address: '0x1234567890123456789012345678901234567890',
      nonce: 'test-nonce',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 1,
      statement: 'Sign in to MusicNerd',
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 300000).toISOString(),
      prepareMessage: jest.fn().mockReturnValue('prepared-message'),
      toMessage: jest.fn(),
    } as any;

    const mockVerifyParams = {
      message: mockMessage,
      signature: 'test-signature',
    };

    beforeEach(() => {
      // Mock setTimeout to resolve immediately
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return 1 as any;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should verify successfully and return true', async () => {
      (signIn as jest.Mock).mockResolvedValue({ ok: true });

      const result = await authenticationAdapter.verify(mockVerifyParams);

      expect(signIn).toHaveBeenCalledWith('credentials', {
        message: JSON.stringify(mockMessage),
        signature: mockVerifyParams.signature,
        redirect: false,
        callbackUrl: 'http://localhost:3000',
      });

      expect(result).toBe(true);
    });

    it('should clear SIWE data before verification', async () => {
      (signIn as jest.Mock).mockResolvedValue({ ok: true });

      await authenticationAdapter.verify(mockVerifyParams);

      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('siwe-nonce');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('siwe.session');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.siwe.message');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.siwe.signature');
    });

    it('should return false when signIn returns error', async () => {
      const mockError = 'Authentication failed';
      (signIn as jest.Mock).mockResolvedValue({ error: mockError });

      const result = await authenticationAdapter.verify(mockVerifyParams);

      expect(result).toBe(false);
    });

    it('should return false when signIn throws error', async () => {
      const mockError = new Error('Network error');
      (signIn as jest.Mock).mockRejectedValue(mockError);

      const result = await authenticationAdapter.verify(mockVerifyParams);

      expect(result).toBe(false);
    });

    it('should wait 2 seconds after successful sign in', async () => {
      (signIn as jest.Mock).mockResolvedValue({ ok: true });
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      await authenticationAdapter.verify(mockVerifyParams);

      // Should be called twice: once for the 2-second wait after signIn
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    });
  });

  describe('signOut', () => {
    beforeEach(() => {
      // Mock setTimeout to resolve immediately
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return 1 as any;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should clear all storage and sign out successfully', async () => {
      (signOut as jest.Mock).mockResolvedValue(undefined);

      await authenticationAdapter.signOut();

      // Check session storage clearing
      expect(mockSessionStorage.clear).toHaveBeenCalled();
      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('siwe-nonce');

      // Check local storage clearing
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('siwe.session');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.siwe.message');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.siwe.signature');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.wallet');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.connected');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.injected.connected');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.store');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('wagmi.cache');

      // Check signOut call
      expect(signOut).toHaveBeenCalledWith({
        redirect: false,
        callbackUrl: 'http://localhost:3000',
      });

      // Check page reload
      expect(mockLocation.reload).toHaveBeenCalled();
    });

    it('should handle signOut errors gracefully', async () => {
      const mockError = new Error('Sign out failed');
      (signOut as jest.Mock).mockRejectedValue(mockError);

      await authenticationAdapter.signOut();

      // Should still clear storage but reload is not called on error
      expect(mockSessionStorage.clear).toHaveBeenCalled();
      // Note: reload is not called when signOut throws an error
    });

    it('should wait 2 seconds before reloading page', async () => {
      (signOut as jest.Mock).mockResolvedValue(undefined);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      await authenticationAdapter.signOut();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    });
  });
}); 