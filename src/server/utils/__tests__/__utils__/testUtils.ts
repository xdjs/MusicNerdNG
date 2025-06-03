import { db } from '@/server/db/drizzle';
import { getServerAuthSession } from '@/server/auth';
import { getSpotifyHeaders, getSpotifyArtist } from '@/server/utils/externalApiQueries';
import { createMockDB } from '../__mocks__/mockDatabase';
import { createMockSession } from '../__mocks__/mockAuth';
import { createMockSpotifyHeaders, createMockSpotifyArtist, createMockSpotifyError } from '../__mocks__/mockSpotify';
import { artists } from '@/server/db/schema';

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