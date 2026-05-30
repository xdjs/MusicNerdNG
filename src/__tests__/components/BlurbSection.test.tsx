/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlurbSection from '@/app/artist/[id]/_components/BlurbSection';
import { EditModeContext } from '@/app/_components/EditModeContext';

// Mock the useArtistBio hook
jest.mock('@/hooks/useArtistBio', () => ({
    useArtistBio: jest.fn()
}));

import { useArtistBio } from '@/hooks/useArtistBio';

describe('BlurbSection', () => {
    const defaultProps = {
        artistName: 'Test Artist',
        artistId: 'test-artist-id'
    };

    const longContent = 'This is a very long content that should be more than 200 characters to trigger the Read more functionality. It needs to be long enough to test the character limit check. This should definitely be over 200 characters now.';

    const mockUseArtistBio = useArtistBio as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        // Default mock implementation
        mockUseArtistBio.mockReturnValue({
            bio: 'Test bio content',
            loading: false,
            error: null,
            refetch: jest.fn()
        });
    });

    describe('Basic Rendering', () => {
        it('renders loading state initially', () => {
            mockUseArtistBio.mockReturnValue({
                bio: undefined,
                loading: true,
                error: null,
                refetch: jest.fn()
            });

            render(<BlurbSection {...defaultProps} />);
            
            expect(screen.getByText('Loading summary...')).toBeInTheDocument();
        });

        it('displays AI-generated content when loaded', async () => {
            mockUseArtistBio.mockReturnValue({
                bio: 'AI generated bio content',
                loading: false,
                error: null,
                refetch: jest.fn()
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.getByText('AI generated bio content')).toBeInTheDocument();
            });
        });

        it('displays error message when API fails', async () => {
            mockUseArtistBio.mockReturnValue({
                bio: 'Failed to load summary.',
                loading: false,
                error: 'API Error',
                refetch: jest.fn()
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.getByText('Failed to load summary.')).toBeInTheDocument();
            });
        });
    });

    describe('Full bio (no truncation)', () => {
        it('renders the full bio with no Read more / Show less control', async () => {
            mockUseArtistBio.mockReturnValue({
                bio: longContent,
                loading: false,
                error: null,
                refetch: jest.fn()
            });

            render(<BlurbSection {...defaultProps} />);

            await waitFor(() => {
                expect(screen.getByText(longContent)).toBeInTheDocument();
                expect(screen.queryByText('Read more')).not.toBeInTheDocument();
                expect(screen.queryByText('Show less')).not.toBeInTheDocument();
            });
        });
    });

    describe('API Integration', () => {
        it('calls the correct API endpoint', async () => {
            const mockRefetch = jest.fn();
            mockUseArtistBio.mockReturnValue({
                bio: 'Test bio content',
                loading: false,
                error: null,
                refetch: mockRefetch
            });

            render(<BlurbSection {...defaultProps} />);
            
            // The hook should be called with the correct artist ID and initialBio (undefined when not provided)
            expect(mockUseArtistBio).toHaveBeenCalledWith('test-artist-id', undefined);
        });

        it('handles non-ok response', async () => {
            mockUseArtistBio.mockReturnValue({
                bio: 'Failed to load summary.',
                loading: false,
                error: 'HTTP 500: Internal Server Error',
                refetch: jest.fn()
            });

            render(<BlurbSection {...defaultProps} />);
            
            await waitFor(() => {
                expect(screen.getByText('Failed to load summary.')).toBeInTheDocument();
            });
        });
    });

    describe('Edit Mode Functionality', () => {
        const renderWithEditMode = (canEdit = true) => {
            return render(
                <EditModeContext.Provider value={{ isEditing: true, canEdit, toggle: jest.fn() }}>
                    <BlurbSection {...defaultProps} />
                </EditModeContext.Provider>
            );
        };

        it('shows textarea in edit mode', async () => {
            mockUseArtistBio.mockReturnValue({
                bio: 'Original bio',
                loading: false,
                error: null,
                refetch: jest.fn()
            });

            renderWithEditMode();
            
            await waitFor(() => {
                expect(screen.getByPlaceholderText('Enter artist bio...')).toBeInTheDocument();
            });
        });

        it('populates textarea with current bio', async () => {
            mockUseArtistBio.mockReturnValue({
                bio: 'Original bio',
                loading: false,
                error: null,
                refetch: jest.fn()
            });

            renderWithEditMode();
            
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                expect(textarea.value).toBe('Original bio');
            });
        });

        it('updates textarea value when user types', async () => {
            mockUseArtistBio.mockReturnValue({
                bio: 'Original bio',
                loading: false,
                error: null,
                refetch: jest.fn()
            });

            renderWithEditMode();
            
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                fireEvent.change(textarea, { target: { value: 'Updated bio' } });
                expect(textarea.value).toBe('Updated bio');
            });
        });
    });

    describe('Regenerate Functionality', () => {
        const renderWithEditMode = (canEdit = true) => {
            return render(
                <EditModeContext.Provider value={{ isEditing: true, canEdit, toggle: jest.fn() }}>
                    <BlurbSection {...defaultProps} />
                </EditModeContext.Provider>
            );
        };

        it('updates bio content after successful regeneration in edit mode', async () => {
            const mockRefetch = jest.fn();
            mockUseArtistBio.mockReturnValue({
                bio: 'Original bio',
                loading: false,
                error: null,
                refetch: mockRefetch
            });

            renderWithEditMode();
            
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                expect(textarea.value).toBe('Original bio');
            });

            // Mock the fetch response for regeneration BEFORE clicking
            global.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ bio: 'Regenerated bio' })
            });

            fireEvent.click(screen.getByText('Regenerate'));

            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                expect(textarea.value).toBe('Regenerated bio');
            });
        });

        it('handles regenerate API error in edit mode', async () => {
            const mockRefetch = jest.fn();
            mockUseArtistBio.mockReturnValue({
                bio: 'Original bio',
                loading: false,
                error: null,
                refetch: mockRefetch
            });

            renderWithEditMode();
            
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                expect(textarea.value).toBe('Original bio');
            });

            // Mock the fetch response for regeneration error
            global.fetch = jest.fn().mockRejectedValueOnce(new Error('Regeneration failed'));

            fireEvent.click(screen.getByText('Regenerate'));

            // Should still show original bio after error
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                expect(textarea.value).toBe('Original bio');
            });
        });

        it('discard restores original bio after regeneration', async () => {
            const mockRefetch = jest.fn();
            mockUseArtistBio.mockReturnValue({
                bio: 'Original bio',
                loading: false,
                error: null,
                refetch: mockRefetch
            });

            renderWithEditMode();
            
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                expect(textarea.value).toBe('Original bio');
            });

            // Click regenerate
            global.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ bio: 'Regenerated bio' })
            });

            fireEvent.click(screen.getByText('Regenerate'));

            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                expect(textarea.value).toBe('Regenerated bio');
            });

            // Click discard
            fireEvent.click(screen.getByText('Discard'));

            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                expect(textarea.value).toBe('Original bio');
            });
        });

        it('save updates original bio state', async () => {
            const mockRefetch = jest.fn();
            mockUseArtistBio.mockReturnValue({
                bio: 'Original bio',
                loading: false,
                error: null,
                refetch: mockRefetch
            });

            renderWithEditMode();
            
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
                expect(textarea.value).toBe('Original bio');
            });

            // Edit the bio text
            const textarea = screen.getByPlaceholderText('Enter artist bio...') as HTMLTextAreaElement;
            fireEvent.change(textarea, { target: { value: 'Updated bio' } });

            // Mock successful save
            global.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ message: 'Bio updated' })
            });

            fireEvent.click(screen.getByText('Save'));

            await waitFor(() => {
                expect(mockRefetch).toHaveBeenCalled();
            });
        });
    });

    describe('Edit controls are edit-mode only', () => {
        beforeEach(() => {
            mockUseArtistBio.mockReturnValue({
                bio: 'Some bio',
                loading: false,
                error: null,
                refetch: jest.fn(),
            });
        });

        it('does NOT show Regenerate or Save to vault in the read view, even for an editor not in edit mode', () => {
            render(
                <EditModeContext.Provider value={{ isEditing: false, canEdit: true, toggle: jest.fn() }}>
                    <BlurbSection {...defaultProps} />
                </EditModeContext.Provider>
            );
            expect(screen.queryByText('Save to vault')).not.toBeInTheDocument();
            expect(screen.queryByText('Regenerate')).not.toBeInTheDocument();
        });

        it('shows Regenerate and Save to vault only in edit mode', () => {
            render(
                <EditModeContext.Provider value={{ isEditing: true, canEdit: true, toggle: jest.fn() }}>
                    <BlurbSection {...defaultProps} />
                </EditModeContext.Provider>
            );
            expect(screen.getByText('Save to vault')).toBeInTheDocument();
            expect(screen.getByText('Regenerate')).toBeInTheDocument();
        });
    });
});
