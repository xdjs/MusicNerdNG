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
jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn().mockResolvedValue({ id: 'a1', name: 'Nova Reyes', spotify: 'spot1', instagram: 'nova' }) }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
    getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
    getVaultSourceByIdAndArtist: jest.fn(),
    updateVaultSourceStatus: jest.fn().mockResolvedValue({}),
    saveBioVersion: jest.fn().mockResolvedValue({}),
    insertVaultSource: jest.fn().mockResolvedValue({ id: 'new-src' }),
}));
jest.mock('@/server/utils/queries/vaultWebSearch', () => ({ searchAndPopulateVault: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/fetchPageContent', () => ({ isUnsafeUrl: jest.fn().mockReturnValue(false) }));
jest.mock('@/lib/sourceTypes', () => ({ inferTypeFromUrl: jest.fn().mockReturnValue('article') }));
jest.mock('@/server/utils/artistLinkService', () => ({ setArtistLink: jest.fn().mockResolvedValue({ oldValue: null, artistName: 'Nova' }), clearArtistLink: jest.fn().mockResolvedValue({ oldValue: 'x' }) }));
jest.mock('@/server/utils/services', () => ({ extractArtistId: jest.fn() }));
jest.mock('@/server/utils/artistDocService', () => ({
    ARTIST_DOC_MAX_CHARS: 20000,
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
});
