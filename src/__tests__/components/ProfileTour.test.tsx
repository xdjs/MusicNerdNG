// @ts-nocheck
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileTour, { tourFlagKey } from '@/app/artist/[id]/_components/onboarding/ProfileTour';

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
