// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/artistQueries', () => ({
  searchForArtistByName: jest.fn(),
}));

jest.mock('@/server/utils/musicPlatform', () => ({
  musicPlatformData: {
    searchArtists: jest.fn(),
    getArtistImages: jest.fn(),
  },
}));

// Polyfill Response.json for the test environment
if (!(Response as any).json) {
  (Response as any).json = (data: any, init?: ResponseInit) =>
    new Response(JSON.stringify(data), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
}

const createTestRequest = (url: string, init?: RequestInit) => new Request(url, init);

describe('searchArtists API route', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function setup() {
    const { searchForArtistByName } = await import('@/server/utils/queries/artistQueries');
    const { musicPlatformData } = await import('@/server/utils/musicPlatform');
    const { POST } = await import('@/app/api/searchArtists/route');
    return {
      POST,
      mockSearchDB: searchForArtistByName as jest.Mock,
      mockSearchExternal: musicPlatformData.searchArtists as jest.Mock,
      mockGetImages: musicPlatformData.getArtistImages as jest.Mock,
    };
  }

  it('returns 400 for invalid query', async () => {
    const { POST } = await setup();
    const response = await POST(
      createTestRequest('http://localhost/api/searchArtists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Invalid query parameter');
  });

  it('combines DB and external results, deduplicates, and sorts', async () => {
    const { POST, mockSearchDB, mockSearchExternal, mockGetImages } = await setup();

    mockSearchDB.mockResolvedValue([
      { id: '1', name: 'Alpha', spotify: 'spotify1', deezer: 'dz1' },
      { id: '2', name: 'Beta', spotify: null, deezer: null },
    ]);

    mockSearchExternal.mockResolvedValue([
      { platformId: 'dz1', platform: 'deezer', name: 'Alpha', imageUrl: 'https://cdn.deezer.com/1.jpg', profileUrl: 'https://deezer.com/artist/dz1', followerCount: 1000, albumCount: 5, genres: [], topTrackName: null },
      { platformId: 'dz-new', platform: 'deezer', name: 'AlphaBeta', imageUrl: 'https://cdn.deezer.com/2.jpg', profileUrl: 'https://deezer.com/artist/dz-new', followerCount: 500, albumCount: 3, genres: [], topTrackName: null },
    ]);

    mockGetImages.mockResolvedValue(new Map([['1', 'https://cdn.deezer.com/1.jpg']]));

    const response = await POST(
      createTestRequest('http://localhost/api/searchArtists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Alpha' }),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    // Alpha (DB, exact match), AlphaBeta (external, deduped dz1 removed), Beta (DB, no match)
    expect(body.results).toHaveLength(3);
    expect(body.results[0].name).toBe('Alpha');
    expect(body.results[0].isExternalOnly).toBe(false);
    expect(body.results[0].imageUrl).toBe('https://cdn.deezer.com/1.jpg');
    expect(body.results[1].name).toBe('AlphaBeta');
    expect(body.results[1].isExternalOnly).toBe(true);
    expect(body.results[1].platformId).toBe('dz-new');
    expect(body.results[2].name).toBe('Beta');
  });
});
