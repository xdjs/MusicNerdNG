// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn() }));
jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
  getApprovedClaimByUserId: jest.fn(),
  getVaultSourceByIdAndArtist: jest.fn(),
  getVaultSourceById: jest.fn(),
  getVaultSourcesByArtistId: jest.fn(),
  updateVaultSourceStatus: jest.fn(),
  insertVaultSource: jest.fn(),
  deleteVaultSource: jest.fn(),
  deleteVaultSources: jest.fn(),
  updateVaultSourceType: jest.fn(),
  updateVaultSourceContent: jest.fn(),
  seedMockVaultSources: jest.fn(),
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
    (q.getApprovedClaimByUserId as jest.Mock).mockResolvedValue({ artistId: 'artist-owned' });
    (q.getVaultSourceByIdAndArtist as jest.Mock).mockResolvedValue(undefined);

    const res = await actions.updateSourceStatus('src-1', 'approved');

    expect(res.success).toBe(false);
  });
});
