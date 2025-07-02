// @ts-nocheck

import { jest } from '@jest/globals';

// Mock QueriesTS module before dynamic import
jest.mock('@/server/utils/queriesTS', () => ({
    __esModule: true,
    getLeaderboard: jest.fn(),
}));

// Polyfill Response.json for test environment (NextResponse relies on it)
if (!('json' in Response)) {
    // @ts-ignore
    Response.json = (data: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            status: init?.status || 200,
            statusText: init?.statusText || 'OK',
        });
}

describe('Leaderboard API', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('should return leaderboard data successfully', async () => {
        const mockLeaderboard = [
            {
                userId: 'user1',
                wallet: '0x123...',
                username: 'user1',
                email: 'user1@test.com',
                artistsCount: 10,
                ugcCount: 5,
            },
        ];

        const { getLeaderboard } = await import('@/server/utils/queriesTS');
        (getLeaderboard as jest.Mock).mockResolvedValue(mockLeaderboard);

        const { GET } = await import('../route');

        const response = await GET();

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data).toEqual(mockLeaderboard);
    });

    it('should handle errors gracefully', async () => {
        const { getLeaderboard } = await import('@/server/utils/queriesTS');
        (getLeaderboard as jest.Mock).mockRejectedValue(new Error('Database error'));

        const { GET } = await import('../route');

        const response = await GET();

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(500);

        const data = await response.json();
        expect(data.error).toBe('Failed to fetch leaderboard');
        expect(data.details).toBe('Database error');
    });
}); 