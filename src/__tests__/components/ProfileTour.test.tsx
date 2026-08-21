// @ts-nocheck
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileTour, { tourFlagKey, tourPendingKey } from '@/app/artist/[id]/_components/onboarding/ProfileTour';

// jsdom has no layout engine, so scrollIntoView is absent on elements.
beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

function withAnchors() {
    for (const id of ['mn-links', 'mn-about', 'mn-sources']) {
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

    it('opens on the links section, because that is what the build changed most visibly', () => {
        render(<ProfileTour artistId="a1" />);
        expect(screen.getByText(/these are your links/i)).toBeInTheDocument();
        expect(screen.getByText(/1 of 3/i)).toBeInTheDocument();
    });

    it('walks all three sections and ends', () => {
        render(<ProfileTour artistId="a1" />);
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(screen.getByText(/this is your about/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(screen.getByText(/what we found written about you/i)).toBeInTheDocument();
        // Last stop offers completion, not another Next.
        fireEvent.click(screen.getByRole('button', { name: /got it/i }));
        expect(screen.queryByRole('dialog')).toBeNull();
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
        expect(document.getElementById('mn-links').style.boxShadow).not.toBe('');
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(document.getElementById('mn-links').style.boxShadow).toBe('');
        expect(document.getElementById('mn-about').style.boxShadow).not.toBe('');
    });

    it('anchors the card BESIDE the section, not parked at the bottom of the screen', () => {
        // A first pass put a fixed card at the bottom. It read as a
        // notification rather than direction — which is what it was. The card
        // has to point at the thing it is describing.
        const links = document.getElementById('mn-links');
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
        const links = document.getElementById('mn-links');
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
        expect(screen.getByText(/these are your links/i)).toBeInTheDocument();
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
        expect(screen.getByText(/these are your links/i)).toBeInTheDocument();
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
