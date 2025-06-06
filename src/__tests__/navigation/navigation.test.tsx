import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter, usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Nav from '@/app/_components/nav';
import HomePage from '@/app/page';
import { SessionProvider } from 'next-auth/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

// Mock environment variables
jest.mock('@/env', () => ({
    NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID: 'mock-client-id',
    NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET: 'mock-client-secret',
    NEXT_PUBLIC_SPOTIFY_WEB_REDIRECT_URI: 'http://localhost:3000/api/auth/callback/spotify',
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
    usePathname: jest.fn(),
}));

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(),
    SessionProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock SearchBar component
jest.mock('@/app/_components/nav/components/SearchBar', () => ({
    __esModule: true,
    default: () => <input type="text" role="textbox" />,
}));

// Mock Login component
jest.mock('@/app/_components/nav/components/Login', () => ({
    __esModule: true,
    default: ({ buttonStyles }: { buttonStyles: string }) => (
        <button data-testid="login-button">Connect</button>
    ),
}));

// Mock AddArtist component
jest.mock('@/app/_components/nav/components/AddArtist', () => ({
    __esModule: true,
    default: () => <button data-testid="add-artist-button">Add Artist</button>,
}));

// Mock HomePageSplash component
jest.mock('@/app/_components/HomePageSplash', () => ({
    __esModule: true,
    default: ({ animation }: { animation: string }) => (
        <div>
            <input type="text" role="textbox" />
            <button data-testid="login-button">Connect</button>
        </div>
    ),
}));

// Create a wrapper component for providers
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
        },
    },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        <SessionProvider session={null}>
            {children}
        </SessionProvider>
    </QueryClientProvider>
);

describe('Navigation Tests', () => {
    const mockRouter = {
        push: jest.fn(),
        replace: jest.fn(),
        prefetch: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
    });

    describe('Navigation Bar', () => {
        it('should not render navigation bar on home page', () => {
            (usePathname as jest.Mock).mockReturnValue('/');
            render(<Nav />, { wrapper: Wrapper });
            expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
        });

        it('should render navigation bar on other pages', () => {
            (usePathname as jest.Mock).mockReturnValue('/artist/123');
            render(<Nav />, { wrapper: Wrapper });
            expect(screen.getByRole('navigation')).toBeInTheDocument();
        });

        it('should have working logo link to home page', () => {
            (usePathname as jest.Mock).mockReturnValue('/artist/123');
            render(<Nav />, { wrapper: Wrapper });
            
            const logoLink = screen.getByRole('link', { name: /logo/i });
            expect(logoLink).toHaveAttribute('href', '/');
            
            fireEvent.click(logoLink);
            expect(mockRouter.push).not.toHaveBeenCalled(); // Next.js handles this internally
        });

        it('should render search bar in navigation', () => {
            (usePathname as jest.Mock).mockReturnValue('/artist/123');
            render(<Nav />, { wrapper: Wrapper });
            expect(screen.getByRole('textbox')).toBeInTheDocument();
        });
    });

    describe('Home Page Navigation', () => {
        it('should render search bar on home page', () => {
            render(<HomePage />, { wrapper: Wrapper });
            expect(screen.getByRole('textbox')).toBeInTheDocument();
        });

        it('should render login button on home page', () => {
            render(<HomePage />, { wrapper: Wrapper });
            expect(screen.getByTestId('login-button')).toBeInTheDocument();
        });
    });

    describe('Authentication State Navigation', () => {
        it('should show different navigation options when logged in', () => {
            (usePathname as jest.Mock).mockReturnValue('/artist/123');
            (useSession as jest.Mock).mockReturnValue({
                data: { user: { name: 'Test User' } },
                status: 'authenticated'
            });

            render(<Nav />, { wrapper: Wrapper });
            expect(screen.getByTestId('add-artist-button')).toBeInTheDocument();
            expect(screen.getByTestId('login-button')).toBeInTheDocument();
        });

        it('should show login button when logged out', () => {
            (usePathname as jest.Mock).mockReturnValue('/artist/123');
            render(<Nav />, { wrapper: Wrapper });
            expect(screen.getByTestId('login-button')).toBeInTheDocument();
        });
    });

    describe('Search Navigation', () => {
        it('should handle search input and navigation', async () => {
            (usePathname as jest.Mock).mockReturnValue('/artist/123');
            render(<Nav />, { wrapper: Wrapper });
            
            const searchInput = screen.getByRole('textbox');
            fireEvent.change(searchInput, { target: { value: 'test artist' } });
            
            // Wait for search results
            await waitFor(() => {
                expect(screen.getByRole('textbox')).toHaveValue('test artist');
            });
        });
    });

    describe('Responsive Navigation', () => {
        it('should maintain navigation structure on mobile viewport', () => {
            global.innerWidth = 375;
            global.dispatchEvent(new Event('resize'));
            
            (usePathname as jest.Mock).mockReturnValue('/artist/123');
            render(<Nav />, { wrapper: Wrapper });
            
            expect(screen.getByRole('navigation')).toHaveClass('nav-bar');
            expect(screen.getByRole('textbox')).toBeInTheDocument();
        });
    });
}); 