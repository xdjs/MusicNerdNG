// @ts-nocheck
import { jest } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
    ONBOARDING_STEPS,
    firstUnconfirmedStep,
    getOnboardingState,
    getConfirmedSteps,
    confirmOnboardingStep,
    upsertInterviewAnswer,
    recordInterviewBatchOffered,
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

    /** WHICH SITTING A QUESTION IS OFFERED IN — the half of the fix that decides
     *  the number. The read side is meaningless if this writes the wrong one. */
    describe('recordInterviewBatchOffered assigns a sitting', () => {
        function withRows(rows) {
            const values = jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn().mockResolvedValue(undefined) });
            db.select.mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(rows) }) });
            db.insert.mockReturnValue({ values });
            return values;
        }

        it('starts at 1 when the artist has never been offered anything', async () => {
            const values = withRows([]);
            await recordInterviewBatchOffered('a1', [{ questionKey: 'k', question: 'q' }]);
            expect(values.mock.calls[0][0][0].sitting).toBe(1);
        });

        it('JOINS the sitting in progress when one is open — this is a top-up', async () => {
            // The route-5 case at the write end. A question added to a sitting
            // already in front of the artist belongs to that sitting, however
            // much later it is offered.
            const values = withRows([
                { sitting: 1, source: 'followup' },
                { sitting: 1, source: 'offered' },
            ]);
            await recordInterviewBatchOffered('a1', [{ questionKey: 'k', question: 'q' }]);
            expect(values.mock.calls[0][0][0].sitting).toBe(1);
        });

        it('starts the next sitting when nothing is open', async () => {
            const values = withRows([{ sitting: 1, source: 'followup' }, { sitting: 1, source: 'followup' }]);
            await recordInterviewBatchOffered('a1', [{ questionKey: 'k', question: 'q' }]);
            expect(values.mock.calls[0][0][0].sitting).toBe(2);
        });

        it('assigns one sitting to the whole offered batch with one history read', async () => {
            const values = withRows([{ sitting: 1, source: 'followup' }]);
            await recordInterviewBatchOffered('a1', [
                { questionKey: 'k1', question: 'one' },
                { questionKey: 'k2', question: 'two' },
                { questionKey: 'k3', question: 'three' },
            ]);

            expect(db.select).toHaveBeenCalledTimes(1);
            expect(values).toHaveBeenCalledWith([
                expect.objectContaining({ artistId: 'a1', questionKey: 'k1', sitting: 2 }),
                expect.objectContaining({ artistId: 'a1', questionKey: 'k2', sitting: 2 }),
                expect.objectContaining({ artistId: 'a1', questionKey: 'k3', sitting: 2 }),
            ]);
        });

        it('treats a pre-0022 row as sitting 1', async () => {
            // Backfilled rows are 1, but a null must not become NaN and land a
            // row in no sitting at all.
            const values = withRows([{ sitting: null, source: 'followup' }]);
            await recordInterviewBatchOffered('a1', [{ questionKey: 'k', question: 'q' }]);
            expect(values.mock.calls[0][0][0].sitting).toBe(2);
        });

        it('still offers the question when the sitting cannot be read', async () => {
            const values = jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn().mockResolvedValue(undefined) });
            db.select.mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockRejectedValue(new Error('db down')) }) });
            db.insert.mockReturnValue({ values });
            await recordInterviewBatchOffered('a1', [{ questionKey: 'k', question: 'q' }]);
            expect(values.mock.calls[0][0][0].sitting).toBe(1);
        });
    });

    it('upsertInterviewAnswer upserts on (artistId, questionKey)', async () => {
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate }) });
        await upsertInterviewAnswer({
            artistId: 'artist-1', questionKey: 'offline_fact',
            question: 'q', answer: null, sitting: 1, source: 'onboarding',
        });
        expect(onConflictDoUpdate).toHaveBeenCalled();
    });

    it('preserves the offer-time watermark when an offered row is answered', async () => {
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate }) });
        await upsertInterviewAnswer({
            artistId: 'artist-1', questionKey: 'q1', question: 'q',
            answer: 'a', sitting: 1, source: 'followup',
        });

        const createdAt = onConflictDoUpdate.mock.calls[0][0].set.createdAt;
        const query = new PgDialect().sqlToQuery(createdAt);
        expect(query.sql).toContain('"artist_interview_answers"."source" = \'offered\'');
        expect(query.sql).toContain('THEN "artist_interview_answers"."created_at"');
    });

    it('upsertArtistDoc upserts on artistId', async () => {
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate }) });
        await upsertArtistDoc('artist-1', '# doc');
        expect(onConflictDoUpdate).toHaveBeenCalled();
    });
});
