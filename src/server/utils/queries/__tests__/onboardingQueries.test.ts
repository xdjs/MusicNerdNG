// @ts-nocheck
import { jest } from '@jest/globals';
import {
    ONBOARDING_STEPS,
    firstUnconfirmedStep,
    getOnboardingState,
    getConfirmedSteps,
    confirmOnboardingStep,
    upsertInterviewAnswer,
    upsertArtistDoc,
} from '@/server/utils/queries/onboardingQueries';
import { db } from '@/server/db/drizzle';

describe('firstUnconfirmedStep (pure derivation)', () => {
    it('returns profiles for an empty set', () => {
        expect(firstUnconfirmedStep(new Set())).toBe('profiles');
    });
    it('returns the first gap even when later steps are confirmed (out-of-order safety)', () => {
        expect(firstUnconfirmedStep(new Set(['profiles', 'interview']))).toBe('vault');
    });
    it('returns publish when only publish remains', () => {
        expect(firstUnconfirmedStep(new Set(['profiles', 'vault', 'interview']))).toBe('publish');
    });
    it('returns null when every step is confirmed', () => {
        expect(firstUnconfirmedStep(new Set(ONBOARDING_STEPS))).toBeNull();
    });
    it('ignores unknown junk in the set', () => {
        expect(firstUnconfirmedStep(new Set(['bogus']))).toBe('profiles');
    });
});

describe('getOnboardingState', () => {
    beforeEach(() => jest.clearAllMocks());

    it('is complete only when publish is confirmed', async () => {
        db.query.artistOnboardingSteps.findMany.mockResolvedValue([
            { step: 'profiles' }, { step: 'vault' }, { step: 'interview' }, { step: 'publish' },
        ]);
        const state = await getOnboardingState('artist-1');
        expect(state).toEqual({ complete: true, currentStep: null });
    });

    it('derives the current step from confirmations, not data existence', async () => {
        db.query.artistOnboardingSteps.findMany.mockResolvedValue([{ step: 'profiles' }]);
        const state = await getOnboardingState('artist-1');
        expect(state).toEqual({ complete: false, currentStep: 'vault' });
    });

    it('fails CLOSED (null — unknown, not a default state) when the query throws', async () => {
        db.query.artistOnboardingSteps.findMany.mockRejectedValue(new Error('boom'));
        const state = await getOnboardingState('artist-1');
        expect(state).toBeNull();
    });
});

describe('getConfirmedSteps', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns null (not an empty Set) when the query throws — distinguishable from a new claimant', async () => {
        db.query.artistOnboardingSteps.findMany.mockRejectedValue(new Error('boom'));
        const confirmed = await getConfirmedSteps('artist-1');
        expect(confirmed).toBeNull();
    });

    it('returns an empty Set (not null) for a genuine new claimant with zero confirmations', async () => {
        db.query.artistOnboardingSteps.findMany.mockResolvedValue([]);
        const confirmed = await getConfirmedSteps('artist-1');
        expect(confirmed).toEqual(new Set());
    });
});

describe('write paths use ON CONFLICT upserts', () => {
    beforeEach(() => jest.clearAllMocks());

    it('confirmOnboardingStep is idempotent via onConflictDoNothing', async () => {
        const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoNothing }) });
        await confirmOnboardingStep('artist-1', 'profiles');
        expect(onConflictDoNothing).toHaveBeenCalled();
    });

    it('upsertInterviewAnswer upserts on (artistId, questionKey)', async () => {
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate }) });
        await upsertInterviewAnswer({
            artistId: 'artist-1', questionKey: 'offline_fact',
            question: 'q', answer: null, source: 'onboarding',
        });
        expect(onConflictDoUpdate).toHaveBeenCalled();
    });

    it('upsertArtistDoc upserts on artistId', async () => {
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate }) });
        await upsertArtistDoc('artist-1', '# doc');
        expect(onConflictDoUpdate).toHaveBeenCalled();
    });
});
