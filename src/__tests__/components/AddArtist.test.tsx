import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import AddArtist from '@/app/_components/nav/components/AddArtist';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { addArtist } from '@/app/actions/addArtist';
import { useToast } from '@/hooks/use-toast';

// Mock next-auth
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
}));

// Mock rainbow-kit
jest.mock('@rainbow-me/rainbowkit', () => ({
    useConnectModal: jest.fn(),
}));

// Mock useToast
jest.mock('@/hooks/use-toast', () => ({
    useToast: () => ({
        toast: jest.fn(),
    }),
}));

// Mock the addArtist action
jest.mock('@/app/actions/addArtist', () => ({
    addArtist: jest.fn(),
}));

// Mock shadcn/ui Dialog
jest.mock('@/components/ui/dialog', () => ({
    Dialog: ({ children, open, onOpenChange }: any) => {
        if (onOpenChange) {
            // Simulate the dialog's close behavior
            const handleClick = (e: any) => {
                if (e.target.getAttribute('data-testid') === 'dialog-root') {
                    onOpenChange(false);
                }
            };
            return open ? <div onClick={handleClick}>{children}</div> : null;
        }
        return open ? children : null;
    },
    DialogContent: ({ children, className }: any) => (
        <div data-testid="dialog-root" role="dialog" aria-modal="true" className={className}>
            {children}
        </div>
    ),
    DialogHeader: ({ children, className }: any) => <div className={className}>{children}</div>,
    DialogTitle: ({ children }: any) => <h2>{children}</h2>,
    DialogDescription: ({ children }: any) => <p>{children}</p>,
    DialogFooter: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// Mock react-hook-form
jest.mock('react-hook-form', () => {
    const { zodResolver } = require('@hookform/resolvers/zod');
    const formState = {
        errors: {},
    };
    return {
        useForm: () => {
            const fields: any = {};
            const form = {
                handleSubmit: (onSubmit: any) => async (e: any) => {
                    e?.preventDefault?.();
                    const formData = Object.keys(fields).reduce((acc: any, key) => {
                        acc[key] = fields[key].value;
                        return acc;
                    }, {});

                    // Validate the form data
                    const validation = await zodResolver()(formData);
                    if (validation.errors && Object.keys(validation.errors).length > 0) {
                        formState.errors = validation.errors;
                        return;
                    }

                    await onSubmit(formData);
                },
                control: {
                    _fields: fields,
                },
                formState,
                setValue: (name: string, value: string) => {
                    if (!fields[name]) {
                        fields[name] = { value: '' };
                    }
                    fields[name].value = value;
                },
                reset: () => {
                    Object.keys(fields).forEach(key => {
                        fields[key].value = '';
                    });
                    formState.errors = {};
                },
            };
            return form;
        },
        useFormContext: () => ({
            formState,
            control: {
                _fields: {},
            },
        }),
        useWatch: ({ control, name }: any) => {
            return control._fields[name]?.value || '';
        },
    };
});

// Mock shadcn/ui Form components
jest.mock('@/components/ui/form', () => {
    const Form = ({ children, ...props }: any) => <form role="form" className="space-y-8">{children}</form>;
    const FormField = ({ control, name, render }: any) => {
        const field = {
            value: control._fields[name]?.value || '',
            onChange: (e: any) => {
                if (!control._fields[name]) {
                    control._fields[name] = { value: '' };
                }
                control._fields[name].value = e.target.value;
            },
            onBlur: jest.fn(),
            ref: jest.fn(),
            name,
        };
        return render({ field });
    };
    const FormItem = ({ children }: any) => <div>{children}</div>;
    const FormLabel = ({ children }: any) => <label>{children}</label>;
    const FormControl = ({ children }: any) => <div>{children}</div>;
    const FormDescription = ({ children }: any) => <div>{children}</div>;
    const FormMessage = ({ children }: any) => {
        const { useFormContext } = require('react-hook-form');
        const form = useFormContext();
        const error = form?.formState?.errors?.artistSpotifyUrl?.message;
        return <div role="alert">{error || children}</div>;
    };

    return {
        Form,
        FormField,
        FormItem,
        FormLabel,
        FormControl,
        FormDescription,
        FormMessage,
    };
});

// Mock zod resolver
jest.mock('@hookform/resolvers/zod', () => {
    const zodResolver = () => async (values: any) => {
        const errors: any = {};
        if (!values.artistSpotifyUrl?.match(/https:\/\/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/)) {
            errors.artistSpotifyUrl = {
                message: 'Artist Spotify url must be in the format https://open.spotify.com/artist/YOURARTISTID',
            };
            return {
                values: {},
                errors,
            };
        }
        return {
            values,
            errors: {},
        };
    };
    return {
        zodResolver,
    };
});

// Mock shadcn/ui Input component
jest.mock('@/components/ui/input', () => ({
    Input: React.forwardRef(({ className, ...props }: any, ref) => (
        <input {...props} ref={ref} />
    )),
}));

// Mock shadcn/ui Button component
jest.mock('@/components/ui/button', () => ({
    Button: React.forwardRef(({ children, onClick, className, type = 'button', ...props }: any, ref) => (
        <button type={type} onClick={onClick} className={className} ref={ref} {...props}>
            {children}
        </button>
    )),
}));

// Mock next/link
jest.mock('next/link', () => ({
    __esModule: true,
    default: React.forwardRef<HTMLAnchorElement, any>(({ children, href, onMouseDown }: any, ref) => (
        <a href={href} onClick={onMouseDown} ref={ref}>{children}</a>
    )),
}));

describe('AddArtist', () => {
    const mockRouter = {
        push: jest.fn(),
        prefetch: jest.fn(),
    };

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup default mock implementations
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
        (useConnectModal as jest.Mock).mockReturnValue({ openConnectModal: jest.fn() });
        (addArtist as jest.Mock).mockResolvedValue({ status: 'success', artistId: '1', artistName: 'Test Artist' });

        // Mock environment variable
        process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'true';

        // Reset form state before each test
        const { formState } = require('react-hook-form').useFormContext();
        formState.errors = {};
    });

    it('renders add artist button', () => {
        render(<AddArtist session={null} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('opens dialog when button is clicked', async () => {
        render(<AddArtist session={null} />);
        
        const addButton = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(addButton);
        });

        expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /add artist/i })).toBeInTheDocument();
        expect(screen.getByText('Add an artist by pasting their Spotify URL')).toBeInTheDocument();
    });

    it('handles successful artist addition', async () => {
        (addArtist as jest.Mock).mockResolvedValueOnce({
            status: 'success',
            artistId: '123',
            artistName: 'Test Artist',
            message: 'Artist added successfully',
        });

        render(<AddArtist session={null} />);
        
        // Open dialog
        const addButton = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(addButton);
        });

        // Wait for dialog to appear
        await waitFor(() => {
            expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
        });

        // Submit form with valid URL
        const input = screen.getByPlaceholderText('https://open.spotify.com/artist/...');
        await act(async () => {
            fireEvent.change(input, { target: { value: 'https://open.spotify.com/artist/123' } });
        });

        const submitButton = screen.getByRole('button', { name: /add artist/i });
        await act(async () => {
            fireEvent.click(submitButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Artist added successfully')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /check out test artist/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /add data for test artist/i })).toBeInTheDocument();
        });
    });

    it('handles artist addition error', async () => {
        (addArtist as jest.Mock).mockResolvedValueOnce({
            status: 'error',
            message: 'Failed to add artist',
        });

        render(<AddArtist session={null} />);
        
        // Open dialog
        const addButton = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(addButton);
        });

        // Wait for dialog to appear
        await waitFor(() => {
            expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
        });

        // Submit form with valid URL
        const input = screen.getByPlaceholderText('https://open.spotify.com/artist/...');
        await act(async () => {
            fireEvent.change(input, { target: { value: 'https://open.spotify.com/artist/123' } });
        });

        const submitButton = screen.getByRole('button', { name: /add artist/i });
        await act(async () => {
            fireEvent.click(submitButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Failed to add artist')).toBeInTheDocument();
        });
    });

    it('shows loading state during artist addition', async () => {
        let resolvePromise: (value: any) => void;
        const promise = new Promise((resolve) => {
            resolvePromise = resolve;
        });
        (addArtist as jest.Mock).mockReturnValueOnce(promise);

        render(<AddArtist session={null} />);
        
        // Open dialog
        const addButton = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(addButton);
        });

        // Wait for dialog to appear
        await waitFor(() => {
            expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
        });

        // Submit form with valid URL
        const input = screen.getByPlaceholderText('https://open.spotify.com/artist/...');
        await act(async () => {
            fireEvent.change(input, { target: { value: 'https://open.spotify.com/artist/123' } });
        });

        const submitButton = screen.getByRole('button', { name: /add artist/i });
        await act(async () => {
            fireEvent.click(submitButton);
        });

        // Check loading state
        await waitFor(() => {
            expect(screen.getByAltText('whyyyyy')).toBeInTheDocument();
        });

        // Resolve promise
        resolvePromise!({
            status: 'success',
            artistId: '123',
            artistName: 'Test Artist',
            message: 'Artist added successfully',
        });

        await waitFor(() => {
            expect(screen.queryByAltText('whyyyyy')).not.toBeInTheDocument();
        });
    });

    it('handles existing artist case', async () => {
        (addArtist as jest.Mock).mockResolvedValueOnce({
            status: 'exists',
            artistId: '123',
            artistName: 'Test Artist',
            message: 'Artist already exists',
        });

        render(<AddArtist session={null} />);
        
        // Open dialog
        const addButton = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(addButton);
        });

        // Wait for dialog to appear
        await waitFor(() => {
            expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
        });

        // Submit form with valid URL
        const input = screen.getByPlaceholderText('https://open.spotify.com/artist/...');
        await act(async () => {
            fireEvent.change(input, { target: { value: 'https://open.spotify.com/artist/123' } });
        });

        const submitButton = screen.getByRole('button', { name: /add artist/i });
        await act(async () => {
            fireEvent.click(submitButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Artist already exists')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /check out test artist/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /add data for test artist/i })).toBeInTheDocument();
        });
    });

    it('closes dialog when clicking outside', async () => {
        render(<AddArtist session={null} />);
        
        // Open dialog
        const addButton = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(addButton);
        });

        // Wait for dialog to appear
        await waitFor(() => {
            expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
        });

        // Click outside the dialog
        const dialogRoot = screen.getByTestId('dialog-root');
        await act(async () => {
            fireEvent.click(dialogRoot);
        });

        await waitFor(() => {
            expect(screen.queryByTestId('dialog-root')).not.toBeInTheDocument();
        });
    });
}); 