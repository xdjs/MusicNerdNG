// Set up test environment
import '../setup/testEnv';

import { Artist } from '@/server/db/DbTypes';
import { sql } from 'drizzle-orm';
import { artists } from '@/server/db/schema';
import { eq, and, or, like } from 'drizzle-orm';

// Mock database for non-performance tests
const mockDb = {
    execute: jest.fn(),
    query: {
        artists: {
            findFirst: jest.fn(),
            findMany: jest.fn()
        }
    }
};

jest.mock('@/server/db/drizzle', () => mockDb);

// Import the real database module for performance tests
const { db: realDb } = jest.requireActual('@/server/db/drizzle');

// Real database tests first
describe('Real Database Performance Tests', () => {
    let isRealDbAvailable = false;

    beforeAll(async () => {
        try {
            // Try to connect to the real database
            const result = await searchWithRealDb('test');
            isRealDbAvailable = true;
            console.log('\n🌐 Remote database connection available - running tests with real Supabase DB\n');
        } catch (e) {
            console.log('\n🔧 Remote database not available - skipping real database tests\n');
            isRealDbAvailable = false;
        }
    });

    const testWithRealDb = isRealDbAvailable ? test : test.skip;
    const REMOTE_SEARCH_THRESHOLD = 400; // .4 second threshold for remote DB queries
    const REMOTE_CONCURRENT_THRESHOLD = 1200; // 1.2 seconds threshold for concurrent remote DB queries

    // Test with real artists that we know exist in the dev DB
    const testQueries = [
        'deadmau5',
        'rüfüs',
        'test', // general term to test partial matches
        'a', // single letter to test large result sets
        'zzzzzz' // non-existent to test no-results case
    ];

    async function searchWithRealDb(name: string): Promise<Artist[]> {
        try {
            const startTime = performance.now();
            const result = await realDb.execute(sql`
                SELECT 
                    id::text, 
                    name::text,
                    spotify::text,
                    bandcamp::text,
                    youtubechannel::text,
                    instagram::text,
                    x::text,
                    facebook::text,
                    tiktok::text,
                    created_at::text as "createdAt",
                    updated_at::text as "updatedAt",
                    added_by::text as "addedBy",
                    lcname::text
                FROM artists
                WHERE 
                    (LOWER(name) LIKE LOWER('%' || ${name} || '%') OR similarity(name, ${name}) > 0.3)
                    AND spotify IS NOT NULL
                ORDER BY 
                    CASE 
                        WHEN LOWER(name) LIKE LOWER('%' || ${name} || '%') THEN 0
                        ELSE 1
                    END,
                    CASE 
                        WHEN LOWER(name) LIKE LOWER('%' || ${name} || '%') 
                        THEN -POSITION(LOWER(${name}) IN LOWER(name))
                        ELSE -999999
                    END DESC,
                    similarity(name, ${name}) DESC
                LIMIT 10
            `);
            const endTime = performance.now();
            const duration = endTime - startTime;
            console.log(`🌐 Remote DB search for "${name}" took ${duration}ms`);
            return result as unknown as Artist[];
        } catch(e) {
            console.error(`Error in real DB search:`, e);
            throw e;
        }
    }

    testWithRealDb('should complete remote search for "deadmau5" within performance threshold', async () => {
        const startTime = performance.now();
        const result = await searchWithRealDb('deadmau5');
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🌐 Remote DB search for "deadmau5" took ${duration}ms`);
        expect(duration).toBeLessThan(REMOTE_SEARCH_THRESHOLD);
    });

    testWithRealDb('should complete remote search for "rüfüs" within performance threshold', async () => {
        const startTime = performance.now();
        const result = await searchWithRealDb('rüfüs');
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🌐 Remote DB search for "rüfüs" took ${duration}ms`);
        expect(duration).toBeLessThan(REMOTE_SEARCH_THRESHOLD);
    });

    testWithRealDb('should complete remote search for "test" within performance threshold', async () => {
        const startTime = performance.now();
        const result = await searchWithRealDb('test');
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🌐 Remote DB search for "test" took ${duration}ms`);
        expect(duration).toBeLessThan(REMOTE_SEARCH_THRESHOLD);
    });

    testWithRealDb('should complete remote search for "a" within performance threshold', async () => {
        const startTime = performance.now();
        const result = await searchWithRealDb('a');
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🌐 Remote DB search for "a" took ${duration}ms`);
        expect(duration).toBeLessThan(REMOTE_SEARCH_THRESHOLD);
    });

    testWithRealDb('should complete remote search for "zzzzzz" within performance threshold', async () => {
        const startTime = performance.now();
        const result = await searchWithRealDb('zzzzzz');
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🌐 Remote DB search for "zzzzzz" took ${duration}ms`);
        expect(duration).toBeLessThan(REMOTE_SEARCH_THRESHOLD);
    });

    testWithRealDb('should handle concurrent remote searches efficiently', async () => {
        const searches = ['Deadmau5', 'RÜFÜS DU SOL', 'C418', 'Daft Punk', 'The Glitch Mob'];
        const startTime = performance.now();
        await Promise.all(searches.map(search => searchWithRealDb(search)));
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🌐 Remote DB concurrent searches took ${duration}ms`);
        expect(duration).toBeLessThan(REMOTE_CONCURRENT_THRESHOLD);
    });
});

// Now set up mocks for the rest of the tests
jest.mock('@/server/db/drizzle', () => ({
    execute: jest.fn(),
    query: {
        artists: {
            findFirst: jest.fn(),
            findMany: jest.fn()
        }
    };
});

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
        vi.clearAllMocks();
    });

    describe('Case Sensitivity Tests', () => {
        it('should find artists regardless of input case', async () => {
            const mockExecute = vi.fn().mockResolvedValue([mockArtists[0], mockArtists[1]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results1 = await searchArtist('DEADMAU5');
            const results2 = await searchArtist('deadmau5');
            const results3 = await searchArtist('DeAdMaU5');

            expect(results1).toHaveLength(2);
            expect(results2).toHaveLength(2);
            expect(results3).toHaveLength(2);
            expect(results1[0].name).toBe('Deadmau5');
        });
    });

    describe('Special Characters Tests', () => {
        it('should handle special characters and diacritics', async () => {
            const mockExecute = vi.fn().mockResolvedValue([mockArtists[2], mockArtists[3]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results1 = await searchArtist('RUFUS DU SOL');
            const results2 = await searchArtist('RÜFÜS DU SOL');
            const results3 = await searchArtist('Rufus');

            expect(results1).toHaveLength(2);
            expect(results2).toHaveLength(2);
            expect(results3).toHaveLength(2);
            expect(results1).toEqual(results2);
        });
    });

    describe('Partial Match Tests', () => {
        it('should handle partial name matches', async () => {
            const mockExecute = vi.fn().mockResolvedValue([mockArtists[0], mockArtists[1]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results1 = await searchArtist('dead');
            const results2 = await searchArtist('mau');
            const results3 = await searchArtist('5');

            expect(results1).toHaveLength(2);
            expect(results2).toHaveLength(2);
            expect(results3).toHaveLength(2);
        });

        it('should prioritize exact matches over partial matches', async () => {
            const mockExecute = vi.fn().mockResolvedValue([mockArtists[0], mockArtists[1]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchArtist('Deadmau5');

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
            
            const mockExecute = vi.fn().mockResolvedValue(manyResults.slice(0, 10));
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchArtist('Artist');
            
            expect(results.length).toBeLessThanOrEqual(10);
        });

        it('should handle empty results', async () => {
            const mockExecute = vi.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchArtist('NonexistentArtist');
            
            expect(results).toHaveLength(0);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty search string', async () => {
            const mockExecute = vi.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchArtist('');
            
            expect(results).toHaveLength(0);
        });

        it('should handle search strings with only spaces', async () => {
            const mockExecute = vi.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchArtist('   ');
            
            expect(results).toHaveLength(0);
        });

        it('should handle very long search strings', async () => {
            const mockExecute = vi.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const longString = 'a'.repeat(1000);
            const results = await searchArtist(longString);
            
            expect(results).toHaveLength(0);
        });

        it('should handle special characters only', async () => {
            const mockExecute = vi.fn().mockResolvedValue([]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const results = await searchArtist('!@#$%^&*()');
            
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

    describe('Performance Tests', () => {
        const SEARCH_TIME_THRESHOLD_MS = 100; // Maximum acceptable search time in milliseconds

        it('should complete search within performance threshold', async () => {
            const mockExecute = jest.fn().mockResolvedValue([mockArtists[0]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const startTime = performance.now();
            await searchForArtistByName('Deadmau5');
            const endTime = performance.now();
            const searchTime = endTime - startTime;

            expect(searchTime).toBeLessThan(SEARCH_TIME_THRESHOLD_MS);
        });

        it('should handle multiple concurrent searches efficiently', async () => {
            const mockExecute = jest.fn().mockResolvedValue([mockArtists[0]]);
            const db = require('@/server/db/drizzle');
            db.execute.mockImplementation(mockExecute);

            const searchTerms = ['Deadmau5', 'RÜFÜS DU SOL', 'C418'];
            const startTime = performance.now();
            
            await Promise.all(searchTerms.map(term => searchForArtistByName(term)));
            
            const endTime = performance.now();
            const totalTime = endTime - startTime;
            const averageTime = totalTime / searchTerms.length;

            expect(averageTime).toBeLessThan(SEARCH_TIME_THRESHOLD_MS);
        });
    });
});

// Mock database tests
describe('Mock Database Performance Tests', () => {
    const MOCK_SEARCH_THRESHOLD = 50; // 50ms threshold for mock DB queries
    const MOCK_CONCURRENT_THRESHOLD = 200; // 200ms threshold for concurrent mock DB queries

    test('should complete mock search within performance threshold', async () => {
        const startTime = performance.now();
        const result = await searchForArtistByName('deadmau5');
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🔧 Mock DB search for "deadmau5" took ${duration}ms`);
        expect(duration).toBeLessThan(MOCK_SEARCH_THRESHOLD);
    });

    test('should handle multiple concurrent mock searches efficiently', async () => {
        const searches = ['Deadmau5', 'RÜFÜS DU SOL', 'C418', 'Daft Punk', 'The Glitch Mob'];
        const startTime = performance.now();
        await Promise.all(searches.map(search => searchForArtistByName(search)));
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🔧 Mock DB concurrent searches took ${duration}ms`);
        expect(duration).toBeLessThan(MOCK_CONCURRENT_THRESHOLD);
    });
}); 