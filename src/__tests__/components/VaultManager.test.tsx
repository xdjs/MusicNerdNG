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
  removeVaultSources: jest.fn().mockResolvedValue({ success: true, count: 1 }),
  addVaultSource: jest.fn().mockResolvedValue({ success: true }),
}));
import { updateSourceStatus, removeVaultSource, removeVaultSources, addVaultSource, searchWebForSources } from '@/app/actions/dashboardActions';

const pending = [{ id: 'p1', artistId: 'a1', url: 'http://e/1', title: 'Pending One', status: 'pending' }];
const approved = [{ id: 'ap1', artistId: 'a1', url: 'http://e/2', title: 'Approved One', status: 'approved' }];

function renderEditing(isEditing = true, approvedSources = approved) {
  return render(
    <EditModeContext.Provider value={{ isEditing, canEdit: true, toggle: jest.fn() }}>
      <VaultManager artistId="a1" pendingSources={pending} approvedSources={approvedSources} />
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

  it('web search: found sources appear in Pending immediately, no refresh prompt', async () => {
    searchWebForSources.mockResolvedValueOnce({
      success: true,
      count: 1,
      sources: [{ id: 'ws1', artistId: 'a1', url: 'http://found/1', title: 'Found Source', status: 'pending' }],
    });
    renderEditing(true);
    fireEvent.click(screen.getByRole('button', { name: /search web for sources/i }));
    // The found source appears without any manual page refresh...
    await waitFor(() => expect(screen.getByText('Found Source')).toBeInTheDocument());
    // ...and the user is never told to refresh.
    expect(screen.queryByText(/refresh to review/i)).not.toBeInTheDocument();
  });

  it('add-by-URL: typing a URL and clicking Add calls addVaultSource', async () => {
    renderEditing(true);

    const input = screen.getByPlaceholderText(/add a source by url/i);
    fireEvent.change(input, { target: { value: 'https://pitchfork.com/x' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(addVaultSource).toHaveBeenCalledWith('a1', 'https://pitchfork.com/x'));
  });

  it('bulk delete: selecting an approved source and deleting calls removeVaultSources', async () => {
    renderEditing(true);

    // Select-all checkbox is the first checkbox; the per-card checkbox is the source's.
    const checkboxes = screen.getAllByRole('checkbox');
    // Last checkbox is the approved source card's select checkbox.
    fireEvent.click(checkboxes[checkboxes.length - 1]);

    fireEvent.click(screen.getByRole('button', { name: /delete 1 selected/i }));

    await waitFor(() => expect(removeVaultSources).toHaveBeenCalledWith(['ap1']));
  });

  it('type filter: clicking a type chip hides non-matching approved sources', () => {
    const approvedTyped = [
      { id: 'ap1', artistId: 'a1', url: 'http://e/2', title: 'Article Source', status: 'approved', type: 'article' },
      { id: 'ap2', artistId: 'a1', url: 'http://e/3', title: 'Review Source', status: 'approved', type: 'review' },
    ];
    renderEditing(true, approvedTyped);

    expect(screen.getByText('Article Source')).toBeInTheDocument();
    expect(screen.getByText('Review Source')).toBeInTheDocument();

    // Click the "review" chip (chips render as "review (1)").
    fireEvent.click(screen.getByRole('button', { name: /^review \(\d+\)$/i }));

    expect(screen.getByText('Review Source')).toBeInTheDocument();
    expect(screen.queryByText('Article Source')).not.toBeInTheDocument();
  });
});
