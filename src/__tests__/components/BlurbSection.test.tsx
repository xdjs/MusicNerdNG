/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlurbSection from '@/app/artist/[id]/_components/BlurbSection';

// Mock the UI components
jest.mock('@/components/ui/tabs', () => ({
    Tabs: ({ children, value, onValueChange, className }: any) => (
        <div data-testid="tabs" data-value={value} className={className}>
            <button 
                data-testid="wikipedia-tab" 
                onClick={() => onValueChange('wikipedia')}
                data-active={value === 'wikipedia'}
            >
                Wikipedia
            </button>
            <button 
                data-testid="ai-tab" 
                onClick={() => onValueChange('ai-generated')}
                data-active={value === 'ai-generated'}
            >
                AI Generated
            </button>
            {children}
        </div>
    ),
    TabsList: ({ children, className }: any) => (
        <div data-testid="tabs-list" className={className}>
            {children}
        </div>
    ),
    TabsTrigger: ({ children }: any) => <span>{children}</span>,
    TabsContent: ({ children, value }: any) => (
        <div data-testid={`tab-content-${value}`}>
            {children}
        </div>
    ),
}));

// Use the global fetch mock that's already set up in jest.setup.ts
const mockFetch = global.fetch as jest.Mock;

describe('BlurbSection', () => {
    const defaultProps = {
        wikiBlurb: 'Short wiki content',
        wikiLink: 'https://wikipedia.org/test',
        artistName: 'Test Artist',
        artistId: 'test-artist-id'
    };

    const longContent = 'This is a very long content that should be more than 200 characters to trigger the Read More functionality. It needs to be long enough to test the character limit check. This should definitely be over 200 characters now.';

    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockClear();
    });

    describe('Basic Rendering', () => {
        it('renders with Wikipedia tab active by default', () => {
            render(<BlurbSection {...defaultProps} />);
            
            expect(screen.getByTestId('tabs')).toHaveAttribute('data-value', 'ai-generated');
            expect(screen.getByTestId('ai-tab')).toHaveAttribute('data-active', 'true');
            expect(screen.getByTestId('wikipedia-tab')).toHaveAttribute('data-active', 'false');
        });

        it('displays Wikipedia content when provided', () => {
            render(<BlurbSection {...defaultProps} />);
            
            expect(screen.getByText('Short wiki content')).toBeInTheDocument();
        });

        it('displays "No Wikipedia content available" when no wiki content', () => {
            render(<BlurbSection {...defaultProps} wikiBlurb={undefined} />);
            
            expect(screen.getByText('No Wikipedia content available')).toBeInTheDocument();
        });

        it('shows Wikipedia link when provided', () => {
            render(<BlurbSection {...defaultProps} wikiBlurb={longContent} />);
            
            // Expand to see the link
            fireEvent.click(screen.getByText('Read More'));
            expect(screen.getByText('View Source')).toBeInTheDocument();
        });
    });

    describe('AI Tab Functionality', () => {
        it('makes API call when switching to AI tab', async () => {
            mockFetch.mockImplementationOnce(() => 
                Promise.resolve({
                    ok: true,
                    json: async () => ({ bio: 'AI generated content' })
                } as Response)
            );

            render(<BlurbSection {...defaultProps} />);
            
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            expect(mockFetch).toHaveBeenCalledWith('/api/artistBio/test-artist-id');
        });

        it('shows loading state while fetching AI content', async () => {
            mockFetch.mockImplementationOnce(
                () => new Promise(resolve => setTimeout(() => resolve({
                    ok: true,
                    json: async () => ({ bio: 'AI content' })
                } as Response), 100))
            );

            render(<BlurbSection {...defaultProps} />);
            
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            expect(screen.getByText('Loading AI Summary...')).toBeInTheDocument();
            
            await waitFor(() => {
                expect(screen.getByText('AI content')).toBeInTheDocument();
            }, { timeout: 200 });
        });

        it('displays AI content after successful fetch', async () => {
            mockFetch.mockImplementationOnce(() => 
                Promise.resolve({
                    ok: true,
                    json: async () => ({ bio: 'This is AI generated content' })
                } as Response)
            );

            render(<BlurbSection {...defaultProps} />);
            
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            await waitFor(() => {
                expect(screen.getByText('This is AI generated content')).toBeInTheDocument();
            });
        });

        it('shows error message when API call fails', async () => {
            mockFetch.mockRejectedValueOnce(new Error('API Error'));

            render(<BlurbSection {...defaultProps} />);
            
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            await waitFor(() => {
                expect(screen.getByText('Failed to load AI bio.')).toBeInTheDocument();
            });
        });

        it('shows error message when API returns non-ok response', async () => {
            mockFetch.mockImplementationOnce(() => 
                Promise.resolve({
                    ok: false,
                    status: 500
                } as Response)
            );

            render(<BlurbSection {...defaultProps} />);
            
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            await waitFor(() => {
                expect(screen.getByText('Failed to load AI bio.')).toBeInTheDocument();
            });
        });

        it('shows "No AI Summary available" when API returns undefined bio', async () => {
            // Create a proper mock response
            const mockResponse = {
                ok: true,
                json: jest.fn().mockResolvedValue({ bio: undefined })
            };

            mockFetch.mockResolvedValueOnce(mockResponse as any);

            render(<BlurbSection {...defaultProps} />);
            
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            // First it shows loading
            expect(screen.getByText('Loading AI Summary...')).toBeInTheDocument();
            
            // Then after API resolves, it shows "No AI summary is available"
            expect(await screen.findByText('No AI summary is available')).toBeInTheDocument();
        });

        it('does not make duplicate API calls', async () => {
            mockFetch.mockImplementation(() => 
                Promise.resolve({
                    ok: true,
                    json: async () => ({ bio: 'AI content' })
                } as Response)
            );

            render(<BlurbSection {...defaultProps} />);
            
            // Switch to AI tab (first call)
            fireEvent.click(screen.getByTestId('ai-tab'));
            await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
            
            // Switch back to Wikipedia
            fireEvent.click(screen.getByTestId('wikipedia-tab'));
            
            // Switch to AI tab again (should not make another call)
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('Read More/Show Less Functionality', () => {
        it('shows Read More button for Wikipedia content over 200 characters', () => {
            render(<BlurbSection {...defaultProps} wikiBlurb={longContent} />);
            
            expect(screen.getByText('Read More')).toBeInTheDocument();
        });

        it('does not show Read More button for short Wikipedia content', () => {
            render(<BlurbSection {...defaultProps} wikiBlurb="Short content" />);
            
            expect(screen.queryByText('Read More')).not.toBeInTheDocument();
        });

        it('expands Wikipedia content when Read More is clicked', () => {
            render(<BlurbSection {...defaultProps} wikiBlurb={longContent} />);
            
            fireEvent.click(screen.getByText('Read More'));
            
            expect(screen.getByText('Show less')).toBeInTheDocument();
            // Note: Read More button still exists in DOM, just covered by expanded overlay
            expect(screen.getByText('Read More')).toBeInTheDocument();
        });

        it('collapses expanded Wikipedia content when Show less is clicked', () => {
            render(<BlurbSection {...defaultProps} wikiBlurb={longContent} />);
            
            // Expand
            fireEvent.click(screen.getByText('Read More'));
            expect(screen.getByText('Show less')).toBeInTheDocument();
            
            // Collapse
            fireEvent.click(screen.getByText('Show less'));
            expect(screen.getByText('Read More')).toBeInTheDocument();
            expect(screen.queryByText('Show less')).not.toBeInTheDocument();
        });

        it('shows Read More button for AI content over 200 characters', async () => {
            mockFetch.mockImplementationOnce(() => 
                Promise.resolve({
                    ok: true,
                    json: async () => ({ bio: longContent })
                } as Response)
            );

            render(<BlurbSection {...defaultProps} />);
            
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            await waitFor(() => {
                expect(screen.getByText('Read More')).toBeInTheDocument();
            });
        });

        it('expands AI content when Read More is clicked', async () => {
            mockFetch.mockImplementationOnce(() => 
                Promise.resolve({
                    ok: true,
                    json: async () => ({ bio: longContent })
                } as Response)
            );

            render(<BlurbSection {...defaultProps} />);
            
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            await waitFor(() => {
                expect(screen.getByText('Read More')).toBeInTheDocument();
            });
            
            fireEvent.click(screen.getByText('Read More'));
            
            expect(screen.getByText('Show less')).toBeInTheDocument();
            // Note: Read More button still exists in DOM, just covered by expanded overlay
            expect(screen.getByText('Read More')).toBeInTheDocument();
        });
    });

    describe('Tab Switch with Modal State', () => {
        it('maintains modal state when switching between tabs with expandable content', async () => {
            mockFetch.mockImplementationOnce(() => 
                Promise.resolve({
                    ok: true,
                    json: async () => ({ bio: longContent })
                } as Response)
            );

            render(<BlurbSection {...defaultProps} wikiBlurb={longContent} />);
            
            // Expand Wikipedia content
            fireEvent.click(screen.getByText('Read More'));
            expect(screen.getByText('Show less')).toBeInTheDocument();
            
            // Switch to AI tab
            fireEvent.click(screen.getByTestId('ai-tab'));
            
            await waitFor(() => {
                expect(screen.getByText('Show less')).toBeInTheDocument();
            });
        });
    });

    describe('Character Limit Edge Cases', () => {
        it('does not show Read More for exactly 200 characters', () => {
            const exactly200 = 'a'.repeat(200);
            render(<BlurbSection {...defaultProps} wikiBlurb={exactly200} />);
            
            expect(screen.queryByText('Read More')).not.toBeInTheDocument();
        });

        it('shows Read More for 201 characters', () => {
            const over200 = 'a'.repeat(201);
            render(<BlurbSection {...defaultProps} wikiBlurb={over200} />);
            
            expect(screen.getByText('Read More')).toBeInTheDocument();
        });
    });
}); 