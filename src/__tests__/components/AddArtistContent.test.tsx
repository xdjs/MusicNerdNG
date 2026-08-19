// @ts-nocheck
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockAddArtist = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('next-auth/react', () => ({
    useSession: () => ({
        data: { user: { id: 'user-id' } },
        status: 'authenticated',
    }),
}));

jest.mock('@/app/actions/addArtist', () => ({
    addArtist: (...args: unknown[]) => mockAddArtist(...args),
}));

import AddArtistContent from '@/app/add-artist/_components/AddArtistContent';

const initialArtist = {
    platform: 'spotify',
    platformId: 'spotify-id',
    name: 'Same Name',
    imageUrl: 'https://example.com/artist.jpg',
    followerCount: 123,
    albumCount: 2,
    genres: ['indie'],
    profileUrl: 'https://open.spotify.com/artist/spotify-id',
    topTrackName: 'A Song',
};

const possibleDuplicate = {
    status: 'possible_duplicate',
    message: 'We found a possible match.',
    platform: 'spotify',
    platformId: 'spotify-id',
    candidates: [{
        id: 'candidate-id',
        name: 'Same Name',
        spotify: null,
        deezer: 'deezer-id',
    }],
};

describe('AddArtistContent duplicate choice', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    async function submitWithDuplicate() {
        mockAddArtist.mockResolvedValueOnce(possibleDuplicate);
        render(<AddArtistContent initialArtist={initialArtist} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add Artist' }));
        return screen.findByRole('link', { name: /Add link to existing artist: Same Name/ });
    }

    it('links the submitted profile to a selected existing artist', async () => {
        const link = await submitWithDuplicate();

        expect(mockAddArtist).toHaveBeenCalledWith('spotify-id', 'spotify');
        expect(link).toHaveAttribute(
            'href',
            `/artist/candidate-id?addLink=${encodeURIComponent(initialArtist.profileUrl)}`,
        );
        expect(screen.getByRole('button', { name: 'Create separate artist' })).toBeInTheDocument();
    });

    it('force-creates only after the user confirms this is a separate artist', async () => {
        await submitWithDuplicate();
        mockAddArtist.mockResolvedValueOnce({
            status: 'success',
            artistId: 'new-id',
            artistName: 'Same Name',
        });

        fireEvent.click(screen.getByRole('button', { name: 'Create separate artist' }));

        await waitFor(() => {
            expect(mockAddArtist).toHaveBeenNthCalledWith(
                2,
                'spotify-id',
                'spotify',
                { forceCreate: true },
            );
            expect(mockPush).toHaveBeenCalledWith('/artist/new-id');
        });
    });

    it('blocks candidate navigation and cancellation while force creation is pending', async () => {
        const candidateLink = await submitWithDuplicate();
        let resolveCreate!: (value: unknown) => void;
        mockAddArtist.mockReturnValueOnce(new Promise(resolve => { resolveCreate = resolve; }));

        fireEvent.click(screen.getByRole('button', { name: 'Create separate artist' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Creating separate artist');
        expect(candidateLink).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(mockBack).not.toHaveBeenCalled();

        await act(async () => {
            resolveCreate({ status: 'success', artistId: 'new-id', artistName: 'Same Name' });
        });

        expect(mockPush).toHaveBeenCalledWith('/artist/new-id');
    });

    it('opens login when the action reports that an authenticated-looking session expired', async () => {
        const loginButton = document.createElement('button');
        loginButton.id = 'login-btn';
        const loginClick = jest.fn();
        loginButton.addEventListener('click', loginClick);
        document.body.appendChild(loginButton);
        mockAddArtist.mockResolvedValue({
            status: 'error',
            message: 'Please log in to add artists',
        });

        try {
            render(<AddArtistContent initialArtist={initialArtist} />);
            fireEvent.click(screen.getByRole('button', { name: 'Add Artist' }));

            await waitFor(() => expect(loginClick).toHaveBeenCalledTimes(1));
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(mockPush).not.toHaveBeenCalled();
        } finally {
            loginButton.remove();
        }
    });

    it('renders a conflict as an error without a bypass action', async () => {
        mockAddArtist.mockResolvedValue({
            status: 'conflict',
            message: 'This Spotify profile already belongs to another artist.',
        });
        render(<AddArtistContent initialArtist={initialArtist} />);

        fireEvent.click(screen.getByRole('button', { name: 'Add Artist' }));

        expect(await screen.findByText('This Spotify profile already belongs to another artist.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create separate artist' })).not.toBeInTheDocument();
        expect(mockPush).not.toHaveBeenCalled();
    });
});
