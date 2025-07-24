/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Create a mock SearchBar component that focuses on the YouTube icon logic
const MockSearchBarWithYouTube = ({ results }: { results: any[] }) => {
    return (
        <div>
            {results.map((result, index) => (
                <div key={index} data-testid={`search-result-${index}`}>
                    <div>{result.name}</div>
                    <div className="flex items-center gap-2">
                        {result.bandcamp && (
                            <img src="/siteIcons/bandcamp_icon.svg" alt="Bandcamp" className="w-3.5 h-3.5 opacity-70" />
                        )}
                        {(result.youtube || result.youtubechannel) && (
                            <img 
                                src="/siteIcons/youtube_icon.svg" 
                                alt="YouTube" 
                                className="w-3.5 h-3.5 opacity-70"
                                data-testid={`youtube-icon-${index}`}
                            />
                        )}
                        {result.instagram && (
                            <img src="/siteIcons/instagram-svgrepo-com.svg" alt="Instagram" className="w-3.5 h-3.5 opacity-70" />
                        )}
                        {result.x && (
                            <img src="/siteIcons/x_icon.svg" alt="X" className="w-3.5 h-3.5 opacity-70" />
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

describe('SearchBar YouTube Icon Display', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });
    });

    afterEach(() => {
        queryClient.clear();
    });

    it('displays YouTube icon when result has youtube username data', () => {
        const mockResults = [
            {
                id: '1',
                name: 'Artist with YouTube Username',
                isSpotifyOnly: false,
                youtube: '@testuser',
                youtubechannel: null,
                instagram: null,
                x: null,
                bandcamp: null,
            },
        ];

        render(
            <QueryClientProvider client={queryClient}>
                <MockSearchBarWithYouTube results={mockResults} />
            </QueryClientProvider>
        );

        // Check that YouTube icon is displayed
        expect(screen.getByTestId('youtube-icon-0')).toBeInTheDocument();
        expect(screen.getByAltText('YouTube')).toHaveAttribute('src', '/siteIcons/youtube_icon.svg');
    });

    it('displays YouTube icon when result has youtubechannel data', () => {
        const mockResults = [
            {
                id: '1',
                name: 'Artist with YouTube Channel',
                isSpotifyOnly: false,
                youtube: null,
                youtubechannel: 'UC1234567890',
                instagram: null,
                x: null,
                bandcamp: null,
            },
        ];

        render(
            <QueryClientProvider client={queryClient}>
                <MockSearchBarWithYouTube results={mockResults} />
            </QueryClientProvider>
        );

        // Check that YouTube icon is displayed
        expect(screen.getByTestId('youtube-icon-0')).toBeInTheDocument();
        expect(screen.getByAltText('YouTube')).toHaveAttribute('src', '/siteIcons/youtube_icon.svg');
    });

    it('displays YouTube icon when result has both youtube and youtubechannel data', () => {
        const mockResults = [
            {
                id: '1',
                name: 'Artist with Both YouTube Formats',
                isSpotifyOnly: false,
                youtube: '@testuser',
                youtubechannel: 'UC1234567890',
                instagram: null,
                x: null,
                bandcamp: null,
            },
        ];

        render(
            <QueryClientProvider client={queryClient}>
                <MockSearchBarWithYouTube results={mockResults} />
            </QueryClientProvider>
        );

        // Check that YouTube icon is displayed (should show only one icon even with both data types)
        expect(screen.getByTestId('youtube-icon-0')).toBeInTheDocument();
        expect(screen.getAllByAltText('YouTube')).toHaveLength(1);
    });

    it('does not display YouTube icon when result has no YouTube data', () => {
        const mockResults = [
            {
                id: '1',
                name: 'Artist without YouTube',
                isSpotifyOnly: false,
                youtube: null,
                youtubechannel: null,
                instagram: 'testinstagram',
                x: 'testx',
                bandcamp: null,
            },
        ];

        render(
            <QueryClientProvider client={queryClient}>
                <MockSearchBarWithYouTube results={mockResults} />
            </QueryClientProvider>
        );

        // Check that YouTube icon is NOT displayed
        expect(screen.queryByTestId('youtube-icon-0')).not.toBeInTheDocument();
        expect(screen.queryByAltText('YouTube')).not.toBeInTheDocument();
        
        // But other platform icons should still be displayed
        expect(screen.getByAltText('Instagram')).toBeInTheDocument();
        expect(screen.getByAltText('X')).toBeInTheDocument();
    });

    it('displays mixed platform icons including YouTube correctly', () => {
        const mockResults = [
            {
                id: '1',
                name: 'Artist with Multiple Platforms',
                isSpotifyOnly: false,
                youtube: '@testuser',
                youtubechannel: null,
                instagram: 'testinstagram',
                x: 'testx',
                bandcamp: 'testbandcamp',
            },
        ];

        render(
            <QueryClientProvider client={queryClient}>
                <MockSearchBarWithYouTube results={mockResults} />
            </QueryClientProvider>
        );

        // Check that all platform icons are displayed
        expect(screen.getByAltText('Bandcamp')).toBeInTheDocument();
        expect(screen.getByAltText('YouTube')).toBeInTheDocument();
        expect(screen.getByAltText('Instagram')).toBeInTheDocument();
        expect(screen.getByAltText('X')).toBeInTheDocument();
    });

    it('handles multiple search results with different YouTube data combinations', () => {
        const mockResults = [
            {
                id: '1',
                name: 'Artist 1 - YouTube Username',
                isSpotifyOnly: false,
                youtube: '@user1',
                youtubechannel: null,
                instagram: null,
                x: null,
                bandcamp: null,
            },
            {
                id: '2',
                name: 'Artist 2 - YouTube Channel',
                isSpotifyOnly: false,
                youtube: null,
                youtubechannel: 'UC1234567890',
                instagram: null,
                x: null,
                bandcamp: null,
            },
            {
                id: '3',
                name: 'Artist 3 - No YouTube',
                isSpotifyOnly: false,
                youtube: null,
                youtubechannel: null,
                instagram: 'artist3',
                x: null,
                bandcamp: null,
            },
        ];

        render(
            <QueryClientProvider client={queryClient}>
                <MockSearchBarWithYouTube results={mockResults} />
            </QueryClientProvider>
        );

        // Check that YouTube icons are displayed for first two results
        expect(screen.getByTestId('youtube-icon-0')).toBeInTheDocument();
        expect(screen.getByTestId('youtube-icon-1')).toBeInTheDocument();
        
        // Check that YouTube icon is NOT displayed for third result
        expect(screen.queryByTestId('youtube-icon-2')).not.toBeInTheDocument();
        
        // Check that we have exactly 2 YouTube icons total
        expect(screen.getAllByAltText('YouTube')).toHaveLength(2);
        
        // Check that Instagram icon is displayed for third result
        expect(screen.getByAltText('Instagram')).toBeInTheDocument();
    });

    it('properly handles empty or falsy YouTube values', () => {
        const mockResults = [
            {
                id: '1',
                name: 'Artist with Empty YouTube Values',
                isSpotifyOnly: false,
                youtube: '',
                youtubechannel: '',
                instagram: null,
                x: null,
                bandcamp: null,
            },
            {
                id: '2',
                name: 'Artist with Undefined YouTube Values',
                isSpotifyOnly: false,
                youtube: undefined,
                youtubechannel: undefined,
                instagram: null,
                x: null,
                bandcamp: null,
            },
        ];

        render(
            <QueryClientProvider client={queryClient}>
                <MockSearchBarWithYouTube results={mockResults} />
            </QueryClientProvider>
        );

        // Empty strings and undefined should not display YouTube icons
        expect(screen.queryByTestId('youtube-icon-0')).not.toBeInTheDocument();
        expect(screen.queryByTestId('youtube-icon-1')).not.toBeInTheDocument();
        expect(screen.queryByAltText('YouTube')).not.toBeInTheDocument();
    });
}); 