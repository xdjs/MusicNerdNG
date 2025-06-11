import { POST } from '@/app/api/findArtistBySpotifyID/route';
import { getArtistByProperty } from '@/server/utils/queriesTS';
import { artists } from '@/server/db/schema';

jest.mock('@/server/utils/queriesTS', () => ({
  getArtistByProperty: jest.fn()
}));

// Polyfill for Response.json in the test environment if not present
if (typeof (Response as any).json !== 'function') {
  (Response as any).json = (data: any, init?: ResponseInit) =>
    new Response(JSON.stringify(data), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {})
      }
    });
}

const createRequest = (body: any, method = 'POST') => {
  return new Request('http://localhost/api/findArtistBySpotifyID', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
};

describe('findArtistBySpotifyID API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const response = await POST(new Request('http://localhost/api/findArtistBySpotifyID', { method: 'GET' }));
    expect(response.status).toBe(405);
  });

  it('returns 400 when spotifyID is missing', async () => {
    const response = await POST(createRequest({}));
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain('Missing or invalid required parameters');
  });

  it('returns artist data when found', async () => {
    (getArtistByProperty as jest.Mock).mockResolvedValue({ isError: false, data: { id: '1', name: 'Test Artist' }, message: '', status: 200 });
    const response = await POST(createRequest({ spotifyID: 'abc123' }));
    expect(getArtistByProperty).toHaveBeenCalledWith(artists.spotify, 'abc123');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ result: { id: '1', name: 'Test Artist' } });
  });

  it('returns error message when artist is not found', async () => {
    (getArtistByProperty as jest.Mock).mockResolvedValue({ isError: true, data: null, message: 'not found', status: 404 });
    const response = await POST(createRequest({ spotifyID: 'missing' }));
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).toBe('not found');
  });
});
