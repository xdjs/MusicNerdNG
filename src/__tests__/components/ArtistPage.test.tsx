import { render, screen } from '@testing-library/react';
import ArtistProfile, { generateMetadata } from '@/app/artist/[id]/page';
import { getArtistById, getArtistLinks, getAllLinks } from '@/server/utils/queries/artistQueries';
import { getSpotifyImage, getArtistWiki, getSpotifyHeaders, getNumberOfSpotifyReleases, getArtistTopTrack } from '@/server/utils/queries/externalApiQueries';
import { getServerAuthSession } from '@/server/auth';
import { getOpenAIBio } from '@/server/utils/queries/openAIQuery';

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

// Mock OpenAI bio generation
jest.mock('@/server/utils/queries/openAIQuery', () => ({
    getOpenAIBio: jest.fn(),
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

// Mock artist with sufficient vital info for bio generation
const mockArtistWithVitalInfo = {
    ...mockArtist,
    bio: null, // No existing bio, should trigger generation
    instagram: 'test-instagram', // Has vital info
    x: 'test-twitter',
    youtubechannel: 'test-youtube',
    soundcloud: 'test-soundcloud',
};

// Mock artist without vital info (should get "needs data" message)
const mockArtistWithoutVitalInfo = {
    ...mockArtist,
    bio: null,
    instagram: null,
    x: null,
    youtubechannel: null,
    soundcloud: null,
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
        (getOpenAIBio as jest.Mock).mockReset();
    });

    it('returns artist-specific metadata for valid artist with vital info', async () => {
        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistWithVitalInfo) // First call in generateMetadata
            .mockResolvedValueOnce(mockArtistWithVitalInfo); // Second call in getArtistBioForMetadata
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
        (getOpenAIBio as jest.Mock).mockResolvedValue({
            json: () => Promise.resolve({ bio: 'This is a great artist with amazing music.' })
        });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('This is a great artist with amazing music.');
        expect(getArtistById).toHaveBeenCalledWith('test-id');
        expect(getSpotifyHeaders).toHaveBeenCalled();
        expect(getSpotifyImage).toHaveBeenCalledWith('test-spotify-id', undefined, { headers: {} });
        expect(getOpenAIBio).toHaveBeenCalledWith('test-id');
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
        const mockArtistSpecialChars = {
            ...mockArtistWithVitalInfo,
            name: 'Artist & The Band\'s "Greatest" Hits!',
        };

        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistSpecialChars)
            .mockResolvedValueOnce(mockArtistSpecialChars);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
        (getOpenAIBio as jest.Mock).mockResolvedValue({
            json: () => Promise.resolve({ bio: 'Great artist bio.' })
        });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Artist & The Band\'s "Greatest" Hits! - Music Nerd');
        expect(metadata.description).toBe('Great artist bio.');
        expect(getSpotifyImage).toHaveBeenCalledWith('test-spotify-id', undefined, { headers: {} });
    });

    it('handles empty artist name gracefully', async () => {
        const mockArtistEmptyName = {
            ...mockArtistWithVitalInfo,
            name: '',
        };

        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistEmptyName)
            .mockResolvedValueOnce(mockArtistEmptyName);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
        (getOpenAIBio as jest.Mock).mockResolvedValue({
            json: () => Promise.resolve({ bio: 'Artist bio content.' })
        });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe(' - Music Nerd');
        expect(metadata.description).toBe('Artist bio content.');
        expect(getSpotifyImage).toHaveBeenCalledWith('test-spotify-id', undefined, { headers: {} });
    });

    it('handles artist without Spotify ID', async () => {
        const mockArtistNoSpotify = {
            ...mockArtistWithVitalInfo,
            spotify: null,
        };

        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistNoSpotify)
            .mockResolvedValueOnce(mockArtistNoSpotify);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: null });
        (getOpenAIBio as jest.Mock).mockResolvedValue({
            json: () => Promise.resolve({ bio: 'Artist bio content.' })
        });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Artist bio content.');
        expect(getSpotifyHeaders).toHaveBeenCalled();
        expect(getSpotifyImage).toHaveBeenCalledWith('', undefined, { headers: {} });
    });

    it('handles artist with empty Spotify ID', async () => {
        const mockArtistEmptySpotify = {
            ...mockArtistWithVitalInfo,
            spotify: '',
        };

        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistEmptySpotify)
            .mockResolvedValueOnce(mockArtistEmptySpotify);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: null });
        (getOpenAIBio as jest.Mock).mockResolvedValue({
            json: () => Promise.resolve({ bio: 'Artist bio content.' })
        });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Artist bio content.');
        expect(getSpotifyImage).toHaveBeenCalledWith('', undefined, { headers: {} });
    });

    it('uses artist bio for meta description when available (short bio)', async () => {
        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistWithVitalInfo)
            .mockResolvedValueOnce(mockArtistWithVitalInfo);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
        (getOpenAIBio as jest.Mock).mockResolvedValue({
            json: () => Promise.resolve({ bio: 'This is a great artist with amazing music.' })
        });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('This is a great artist with amazing music.');
        expect(getOpenAIBio).toHaveBeenCalledWith('test-id');
    });

    it('truncates long bio for meta description', async () => {
        const longBio = 'This is a very long artist biography that definitely exceeds the 160 character limit for meta descriptions and should be truncated at an appropriate word boundary to maintain readability while staying within SEO best practices for search engine results.';
        
        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistWithVitalInfo)
            .mockResolvedValueOnce(mockArtistWithVitalInfo);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
        (getOpenAIBio as jest.Mock).mockResolvedValue({
            json: () => Promise.resolve({ bio: longBio })
        });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description!.length).toBeLessThanOrEqual(160);
        expect(metadata.description).toMatch(/\.\.\.$/); // Should end with ellipsis
        expect(metadata.description).toContain('This is a very long artist biography');
    });

    it('returns "needs data" message when artist lacks vital info', async () => {
        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistWithoutVitalInfo)
            .mockResolvedValueOnce(mockArtistWithoutVitalInfo);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('MusicNerd needs artist data to generate a summary. Try adding some to get started!');
        // Should not call OpenAI when artist lacks vital info
        expect(getOpenAIBio).not.toHaveBeenCalled();
    });

    it('uses existing bio when available in database', async () => {
        const mockArtistWithExistingBio = {
            ...mockArtistWithVitalInfo,
            bio: 'Existing bio from database.',
        };

        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistWithExistingBio)
            .mockResolvedValueOnce(mockArtistWithExistingBio);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Existing bio from database.');
        // Should not call OpenAI when bio already exists
        expect(getOpenAIBio).not.toHaveBeenCalled();
    });

    it('falls back to generic description when bio generation fails', async () => {
        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistWithVitalInfo)
            .mockResolvedValueOnce(mockArtistWithVitalInfo);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
        (getOpenAIBio as jest.Mock).mockRejectedValue(new Error('Network error'));

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Discover Test Artist on Music Nerd - social media links, music, and more.');
    });

    it('falls back to generic description when bio API returns error', async () => {
        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistWithVitalInfo)
            .mockResolvedValueOnce(mockArtistWithVitalInfo);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
        (getOpenAIBio as jest.Mock).mockResolvedValue({
            json: () => Promise.reject(new Error('JSON parse error'))
        });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Discover Test Artist on Music Nerd - social media links, music, and more.');
    });

    it('falls back to generic description when bio is empty', async () => {
        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistWithVitalInfo)
            .mockResolvedValueOnce(mockArtistWithVitalInfo);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
        (getOpenAIBio as jest.Mock).mockResolvedValue({
            json: () => Promise.resolve({ bio: '' })
        });

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Discover Test Artist on Music Nerd - social media links, music, and more.');
    });

    it('handles bio generation timeout by falling back to generic description', async () => {
        (getArtistById as jest.Mock)
            .mockResolvedValueOnce(mockArtistWithVitalInfo)
            .mockResolvedValueOnce(mockArtistWithVitalInfo);
        (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
        (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
        
        // Mock a slow OpenAI response that exceeds the 3-second timeout
        (getOpenAIBio as jest.Mock).mockImplementation(() => 
            new Promise(resolve => setTimeout(() => resolve({
                json: () => Promise.resolve({ bio: 'This bio took too long' })
            }), 4000))
        );

        const metadata = await generateMetadata({ params: { id: 'test-id' } });

        expect(metadata.title).toBe('Test Artist - Music Nerd');
        expect(metadata.description).toBe('Discover Test Artist on Music Nerd - social media links, music, and more.');
    });

    describe('Open Graph metadata', () => {
        beforeEach(() => {
            // Set up environment variables for testing
            process.env.NEXT_PUBLIC_BASE_URL = 'https://test.musicnerd.org';
        });

        afterEach(() => {
            delete process.env.NEXT_PUBLIC_BASE_URL;
        });

        it('includes Open Graph metadata with Spotify image', async () => {
            (getArtistById as jest.Mock)
                .mockResolvedValueOnce(mockArtistWithVitalInfo)
                .mockResolvedValueOnce(mockArtistWithVitalInfo);
            (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
            (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'https://spotify.com/test-image.jpg' });
            (getOpenAIBio as jest.Mock).mockResolvedValue({
                json: () => Promise.resolve({ bio: 'This is a great artist with amazing music.' })
            });

            const metadata = await generateMetadata({ params: { id: 'test-id' } });

            expect(metadata.openGraph).toEqual({
                title: 'Test Artist - Music Nerd',
                description: 'This is a great artist with amazing music.',
                url: 'https://test.musicnerd.org/artist/test-id',
                type: 'profile',
                images: [
                    {
                        url: 'https://spotify.com/test-image.jpg',
                        width: 300,
                        height: 300,
                        alt: 'Test Artist profile image',
                    },
                ],
            });
        });

        it('falls back to default image when Spotify image is not available', async () => {
            (getArtistById as jest.Mock)
                .mockResolvedValueOnce(mockArtistWithVitalInfo)
                .mockResolvedValueOnce(mockArtistWithVitalInfo);
            (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
            (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: null });
            (getOpenAIBio as jest.Mock).mockResolvedValue({
                json: () => Promise.resolve({ bio: 'Artist bio content.' })
            });

            const metadata = await generateMetadata({ params: { id: 'test-id' } });

            expect(metadata.openGraph?.images?.[0]).toEqual({
                url: 'https://test.musicnerd.org/default_pfp_pink.png',
                width: 300,
                height: 300,
                alt: 'Test Artist profile image',
            });
        });

        it('uses production URL when NEXT_PUBLIC_BASE_URL is not set', async () => {
            delete process.env.NEXT_PUBLIC_BASE_URL;

            (getArtistById as jest.Mock)
                .mockResolvedValueOnce(mockArtistWithVitalInfo)
                .mockResolvedValueOnce(mockArtistWithVitalInfo);
            (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
            (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
            (getOpenAIBio as jest.Mock).mockResolvedValue({
                json: () => Promise.resolve({ bio: 'Artist bio content.' })
            });

            const metadata = await generateMetadata({ params: { id: 'test-id' } });

            expect(metadata.openGraph?.url).toBe('https://musicnerd.org/artist/test-id');
            expect(metadata.openGraph?.images?.[0]?.url).toBe('test-image-url');
        });

        it('handles special characters in artist names for Open Graph alt text', async () => {
            const mockArtistSpecialChars = {
                ...mockArtistWithVitalInfo,
                name: 'Artist & The Band\'s "Greatest" Hits!',
            };

            (getArtistById as jest.Mock)
                .mockResolvedValueOnce(mockArtistSpecialChars)
                .mockResolvedValueOnce(mockArtistSpecialChars);
            (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
            (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
            (getOpenAIBio as jest.Mock).mockResolvedValue({
                json: () => Promise.resolve({ bio: 'Great artist bio.' })
            });

            const metadata = await generateMetadata({ params: { id: 'test-id' } });

            expect(metadata.openGraph?.images?.[0]?.alt).toBe('Artist & The Band\'s "Greatest" Hits! profile image');
        });

        it('includes Open Graph metadata when bio generation fails', async () => {
            (getArtistById as jest.Mock)
                .mockResolvedValueOnce(mockArtistWithVitalInfo)
                .mockResolvedValueOnce(mockArtistWithVitalInfo);
            (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: {} });
            (getSpotifyImage as jest.Mock).mockResolvedValue({ artistImage: 'test-image-url' });
            (getOpenAIBio as jest.Mock).mockRejectedValue(new Error('Network error'));

            const metadata = await generateMetadata({ params: { id: 'test-id' } });

            expect(metadata.openGraph?.title).toBe('Test Artist - Music Nerd');
            expect(metadata.openGraph?.description).toBe('Discover Test Artist on Music Nerd - social media links, music, and more.');
            expect(metadata.openGraph?.type).toBe('profile');
            expect(metadata.openGraph?.url).toBe('https://test.musicnerd.org/artist/test-id');
        });

        it('does not include Open Graph metadata when artist is not found', async () => {
            (getArtistById as jest.Mock).mockResolvedValue(null);

            const metadata = await generateMetadata({ params: { id: 'non-existent-id' } });

            expect(metadata.openGraph).toBeUndefined();
        });
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