import { render, screen } from '@testing-library/react';
import { useRouter, usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
    usePathname: jest.fn(),
    redirect: jest.fn(),
}));

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(),
}));

// Create a simple protected component
function ProtectedComponent({ requiresAuth = true }) {
    const { data: session, status } = useSession();
    const router = useRouter();
    const pathname = usePathname();

    // Show nothing while loading
    if (status === 'loading') {
        return null;
    }

    if (requiresAuth && status === 'unauthenticated') {
        // Encode the pathname for the callback URL
        const encodedPath = encodeURIComponent(pathname);
        router.push(`/login?callbackUrl=${encodedPath}`);
        return null;
    }

    return (
        <div>
            <h1>Protected Content</h1>
            {session?.user && (
                <div data-testid="user-info">
                    Logged in as: {session.user.name}
                </div>
            )}
        </div>
    );
}

describe('Protected Routes', () => {
    const mockRouter = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (usePathname as jest.Mock).mockReturnValue('/protected');
    });

    describe('Authentication State', () => {
        it('should allow access when user is authenticated', () => {
            // Mock authenticated session
            (useSession as jest.Mock).mockReturnValue({
                data: {
                    user: {
                        name: 'Test User',
                        email: 'test@example.com'
                    },
                    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                },
                status: 'authenticated'
            });

            render(<ProtectedComponent />);

            // Verify protected content is shown
            expect(screen.getByText('Protected Content')).toBeInTheDocument();
            expect(screen.getByTestId('user-info')).toHaveTextContent('Test User');
            expect(mockRouter.push).not.toHaveBeenCalled();
        });

        it('should redirect to login when user is not authenticated', () => {
            // Mock unauthenticated session
            (useSession as jest.Mock).mockReturnValue({
                data: null,
                status: 'unauthenticated'
            });

            render(<ProtectedComponent />);

            // Verify redirect to login with encoded path
            expect(mockRouter.push).toHaveBeenCalledWith('/login?callbackUrl=%2Fprotected');
            expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
        });

        it('should show loading state while checking authentication', () => {
            // Mock loading session
            (useSession as jest.Mock).mockReturnValue({
                data: null,
                status: 'loading'
            });

            render(<ProtectedComponent />);

            // Verify no redirect and no protected content
            expect(mockRouter.push).not.toHaveBeenCalled();
            expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
        });
    });

    describe('Session Expiry', () => {
        it('should handle expired sessions', () => {
            // Mock expired session
            (useSession as jest.Mock).mockReturnValue({
                data: {
                    user: {
                        name: 'Test User',
                        email: 'test@example.com'
                    },
                    expires: new Date(Date.now() - 1000).toISOString() // Past date
                },
                status: 'unauthenticated'
            });

            render(<ProtectedComponent />);

            // Verify redirect to login with encoded path
            expect(mockRouter.push).toHaveBeenCalledWith('/login?callbackUrl=%2Fprotected');
            expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
        });

        it('should maintain access with valid session', () => {
            // Mock valid session
            (useSession as jest.Mock).mockReturnValue({
                data: {
                    user: {
                        name: 'Test User',
                        email: 'test@example.com'
                    },
                    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // Future date
                },
                status: 'authenticated'
            });

            render(<ProtectedComponent />);

            // Verify protected content is shown
            expect(screen.getByText('Protected Content')).toBeInTheDocument();
            expect(mockRouter.push).not.toHaveBeenCalled();
        });
    });

    describe('Optional Authentication', () => {
        it('should allow access to semi-protected routes when not authenticated', () => {
            // Mock unauthenticated session
            (useSession as jest.Mock).mockReturnValue({
                data: null,
                status: 'unauthenticated'
            });

            render(<ProtectedComponent requiresAuth={false} />);

            // Verify content is shown without redirect
            expect(screen.getByText('Protected Content')).toBeInTheDocument();
            expect(mockRouter.push).not.toHaveBeenCalled();
        });

        it('should show additional content when authenticated on semi-protected routes', () => {
            // Mock authenticated session
            (useSession as jest.Mock).mockReturnValue({
                data: {
                    user: {
                        name: 'Test User',
                        email: 'test@example.com'
                    },
                    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                },
                status: 'authenticated'
            });

            render(<ProtectedComponent requiresAuth={false} />);

            // Verify both public and authenticated content is shown
            expect(screen.getByText('Protected Content')).toBeInTheDocument();
            expect(screen.getByTestId('user-info')).toHaveTextContent('Test User');
            expect(mockRouter.push).not.toHaveBeenCalled();
        });
    });

    describe('Callback URL Handling', () => {
        it('should include the current path in callback URL', () => {
            // Mock different paths
            const paths = ['/protected/profile', '/protected/settings', '/protected/dashboard'];
            
            paths.forEach(path => {
                // Update mock path
                (usePathname as jest.Mock).mockReturnValue(path);
                
                // Mock unauthenticated session
                (useSession as jest.Mock).mockReturnValue({
                    data: null,
                    status: 'unauthenticated'
                });

                render(<ProtectedComponent />);

                // Verify redirect includes encoded callback URL
                const encodedPath = encodeURIComponent(path);
                expect(mockRouter.push).toHaveBeenCalledWith(`/login?callbackUrl=${encodedPath}`);

                // Clear mocks for next iteration
                jest.clearAllMocks();
            });
        });

        it('should handle special characters in callback URLs', () => {
            // Mock path with special characters
            const path = '/protected/user?id=123&type=admin';
            (usePathname as jest.Mock).mockReturnValue(path);
            
            // Mock unauthenticated session
            (useSession as jest.Mock).mockReturnValue({
                data: null,
                status: 'unauthenticated'
            });

            render(<ProtectedComponent />);

            // Verify redirect includes encoded callback URL
            expect(mockRouter.push).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent(path)}`);
        });
    });
}); 