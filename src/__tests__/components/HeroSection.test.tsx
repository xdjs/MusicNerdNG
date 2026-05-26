/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import HeroSection from '@/app/artist/[id]/_components/HeroSection';
import { EditModeContext } from '@/app/_components/EditModeContext';

function renderWith(isEditing: boolean) {
  return render(
    <EditModeContext.Provider value={{ isEditing, canEdit: true, toggle: jest.fn() }}>
      <HeroSection imageUrl="/x.png" artistName="Test" artistId="a1" />
    </EditModeContext.Provider>
  );
}

describe('HeroSection image upload overlay', () => {
  it('shows the change-photo control in edit mode', () => {
    renderWith(true);
    expect(screen.getByLabelText(/change photo/i)).toBeInTheDocument();
  });

  it('hides the control when not editing', () => {
    renderWith(false);
    expect(screen.queryByLabelText(/change photo/i)).not.toBeInTheDocument();
  });
});
