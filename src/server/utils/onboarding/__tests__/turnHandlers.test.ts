// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/onboardingQueries', () => ({
    ONBOARDING_STEPS: ['profiles', 'vault', 'interview', 'publish'],
    getOnboardingState: jest.fn(),
    confirmOnboardingStep: jest.fn().mockResolvedValue(undefined),
    getInterviewAnswers: jest.fn().mockResolvedValue([]),
    upsertInterviewAnswer: jest.fn().mockResolvedValue(undefined),
    upsertArtistDoc: jest.fn().mockResolvedValue(undefined),
    getArtistDoc: jest.fn(),
}));
jest.mock('@/server/utils/queries/artistQueries', () => ({
    getArtistById: jest.fn().mockResolvedValue({ id: 'a1', name: 'Nova Reyes', spotify: 'spot1', instagram: 'nova' }),
    getAllLinks: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
    getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
    getVaultSourceByIdAndArtist: jest.fn(),
    updateVaultSourceStatus: jest.fn().mockResolvedValue({}),
    saveBioVersion: jest.fn().mockResolvedValue({}),
    insertVaultSource: jest.fn().mockResolvedValue({ id: 'new-src' }),
    updateVaultSourceContent: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/server/utils/queries/vaultWebSearch', () => ({ searchAndPopulateVault: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/fetchPageContent', () => ({
    isUnsafeUrl: jest.fn().mockReturnValue(false),
    fetchPageContent: jest.fn().mockResolvedValue({ title: 't', snippet: 's', extractedText: 'e', ogImage: null }),
}));
jest.mock('@/server/utils/linkPreview', () => ({
    fetchLinkPreview: jest.fn().mockResolvedValue({ imageUrl: null, title: null }),
}));
jest.mock('@/lib/sourceTypes', () => ({ inferTypeFromUrl: jest.fn().mockReturnValue('article') }));
jest.mock('@/server/utils/artistLinkService', () => ({ setArtistLink: jest.fn().mockResolvedValue({ oldValue: null, artistName: 'Nova' }), clearArtistLink: jest.fn().mockResolvedValue({ oldValue: 'x' }) }));
jest.mock('@/server/utils/services', () => ({ extractArtistId: jest.fn() }));
jest.mock('@/server/utils/artistDocService', () => ({
    ARTIST_DOC_MAX_CHARS: 20000,
    GEMINI_TIMEOUT_MS: 20000,
    synthesizeArtistDoc: jest.fn().mockResolvedValue('## Overview\ndoc'),
    generateAboutFromDoc: jest.fn().mockResolvedValue('An About.'),
}));

async function collect(gen) {
    const events = [];
    for await (const e of gen) events.push(e);
    return events;
}

describe('runOnboardingTurn', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    it('open resumes at the derived current step (vault here), never at a fixed start', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'vault' });
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'open' }));
        expect(events.find(e => e.kind === 'step')?.step).toBe('vault');
    });

    it('profiles step enriches links with urlmap metadata (display name, logo, trimmed color, profile URL)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const artistQ = await import('@/server/utils/queries/artistQueries');
        artistQ.getAllLinks.mockResolvedValueOnce([
            { siteName: 'spotify', cardPlatformName: 'Spotify', siteImage: 'https://utfs.io/f/spotify.png', colorHex: '#1DB954', appStringFormat: 'https://open.spotify.com/artist/%@' },
            { siteName: 'instagram', cardPlatformName: 'Instagram', siteImage: null, colorHex: '#E1306C\r', appStringFormat: 'https://instagram.com/%@' },
        ]);
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'open' }));
        const step = events.find(e => e.kind === 'step');
        expect(step.payload.links).toEqual(expect.arrayContaining([
            expect.objectContaining({
                siteName: 'spotify', value: 'spot1', displayName: 'Spotify',
                logoUrl: 'https://utfs.io/f/spotify.png', colorHex: '#1DB954',
                profileUrl: 'https://open.spotify.com/artist/spot1',
            }),
            expect.objectContaining({
                siteName: 'instagram', value: 'nova', displayName: 'Instagram',
                logoUrl: null, colorHex: '#E1306C', // trailing \r trimmed
                profileUrl: 'https://instagram.com/nova',
            }),
        ]));
    });

    it('profiles step fetches link previews in parallel for every link with a profileUrl and attaches previewImage', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const artistQ = await import('@/server/utils/queries/artistQueries');
        artistQ.getAllLinks.mockResolvedValueOnce([
            { siteName: 'spotify', cardPlatformName: 'Spotify', siteImage: 'https://utfs.io/f/spotify.png', colorHex: '#1DB954', appStringFormat: 'https://open.spotify.com/artist/%@' },
            { siteName: 'instagram', cardPlatformName: 'Instagram', siteImage: null, colorHex: null, appStringFormat: 'https://instagram.com/%@' },
        ]);
        const { fetchLinkPreview } = await import('@/server/utils/linkPreview');
        fetchLinkPreview.mockImplementation(async (url) => (
            url.includes('spotify')
                ? { imageUrl: 'https://i.scdn.co/image/spot1.jpg', title: 'Nova Reyes' }
                : { imageUrl: null, title: null }
        ));
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'open' }));
        const step = events.find(e => e.kind === 'step');
        expect(fetchLinkPreview).toHaveBeenCalledWith('https://open.spotify.com/artist/spot1');
        expect(fetchLinkPreview).toHaveBeenCalledWith('https://instagram.com/nova');
        const spotifyLink = step.payload.links.find(l => l.siteName === 'spotify');
        const instagramLink = step.payload.links.find(l => l.siteName === 'instagram');
        expect(spotifyLink.previewImage).toBe('https://i.scdn.co/image/spot1.jpg');
        expect(instagramLink.previewImage).toBeNull();
    });

    it('profiles step normalizes the urlmap placeholder color (#000000, meaning "never set") to null', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const artistQ = await import('@/server/utils/queries/artistQueries');
        artistQ.getAllLinks.mockResolvedValueOnce([
            { siteName: 'spotify', cardPlatformName: 'Spotify', siteImage: null, colorHex: '#000000', appStringFormat: 'https://open.spotify.com/artist/%@' },
        ]);
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'open' }));
        const step = events.find(e => e.kind === 'step');
        const spotifyLink = step.payload.links.find(l => l.siteName === 'spotify');
        expect(spotifyLink.colorHex).toBeNull();
    });

    it('profiles step degrades to the bare {siteName, value} shape when getAllLinks throws (urlmap failure must never break the turn)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const artistQ = await import('@/server/utils/queries/artistQueries');
        artistQ.getAllLinks.mockRejectedValueOnce(new Error('urlmap down'));
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'open' }));
        const step = events.find(e => e.kind === 'step');
        expect(step.payload.links).toEqual([
            { siteName: 'spotify', value: 'spot1' },
            { siteName: 'instagram', value: 'nova' },
        ]);
        expect(events.some(e => e.kind === 'error')).toBe(false);
    });

    it('profiles step narrates the empty variant when the artist has zero links, and the populated variant otherwise', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const artistQ = await import('@/server/utils/queries/artistQueries');
        artistQ.getArtistById.mockResolvedValueOnce({ id: 'a1', name: 'Nova Reyes' }); // no link columns set
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'open' }));
        const chats = events.filter(e => e.kind === 'chat').map(e => e.text);
        expect(chats.some(t => t.includes('Paste your Spotify'))).toBe(true);
        expect(chats.some(t => t.includes("Leaving a card as-is confirms it"))).toBe(false);
    });

    it('confirm_profiles writes added links via extractArtistId and reports bad URLs politely', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const { extractArtistId } = await import('@/server/utils/services');
        const { setArtistLink } = await import('@/server/utils/artistLinkService');
        extractArtistId
            .mockResolvedValueOnce({ siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'novareyes' })
            .mockResolvedValueOnce(undefined); // unrecognized URL
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', {
            type: 'confirm_profiles',
            addedLinks: [{ url: 'https://tiktok.com/@novareyes' }, { url: 'https://nonsense.example/xyz' }],
            removedSiteNames: [],
        }));
        expect(setArtistLink).toHaveBeenCalledWith('a1', 'tiktok', 'novareyes');
        expect(oq.confirmOnboardingStep).toHaveBeenCalledWith('a1', 'profiles');
        expect(events.some(e => e.kind === 'chat' && e.text.includes("couldn't recognize"))).toBe(true);
        expect(events.some(e => e.kind === 'error')).toBe(false); // degradation, not failure
    });

    it('vault step passes each pending source\'s ogImage (or null) through into the payload', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'vault' });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        dq.getVaultSourcesByArtistId.mockResolvedValueOnce([
            { id: 's1', title: 'Pitchfork review', url: 'https://pitchfork.com/x', snippet: 'snip', ogImage: 'https://pitchfork.com/img.jpg' },
            { id: 's2', title: 'Fan wiki', url: 'https://wiki.example/y', snippet: null, ogImage: null },
        ]);
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'open' }));
        const step = events.find(e => e.kind === 'step' && e.step === 'vault');
        expect(step.payload.sources).toEqual([
            { id: 's1', title: 'Pitchfork review', url: 'https://pitchfork.com/x', snippet: 'snip', ogImage: 'https://pitchfork.com/img.jpg' },
            { id: 's2', title: 'Fan wiki', url: 'https://wiki.example/y', snippet: null, ogImage: null },
        ]);
    });

    it('vault_review only updates sources belonging to this artist', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'vault' });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        dq.getVaultSourceByIdAndArtist
            .mockResolvedValueOnce({ id: 's1', artistId: 'a1' })
            .mockResolvedValueOnce(undefined); // someone else's source id
        const { runOnboardingTurn } = await import('../turnHandlers');
        await collect(runOnboardingTurn('a1', {
            type: 'vault_review',
            decisions: [{ sourceId: 's1', status: 'approved' }, { sourceId: 'evil', status: 'approved' }],
        }));
        expect(dq.updateVaultSourceStatus).toHaveBeenCalledTimes(1);
        expect(dq.updateVaultSourceStatus).toHaveBeenCalledWith('s1', 'approved');
    });

    it('interview_answer stores the answer, then asks the next unanswered question; last answer confirms the step and enters publish (draft generated)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'interview' });
        oq.getInterviewAnswers.mockResolvedValue([
            { questionKey: 'sound_in_own_words', answer: 'a' },
            { questionKey: 'offline_fact', answer: null },
            { questionKey: 'working_on_now', answer: 'b' },
        ]); // all three asked → step complete
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', {
            type: 'interview_answer', questionKey: 'working_on_now', answer: 'new album',
        }));
        expect(oq.upsertInterviewAnswer).toHaveBeenCalledWith(expect.objectContaining({
            artistId: 'a1', questionKey: 'working_on_now', answer: 'new album', source: 'onboarding',
        }));
        expect(oq.confirmOnboardingStep).toHaveBeenCalledWith('a1', 'interview');
        expect(events.some(e => e.kind === 'draft' && e.doc && e.about)).toBe(true);
    });

    it('publish validates caps, persists doc + bio version + artists.bio, confirms publish, completes', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'publish' });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        const { db } = await import('@/server/db/drizzle');
        const where = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where });
        db.update.mockReturnValue({ set });
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'publish', doc: '## Overview\nd', about: 'About text' }));
        expect(oq.upsertArtistDoc).toHaveBeenCalledWith('a1', '## Overview\nd');
        expect(dq.saveBioVersion).toHaveBeenCalledWith('a1', 'About text');
        expect(db.update).toHaveBeenCalled();
        expect(set).toHaveBeenCalledWith({ bio: 'About text' });
        expect(oq.confirmOnboardingStep).toHaveBeenCalledWith('a1', 'publish');
        expect(events.some(e => e.kind === 'complete')).toBe(true);
    });

    it('publish snapshots a pre-existing REAL bio via saveBioVersion BEFORE overwriting it (C2)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'publish' });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        const artistQ = await import('@/server/utils/queries/artistQueries');
        artistQ.getArtistById.mockResolvedValueOnce({ id: 'a1', name: 'Nova Reyes', bio: 'A real hand-written bio.' });
        const { db } = await import('@/server/db/drizzle');
        const where = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where });
        db.update.mockReturnValue({ set });
        const { runOnboardingTurn } = await import('../turnHandlers');
        await collect(runOnboardingTurn('a1', { type: 'publish', doc: '## Overview\nd', about: 'About text' }));
        expect(dq.saveBioVersion).toHaveBeenNthCalledWith(1, 'a1', 'A real hand-written bio.');
        expect(dq.saveBioVersion).toHaveBeenNthCalledWith(2, 'a1', 'About text');
    });

    it('publish does NOT snapshot the empty-state/claim-nudge bio (C2)', async () => {
        const { ABOUT_EMPTY_STATE } = await import('@/lib/bioConstants');
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'publish' });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        const artistQ = await import('@/server/utils/queries/artistQueries');
        artistQ.getArtistById.mockResolvedValueOnce({ id: 'a1', name: 'Nova Reyes', bio: ABOUT_EMPTY_STATE });
        const { db } = await import('@/server/db/drizzle');
        const where = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where });
        db.update.mockReturnValue({ set });
        const { runOnboardingTurn } = await import('../turnHandlers');
        await collect(runOnboardingTurn('a1', { type: 'publish', doc: '## Overview\nd', about: 'About text' }));
        expect(dq.saveBioVersion).toHaveBeenCalledTimes(1);
        expect(dq.saveBioVersion).toHaveBeenCalledWith('a1', 'About text');
    });

    it('publish rejects when not on the publish step', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'publish', doc: 'd', about: 'a' }));
        expect(events.some(e => e.kind === 'error')).toBe(true);
        expect(oq.upsertArtistDoc).not.toHaveBeenCalled();
    });

    it('publish arriving after onboarding is already complete just completes — no false "not quite there" error', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: true, currentStep: null });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'publish', doc: 'd', about: 'a' }));
        expect(oq.upsertArtistDoc).not.toHaveBeenCalled();
        expect(dq.saveBioVersion).not.toHaveBeenCalled();
        expect(events.some(e => e.kind === 'complete')).toBe(true);
        expect(events.some(e => e.kind === 'chat' && e.text.includes('not quite there'))).toBe(false);
    });

    it('fails CLOSED: a null onboarding state (query failure) yields an error and performs NO writes (C1)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue(null);
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', {
            type: 'confirm_profiles', addedLinks: [], removedSiteNames: [],
        }));
        expect(events.some(e => e.kind === 'error')).toBe(true);
        expect(oq.confirmOnboardingStep).not.toHaveBeenCalled();
        expect(oq.upsertInterviewAnswer).not.toHaveBeenCalled();
        expect(oq.upsertArtistDoc).not.toHaveBeenCalled();
    });

    it('an out-of-step interview_answer does NOT call upsertInterviewAnswer and resyncs to the real step (I1)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        // Stale card: client thinks it's on "interview", server says "vault".
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'vault' });
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', {
            type: 'interview_answer', questionKey: 'sound_in_own_words', answer: 'loud',
        }));
        expect(oq.upsertInterviewAnswer).not.toHaveBeenCalled();
        expect(events.some(e => e.kind === 'error')).toBe(true);
        expect(events.some(e => e.kind === 'step' && e.step === 'vault')).toBe(true);
    });

    it('an out-of-step confirm_profiles does NOT write links and resyncs (I1)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'interview' });
        const { setArtistLink } = await import('@/server/utils/artistLinkService');
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', {
            type: 'confirm_profiles', addedLinks: [{ url: 'https://tiktok.com/@x' }], removedSiteNames: [],
        }));
        expect(setArtistLink).not.toHaveBeenCalled();
        expect(oq.confirmOnboardingStep).not.toHaveBeenCalledWith('a1', 'profiles');
        expect(events.some(e => e.kind === 'error')).toBe(true);
    });

    it('an out-of-step vault_review does NOT write source decisions and resyncs (I1)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', {
            type: 'vault_review', decisions: [{ sourceId: 's1', status: 'approved' }], addedUrls: [],
        }));
        expect(dq.updateVaultSourceStatus).not.toHaveBeenCalled();
        expect(oq.confirmOnboardingStep).not.toHaveBeenCalledWith('a1', 'vault');
        expect(events.some(e => e.kind === 'error')).toBe(true);
    });

    it('vault_review enriches an artist-pasted URL in the background via fetchPageContent + updateVaultSourceContent (I4)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'vault' });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        dq.insertVaultSource.mockResolvedValueOnce({ id: 'new-src-1' });
        const { fetchPageContent } = await import('@/server/utils/fetchPageContent');
        const { runOnboardingTurn } = await import('../turnHandlers');
        await collect(runOnboardingTurn('a1', {
            type: 'vault_review', decisions: [], addedUrls: ['https://example.com/press'],
        }));
        expect(dq.insertVaultSource).toHaveBeenCalledWith({
            artistId: 'a1', url: 'https://example.com/press', type: 'article', status: 'approved',
        });
        expect(fetchPageContent).toHaveBeenCalledWith('https://example.com/press');
        // Let the fire-and-forget .then() chain flush before asserting the follow-up write.
        await new Promise(r => setTimeout(r, 0));
        expect(dq.updateVaultSourceContent).toHaveBeenCalledWith('new-src-1', {
            title: 't', snippet: 's', extractedText: 'e', ogImage: null,
        });
    });

    it('publish skips the Gemini retry once the retry budget is exhausted, letting the failure propagate (I2)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'publish' });
        const docService = await import('@/server/utils/artistDocService');
        docService.synthesizeArtistDoc.mockRejectedValueOnce(new Error('gemini boom'));
        const dateSpy = jest.spyOn(Date, 'now')
            .mockReturnValueOnce(0)      // publishStartedAt
            .mockReturnValueOnce(31_000); // elapsed check in the catch — past PUBLISH_RETRY_BUDGET_MS (30s)
        const { runOnboardingTurn } = await import('../turnHandlers');
        await expect(collect(runOnboardingTurn('a1', { type: 'open' }))).rejects.toThrow('gemini boom');
        expect(docService.synthesizeArtistDoc).toHaveBeenCalledTimes(1); // no retry attempted
        dateSpy.mockRestore();
    });

    it('publish skips the About-side retry once past budget too (I2 — the branch that matters for the real worst case)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'publish' });
        const docService = await import('@/server/utils/artistDocService');
        // Doc succeeds on the first try (the realistic worst case is the doc
        // retry eating the budget, THEN the About call fails) — only the About
        // catch's Date.now() check needs to fire here.
        docService.generateAboutFromDoc.mockRejectedValueOnce(new Error('about boom'));
        const dateSpy = jest.spyOn(Date, 'now')
            .mockReturnValueOnce(0)      // publishStartedAt
            .mockReturnValueOnce(45_000); // elapsed check in the About catch — past budget
        const { runOnboardingTurn } = await import('../turnHandlers');
        await expect(collect(runOnboardingTurn('a1', { type: 'open' }))).rejects.toThrow('about boom');
        expect(docService.generateAboutFromDoc).toHaveBeenCalledTimes(1); // no retry attempted
        dateSpy.mockRestore();
    });

    it('publish retries the Gemini call once when still within the retry budget (I2 regression)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'publish' });
        const docService = await import('@/server/utils/artistDocService');
        docService.synthesizeArtistDoc
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValueOnce('## Overview\nrecovered doc');
        const dateSpy = jest.spyOn(Date, 'now')
            .mockReturnValueOnce(0)     // publishStartedAt
            .mockReturnValueOnce(5_000); // elapsed check in the catch — well within budget
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'open' }));
        expect(docService.synthesizeArtistDoc).toHaveBeenCalledTimes(2); // retried once
        expect(events.some(e => e.kind === 'draft')).toBe(true);
        dateSpy.mockRestore();
    });
});
