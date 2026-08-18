// @ts-nocheck
import { jest } from '@jest/globals';
import { db } from '@/server/db/drizzle';

// Track which schema table each tx.delete()/tx.update() call targeted.
// Deletes on the claim row and artist_docs use .returning(); the vault/answers/steps
// deletes are awaited directly, so their mock resolves at .where().
function makeTx(docRowsDeleted) {
    const schema = require('@/server/db/schema');
    const deletedTables = [];
    const updatedTables = [];
    const tx = {
        delete: jest.fn((table) => {
            deletedTables.push(table);
            if (table === schema.artistClaims) {
                return { where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ id: 'claim-1', artistId: 'artist-1', status: 'approved', referenceCode: 'MN-TEST' }]) }) };
            }
            if (table === schema.artistDocs) {
                return { where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue(docRowsDeleted) }) };
            }
            return { where: jest.fn().mockResolvedValue(undefined) };
        }),
        update: jest.fn((table) => {
            updatedTables.push(table);
            return { set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) };
        }),
    };
    return { tx, deletedTables, updatedTables };
}

describe('revokeApprovedClaim wipes onboarding content in the same transaction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('deletes vault sources, interview answers, onboarding steps, and the doc; clears bio when a doc existed', async () => {
        const schema = require('@/server/db/schema');
        const { tx, deletedTables, updatedTables } = makeTx([{ id: 'doc-1' }]);
        db.transaction = jest.fn(async (cb) => cb(tx));

        const { revokeApprovedClaim } = require('@/server/utils/queries/dashboardQueries');
        const result = await revokeApprovedClaim('claim-1');

        expect(result).toMatchObject({ artistId: 'artist-1' });
        expect(deletedTables).toEqual(expect.arrayContaining([
            schema.artistClaims, schema.artistVaultSources,
            schema.artistInterviewAnswers, schema.artistOnboardingSteps, schema.artistDocs,
        ]));
        // A doc was deleted → the (doc-derived or hand-edited) bio is the revoked owner's content
        expect(updatedTables).toEqual(expect.arrayContaining([schema.artists]));
    });

    it('does NOT clear the bio when no doc row existed (owner never published)', async () => {
        const { tx, updatedTables } = makeTx([]);
        db.transaction = jest.fn(async (cb) => cb(tx));

        const { revokeApprovedClaim } = require('@/server/utils/queries/dashboardQueries');
        await revokeApprovedClaim('claim-1');

        expect(updatedTables).toHaveLength(0);
    });
});
