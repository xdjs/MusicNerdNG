// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let mockPrivyReady = true;
let mockPrivyAuthenticated = false;
let mockPrivyUser: any = null;
let mockSessionData: any = null;
let mockSessionStatus = 'unauthenticated';
let loginCallbacks: { onComplete?: Function } = {};

const mockPrivyLogin = jest.fn();
const mockPrivyLogout = jest.fn();
const mockSignIn = jest.fn().mockResolvedValue({ ok: true });
const mockSignOut = jest.fn().mockResolvedValue({ ok: true });

jest.mock('@privy-io/react-auth', () => ({
    usePrivy: () => ({
        ready: mockPrivyReady,
        authenticated: mockPrivyAuthenticated,
        user: mockPrivyUser,
        getAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
    }),
    useLogin: (opts: any) => {
        loginCallbacks = opts || {};
        return { login: mockPrivyLogin };
    },
    useLogout: () => ({ logout: mockPrivyLogout }),
    useIdentityToken: () => ({ identityToken: 'mock-identity-token' }),
}));

jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: mockSessionData, status: mockSessionStatus, update: jest.fn() }),
    signIn: (...args: any[]) => mockSignIn(...args),
    signOut: (...args: any[]) => mockSignOut(...args),
}));

jest.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/app/_components/nav/components/LegacyAccountModal', () => ({
    LegacyAccountModal: ({ open, onClose }: any) =>
        open ? <div data-testid="legacy-modal"><button onClick={onClose}>Close</button></div> : null,
}));

jest.mock('@/components/ui/button', () => {
    const React = require('react');
    const MockButton = React.forwardRef(({ children, onClick, disabled, ...props }: any, ref: any) => (
        <button ref={ref} onClick={onClick} disabled={disabled} {...props}>{children}</button>
    ));
    MockButton.displayName = 'MockButton';
    return { Button: MockButton };
});

jest.mock('@/components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onSelect }: any) => (
        <div role="menuitem" onClick={onSelect}>{children}</div>
    ),
}));

jest.mock('lucide-react', () => ({
    LogIn: () => <svg data-testid="login-icon" />,
}));

jest.mock('next/link', () => {
    return function MockLink({ children, href, ...props }: any) {
        return <a href={href} {...props}>{children}</a>;
    };
});

jest.mock('@/server/utils/privyConstants', () => ({
    TOKEN_PREFIXES: { PRIVY_ID: 'privyid:', ID_TOKEN: 'idtoken:' },
}));

import PrivyLogin from '@/app/_components/nav/components/PrivyLogin';

describe('Login flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        loginCallbacks = {};
        mockPrivyReady = true;
        mockPrivyAuthenticated = false;
        mockPrivyUser = null;
        mockSessionData = null;
        mockSessionStatus = 'unauthenticated';
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ count: 0 }),
        });
        Object.defineProperty(window, 'sessionStorage', {
            value: {
                getItem: jest.fn(() => null),
                setItem: jest.fn(),
                removeItem: jest.fn(),
                clear: jest.fn(),
            },
            writable: true,
        });
    });

    describe('Unauthenticated state', () => {
        it('shows the Log In button', () => {
            render(<PrivyLogin />);
            expect(screen.getByText('Log In')).toBeInTheDocument();
        });

        it('shows a disabled loading button when Privy is not ready', () => {
            mockPrivyReady = false;
            render(<PrivyLogin />);
            expect(screen.getByRole('button')).toBeDisabled();
        });
    });

    describe('Login trigger', () => {
        it('opens Privy login modal when "Log In" is clicked', () => {
            render(<PrivyLogin />);
            fireEvent.click(screen.getByText('Log In'));
            expect(mockPrivyLogin).toHaveBeenCalled();
        });
    });

    describe('Post-login NextAuth handshake', () => {
        it('calls NextAuth signIn after a fresh Privy login', async () => {
            mockPrivyAuthenticated = true;
            mockPrivyUser = { id: 'did:privy:user123' };
            render(<PrivyLogin />);

            await loginCallbacks.onComplete?.({
                user: { id: 'did:privy:user123' },
                isNewUser: false,
                wasAlreadyAuthenticated: false,
            });

            await waitFor(() => {
                expect(mockSignIn).toHaveBeenCalledWith('privy', expect.objectContaining({ redirect: false }));
            });
        });

        it('skips NextAuth signIn when user was already authenticated in Privy', async () => {
            mockPrivyAuthenticated = true;
            render(<PrivyLogin />);

            await loginCallbacks.onComplete?.({
                user: { id: 'did:privy:user123' },
                isNewUser: false,
                wasAlreadyAuthenticated: true,
            });

            expect(mockSignIn).not.toHaveBeenCalled();
        });
    });

    describe('Authenticated state', () => {
        beforeEach(() => {
            mockPrivyAuthenticated = true;
            mockSessionData = {
                user: { id: 'user-uuid', isAdmin: false, needsLegacyLink: false },
                expires: '2026-12-31',
            };
            mockSessionStatus = 'authenticated';
        });

        it('shows the profile avatar (not the login icon)', () => {
            render(<PrivyLogin />);
            expect(screen.getByAltText('Profile')).toBeInTheDocument();
            expect(screen.queryByTestId('login-icon')).not.toBeInTheDocument();
        });

        it('shows the Log Out option', () => {
            render(<PrivyLogin />);
            expect(screen.getByText('Log Out')).toBeInTheDocument();
        });
    });

    describe('Logout flow', () => {
        beforeEach(() => {
            mockPrivyAuthenticated = true;
            mockSessionData = {
                user: { id: 'user-uuid', isAdmin: false, needsLegacyLink: false },
                expires: '2026-12-31',
            };
            mockSessionStatus = 'authenticated';
        });

        it('calls NextAuth signOut and Privy logout when Log Out is clicked', async () => {
            render(<PrivyLogin />);
            fireEvent.click(screen.getByText('Log Out'));

            await waitFor(() => {
                expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
                expect(mockPrivyLogout).toHaveBeenCalled();
            });
        });
    });
});
