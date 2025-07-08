import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Page from '../page';
import { getServerAuthSession } from '@/server/auth';
import { getUserById, getLeaderboard } from '@/server/utils/queriesTS';

// Mock the dependencies
jest.mock('@/server/auth', () => ({
    getServerAuthSession: jest.fn(),
}));

jest.mock('@/server/utils/queriesTS', () => ({
    getUserById: jest.fn(),
    getLeaderboard: jest.fn(),
}));

const mockGetServerAuthSession = getServerAuthSession as jest.MockedFunction<typeof getServerAuthSession>;
const mockGetUserById = getUserById as jest.MockedFunction<typeof getUserById>;
const mockGetLeaderboard = getLeaderboard as jest.MockedFunction<typeof getLeaderboard>;

describe('UGC Stats Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset environment variables for each test
        delete process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT;
        
        // Mock getLeaderboard to return empty array
        mockGetLeaderboard.mockResolvedValue([]);
    });

    it('should show login page when not authenticated and wallet required', async () => {
        mockGetServerAuthSession.mockResolvedValue(null);

        const page = await Page();
        render(page);

        expect(screen.getByText('Login to view UGC Stats')).toBeInTheDocument();
    });

    it('should show dashboard when walletless mode is enabled', async () => {
        // Enable walletless mode (NODE_ENV is already "test" during Jest execution)
        process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'true';
        
        mockGetServerAuthSession.mockResolvedValue(null);

        const page = await Page();
        render(page);

        // Should show the dashboard with leaderboard
        expect(screen.getByText('UGC Stats')).toBeInTheDocument();
        expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    });

    it('should show dashboard when authenticated', async () => {
        const mockSession = {
            user: {
                id: 'test-user-id',
                walletAddress: '0x123...',
                email: 'test@example.com',
                name: 'Test User',
            }
        };

        const mockUser = {
            id: 'test-user-id',
            wallet: '0x123...',
            email: 'test@example.com',
            username: 'Test User',
            isAdmin: false,
            isWhiteListed: false,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
            legacyId: null
        };

        mockGetServerAuthSession.mockResolvedValue(mockSession as any);
        mockGetUserById.mockResolvedValue(mockUser as any);

        const page = await Page();
        render(page);

        expect(screen.getByText('UGC Stats')).toBeInTheDocument();
    });
}); 