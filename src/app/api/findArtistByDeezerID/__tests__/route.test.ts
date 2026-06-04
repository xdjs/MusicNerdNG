import '@/test/setup/testEnv';
import { POST } from '../route';
import { getArtistByProperty } from '@/server/utils/queries/artistQueries';
import { artists } from '@/server/db/schema';

jest.mock('@/server/utils/queries/artistQueries');

if (typeof (Response as any).json !== 'function') {
  (Response as any).json = (data: any, init?: ResponseInit) =>
    new Response(JSON.stringify(data), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
}

function createTestRequest(body: any = {}, method: string = 'POST') {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(body);
  }
  return new Request('http://localhost/api/findArtistByDeezerID', init);
}

describe('findArtistByDeezerID API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const res = await POST(createTestRequest({}, 'GET'));
    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method not allowed');
  });

  it('returns 400 when deezerID is missing', async () => {
    const res = await POST(createTestRequest({}));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing or invalid required parameters: deezerID');
  });

  it('returns artist data when found', async () => {
    (getArtistByProperty as jest.Mock).mockResolvedValue({
      status: 200,
      data: { id: '1', name: 'David Morales', deezer: '11600' },
      message: '',
      isError: false,
    });

    const res = await POST(createTestRequest({ deezerID: '11600' }));
    expect(getArtistByProperty).toHaveBeenCalledWith(artists.deezer, '11600');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ result: { id: '1', name: 'David Morales', deezer: '11600' } });
  });

  it('propagates error status and message from getArtistByProperty', async () => {
    (getArtistByProperty as jest.Mock).mockResolvedValue({
      status: 404,
      data: null,
      message: 'not found',
      isError: true,
    });

    const res = await POST(createTestRequest({ deezerID: '99999' }));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe('not found');
  });
});
