import { render, screen, fireEvent } from '@testing-library/react';
import {
    Toast,
    ToastProvider,
    ToastViewport,
    ToastTitle,
    ToastDescription,
    ToastClose,
    ToastAction,
} from '@/components/ui/toast';

describe('Toast', () => {
    it('renders toast with all subcomponents', () => {
        render(
            <ToastProvider>
                <Toast>
                    <ToastTitle>Test Title</ToastTitle>
                    <ToastDescription>Test Description</ToastDescription>
                    <ToastClose data-testid="toast-close-button" />
                    <ToastAction altText="test action">Action</ToastAction>
                </Toast>
                <ToastViewport />
            </ToastProvider>
        );

        expect(screen.getByText('Test Title')).toBeInTheDocument();
        expect(screen.getByText('Test Description')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
        expect(screen.getByTestId('toast-close-button')).toBeInTheDocument();
    });

    it('renders destructive variant', () => {
        render(
            <ToastProvider>
                <Toast variant="destructive">
                    <ToastTitle>Error</ToastTitle>
                    <ToastDescription>Something went wrong</ToastDescription>
                </Toast>
                <ToastViewport />
            </ToastProvider>
        );

        const toastElement = screen.getByText('Error').closest('[role="status"]');
        expect(toastElement).toHaveClass('destructive');
    });

    it('handles close action', () => {
        const onOpenChange = jest.fn();
        render(
            <ToastProvider>
                <Toast onOpenChange={onOpenChange}>
                    <ToastTitle>Test Title</ToastTitle>
                    <ToastClose data-testid="toast-close-button" />
                </Toast>
                <ToastViewport />
            </ToastProvider>
        );

        const closeButton = screen.getByTestId('toast-close-button');
        fireEvent.click(closeButton);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('handles custom action', () => {
        const handleAction = jest.fn();
        render(
            <ToastProvider>
                <Toast>
                    <ToastTitle>Test Title</ToastTitle>
                    <ToastAction altText="custom action" onClick={handleAction}>
                        Custom Action
                    </ToastAction>
                </Toast>
                <ToastViewport />
            </ToastProvider>
        );

        const actionButton = screen.getByRole('button', { name: 'Custom Action' });
        fireEvent.click(actionButton);
        expect(handleAction).toHaveBeenCalled();
    });
}); 