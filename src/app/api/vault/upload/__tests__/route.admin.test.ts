// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
  getApprovedClaimByUserId: jest.fn(),
  getApprovedClaimForArtistByUserId: jest.fn(),
  insertVaultSource: jest.fn(),
}));
jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/lib/supabase', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: jest.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'http://x/file.png' } }),
      }),
    },
  },
  VAULT_BUCKET: 'vault',
}));
jest.mock('@/server/utils/validateMagicBytes', () => ({ validateMagicBytes: jest.fn().mockReturnValue(true) }));
jest.mock('@/server/utils/extractPdfText', () => ({ extractPdfText: jest.fn().mockResolvedValue(null) }));

if (!('json' in Response)) {
  Response.json = (data, init) =>
    new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      status: init?.status || 200,
    });
}

describe('POST /api/vault/upload admin path', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('allows an admin to upload for an artist they have not claimed', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: true });
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);
    (claims.insertVaultSource as jest.Mock).mockResolvedValue({ id: 'src-1' });

    const { POST } = await import('../route');

    // Full 8-byte PNG magic header: 89 50 4E 47 0D 0A 1A 0A
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // JSDOM's File doesn't implement arrayBuffer(); provide a minimal mock file
    const mockFile = {
      name: 'photo.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer,
    };
    const fd = new Map([['file', mockFile], ['artistId', 'artist-x']]);
    // JSDOM's Request doesn't implement formData(); provide a minimal mock
    const req = { formData: async () => ({ get: (k) => fd.get(k) }) } as unknown as Request;
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('rejects a non-admin with no claim', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'u-2' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: false });
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);

    const { POST } = await import('../route');

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mockFile = {
      name: 'photo.png',
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
    (claims.insertVaultSource as jest.Mock).mockResolvedValue({ id: 'src-2' });

    const { POST } = await import('../route');

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mockFile = {
      name: 'photo.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer,
    };
    const fd = new Map([['file', mockFile], ['artistId', 'different-artist']]);
    const req = { formData: async () => ({ get: (k) => fd.get(k) }) } as unknown as Request;
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('persists filePath as the storage key, not the public URL', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: true });
    (claims.getApprovedClaimForArtistByUserId as jest.Mock).mockResolvedValue(undefined);
    (claims.insertVaultSource as jest.Mock).mockResolvedValue({ id: 'src-1' });

    const { POST } = await import('../route');
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mockFile = {
      name: 'press-photo.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer,
    };
    const fd = new Map([['file', mockFile], ['artistId', 'artist-x']]);
    const req = { formData: async () => ({ get: (k) => fd.get(k) }) } as unknown as Request;
    await POST(req);

    expect(claims.insertVaultSource).toHaveBeenCalledTimes(1);
    const callArg = (claims.insertVaultSource as jest.Mock).mock.calls[0][0];
    // url stays as the publicly-served URL (used by browsers to render the asset)
    expect(callArg.url).toBe('http://x/file.png');
    // filePath holds the Supabase storage KEY — `${artistId}/${timestamp}_${safeName}${ext}` —
    // so per-file deletion can call .remove([filePath]) without URL-parsing.
    expect(callArg.filePath).not.toBe(callArg.url);
    expect(callArg.filePath).not.toMatch(/^https?:\/\//);
    expect(callArg.filePath).toMatch(/^artist-x\/\d+_press-photo\.png$/);
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

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mockFile = {
      name: 'photo.png',
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
