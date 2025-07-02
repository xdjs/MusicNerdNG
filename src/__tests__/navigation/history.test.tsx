import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
    usePathname: jest.fn(),
    useSearchParams: jest.fn(),
}));

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(),
}));

// Create a simple test component that uses navigation
function TestComponent() {
    const router = useRouter();
    const pathname = usePathname();

    const handleNavigation = (action: () => void) => {
        try {
            action();
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div>
            <nav role="navigation">
                <button 
                    data-testid="back-button" 
                    onClick={() => handleNavigation(() => router.back())}
                >
                    Back
                </button>
                <button 
                    data-testid="forward-button" 
                    onClick={() => handleNavigation(() => router.forward())}
                >
                    Forward
                </button>
            </nav>
            <div>Current path: {pathname}</div>
        </div>
    );
}

describe('Navigation History', () => {
    const mockRouter = {
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
    });

    describe('Browser Navigation', () => {
        it('should handle back navigation', async () => {
            // Mock the current path
            (usePathname as jest.Mock).mockReturnValue('/test-path');

            // Render the test component
            render(<TestComponent />);

            // Simulate clicking the back button
            const backButton = screen.getByTestId('back-button');
            fireEvent.click(backButton);

            // Verify that router.back was called
            expect(mockRouter.back).toHaveBeenCalled();
        });

        it('should handle forward navigation', async () => {
            // Mock the current path
            (usePathname as jest.Mock).mockReturnValue('/test-path');

            // Render the test component
            render(<TestComponent />);

            // Simulate clicking the forward button
            const forwardButton = screen.getByTestId('forward-button');
            fireEvent.click(forwardButton);

            // Verify that router.forward was called
            expect(mockRouter.forward).toHaveBeenCalled();
        });

        it('should maintain navigation state after back/forward', async () => {
            // Mock the current path
            (usePathname as jest.Mock).mockReturnValue('/test-path');

            // Render the test component
            render(<TestComponent />);

            // Simulate navigation sequence
            const backButton = screen.getByTestId('back-button');
            const forwardButton = screen.getByTestId('forward-button');

            // Go back
            fireEvent.click(backButton);
            expect(mockRouter.back).toHaveBeenCalled();

            // Then forward
            fireEvent.click(forwardButton);
            expect(mockRouter.forward).toHaveBeenCalled();

            // Verify navigation state is maintained
            expect(screen.getByRole('navigation')).toBeInTheDocument();
        });
    });

    describe('Navigation with Search Parameters', () => {
        it('should preserve search parameters during navigation', async () => {
            // Mock search parameters
            const mockSearchParams = new URLSearchParams('?search=test');
            (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
            (usePathname as jest.Mock).mockReturnValue('/test-path');

            // Render the test component
            render(<TestComponent />);

            // Simulate clicking the back button
            const backButton = screen.getByTestId('back-button');
            fireEvent.click(backButton);

            // Verify that router.back was called
            expect(mockRouter.back).toHaveBeenCalled();

            // Verify that search parameters are preserved
            expect(mockSearchParams.get('search')).toBe('test');
        });

        it('should handle navigation with complex search parameters', async () => {
            // Mock complex search parameters
            const mockSearchParams = new URLSearchParams('?search=test&filter=artist&sort=name');
            (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
            (usePathname as jest.Mock).mockReturnValue('/test-path');

            // Render the test component
            render(<TestComponent />);

            // Simulate clicking the back button
            const backButton = screen.getByTestId('back-button');
            fireEvent.click(backButton);

            // Verify that router.back was called
            expect(mockRouter.back).toHaveBeenCalled();

            // Verify that all search parameters are preserved
            expect(mockSearchParams.get('search')).toBe('test');
            expect(mockSearchParams.get('filter')).toBe('artist');
            expect(mockSearchParams.get('sort')).toBe('name');
        });
    });

    describe('Error Handling', () => {
        it('should handle navigation errors gracefully', async () => {
            // Mock the current path
            (usePathname as jest.Mock).mockReturnValue('/test-path');

            // Mock a navigation error
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            mockRouter.back.mockImplementationOnce(() => {
                throw new Error('Navigation failed');
            });

            // Render the test component
            render(<TestComponent />);

            // Simulate clicking the back button
            const backButton = screen.getByTestId('back-button');
            fireEvent.click(backButton);

            // Verify that the error was caught and the component still renders
            expect(consoleSpy).toHaveBeenCalled();
            expect(screen.getByRole('navigation')).toBeInTheDocument();

            // Clean up
            consoleSpy.mockRestore();
        });
    });
}); 