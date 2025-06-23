/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
// Mock next/navigation router before component import
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import EditablePlatformLink from '@/app/_components/EditablePlatformLink';
import { EditModeContext } from '@/app/_components/EditModeContext';

const linkProps = {
  link: 'https://spotify.com',
  descriptor: 'Spotify',
  image: '/spotify.svg',
  siteName: 'spotify',
  artistId: 'artist-123',
};

describe('EditablePlatformLink', () => {
  beforeEach(() => {
    (global.fetch as any) = jest.fn().mockResolvedValue({ ok: true });
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not show trash icon when not in edit mode', () => {
    render(
      <EditModeContext.Provider value={{ isEditing: false, toggle: jest.fn(), canEdit: true }}>
        <EditablePlatformLink {...linkProps} />
      </EditModeContext.Provider>
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows trash icon and calls API on click', async () => {
    render(
      <EditModeContext.Provider value={{ isEditing: true, toggle: jest.fn(), canEdit: true }}>
        <EditablePlatformLink {...linkProps} />
      </EditModeContext.Provider>
    );

    const trashBtn = screen.getByRole('button');
    fireEvent.click(trashBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/removeArtistData', expect.any(Object));
    });
  });
}); 