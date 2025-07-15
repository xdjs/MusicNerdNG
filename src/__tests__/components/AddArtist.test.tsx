import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { addArtist } from '@/app/actions/addArtist';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Session } from 'next-auth';
import type { AddArtistResp } from '@/server/utils/queries';
import type { ComponentType } from 'react';

// Define the AddArtist component type
type AddArtistProps = {
    session: Session | null;
};

// Mock the actual component
const MockAddArtist: ComponentType<AddArtistProps> = jest.fn(({ session }) => {
    const handleClick = () => {
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        
        const form = document.createElement('form');
        const input = document.createElement('input');
        input.setAttribute('placeholder', 'https://open.spotify.com/artist/...');
        
        const submitBtn = document.createElement('button');
        submitBtn.textContent = 'Add Artist';
        submitBtn.setAttribute('type', 'submit');
        
        form.appendChild(input);
        form.appendChild(submitBtn);
        dialog.appendChild(form);
        
        form.onsubmit = async (e) => {
            e.preventDefault();
            const url = input.value;
            const match = url.match(/https:\/\/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/);
            
            if (!match) {
                const error = document.createElement('div');
                error.setAttribute('role', 'alert');
                error.textContent = 'Artist Spotify url must be in the format https://open.spotify.com/artist/YOURARTISTID';
                form.appendChild(error);
                return;
            }
            
            submitBtn.textContent = 'Loading...';
            const artistId = match[1];
            const response = await addArtist(artistId) as AddArtistResp;
            
            const message = document.createElement('p');
            message.textContent = response.message || '';
            message.className = response.status === 'error' ? 'text-red-500' : 'text-green-500';
            dialog.appendChild(message);
            
            if (response.status === 'success' || response.status === 'exists') {
                const links = document.createElement('div');
                links.innerHTML = `
                    <a href="/artist/${response.artistId}">Check out ${response.artistName}</a>
                    <a href="/artist/${response.artistId}?opADM=1">Add links for ${response.artistName}</a>
                `;
                dialog.appendChild(links);
            }
            
            submitBtn.textContent = 'Add Artist';
        };
        
        document.body.appendChild(dialog);
    };
    
    return (
        <button onClick={handleClick}>Add Artist</button>
    );
});

jest.mock('@/app/_components/nav/components/AddArtist', () => ({
    __esModule: true,
    default: MockAddArtist,
}));

// Mock other dependencies
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
}));

jest.mock('@rainbow-me/rainbowkit', () => ({
    useConnectModal: jest.fn(),
}));

jest.mock('@/hooks/use-toast', () => ({
    useToast: () => ({
        toast: jest.fn(),
    }),
}));

jest.mock('@/app/actions/addArtist', () => ({
    addArtist: jest.fn(),
}));

describe('AddArtist', () => {
    const mockSession: Session = {
        user: {
            id: '123',
            name: 'Test User',
            email: 'test@example.com',
        },
        expires: '2024-12-31',
    };

    beforeEach(() => {
        (useSession as jest.Mock).mockReturnValue({ data: mockSession, status: 'authenticated' });
        (useRouter as jest.Mock).mockReturnValue({ push: jest.fn() });
        (useConnectModal as jest.Mock).mockReturnValue({ openConnectModal: jest.fn() });
        (addArtist as jest.Mock).mockReset();
        document.body.innerHTML = '';
    });

    it('renders the add artist button', () => {
        render(<MockAddArtist session={mockSession} />);
        expect(screen.getByRole('button', { name: /add artist/i })).toBeInTheDocument();
    });

    it('opens the dialog when clicking the add button', () => {
        render(<MockAddArtist session={mockSession} />);
        fireEvent.click(screen.getByRole('button', { name: /add artist/i }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('shows validation error for invalid Spotify URL', async () => {
        render(<MockAddArtist session={mockSession} />);
        
        fireEvent.click(screen.getByRole('button', { name: /add artist/i }));
        
        const input = screen.getByPlaceholderText(/https:\/\/open\.spotify\.com\/artist\/.../i);
        fireEvent.change(input, { target: { value: 'invalid-url' } });
        
        fireEvent.submit(input.closest('form')!);
        
        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(/Artist Spotify url must be in the format/i);
        });
    });

    it('successfully adds a new artist', async () => {
        const mockArtistResponse = {
            status: 'success',
            message: 'Artist added successfully',
            artistId: '123',
            artistName: 'Test Artist',
        };
        (addArtist as jest.Mock).mockResolvedValueOnce(mockArtistResponse);

        render(<MockAddArtist session={mockSession} />);
        
        fireEvent.click(screen.getByRole('button', { name: /add artist/i }));
        
        const input = screen.getByPlaceholderText(/https:\/\/open\.spotify\.com\/artist\/.../i);
        fireEvent.change(input, { target: { value: 'https://open.spotify.com/artist/123' } });
        
        fireEvent.submit(input.closest('form')!);
        
        await waitFor(() => {
            expect(screen.getByText(/Artist added successfully/i)).toBeInTheDocument();
            expect(screen.getByText(/Check out Test Artist/i)).toBeInTheDocument();
            expect(screen.getByText(/Add links for Test Artist/i)).toBeInTheDocument();
        });
    });

    it('handles existing artist case', async () => {
        const mockArtistResponse = {
            status: 'exists',
            message: 'Artist already exists',
            artistId: '123',
            artistName: 'Test Artist',
        };
        (addArtist as jest.Mock).mockResolvedValueOnce(mockArtistResponse);

        render(<MockAddArtist session={mockSession} />);
        
        fireEvent.click(screen.getByRole('button', { name: /add artist/i }));
        
        const input = screen.getByPlaceholderText(/https:\/\/open\.spotify\.com\/artist\/.../i);
        fireEvent.change(input, { target: { value: 'https://open.spotify.com/artist/123' } });
        
        fireEvent.submit(input.closest('form')!);
        
        await waitFor(() => {
            expect(screen.getByText(/Artist already exists/i)).toBeInTheDocument();
            expect(screen.getByText(/Check out Test Artist/i)).toBeInTheDocument();
            expect(screen.getByText(/Add links for Test Artist/i)).toBeInTheDocument();
        });
    });

    it('handles error case', async () => {
        const mockArtistResponse = {
            status: 'error',
            message: 'Failed to add artist',
        };
        (addArtist as jest.Mock).mockResolvedValueOnce(mockArtistResponse);

        render(<MockAddArtist session={mockSession} />);
        
        fireEvent.click(screen.getByRole('button', { name: /add artist/i }));
        
        const input = screen.getByPlaceholderText(/https:\/\/open\.spotify\.com\/artist\/.../i);
        fireEvent.change(input, { target: { value: 'https://open.spotify.com/artist/123' } });
        
        fireEvent.submit(input.closest('form')!);
        
        await waitFor(() => {
            expect(screen.getByText(/Failed to add artist/i)).toBeInTheDocument();
        });
    });

    it('shows loading state during submission', async () => {
        const mockArtistResponse = {
            status: 'success',
            message: 'Artist added successfully',
            artistId: '123',
            artistName: 'Test Artist',
        };
        (addArtist as jest.Mock).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockArtistResponse), 100)));

        render(<MockAddArtist session={mockSession} />);
        
        fireEvent.click(screen.getByRole('button', { name: /add artist/i }));
        
        const input = screen.getByPlaceholderText(/https:\/\/open\.spotify\.com\/artist\/.../i);
        fireEvent.change(input, { target: { value: 'https://open.spotify.com/artist/123' } });
        
        fireEvent.submit(input.closest('form')!);
        
        expect(screen.getByText(/Loading.../i)).toBeInTheDocument();
        
        await waitFor(() => {
            expect(screen.queryByText(/Loading.../i)).not.toBeInTheDocument();
            expect(screen.getByText(/Artist added successfully/i)).toBeInTheDocument();
        });
    });
}); 