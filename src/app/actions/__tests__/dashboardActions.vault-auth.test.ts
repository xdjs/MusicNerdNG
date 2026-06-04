// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn() }));
jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
  getApprovedClaimByUserId: jest.fn(),
  getApprovedClaimForArtistByUserId: jest.fn(),
  getVaultSourceById: jest.fn(),
  getVaultSourcesByArtistId: jest.fn(),
  updateVaultSourceStatus: jest.fn(),
  insertVaultSource: jest.fn(),
  deleteVaultSource: jest.fn(),
  deleteVaultSources: jest.fn(),
  updateVaultSourceType: jest.fn(),
  updateVaultSourceContent: jest.fn(),
  getClaimByArtistId: jest.fn(),
  createClaim: jest.fn(),
  deleteClaim: jest.fn(),
  getBioVersionsByArtistId: jest.fn(),
  saveBioVersion: jest.fn(),
  pinBioVersion: jest.fn(),
  deleteBioVersion: jest.fn(),
}));
jest.mock('@/server/utils/queries/vaultWebSearch', () => ({ searchAndPopulateVault: jest.fn() }));
jest.mock('@/server/utils/queries/artistBioQuery', () => ({ generateArtistBio: jest.fn() }));
jest.mock('@/server/utils/fetchPageContent', () => ({ fetchPageContent: jest.fn() }));
jest.mock('@/server/utils/queries/discord', () => ({ sendDiscordMessage: jest.fn() }));

describe('vault action authorization', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  async function setup() {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const q = await import('@/server/utils/queries/dashboardQueries');
    const actions = await import('../dashboardActions');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1' } });
    return { actions, users, q };
  }

  it('lets an admin update a source they do not own', async () => {
    const { actions, users, q } = await setup();
    (users.getUserById as jest.Mock).mockResolvedValue({ id: 'admin-1', isAdmin: true });
    (q.getVaultSourceById as jest.Mock).mockResolvedValue({ id: 'src-1', artistId: 'artist-x' });
    (q.updateVaultSourceStatus as jest.Mock).mockResolvedValue({ id: 'src-1' });

    const res = await actions.updateSourceStatus('src-1', 'approved');

    expect(res.success).toBe(true);
    expect(q.updateVaultSourceStatus).toHaveBeenCalledWith('src-1', 'approved');
  });

  it('rejects a non-admin who does not own the source', async () => {
    const { actions, users, q } = await setup();
    (users.getUserById as jest.Mock).mockResolvedValue({ id: 'admin-1', isAdmin: false });
    (q.getVaultSourceById as jest.Mock).mockResolvedValue({ id: 'src-1', artistId: 'artist-x' });
    (q.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);

    const res = await actions.updateSourceStatus('src-1', 'approved');

    expect(res.success).toBe(false);
  });

  it('admin can searchWebForSources for an artist they do not own', async () => {
    const { actions, users } = await setup();
    const { searchAndPopulateVault } = await import('@/server/utils/queries/vaultWebSearch');
    (users.getUserById as jest.Mock).mockResolvedValue({ id: 'admin-1', isAdmin: true });
    (searchAndPopulateVault as jest.Mock).mockResolvedValue(3);

    const res = await actions.searchWebForSources('artist-they-dont-own');

    expect(res.success).toBe(true);
  });

  it('admin removeVaultSources is allowed across artists (per-source canEditArtist)', async () => {
    const { actions, users, q } = await setup();
    // Two sources owned by two different artists — admin is allowed for both.
    (q.getVaultSourceById as jest.Mock)
      .mockResolvedValueOnce({ id: 's1', artistId: 'artist-a' })
      .mockResolvedValueOnce({ id: 's2', artistId: 'artist-b' });
    // canEditArtist resolution: admin has no claim for either, but isAdmin → true.
    (q.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);
    (users.getUserById as jest.Mock).mockResolvedValue({ id: 'admin-1', isAdmin: true });
    (q.deleteVaultSources as jest.Mock).mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

    const res = await actions.removeVaultSources(['s1', 's2']);

    expect(res.success).toBe(true);
    expect(q.deleteVaultSources).toHaveBeenCalledWith(['s1', 's2']);
    // No longer goes through the single-claim path:
    expect(q.getApprovedClaimByUserId).not.toHaveBeenCalled();
    expect(q.getVaultSourcesByArtistId).not.toHaveBeenCalled();
  });

  it('non-admin removeVaultSources rejects when user cannot edit one of the source artists', async () => {
    const { actions, users, q } = await setup();
    // Source s1 belongs to artist-a (user CAN edit), s2 to artist-b (user CANNOT).
    (q.getVaultSourceById as jest.Mock)
      .mockResolvedValueOnce({ id: 's1', artistId: 'artist-a' })
      .mockResolvedValueOnce({ id: 's2', artistId: 'artist-b' });
    (users.getUserById as jest.Mock).mockResolvedValue({ id: 'user-1', isAdmin: false });
    (q.getApprovedClaimForArtistByUserId as jest.Mock).mockImplementation(async (_uid: string, artistId: string) =>
      artistId === 'artist-a' ? { id: 'claim-a', userId: 'user-1', artistId: 'artist-a', status: 'approved' } : undefined
    );

    const res = await actions.removeVaultSources(['s1', 's2']);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not authorized/i);
    expect(q.deleteVaultSources).not.toHaveBeenCalled();
  });

  it('removeVaultSources rejects when one of the sourceIds is unknown', async () => {
    const { actions, q } = await setup();
    (q.getVaultSourceById as jest.Mock)
      .mockResolvedValueOnce({ id: 's1', artistId: 'artist-a' })
      .mockResolvedValueOnce(undefined);

    const res = await actions.removeVaultSources(['s1', 'unknown']);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(q.deleteVaultSources).not.toHaveBeenCalled();
  });

  it('admin updateSourceStatus returns failure when source is not found', async () => {
    const { actions, users, q } = await setup();
    (users.getUserById as jest.Mock).mockResolvedValue({ id: 'admin-1', isAdmin: true });
    (q.getVaultSourceById as jest.Mock).mockResolvedValue(undefined);

    const res = await actions.updateSourceStatus('missing', 'approved');

    expect(res.success).toBe(false);
  });
});
