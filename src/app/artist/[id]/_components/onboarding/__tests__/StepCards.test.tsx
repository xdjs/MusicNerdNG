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

describe('ProfilesCard — discovered candidates (opt-in, never auto-saved)', () => {
    const candidate = {
        siteName: 'tiktok',
        value: 'novareyes',
        displayName: 'TikTok',
        logoUrl: 'https://utfs.io/f/tiktok-logo.png',
        colorHex: '#000000',
        profileUrl: 'https://tiktok.com/@novareyes',
        previewImage: null,
        reasoning: 'Bio and photos match the artist.',
    };
    const payloadWithCandidate = {
        artistName: 'Nova Reyes',
        links: [{ siteName: 'spotify', value: 'spot1', displayName: 'Spotify' }],
        candidates: [candidate],
        enrichment: null,
    };

    it('renders candidates in their own section, separate from the confirmed-links list', () => {
        render(<ProfilesCard payload={payloadWithCandidate} onConfirm={jest.fn()} disabled={false} />);
        expect(screen.getByText(/we also found these/i)).toBeInTheDocument();
        const candidateList = screen.getByTestId('profiles-candidate-list');
        expect(candidateList).toBeInTheDocument();
        expect(screen.getByText('TikTok')).toBeInTheDocument();
        expect(screen.getByText('@novareyes')).toBeInTheDocument();
        // Distinct click-through affordance from confirmed rows' SVG icon.
        expect(candidateList.textContent).toContain('↗');
    });

    it('does NOT render a candidates section, and adds no extra <img>, when payload.candidates is absent (pre-discovery payload shape)', () => {
        const payload = { artistName: 'Nova Reyes', links: [{ siteName: 'spotify', value: 'spot1' }], enrichment: null };
        const { container } = render(<ProfilesCard payload={payload} onConfirm={jest.fn()} disabled={false} />);
        expect(screen.queryByTestId('profiles-candidate-list')).not.toBeInTheDocument();
        expect(screen.queryByText(/we also found these/i)).not.toBeInTheDocument();
        expect(container.querySelectorAll('img').length).toBe(0);
    });

    it('does NOT include an unaccepted candidate in the submitted payload — a guess is never auto-saved', () => {
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={payloadWithCandidate} onConfirm={onConfirm} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
        expect(onConfirm).toHaveBeenCalledWith({
            addedLinks: [],
            removedSiteNames: [],
        });
    });

    it('accepting a candidate (explicit "Add" click) includes its profileUrl in addedLinks on submit', () => {
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={payloadWithCandidate} onConfirm={onConfirm} disabled={false} />);
        fireEvent.click(screen.getByLabelText('add tiktok profile'));
        expect(screen.getByText(/added/i)).toBeInTheDocument(); // visual accepted state
        fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
        expect(onConfirm).toHaveBeenCalledWith({
            addedLinks: [{ url: 'https://tiktok.com/@novareyes' }],
            removedSiteNames: [],
        });
    });

    it('clicking Add again un-accepts the candidate (toggle)', () => {
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={payloadWithCandidate} onConfirm={onConfirm} disabled={false} />);
        const addButton = screen.getByLabelText('add tiktok profile');
        fireEvent.click(addButton);
        fireEvent.click(addButton);
        fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
        expect(onConfirm).toHaveBeenCalledWith({ addedLinks: [], removedSiteNames: [] });
    });

    it('dismissing a candidate ("Not me") hides it and excludes it from submission even if it had been accepted first', () => {
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={payloadWithCandidate} onConfirm={onConfirm} disabled={false} />);
        fireEvent.click(screen.getByLabelText('add tiktok profile')); // accept first
        fireEvent.click(screen.getByLabelText('dismiss tiktok suggestion')); // then dismiss
        expect(screen.queryByText('TikTok')).not.toBeInTheDocument();
        expect(screen.queryByTestId('profiles-candidate-list')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
        expect(onConfirm).toHaveBeenCalledWith({ addedLinks: [], removedSiteNames: [] });
    });

    it('hints which supported platforms still have neither a confirmed link nor a discovered candidate', () => {
        render(<ProfilesCard payload={payloadWithCandidate} onConfirm={jest.fn()} disabled={false} />);
        // payloadWithCandidate covers spotify (link) + tiktok (candidate) only.
        const hint = screen.getByText(/still missing/i);
        expect(hint.textContent).toContain('Instagram');
        expect(hint.textContent).toContain('Facebook');
        expect(hint.textContent).not.toContain('Spotify');
        expect(hint.textContent).not.toContain('TikTok');
    });

    it('a pasted link plus an accepted candidate both land in addedLinks together', () => {
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={payloadWithCandidate} onConfirm={onConfirm} disabled={false} />);
        fireEvent.click(screen.getByLabelText('add tiktok profile'));
        fireEvent.change(screen.getByPlaceholderText(/paste a link/i), { target: { value: 'https://bandcamp.com/novareyes' } });
        fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
        fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
        expect(onConfirm).toHaveBeenCalledWith({
            addedLinks: [
                { url: 'https://bandcamp.com/novareyes' },
                { url: 'https://tiktok.com/@novareyes' },
            ],
            removedSiteNames: [],
        });
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

    it('renders nothing under "what prompted this" when sourceUrls is absent (static fallback question)', () => {
        render(<InterviewInput payload={payload} onAnswer={jest.fn()} disabled={false} />);
        expect(screen.queryByText(/what prompted this/i)).not.toBeInTheDocument();
    });

    it('renders nothing under "what prompted this" when sourceUrls is an empty array', () => {
        render(<InterviewInput payload={{ ...payload, sourceUrls: [] }} onAnswer={jest.fn()} disabled={false} />);
        expect(screen.queryByText(/what prompted this/i)).not.toBeInTheDocument();
    });

    it('renders a small "what prompted this" link when sourceUrls is present (grounded question)', () => {
        const grounded = { ...payload, sourceUrls: ['https://www.instagram.com/p/ABC123/'] };
        render(<InterviewInput payload={grounded} onAnswer={jest.fn()} disabled={false} />);
        expect(screen.getByText(/what prompted this/i)).toBeInTheDocument();
        const link = screen.getByRole('link', { name: /instagram\.com/i });
        expect(link).toHaveAttribute('href', 'https://www.instagram.com/p/ABC123/');
        expect(link).toHaveAttribute('target', '_blank');
    });

    it('caps the visible source links at two even when more are supplied', () => {
        const grounded = {
            ...payload,
            sourceUrls: [
                'https://www.instagram.com/p/ONE/',
                'https://www.instagram.com/p/TWO/',
                'https://www.instagram.com/p/THREE/',
            ],
        };
        render(<InterviewInput payload={grounded} onAnswer={jest.fn()} disabled={false} />);
        expect(screen.getAllByRole('link')).toHaveLength(2);
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

    it('clicking Edit reveals a textarea pre-filled with the generated About text', () => {
        render(<AboutDraftCard doc="## Overview" about="An About." onPublish={jest.fn()} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.getByRole('textbox', { name: /edit your about/i })).toHaveValue('An About.');
    });

    it('editing the text and publishing sends the EDITED about with the ORIGINAL doc', () => {
        const onPublish = jest.fn();
        render(<AboutDraftCard doc={"## Overview\nd"} about="An About." onPublish={onPublish} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByRole('textbox', { name: /edit your about/i }), { target: { value: 'A rewritten About.' } });
        fireEvent.click(screen.getByRole('button', { name: /publish/i }));
        expect(onPublish).toHaveBeenCalledWith({ doc: '## Overview\nd', about: 'A rewritten About.' });
    });

    it('blocks publishing when the edited text is emptied', () => {
        const onPublish = jest.fn();
        render(<AboutDraftCard doc="## Overview" about="An About." onPublish={onPublish} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByRole('textbox', { name: /edit your about/i }), { target: { value: '   ' } });
        const publishButton = screen.getByRole('button', { name: /publish/i });
        expect(publishButton).toBeDisabled();
        fireEvent.click(publishButton);
        expect(onPublish).not.toHaveBeenCalled();
    });

    it('"Reset to generated" restores the original generated text after edits', () => {
        render(<AboutDraftCard doc="## Overview" about="An About." onPublish={jest.fn()} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        const textarea = screen.getByRole('textbox', { name: /edit your about/i });
        fireEvent.change(textarea, { target: { value: 'Something else entirely.' } });
        expect(textarea).toHaveValue('Something else entirely.');
        fireEvent.click(screen.getByRole('button', { name: /reset to generated/i }));
        expect(textarea).toHaveValue('An About.');
    });

    it('keeps the disabled-publish reason visible after leaving edit mode with emptied text', () => {
        render(<AboutDraftCard doc="## Overview" about="An About." onPublish={jest.fn()} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByRole('textbox', { name: /edit your about/i }), { target: { value: '   ' } });
        // Leave edit mode without publishing — the edit (now empty) must persist,
        // and the reason publishing is blocked must stay visible, not disappear.
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled();
        expect(screen.getByText(/can't be empty/i)).toBeInTheDocument();
    });

    // Regression test for the "Edit is unreachable at the moment of decision"
    // bug: with a long About, the Edit control used to live up near the card's
    // heading while "Publish this" sat far below — scrolled apart. Assert on
    // DOM containment (same action-row parent), not pixel positions, since
    // JSDOM has no layout.
    it('renders Edit in the same action row as Publish this, as siblings', () => {
        render(<AboutDraftCard doc="## Overview" about="An About." onPublish={jest.fn()} disabled={false} />);
        const editButton = screen.getByRole('button', { name: 'Edit' });
        const publishButton = screen.getByRole('button', { name: /publish/i });
        expect(editButton.parentElement).toBe(publishButton.parentElement);
    });
});
