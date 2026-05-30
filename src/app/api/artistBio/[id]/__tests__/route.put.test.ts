// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/lib/auth-helpers', () => ({ requireArtistEditor: jest.fn() }));
jest.mock('@/server/utils/queries/artistQueries', () => ({
  getArtistById: jest.fn(),
  updateArtistBio: jest.fn(),
}));
jest.mock('@/server/utils/queries/artistBioQuery', () => ({ generateArtistBio: jest.fn() }));

if (!('json' in Response)) {
  Response.json = (data, init) =>
    new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      status: init?.status || 200,
    });
}

describe('PUT /api/artistBio/[id]', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('lets an authorized editor (owner or admin) save a bio', async () => {
    const { requireArtistEditor } = await import('@/lib/auth-helpers');
    const aq = await import('@/server/utils/queries/artistQueries');
    (requireArtistEditor as jest.Mock).mockResolvedValue({ authenticated: true, session: {}, userId: 'u1' });
    (aq.updateArtistBio as jest.Mock).mockResolvedValue({ status: 'success', message: 'ok', data: 'New bio' });

    const { PUT } = await import('../route');
    const req = new Request('http://t/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio: 'New bio' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'artist-1' }) });

    expect(res.status).toBe(200);
    expect(requireArtistEditor).toHaveBeenCalledWith('artist-1');
    expect(aq.updateArtistBio).toHaveBeenCalledWith('artist-1', 'New bio', false);
  });

  it('rejects a bio that exceeds the character cap with a 400', async () => {
    const { requireArtistEditor } = await import('@/lib/auth-helpers');
    const aq = await import('@/server/utils/queries/artistQueries');
    const { MAX_BIO_LENGTH } = await import('@/lib/bioConstants');
    (requireArtistEditor as jest.Mock).mockResolvedValue({ authenticated: true, session: {}, userId: 'u1' });

    const tooLong = 'a'.repeat(MAX_BIO_LENGTH + 1);
    const { PUT } = await import('../route');
    const req = new Request('http://t/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio: tooLong }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'artist-1' }) });

    expect(res.status).toBe(400);
    expect(aq.updateArtistBio).not.toHaveBeenCalled();
  });

  it('returns the guard failure (403) when not an authorized editor', async () => {
    const { requireArtistEditor } = await import('@/lib/auth-helpers');
    (requireArtistEditor as jest.Mock).mockResolvedValue({
      authenticated: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const { PUT } = await import('../route');
    const req = new Request('http://t/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio: 'x' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'artist-1' }) });

    expect(res.status).toBe(403);
  });
});
