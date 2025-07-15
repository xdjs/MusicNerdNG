// Import dependencies
import { Artist } from '@/server/db/DbTypes';
import { db } from '@/server/db/drizzle';
import { artists } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { getServerAuthSession } from '@/server/auth';
import { getSpotifyHeaders, getSpotifyArtist } from '@/server/utils/queries/externalApiQueries';
import { createMockDB } from '../__mocks__/mockDatabase';
import { createMockSession } from '../__mocks__/mockAuth';
import { createMockSpotifyHeaders, createMockSpotifyArtist, createMockSpotifyError } from '../__mocks__/mockSpotify';
import { isTest } from '../../setup/testEnv';

// Setup all mocks for a test
export const setupMocks = () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock database
    const mockDb = createMockDB();

    // Mock the database operations
    Object.defineProperty(db, 'query', {
        get: () => mockDb.query
    });

    Object.defineProperty(db, 'insert', {
        value: mockDb.insert
    });

    return {
        mockDb,
        mockAuth: (userId?: string) => {
            jest.mocked(getServerAuthSession).mockResolvedValue(
                userId ? createMockSession(true) : createMockSession(false)
            );
        },
        mockSpotify: (artistName?: string, error?: string) => {
            // Always mock Spotify in test environment
            if (!isTest) {
                console.debug('Not in test environment - skipping Spotify mock');
                return;
            }

            jest.mocked(getSpotifyHeaders).mockResolvedValue({
                headers: {
                    Authorization: 'Bearer mock-token',
                    'x-token-expiry': new Date(Date.now() + 3600000).toISOString()
                }
            });
            if (error) {
                jest.mocked(getSpotifyArtist).mockResolvedValue(createMockSpotifyError(error));
            } else {
                jest.mocked(getSpotifyArtist).mockResolvedValue(
                    createMockSpotifyArtist('test-spotify-id', artistName || 'Test Artist')
                );
            }
        }
    };
};

// Export test utilities
export const createTestArtist = async (name: string): Promise<Artist> => {
    const artist: Partial<Artist> = {
        id: crypto.randomUUID(),
        name,
        spotify: `test-spotify-id-${name}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        addedBy: crypto.randomUUID(),
    };

    await db.insert(artists).values(artist);
    return artist as Artist;
};

export const cleanupTestArtist = async (id: string) => {
    await db.delete(artists).where(eq(artists.id, id));
}; 