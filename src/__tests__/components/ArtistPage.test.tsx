import { render, screen } from '@testing-library/react';
import ArtistProfile, { generateMetadata } from '@/app/artist/[id]/page';
import { getArtistById, getArtistLinks, getAllLinks } from '@/server/utils/queries/artistQueries';
import { getSpotifyImage, getArtistWiki, getSpotifyHeaders, getNumberOfSpotifyReleases, getArtistTopTrack } from '@/server/utils/queries/externalApiQueries';
import { getServerAuthSession } from '@/server/auth';

// Mock next/navigation
const mockNotFound = jest.fn();
jest.mock('next/navigation', () => ({
    notFound: () => mockNotFound(),
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        prefetch: jest.fn(),
    }),
    useSearchParams: () => ({
        get: jest.fn(),
    }),
}));

// Mock react-spotify-embed
jest.mock('react-spotify-embed', () => ({
    Spotify: ({ link }: { link: string }) => (
        <div data-testid="spotify-embed" data-link={link}>
            Spotify Embed
        </div>
    ),
}));

// Mock server components
jest.mock('@/app/artist/[id]/_components/AddArtistData', () => ({
    __esModule: true,
    default: ({ isOpenOnLoad }: { isOpenOnLoad: boolean }) => (
        <div data-testid="add-artist-data" data-open={isOpenOnLoad}>
            Add Artist Data
        </div>
    ),
}));

// Mock LoadingPage component
jest.mock('@/app/_components/LoadingPage', () => ({
    __esModule: true,
    default: () => <div data-testid="loading-spinner">Loading...</div>,
}));

// Mock server actions
jest.mock('@/server/utils/queries/artistQueries', () => ({
    getArtistById: jest.fn(),
    getArtistLinks: jest.fn(),
    getAllLinks: jest.fn(),
    getUserById: jest.fn().mockResolvedValue({ isWhiteListed: false, isAdmin: false }),
}));

// Mock external API queries
jest.mock('@/server/utils/queries/externalApiQueries', () => ({
    getSpotifyImage: jest.fn(),
    getArtistWiki: jest.fn(),
    getSpotifyHeaders: jest.fn(),
    getNumberOfSpotifyReleases: jest.fn(),
    getArtistTopTrack: jest.fn(),
}));

// Mock auth
jest.mock('@/server/auth', () => ({
    getServerAuthSession: jest.fn(),
}));

// Mock child components
jest.mock('@/app/_components/ArtistLinks', () => {
    return function MockArtistLinks({ isMonetized, isOpenOnLoad }: { isMonetized: boolean; isOpenOnLoad?: boolean }) {
        return (
            <div data-testid={`artist-links-${isMonetized ? 'monetized' : 'social'}`}>
                Artist Links
                {!isMonetized && (
                    <div data-testid="add-artist-data" data-open={isOpenOnLoad ? 'true' : 'false'}>Add Artist Data</div>
                )}
            </div>
        );
    };
});

const mockArtist = {
    id: 'test-id',
    name: 'Test Artist',
    spotify: 'test-spotify-id',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lcname: 'test artist',
    addedBy: 'test-user-id',
    wikipedia: 'test-wiki',
};

const mockLinks = {
    spotify: 'test-spotify-id',
    twitter: null,
    instagram: null,
    facebook: null,
    youtube: null,
    soundcloud: null,
    bandcamp: null,
    tiktok: null,
};

const mockSpotifyImage = {
    artistImage: 'test-image-url',
};

const mockWiki = {
    blurb: 'Test wiki blurb',
    link: 'https://wikipedia.org/test',
};

describe('generateMetadata', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getArtistById as jest.Mock).mockReset();
        (getSpotifyHeaders as jest.Mock).mockReset();
        (getSpotifyImage as jest.Mock).mockReset();
    });

    it('returns artist-specific metadata for valid artist', async () => {
        const mockArtist = {
            id: 'test-id',
            name: 'Test Artist',
            spotify: 'test-spotify-id',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Discover Test Artist on Music Nerd - social media links, music, and more.');
        expect(getArtistById).toHaveBeenCalledWith('test-id');
        expect(getSpotifyHeaders).toHaveBeenCalled();
        expect(getSpotifyImage).toHaveBeenCalledWith('test-spotify-id', undefined, { headers: {} });
    });

    it('returns fallback metadata when artist is not found', async () => {
        (getArtistById as jest.Mock).mockResolvedValue(null);

        const metadata = await generateMetadata({ params: { id: 'non-existent-id' } });

        expect(metadata.title).toBe('Artist Not Found - Music Nerd');
        expect(metadata.description).toBe('The requested artist could not be found on Music Nerd.');
        expect(getArtistById).toHaveBeenCalledWith('non-existent-id');
        // Should not call Spotify APIs when artist is not found
        expect(getSpotifyHeaders).not.toHaveBeenCalled();
        expect(getSpotifyImage).not.toHaveBeenCalled();
    });

    it('handles special characters in artist names', async () => {
        const mockArtist = {
            id: 'test-id',
            name: 'Artist & The Band\'s "Greatest" Hits!',
            spotify: 'test-spotify-id',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Artist & The Band\'s "Greatest" Hits! - Music Nerd');
        expect(metadata.description).toBe('Discover Artist & The Band\'s "Greatest" Hits! on Music Nerd - social media links, music, and more.');
        expect(getSpotifyImage).toHaveBeenCalledWith('test-spotify-id', undefined, { headers: {} });
    });

    it('handles empty artist name gracefully', async () => {
        const mockArtist = {
            id: 'test-id',
            name: '',
            spotify: 'test-spotify-id',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe(' - Music Nerd');
        expect(metadata.description).toBe('Discover  on Music Nerd - social media links, music, and more.');
        expect(getSpotifyImage).toHaveBeenCalledWith('test-spotify-id', undefined, { headers: {} });
    });

    it('handles artist without Spotify ID', async () => {
        const mockArtist = {
            id: 'test-id',
            name: 'Test Artist',
            spotify: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: null });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Discover Test Artist on Music Nerd - social media links, music, and more.');
        expect(getSpotifyHeaders).toHaveBeenCalled();
        expect(getSpotifyImage).toHaveBeenCalledWith('', undefined, { headers: {} });
    });

    it('handles artist with empty Spotify ID', async () => {
        const mockArtist = {
            id: 'test-id',
            name: 'Test Artist',
            spotify: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: null });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Discover Test Artist on Music Nerd - social media links, music, and more.');
        expect(getSpotifyImage).toHaveBeenCalledWith('', undefined, { headers: {} });
    });
});

describe('ArtistPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getArtistById as jest.Mock).mockReset();
        (getArtistLinks as jest.Mock).mockReset();
        (getAllLinks as jest.Mock).mockReset();
        (getSpotifyImage as jest.Mock).mockReset();
        (getArtistWiki as jest.Mock).mockReset();
        (getSpotifyHeaders as jest.Mock).mockReset();
        (getNumberOfSpotifyReleases as jest.Mock).mockReset();
        (getArtistTopTrack as jest.Mock).mockReset();
        (getServerAuthSession as jest.Mock).mockReset();
        mockNotFound.mockReset();
    });

    const defaultProps = {
        params: { id: 'test-id' },
        searchParams: {} as { [key: string]: string | undefined }
    };

    it('renders artist data when available', async () => {
        // Set up mock responses
        (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
        (getAllLinks as jest.Mock).mockResolvedValue([]);
        (getArtistLinks as jest.Mock).mockResolvedValue(mockLinks);
        (getSpotifyImage as jest.Mock).mockResolvedValue(mockSpotifyImage);
        (getArtistWiki as jest.Mock).mockResolvedValue(mockWiki);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getNumberOfSpotifyReleases as jest.Mock).mockResolvedValue(10);
        (getArtistTopTrack as jest.Mock).mockResolvedValue('test-track-id');
        (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'test-user-id' } });

        // Render the component
        const Component = await ArtistProfile(defaultProps);
        render(Component);

        // Verify the rendered content
        expect(screen.getByText('Test Artist')).toBeInTheDocument();
        expect(screen.getByTestId('artist-links-social')).toBeInTheDocument();
        expect(screen.getByTestId('artist-links-monetized')).toBeInTheDocument();
        expect(screen.getByText('Loading summary...')).toBeInTheDocument();
    });

    it('calls notFound when artist is not found', async () => {
        (getArtistById as jest.Mock).mockResolvedValue(null);
        (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'test-user-id' } });
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });

        await ArtistProfile(defaultProps);
        expect(mockNotFound).toHaveBeenCalled();
    });

    it('handles missing spotify data', async () => {
        const artistWithoutSpotify = { ...mockArtist, spotify: null };
        (getArtistById as jest.Mock).mockResolvedValue(artistWithoutSpotify);
        (getAllLinks as jest.Mock).mockResolvedValue([]);
        (getArtistLinks as jest.Mock).mockResolvedValue(mockLinks);
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: null });
        (getArtistWiki as jest.Mock).mockResolvedValue(mockWiki);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getNumberOfSpotifyReleases as jest.Mock).mockResolvedValue(0);
        (getArtistTopTrack as jest.Mock).mockResolvedValue(null);
        (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'test-user-id' } });

        const Component = await ArtistProfile(defaultProps);
        render(Component);

        expect(screen.getByText('Test Artist')).toBeInTheDocument();
        // Spotify widget removed; ensure no embed is rendered
        expect(screen.queryByTestId('spotify-embed')).not.toBeInTheDocument();
        const img = screen.getByAltText('Artist Image');
        expect(img).toHaveAttribute('src', '/default_pfp_pink.png');
    });

    it('does not auto open AddArtistData anymore', async () => {
        const propsWithOpADM = {
            ...defaultProps,
            searchParams: { opADM: '1' }
        };

        (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
        (getAllLinks as jest.Mock).mockResolvedValue([]);
        (getArtistLinks as jest.Mock).mockResolvedValue(mockLinks);
        (getSpotifyImage as jest.Mock).mockResolvedValue(mockSpotifyImage);
        (getArtistWiki as jest.Mock).mockResolvedValue(mockWiki);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getNumberOfSpotifyReleases as jest.Mock).mockResolvedValue(10);
        (getArtistTopTrack as jest.Mock).mockResolvedValue('test-track-id');
        (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'test-user-id' } });

        const Component = await ArtistProfile(propsWithOpADM);
        render(Component);

        const addArtistDataElements = screen.getAllByTestId('add-artist-data');
        // Check that all AddArtistData components are closed
        addArtistDataElements.forEach(element => {
            expect(element).toHaveAttribute('data-open', 'false');
        });
    });
}); 