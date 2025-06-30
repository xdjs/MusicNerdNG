import { GET } from '../route';
import { getLeaderboard } from '@/server/utils/queriesTS';
import { NextRequest } from 'next/server';

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

// Mock the getLeaderboard function
jest.mock('@/server/utils/queriesTS', () => ({
    getLeaderboard: jest.fn(),
}));

const mockGetLeaderboard = getLeaderboard as jest.MockedFunction<typeof getLeaderboard>;

// Helper function to create a mock NextRequest
function createMockRequest(url: string = 'http://localhost:3000/api/leaderboard'): NextRequest {
    return {
        url,
        nextUrl: new URL(url),
        headers: new Headers(),
        method: 'GET',
        body: null,
        json: jest.fn(),
        text: jest.fn(),
        formData: jest.fn(),
        clone: jest.fn(),
    } as unknown as NextRequest;
}

describe('Leaderboard API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return leaderboard data successfully', async () => {
        const mockLeaderboard = [
            {
                userId: 'user1',
                wallet: '0x123...',
                username: 'user1',
                email: 'user1@test.com',
                artistsCount: 10,
                ugcCount: 5
            }
        ];

        mockGetLeaderboard.mockResolvedValue(mockLeaderboard);

        const request = createMockRequest();
        const response = await GET(request);
        
        // Check if response is a Response object
        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(200);
        
        const data = await response.json();
        expect(data).toEqual(mockLeaderboard);
    });

    it('should handle errors gracefully', async () => {
        const errorMessage = 'Database error';
        mockGetLeaderboard.mockRejectedValue(new Error(errorMessage));

        const request = createMockRequest();
        const response = await GET(request);
        
        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(500);
        
        const data = await response.json();
        expect(data.error).toBe('Failed to fetch leaderboard');
        expect(data.details).toBe(errorMessage);
    });
}); 