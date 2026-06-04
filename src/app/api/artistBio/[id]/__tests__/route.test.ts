// @ts-nocheck

import { jest } from '@jest/globals';

// Mock modules at the top level
jest.mock('@/server/auth', () => ({
  getServerAuthSession: jest.fn(),
}));

jest.mock('@/server/utils/queries/userQueries', () => ({
  getUserById: jest.fn(),
}));

jest.mock('@/server/utils/queries/artistQueries', () => ({
  getArtistById: jest.fn(),
  updateArtistBio: jest.fn(),
}));

jest.mock('@/server/utils/queries/artistBioQuery', () => ({
  generateArtistBio: jest.fn(),
}));

// Polyfill Response.json for test environment
if (!('json' in Response)) {
  Response.json = (data, init) =>
    new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      status: init?.status || 200,
    });
}

const createPutRequest = (body: any) =>
  new Request('http://localhost/api/artistBio/artist-123', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const createGetRequest = () =>
  new Request('http://localhost/api/artistBio/artist-123', {
    method: 'GET',
  });

const adminSession = {
  user: { id: 'admin-uuid', email: 'admin@test.com' },
  expires: '2025-12-31',
};

const regularSession = {
  user: { id: 'regular-uuid', email: 'user@test.com' },
  expires: '2025-12-31',
};

describe('/api/artistBio/[id]', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function setup() {
    const { getServerAuthSession } = await import('@/server/auth');
    const { getUserById } = await import('@/server/utils/queries/userQueries');
    const { getArtistById, updateArtistBio } = await import(
      '@/server/utils/queries/artistQueries'
    );
    const { generateArtistBio } = await import('@/server/utils/queries/artistBioQuery');
    const { GET, PUT } = await import('../route');

    return {
      GET,
      PUT,
      mockGetSession: getServerAuthSession as jest.Mock,
      mockGetUserById: getUserById as jest.Mock,
      mockGetArtistById: getArtistById as jest.Mock,
      mockUpdateArtistBio: updateArtistBio as jest.Mock,
      mockGenerateArtistBio: generateArtistBio as jest.Mock,
    };
  }

  const paramsPromise = Promise.resolve({ id: 'artist-123' });

  describe('PUT', () => {
    it('returns 401 when not authenticated', async () => {
      const { PUT, mockGetSession } = await setup();
      mockGetSession.mockResolvedValue(null);

      const response = await PUT(
        createPutRequest({ bio: 'New bio text' }),
        { params: paramsPromise }
      );

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Not authenticated');
    });

    it('returns 403 when non-admin', async () => {
      const { PUT, mockGetSession, mockGetUserById } = await setup();
      mockGetSession.mockResolvedValue(regularSession);
      mockGetUserById.mockResolvedValue({ id: 'regular-uuid', isAdmin: false });

      const response = await PUT(
        createPutRequest({ bio: 'New bio text' }),
        { params: paramsPromise }
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Forbidden');
    });

    it('returns 200 for admin with valid bio', async () => {
      const { PUT, mockGetSession, mockGetUserById, mockUpdateArtistBio } =
        await setup();
      mockGetSession.mockResolvedValue(adminSession);
      mockGetUserById.mockResolvedValue({ id: 'admin-uuid', isAdmin: true });
      mockUpdateArtistBio.mockResolvedValue({
        status: 'success',
        message: 'Bio updated',
      });

      const response = await PUT(
        createPutRequest({ bio: 'A great artist biography' }),
        { params: paramsPromise }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toBe('Bio updated');
    });

    it('returns 400 for invalid bio (empty string)', async () => {
      const { PUT, mockGetSession, mockGetUserById } = await setup();
      mockGetSession.mockResolvedValue(adminSession);
      mockGetUserById.mockResolvedValue({ id: 'admin-uuid', isAdmin: true });

      const response = await PUT(
        createPutRequest({ bio: '' }),
        { params: paramsPromise }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toBe('Invalid bio');
    });

    it('returns 400 for invalid bio (non-string)', async () => {
      const { PUT, mockGetSession, mockGetUserById } = await setup();
      mockGetSession.mockResolvedValue(adminSession);
      mockGetUserById.mockResolvedValue({ id: 'admin-uuid', isAdmin: true });

      const response = await PUT(
        createPutRequest({ bio: 12345 }),
        { params: paramsPromise }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toBe('Invalid bio');
    });

    it('returns 500 when updateArtistBio returns error', async () => {
      const { PUT, mockGetSession, mockGetUserById, mockUpdateArtistBio } =
        await setup();
      mockGetSession.mockResolvedValue(adminSession);
      mockGetUserById.mockResolvedValue({ id: 'admin-uuid', isAdmin: true });
      mockUpdateArtistBio.mockResolvedValue({
        status: 'error',
        message: 'Failed to generate bio',
      });

      const response = await PUT(
        createPutRequest({ bio: 'Some bio text' }),
        { params: paramsPromise }
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.message).toBe('Failed to generate bio');
    });

    it('returns 200 with regenerated bio when regenerate flag is set', async () => {
      const { PUT, mockGetSession, mockGetUserById, mockUpdateArtistBio } =
        await setup();
      mockGetSession.mockResolvedValue(adminSession);
      mockGetUserById.mockResolvedValue({ id: 'admin-uuid', isAdmin: true });
      mockUpdateArtistBio.mockResolvedValue({
        status: 'success',
        message: 'Bio regenerated',
        data: 'A newly generated bio from AI',
      });

      const response = await PUT(
        createPutRequest({ regenerate: true }),
        { params: paramsPromise }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toBe('Bio regenerated');
      expect(data.bio).toBe('A newly generated bio from AI');
    });
  });

  describe('GET', () => {
    it('remains public (no auth check) - returns bio when artist has one', async () => {
      const { GET, mockGetArtistById } = await setup();
      mockGetArtistById.mockResolvedValue({
        id: 'artist-123',
        bio: 'Existing artist bio',
        instagram: 'test',
        x: 'test',
        youtubechannel: null,
        soundcloud: null,
      });

      const response = await GET(createGetRequest(), { params: paramsPromise });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.bio).toBe('Existing artist bio');
    });

    it('returns 404 when artist not found', async () => {
      const { GET, mockGetArtistById } = await setup();
      mockGetArtistById.mockResolvedValue(null);

      const response = await GET(createGetRequest(), { params: paramsPromise });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Artist not found');
    });
  });
});
