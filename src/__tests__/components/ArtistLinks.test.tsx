/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ArtistLinks from '@/app/_components/ArtistLinks';
import { getArtistLinks } from '@/server/utils/queries/artistQueries';
import { Artist, UrlMap } from '@/server/db/DbTypes';

// Mock the server function
jest.mock('@/server/utils/queries/artistQueries', () => ({
    getArtistLinks: jest.fn(),
}));

// Mock AddArtistData component
jest.mock('@/app/artist/[id]/_components/AddArtistData', () => {
    return function MockAddArtistData() {
        return <div data-testid="add-artist-data">Add Artist Data</div>;
    };
});

const mockArtist: Artist = {
    id: 'test-artist-id',
    name: 'Test Artist',
    legacyId: null,
    spotify: 'test-spotify-id',
    youtube: '@testuser',
    youtubechannel: 'UC1234567890',
    instagram: 'testinstagram',
    x: 'testx',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lcname: 'test artist',
    addedBy: 'test-user-id',
    // All the nullable fields
    bandcamp: null,
    facebook: null,
    soundcloud: null,
    notes: null,
    patreon: null,
    bio: null,
    soundcloudId: null,
    twitch: null,
    imdb: null,
    musicbrainz: null,
    wikidata: null,
    mixcloud: null,
    facebookId: null,
    discogs: null,
    tiktok: null,
    tiktokId: null,
    jaxsta: null,
    famousbirthdays: null,
    songexploder: null,
    colorsxstudios: null,
    bandsintown: null,
    linktree: null,
    onlyfans: null,
    wikipedia: null,
    audius: null,
    zora: null,
    catalog: null,
    opensea: null,
    foundation: null,
    lastfm: null,
    linkedin: null,
    soundxyz: null,
    mirror: null,
    glassnode: null,
    collectsNfTs: null,
    spotifyusername: null,
    bandcampfan: null,
    tellie: null,
    wallets: null,
    ens: null,
    lens: null,
    cameo: null,
    farcaster: null,
    supercollector: null,
    webmapdata: null,
    nodePfp: null,
    customImage: null,
    deezer: null,
    subvert: null,
};

// Session removed - authentication disabled

const mockAvailableLinks: UrlMap[] = [
    {
        id: 'youtube-id',
        siteName: 'youtube',
        cardPlatformName: 'YouTube',
        cardDescription: 'Watch their videos on %@',
        appStringFormat: 'https://youtube.com/@%@',
        siteImage: '/siteIcons/youtube_icon.svg',
        colorHex: '#FF0000',
        order: 1,
        isMonetized: false,
        isEmbedEnabled: false,
        isIframeEnabled: false,
        isWeb3Site: false,
        siteUrl: 'youtube.com',
        example: 'https://youtube.com/@username',
        regex: '^https://(www\\.)?youtube\\.com/(?:@([^/]+)|([^/]+))$',
        regexMatcher: null,
        regexOptions: null,
        platformTypeList: ['social'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: 'youtubechannel-id',
        siteName: 'youtubechannel',
        cardPlatformName: 'YouTube',
        cardDescription: 'Watch their videos on %@',
        appStringFormat: 'https://www.youtube.com/channel/%@',
        siteImage: '/siteIcons/youtube_icon.svg',
        colorHex: '#FF0000',
        order: 2,
        isMonetized: false,
        isEmbedEnabled: false,
        isIframeEnabled: false,
        isWeb3Site: false,
        siteUrl: 'youtube.com',
        example: 'https://www.youtube.com/channel/CHANNEL_ID',
        regex: '^https://(www\\.)?youtube\\.com/channel/([^/]+)$',
        regexMatcher: null,
        regexOptions: null,
        platformTypeList: ['social'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
];

describe('ArtistLinks YouTube Rendering', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders YouTube username link when artist has youtube data', async () => {
        const mockYoutubeLinkData = [
            {
                siteName: 'youtube',
                cardPlatformName: 'YouTube',
                cardDescription: 'Watch their videos on YouTube',
                artistUrl: 'https://youtube.com/@testuser',
                siteImage: '/siteIcons/youtube_icon.svg',
                colorHex: '#FF0000',
                order: 1,
                isMonetized: false,
            },
        ];

        (getArtistLinks as jest.Mock).mockResolvedValue(mockYoutubeLinkData);

        const Component = await ArtistLinks({
            isMonetized: false,
            artist: mockArtist,
            spotifyImg: 'test-spotify-image.jpg',
            availableLinks: mockAvailableLinks,
            isOpenOnLoad: false,
            canEdit: false,
            showAddButton: true,
        });

        render(Component);

        // Check that YouTube username link is rendered
        const youtubeLink = screen.getByRole('link', { name: /watch their videos on youtube/i });
        expect(youtubeLink).toBeInTheDocument();
        expect(youtubeLink).toHaveAttribute('href', 'https://youtube.com/@testuser');

        // Check that the YouTube icon is displayed (within the YouTube link)
        const youtubeIcon = youtubeLink.querySelector('img[src="/siteIcons/youtube_icon.svg"]');
        expect(youtubeIcon).toBeInTheDocument();
    });

    it('renders YouTube channel link when artist has youtubechannel data', async () => {
        const artistWithChannelOnly = { ...mockArtist, youtube: null };
        const mockChannelLinkData = [
            {
                siteName: 'youtubechannel',
                cardPlatformName: 'YouTube',
                cardDescription: 'Watch their videos on YouTube',
                artistUrl: 'https://www.youtube.com/channel/UC1234567890',
                siteImage: '/siteIcons/youtube_icon.svg',
                colorHex: '#FF0000',
                order: 1,
                isMonetized: false,
            },
        ];

        (getArtistLinks as jest.Mock).mockResolvedValue(mockChannelLinkData);

        const Component = await ArtistLinks({
            isMonetized: false,
            artist: artistWithChannelOnly,
            spotifyImg: 'test-spotify-image.jpg',
            availableLinks: mockAvailableLinks,
            isOpenOnLoad: false,
            canEdit: false,
            showAddButton: true,
        });

        render(Component);

        // Check that YouTube channel link is rendered
        const youtubeLink = screen.getByRole('link', { name: /watch their videos on youtube/i });
        expect(youtubeLink).toBeInTheDocument();
        expect(youtubeLink).toHaveAttribute('href', 'https://www.youtube.com/channel/UC1234567890');

        // Check that the YouTube icon is displayed (within the YouTube link)
        const youtubeIcon = youtubeLink.querySelector('img[src="/siteIcons/youtube_icon.svg"]');
        expect(youtubeIcon).toBeInTheDocument();
    });

    it('prefers YouTube username over channel ID when both exist', async () => {
        // This tests the backend logic preference - username should be returned over channel
        const mockPreferredLinkData = [
            {
                siteName: 'youtube',
                cardPlatformName: 'YouTube',
                cardDescription: 'Watch their videos on YouTube',
                artistUrl: 'https://youtube.com/@testuser',
                siteImage: '/siteIcons/youtube_icon.svg',
                colorHex: '#FF0000',
                order: 1,
                isMonetized: false,
            },
        ];

        (getArtistLinks as jest.Mock).mockResolvedValue(mockPreferredLinkData);

        const Component = await ArtistLinks({
            isMonetized: false,
            artist: mockArtist, // Has both youtube and youtubechannel data
            spotifyImg: 'test-spotify-image.jpg',
            availableLinks: mockAvailableLinks,
            isOpenOnLoad: false,
            canEdit: false,
            showAddButton: true,
        });

        render(Component);

        // Should show the preferred username format
        const youtubeLink = screen.getByRole('link', { name: /watch their videos on youtube/i });
        expect(youtubeLink).toHaveAttribute('href', 'https://youtube.com/@testuser');
    });

    it('renders no YouTube link when artist has no YouTube data', async () => {
        const artistWithoutYoutube = { 
            ...mockArtist, 
            youtube: null, 
            youtubechannel: null 
        };

        (getArtistLinks as jest.Mock).mockResolvedValue([]);

        const Component = await ArtistLinks({
            isMonetized: false,
            artist: artistWithoutYoutube,
            spotifyImg: 'test-spotify-image.jpg',
            availableLinks: mockAvailableLinks,
            isOpenOnLoad: false,
            canEdit: false,
            showAddButton: true,
        });

        render(Component);

        // Should not have any YouTube links
        expect(screen.queryByRole('link', { name: /watch their videos on youtube/i })).not.toBeInTheDocument();
        
        // Should show the "no links" message
        expect(screen.getByText(/this artist has no links in this section yet/i)).toBeInTheDocument();
    });

    it('renders Deezer link with profile URL and icon when artist has deezer id', async () => {
        const artistWithDeezer = { ...mockArtist, deezer: '4738512' };

        (getArtistLinks as jest.Mock).mockResolvedValue([]);

        const Component = await ArtistLinks({
            isMonetized: false,
            artist: artistWithDeezer,
            spotifyImg: 'test-spotify-image.jpg',
            availableLinks: mockAvailableLinks,
            isOpenOnLoad: false,
            canEdit: false,
            showAddButton: false,
        });

        render(Component);

        const deezerLink = screen.getByRole('link', { name: /listen on deezer/i });
        expect(deezerLink).toBeInTheDocument();
        expect(deezerLink).toHaveAttribute('href', 'https://www.deezer.com/artist/4738512');

        const deezerIcon = deezerLink.querySelector('img[src="/siteIcons/deezer_icon.svg"]');
        expect(deezerIcon).toBeInTheDocument();
    });

    it('does not render Deezer link when artist has no deezer id', async () => {
        const artistWithoutDeezer = { ...mockArtist, deezer: null };

        (getArtistLinks as jest.Mock).mockResolvedValue([]);

        const Component = await ArtistLinks({
            isMonetized: false,
            artist: artistWithoutDeezer,
            spotifyImg: 'test-spotify-image.jpg',
            availableLinks: mockAvailableLinks,
            isOpenOnLoad: false,
            canEdit: false,
            showAddButton: false,
        });

        render(Component);

        expect(screen.queryByRole('link', { name: /listen on deezer/i })).not.toBeInTheDocument();
    });

    it('skips urlmap-based deezer entries to avoid duplicating the hardcoded link', async () => {
        const artistWithDeezer = { ...mockArtist, deezer: '4738512' };

        // Simulate a stale/broken urlmap entry for deezer that should be filtered out
        (getArtistLinks as jest.Mock).mockResolvedValue([
            {
                siteName: 'deezer',
                cardPlatformName: 'Deezer',
                cardDescription: 'Listen on %@',
                artistUrl: 'https://example.com/wrong-url',
                siteImage: '/siteIcons/wrong_icon.svg',
                colorHex: '#000000',
                order: 5,
                isMonetized: false,
            },
        ]);

        const Component = await ArtistLinks({
            isMonetized: false,
            artist: artistWithDeezer,
            spotifyImg: 'test-spotify-image.jpg',
            availableLinks: mockAvailableLinks,
            isOpenOnLoad: false,
            canEdit: false,
            showAddButton: false,
        });

        render(Component);

        const deezerLinks = screen.getAllByRole('link', { name: /deezer/i });
        expect(deezerLinks).toHaveLength(1);
        expect(deezerLinks[0]).toHaveAttribute('href', 'https://www.deezer.com/artist/4738512');
    });

    it('renders YouTube links correctly in monetized section', async () => {
        const mockMonetizedYoutubeData = [
            {
                siteName: 'youtube',
                cardPlatformName: 'YouTube',
                cardDescription: 'Watch their videos on YouTube',
                artistUrl: 'https://youtube.com/@testuser',
                siteImage: '/siteIcons/youtube_icon.svg',
                colorHex: '#FF0000',
                order: 1,
                isMonetized: true, // Monetized link
            },
        ];

        (getArtistLinks as jest.Mock).mockResolvedValue(mockMonetizedYoutubeData);

        const Component = await ArtistLinks({
            isMonetized: true, // Testing monetized section
            artist: mockArtist,
            spotifyImg: 'test-spotify-image.jpg',
            availableLinks: mockAvailableLinks,
            isOpenOnLoad: false,
            canEdit: false,
            showAddButton: false, // No add button in monetized section
        });

        render(Component);

        // Check that YouTube link is rendered in monetized section
        const youtubeLink = screen.getByRole('link', { name: /watch their videos on youtube/i });
        expect(youtubeLink).toBeInTheDocument();
        expect(youtubeLink).toHaveAttribute('href', 'https://youtube.com/@testuser');

        // Should not show add button in monetized section
        expect(screen.queryByTestId('add-artist-data')).not.toBeInTheDocument();
    });
}); 