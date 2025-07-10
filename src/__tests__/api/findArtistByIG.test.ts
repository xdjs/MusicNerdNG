import '../../test/setup/testEnv';
import { POST } from '@/app/api/findArtistByIG/route';
import { getArtistByProperty } from '@/server/utils/queries/artistQueries';
import { artists } from '@/server/db/schema';

// Polyfill Response.json for the test environment
if (!(Response as any).json) {
    (Response as any).json = (data: any, init?: ResponseInit) =>
        new Response(JSON.stringify(data), {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...(init?.headers || {}),
            },
        });
}

jest.mock('@/server/utils/queries/artistQueries', () => ({
    getArtistByProperty: jest.fn(),
}));

const createRequest = (body?: any, method: string = 'POST') => {
    return new Request('http://localhost/api/findArtistByIG', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
};

describe('findArtistByIG API route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns 405 for non-POST requests', async () => {
        const response = await POST(createRequest(undefined, 'GET'));
        expect(response.status).toBe(405);
        const text = await response.text();
        expect(text).toContain('Method not allowed');
    });

    it('returns 400 when instagram handle is missing', async () => {
        const response = await POST(createRequest({}));
        expect(response.status).toBe(400);
        const text = await response.text();
        expect(text).toContain('Missing or invalid required parameters: instagram handle');
    });

    it('returns artist data when found', async () => {
        (getArtistByProperty as jest.Mock).mockResolvedValue({
            isError: false,
            message: '',
            data: { id: '1', instagram: 'test', name: 'Test Artist' },
            status: 200,
        });

        const response = await POST(createRequest({ ig: 'test' }));
        expect(getArtistByProperty).toHaveBeenCalledWith(artists.instagram, 'test');
        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json).toEqual({ result: { id: '1', instagram: 'test', name: 'Test Artist' } });
    });

    it('returns error message when artist is not found', async () => {
        (getArtistByProperty as jest.Mock).mockResolvedValue({
            isError: true,
            message: 'not found',
            data: null,
            status: 404,
        });

        const response = await POST(createRequest({ ig: 'missing' }));
        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).toBe('not found');
    });
});
