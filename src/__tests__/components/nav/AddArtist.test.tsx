// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockLogin = jest.fn();
const mockAddArtist = jest.fn();

let mockSessionData: any = null;

// Capture the submit callback so tests can trigger it directly
let capturedSubmitFn: ((values: Record<string, string>) => Promise<void>) | null = null;
const mockReset = jest.fn();

jest.mock('react-hook-form', () => {
    const React = require('react');
    return {
        useForm: () => ({
            control: {},
            handleSubmit: (fn: Function) => {
                capturedSubmitFn = fn as any;
                return (e?: Event) => { e?.preventDefault?.(); };
            },
            reset: mockReset,
            formState: { errors: {} },
            register: jest.fn(() => ({ ref: jest.fn(), onChange: jest.fn(), onBlur: jest.fn(), name: '' })),
        }),
        Controller: ({ render: renderFn, name }: any) => {
            const [val, setVal] = React.useState('');
            return renderFn({
                field: {
                    value: val,
                    onChange: (e: any) => setVal(e.target?.value ?? e),
                    name,
                    ref: jest.fn(),
                },
                fieldState: { error: undefined },
                formState: { errors: {} },
            });
        },
        FormProvider: ({ children }: any) => <>{children}</>,
    };
});

jest.mock('@hookform/resolvers/zod', () => ({
    zodResolver: () => jest.fn(),
}));

jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: mockSessionData }),
}));

jest.mock('@privy-io/react-auth', () => ({
    useLogin: () => ({ login: mockLogin }),
}));

jest.mock('@/app/actions/addArtist', () => ({
    addArtist: (...args: unknown[]) => mockAddArtist(...args),
}));

jest.mock('next/link', () => {
    return function MockLink({ children, href, onMouseDown, ...props }: any) {
        return <a href={href} onMouseDown={onMouseDown} {...props}>{children}</a>;
    };
});

jest.mock('lucide-react', () => ({
    Plus: () => <svg data-testid="plus-icon" />,
}));

jest.mock('@/components/ui/dialog', () => ({
    Dialog: ({ open, onOpenChange, children }: any) =>
        open ? <div data-testid="dialog">{children}</div> : null,
    DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <h2>{children}</h2>,
    DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

jest.mock('@/components/ui/form', () => ({
    Form: ({ children }: any) => <div>{children}</div>,
    FormField: ({ render: renderFn, name }: any) => {
        const React = require('react');
        const [val, setVal] = React.useState('');
        return renderFn({
            field: { value: val, onChange: (e: any) => setVal(e.target?.value ?? e), name },
        });
    },
    FormItem: ({ children }: any) => <div>{children}</div>,
    FormLabel: ({ children }: any) => <label>{children}</label>,
    FormControl: ({ children }: any) => <div>{children}</div>,
    FormDescription: ({ children }: any) => <p>{children}</p>,
    FormMessage: () => null,
}));

jest.mock('@/components/ui/input', () => ({
    Input: ({ placeholder, value, onChange, ...props }: any) => (
        <input placeholder={placeholder} value={value ?? ''} onChange={onChange} {...props} />
    ),
}));

jest.mock('@/components/ui/button', () => {
    const React = require('react');
    const MockButton = React.forwardRef(({ children, onClick, disabled, ...props }: any, ref: any) => (
        <button ref={ref} onClick={onClick} disabled={disabled} {...props}>{children}</button>
    ));
    MockButton.displayName = 'MockButton';
    return { Button: MockButton };
});

import AddArtist from '@/app/_components/nav/components/AddArtist';

const VALID_SPOTIFY_URL = 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb';
const VALID_SPOTIFY_ID = '4Z8W4fKeB5YxbusRsdQVPb';
const VALID_DEEZER_URL = 'https://www.deezer.com/artist/123456';
const VALID_DEEZER_ID = '123456';

describe('AddArtist', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSessionData = null;
        capturedSubmitFn = null;
    });

    describe('Button rendering', () => {
        it('renders the + button', () => {
            render(<AddArtist />);
            expect(screen.getByTestId('plus-icon')).toBeInTheDocument();
        });
    });

    describe('Unauthenticated behavior', () => {
        it('calls Privy login() when unauthenticated user clicks the button', () => {
            render(<AddArtist />);
            fireEvent.click(screen.getByRole('button'));
            expect(mockLogin).toHaveBeenCalled();
        });

        it('does not open modal when unauthenticated', () => {
            render(<AddArtist />);
            fireEvent.click(screen.getByRole('button'));
            expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
        });
    });

    describe('Authenticated behavior', () => {
        beforeEach(() => {
            mockSessionData = { user: { id: 'user-uuid', email: 'test@test.com' } };
        });

        it('opens modal when authenticated user clicks the button', () => {
            render(<AddArtist />);
            fireEvent.click(screen.getByRole('button'));
            expect(screen.getByTestId('dialog')).toBeInTheDocument();
        });

        it('does not call login() when authenticated', () => {
            render(<AddArtist />);
            fireEvent.click(screen.getByRole('button'));
            expect(mockLogin).not.toHaveBeenCalled();
        });

        describe('Form submission', () => {
            async function openModalAndSubmit(url: string) {
                render(<AddArtist />);
                fireEvent.click(screen.getByRole('button'));
                // Trigger submit by calling the captured handleSubmit fn directly
                await waitFor(() => expect(capturedSubmitFn).not.toBeNull());
                await capturedSubmitFn!({ artistUrl: url });
            }

            it('calls addArtist with the extracted Spotify ID on valid Spotify URL', async () => {
                mockAddArtist.mockResolvedValue({ status: 'success', artistId: 'new-id', artistName: 'Radiohead', message: 'Added!' });
                await openModalAndSubmit(VALID_SPOTIFY_URL);
                expect(mockAddArtist).toHaveBeenCalledWith(VALID_SPOTIFY_ID, 'spotify');
            });

            it('calls addArtist with the extracted Deezer ID on valid Deezer URL', async () => {
                mockAddArtist.mockResolvedValue({ status: 'success', artistId: 'new-id', artistName: 'FKJ', message: 'Added!' });
                await openModalAndSubmit(VALID_DEEZER_URL);
                expect(mockAddArtist).toHaveBeenCalledWith(VALID_DEEZER_ID, 'deezer');
            });

            it('shows success links after artist is added', async () => {
                mockAddArtist.mockResolvedValue({ status: 'success', artistId: 'new-id', artistName: 'Radiohead', message: 'Added!' });
                await openModalAndSubmit(VALID_SPOTIFY_URL);
                await waitFor(() => {
                    expect(screen.getByText('Check out Radiohead')).toBeInTheDocument();
                    expect(screen.getByText('Add links for Radiohead')).toBeInTheDocument();
                });
            });

            it('shows success message in green', async () => {
                mockAddArtist.mockResolvedValue({ status: 'success', artistId: 'new-id', artistName: 'Radiohead', message: 'Artist added!' });
                await openModalAndSubmit(VALID_SPOTIFY_URL);
                await waitFor(() => {
                    expect(screen.getByText('Artist added!')).toHaveClass('text-green-500');
                });
            });

            it('shows error message in red when add fails', async () => {
                mockAddArtist.mockResolvedValue({ status: 'error', message: 'Spotify error', artistId: undefined, artistName: undefined });
                await openModalAndSubmit(VALID_SPOTIFY_URL);
                await waitFor(() => {
                    expect(screen.getByText('Spotify error')).toHaveClass('text-red-500');
                });
            });

            it('does not show artist links on error', async () => {
                mockAddArtist.mockResolvedValue({ status: 'error', message: 'Something went wrong', artistId: undefined, artistName: undefined });
                await openModalAndSubmit(VALID_SPOTIFY_URL);
                await waitFor(() => {
                    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
                });
                expect(screen.queryByText(/Check out/)).not.toBeInTheDocument();
            });

            it('shows success links for "exists" status', async () => {
                mockAddArtist.mockResolvedValue({ status: 'exists', artistId: 'existing-id', artistName: 'Existing Artist', message: 'Already in DB' });
                await openModalAndSubmit(VALID_SPOTIFY_URL);
                await waitFor(() => {
                    expect(screen.getByText('Check out Existing Artist')).toBeInTheDocument();
                });
            });

            it('does not call addArtist when URL fails regex extraction', async () => {
                // The onSubmit function guards with a regex match before calling addArtist;
                // passing an invalid URL string exercises that null-return path.
                await openModalAndSubmit('https://notspotify.com/artist/123');
                expect(mockAddArtist).not.toHaveBeenCalled();
            });
        });
    });
});
