// @ts-nocheck
import { render, screen, fireEvent } from '@testing-library/react';
import OnboardingGate, { skipFlagKey } from '../OnboardingGate';

jest.mock('../OnboardingChat', () => ({
    __esModule: true,
    default: ({ onSkip }) => <div data-testid="onboarding-chat"><button onClick={onSkip}>skip</button></div>,
}));

describe('OnboardingGate', () => {
    beforeEach(() => sessionStorage.clear());

    it('opens the chat takeover when there is no skip flag', () => {
        render(<OnboardingGate artistId="a1" artistName="Nova Reyes" currentStep="profiles" />);
        expect(screen.getByTestId('onboarding-chat')).toBeInTheDocument();
    });

    it('shows the banner instead when the session skip flag is set', () => {
        sessionStorage.setItem(skipFlagKey('a1'), '1');
        render(<OnboardingGate artistId="a1" artistName="Nova Reyes" currentStep="vault" />);
        expect(screen.queryByTestId('onboarding-chat')).not.toBeInTheDocument();
        expect(screen.getByText(/finish setting up/i)).toBeInTheDocument();
    });

    it('skipping sets the flag and swaps to the banner; banner CTA reopens the chat', () => {
        render(<OnboardingGate artistId="a1" artistName="Nova Reyes" currentStep="profiles" />);
        fireEvent.click(screen.getByText('skip'));
        expect(sessionStorage.getItem(skipFlagKey('a1'))).toBe('1');
        expect(screen.getByText(/finish setting up/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));
        expect(screen.getByTestId('onboarding-chat')).toBeInTheDocument();
    });

    it('banner copy frames the next step as the next win (never shame)', () => {
        sessionStorage.setItem(skipFlagKey('a1'), '1');
        render(<OnboardingGate artistId="a1" artistName="Nova Reyes" currentStep="interview" />);
        expect(screen.getByText(/tell us your story/i)).toBeInTheDocument();
    });
});
