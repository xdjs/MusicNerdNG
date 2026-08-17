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

jest.mock('@/server/utils/queries/dashboardQueries', () => ({
  ...jest.requireActual('@/server/utils/queries/dashboardQueries'),
  getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
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

const createGetRegenerateRequest = () =>
  new Request('http://localhost/api/artistBio/artist-123?regenerate=true', {
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
    const { getVaultSourcesByArtistId } = await import('@/server/utils/queries/dashboardQueries');
    (getVaultSourcesByArtistId as jest.Mock).mockResolvedValue([]);
    const { GET, PUT } = await import('../route');

    return {
      GET,
      PUT,
      mockGetSession: getServerAuthSession as jest.Mock,
      mockGetUserById: getUserById as jest.Mock,
      mockGetArtistById: getArtistById as jest.Mock,
      mockUpdateArtistBio: updateArtistBio as jest.Mock,
      mockGenerateArtistBio: generateArtistBio as jest.Mock,
      mockGetVaultSources: getVaultSourcesByArtistId as jest.Mock,
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

    it('serves a cached claim-nudge WITHOUT regenerating when no vault sources exist', async () => {
      const { GET, mockGetArtistById, mockGenerateArtistBio, mockGetVaultSources } = await setup();
      const { ABOUT_EMPTY_STATE } = await import('@/lib/bioConstants');
      mockGetArtistById.mockResolvedValue({ id: 'artist-123', bio: ABOUT_EMPTY_STATE, spotify: 'sp1' });
      mockGetVaultSources.mockResolvedValue([]); // still genuinely sourceless

      const response = await GET(createGetRequest(), { params: paramsPromise });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.bio).toBe(ABOUT_EMPTY_STATE);
      expect(mockGenerateArtistBio).not.toHaveBeenCalled(); // no expensive re-discovery
    });

    it('self-heals a cached nudge by regenerating when vault sources have since appeared', async () => {
      const { GET, mockGetArtistById, mockGenerateArtistBio, mockGetVaultSources } = await setup();
      const { ABOUT_EMPTY_STATE } = await import('@/lib/bioConstants');
      mockGetArtistById.mockResolvedValue({ id: 'artist-123', bio: ABOUT_EMPTY_STATE, spotify: 'sp1' });
      // A truncated discovery inserted pending sources after the nudge was cached.
      mockGetVaultSources.mockImplementation((_id: string, status: string) =>
        Promise.resolve(status === 'pending' ? [{ url: 'http://e/1', title: 'T', snippet: 's' }] : []));
      mockGenerateArtistBio.mockResolvedValue(
        Response.json({ bio: 'Synthesized from the pending sources' })
      );

      const response = await GET(createGetRequest(), { params: paramsPromise });

      const data = await response.json();
      expect(mockGenerateArtistBio).toHaveBeenCalledWith('artist-123'); // regenerated from sources
      expect(data.bio).toBe('Synthesized from the pending sources');
    });

    it('rejects unauthenticated GET ?regenerate=true (gates the expensive forced regen)', async () => {
      const { GET, mockGetSession, mockGenerateArtistBio } = await setup();
      mockGetSession.mockResolvedValue(null); // unauthenticated

      const response = await GET(createGetRegenerateRequest(), { params: paramsPromise });

      expect(response.status).toBe(401);
      expect(mockGenerateArtistBio).not.toHaveBeenCalled(); // never reaches discovery/Gemini
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy(); // CORS on the 403/401
    });

    it('returns 403 (with CORS) for an authenticated non-editor on GET ?regenerate=true', async () => {
      const { GET, mockGetSession, mockGetUserById, mockGenerateArtistBio } = await setup();
      mockGetSession.mockResolvedValue(regularSession);
      mockGetUserById.mockResolvedValue({ id: 'regular-uuid', isAdmin: false }); // no claim, not admin

      const response = await GET(createGetRegenerateRequest(), { params: paramsPromise });

      expect(response.status).toBe(403);
      expect(mockGenerateArtistBio).not.toHaveBeenCalled();
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    });

    it('allows GET ?regenerate=true for an admin/editor', async () => {
      const { GET, mockGetSession, mockGetUserById, mockGetArtistById, mockGenerateArtistBio } = await setup();
      mockGetSession.mockResolvedValue(adminSession);
      mockGetUserById.mockResolvedValue({ id: 'admin-uuid', isAdmin: true });
      mockGetArtistById.mockResolvedValue({ id: 'artist-123', bio: null, spotify: 'sp1' });
      mockGenerateArtistBio.mockResolvedValue(Response.json({ bio: 'Regenerated bio' }));

      const response = await GET(createGetRegenerateRequest(), { params: paramsPromise });

      expect(mockGenerateArtistBio).toHaveBeenCalledWith('artist-123'); // auth passed → generation ran
      const data = await response.json();
      expect(data.bio).toBe('Regenerated bio');
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
