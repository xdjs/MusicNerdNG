// @ts-nocheck
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@/server/auth', () => ({
    getServerAuthSession: jest.fn(),
}));

jest.mock('@/server/utils/musicPlatform', () => ({
    deezerProvider: { getArtist: jest.fn() },
    spotifyProvider: { getArtist: jest.fn() },
}));

const mockRedirect = jest.fn();
jest.mock('next/navigation', () => ({
    redirect: (url: string) => { mockRedirect(url); throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
    usePathname: () => '/add-artist',
    useRouter: () => ({ push: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/app/add-artist/_components/AddArtistContent', () =>
    function MockAddArtistContent({ initialArtist }: { initialArtist: any }) {
        return <div data-testid="add-artist-content">{initialArtist.name}</div>;
    }
);

import AddArtistPage from '@/app/add-artist/page';
import { getServerAuthSession } from '@/server/auth';
import { deezerProvider, spotifyProvider } from '@/server/utils/musicPlatform';

const mockSession = {
    user: { id: 'user-uuid', email: 'test@test.com' },
    expires: '2026-12-31',
};

const mockPlatformArtist = {
    platform: 'spotify',
    platformId: 'ts-id',
    name: 'Taylor Swift',
    imageUrl: 'https://example.com/ts.jpg',
    followerCount: 1000000,
    albumCount: 10,
    genres: ['pop'],
    profileUrl: 'https://open.spotify.com/artist/ts-id',
    topTrackName: 'Anti-Hero',
};

describe('AddArtistPage URL parameter handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
        (spotifyProvider.getArtist as jest.Mock).mockResolvedValue(mockPlatformArtist);
        (deezerProvider.getArtist as jest.Mock).mockResolvedValue({
            ...mockPlatformArtist,
            platform: 'deezer',
            platformId: '12345',
            profileUrl: 'https://www.deezer.com/artist/12345',
        });
    });

    it('renders AddArtistContent when spotify param is present', async () => {
        const jsx = await AddArtistPage({ searchParams: Promise.resolve({ spotify: 'ts-id' }) });
        render(jsx as React.ReactElement);
        expect(screen.getByTestId('add-artist-content')).toBeInTheDocument();
        expect(screen.getByText('Taylor Swift')).toBeInTheDocument();
    });

    it('calls spotifyProvider.getArtist with the correct ID', async () => {
        await AddArtistPage({ searchParams: Promise.resolve({ spotify: 'ts-id' }) });
        expect(spotifyProvider.getArtist).toHaveBeenCalledWith('ts-id');
    });

    it('renders AddArtistContent when deezer param is present', async () => {
        const jsx = await AddArtistPage({ searchParams: Promise.resolve({ deezer: '12345' }) });
        render(jsx as React.ReactElement);
        expect(screen.getByTestId('add-artist-content')).toBeInTheDocument();
    });

    it('calls deezerProvider.getArtist with the correct ID', async () => {
        await AddArtistPage({ searchParams: Promise.resolve({ deezer: '12345' }) });
        expect(deezerProvider.getArtist).toHaveBeenCalledWith('12345');
    });

    it('shows "No artist ID provided" when no platform param is present', async () => {
        const jsx = await AddArtistPage({ searchParams: Promise.resolve({}) });
        render(jsx as React.ReactElement);
        expect(screen.getByText('No artist ID provided')).toBeInTheDocument();
    });

    it('shows error when provider returns null', async () => {
        (spotifyProvider.getArtist as jest.Mock).mockResolvedValue(null);
        const jsx = await AddArtistPage({ searchParams: Promise.resolve({ spotify: 'bad-id' }) });
        render(jsx as React.ReactElement);
        expect(screen.getByText('Could not find artist on spotify')).toBeInTheDocument();
    });

    it('does not call providers when no params present', async () => {
        await AddArtistPage({ searchParams: Promise.resolve({}) });
        expect(spotifyProvider.getArtist).not.toHaveBeenCalled();
        expect(deezerProvider.getArtist).not.toHaveBeenCalled();
    });
});
