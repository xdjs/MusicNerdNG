// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('next/navigation', () => ({
  redirect: (url) => { throw new Error(`NEXT_REDIRECT:${url}`); },
}));
jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getApprovedClaimByUserId: jest.fn() }));

describe('GET /dashboard (redirect shim)', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('redirects a claimed owner to their artist profile', async () => {
    const { getServerAuthSession } = await import('@/server/auth');
    const { getApprovedClaimByUserId } = await import('@/server/utils/queries/dashboardQueries');
    (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'u1' } });
    (getApprovedClaimByUserId as jest.Mock).mockResolvedValue({ artistId: 'artist-9' });

    const { default: DashboardRedirect } = await import('../page');
    await expect(DashboardRedirect()).rejects.toThrow('NEXT_REDIRECT:/artist/artist-9');
  });

  it('redirects a user with no claim to home', async () => {
    const { getServerAuthSession } = await import('@/server/auth');
    const { getApprovedClaimByUserId } = await import('@/server/utils/queries/dashboardQueries');
    (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'u1' } });
    (getApprovedClaimByUserId as jest.Mock).mockResolvedValue(null);

    const { default: DashboardRedirect } = await import('../page');
    await expect(DashboardRedirect()).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('redirects an unauthenticated visitor to home', async () => {
    const { getServerAuthSession } = await import('@/server/auth');
    const { getDevSession } = await import('@/server/utils/dev-auth');
    (getServerAuthSession as jest.Mock).mockResolvedValue(null);
    (getDevSession as jest.Mock).mockResolvedValue(null);

    const { default: DashboardRedirect } = await import('../page');
    await expect(DashboardRedirect()).rejects.toThrow('NEXT_REDIRECT:/');
  });
});
