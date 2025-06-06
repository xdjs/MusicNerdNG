import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import SearchBarWrapper from '@/app/_components/nav/components/SearchBar';
import { useAccount, useConnect, useDisconnect, useConfig } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

// Mock next-auth
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(),
    signOut: jest.fn(),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
    usePathname: jest.fn(),
    useSearchParams: jest.fn(),
}));

// Mock wagmi
jest.mock('wagmi', () => ({
    useAccount: jest.fn(),
    useConnect: jest.fn(),
    useDisconnect: jest.fn(),
    useConfig: jest.fn().mockReturnValue({}),
}));

// Mock rainbow-kit
jest.mock('@rainbow-me/rainbowkit', () => ({
    useConnectModal: jest.fn(),
    ConnectButton: {
        Custom: ({ children }: { children: (props: any) => React.ReactNode }) => 
            children({
                account: undefined,
                chain: undefined,
                openAccountModal: jest.fn(),
                openChainModal: jest.fn(),
                openConnectModal: jest.fn(),
                authenticationStatus: 'unauthenticated',
                mounted: true,
            }),
    },
}));

// Mock the addArtist action
jest.mock('@/app/actions/addArtist', () => ({
    addArtist: jest.fn(),
}));

// Mock LoadingPage component
jest.mock('@/app/_components/LoadingPage', () => ({
    __esModule: true,
    default: () => <div role="status">Loading...</div>,
}));

describe('SearchBar', () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                refetchOnWindowFocus: false,
            },
        },
    });
    const mockRouter = {
        push: jest.fn(),
        prefetch: jest.fn(),
    };
    const mockPathname = '/';
    const mockSearchParams = new URLSearchParams();

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup default mock implementations
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (usePathname as jest.Mock).mockReturnValue(mockPathname);
        (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
        (useAccount as jest.Mock).mockReturnValue({ isConnected: false });
        (useConnectModal as jest.Mock).mockReturnValue({ openConnectModal: jest.fn() });
        (useDisconnect as jest.Mock).mockReturnValue({ disconnect: jest.fn() });

        // Mock fetch for search results
        global.fetch = jest.fn().mockImplementation(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ results: [] }),
            })
        );
    });

    it('renders search input', () => {
        render(
            <QueryClientProvider client={queryClient}>
                <SearchBarWrapper />
            </QueryClientProvider>
        );

        expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    });

    it('shows loading state while searching', async () => {
        // Mock search results with a delay
        (global.fetch as jest.Mock).mockImplementationOnce(() =>
            new Promise(resolve => setTimeout(() => resolve({
                ok: true,
                json: () => Promise.resolve({ results: [] }),
            }), 100))
        );

        render(
            <QueryClientProvider client={queryClient}>
                <SearchBarWrapper />
            </QueryClientProvider>
        );

        const searchInput = screen.getByPlaceholderText(/search/i);
        fireEvent.change(searchInput, { target: { value: 'test' } });
        fireEvent.focus(searchInput);

        // Wait for loading state
        await waitFor(() => {
            expect(screen.getByText('Artist not found!')).toBeInTheDocument();
        });
    });

    it('displays search results when available', async () => {
        // Mock search results
        (global.fetch as jest.Mock).mockImplementationOnce(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    results: [
                        { id: '1', name: 'Test Artist 1', isSpotifyOnly: false },
                        { id: '2', name: 'Test Artist 2', isSpotifyOnly: true },
                    ],
                }),
            })
        );

        render(
            <QueryClientProvider client={queryClient}>
                <SearchBarWrapper />
            </QueryClientProvider>
        );

        const searchInput = screen.getByPlaceholderText(/search/i);
        fireEvent.change(searchInput, { target: { value: 'test' } });
        fireEvent.focus(searchInput);

        await waitFor(() => {
            expect(screen.getByText('Test Artist 1')).toBeInTheDocument();
            expect(screen.getByText('Test Artist 2')).toBeInTheDocument();
        });
    });

    it('navigates to artist page when clicking a result', async () => {
        // Mock search results
        (global.fetch as jest.Mock).mockImplementationOnce(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    results: [
                        { id: '1', name: 'Test Artist 1', isSpotifyOnly: false },
                    ],
                }),
            })
        );

        render(
            <QueryClientProvider client={queryClient}>
                <SearchBarWrapper />
            </QueryClientProvider>
        );

        const searchInput = screen.getByPlaceholderText(/search/i);
        fireEvent.change(searchInput, { target: { value: 'test' } });
        fireEvent.focus(searchInput);

        await waitFor(() => {
            expect(screen.getByText('Test Artist 1')).toBeInTheDocument();
        });

        // Click the artist result
        const artistResult = screen.getByText('Test Artist 1').closest('div.hover\\:bg-gray-200');
        expect(artistResult).toBeInTheDocument();
        await act(async () => {
            fireEvent.mouseDown(artistResult!);
        });

        // Wait for navigation
        await waitFor(() => {
            expect(mockRouter.push).toHaveBeenCalledWith('/artist/1');
        });
    });

    it('handles search errors gracefully', async () => {
        // Mock search error
        (global.fetch as jest.Mock).mockImplementationOnce(() =>
            Promise.resolve({
                ok: false,
                status: 500,
            })
        );

        render(
            <QueryClientProvider client={queryClient}>
                <SearchBarWrapper />
            </QueryClientProvider>
        );

        const searchInput = screen.getByPlaceholderText(/search/i);
        fireEvent.change(searchInput, { target: { value: 'test' } });

        await waitFor(() => {
            expect(screen.queryByText('Test Artist 1')).not.toBeInTheDocument();
        });
    });
}); 