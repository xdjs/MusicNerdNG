// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getApprovedClaimByUserId: jest.fn(), getApprovedClaimForArtistByUserId: jest.fn() }));
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
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);

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

  it('rejects a non-admin with no claim', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'u-2' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: false });
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);

    const { POST } = await import('../route');
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const mockFile = {
      name: 'a.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer,
    };
    const fd = new Map([['file', mockFile], ['artistId', 'artist-x']]);
    const req = { formData: async () => ({ get: (k) => fd.get(k) }) } as unknown as Request;
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Not authorized for this artist');
  });

  it('allows an admin WITH their own claim to upload for a DIFFERENT artist', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-2' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: true });
    // Admin has no claim for THIS (different) artist, but is admin so allowed
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);

    const { POST } = await import('../route');
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const mockFile = {
      name: 'a.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer,
    };
    const fd = new Map([['file', mockFile], ['artistId', 'different-artist']]);
    const req = { formData: async () => ({ get: (k) => fd.get(k) }) } as unknown as Request;
    const res = await POST(req);

    expect(res.status).toBe(200);
  });

  it('rejects an image whose magic bytes do not match the declared type', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: true });
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);

    const { POST } = await import('../route');
    // Bytes declare image/png but actually carry a PDF header (%PDF) — magic byte mismatch.
    const fakeBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const mockFile = {
      name: 'bad.png',
      type: 'image/png',
      size: fakeBytes.byteLength,
      arrayBuffer: async () => fakeBytes.buffer,
    };
    const fd = new Map([['file', mockFile], ['artistId', 'artist-x']]);
    const req = { formData: async () => ({ get: (k) => fd.get(k) }) } as unknown as Request;
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not match declared type/i);
  });

  it('rejects a non-admin WITH a claim for a different artist', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'u-3' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: false });
    // User has no approved claim for THIS artist, and is not admin
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);

    const { POST } = await import('../route');
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const mockFile = {
      name: 'a.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer,
    };
    const fd = new Map([['file', mockFile], ['artistId', 'different-artist']]);
    const req = { formData: async () => ({ get: (k) => fd.get(k) }) } as unknown as Request;
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Not authorized for this artist');
  });
});
