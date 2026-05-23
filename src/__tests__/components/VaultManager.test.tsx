// @ts-nocheck
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VaultManager from '@/app/artist/[id]/_components/VaultManager';
import { EditModeContext } from '@/app/_components/EditModeContext';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock('@/app/actions/dashboardActions', () => ({
  updateSourceStatus: jest.fn().mockResolvedValue({ success: true }),
  updateSourceType: jest.fn().mockResolvedValue({ success: true }),
  searchWebForSources: jest.fn().mockResolvedValue({ success: true, count: 2 }),
  removeVaultSource: jest.fn().mockResolvedValue({ success: true }),
}));
import { updateSourceStatus, removeVaultSource } from '@/app/actions/dashboardActions';

const pending = [{ id: 'p1', artistId: 'a1', url: 'http://e/1', title: 'Pending One', status: 'pending' }];
const approved = [{ id: 'ap1', artistId: 'a1', url: 'http://e/2', title: 'Approved One', status: 'approved' }];

function renderEditing(isEditing = true) {
  return render(
    <EditModeContext.Provider value={{ isEditing, canEdit: true, toggle: jest.fn() }}>
      <VaultManager artistId="a1" pendingSources={pending} approvedSources={approved} />
    </EditModeContext.Provider>
  );
}

describe('VaultManager', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when not editing', () => {
    const { container } = renderEditing(false);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists pending sources and approves one', async () => {
    renderEditing(true);
    expect(screen.getByText('Pending One')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(updateSourceStatus).toHaveBeenCalledWith('p1', 'approved'));
  });

  it('upload happy path: uploaded file lands in Approved section, not Pending', async () => {
    const uploadedSource = {
      id: 'up1',
      artistId: 'a1',
      url: 'http://e/up',
      title: 'Uploaded One',
      status: 'approved',
    };

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, source: uploadedSource }),
    });

    const { container } = renderEditing(true);

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'up.pdf', { type: 'application/pdf' })] },
    });

    // The uploaded source should appear in the document (in Approved section)
    await screen.findByText('Uploaded One');

    // Confirm it is NOT in the Pending section
    const pendingHeading = screen.getByText(/pending review/i);
    expect(pendingHeading).toBeInTheDocument();
    // The pending section should still only show the original pending source
    expect(screen.getByText('Pending One')).toBeInTheDocument();

    // The Approved heading should be present (matches "Approved (2)")
    expect(screen.getByText(/^approved \(\d+\)$/i)).toBeInTheDocument();

    global.fetch = originalFetch;
  });

  it('delete removes a pending source', async () => {
    renderEditing(true);
    expect(screen.getByText('Pending One')).toBeInTheDocument();

    // The delete button has aria-label="Delete" added to SourceCard
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    // Click the first delete button (on the pending source card)
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => expect(removeVaultSource).toHaveBeenCalledWith('p1'));
  });
});
