import { POST } from '@/app/api/searchArtists/route';
import { searchForArtistByName, getAllSpotifyIds } from '@/server/utils/queriesTS';
import { getSpotifyHeaders } from '@/server/utils/externalApiQueries';
import axios from 'axios';

jest.mock('@/server/utils/queriesTS');
jest.mock('@/server/utils/externalApiQueries');
jest.mock('axios');

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

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('searchArtists API route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for invalid query', async () => {
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

  it('combines and sorts search results', async () => {
    (searchForArtistByName as jest.Mock).mockResolvedValue([
      { id: '1', name: 'Alpha', spotify: 'spotify1' },
      { id: '2', name: 'Beta', spotify: null },
    ]);

    (getSpotifyHeaders as jest.Mock).mockResolvedValue({ headers: { Authorization: 'Bearer token' } });
    (getAllSpotifyIds as jest.Mock).mockResolvedValue(['spotify1']);

    mockedAxios.get.mockResolvedValueOnce({ data: { images: [{ url: 'img1', height: 1, width: 1 }] } });
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        artists: {
          items: [
            { id: 'spotify1', name: 'Alpha', images: [{ url: 'img1', height: 1, width: 1 }] },
            { id: 'new1', name: 'AlphaBeta', images: [{ url: 'img2', height: 1, width: 1 }] },
          ],
        },
      },
    });

    const response = await POST(
      createTestRequest('http://localhost/api/searchArtists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Alpha' }),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.results).toHaveLength(3);
    expect(body.results[0].name).toBe('Alpha');
    expect(body.results[1].name).toBe('AlphaBeta');
    expect(body.results[2].name).toBe('Beta');
  });
});
