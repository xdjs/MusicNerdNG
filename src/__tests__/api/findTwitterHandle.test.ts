import '../../test/setup/testEnv';
import { describe, it, expect, beforeEach, beforeAll } from '@jest/globals';

jest.mock('@/server/utils/queriesTS', () => ({
    getArtistByWalletOrEns: jest.fn(),
    getArtistByNameApiResp: jest.fn()
}));

import { getArtistByWalletOrEns, getArtistByNameApiResp } from '@/server/utils/queriesTS';

const createTestRequest = (body: any) => {
    return new Request('http://localhost/api/findTwitterHandle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
};

describe('findTwitterHandle API route', () => {
    beforeAll(() => {
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
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns twitter handle when searching by ethAddress', async () => {
        (getArtistByWalletOrEns as jest.Mock).mockResolvedValueOnce({
            status: 200,
            data: { x: 'walletUser' },
            message: '',
            isError: false
        });
        const { POST } = await import('@/app/api/findTwitterHandle/route');

        const response = await POST(createTestRequest({ ethAddress: '0xabc' }));

        expect(getArtistByWalletOrEns).toHaveBeenCalledWith('0xabc');
        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.result).toBe('walletUser');
    });

    it('propagates error when wallet search fails', async () => {
        (getArtistByWalletOrEns as jest.Mock).mockResolvedValueOnce({
            status: 404,
            data: null,
            message: 'not found',
            isError: true
        });
        const { POST } = await import('@/app/api/findTwitterHandle/route');

        const response = await POST(createTestRequest({ ethAddress: '0xdef' }));

        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).toBe('not found');
    });

    it('returns twitter handle when searching by name', async () => {
        (getArtistByNameApiResp as jest.Mock).mockResolvedValueOnce({
            status: 200,
            data: { x: 'nameUser' },
            message: '',
            isError: false
        });
        const { POST } = await import('@/app/api/findTwitterHandle/route');

        const response = await POST(createTestRequest({ name: 'Artist' }));

        expect(getArtistByNameApiResp).toHaveBeenCalledWith('Artist');
        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.result).toBe('nameUser');
    });

    it('propagates error when name search fails', async () => {
        (getArtistByNameApiResp as jest.Mock).mockResolvedValueOnce({
            status: 500,
            data: null,
            message: 'server error',
            isError: true
        });
        const { POST } = await import('@/app/api/findTwitterHandle/route');

        const response = await POST(createTestRequest({ name: 'Bad Artist' }));

        expect(response.status).toBe(500);
        const text = await response.text();
        expect(text).toBe('server error');
    });

    it('returns 400 when parameters are missing', async () => {
        const { POST } = await import('@/app/api/findTwitterHandle/route');
        const response = await POST(createTestRequest({}));

        expect(response.status).toBe(400);
        const text = await response.text();
        expect(text).toContain('Missing or invalid required parameters');
    });
});
