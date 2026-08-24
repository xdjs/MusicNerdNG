// @ts-nocheck
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@/server/auth', () => ({
    getServerAuthSession: jest.fn(),
}));

jest.mock('@/server/utils/queries/externalApiQueries', () => ({
    getSpotifyHeaders: jest.fn(),
    getSpotifyArtist: jest.fn(),
    getSpotifyImage: jest.fn(),
    getNumberOfSpotifyReleases: jest.fn(),
}));

jest.mock('@/server/utils/musicPlatform', () => ({
    musicPlatformData: {
        getArtist: jest.fn().mockResolvedValue(null),
        getArtistImage: jest.fn().mockResolvedValue(null),
    },
    deezerProvider: { getArtist: jest.fn() },
    spotifyProvider: { getArtist: jest.fn() },
}));

jest.mock('@/server/utils/queries/artistQueries', () => ({
    getArtistById: jest.fn(),
    getAllLinks: jest.fn(),
}));

jest.mock('@/server/utils/services', () => ({
    getArtistDetailsText: jest.fn(() => ''),
}));

const mockRedirect = jest.fn();
const mockNotFound = jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
jest.mock('next/navigation', () => ({
    redirect: (url: string) => { mockRedirect(url); throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: () => mockNotFound(),
    usePathname: () => '/',
    useRouter: () => ({ push: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/app/add-artist/_components/AddArtistContent', () =>
    function MockAddArtistContent() {
        return <div data-testid="add-artist-content">Add Artist Form</div>;
    }
);

// Mocks for ArtistProfile child components
jest.mock('@/app/_components/ArtistLinksGrid', () => function ArtistLinksGrid() { return <div data-testid="artist-links" />; });
jest.mock('@/app/_components/BookmarkButton', () => function BookmarkButton() { return <div data-testid="bookmark-button" />; });
jest.mock('@/app/_components/EditModeContext', () => ({
    EditModeProvider: function EditModeProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; },
    // A real context, not a stub: KnowledgeSection and VaultSection both call
    // useContext on it, and useContext(undefined) throws on $$typeof. Default is
    // a visitor — not editing — so the owner-only sections render nothing here.
    EditModeContext: require('react').createContext({ canEdit: false, isEditing: false, setIsEditing: () => {} }),
}));
jest.mock('@/app/_components/EditModeToggle', () => function EditModeToggle() { return <button data-testid="edit-toggle">Edit</button>; });
jest.mock('@/app/_components/AutoRefresh', () => function AutoRefresh() { return null; });
jest.mock('@/app/artist/[id]/_components/BlurbSection', () => function BlurbSection() { return <div data-testid="blurb" />; });
jest.mock('@/app/artist/[id]/_components/AddArtistData', () => function AddArtistData() { return <div data-testid="add-data" />; });
jest.mock('@/app/artist/[id]/_components/HeroSection', () => function HeroSection() { return <div data-testid="hero-section" />; });
jest.mock('@/app/artist/[id]/_components/FunFacts', () => function FunFacts() { return null; });
jest.mock('@/app/artist/[id]/_components/GrapevineIframe', () => function GrapevineIframe() { return null; });
jest.mock('@/app/artist/[id]/_components/SeoArtistLinks', () => function SeoArtistLinks() { return null; });
jest.mock('@/app/artist/[id]/_components/ClaimButton', () => function ClaimButton() { return null; });
jest.mock('@/app/artist/[id]/_components/VaultSection', () => function VaultSection() { return <div data-testid="vault-section" />; });
jest.mock('@/app/artist/[id]/_components/AskAboutArtist', () => function AskAboutArtist() { return null; });
jest.mock('@/server/utils/queries/userQueries', () => ({
    getUserById: jest.fn().mockResolvedValue({ id: 'user-uuid', isAdmin: false, isWhiteListed: false }),
    getAllUsers: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
    getClaimByArtistId: jest.fn().mockResolvedValue(null),
    getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/server/utils/dev-auth', () => ({
    getDevSession: jest.fn().mockResolvedValue(null),
}));

import AddArtistPage from '@/app/add-artist/page';
import ArtistProfile from '@/app/artist/[id]/page';
import { getServerAuthSession } from '@/server/auth';
import { getArtistById, getAllLinks } from '@/server/utils/queries/artistQueries';
import { spotifyProvider, musicPlatformData } from '@/server/utils/musicPlatform';

const mockSession = {
    user: { id: 'user-uuid', email: 'test@test.com', isAdmin: false, isWhiteListed: true },
    expires: '2026-12-31',
};

const mockArtist = {
    id: 'artist-uuid',
    name: 'Test Artist',
    spotify: 'spotify123',
    bio: null,
    bandcamp: null,
};

describe('Protected routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('/add-artist (requires authentication)', () => {
        beforeEach(() => {
            (spotifyProvider.getArtist as jest.Mock).mockResolvedValue({
                platform: 'spotify', platformId: 'some-id', name: 'New Artist',
                imageUrl: null, followerCount: 0, albumCount: 0, genres: [],
                profileUrl: '', topTrackName: null,
            });
        });

        it('redirects unauthenticated users to "/"', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            await expect(
                AddArtistPage({ searchParams: Promise.resolve({ spotify: 'some-id' }) })
            ).rejects.toThrow('NEXT_REDIRECT:/');
            expect(mockRedirect).toHaveBeenCalledWith('/');
        });

        it('renders the form for authenticated users', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            const jsx = await AddArtistPage({ searchParams: Promise.resolve({ spotify: 'some-id' }) });
            render(jsx as React.ReactElement);
            expect(screen.getByTestId('add-artist-content')).toBeInTheDocument();
        });

        it('does not redirect authenticated users', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            await AddArtistPage({ searchParams: Promise.resolve({ spotify: 'some-id' }) });
            expect(mockRedirect).not.toHaveBeenCalled();
        });

        it('shows an error page (not a redirect) when no platform param is present, even if authenticated', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            const jsx = await AddArtistPage({ searchParams: Promise.resolve({}) });
            render(jsx as React.ReactElement);
            expect(screen.getByText('No artist ID provided')).toBeInTheDocument();
            expect(mockRedirect).not.toHaveBeenCalled();
        });
    });

    describe('/artist/[id] (publicly accessible)', () => {
        beforeEach(() => {
            (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
            (musicPlatformData.getArtist as jest.Mock).mockResolvedValue({
                platform: 'spotify', platformId: 'spotify123', name: 'Test Artist',
                imageUrl: null, followerCount: 0, albumCount: 3, genres: [],
                profileUrl: '', topTrackName: null,
            });
            (musicPlatformData.getArtistImage as jest.Mock).mockResolvedValue(null);
            (getAllLinks as jest.Mock).mockResolvedValue([]);
        });

        it('is accessible without authentication', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            const jsx = await ArtistProfile({ params: Promise.resolve({ id: 'artist-uuid' }) });
            render(jsx as React.ReactElement);
            expect(screen.getByText('Test Artist')).toBeInTheDocument();
            expect(mockRedirect).not.toHaveBeenCalled();
        });

        it('shows edit controls only when admin', async () => {
            const { getUserById } = await import('@/server/utils/queries/userQueries');
            (getUserById as jest.Mock).mockResolvedValue({ id: 'user-uuid', isAdmin: true, isWhiteListed: true });
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            const jsx = await ArtistProfile({ params: Promise.resolve({ id: 'artist-uuid' }) });
            render(jsx as React.ReactElement);
            expect(screen.getByTestId('edit-toggle')).toBeInTheDocument();
        });

        it('hides edit controls for unauthenticated visitors', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            const jsx = await ArtistProfile({ params: Promise.resolve({ id: 'artist-uuid' }) });
            render(jsx as React.ReactElement);
            expect(screen.queryByTestId('edit-toggle')).not.toBeInTheDocument();
        });

        it('returns 404 for nonexistent artist (unauthenticated)', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            (getArtistById as jest.Mock).mockResolvedValue(null);
            await expect(
                ArtistProfile({ params: Promise.resolve({ id: 'nonexistent' }) })
            ).rejects.toThrow('NEXT_NOT_FOUND');
        });

        it('returns 404 for nonexistent artist (authenticated)', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            (getArtistById as jest.Mock).mockResolvedValue(null);
            await expect(
                ArtistProfile({ params: Promise.resolve({ id: 'nonexistent' }) })
            ).rejects.toThrow('NEXT_NOT_FOUND');
        });
    });
});
