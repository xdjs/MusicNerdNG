import '../../test/setup/testEnv';
import { POST } from '@/app/api/findTwitterHandle/route';
import { getArtistByNameApiResp, getArtistByWalletOrEns } from '@/server/utils/queries/artistQueries';

// Polyfill Response.json for the test environment
if (typeof (Response as any).json !== 'function') {
  (Response as any).json = (data: any, init?: ResponseInit) =>
    new Response(JSON.stringify(data), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
}

jest.mock('@/server/utils/queries/artistQueries', () => ({
  getArtistByNameApiResp: jest.fn(),
  getArtistByWalletOrEns: jest.fn(),
}));

const createRequest = (body?: any, method: string = 'POST') => {
  return new Request('http://localhost/api/findTwitterHandle', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
};

describe('findTwitterHandle API route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const res = await POST(createRequest(undefined, 'GET'));
    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method not allowed');
  });

  it('returns 400 when both name and ethAddress are missing', async () => {
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing or invalid required parameters: name or ethAddress');
  });

  it('returns twitter handle when searching by ethAddress', async () => {
    (getArtistByWalletOrEns as jest.Mock).mockResolvedValue({
      status: 200,
      message: '',
      data: { x: '@handle' },
      isError: false,
    });

    const res = await POST(createRequest({ ethAddress: '0xabc' }));
    expect(getArtistByWalletOrEns).toHaveBeenCalledWith('0xabc');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ result: '@handle' });
  });

  it('propagates error when search by ethAddress fails', async () => {
    (getArtistByWalletOrEns as jest.Mock).mockResolvedValue({
      status: 404,
      message: 'not found',
      data: null,
      isError: true,
    });

    const res = await POST(createRequest({ ethAddress: '0xmissing' }));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe('not found');
  });

  it('returns twitter handle when searching by name', async () => {
    (getArtistByNameApiResp as jest.Mock).mockResolvedValue({
      status: 200,
      message: '',
      data: { x: '@name' },
      isError: false,
    });

    const res = await POST(createRequest({ name: 'Artist' }));
    expect(getArtistByNameApiResp).toHaveBeenCalledWith('Artist');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ result: '@name' });
  });

  it('propagates error when search by name fails', async () => {
    (getArtistByNameApiResp as jest.Mock).mockResolvedValue({
      status: 404,
      message: 'not found',
      data: null,
      isError: true,
    });

    const res = await POST(createRequest({ name: 'Unknown' }));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe('not found');
  });
});
