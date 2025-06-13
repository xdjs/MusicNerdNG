import { render, screen } from '@testing-library/react';
import ArtistProfile from '@/app/artist/[id]/page';
import { getArtistById, getArtistLinks } from '@/server/utils/queriesTS';
import { getSpotifyImage, getArtistWiki, getSpotifyHeaders, getNumberOfSpotifyReleases, getArtistTopTrack } from '@/server/utils/externalApiQueries';
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
jest.mock('@/server/utils/queriesTS', () => ({
    getArtistById: jest.fn(),
    getArtistLinks: jest.fn(),
}));

// Mock external API queries
jest.mock('@/server/utils/externalApiQueries', () => ({
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
    return function MockArtistLinks({ isMonetized }: { isMonetized: boolean }) {
        return <div data-testid={`artist-links-${isMonetized ? 'monetized' : 'social'}`}>Artist Links</div>;
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

describe('ArtistPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getArtistById as jest.Mock).mockReset();
        (getArtistLinks as jest.Mock).mockReset();
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
        expect(screen.getByText('Test wiki blurb')).toBeInTheDocument();
        expect(screen.getByText('WIKIPEDIA')).toBeInTheDocument();
        expect(screen.getByTestId('spotify-embed')).toBeInTheDocument();
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
        expect(screen.queryByTestId('spotify-embed')).not.toBeInTheDocument();
        const img = screen.getByAltText('Artist Image');
        expect(img).toHaveAttribute('src', '/default_pfp_pink.png');
    });

    it('opens AddArtistData when opADM is set to "1"', async () => {
        const propsWithOpADM = {
            ...defaultProps,
            searchParams: { opADM: '1' }
        };

        (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
        (getArtistLinks as jest.Mock).mockResolvedValue(mockLinks);
        (getSpotifyImage as jest.Mock).mockResolvedValue(mockSpotifyImage);
        (getArtistWiki as jest.Mock).mockResolvedValue(mockWiki);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getNumberOfSpotifyReleases as jest.Mock).mockResolvedValue(10);
        (getArtistTopTrack as jest.Mock).mockResolvedValue('test-track-id');
        (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'test-user-id' } });

        const Component = await ArtistProfile(propsWithOpADM);
        render(Component);

        const addArtistData = screen.getByTestId('add-artist-data');
        expect(addArtistData).toHaveAttribute('data-open', 'true');
    });
}); 