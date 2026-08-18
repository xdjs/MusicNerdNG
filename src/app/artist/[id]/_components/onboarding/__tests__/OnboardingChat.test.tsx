// @ts-nocheck
// NOTE: intentionally NOT `import { jest } from '@jest/globals'` here — same
// reason as OnboardingGate.test.tsx / ClientWrapper.test.tsx: this repo's
// SWC-based next/jest transform only hoists `jest.mock()` above ES imports when
// `jest` is the ambient global; importing it from '@jest/globals' disables that
// hoisting and mocks silently never apply.
import { render, screen, fireEvent } from '@testing-library/react';

// JSDOM does not implement Element.scrollTo — OnboardingChat's auto-scroll-to-bottom
// effect calls it on every items change, so every render throws without this shim.
// This is a test-environment gap, not a production concern (real browsers implement it).
Element.prototype.scrollTo = jest.fn();

// ---- Mutable mock state (declared before jest.mock() factories that use them —
// identifiers prefixed with "mock" are the one exception Jest's hoisting allows
// a factory to close over; see ClientWrapper.test.tsx for the same pattern). ----
const mockRefresh = jest.fn();

// next/navigation is already globally mocked in jest.setup.ts, but that factory
// hands back a brand-new `refresh: jest.fn()` on every call, so a `refresh` grabbed
// via useRouter() in this file would never be the same function the component
// itself called. Override locally with a shared `mockRefresh` reference instead.
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: mockRefresh }),
    usePathname: () => '',
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('../useOnboardingChat', () => ({ useOnboardingChat: jest.fn() }));

import { useRouter } from 'next/navigation';
import { useOnboardingChat } from '../useOnboardingChat';
import OnboardingChat from '../OnboardingChat';

const mockUseOnboardingChat = useOnboardingChat;

function setChat({ items = [], busy = false, sendTurn = jest.fn() } = {}) {
    mockUseOnboardingChat.mockReturnValue({ items, busy, sendTurn });
    return sendTurn;
}

describe('OnboardingChat', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('dispatches exactly one open turn on mount, and re-rendering does not dispatch a second', () => {
        const sendTurn = setChat();
        const { rerender } = render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);
        expect(sendTurn).toHaveBeenCalledTimes(1);
        expect(sendTurn).toHaveBeenCalledWith({ type: 'open' });

        rerender(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);
        expect(sendTurn).toHaveBeenCalledTimes(1);
    });

    it('renders bot, user, progress (pending + done), and error items', () => {
        setChat({
            items: [
                { id: 'i1', kind: 'bot', text: 'Hey there' },
                { id: 'i2', kind: 'user', text: 'Sup' },
                { id: 'i3', kind: 'progress', text: 'Searching the web', done: false },
                { id: 'i4', kind: 'progress', text: 'Fetched profiles', done: true },
                { id: 'i5', kind: 'error', text: 'Something broke' },
            ],
        });
        render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);

        expect(screen.getByText('Hey there')).toBeInTheDocument();
        expect(screen.getByText('Sup')).toBeInTheDocument();
        expect(screen.getByText(/⚙ Searching the web/)).toBeInTheDocument();
        expect(screen.getByText(/✓ Fetched profiles/)).toBeInTheDocument();
        expect(screen.getByText('Something broke')).toBeInTheDocument();
    });

    it('only the newest step item is interactive — older profiles card disabled, newer interview enabled', () => {
        setChat({
            items: [
                {
                    id: 's1',
                    kind: 'step',
                    step: 'profiles',
                    payload: {
                        artistName: 'Nova Reyes',
                        links: [{ siteName: 'spotify', value: 'spot1' }],
                        enrichment: null,
                    },
                },
                {
                    id: 's2',
                    kind: 'step',
                    step: 'interview',
                    payload: { questionKey: 'offline_fact', question: 'Whats offline?', number: 1, total: 3 },
                },
            ],
        });
        render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);

        // Older step (profiles) is history — its confirm control is disabled.
        expect(screen.getByRole('button', { name: /looks good/i })).toBeDisabled();
        // Newer step (interview) is the live one — its controls are enabled.
        expect(screen.getByRole('button', { name: /skip this one/i })).not.toBeDisabled();
        expect(screen.getByPlaceholderText(/type your answer/i)).not.toBeDisabled();
    });

    it('busy disables the last interactive card', () => {
        setChat({
            busy: true,
            items: [
                { id: 's1', kind: 'step', step: 'interview', payload: { questionKey: 'k', question: 'Q?', number: 1, total: 1 } },
            ],
        });
        render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);
        expect(screen.getByRole('button', { name: /skip this one/i })).toBeDisabled();
        expect(screen.getByPlaceholderText(/type your answer/i)).toBeDisabled();
    });

    it('renders the complete state and "See my page" calls router.refresh and onFinish (NOT onSkip — no skip flag on a real finish)', () => {
        const onSkip = jest.fn();
        const onFinish = jest.fn();
        setChat({ items: [{ id: 'c1', kind: 'complete' }] });
        render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={onSkip} onFinish={onFinish} />);

        expect(screen.getByText(/you're live/i)).toBeInTheDocument();
        const router = useRouter();
        fireEvent.click(screen.getByRole('button', { name: /see my page/i }));
        expect(router.refresh).toHaveBeenCalledTimes(1);
        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(onSkip).not.toHaveBeenCalled();
    });

    it('renders a "Try again" button on the last error item when nothing newer follows it, and it resyncs via sendTurn({type:"open"})', () => {
        const sendTurn = setChat({
            items: [{ id: 'e1', kind: 'error', text: 'Something broke' }],
        });
        render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} onFinish={jest.fn()} />);

        // Mount already dispatched one {type:'open'} turn — assert the count before
        // and after the click so the assertion can't pass on the mount call alone.
        expect(sendTurn).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(sendTurn).toHaveBeenCalledTimes(2);
        expect(sendTurn).toHaveBeenNthCalledWith(2, { type: 'open' });
    });

    it('does NOT render "Try again" when a newer interactive step already followed the error', () => {
        setChat({
            items: [
                { id: 'e1', kind: 'error', text: 'Something broke' },
                { id: 's1', kind: 'step', step: 'interview', payload: { questionKey: 'k', question: 'Q?', number: 1, total: 1 } },
            ],
        });
        render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} onFinish={jest.fn()} />);

        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('renders a draft item and publish calls sendTurn with the exact doc + about', () => {
        const sendTurn = setChat({
            items: [{ id: 'd1', kind: 'draft', doc: '## Overview', about: 'An About.' }],
        });
        render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);

        expect(screen.getByText('An About.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /publish/i }));
        expect(sendTurn).toHaveBeenCalledWith({ type: 'publish', doc: '## Overview', about: 'An About.' });
    });
});
