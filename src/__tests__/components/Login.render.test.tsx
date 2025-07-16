// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Login from '@/app/_components/nav/components/Login';

// @ts-nocheck

// -------------------- Shared mocks (same style as loginFlow.test.tsx) --------------------
const authStatus: 'loading' | 'authenticated' | 'unauthenticated' = 'unauthenticated';
const sessionData: any = null;
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => ({ data: sessionData, status: authStatus })),
  signOut: jest.fn(),
}));

const openConnectModalMock = jest.fn();
jest.mock('@rainbow-me/rainbowkit', () => ({
  useConnectModal: () => ({ openConnectModal: openConnectModalMock }),
  ConnectButton: {
    Custom: ({ children }: { children: (props: any) => React.ReactNode }) =>
      children({
        account: undefined,
        chain: undefined,
        openAccountModal: jest.fn(),
        openChainModal: jest.fn(),
        openConnectModal: openConnectModalMock,
        authenticationStatus: 'unauthenticated',
        mounted: true,
      }),
  },
}));

jest.mock('wagmi', () => ({
  useAccount: jest.fn(() => ({ isConnected: false })),
  useDisconnect: jest.fn(() => ({ disconnect: jest.fn() })),
  useConfig: jest.fn().mockReturnValue({}),
}));

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/app/actions/addArtist', () => ({
  addArtist: jest.fn(),
}));

// -------------------- Helpers --------------------
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderWithProviders = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);

const originalEnv = { ...process.env };
afterEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, originalEnv);
});

// -------------------- Tests --------------------
describe('Login component – basic rendering', () => {
  it('renders ⚙️ admin link when wallet requirement disabled (local dev)', () => {
    process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'true';

    renderWithProviders(<Login buttonStyles="" />);

    const gearLink = screen.getByRole('link', { name: /admin panel/i });
    expect(gearLink).toBeInTheDocument();
    expect(gearLink).toHaveAttribute('href', '/admin');
  });

  it('shows connect button and opens RainbowKit modal in normal mode', async () => {
    process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';

    renderWithProviders(<Login buttonStyles="" />);

    // Wait for the component to be fully rendered
    await waitFor(() => {
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    const connectBtn = screen.getByRole('button');
    fireEvent.click(connectBtn);
    
    // Wait for the mock to be called
    await waitFor(() => {
      expect(openConnectModalMock).toHaveBeenCalled();
    });
  });
}); 