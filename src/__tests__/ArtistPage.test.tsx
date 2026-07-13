// @ts-nocheck
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@/server/auth', () => ({
    getServerAuthSession: jest.fn(),
}));

jest.mock('@/server/utils/queries/artistQueries', () => ({
    getArtistById: jest.fn(),
    getAllLinks: jest.fn(),
}));

jest.mock('@/server/utils/musicPlatform', () => ({
    musicPlatformData: {
        getArtist: jest.fn(),
        getArtistImage: jest.fn(),
    },
}));

jest.mock('@/server/utils/services', () => ({
    getArtistDetailsText: jest.fn(() => '1,000 monthly listeners'),
}));

const mockNotFound = jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
jest.mock('next/navigation', () => ({
    notFound: () => mockNotFound(),
    redirect: jest.fn(),
    usePathname: () => '/artist/123',
    useRouter: () => ({ push: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/app/_components/ArtistLinksGrid', () => function ArtistLinksGrid() { return <div data-testid="artist-links" />; });
jest.mock('@/app/_components/BookmarkButton', () => function BookmarkButton() { return <div data-testid="bookmark-button" />; });
jest.mock('@/app/_components/EditModeContext', () => ({
    EditModeProvider: function EditModeProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; },
}));
jest.mock('@/app/_components/EditModeToggle', () => function EditModeToggle() { return <button data-testid="edit-mode-toggle">Edit</button>; });
jest.mock('@/app/_components/AutoRefresh', () => function AutoRefresh() { return null; });
jest.mock('@/app/artist/[id]/_components/BlurbSection', () => function BlurbSection() { return <div data-testid="blurb-section" />; });
jest.mock('@/app/artist/[id]/_components/AddArtistData', () => function AddArtistData({ directEdit = false }: { directEdit?: boolean }) {
    return <div data-testid="add-artist-data" data-direct-edit={String(directEdit)} />;
});
jest.mock('@/app/artist/[id]/_components/HeroSection', () => function HeroSection({ artistName }: { artistName: string }) { return <div data-testid="hero-section"><img alt={artistName} src="test.jpg" /></div>; });
jest.mock('@/app/artist/[id]/_components/FunFacts', () => function FunFacts() { return <div data-testid="fun-facts" />; });
jest.mock('@/app/artist/[id]/_components/GrapevineIframe', () => function GrapevineIframe() { return <div data-testid="grapevine-iframe" />; });
jest.mock('@/app/artist/[id]/_components/SeoArtistLinks', () => function SeoArtistLinks() { return null; });
jest.mock('@/app/artist/[id]/_components/ClaimButton', () => function ClaimButton() { return <div data-testid="claim-button" />; });
jest.mock('@/app/artist/[id]/_components/AskAboutArtist', () => function AskAboutArtist() { return <div data-testid="ask-about-artist" />; });
jest.mock('@/app/artist/[id]/_components/VaultSection', () => function VaultSection() { return <div data-testid="vault-section" />; });
jest.mock('@/server/utils/queries/userQueries', () => ({
    getUserById: jest.fn().mockResolvedValue({ id: 'user-uuid', isAdmin: false, isWhiteListed: false }),
}));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
    getClaimByArtistId: jest.fn().mockResolvedValue(null),
    getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/server/utils/dev-auth', () => ({
    getDevSession: jest.fn().mockResolvedValue(null),
}));

import ArtistProfile, { generateMetadata } from '@/app/artist/[id]/page';
import { getServerAuthSession } from '@/server/auth';
import { getArtistById, getAllLinks } from '@/server/utils/queries/artistQueries';
import { musicPlatformData } from '@/server/utils/musicPlatform';

const mockArtist = {
    id: 'artist-uuid',
    name: 'Test Artist',
    spotify: 'spotify123',
    bio: 'A great artist.',
    bandcamp: null,
    instagram: null,
    twitter: null,
};

const mockPlatformArtist = {
    platform: 'deezer',
    platformId: '12345',
    name: 'Test Artist',
    imageUrl: 'https://cdn.deezer.com/artist.jpg',
    followerCount: 10000,
    albumCount: 5,
    genres: [],
    profileUrl: 'https://www.deezer.com/artist/12345',
    topTrackName: 'Hit Song',
};

function setupMocks({ session = null, artist = mockArtist } = {}) {
    (getServerAuthSession as jest.Mock).mockResolvedValue(session);
    (getArtistById as jest.Mock).mockResolvedValue(artist);
    (musicPlatformData.getArtist as jest.Mock).mockResolvedValue(mockPlatformArtist);
    (musicPlatformData.getArtistImage as jest.Mock).mockResolvedValue('https://cdn.deezer.com/artist.jpg');
    (getAllLinks as jest.Mock).mockResolvedValue([]);
}

async function renderArtistPage(id = 'artist-uuid') {
    const jsx = await ArtistProfile({ params: Promise.resolve({ id }) });
    return render(jsx as React.ReactElement);
}

describe('ArtistProfile page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupMocks();
    });

    describe('Unauthenticated rendering', () => {
        it('renders artist name', async () => {
            await renderArtistPage();
            expect(screen.getByText('Test Artist')).toBeInTheDocument();
        });

        it('renders hero section', async () => {
            await renderArtistPage();
            expect(screen.getByTestId('hero-section')).toBeInTheDocument();
        });

        it('renders artist links section', async () => {
            await renderArtistPage();
            expect(screen.getAllByTestId('artist-links').length).toBeGreaterThan(0);
        });

        it('renders the blurb section', async () => {
            await renderArtistPage();
            expect(screen.getByTestId('blurb-section')).toBeInTheDocument();
        });

        it('renders ask about artist section', async () => {
            await renderArtistPage();
            expect(screen.getByTestId('ask-about-artist')).toBeInTheDocument();
        });

        it('does not render bookmark button when not authenticated', async () => {
            await renderArtistPage();
            expect(screen.queryByTestId('bookmark-button')).not.toBeInTheDocument();
        });

        it('does not render edit mode toggle when not authenticated', async () => {
            await renderArtistPage();
            expect(screen.queryByTestId('edit-mode-toggle')).not.toBeInTheDocument();
        });
    });

    describe('Authenticated rendering', () => {
        const mockSession = {
            user: { id: 'user-uuid', email: 'test@test.com', isAdmin: false, isWhiteListed: true },
            expires: '2026-12-31',
        };

        beforeEach(() => {
            setupMocks({ session: mockSession });
        });

        it('renders bookmark button when authenticated', async () => {
            await renderArtistPage();
            expect(screen.getByTestId('bookmark-button')).toBeInTheDocument();
        });

        it('renders edit mode toggle when admin', async () => {
            const { getUserById } = await import('@/server/utils/queries/userQueries');
            (getUserById as jest.Mock).mockResolvedValue({ id: 'user-uuid', isAdmin: true, isWhiteListed: true });
            await renderArtistPage();
            expect(screen.getByTestId('edit-mode-toggle')).toBeInTheDocument();
        });

        it('routes admin link additions through the auto-approved UGC flow', async () => {
            const { getUserById } = await import('@/server/utils/queries/userQueries');
            const { getClaimByArtistId } = await import('@/server/utils/queries/dashboardQueries');
            (getUserById as jest.Mock).mockResolvedValue({ id: 'user-uuid', isAdmin: true, isWhiteListed: true });
            (getClaimByArtistId as jest.Mock).mockResolvedValue(null);

            await renderArtistPage();

            expect(screen.getAllByTestId('add-artist-data')).toHaveLength(2);
            screen.getAllByTestId('add-artist-data').forEach((component) => {
                expect(component).toHaveAttribute('data-direct-edit', 'false');
            });
        });

        it('preserves direct link editing for an approved claimed artist', async () => {
            const { getUserById } = await import('@/server/utils/queries/userQueries');
            const { getClaimByArtistId } = await import('@/server/utils/queries/dashboardQueries');
            (getUserById as jest.Mock).mockResolvedValue({ id: 'user-uuid', isAdmin: false, isWhiteListed: false });
            (getClaimByArtistId as jest.Mock).mockResolvedValue({
                id: 'claim-uuid',
                artistId: 'artist-uuid',
                userId: 'user-uuid',
                status: 'approved',
            });

            await renderArtistPage();

            expect(screen.getAllByTestId('add-artist-data')).toHaveLength(2);
            screen.getAllByTestId('add-artist-data').forEach((component) => {
                expect(component).toHaveAttribute('data-direct-edit', 'true');
            });
        });

        it('renders the VaultSection on the profile', async () => {
            const { getUserById } = await import('@/server/utils/queries/userQueries');
            const { getVaultSourcesByArtistId } = await import('@/server/utils/queries/dashboardQueries');
            (getUserById as jest.Mock).mockResolvedValue({ id: 'user-uuid', isAdmin: true, isWhiteListed: true });
            (getVaultSourcesByArtistId as jest.Mock).mockResolvedValue([]);
            await renderArtistPage();
            expect(screen.getByTestId('vault-section')).toBeInTheDocument();
        });
    });

    describe('Missing artist', () => {
        it('calls notFound() when artist does not exist', async () => {
            (getArtistById as jest.Mock).mockResolvedValue(null);
            await expect(renderArtistPage('nonexistent-id')).rejects.toThrow('NEXT_NOT_FOUND');
            expect(mockNotFound).toHaveBeenCalled();
        });
    });

    describe('generateMetadata', () => {
        it('returns correct title and description for an existing artist', async () => {
            const metadata = await generateMetadata({ params: Promise.resolve({ id: 'artist-uuid' }) });
            expect(metadata.title).toBe('Test Artist | Music Nerd');
            expect(metadata.description).toContain('Test Artist');
        });

        it('returns not-found metadata when artist does not exist', async () => {
            (getArtistById as jest.Mock).mockResolvedValue(null);

            const metadata = await generateMetadata({ params: Promise.resolve({ id: 'nonexistent' }) });
            expect(metadata.title).toBe('Artist Not Found | Music Nerd');
        });

        it('includes OpenGraph image from platform provider', async () => {
            const metadata = await generateMetadata({ params: Promise.resolve({ id: 'artist-uuid' }) });
            expect(metadata.openGraph?.images?.[0]).toMatchObject({
                url: 'https://cdn.deezer.com/artist.jpg',
            });
        });
    });
});
