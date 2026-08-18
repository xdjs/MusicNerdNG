// @ts-nocheck
// NOTE: intentionally NOT `import { jest } from '@jest/globals'` here. This repo's
// SWC-based next/jest transform only hoists `jest.mock()` above ES `import`
// statements when `jest` is the ambient global — importing `jest` from
// '@jest/globals' disables that hoisting. See `OnboardingGate.test.tsx` for the
// full explanation and the same working pattern.
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfilesCard, VaultCard, InterviewInput, AboutDraftCard } from '../StepCards';

describe('ProfilesCard — accepted-by-default', () => {
    const payload = {
        artistName: 'Nova Reyes',
        links: [{ siteName: 'spotify', value: 'spot1' }, { siteName: 'instagram', value: 'nova' }],
        enrichment: { platform: 'deezer', followerCount: 128000, imageUrl: null },
    };

    it('renders every link pre-accepted and submits only removals + additions', () => {
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={payload} onConfirm={onConfirm} disabled={false} />);
        // Remove instagram, then confirm
        fireEvent.click(screen.getByLabelText(/remove instagram/i));
        fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
        expect(onConfirm).toHaveBeenCalledWith({ addedLinks: [], removedSiteNames: ['instagram'] });
    });

    it('collects pasted links as additions', () => {
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={payload} onConfirm={onConfirm} disabled={false} />);
        fireEvent.change(screen.getByPlaceholderText(/paste a link/i), { target: { value: 'https://tiktok.com/@nova' } });
        fireEvent.click(screen.getByRole('button', { name: /add/i }));
        fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
        expect(onConfirm).toHaveBeenCalledWith({
            addedLinks: [{ url: 'https://tiktok.com/@nova' }],
            removedSiteNames: [],
        });
    });

    it('renders a platform logo and a clickable profile link when logoUrl/profileUrl are present', () => {
        const richPayload = {
            artistName: 'Nova Reyes',
            links: [{
                siteName: 'instagram',
                value: 'nova',
                displayName: 'Instagram',
                logoUrl: 'https://utfs.io/f/instagram-logo.png',
                colorHex: '#E1306C',
                profileUrl: 'https://instagram.com/nova',
            }],
            enrichment: null,
        };
        const onConfirm = jest.fn();
        // `<img alt="">` has an implicit ARIA role of "presentation", so it's
        // deliberately excluded from getByRole('img') — query the DOM directly.
        const { container } = render(<ProfilesCard payload={richPayload} onConfirm={onConfirm} disabled={false} />);
        const img = container.querySelector('img');
        expect(img).toHaveAttribute('src', 'https://utfs.io/f/instagram-logo.png');
        expect(img).toHaveAttribute('alt', '');
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', 'https://instagram.com/nova');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link.getAttribute('rel')).toEqual(expect.stringContaining('noopener'));
    });

    it('does not render an opaque platform ID (e.g. a raw Spotify ID) as visible text', () => {
        const opaquePayload = {
            artistName: 'Nova Reyes',
            links: [{ siteName: 'spotify', value: '3DmaZbBPnKSGnxYRpHobss', displayName: 'Spotify' }],
            enrichment: null,
        };
        render(<ProfilesCard payload={opaquePayload} onConfirm={jest.fn()} disabled={false} />);
        expect(screen.getByText('Spotify')).toBeInTheDocument();
        expect(screen.queryByText('3DmaZbBPnKSGnxYRpHobss')).not.toBeInTheDocument();
    });

    it('does not render a purely numeric ID (e.g. a Deezer artist ID) as visible text, even when short', () => {
        const numericPayload = {
            artistName: 'Nova Reyes',
            links: [{ siteName: 'deezer', value: '4050205', displayName: 'Deezer' }],
            enrichment: null,
        };
        render(<ProfilesCard payload={numericPayload} onConfirm={jest.fn()} disabled={false} />);
        expect(screen.getByText('Deezer')).toBeInTheDocument();
        expect(screen.queryByText('4050205')).not.toBeInTheDocument();
    });

    it('shows a friendly empty state and a Continue button when there are no links, and still submits empty arrays', () => {
        const emptyPayload = { artistName: 'Nova Reyes', links: [], enrichment: null };
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={emptyPayload} onConfirm={onConfirm} disabled={false} />);
        expect(screen.getByText(/no profiles linked yet/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
        expect(onConfirm).toHaveBeenCalledWith({ addedLinks: [], removedSiteNames: [] });
    });

    it('renders the real artist photo as the leading avatar when previewImage is present, with the platform logo as a corner badge', () => {
        const payload = {
            artistName: 'Nova Reyes',
            links: [{
                siteName: 'spotify',
                value: 'spot1',
                displayName: 'Spotify',
                logoUrl: 'https://utfs.io/f/spotify-logo.png',
                colorHex: '#1DB954',
                profileUrl: 'https://open.spotify.com/artist/spot1',
                previewImage: 'https://i.scdn.co/image/spot1.jpg',
            }],
            enrichment: null,
        };
        const { container } = render(<ProfilesCard payload={payload} onConfirm={jest.fn()} disabled={false} />);
        const avatar = container.querySelector('img[src="https://i.scdn.co/image/spot1.jpg"]');
        expect(avatar).toBeInTheDocument();
        expect(avatar).toHaveAttribute('alt', '');
        expect(avatar).toHaveAttribute('referrerPolicy', 'no-referrer');
        // Platform logo still renders too — as the corner badge overlapping the avatar.
        const badge = container.querySelector('img[src="https://utfs.io/f/spotify-logo.png"]');
        expect(badge).toBeInTheDocument();
    });

    it('falls back to the plain logo tile (no previewImage) when the card has no preview image at all', () => {
        const payload = {
            artistName: 'Nova Reyes',
            links: [{
                siteName: 'instagram',
                value: 'nova',
                displayName: 'Instagram',
                logoUrl: 'https://utfs.io/f/instagram-logo.png',
                profileUrl: 'https://instagram.com/nova',
                previewImage: null,
            }],
            enrichment: null,
        };
        const { container } = render(<ProfilesCard payload={payload} onConfirm={jest.fn()} disabled={false} />);
        // Exactly one img (the logo tile) — no separate avatar image was attempted.
        expect(container.querySelectorAll('img').length).toBe(1);
        expect(container.querySelector('img')).toHaveAttribute('src', 'https://utfs.io/f/instagram-logo.png');
    });

    // Fix 3: a long list of links must not push the "Looks good, continue"
    // button out of reach — the list itself scrolls, not the whole card.
    it('constrains the link list to a scrollable region when there are more than 6 links', () => {
        const manyLinksPayload = {
            artistName: 'Nova Reyes',
            links: Array.from({ length: 7 }, (_, i) => ({ siteName: `site${i}`, value: `v${i}` })),
            enrichment: null,
        };
        const { getByTestId } = render(<ProfilesCard payload={manyLinksPayload} onConfirm={jest.fn()} disabled={false} />);
        const list = getByTestId('profiles-link-list');
        expect(list.className).toEqual(expect.stringContaining('overflow-y-auto'));
        expect(list.className).toEqual(expect.stringContaining('max-h-'));
        // The paste-a-link input and confirm button stay reachable outside the capped region.
        expect(screen.getByPlaceholderText(/paste a link/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /looks good/i })).toBeInTheDocument();
    });

    it('does NOT constrain the link list when there are 6 or fewer links', () => {
        const fewLinksPayload = {
            artistName: 'Nova Reyes',
            links: Array.from({ length: 6 }, (_, i) => ({ siteName: `site${i}`, value: `v${i}` })),
            enrichment: null,
        };
        const { getByTestId } = render(<ProfilesCard payload={fewLinksPayload} onConfirm={jest.fn()} disabled={false} />);
        const list = getByTestId('profiles-link-list');
        expect(list.className).not.toEqual(expect.stringContaining('overflow-y-auto'));
        expect(list.className).not.toEqual(expect.stringContaining('max-h-'));
    });
});

describe('VaultCard — keep-by-default', () => {
    const payload = {
        sources: [
            { id: 's1', title: 'Pitchfork review', url: 'https://p4k.example/x', snippet: 'bedroom auteur' },
            { id: 's2', title: 'Fan wiki', url: 'https://wiki.example/y', snippet: null },
        ],
    };

    it('submits kept sources as approved and skipped ones as rejected', () => {
        const onConfirm = jest.fn();
        render(<VaultCard payload={payload} onConfirm={onConfirm} disabled={false} />);
        fireEvent.click(screen.getByLabelText(/skip fan wiki/i));
        fireEvent.click(screen.getByRole('button', { name: /keep these/i }));
        expect(onConfirm).toHaveBeenCalledWith({
            decisions: [
                { sourceId: 's1', status: 'approved' },
                { sourceId: 's2', status: 'rejected' },
            ],
            addedUrls: [],
        });
    });

    it('collects pasted URLs as artist-added sources (spec §9 paste-a-link degrade)', () => {
        const onConfirm = jest.fn();
        render(<VaultCard payload={{ sources: [] }} onConfirm={onConfirm} disabled={false} />);
        fireEvent.change(screen.getByPlaceholderText(/paste a link/i), { target: { value: 'https://press.example/nova' } });
        fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));
        expect(onConfirm).toHaveBeenCalledWith({ decisions: [], addedUrls: ['https://press.example/nova'] });
    });

    it('renders a continue button even with zero sources (empty-confirm is valid)', () => {
        const onConfirm = jest.fn();
        render(<VaultCard payload={{ sources: [] }} onConfirm={onConfirm} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));
        expect(onConfirm).toHaveBeenCalledWith({ decisions: [], addedUrls: [] });
    });

    it('renders a leading thumbnail and the source domain when ogImage is present', () => {
        const withImage = {
            sources: [
                { id: 's1', title: 'Pitchfork review', url: 'https://www.pitchfork.com/reviews/x', snippet: 'bedroom auteur', ogImage: 'https://media.pitchfork.com/photos/cover.jpg' },
            ],
        };
        const { container } = render(<VaultCard payload={withImage} onConfirm={jest.fn()} disabled={false} />);
        const thumb = container.querySelector('img[src="https://media.pitchfork.com/photos/cover.jpg"]');
        expect(thumb).toBeInTheDocument();
        expect(thumb).toHaveAttribute('alt', '');
        expect(thumb).toHaveAttribute('referrerPolicy', 'no-referrer');
        expect(screen.getByText('pitchfork.com')).toBeInTheDocument(); // domain, "www." stripped
    });

    it('renders correctly with no thumbnail and no domain line when a source has no ogImage', () => {
        const withoutImage = {
            sources: [
                { id: 's2', title: 'Fan wiki', url: 'https://wiki.example/y', snippet: null, ogImage: null },
            ],
        };
        const { container } = render(<VaultCard payload={withoutImage} onConfirm={jest.fn()} disabled={false} />);
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('Fan wiki')).toBeInTheDocument();
        expect(screen.queryByText('wiki.example')).not.toBeInTheDocument();
    });

    // Fix 3: an 11-source vault (the reported case) must not bury "Keep these,
    // continue" below a wall of source rows — the list scrolls, not the card.
    it('constrains the source list to a scrollable region when there are more than 4 sources', () => {
        const manySourcesPayload = {
            sources: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, title: `Source ${i}`, url: `https://example.com/${i}`, snippet: null })),
        };
        const { getByTestId } = render(<VaultCard payload={manySourcesPayload} onConfirm={jest.fn()} disabled={false} />);
        const list = getByTestId('vault-source-list');
        expect(list.className).toEqual(expect.stringContaining('overflow-y-auto'));
        expect(list.className).toEqual(expect.stringContaining('max-h-'));
        // The paste-a-link input and confirm button stay reachable outside the capped region.
        expect(screen.getByPlaceholderText(/paste a link/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /keep these/i })).toBeInTheDocument();
    });

    it('does NOT constrain the source list when there are 4 or fewer sources', () => {
        const fewSourcesPayload = {
            sources: Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, title: `Source ${i}`, url: `https://example.com/${i}`, snippet: null })),
        };
        const { getByTestId } = render(<VaultCard payload={fewSourcesPayload} onConfirm={jest.fn()} disabled={false} />);
        const list = getByTestId('vault-source-list');
        expect(list.className).not.toEqual(expect.stringContaining('overflow-y-auto'));
        expect(list.className).not.toEqual(expect.stringContaining('max-h-'));
    });
});

describe('InterviewInput', () => {
    const payload = { questionKey: 'offline_fact', question: 'Whats offline?', number: 2, total: 3 };

    it('submits typed answers', () => {
        const onAnswer = jest.fn();
        render(<InterviewInput payload={payload} onAnswer={onAnswer} disabled={false} />);
        fireEvent.change(screen.getByPlaceholderText(/type your answer/i), { target: { value: 'water tower' } });
        fireEvent.click(screen.getByRole('button', { name: /send/i }));
        expect(onAnswer).toHaveBeenCalledWith({ questionKey: 'offline_fact', answer: 'water tower' });
    });

    it('skip submits a null answer', () => {
        const onAnswer = jest.fn();
        render(<InterviewInput payload={payload} onAnswer={onAnswer} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: /skip/i }));
        expect(onAnswer).toHaveBeenCalledWith({ questionKey: 'offline_fact', answer: null });
    });
});

describe('AboutDraftCard', () => {
    it('publish passes the exact doc + about back (stateless-turn round-trip)', () => {
        const onPublish = jest.fn();
        // NOTE: `doc` is passed as a JS expression container ({"...\n..."}), not a bare
        // JSX string-literal attribute (doc="...\n..."). JSX attribute string literals do
        // not interpret backslash escapes (that's the JSX spec, confirmed empirically with
        // an isolated probe) — a bare literal here would hand the component the two literal
        // characters "\" + "n" instead of a newline, permanently mismatching the `toHaveBeenCalledWith`
        // assertion below (which, being a JS string literal, does interpret `\n`) regardless
        // of how AboutDraftCard is implemented. This is a second, previously-undocumented
        // landmine distinct from the sanctioned @jest/globals deviation.
        render(<AboutDraftCard doc={"## Overview\nd"} about="An About." onPublish={onPublish} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: /publish/i }));
        expect(onPublish).toHaveBeenCalledWith({ doc: '## Overview\nd', about: 'An About.' });
    });
});
