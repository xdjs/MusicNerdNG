import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// ---- Mutable mock state ----

const mockSignOut = jest.fn(() => Promise.resolve({ ok: true }));
let mockSessionData: { user: { id: string; name: string; email: string }; expires: string } | null = null;
let mockSessionStatus = 'unauthenticated';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: mockSessionData,
    status: mockSessionStatus,
  }),
  signOut: (...args: Parameters<typeof mockSignOut>) => mockSignOut(...args),
}));

// Mock child components so the test focuses on ClientWrapper logic
jest.mock('../Dashboard', () => {
  return {
    __esModule: true,
    default: ({ user }: { user: { id: string; username?: string | null } }) => (
      <div data-testid="dashboard" data-user-id={user.id} data-username={user.username}>
        Dashboard: {user.username || user.id}
      </div>
    ),
  };
});

jest.mock('@/app/_components/AutoRefresh', () => {
  return {
    __esModule: true,
    default: () => <div data-testid="auto-refresh" />,
  };
});

// Import the component after mocks are wired
import ClientWrapper from '../ClientWrapper';

// ---- Helpers ----

const mockUserData = {
  id: 'user-123',
  wallet: '0xabc',
  email: 'test@example.com',
  username: 'testuser',
  privyUserId: 'privy-1',
  isAdmin: false,
  isWhiteListed: true,
  isSuperAdmin: false,
  isHidden: false,
  acceptedUgcCount: 5,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-06-01T00:00:00.000Z',
  legacyId: null,
};

// ---- Tests ----

describe('ClientWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default: unauthenticated
    mockSessionData = null;
    mockSessionStatus = 'unauthenticated';

    // Default: successful fetch
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockUserData),
      })
    ) as jest.Mock;
  });

  // --- 1. Normal authenticated flow ---
  it('renders Dashboard with user data when fetch succeeds', async () => {
    mockSessionData = {
      user: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
      expires: new Date(Date.now() + 86400000).toISOString(),
    };
    mockSessionStatus = 'authenticated';

    render(<ClientWrapper />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });

    expect(screen.getByTestId('dashboard')).toHaveAttribute('data-user-id', 'user-123');
    expect(screen.getByTestId('dashboard')).toHaveAttribute('data-username', 'testuser');
    expect(global.fetch).toHaveBeenCalledWith('/api/user/user-123');
  });

  // --- 2. 404 case: JWT references a deleted user ---
  it('calls signOut with redirect when API returns 404', async () => {
    mockSessionData = {
      user: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
      expires: new Date(Date.now() + 86400000).toISOString(),
    };
    mockSessionStatus = 'authenticated';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'User not found' }),
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    render(<ClientWrapper />);

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/', redirect: true });
    });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // --- 3. Guest / unauthenticated flow ---
  it('renders Dashboard with guest user when not authenticated', async () => {
    mockSessionData = null;
    mockSessionStatus = 'unauthenticated';

    render(<ClientWrapper />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });

    // Guest user has the well-known zero UUID
    expect(screen.getByTestId('dashboard')).toHaveAttribute(
      'data-user-id',
      '00000000-0000-0000-0000-000000000000'
    );
    expect(screen.getByTestId('dashboard')).toHaveAttribute('data-username', 'Guest User');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // --- 4. Other error codes (e.g., 500) should NOT trigger signOut ---
  it('does not sign out on non-404 errors (e.g., 500)', async () => {
    mockSessionData = {
      user: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
      expires: new Date(Date.now() + 86400000).toISOString(),
    };
    mockSessionStatus = 'authenticated';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    });

    render(<ClientWrapper />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });

    // Guest user shown, but signOut NOT called
    expect(screen.getByTestId('dashboard')).toHaveAttribute(
      'data-user-id',
      '00000000-0000-0000-0000-000000000000'
    );
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  // --- 5. Loading state ---
  it('shows loading spinner while session is loading', () => {
    mockSessionData = null;
    mockSessionStatus = 'loading';

    render(<ClientWrapper />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });
});
