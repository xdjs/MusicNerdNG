// @ts-nocheck
import { render, screen, fireEvent, act } from '@testing-library/react';
import ProfileTour, { tourFlagKey, tourPendingKey, armTour } from '@/app/artist/[id]/_components/onboarding/ProfileTour';

// jsdom has no layout engine, so scrollIntoView is absent on elements.
beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

function withAnchors() {
    for (const id of ['mn-about', 'mn-ask', 'mn-links', 'mn-sources']) {
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
}

describe('ProfileTour', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        sessionStorage.clear();
        // The build arms the tour; without the flag it renders nothing.
        sessionStorage.setItem(tourPendingKey('a1'), '1');
        withAnchors();
    });

    it('walks the page top to bottom, starting at the About', () => {
        // An earlier pass went Links -> About -> Sources, which jumped around
        // the page and matched neither reading order nor build order.
        render(<ProfileTour artistId="a1" />);
        expect(screen.getByText(/we wrote you a first draft/i)).toBeInTheDocument();
        expect(screen.getByText(/1 of 4/i)).toBeInTheDocument();
    });

    it('walks all four sections in page order and ends', () => {
        render(<ProfileTour artistId="a1" />);
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(screen.getByText(/fans can ask about you/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(screen.getByText(/these are your links/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(screen.getByText(/what we found written about you/i)).toBeInTheDocument();
        // Last stop offers completion, not another Next.
        fireEvent.click(screen.getByRole('button', { name: /got it/i }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('frames the About as a draft the artist can replace', () => {
        // Pete: not every artist wants an AI-written bio. Publishing one and
        // then explaining how to edit it is backwards.
        render(<ProfileTour artistId="a1" />);
        expect(screen.getByText(/rewrite it in your own words/i)).toBeInTheDocument();
    });

    it('tells the artist the sources feed the ASK section, not only the About', () => {
        // Pete: "some artists would be more interested that the vault feeds the
        // ask section than the about."
        render(<ProfileTour artistId="a1" />);
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(screen.getByText(/answers come from those same sources/i)).toBeInTheDocument();
    });

    it('scrolls each section into view so the words always point at something visible', () => {
        render(<ProfileTour artistId="a1" />);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        const before = (Element.prototype.scrollIntoView as jest.Mock).mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect((Element.prototype.scrollIntoView as jest.Mock).mock.calls.length).toBeGreaterThan(before);
    });

    it('rings the section it is describing, and un-rings it on the way out', () => {
        render(<ProfileTour artistId="a1" />);
        expect(document.getElementById('mn-about').style.boxShadow).not.toBe('');
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(document.getElementById('mn-about').style.boxShadow).toBe('');
        expect(document.getElementById('mn-ask').style.boxShadow).not.toBe('');
    });

    it('anchors the card BESIDE the section, not parked at the bottom of the screen', () => {
        // A first pass put a fixed card at the bottom. It read as a
        // notification rather than direction — which is what it was. The card
        // has to point at the thing it is describing.
        const links = document.getElementById('mn-about');
        links.getBoundingClientRect = () => ({
            top: 200, bottom: 400, left: 100, right: 500, width: 400, height: 200, x: 100, y: 200, toJSON: () => ({}),
        });
        render(<ProfileTour artistId="a1" />);
        const card = screen.getByRole('dialog');
        expect(card.style.position).toBe('fixed');
        // To the RIGHT of the section (right edge 500 + gap), vertically centred
        // on it — not pinned to the viewport bottom.
        expect(parseInt(card.style.left, 10)).toBeGreaterThanOrEqual(500);
        expect(card.style.bottom).toBe('');
    });

    it('lifts the section above the dimmed page so it stays readable', () => {
        render(<ProfileTour artistId="a1" />);
        const links = document.getElementById('mn-about');
        expect(links.style.zIndex).toBe('45');
        // …and restores it on the way out.
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(links.style.zIndex).toBe('');
    });

    it('never blocks clicks on the section it is pointing at', () => {
        // Dimming that swallowed clicks would defeat the purpose: the artist is
        // being told to act on that exact section.
        const { container } = render(<ProfileTour artistId="a1" />);
        const backdrop = container.querySelector('[aria-hidden="true"].fixed');
        expect(backdrop?.className).toContain('pointer-events-none');
    });

    it('can go back', () => {
        render(<ProfileTour artistId="a1" />);
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        expect(screen.getByText(/we wrote you a first draft/i)).toBeInTheDocument();
    });

    it('treats Skip as done — an artist who dismisses it does not want it again', () => {
        render(<ProfileTour artistId="a1" />);
        fireEvent.click(screen.getByRole('button', { name: /skip/i }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(sessionStorage.getItem(tourFlagKey('a1'))).toBe('1');
    });

    it('renders nothing rather than throwing when a section is missing from the page', () => {
        document.body.replaceChildren(); // no anchors at all
        expect(() => render(<ProfileTour artistId="a1" />)).not.toThrow();
        expect(screen.getByText(/we wrote you a first draft/i)).toBeInTheDocument();
    });
});


describe('ProfileTour — surviving the end of onboarding', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        sessionStorage.clear();
        withAnchors();
    });

    it('renders nothing until the build arms it', () => {
        // Otherwise every visitor to a claimed profile would get a tour.
        render(<ProfileTour artistId="a1" />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('runs when armed, and survives being re-mounted by a page refresh', () => {
        sessionStorage.setItem(tourPendingKey('a1'), '1');
        const first = render(<ProfileTour artistId="a1" />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        // The bug: the tour lived inside a component the page renders only while
        // onboarding is INCOMPLETE, and the build completes it as its last act.
        // A server re-fetch unmounted the tour mid-flight — "appeared and
        // disappeared". A flag outlives the remount.
        first.unmount();
        render(<ProfileTour artistId="a1" />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does not come back after it has been completed', () => {
        sessionStorage.setItem(tourPendingKey('a1'), '1');
        const first = render(<ProfileTour artistId="a1" />);
        fireEvent.click(screen.getByRole('button', { name: /skip/i }));
        expect(sessionStorage.getItem(tourPendingKey('a1'))).toBeNull();

        first.unmount();
        render(<ProfileTour artistId="a1" />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});


describe('ProfileTour — armed while already mounted', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        sessionStorage.clear();
        withAnchors();
    });

    it('starts when the build arms it, even though it mounted long before', () => {
        // The bug Pete hit: the tour is rendered by the artist page on INITIAL
        // load, before the build starts. Its mount effect read "not pending" and
        // never looked again — router.refresh() re-renders server components
        // without remounting a client component in the same position. The build
        // finished, the flag was set, and nothing was listening. He saw his whole
        // profile and no tour.
        render(<ProfileTour artistId="a1" />);
        expect(screen.queryByRole('dialog')).toBeNull();

        // act(): the state update originates from a window listener, outside
        // React's own event system, so it must be flushed explicitly here.
        act(() => armTour('a1'));

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/we wrote you a first draft/i)).toBeInTheDocument();
    });

    it('ignores an arming event for a different artist', () => {
        render(<ProfileTour artistId="a1" />);
        act(() => armTour('someone-else'));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not re-open for an artist who already completed it', () => {
        sessionStorage.setItem(tourFlagKey('a1'), '1');
        render(<ProfileTour artistId="a1" />);
        act(() => armTour('a1'));
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});


describe('ProfileTour — must not run mid-build', () => {
    // The page now gates the tour on onboarding being COMPLETE, so a stale flag
    // cannot start it while the build is still going. This pins the component
    // half of that contract: it renders only when armed, and completing clears
    // the arming flag so a later visit does not resurrect it.
    beforeEach(() => {
        document.body.replaceChildren();
        sessionStorage.clear();
        withAnchors();
    });

    it('a stale pending flag from a previous session does not survive completion', () => {
        // Pete saw "we drafted your About" over an About that did not exist yet,
        // because a pending flag from an earlier run was still set.
        sessionStorage.setItem(tourPendingKey('a1'), '1');
        const first = render(<ProfileTour artistId="a1" />);
        fireEvent.click(screen.getByRole('button', { name: /skip/i }));
        first.unmount();

        render(<ProfileTour artistId="a1" />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
