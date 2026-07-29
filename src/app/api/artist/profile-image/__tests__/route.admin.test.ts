// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getApprovedClaimByUserId: jest.fn(), getApprovedClaimForArtistByUserId: jest.fn() }));
jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/lib/supabase', () => {
  const upload = jest.fn().mockResolvedValue({ error: null });
  const list = jest.fn().mockResolvedValue({ data: [], error: null });
  const remove = jest.fn().mockResolvedValue({ error: null });
  const getPublicUrl = jest.fn(() => ({ data: { publicUrl: 'http://x/y.png' } }));
  const from = jest.fn(() => ({ upload, list, remove, getPublicUrl }));
  return {
    supabaseAdmin: { storage: { from } },
    VAULT_BUCKET: 'vault',
    isSupabaseStorageConfigured: jest.fn(() => true),
    __storageMocks: { upload, list, remove, getPublicUrl, from },
  };
});
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

  it('purges stale profile-images after a successful upload (own-prefix, older than grace)', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    const supa = await import('@/server/lib/supabase');
    const storage = (supa as { __storageMocks: { list: jest.Mock; remove: jest.Mock } }).__storageMocks;
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: true });
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);
    // Three files surface from list():
    //   - own-prefix + old      → purge
    //   - own-prefix + fresh    → spare (concurrent-upload race guard)
    //   - other-artist substring → spare (defense-in-depth startsWith filter)
    const oldIso = new Date(Date.now() - 60_000).toISOString();
    const freshIso = new Date(Date.now() - 1_000).toISOString();
    storage.list.mockResolvedValueOnce({
      data: [
        { name: 'artist-x_1700000000.png', created_at: oldIso },
        { name: 'artist-x_1799999000.png', created_at: freshIso },
        { name: 'other-artist-x_5.png', created_at: oldIso },
      ],
      error: null,
    });

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

    expect(res.status).toBe(200);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith(['profile-images/artist-x_1700000000.png']);
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

  it('returns a clear 503 (not a generic 500) when storage is not configured', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    const supabase = await import('@/server/lib/supabase');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: true });
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);
    (supabase.isSupabaseStorageConfigured as jest.Mock).mockReturnValue(false);

    const { POST } = await import('../route');
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // valid PNG header — reaches the storage guard
    const mockFile = {
      name: 'a.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer,
    };
    const fd = new Map([['file', mockFile], ['artistId', 'artist-x']]);
    const req = { formData: async () => ({ get: (k) => fd.get(k) }) } as unknown as Request;
    const res = await POST(req);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });
});
