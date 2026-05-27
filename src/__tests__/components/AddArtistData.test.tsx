/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import AddArtistData from '@/app/artist/[id]/_components/AddArtistData';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
import { useSession } from 'next-auth/react';

const baseProps = {
  // Partial artist fixture is sufficient for exercising the trigger.
  artist: { id: 'a1', name: 'Test Artist' } as any,
  spotifyImg: '',
  availableLinks: [],
  isOpenOnLoad: false,
};

describe('AddArtistData "+" trigger', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prompts login (clicks #login-btn) and does not open the modal when logged out', () => {
    (useSession as jest.Mock).mockReturnValue({ data: null });
    const loginClick = jest.fn();
    const getByIdSpy = jest
      .spyOn(document, 'getElementById')
      .mockReturnValue({ click: loginClick } as unknown as HTMLElement);

    render(<AddArtistData {...baseProps} />);
    fireEvent.click(screen.getByRole('button')); // only the trigger renders while the dialog is closed

    expect(getByIdSpy).toHaveBeenCalledWith('login-btn');
    expect(loginClick).toHaveBeenCalledTimes(1);
    // submit-modal content (the "Add Artist Data" button label) should NOT be present
    expect(screen.queryByText('Add Artist Data')).not.toBeInTheDocument();

    getByIdSpy.mockRestore();
  });

  it('opens the submit modal when logged in', () => {
    (useSession as jest.Mock).mockReturnValue({ data: { user: { id: 'u1' } } });

    render(<AddArtistData {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Add Artist Data')).toBeInTheDocument();
  });
});
