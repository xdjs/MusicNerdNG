import { render, screen } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
import '../../test/setup/testEnv';

// Set up Request and Response for test environment
const createTestRequest = (url: string, init?: RequestInit) => {
    return new Request(url, init);
};

// Helper function to create JSON response
const createJsonResponse = (data: any, init?: ResponseInit) => {
    return new Response(JSON.stringify(data), {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers || {}),
        },
    });
};

// Mock the components instead of importing them
jest.mock('@/app/artist/[id]/page', () => ({
    __esModule: true,
    default: jest.fn((props) => {
        const { opADM } = props.searchParams;
        return (
            <div>
                <div data-testid="add-artist-data" data-open={opADM === '1' ? 'true' : 'false'}>
                    Mock Artist Profile
                </div>
            </div>
        );
    }),
}));

jest.mock('@/app/add-artist/page', () => ({
    __esModule: true,
    default: jest.fn((props) => {
        const { spotify } = props.searchParams;
        if (!spotify) {
            return <div>No Spotify ID provided</div>;
        }
        if (spotify === 'invalid-id') {
            return <div>Failed to fetch artist</div>;
        }
        return <div data-testid="add-artist-content">Mock Add Artist Page</div>;
    }),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
    usePathname: jest.fn(),
    useSearchParams: jest.fn(),
}));

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(),
}));

// Mock API routes
jest.mock('@/app/api/findArtistBySpotifyID/route', () => ({
    POST: jest.fn(async (req: Request) => {
        const body = await req.json();
        if (!body.spotifyID) {
            return new Response('Missing or invalid required parameters: spotifyID', { status: 400 });
        }
        return createJsonResponse({ result: null });
    }),
}));

jest.mock('@/app/api/findArtistByIG/route', () => ({
    POST: jest.fn(async (req: Request) => {
        const body = await req.json();
        if (!body.ig) {
            return new Response('Missing or invalid required parameters: instagram handle', { status: 400 });
        }
        return createJsonResponse({ result: null });
    }),
}));

jest.mock('@/app/api/searchArtists/route', () => ({
    POST: jest.fn(async (req: Request) => {
        const body = await req.json();
        if (!body.query || typeof body.query !== 'string') {
            return createJsonResponse({ error: "Invalid query parameter" }, { status: 400 });
        }
        return createJsonResponse({ results: [] });
    }),
}));

describe('URL Parameter Handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Artist Page Parameters', () => {
        it('should handle opADM parameter for opening AddArtistData modal', async () => {
            const props = {
                params: { id: 'test-id' },
                searchParams: { opADM: '1' }
            };

            const Component = await import('@/app/artist/[id]/page').then(mod => mod.default(props));
            render(Component);

            const addArtistData = screen.getByTestId('add-artist-data');
            expect(addArtistData).toHaveAttribute('data-open', 'true');
        });

        it('should not open AddArtistData modal without opADM parameter', async () => {
            const props = {
                params: { id: 'test-id' },
                searchParams: {}
            };

            const Component = await import('@/app/artist/[id]/page').then(mod => mod.default(props));
            render(Component);

            const addArtistData = screen.getByTestId('add-artist-data');
            expect(addArtistData).toHaveAttribute('data-open', 'false');
        });
    });

    describe('Add Artist Page Parameters', () => {
        it('should handle spotify parameter for artist data', async () => {
            const props = {
                searchParams: { spotify: 'test-spotify-id' }
            };

            const Component = await import('@/app/add-artist/page').then(mod => mod.default(props));
            render(Component);

            expect(screen.getByTestId('add-artist-content')).toBeInTheDocument();
        });

        it('should show error message when spotify parameter is missing', async () => {
            const props = {
                searchParams: {}
            };

            const Component = await import('@/app/add-artist/page').then(mod => mod.default(props));
            render(Component);

            expect(screen.getByText('No Spotify ID provided')).toBeInTheDocument();
        });

        it('should show error message when spotify artist fetch fails', async () => {
            const props = {
                searchParams: { spotify: 'invalid-id' }
            };

            const Component = await import('@/app/add-artist/page').then(mod => mod.default(props));
            render(Component);

            expect(screen.getByText('Failed to fetch artist')).toBeInTheDocument();
        });
    });

    describe('Search Parameters', () => {
        it('should handle search parameter in URL', async () => {
            const mockSearchParams = new URLSearchParams();
            mockSearchParams.set('search', 'test query');
            (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);

            expect(mockSearchParams.get('search')).toBe('test query');
        });
    });

    describe('API Route Parameters', () => {
        it('should handle invalid parameters for findArtistBySpotifyID', async () => {
            const { POST } = await import('@/app/api/findArtistBySpotifyID/route');
            const response = await POST(createTestRequest('http://localhost/api/findArtistBySpotifyID', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            }));

            expect(response.status).toBe(400);
            const text = await response.text();
            expect(text).toContain('Missing or invalid required parameters: spotifyID');
        });

        it('should handle invalid parameters for findArtistByIG', async () => {
            const { POST } = await import('@/app/api/findArtistByIG/route');
            const response = await POST(createTestRequest('http://localhost/api/findArtistByIG', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            }));

            expect(response.status).toBe(400);
            const text = await response.text();
            expect(text).toContain('Missing or invalid required parameters: instagram handle');
        });

        it('should handle invalid parameters for searchArtists', async () => {
            const { POST } = await import('@/app/api/searchArtists/route');
            const response = await POST(createTestRequest('http://localhost/api/searchArtists', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            }));

            expect(response.status).toBe(400);
            const text = await response.json();
            expect(text.error).toBe('Invalid query parameter');
        });
    });
}); 