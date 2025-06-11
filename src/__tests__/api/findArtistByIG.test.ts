import '../../test/setup/testEnv';

// Ensure Response.json exists in the test environment
if (typeof (Response as any).json !== 'function') {
  (Response as any).json = (body: any, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
}

import { artists } from '@/server/db/schema';
import { POST } from '@/app/api/findArtistByIG/route';
import { getArtistByProperty } from '@/server/utils/queriesTS';

jest.mock('@/server/utils/queriesTS', () => ({
  __esModule: true,
  getArtistByProperty: jest.fn(),
}));

const createRequest = (body: any, method: string = 'POST') =>
  new Request('http://localhost/api/findArtistByIG', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: JSON.stringify(body) }),
  });

describe('findArtistByIG API route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const res = await POST(createRequest({}, 'GET'));
    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method not allowed');
  });

  it('returns 400 when instagram handle is missing or invalid', async () => {
    let res = await POST(createRequest({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Missing or invalid required parameters: instagram handle');

    res = await POST(createRequest({ ig: 123 }));
    expect(res.status).toBe(400);
  });

  it('returns artist data when found', async () => {
    const mockArtist = { id: '1', name: 'Artist' };
    (getArtistByProperty as jest.Mock).mockResolvedValue({
      isError: false,
      message: '',
      data: mockArtist,
      status: 200,
    });

    const res = await POST(createRequest({ ig: 'artistig' }));

    expect(getArtistByProperty).toHaveBeenCalledWith(artists.instagram, 'artistig');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ result: mockArtist });
  });

  it('forwards error status and message from getArtistByProperty', async () => {
    (getArtistByProperty as jest.Mock).mockResolvedValue({
      isError: true,
      message: 'not found',
      data: null,
      status: 404,
    });

    const res = await POST(createRequest({ ig: 'missing' }));

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe('not found');
  });
});
