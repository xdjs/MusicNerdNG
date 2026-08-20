/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddArtistData from '@/app/artist/[id]/_components/AddArtistData';
import { useSession } from 'next-auth/react';
import { LINK_NOT_SUPPORTED } from '@/lib/linkSubmissionMessages';
import { addArtistDataAction } from '@/app/actions/serverActions';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));

const baseProps = {
  // Partial artist fixture is sufficient for exercising the trigger.
  artist: { id: 'a1', name: 'Test Artist' } as any,
  spotifyImg: '',
  availableLinks: [],
  isOpenOnLoad: false,
};

describe('AddArtistData "+" trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (addArtistDataAction as jest.Mock).mockReset();
  });

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

  it('auth-gates a handed-off URL, then resumes and consumes it after login', async () => {
    const spotifyUrl = 'https://open.spotify.com/artist/2TNJWBi73MnkSRkZRPBqSW?si=test';
    let authState = { data: null, status: 'loading' } as {
      data: { user: { id: string } } | null;
      status: 'authenticated' | 'loading' | 'unauthenticated';
    };
    (useSession as jest.Mock).mockImplementation(() => authState);

    const loginButton = document.createElement('button');
    loginButton.id = 'login-btn';
    const loginClick = jest.fn();
    loginButton.addEventListener('click', loginClick);
    document.body.appendChild(loginButton);
    window.history.replaceState(
      {},
      '',
      `/artist/a1?view=links&addLink=${encodeURIComponent(spotifyUrl)}#social-links`,
    );

    try {
      const { rerender } = render(
        <AddArtistData {...baseProps} isOpenOnLoad prefillUrl={spotifyUrl} />,
      );

      expect(loginClick).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: /Suggest a link for Test Artist/i })).not.toBeInTheDocument();

      authState = { data: null, status: 'unauthenticated' };
      rerender(<AddArtistData {...baseProps} isOpenOnLoad prefillUrl={spotifyUrl} />);

      expect(loginClick).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('heading', { name: /Suggest a link for Test Artist/i })).not.toBeInTheDocument();
      expect(window.location.search).toContain('addLink=');
      expect(addArtistDataAction).not.toHaveBeenCalled();

      // The real Privy flow reloads after login. A session update on the same
      // mount is enough to verify the pending handoff resumes as well.
      authState = {
        data: { user: { id: 'u1' } },
        status: 'authenticated',
      };
      rerender(<AddArtistData {...baseProps} isOpenOnLoad prefillUrl={spotifyUrl} />);

      expect(screen.getByRole('heading', { name: /Suggest a link for Test Artist/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Paste a profile link/i)).toHaveValue(spotifyUrl);
      expect(addArtistDataAction).not.toHaveBeenCalled();
      await waitFor(() => expect(window.location.search).toBe('?view=links'));
      expect(window.location.hash).toBe('#social-links');
    } finally {
      loginButton.remove();
      window.history.replaceState({}, '', '/');
    }
  });

  it('handles a new handed-off URL when client navigation reuses the component', async () => {
    (useSession as jest.Mock).mockReturnValue({
      data: { user: { id: 'u1' } },
      status: 'authenticated',
    });
    const firstUrl = 'https://open.spotify.com/artist/2TNJWBi73MnkSRkZRPBqSW';
    const secondUrl = 'https://www.deezer.com/artist/815939';
    window.history.replaceState(
      {},
      '',
      `/artist/a1?addLink=${encodeURIComponent(firstUrl)}`,
    );

    try {
      const { rerender } = render(
        <AddArtistData {...baseProps} isOpenOnLoad prefillUrl={firstUrl} />,
      );
      expect(screen.getByPlaceholderText(/Paste a profile link/i)).toHaveValue(firstUrl);
      await waitFor(() => expect(window.location.search).toBe(''));

      window.history.replaceState(
        {},
        '',
        `/artist/a2?addLink=${encodeURIComponent(secondUrl)}`,
      );
      rerender(
        <AddArtistData
          {...baseProps}
          artist={{ ...baseProps.artist, id: 'a2', name: 'Second Artist' }}
          isOpenOnLoad
          prefillUrl={secondUrl}
        />,
      );

      expect(screen.getByPlaceholderText(/Paste a profile link/i)).toHaveValue(secondUrl);
      await waitFor(() => expect(window.location.search).toBe(''));
    } finally {
      window.history.replaceState({}, '', '/');
    }
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
    const trigger = screen.getByRole('button', { name: 'Add a link for Test Artist' });
    expect(trigger).toHaveAttribute('title', 'Add a link for Test Artist');
    fireEvent.click(trigger);

    // UGC users see "Suggest a link for {artist}" header and a Submit button
    expect(screen.getByRole('heading', { name: /Suggest a link for Test Artist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('opens with the handed-off URL prefilled, consumes addLink, and does not submit', async () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });
    const spotifyUrl = 'https://open.spotify.com/artist/2TNJWBi73MnkSRkZRPBqSW?si=test';
    const originalReplaceState = window.history.replaceState;
    const nativeReplaceState = originalReplaceState.bind(window.history);
    nativeReplaceState(
      { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['existing-tree'] },
      '',
      `/artist/a1?view=links&addLink=${encodeURIComponent(spotifyUrl)}#social-links`,
    );
    let nextCanonicalUrl = window.location.href;

    // Simulate Next's patched History API: supplying its internal __NA state
    // bypasses router synchronization, while a normal state value updates the
    // canonical URL and preserves Next's state on the history entry.
    const nextReplaceState = jest.fn((data: unknown, unused: string, url?: string | URL | null) => {
      if ((data as { __NA?: boolean } | null)?.__NA) {
        nativeReplaceState(data, unused, url);
        return;
      }

      if (url) nextCanonicalUrl = new URL(String(url), window.location.href).href;
      nativeReplaceState(
        {
          ...(data && typeof data === 'object' ? data : {}),
          __NA: true,
          __PRIVATE_NEXTJS_INTERNALS_TREE: ['existing-tree'],
        },
        unused,
        url,
      );
    });
    window.history.replaceState = nextReplaceState as typeof window.history.replaceState;

    try {
      render(<AddArtistData {...baseProps} isOpenOnLoad prefillUrl={spotifyUrl} />);

      expect(screen.getByRole('heading', { name: /Suggest a link for Test Artist/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Paste a profile link/i)).toHaveValue(spotifyUrl);
      expect(addArtistDataAction).not.toHaveBeenCalled();

      await waitFor(() => {
        expect(nextReplaceState).toHaveBeenCalledWith(
          null,
          '',
          '/artist/a1?view=links#social-links',
        );
      });
      expect(new URL(nextCanonicalUrl).search).toBe('?view=links');
      expect(window.location.search).toBe('?view=links');
      expect(window.location.hash).toBe('#social-links');
      expect(window.history.state).toMatchObject({
        __NA: true,
        __PRIVATE_NEXTJS_INTERNALS_TREE: ['existing-tree'],
      });
    } finally {
      window.history.replaceState = originalReplaceState;
      nativeReplaceState({}, '', '/');
    }
  });

  it('resets a consumed prefill before a later manual open', async () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });
    const spotifyUrl = 'https://open.spotify.com/artist/2TNJWBi73MnkSRkZRPBqSW';

    render(<AddArtistData {...baseProps} isOpenOnLoad prefillUrl={spotifyUrl} />);
    expect(screen.getByPlaceholderText(/Paste a profile link/i)).toHaveValue(spotifyUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Suggest a link for Test Artist/i })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByPlaceholderText(/Paste a profile link/i)).toHaveValue('');
  });

  it('keeps submission disabled while supported-link validation is loading', () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });
    const originalFetch = global.fetch;
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    try {
      render(<AddArtistData {...baseProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Add a link for Test Artist' }));

      const submitButton = screen.getByRole('button', { name: 'Submit' });
      expect(submitButton).toBeDisabled();
      expect(submitButton).toHaveAttribute('aria-busy', 'true');
      fireEvent.click(submitButton);
      expect(addArtistDataAction).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('lets an unchanged server-validated prefill reach the server if regex loading fails', async () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });
    const spotifyUrl = 'https://open.spotify.com/artist/2TNJWBi73MnkSRkZRPBqSW';
    const originalFetch = global.fetch;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    (addArtistDataAction as jest.Mock).mockResolvedValue({ status: 'error', message: 'Server rejected link' });

    try {
      render(<AddArtistData {...baseProps} isOpenOnLoad prefillUrl={spotifyUrl} />);

      const submitButton = screen.getByRole('button', { name: 'Submit' });
      await waitFor(() => expect(submitButton).toBeEnabled());
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(addArtistDataAction).toHaveBeenCalledWith(spotifyUrl, baseProps.artist);
      });
    } finally {
      global.fetch = originalFetch;
      errorSpy.mockRestore();
    }
  });

  it('does not trust a modified prefill when regex loading fails', async () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });
    const spotifyUrl = 'https://open.spotify.com/artist/2TNJWBi73MnkSRkZRPBqSW';
    const originalFetch = global.fetch;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    try {
      render(<AddArtistData {...baseProps} isOpenOnLoad prefillUrl={spotifyUrl} />);

      const submitButton = screen.getByRole('button', { name: 'Submit' });
      await waitFor(() => expect(submitButton).toBeEnabled());
      fireEvent.change(screen.getByPlaceholderText(/Paste a profile link/i), {
        target: { value: 'https://open.spotify.com/artist/differentArtist' },
      });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(LINK_NOT_SUPPORTED)).toBeInTheDocument();
      });
      expect(addArtistDataAction).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      errorSpy.mockRestore();
    }
  });

  it('uses "Save Link" submit label for a claim owner using direct edit', () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });

    render(<AddArtistData {...baseProps} directEdit />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('heading', { name: /Add a link for Test Artist/i })).toBeInTheDocument();
    expect(screen.getByText(/saved directly to the artist profile/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Link' })).toBeInTheDocument();
  });

  it('uses immediate-addition copy for an auto-approved contribution', () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' });

    render(<AddArtistData {...baseProps} autoApprove />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('heading', { name: /Add a link for Test Artist/i })).toBeInTheDocument();
    expect(screen.getByText(/added immediately and recorded as your contribution/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Link' })).toBeInTheDocument();
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
      const submitButton = screen.getByRole('button', { name: 'Submit' });
      await waitFor(() => expect(submitButton).toBeEnabled());
      fireEvent.click(submitButton);

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
