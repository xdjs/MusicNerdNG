/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BioVersionHistory from '@/app/artist/[id]/_components/BioVersionHistory';
import { EditModeContext } from '@/app/_components/EditModeContext';

jest.mock('@/app/actions/dashboardActions', () => ({
  getArtistBioVersions: jest.fn().mockResolvedValue({
    success: true,
    versions: [
      { id: 'v1', artistId: 'a1', bioText: 'First bio', isPinned: true, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'v2', artistId: 'a1', bioText: 'Second bio', isPinned: false, createdAt: '2026-02-01T00:00:00Z' },
    ],
  }),
  pinBioVersionAction: jest.fn().mockResolvedValue({ success: true }),
  deleteBioVersionAction: jest.fn().mockResolvedValue({ success: true }),
}));
import { pinBioVersionAction, deleteBioVersionAction } from '@/app/actions/dashboardActions';

function renderEditing(isEditing = true) {
  return render(
    <EditModeContext.Provider value={{ isEditing, canEdit: true, toggle: jest.fn() }}>
      <BioVersionHistory artistId="a1" />
    </EditModeContext.Provider>
  );
}

describe('BioVersionHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when not editing', () => {
    const { container } = renderEditing(false);
    expect(container).toBeEmptyDOMElement();
  });

  it('loads versions and pins one with the artistId', async () => {
    renderEditing(true);
    // history is behind a toggle; open it
    fireEvent.click(screen.getByText(/version history/i));
    await waitFor(() => expect(screen.getByText('Second bio')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /pin/i })[0]);
    await waitFor(() => expect(pinBioVersionAction).toHaveBeenCalledWith('v2', 'a1'));
  });

  it('deletes a version with the artistId (after confirmation)', async () => {
    renderEditing(true);
    fireEvent.click(screen.getByText(/version history/i));
    await waitFor(() => expect(screen.getByText('Second bio')).toBeInTheDocument());
    // versions render newest-first: v2 (Feb, unpinned) is index 0; v1 (Jan, pinned) is index 1
    // the pinned version's Delete button is disabled, so index 0 is the enabled one
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    // delete is a two-step confirm — nothing deleted until "Confirm" is clicked
    expect(deleteBioVersionAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(deleteBioVersionAction).toHaveBeenCalledWith('v2', 'a1'));
  });
});
