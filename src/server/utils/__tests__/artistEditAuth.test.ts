// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
  getApprovedClaimForArtistByUserId: jest.fn(),
}));

describe('canEditArtist', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  async function setup() {
    const users = await import('@/server/utils/queries/userQueries');
    const q = await import('@/server/utils/queries/dashboardQueries');
    const { canEditArtist } = await import('../artistEditAuth');
    return {
      canEditArtist,
      getUserById: users.getUserById as jest.Mock,
      getApprovedClaimForArtistByUserId: q.getApprovedClaimForArtistByUserId as jest.Mock,
    };
  }

  it('returns true for the approved claimant of this artist', async () => {
    const { canEditArtist, getApprovedClaimForArtistByUserId } = await setup();
    getApprovedClaimForArtistByUserId.mockResolvedValue({ id: 'c1', artistId: 'a1', userId: 'u1' });

    expect(await canEditArtist('u1', 'a1')).toBe(true);
  });

  it('does not require a user lookup for the owner path', async () => {
    const { canEditArtist, getApprovedClaimForArtistByUserId, getUserById } = await setup();
    getApprovedClaimForArtistByUserId.mockResolvedValue({ id: 'c1', artistId: 'a1', userId: 'u1' });

    await canEditArtist('u1', 'a1');

    expect(getApprovedClaimForArtistByUserId).toHaveBeenCalledWith('u1', 'a1');
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('returns true for an admin with no claim for this artist', async () => {
    const { canEditArtist, getApprovedClaimForArtistByUserId, getUserById } = await setup();
    getApprovedClaimForArtistByUserId.mockResolvedValue(undefined);
    getUserById.mockResolvedValue({ id: 'admin-1', isAdmin: true });

    expect(await canEditArtist('admin-1', 'a1')).toBe(true);
    expect(getUserById).toHaveBeenCalledWith('admin-1');
  });

  it('returns false for a non-owner non-admin', async () => {
    const { canEditArtist, getApprovedClaimForArtistByUserId, getUserById } = await setup();
    getApprovedClaimForArtistByUserId.mockResolvedValue(undefined);
    getUserById.mockResolvedValue({ id: 'u2', isAdmin: false });

    expect(await canEditArtist('u2', 'a1')).toBe(false);
  });
});
