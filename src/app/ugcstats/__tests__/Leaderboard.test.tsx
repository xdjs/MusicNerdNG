import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Leaderboard from '../Leaderboard';

// Mock fetch globally
global.fetch = jest.fn();

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Leaderboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should render loading state initially', () => {
        mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves
        
        render(<Leaderboard />);
        
        expect(screen.getByText('Leaderboard')).toBeInTheDocument();
        expect(screen.getByText('Loading leaderboard...')).toBeInTheDocument();
    });

    it('should render leaderboard data when loaded', async () => {
        const mockData = [
            {
                userId: 'user1',
                wallet: '0x1234567890123456789012345678901234567890',
                username: 'user1',
                email: 'user1@test.com',
                artistsCount: 10,
                ugcCount: 5
            }
        ];

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockData,
        } as Response);

        render(<Leaderboard />);

        await waitFor(() => {
            expect(screen.getByText('Leaderboard')).toBeInTheDocument();
            expect(screen.getByText('user1')).toBeInTheDocument();
            // Counts rendered as plain numbers inside badges
            expect(screen.getByText('10')).toBeInTheDocument();
            expect(screen.getByText('5')).toBeInTheDocument();
        });
    });

    it('should render error state when API fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        render(<Leaderboard />);

        await waitFor(() => {
            expect(screen.getByText('Failed to load leaderboard')).toBeInTheDocument();
        });
    });

    it('should render empty state when no data', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => [],
        } as Response);

        render(<Leaderboard />);

        await waitFor(() => {
            expect(screen.getByText('No users have added artists yet. Be the first!')).toBeInTheDocument();
        });
    });
}); 