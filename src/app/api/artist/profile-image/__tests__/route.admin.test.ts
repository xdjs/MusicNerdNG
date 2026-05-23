// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getApprovedClaimByUserId: jest.fn() }));
jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/lib/supabase', () => ({
  supabaseAdmin: { storage: { from: () => ({ upload: jest.fn().mockResolvedValue({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'http://x/y.png' } }) }) } },
  VAULT_BUCKET: 'vault',
}));
jest.mock('@/server/db/drizzle', () => ({ db: { update: () => ({ set: () => ({ where: jest.fn().mockResolvedValue(undefined) }) }) } }));

if (!('json' in Response)) {
  Response.json = (data, init) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, status: init?.status || 200 });
}

describe('POST /api/artist/profile-image admin path', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('allows an admin to upload for an artist they have not claimed', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: true });
    (claims.getApprovedClaimByUserId as jest.Mock).mockResolvedValue(null);

    const { POST } = await import('../route');
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    // JSDOM's File doesn't implement arrayBuffer(); provide a minimal mock file
    const mockFile = {
      name: 'a.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer,
    };
    const fd = new Map([['file', mockFile], ['artistId', 'artist-x']]);
    // JSDOM's Request doesn't implement formData(); provide a minimal mock
    const req = { formData: async () => ({ get: (k) => fd.get(k) }) } as unknown as Request;
    const res = await POST(req);

    expect(res.status).toBe(200);
  });
});
