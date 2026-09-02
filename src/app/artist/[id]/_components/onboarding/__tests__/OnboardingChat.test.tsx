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
        // In-flight work is marked by the Music Nerd mark breathing, not a gear glyph
        expect(screen.getByRole('status', { name: 'Searching the web' })).toBeInTheDocument();
        expect(screen.getByText('Searching the web')).toBeInTheDocument();
        expect(screen.getByText('Fetched profiles')).toBeInTheDocument();
        expect(screen.getByText('✓')).toBeInTheDocument();
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

        // The build surface replaced the chat's "You're live!" card — the flow
        // asks nothing now, so the finish lives on the build status. What this
        // test is about is the BEHAVIOUR of "See my page", which is unchanged.
        expect(screen.getByText(/your page is ready/i)).toBeInTheDocument();
        const router = useRouter();
        fireEvent.click(screen.getByRole('button', { name: /see my page/i }));
        expect(router.refresh).toHaveBeenCalledTimes(1);
        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(onSkip).not.toHaveBeenCalled();
    });

    // Publishing ends with a page the artist has never seen — the takeover covered it
    // the whole time. Leaving them at whatever offset the body happened to hold drops
    // them into the middle of their own profile.
    it('"See my page" returns the artist to the top of their page', () => {
        const scrollTo = jest.fn();
        window.scrollTo = scrollTo;
        setChat({ items: [{ id: 'c1', kind: 'complete' }] });
        render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} onFinish={jest.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /see my page/i }));
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
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

    // The document is read and corrected one card earlier (stage "doc", DocReviewCard).
    // Re-printing it under the publish button repeats a step the artist already took,
    // with copy asking them to flag errors they now have no editor to fix.
    it('does not re-show the knowledge document beneath the About', () => {
        setChat({
            items: [{ id: 'd1', kind: 'draft', doc: '## Overview\nBorn in Richmond.', about: 'An About.' }],
        });
        render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);

        expect(screen.getByText('An About.')).toBeInTheDocument();
        expect(screen.queryByTestId('knowledge-doc-card')).not.toBeInTheDocument();
        expect(screen.queryByText(/Born in Richmond/)).not.toBeInTheDocument();
    });

    // ---- Three-way scroll-anchoring rule (see the comment above the effect
    // in OnboardingChat.tsx): every items-change takes exactly one of
    // (1) force-scroll on action-requiring items, (2) auto-scroll when near
    // bottom, or (3) show the "New messages" pill. JSDOM has no real layout,
    // so these tests simulate scroll position via defineProperty on the
    // scroll container's scrollHeight/clientHeight/scrollTop, mirroring how
    // the bug was originally diagnosed with real DOM measurements.
    describe('scroll anchoring', () => {
        function scrollFarFromBottom(container) {
            Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
            Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
            Object.defineProperty(container, 'scrollTop', { value: 100, configurable: true, writable: true });
            fireEvent.scroll(container);
        }

        it('branch 3: shows the "New messages" pill for non-action items while scrolled away from the bottom, and clicking it dismisses the pill', () => {
            // A step card puts the component on the CHAT surface. Scroll anchoring
            // is a property of that surface only: the build view is a compact
            // status card with nothing to scroll.
            setChat({ items: [{ id: 's0', kind: 'step', step: 'profiles', payload: { artistName: 'Nova Reyes', links: [] } }, { id: 'b1', kind: 'bot', text: 'Hi' }] });
            const { rerender } = render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);
            const scrollEl = screen.getByTestId('onboarding-scroll');
            scrollFarFromBottom(scrollEl);
            // The initial mount also auto-scrolled once (default "near bottom"
            // before we simulated being scrolled away) — clear that call so the
            // assertions below are about THIS update only.
            Element.prototype.scrollTo.mockClear();

            expect(screen.queryByText('↓ New messages')).not.toBeInTheDocument();

            setChat({ items: [
                { id: 's0', kind: 'step', step: 'profiles', payload: { artistName: 'Nova Reyes', links: [] } },
                { id: 'b1', kind: 'bot', text: 'Hi' },
                { id: 'b2', kind: 'bot', text: 'Still working on it' },
            ] });
            rerender(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);

            expect(screen.getByText('↓ New messages')).toBeInTheDocument();
            // Branch 3 must not scroll — that's the whole point of the pill.
            expect(Element.prototype.scrollTo).not.toHaveBeenCalled();
            // Clicking scrolls to the first unseen item and dismisses the pill.
            // JSDOM has no layout (every rect is 0), so we can't assert *which*
            // item it scrolled to — only that the scroll-to-target call fired.
            fireEvent.click(screen.getByText('↓ New messages'));
            expect(Element.prototype.scrollTo).toHaveBeenCalled();
            expect(screen.queryByText('↓ New messages')).not.toBeInTheDocument();
        });

        it('branch 1: force-scrolls (no pill) when a draft arrives even while scrolled away from the bottom', () => {
            // A step card puts the component on the CHAT surface. Scroll anchoring
            // is a property of that surface only: the build view is a compact
            // status card with nothing to scroll.
            setChat({ items: [{ id: 's0', kind: 'step', step: 'profiles', payload: { artistName: 'Nova Reyes', links: [] } }, { id: 'b1', kind: 'bot', text: 'Hi' }] });
            const { rerender } = render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);
            const scrollEl = screen.getByTestId('onboarding-scroll');
            scrollFarFromBottom(scrollEl);

            setChat({ items: [
                { id: 's0', kind: 'step', step: 'profiles', payload: { artistName: 'Nova Reyes', links: [] } },
                { id: 'b1', kind: 'bot', text: 'Hi' },
                { id: 'd1', kind: 'draft', doc: '## Overview', about: 'An About.' },
            ] });
            rerender(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);

            // Action-requiring content (the draft) must always anchor-scroll,
            // regardless of "near bottom" — so no pill, ever.
            expect(screen.queryByText('↓ New messages')).not.toBeInTheDocument();
            expect(screen.getByText('An About.')).toBeInTheDocument();
        });

        it('branch 2: auto-scrolls non-action items (no pill) when the user was already near the bottom', () => {
            setChat({ items: [{ id: 'b1', kind: 'bot', text: 'Hi' }] });
            const { rerender } = render(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);
            // wasNearBottomRef defaults to true — no scroll event needed.

            setChat({ items: [
                { id: 'b1', kind: 'bot', text: 'Hi' },
                { id: 'b2', kind: 'bot', text: 'More' },
            ] });
            rerender(<OnboardingChat artistId="a1" artistName="Nova Reyes" onSkip={jest.fn()} />);

            expect(screen.queryByText('↓ New messages')).not.toBeInTheDocument();
        });
    });
});
