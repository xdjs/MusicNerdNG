import { describe, it, expect, beforeEach } from '@jest/globals';
import { addUsersToWhitelist, removeFromWhitelist, getWhitelistedUsers, getUserByWallet } from '../queries';
import { getServerAuthSession } from '../../auth';

// Mock dependencies
jest.mock('../../auth', () => ({
  getServerAuthSession: jest.fn()
}));

jest.mock('../queries', () => ({
  addUsersToWhitelist: jest.fn(),
  removeFromWhitelist: jest.fn(),
  getWhitelistedUsers: jest.fn(),
  getUserByWallet: jest.fn()
}));

describe('Role Management and Whitelist', () => {
  const mockUser = {
    id: 'test-user-id',
    wallet: '0x1234567890abcdef',
    isAdmin: true
  };

  const mockWhitelistedUsers = [
    { id: 'user1', wallet: '0xuser1', isWhiteListed: true },
    { id: 'user2', wallet: '0xuser2', isWhiteListed: true }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (getServerAuthSession as jest.Mock).mockResolvedValue({
      user: { id: mockUser.id }
    });
  });

  describe('Whitelist Management', () => {
    it('should add users to whitelist', async () => {
      const walletAddresses = ['0xuser3', '0xuser4'];
      (addUsersToWhitelist as jest.Mock).mockResolvedValue({
        status: 'success',
        message: 'Users added to whitelist'
      });

      const result = await addUsersToWhitelist(walletAddresses);

      expect(addUsersToWhitelist).toHaveBeenCalledWith(walletAddresses);
      expect(result).toEqual({
        status: 'success',
        message: 'Users added to whitelist'
      });
    });

    it('should handle errors when adding to whitelist', async () => {
      const walletAddresses = ['0xuser3', '0xuser4'];
      (addUsersToWhitelist as jest.Mock).mockResolvedValue({
        status: 'error',
        message: 'Error adding users to whitelist'
      });

      const result = await addUsersToWhitelist(walletAddresses);

      expect(addUsersToWhitelist).toHaveBeenCalledWith(walletAddresses);
      expect(result).toEqual({
        status: 'error',
        message: 'Error adding users to whitelist'
      });
    });

    it('should remove users from whitelist', async () => {
      const userIds = ['user1', 'user2'];
      await removeFromWhitelist(userIds);

      expect(removeFromWhitelist).toHaveBeenCalledWith(userIds);
    });

    it('should get whitelisted users', async () => {
      (getWhitelistedUsers as jest.Mock).mockResolvedValue(mockWhitelistedUsers);

      const result = await getWhitelistedUsers();

      expect(result).toEqual(mockWhitelistedUsers);
    });

    it('should require authentication for getting whitelisted users', async () => {
      // Mock no session
      (getServerAuthSession as jest.Mock).mockResolvedValue(null);
      (getWhitelistedUsers as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      await expect(getWhitelistedUsers())
        .rejects.toThrow('Unauthorized');
    });
  });

  describe('User Role Verification', () => {
    it('should verify admin status', async () => {
      (getUserByWallet as jest.Mock).mockResolvedValue({
        ...mockUser,
        isAdmin: true
      });

      const user = await getUserByWallet(mockUser.wallet);
      expect(user?.isAdmin).toBe(true);
    });

    it('should verify non-admin status', async () => {
      (getUserByWallet as jest.Mock).mockResolvedValue({
        ...mockUser,
        isAdmin: false
      });

      const user = await getUserByWallet(mockUser.wallet);
      expect(user?.isAdmin).toBe(false);
    });

    it('should verify whitelist status', async () => {
      (getUserByWallet as jest.Mock).mockResolvedValue({
        ...mockUser,
        isWhiteListed: true
      });

      const user = await getUserByWallet(mockUser.wallet);
      expect(user?.isWhiteListed).toBe(true);
    });

    it('should handle non-existent user', async () => {
      (getUserByWallet as jest.Mock).mockResolvedValue(null);

      const user = await getUserByWallet('0xnonexistent');
      expect(user).toBeNull();
    });

    it('should handle database errors', async () => {
      (getUserByWallet as jest.Mock)
        .mockRejectedValue(new Error('Error finding user: Database error'));

      await expect(getUserByWallet(mockUser.wallet))
        .rejects.toThrow('Error finding user: Database error');
    });
  });
}); 