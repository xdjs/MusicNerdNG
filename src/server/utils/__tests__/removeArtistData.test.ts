/* eslint-disable */
// @ts-nocheck
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
// mocks will be set before importing module under test

// Mock dependencies
jest.mock('@/server/utils/artistLinkService', () => ({
  ArtistLinkConflictError: class ArtistLinkConflictError extends Error {},
  setArtistLink: jest.fn().mockResolvedValue(undefined),
  clearArtistLink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/server/db/drizzle', () => {
  return {
    db: {
      execute: jest.fn(),
      delete: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve()),
      })),
      where: jest.fn(() => Promise.resolve()),
      // Stub for db.query.users.findFirst used by getUserById
      query: {
        users: {
          findFirst: jest.fn(),
        },
      },
    },
  };
});

// Import real auth module and spy on the function we need
jest.mock('../../auth', () => ({
  getServerAuthSession: jest.fn(),
}));

// Spy on getUserById – we must import the module after mocks are set
import { db } from '@/server/db/drizzle';

// get the mocked auth fn
const { getServerAuthSession } = require('../../auth') as { getServerAuthSession: jest.Mock };

// Import the function under test after mocks are in place
const { removeArtistData } = require('../queries');
const { clearArtistLink } = require('@/server/utils/artistLinkService') as { clearArtistLink: jest.Mock };

const ARTIST_ID = 'artist-123';
const SITE_NAME = 'spotify';

describe('removeArtistData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getServerAuthSession.mockReset();
    // Ensure db.execute returns resolved promise
    (db.execute as jest.Mock).mockImplementation(async () => undefined);

    // Mock delete -> where chain each run
    (db.delete as jest.Mock).mockImplementation(() => ({
      where: jest.fn(() => Promise.resolve()),
    }));
  });

  it('rejects unauthenticated user', async () => {
    (getServerAuthSession as any).mockResolvedValue(null);

    await expect(removeArtistData(ARTIST_ID, SITE_NAME)).rejects.toThrow('Not authenticated');
  });

  it('rejects non-whitelisted, non-admin user', async () => {
    (getServerAuthSession as any).mockResolvedValue({ user: { id: 'user-1' } });
    (db.query.users.findFirst as jest.Mock).mockImplementation(async () => ({ isWhiteListed: false, isAdmin: false }));

    const resp = await removeArtistData(ARTIST_ID, SITE_NAME);
    expect(resp.status).toBe('error');
    expect(resp.message).toBe('Unauthorized');
  });

  it('allows whitelisted user', async () => {
    (getServerAuthSession as any).mockResolvedValue({ user: { id: 'user-2' } });
    (db.query.users.findFirst as jest.Mock).mockImplementation(async () => ({ isWhiteListed: true, isAdmin: false }));

    const resp = await removeArtistData(ARTIST_ID, SITE_NAME);

    expect(resp.status).toBe('success');
    expect(clearArtistLink).toHaveBeenCalledWith(ARTIST_ID, SITE_NAME);
  });

  it('returns error for invalid platform column', async () => {
    (getServerAuthSession as any).mockResolvedValue({ user: { id: 'user-2' } });
    (db.query.users.findFirst as jest.Mock).mockImplementation(async () => ({ isWhiteListed: true, isAdmin: false }));

    const { clearArtistLink: mockClear } = require('@/server/utils/artistLinkService');
    mockClear.mockRejectedValue(new Error('Column not in writable whitelist: unknown_platform'));

    const resp = await removeArtistData(ARTIST_ID, 'unknown_platform');
    expect(resp.status).toBe('error');
    expect(resp.message).toBe('Invalid platform column');
  });
});
