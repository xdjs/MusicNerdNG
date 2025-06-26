// @ts-nocheck

import { render, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Login from '@/app/_components/nav/components/Login';

// Helpers to control auth status inside the mocked hook
let authStatus: 'loading' | 'authenticated' | 'unauthenticated' = 'loading';
let sessionData: any = null;

// -------------------- Mocks --------------------
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({ data: sessionData, status: authStatus })),
    signOut: jest.fn(),
}));

// Mock next/navigation router hooks that SearchBar expects
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

// Mock wagmi hooks
jest.mock('wagmi', () => ({
    useAccount: jest.fn(() => ({ isConnected: false })),
    useDisconnect: jest.fn(() => ({ disconnect: jest.fn() })),
    useConfig: jest.fn().mockReturnValue({}),
}));

// Capture the RainbowKit connect modal opener
const openConnectModalMock = jest.fn();

jest.mock('@rainbow-me/rainbowkit', () => ({
    useConnectModal: () => ({ openConnectModal: openConnectModalMock }),
    // Minimal stub for ConnectButton used inside Login component
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

// Mock addArtist API action (not relevant here)
jest.mock('@/app/actions/addArtist', () => ({
    addArtist: jest.fn(),
}));

// Disable the loading page component side-effects
jest.mock('@/app/_components/LoadingPage', () => ({
    __esModule: true,
    default: () => null,
}));

// -------------------- Test --------------------

describe('Login flow – SIWE prompt appears', () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        sessionStorage.clear();
        authStatus = 'loading';
        sessionData = null;
    });

    it('opens RainbowKit connect modal (SIWE step) once auth status resolves', async () => {
        jest.useFakeTimers();

        // Prepare environment
        authStatus = 'unauthenticated';
        // Set flags that trigger Login to prompt connection
        sessionStorage.setItem('searchFlow', 'true');
        sessionStorage.setItem('loginInitiator', 'searchBar');

        const { rerender } = render(
            <QueryClientProvider client={queryClient}>
                <Login buttonStyles="" />
            </QueryClientProvider>
        );

        // Allow effects to run
        await waitFor(() => {
            expect(openConnectModalMock).toHaveBeenCalled();
        });

        jest.useRealTimers();
    });
}); 