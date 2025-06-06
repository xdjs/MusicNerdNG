import { render, screen, fireEvent } from '@testing-library/react';
import {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
    DialogClose,
} from '@/components/ui/dialog';

describe('Dialog', () => {
    it('renders dialog with all subcomponents', () => {
        render(
            <Dialog>
                <DialogTrigger>Open Dialog</DialogTrigger>
                <DialogContent aria-describedby="dialog-description">
                    <DialogHeader>
                        <DialogTitle>Test Dialog</DialogTitle>
                        <DialogDescription id="dialog-description">This is a test dialog description</DialogDescription>
                    </DialogHeader>
                    <div>Dialog content</div>
                    <DialogFooter>
                        <DialogClose data-testid="dialog-close-button">Close</DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );

        // Open the dialog
        fireEvent.click(screen.getByText('Open Dialog'));

        // Check if content is rendered
        expect(screen.getByText('Test Dialog')).toBeInTheDocument();
        expect(screen.getByText('This is a test dialog description')).toBeInTheDocument();
        expect(screen.getByText('Dialog content')).toBeInTheDocument();
        expect(screen.getByTestId('dialog-close-button')).toBeInTheDocument();
    });

    it('closes when close button is clicked', () => {
        render(
            <Dialog>
                <DialogTrigger>Open Dialog</DialogTrigger>
                <DialogContent aria-describedby="dialog-description">
                    <DialogHeader>
                        <DialogTitle>Test Dialog</DialogTitle>
                        <DialogDescription id="dialog-description">This is a test dialog description</DialogDescription>
                    </DialogHeader>
                    <div>Dialog content</div>
                    <DialogFooter>
                        <DialogClose data-testid="dialog-close-button">Close</DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );

        // Open the dialog
        fireEvent.click(screen.getByText('Open Dialog'));

        // Close the dialog
        fireEvent.click(screen.getByTestId('dialog-close-button'));

        // Check if content is not rendered
        expect(screen.queryByText('Dialog content')).not.toBeInTheDocument();
    });

    it('applies custom classes correctly', () => {
        render(
            <Dialog>
                <DialogTrigger>Open Dialog</DialogTrigger>
                <DialogContent aria-describedby="dialog-description" className="custom-content">
                    <DialogHeader className="custom-header">
                        <DialogTitle>Test Dialog</DialogTitle>
                        <DialogDescription id="dialog-description">This is a test dialog description</DialogDescription>
                    </DialogHeader>
                    <div>Dialog content</div>
                    <DialogFooter className="custom-footer">
                        <DialogClose data-testid="dialog-close-button">Close</DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );

        // Open the dialog
        fireEvent.click(screen.getByText('Open Dialog'));

        expect(screen.getByRole('dialog')).toHaveClass('custom-content');
        expect(screen.getByText('Test Dialog').parentElement).toHaveClass('custom-header');
        expect(screen.getByTestId('dialog-close-button').parentElement).toHaveClass('custom-footer');
    });

    it('renders default close button (X icon)', () => {
        render(
            <Dialog>
                <DialogTrigger>Open Dialog</DialogTrigger>
                <DialogContent aria-describedby="dialog-description">
                    <DialogHeader>
                        <DialogTitle>Test Dialog</DialogTitle>
                        <DialogDescription id="dialog-description">This is a test dialog description</DialogDescription>
                    </DialogHeader>
                    <div>Dialog content</div>
                </DialogContent>
            </Dialog>
        );

        // Open the dialog
        fireEvent.click(screen.getByText('Open Dialog'));

        // Check for the default close button (X icon)
        expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });
}); 