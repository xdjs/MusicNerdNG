import '@/test/setup/testEnv';
import { POST } from '../route';
import { getArtistByProperty } from '@/server/utils/queriesTS';
import { artists } from '@/server/db/schema';

jest.mock('@/server/utils/queriesTS');

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
  return new Request('http://localhost/api/findArtistBySpotifyID', init);
}

describe('findArtistBySpotifyID API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const res = await POST(createTestRequest({}, 'GET'));
    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method not allowed');
  });

  it('returns 400 when spotifyID is missing', async () => {
    const res = await POST(createTestRequest({}));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing or invalid required parameters: spotifyID');
  });

  it('returns artist data when found', async () => {
    (getArtistByProperty as jest.Mock).mockResolvedValue({
      status: 200,
      data: { id: '1', name: 'Test Artist', spotify: 'valid-id' },
      message: '',
      isError: false,
    });

    const res = await POST(createTestRequest({ spotifyID: 'valid-id' }));
    expect(getArtistByProperty).toHaveBeenCalledWith(artists.spotify, 'valid-id');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ result: { id: '1', name: 'Test Artist', spotify: 'valid-id' } });
  });

  it('propagates error status and message from getArtistByProperty', async () => {
    (getArtistByProperty as jest.Mock).mockResolvedValue({
      status: 404,
      data: null,
      message: 'not found',
      isError: true,
    });

    const res = await POST(createTestRequest({ spotifyID: 'bad-id' }));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe('not found');
  });
});
