/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';

// --- Mocks (must be declared before imports) ---

const mockPush = jest.fn();
const mockToast = jest.fn();
const mockLogin = jest.fn();
const mockAddArtist = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
    useSearchParams: () => ({ get: () => null }),
}));

jest.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: mockToast }),
}));

jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({ data: null })),
}));

jest.mock('@privy-io/react-auth', () => ({
    useLogin: () => ({ login: mockLogin }),
}));

jest.mock('@/app/actions/addArtist', () => ({
    addArtist: (...args: unknown[]) => mockAddArtist(...args),
}));

jest.mock('use-debounce', () => ({
    useDebounce: (val: string) => [val],
}));

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useSession } from 'next-auth/react';

import SearchBar from '@/app/_components/nav/components/SearchBar';

function mockSearchResults(results: object[]) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results }),
    });
}

const externalResult = {
    name: 'New Artist',
    platformId: 'dz123',
    platform: 'deezer',
    isExternalOnly: true,
    imageUrl: 'https://cdn-images.dzcdn.net/test.jpg',
    profileUrl: 'https://www.deezer.com/artist/dz123',
};

const externalResult2 = {
    name: 'Other Artist',
    platformId: 'dz456',
    platform: 'deezer',
    isExternalOnly: true,
    imageUrl: 'https://cdn-images.dzcdn.net/test2.jpg',
    profileUrl: 'https://www.deezer.com/artist/dz456',
};

const dbResult = {
    id: '42',
    name: 'Existing Artist',
    spotify: '6xyz789',
    isExternalOnly: false,
    imageUrl: 'https://cdn-images.dzcdn.net/existing.jpg',
    bandcamp: 'existingartist',
};

describe('SearchBar Add Artist Flow', () => {
    let mockSessionStorage: Record<string, string>;

    beforeEach(() => {
        jest.clearAllMocks();
        (useSession as jest.Mock).mockReturnValue({ data: null });
        // Mock sessionStorage
        mockSessionStorage = {};
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => mockSessionStorage[key] ?? null);
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => { mockSessionStorage[key] = value; });
        jest.spyOn(Storage.prototype, 'removeItem').mockImplementation((key) => { delete mockSessionStorage[key]; });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    async function renderAndSearch(results: object[]) {
        mockSearchResults(results);
        render(<SearchBar />);
        const input = screen.getByPlaceholderText('Search for an artist...');
        fireEvent.change(input, { target: { value: 'test' } });
        fireEvent.focus(input);
        const firstName = (results[0] as { name: string }).name;
        await waitFor(() => {
            expect(screen.getByText(firstName)).toBeInTheDocument();
        });
    }

    it('shows "Add to MusicNerd | View on Deezer" for external results', async () => {
        await renderAndSearch([externalResult]);

        expect(screen.getByText('Add to MusicNerd')).toBeInTheDocument();
        expect(screen.getByText('View on Deezer')).toBeInTheDocument();
        expect(screen.getByText('|')).toBeInTheDocument();
    });

    it('renders "View on Deezer" as an <a> tag with correct href', async () => {
        await renderAndSearch([externalResult]);

        const link = screen.getByText('View on Deezer').closest('a');
        expect(link).toHaveAttribute('href', 'https://www.deezer.com/artist/dz123');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('triggers login and stores pending ID + platform + timestamp when unauthenticated user clicks external result', async () => {
        const loginBtn = document.createElement('button');
        loginBtn.id = 'login-btn';
        const loginClickSpy = jest.fn();
        loginBtn.addEventListener('click', loginClickSpy);
        document.body.appendChild(loginBtn);

        await renderAndSearch([externalResult]);

        fireEvent.click(screen.getByText('New Artist'));

        expect(loginClickSpy).toHaveBeenCalled();
        expect(mockAddArtist).not.toHaveBeenCalled();
        expect(mockSessionStorage['pendingAddArtistPlatformId']).toBe('dz123');
        expect(mockSessionStorage['pendingAddArtistPlatform']).toBe('deezer');
        expect(mockSessionStorage['pendingAddArtistTimestamp']).toBeDefined();

        document.body.removeChild(loginBtn);
    });

    it('completes pending add on mount when session exists and pending ID is fresh', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        mockSessionStorage['pendingAddArtistPlatformId'] = 'dz123';
        mockSessionStorage['pendingAddArtistPlatform'] = 'deezer';
        mockSessionStorage['pendingAddArtistTimestamp'] = String(Date.now());
        mockAddArtist.mockResolvedValue({ status: 'success', artistId: '99', artistName: 'New Artist' });

        mockSearchResults([]);
        await act(async () => {
            render(<SearchBar />);
        });

        await waitFor(() => {
            expect(mockAddArtist).toHaveBeenCalledWith('dz123', 'deezer');
            expect(mockPush).toHaveBeenCalledWith('/artist/99');
        });
        expect(mockSessionStorage['pendingAddArtistPlatformId']).toBeUndefined();
        expect(mockSessionStorage['pendingAddArtistPlatform']).toBeUndefined();
        expect(mockSessionStorage['pendingAddArtistTimestamp']).toBeUndefined();
    });

    it('discards stale pending add (older than 5 minutes)', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        mockSessionStorage['pendingAddArtistPlatformId'] = 'dz123';
        mockSessionStorage['pendingAddArtistPlatform'] = 'deezer';
        mockSessionStorage['pendingAddArtistTimestamp'] = String(Date.now() - 6 * 60 * 1000);

        mockSearchResults([]);
        await act(async () => {
            render(<SearchBar />);
        });

        await act(async () => {});

        expect(mockAddArtist).not.toHaveBeenCalled();
        expect(mockSessionStorage['pendingAddArtistPlatformId']).toBeUndefined();
    });

    it('does not trigger pending add when there is no session', async () => {
        mockSessionStorage['pendingAddArtistPlatformId'] = 'dz123';
        mockSessionStorage['pendingAddArtistPlatform'] = 'deezer';
        mockSessionStorage['pendingAddArtistTimestamp'] = String(Date.now());

        mockSearchResults([]);
        render(<SearchBar />);

        await act(async () => {});

        expect(mockAddArtist).not.toHaveBeenCalled();
        expect(mockSessionStorage['pendingAddArtistPlatformId']).toBe('dz123');
    });

    it('calls addArtist with platform args and navigates on success when authenticated', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        mockAddArtist.mockResolvedValue({ status: 'success', artistId: '99', artistName: 'New Artist' });

        await renderAndSearch([externalResult]);
        fireEvent.click(screen.getByText('New Artist'));

        await waitFor(() => {
            expect(mockAddArtist).toHaveBeenCalledWith('dz123', 'deezer');
            expect(mockPush).toHaveBeenCalledWith('/artist/99');
        });
    });

    it('handles "exists" status by navigating to existing artist', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        mockAddArtist.mockResolvedValue({ status: 'exists', artistId: '42', artistName: 'New Artist' });

        await renderAndSearch([externalResult]);
        fireEvent.click(screen.getByText('New Artist'));

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/artist/42');
        });
    });

    it('uses the action identity to build a canonical existing-artist handoff URL', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        const trackedExternalResult = {
            ...externalResult,
            platformId: '123',
            profileUrl: 'https://deezer.com/en/artist/123?utm_source=search#tracks',
        };
        mockAddArtist.mockResolvedValue({
            status: 'possible_duplicate',
            platform: 'deezer',
            platformId: '123',
            candidates: [{
                id: 'existing-id',
                name: 'New Artist',
                spotify: 'spotify-id',
                deezer: null,
            }],
        });

        await renderAndSearch([trackedExternalResult]);
        fireEvent.click(screen.getByText('New Artist'));

        const link = await screen.findByRole('link', { name: /Add link to existing artist: New Artist/ });
        expect(link).toHaveAttribute(
            'href',
            `/artist/existing-id?addLink=${encodeURIComponent('https://www.deezer.com/artist/123')}`,
        );
        expect(screen.getByRole('button', { name: 'Create separate artist' })).toBeInTheDocument();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('force-creates a separate artist after duplicate confirmation', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        mockAddArtist
            .mockResolvedValueOnce({
                status: 'possible_duplicate',
                platform: 'deezer',
                platformId: 'dz123',
                candidates: [{
                    id: 'existing-id',
                    name: 'New Artist',
                    spotify: 'spotify-id',
                    deezer: null,
                }],
            })
            .mockResolvedValueOnce({
                status: 'success',
                artistId: 'separate-id',
                artistName: 'New Artist',
            });

        await renderAndSearch([externalResult]);
        fireEvent.click(screen.getByText('New Artist'));
        fireEvent.click(await screen.findByRole('button', { name: 'Create separate artist' }));

        await waitFor(() => {
            expect(mockAddArtist).toHaveBeenNthCalledWith(
                2,
                'dz123',
                'deezer',
                { forceCreate: true },
            );
            expect(mockPush).toHaveBeenCalledWith('/artist/separate-id');
        });
    });

    it('blocks candidate navigation and search edits while force creation is pending', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        let resolveCreate!: (value: unknown) => void;
        mockAddArtist
            .mockResolvedValueOnce({
                status: 'possible_duplicate',
                platform: 'deezer',
                platformId: '123',
                candidates: [{
                    id: 'existing-id',
                    name: 'New Artist',
                    spotify: 'spotify-id',
                    deezer: null,
                }],
            })
            .mockReturnValueOnce(new Promise(resolve => { resolveCreate = resolve; }));

        await renderAndSearch([{ ...externalResult, platformId: '123' }]);
        fireEvent.click(screen.getByText('New Artist'));
        const candidateLink = await screen.findByRole('link', { name: /Add link to existing artist: New Artist/ });
        fireEvent.click(screen.getByRole('button', { name: 'Create separate artist' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Creating separate artist');
        expect(candidateLink).not.toBeInTheDocument();
        const searchInput = screen.getByPlaceholderText('Search for an artist...');
        expect(searchInput).toBeDisabled();
        fireEvent.change(searchInput, { target: { value: 'different artist' } });
        expect(searchInput).toHaveValue('test');

        await act(async () => {
            resolveCreate({ status: 'success', artistId: 'separate-id', artistName: 'New Artist' });
        });

        expect(mockPush).toHaveBeenCalledWith('/artist/separate-id');
    });

    it('shows a blocking conflict without offering force creation', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        mockAddArtist.mockResolvedValue({
            status: 'conflict',
            message: 'This platform profile is already owned by another artist.',
        });

        await renderAndSearch([externalResult]);
        fireEvent.click(screen.getByText('New Artist'));

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                variant: 'destructive',
                description: 'This platform profile is already owned by another artist.',
            }));
        });
        expect(screen.queryByRole('button', { name: 'Create separate artist' })).not.toBeInTheDocument();
    });

    it('shows error toast when addArtist fails and keeps dropdown open', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        mockAddArtist.mockResolvedValue({ status: 'error', message: 'Platform API down' });

        await renderAndSearch([externalResult]);
        fireEvent.click(screen.getByText('New Artist'));

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                variant: 'destructive',
                description: 'Platform API down',
            }));
        });
        expect(mockPush).not.toHaveBeenCalled();
        expect(screen.getByText('Add to MusicNerd')).toBeInTheDocument();
    });

    it('shows error toast when addArtist throws and keeps dropdown open', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        mockAddArtist.mockRejectedValue(new Error('Network error'));

        await renderAndSearch([externalResult]);
        fireEvent.click(screen.getByText('New Artist'));

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                variant: 'destructive',
                description: 'Failed to add artist - please try again',
            }));
        });
        expect(screen.getByText('Add to MusicNerd')).toBeInTheDocument();
    });

    it('navigates to artist page for existing DB results', async () => {
        await renderAndSearch([dbResult]);

        fireEvent.click(screen.getByText('Existing Artist'));

        expect(mockPush).toHaveBeenCalledWith('/artist/42');
        expect(mockAddArtist).not.toHaveBeenCalled();
    });

    it('disables every search result while an artist add is in flight', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        let resolveAdd!: (val: unknown) => void;
        mockAddArtist.mockReturnValue(new Promise(r => { resolveAdd = r; }));

        await renderAndSearch([externalResult, externalResult2, dbResult]);

        fireEvent.click(screen.getByText('New Artist'));

        await waitFor(() => {
            expect(screen.getByText('Adding...')).toBeInTheDocument();
            const addingButton = screen.getByText('Adding...').closest('button');
            expect(addingButton).toBeDisabled();

            const otherButton = screen.getByText('Other Artist').closest('button');
            expect(otherButton).toBeDisabled();

            const dbButton = screen.getByText('Existing Artist').closest('button');
            expect(dbButton).toBeDisabled();
        });

        fireEvent.click(screen.getByText('Other Artist'));
        expect(mockAddArtist).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveAdd({ status: 'success', artistId: '99' });
        });
    });

    it('ignores an add response after the user changes the search', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        let resolveAdd!: (val: unknown) => void;
        mockAddArtist.mockReturnValue(new Promise(r => { resolveAdd = r; }));

        await renderAndSearch([externalResult]);
        fireEvent.click(screen.getByText('New Artist'));
        await waitFor(() => expect(screen.getByText('Adding...')).toBeInTheDocument());

        fireEvent.change(screen.getByPlaceholderText('Search for an artist...'), {
            target: { value: 'different search' },
        });
        const staleResult = await screen.findByText('New Artist');
        expect(staleResult.closest('button')).toBeDisabled();
        fireEvent.click(staleResult);
        expect(mockAddArtist).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveAdd({ status: 'success', artistId: 'stale-id', artistName: 'Stale Artist' });
        });

        expect(mockPush).not.toHaveBeenCalledWith('/artist/stale-id');
        expect(screen.queryByRole('button', { name: 'Create separate artist' })).not.toBeInTheDocument();
    });

    it('closes dropdown only on success, not during add', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: { user: { id: '1' } } });
        mockAddArtist.mockResolvedValue({ status: 'success', artistId: '99', artistName: 'New Artist' });

        await renderAndSearch([externalResult]);
        fireEvent.click(screen.getByText('New Artist'));

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/artist/99');
            expect(screen.queryByText('Add to MusicNerd')).not.toBeInTheDocument();
        });
    });
});
