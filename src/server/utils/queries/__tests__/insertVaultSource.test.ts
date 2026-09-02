// @ts-nocheck
import { jest } from '@jest/globals';

describe('insertVaultSource', () => {
    beforeEach(() => { jest.resetModules(); });

    it('actually persists the publication date it was given', async () => {
        // It was accepted as a parameter and silently dropped on the way to the
        // insert, so six freshly discovered sources came back with no dates at
        // all — and the knowledge doc went on labelling every claim "date
        // unknown" while the extractor was working perfectly.
        const values = jest.fn().mockReturnValue({
            onConflictDoNothing: () => ({ returning: async () => [{ id: 's1' }] }),
        });
        jest.doMock('@/server/db/drizzle', () => ({ db: { insert: () => ({ values }) } }));
        const { insertVaultSource } = await import('../dashboardQueries');

        await insertVaultSource({
            artistId: 'a1', url: 'https://voyagemia.com/x', publishedAt: '2019-01-10',
        });
        expect(values).toHaveBeenCalledWith(expect.objectContaining({ publishedAt: '2019-01-10' }));
    });

    it('writes null rather than undefined when the page gave no date', async () => {
        const values = jest.fn().mockReturnValue({
            onConflictDoNothing: () => ({ returning: async () => [{ id: 's1' }] }),
        });
        jest.doMock('@/server/db/drizzle', () => ({ db: { insert: () => ({ values }) } }));
        const { insertVaultSource } = await import('../dashboardQueries');

        await insertVaultSource({ artistId: 'a1', url: 'https://soundbetter.com/x' });
        expect(values).toHaveBeenCalledWith(expect.objectContaining({ publishedAt: null }));
    });
});
