/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddArtistData from '@/app/artist/[id]/_components/AddArtistData';
import { useSession } from 'next-auth/react';
import { LINK_NOT_SUPPORTED } from '@/lib/linkSubmissionMessages';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));

const baseProps = {
  // Partial artist fixture is sufficient for exercising the trigger.
  artist: { id: 'a1', name: 'Test Artist' } as any,
  spotifyImg: '',
  availableLinks: [],
  isOpenOnLoad: false,
};

describe('AddArtistData "+" trigger', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing while the session is still loading', () => {
    (useSession as jest.Mock).mockReturnValue({ data: null, status: 'loading' });
    const getByIdSpy = jest.spyOn(document, 'getElementById');

    render(<AddArtistData {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));

    expect(getByIdSpy).not.toHaveBeenCalledWith('login-btn'); // no spurious login prompt
    expect(screen.queryByText(/Suggest a link/i)).not.toBeInTheDocument(); // modal not opened

    getByIdSpy.mockRestore();
  });

  it('prompts login (clicks #login-btn) and does not open the modal when logged out', () => {
    (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
    const loginClick = jest.fn();
    const getByIdSpy = jest
      .spyOn(document, 'getElementById')
      .mockReturnValue({ click: loginClick } as unknown as HTMLElement);

    render(<AddArtistData {...baseProps} />);
    fireEvent.click(screen.getByRole('button')); // only the trigger renders while the dialog is closed

    expect(getByIdSpy).toHaveBeenCalledWith('login-btn');
    expect(loginClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Suggest a link/i)).not.toBeInTheDocument();

    getByIdSpy.mockRestore();
  });

  it('warns in dev and does not open the modal when login button is absent', () => {
    (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
    const getByIdSpy = jest.spyOn(document, 'getElementById').mockReturnValue(null);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    render(<AddArtistData {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));

    expect(warnSpy).toHaveBeenCalled();
    expect(screen.queryByText(/Suggest a link/i)).not.toBeInTheDocument();

    getByIdSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('opens the submit modal when logged in', () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });

    render(<AddArtistData {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));

    // UGC users see "Suggest a link for {artist}" header and a Submit button
    expect(screen.getByRole('heading', { name: /Suggest a link for Test Artist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('uses "Save Link" submit label for direct-edit (owner / admin)', () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });

    render(<AddArtistData {...baseProps} directEdit />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('heading', { name: /Add a link for Test Artist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Link' })).toBeInTheDocument();
  });

  it('shows the friendly LINK_NOT_SUPPORTED error when a URL matches no platform', async () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });
    const originalFetch = global.fetch;
    // /api/platformRegexes returns no regexes → validatePlatformLinkBackend will reject any URL.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as unknown as typeof fetch;

    try {
      render(<AddArtistData {...baseProps} />);
      fireEvent.click(screen.getByRole('button')); // open the modal

      const input = screen.getByPlaceholderText(/Paste a profile link/i);
      fireEvent.change(input, { target: { value: 'https://example.com/foo' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

      await waitFor(() => {
        expect(screen.getByText(LINK_NOT_SUPPORTED)).toBeInTheDocument();
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('shows the "Supported links" trigger inside the modal', () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });

    render(<AddArtistData {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button', { name: 'Supported links' })).toBeInTheDocument();
  });

});

describe('isWalletExample', () => {
  // The helper that keeps "Example Wallet: 0x000000..." (and any other wallet-shaped
  // entry from the urlmap) out of the "Supported links" dropdown.
  // Eslint disable: the dynamic import keeps this independent from the modal's render path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isWalletExample } = require('@/app/artist/[id]/_components/AddArtistDataOptions');

  it.each([
    ['Example Wallet: 0x000000000000', true],
    ['0xABCDEF1234', true],
    ['Send to 0x1234abcd…', true],
    ['https://ARTIST_NAME.bandcamp.com', false],
    ['spotify.com/artist/…', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('isWalletExample(%p) → %p', (input, expected) => {
    expect(isWalletExample(input)).toBe(expected);
  });
});
