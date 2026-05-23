// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getApprovedClaimByUserId: jest.fn() }));

if (!('json' in Response)) {
  Response.json = (data, init) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, status: init?.status || 200 });
}

describe('GET /api/user/has-claim', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('returns the claimed artistId when a claim exists', async () => {
    const { getServerAuthSession } = await import('@/server/auth');
    const { getApprovedClaimByUserId } = await import('@/server/utils/queries/dashboardQueries');
    (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'u1' } });
    (getApprovedClaimByUserId as jest.Mock).mockResolvedValue({ id: 'c1', artistId: 'artist-9' });

    const { GET } = await import('../route');
    const data = await (await GET()).json();

    expect(data).toEqual({ hasClaim: true, artistId: 'artist-9' });
  });

  it('returns hasClaim false and null artistId when unauthenticated', async () => {
    const { getServerAuthSession } = await import('@/server/auth');
    (getServerAuthSession as jest.Mock).mockResolvedValue(null);

    const { GET } = await import('../route');
    const data = await (await GET()).json();

    expect(data).toEqual({ hasClaim: false, artistId: null });
  });
});
