import { describe, it, expect, beforeEach, jest } from '@jest/globals';
// mocks will be set before importing module under test

// Mock dependencies
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getServerAuthSession } = require('../../auth') as { getServerAuthSession: jest.Mock };

// Import the function under test after mocks are in place
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { removeArtistData } = require('../queriesTS');

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

  it('allows deletion when walletless mode enabled', async () => {
    process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'true';
    (getServerAuthSession as any).mockResolvedValue(null);

    const resp = await removeArtistData(ARTIST_ID, SITE_NAME);

    expect(resp.status).toBe('success');
    expect(db.execute).toHaveBeenCalled();
  });

  it('rejects unauthenticated user when walletless disabled', async () => {
    process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';
    (getServerAuthSession as any).mockResolvedValue({ user: { id: 'user-1' } });
    (db.query.users.findFirst as jest.Mock).mockImplementation(async () => ({ isWhiteListed: false, isAdmin: false }));

    const resp = await removeArtistData(ARTIST_ID, SITE_NAME);
    expect(resp.status).toBe('error');
    expect(resp.message).toBe('Unauthorized');
  });

  it('allows whitelisted user', async () => {
    process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';
    (getServerAuthSession as any).mockResolvedValue({ user: { id: 'user-2' } });
    (db.query.users.findFirst as jest.Mock).mockImplementation(async () => ({ isWhiteListed: true, isAdmin: false }));

    const resp = await removeArtistData(ARTIST_ID, SITE_NAME);

    expect(resp.status).toBe('success');
    expect(db.execute).toHaveBeenCalledWith(expect.anything());
  });
}); 