/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import EditModeToggle from '@/app/_components/EditModeToggle';
import { EditModeContext } from '@/app/_components/EditModeContext';

describe('EditModeToggle', () => {
  function renderToggle(isEditing = false) {
    return render(
      <EditModeContext.Provider value={{ isEditing, toggle: jest.fn(), canEdit: true }}>
        <EditModeToggle />
      </EditModeContext.Provider>
    );
  }

  it('shows "Edit" when not editing', () => {
    renderToggle(false);
    expect(screen.getByText(/edit/i)).toBeInTheDocument();
  });

  it('shows "Done" when editing', () => {
    renderToggle(true);
    expect(screen.getByText(/done/i)).toBeInTheDocument();
  });

  it('calls toggle handler on click', () => {
    const toggle = jest.fn();
    render(
      <EditModeContext.Provider value={{ isEditing: false, toggle, canEdit: true }}>
        <EditModeToggle />
      </EditModeContext.Provider>
    );

    fireEvent.click(screen.getByRole('button'));
    expect(toggle).toHaveBeenCalled();
  });
}); 