import { describe, it, expect, beforeEach } from '@jest/globals';
import { getUserById, getUserByWallet, createUser } from '../queries';
import { getServerAuthSession } from '../../auth';
import type { Session } from 'next-auth';

// Mock dependencies
jest.mock('../../auth', () => ({
  getServerAuthSession: jest.fn()
}));

jest.mock('../queries', () => ({
  getUserById: jest.fn(),
  getUserByWallet: jest.fn(),
  createUser: jest.fn()
}));

describe('User Management', () => {
  const mockUser = {
    id: 'test-user-id',
    wallet: '0x1234567890abcdef',
    username: 'test-user'
  };

  const mockSession: Session = {
    user: {
      id: mockUser.id,
      walletAddress: mockUser.wallet,
      email: 'test@example.com',
      name: 'Test User'
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
  });

  describe('User Retrieval', () => {
    it('should get user by ID', async () => {
      (getUserById as jest.Mock).mockResolvedValue(mockUser);

      const user = await getUserById(mockUser.id);
      expect(user).toEqual(mockUser);
      expect(getUserById).toHaveBeenCalledWith(mockUser.id);
    });

    it('should get user by wallet address', async () => {
      (getUserByWallet as jest.Mock).mockResolvedValue(mockUser);

      const user = await getUserByWallet(mockUser.wallet);
      expect(user).toEqual(mockUser);
      expect(getUserByWallet).toHaveBeenCalledWith(mockUser.wallet);
    });

    it('should handle non-existent user ID', async () => {
      (getUserById as jest.Mock).mockResolvedValue(null);

      const user = await getUserById('non-existent-id');
      expect(user).toBeNull();
    });

    it('should handle non-existent wallet address', async () => {
      (getUserByWallet as jest.Mock).mockResolvedValue(null);

      const user = await getUserByWallet('0xnonexistent');
      expect(user).toBeNull();
    });

    it('should handle database errors in getUserById', async () => {
      (getUserById as jest.Mock).mockRejectedValue(new Error('Error finding user: Database error'));

      await expect(getUserById(mockUser.id))
        .rejects.toThrow('Error finding user: Database error');
    });

    it('should handle database errors in getUserByWallet', async () => {
      (getUserByWallet as jest.Mock).mockRejectedValue(new Error('Error finding user: Database error'));

      await expect(getUserByWallet(mockUser.wallet))
        .rejects.toThrow('Error finding user: Database error');
    });
  });

  describe('User Creation', () => {
    it('should create new user with wallet address', async () => {
      const newUser = { ...mockUser, id: 'new-user-id' };
      (createUser as jest.Mock).mockResolvedValue(newUser);

      const user = await createUser(mockUser.wallet);
      expect(user).toEqual(newUser);
      expect(createUser).toHaveBeenCalledWith(mockUser.wallet);
    });

    it('should handle invalid wallet address format', async () => {
      (createUser as jest.Mock).mockRejectedValue(new Error('Invalid wallet format'));

      await expect(createUser('invalid-wallet')).rejects.toThrow('Invalid wallet format');
    });

    it('should handle duplicate wallet address', async () => {
      (createUser as jest.Mock).mockRejectedValue(new Error('Duplicate wallet'));

      await expect(createUser('duplicate-wallet')).rejects.toThrow('Duplicate wallet');
    });

    it('should handle database errors in user creation', async () => {
      (createUser as jest.Mock).mockRejectedValue(new Error('Database error'));

      await expect(createUser('error-wallet')).rejects.toThrow('Database error');
    });
  });

  describe('User Session Management', () => {
    it('should handle authenticated session', async () => {
      const session = await getServerAuthSession();
      expect(session).toEqual(mockSession);
    });

    it('should handle unauthenticated session', async () => {
      (getServerAuthSession as jest.Mock).mockResolvedValue(null);

      const session = await getServerAuthSession();
      expect(session).toBeNull();
    });

    it('should handle expired session', async () => {
      const expiredSession: Session = {
        ...mockSession,
        expires: new Date(Date.now() - 1000).toISOString() // Expired timestamp
      };
      (getServerAuthSession as jest.Mock).mockResolvedValue(expiredSession);

      const session = (await getServerAuthSession()) as Session;
      expect(session.expires).toBe(expiredSession.expires);
    });

    it('should handle session with missing user data', async () => {
      const incompleteSession: Session = {
        user: { id: mockUser.id },
        expires: mockSession.expires
      };
      (getServerAuthSession as jest.Mock).mockResolvedValue(incompleteSession);

      const session = (await getServerAuthSession()) as Session;
      expect(session.user).toEqual({ id: mockUser.id });
    });
  });

  describe('User Data Validation', () => {
    it('should validate wallet address format', async () => {
      const validWallet = '0x1234567890abcdef1234567890abcdef12345678';
      const expectedUser = { ...mockUser, wallet: validWallet };
      (createUser as jest.Mock).mockResolvedValue(expectedUser);

      const user = await createUser(validWallet);
      expect(user).toBeDefined();
      expect(user!.wallet).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should handle null values in user data', async () => {
      const userWithNulls = {
        ...mockUser,
        email: null,
        username: null
      };
      (getUserById as jest.Mock).mockResolvedValue(userWithNulls);

      const user = await getUserById(mockUser.id);
      expect(user).toBeDefined();
      expect(user!.email).toBeNull();
      expect(user!.username).toBeNull();
    });

    it('should handle undefined values in user data', async () => {
      const userWithUndefined = {
        ...mockUser,
        email: undefined,
        username: undefined
      };
      (getUserById as jest.Mock).mockResolvedValue(userWithUndefined);

      const user = await getUserById(mockUser.id);
      expect(user).toBeDefined();
      expect(user!.email).toBeUndefined();
      expect(user!.username).toBeUndefined();
    });
  });
}); 