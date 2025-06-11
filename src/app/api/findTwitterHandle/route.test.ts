import { POST } from '@/app/api/findTwitterHandle/route';
import { getArtistByNameApiResp, getArtistByWalletOrEns } from '@/server/utils/queriesTS';

jest.mock('@/server/utils/queriesTS', () => ({
  getArtistByNameApiResp: jest.fn(),
  getArtistByWalletOrEns: jest.fn(),
}));

// Polyfill Response.json for the jsdom environment
if (typeof Response.json !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Response.json = function (data: any, init?: ResponseInit) {
    return new Response(JSON.stringify(data), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  };
}

const createTestRequest = (url: string, init?: RequestInit) => new Request(url, init);

describe('findTwitterHandle API route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const req = createTestRequest('http://localhost/api/findTwitterHandle', { method: 'GET' });
    const res = await POST(req as any);
    expect(res.status).toBe(405);
  });

  it('returns 400 when parameters are missing', async () => {
    const req = createTestRequest('http://localhost/api/findTwitterHandle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing or invalid required parameters');
  });

  it('returns Twitter handle when searching by name', async () => {
    (getArtistByNameApiResp as jest.Mock).mockResolvedValue({
      status: 200,
      data: { x: '@artist' },
      message: '',
    });

    const req = createTestRequest('http://localhost/api/findTwitterHandle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Artist' }),
    });

    const res = await POST(req as any);

    expect(getArtistByNameApiResp).toHaveBeenCalledWith('Artist');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ result: '@artist' });
  });

  it('returns Twitter handle when searching by ethAddress', async () => {
    (getArtistByWalletOrEns as jest.Mock).mockResolvedValue({
      status: 200,
      data: { x: '@wallet' },
      message: '',
    });

    const req = createTestRequest('http://localhost/api/findTwitterHandle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ethAddress: '0x1234567890abcdef1234567890abcdef12345678' }),
    });

    const res = await POST(req as any);

    expect(getArtistByWalletOrEns).toHaveBeenCalledWith('0x1234567890abcdef1234567890abcdef12345678');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ result: '@wallet' });
  });

  it('forwards error responses from lookup functions', async () => {
    (getArtistByNameApiResp as jest.Mock).mockResolvedValue({
      status: 404,
      data: null,
      message: 'Not found',
    });

    const req = createTestRequest('http://localhost/api/findTwitterHandle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Missing' }),
    });

    const res = await POST(req as any);

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe('Not found');
  });
});
