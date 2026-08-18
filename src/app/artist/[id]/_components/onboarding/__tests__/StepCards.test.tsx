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
