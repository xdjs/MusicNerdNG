// @ts-nocheck
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VaultManager from '@/app/artist/[id]/_components/VaultManager';
import { EditModeContext } from '@/app/_components/EditModeContext';

jest.mock('@/app/actions/dashboardActions', () => ({
  updateSourceStatus: jest.fn().mockResolvedValue({ success: true }),
  updateSourceType: jest.fn().mockResolvedValue({ success: true }),
  searchWebForSources: jest.fn().mockResolvedValue({ success: true, count: 2 }),
  removeVaultSource: jest.fn().mockResolvedValue({ success: true }),
}));
import { updateSourceStatus } from '@/app/actions/dashboardActions';

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
});
