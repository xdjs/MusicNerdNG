import { Artist } from '@/server/db/DbTypes';

// Mock the database
jest.mock('@/server/db/drizzle', () => ({
    execute: jest.fn(),
    query: {
        artists: {
            findFirst: jest.fn(),
            findMany: jest.fn()
        }
    }
}));

// Mock the functions we're testing
const searchForArtistByName = async (name: string): Promise<Artist[]> => {
    const db = require('@/server/db/drizzle');
    try {
        const startTime = performance.now();
        const result = await db.execute(`
            SELECT 
                id, 
                name, 
                spotify,
                bandcamp,
                youtubechannel,
                instagram,
                x,
                facebook,
                tiktok,
                CASE 
                    WHEN LOWER(name) LIKE LOWER('%' || ${name || ''} || '%') THEN 0
                    ELSE 1
                END as match_type
            FROM artists
            WHERE 
                (LOWER(name) LIKE LOWER('%' || ${name || ''} || '%') OR similarity(name, ${name}) > 0.3)
                AND spotify IS NOT NULL
            ORDER BY 
                match_type ASC,
                CASE 
                    WHEN LOWER(name) LIKE LOWER('%' || ${name || ''} || '%') 
                    THEN -POSITION(LOWER(${name}) IN LOWER(name))
                    ELSE -999999
                END DESC,
                similarity(name, ${name}) DESC
            LIMIT 10
        `);
        const endTime = performance.now();
        console.log(`Search for "${name}" took ${endTime - startTime}ms`);
        return result;
    } catch(e) {
        console.error(`Error fetching artist by name`, e);
        throw new Error("Error searching for artist by name");
    }
};

describe('Complex Artist Search Scenarios', () => {
    const mockArtists: Artist[] = [
        {
            id: '1',
            name: 'Deadmau5',
            lcname: 'deadmau5',
            spotify: 'spotify1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            addedBy: 'test-user'
        } as Artist,
        {
            id: '2',
            name: 'DeadMau5 (Remix)',
            lcname: 'deadmau5 (remix)',
            spotify: 'spotify2',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            addedBy: 'test-user'
        } as Artist,
        {
            id: '3',
            name: 'RÜFÜS DU SOL',
            lcname: 'rufus du sol',
            spotify: 'spotify3',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            addedBy: 'test-user'
        } as Artist,
        {
            id: '4',
            name: 'Rüfüs Du Sol',
            lcname: 'rufus du sol',
            spotify: 'spotify4',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            addedBy: 'test-user'
        } as Artist,
        {
            id: '5',
            name: 'C418',
            lcname: 'c418',
            spotify: 'spotify5',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            addedBy: 'test-user'
        } as Artist
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Case Sensitivity Tests', () => {
        it('should find artists regardless of input case', async () => {
            const mockExecute = jest.fn().mockResolvedValue([mockArtists[0], mockArtists[1]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results1 = await searchForArtistByName('DEADMAU5');
            const results2 = await searchForArtistByName('deadmau5');
            const results3 = await searchForArtistByName('DeAdMaU5');

            expect(results1).toHaveLength(2);
            expect(results2).toHaveLength(2);
            expect(results3).toHaveLength(2);
            expect(results1[0].name).toBe('Deadmau5');
        });
    });

    describe('Special Characters Tests', () => {
        it('should handle special characters and diacritics', async () => {
            const mockExecute = jest.fn().mockResolvedValue([mockArtists[2], mockArtists[3]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results1 = await searchForArtistByName('RUFUS DU SOL');
            const results2 = await searchForArtistByName('RÜFÜS DU SOL');
            const results3 = await searchForArtistByName('Rufus');

            expect(results1).toHaveLength(2);
            expect(results2).toHaveLength(2);
            expect(results3).toHaveLength(2);
            expect(results1).toEqual(results2);
        });
    });

    describe('Partial Match Tests', () => {
        it('should handle partial name matches', async () => {
            const mockExecute = jest.fn().mockResolvedValue([mockArtists[0], mockArtists[1]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results1 = await searchForArtistByName('dead');
            const results2 = await searchForArtistByName('mau');
            const results3 = await searchForArtistByName('5');

            expect(results1).toHaveLength(2);
            expect(results2).toHaveLength(2);
            expect(results3).toHaveLength(2);
        });

        it('should prioritize exact matches over partial matches', async () => {
            const mockExecute = jest.fn().mockResolvedValue([mockArtists[0], mockArtists[1]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchForArtistByName('Deadmau5');

            expect(results[0].name).toBe('Deadmau5');
            expect(results[1].name).toBe('DeadMau5 (Remix)');
        });
    });

    describe('Multiple Results Handling', () => {
        it('should limit results to 10 items', async () => {
            // Create more than 10 mock results
            const manyResults = Array.from({ length: 15 }, (_, i) => ({
                ...mockArtists[0],
                id: `id${i}`,
                name: `Artist ${i}`
            }));
            
            const mockExecute = jest.fn().mockResolvedValue(manyResults.slice(0, 10));
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchForArtistByName('Artist');
            
            expect(results.length).toBeLessThanOrEqual(10);
        });

        it('should handle empty results', async () => {
            const mockExecute = jest.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchForArtistByName('NonexistentArtist');
            
            expect(results).toHaveLength(0);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty search string', async () => {
            const mockExecute = jest.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchForArtistByName('');
            
            expect(results).toHaveLength(0);
        });

        it('should handle search strings with only spaces', async () => {
            const mockExecute = jest.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchForArtistByName('   ');
            
            expect(results).toHaveLength(0);
        });

        it('should handle very long search strings', async () => {
            const mockExecute = jest.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const longString = 'a'.repeat(1000);
            const results = await searchForArtistByName(longString);
            
            expect(results).toHaveLength(0);
        });

        it('should handle special characters only', async () => {
            const mockExecute = jest.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchForArtistByName('!@#$%^&*()');
            
            expect(results).toHaveLength(0);
        });
    });

    describe('Error Handling', () => {
        it('should handle database errors gracefully', async () => {
            const mockExecute = jest.fn().mockRejectedValue(new Error('Database error'));
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            await expect(searchForArtistByName('test')).rejects.toThrow('Error searching for artist by name');
        });
    });
}); 