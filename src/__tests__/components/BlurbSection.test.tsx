/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlurbSection from '@/app/artist/[id]/_components/BlurbSection';

// Use the global fetch mock that's already set up in jest.setup.ts
const mockFetch = global.fetch as jest.Mock;

describe('BlurbSection', () => {
    const defaultProps = {
        artistName: 'Test Artist',
        artistId: 'test-artist-id'
    };

    const longContent = 'This is a very long content that should be more than 200 characters to trigger the Read More functionality. It needs to be long enough to test the character limit check. This should definitely be over 200 characters now.';

    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockClear();
    });

    describe('Basic Rendering', () => {
        it('renders loading state initially', () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ bio: 'Test bio content' })
            });

            render(<BlurbSection {...defaultProps} />);
            
            expect(screen.getByText('Loading summary...')).toBeInTheDocument();
        });

        it('displays AI-generated content when loaded', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ bio: 'AI generated bio content' })
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.getByText('AI generated bio content')).toBeInTheDocument();
            });
        });

        it('displays error message when API fails', async () => {
            mockFetch.mockRejectedValueOnce(new Error('API Error'));

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.getByText('Failed to load summary.')).toBeInTheDocument();
            });
        });


    });

    describe('Read More Functionality', () => {
        it('shows Read More button for long content', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ bio: longContent })
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.getByText('Read More')).toBeInTheDocument();
            });
        });

        it('does not show Read More button for short content', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ bio: 'Short content' })
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.queryByText('Read More')).not.toBeInTheDocument();
            });
        });

        it('opens modal when Read More is clicked', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ bio: longContent })
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.getByText('Read More')).toBeInTheDocument();
            });

            fireEvent.click(screen.getByText('Read More'));
            
            expect(screen.getByText('Show less')).toBeInTheDocument();
        });

        it('closes modal when Show less is clicked', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ bio: longContent })
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.getByText('Read More')).toBeInTheDocument();
            });

            fireEvent.click(screen.getByText('Read More'));
            expect(screen.getByText('Show less')).toBeInTheDocument();

            fireEvent.click(screen.getByText('Show less'));
            expect(screen.queryByText('Show less')).not.toBeInTheDocument();
        });
    });

    describe('API Integration', () => {
        it('calls the correct API endpoint', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ bio: 'Test bio' })
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(mockFetch).toHaveBeenCalledWith('/api/artistBio/test-artist-id');
            });
        });

        it('handles non-ok response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.getByText('Failed to load summary.')).toBeInTheDocument();
            });
        });
    });
}); 