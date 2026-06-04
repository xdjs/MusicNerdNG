/**
 * @jest-environment node
 */

/**
 * Deezer API Smoke Test
 *
 * Validates assumptions about Deezer API response shapes before building DeezerProvider.
 * Hits real Deezer API (requires network). Not part of CI — run on-demand:
 *
 *   npx jest --testPathIgnorePatterns='[]' --testPathPatterns=deezerApiSmoke
 */
import axios from 'axios';

jest.setTimeout(30000);

const DEEZER_BASE = 'https://api.deezer.com';
const KNOWN_ARTIST_ID = 4738512; // FKJ

describe('Deezer API Smoke Test', () => {
  it('GET /artist/:id returns expected fields with correct types', async () => {
    const { data } = await axios.get(`${DEEZER_BASE}/artist/${KNOWN_ARTIST_ID}`);

    expect(typeof data.id).toBe('number');
    expect(typeof data.name).toBe('string');
    expect(typeof data.picture_xl).toBe('string');
    expect(data.picture_xl.length).toBeGreaterThan(0);
    expect(typeof data.nb_fan).toBe('number');
    expect(data.nb_fan).toBeGreaterThan(0);
    expect(typeof data.nb_album).toBe('number');
    expect(data.nb_album).toBeGreaterThan(0);
    expect(typeof data.link).toBe('string');
  });

  it('GET /artist/:id does NOT have a genres field', async () => {
    const { data } = await axios.get(`${DEEZER_BASE}/artist/${KNOWN_ARTIST_ID}`);

    expect(data).not.toHaveProperty('genres');
  });

  it('GET /artist/:id/top?limit=1 returns top track with title and id', async () => {
    const { data } = await axios.get(
      `${DEEZER_BASE}/artist/${KNOWN_ARTIST_ID}/top?limit=1`,
    );

    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
    expect(typeof data.data[0].title).toBe('string');
    expect(typeof data.data[0].id).toBe('number');
  });

  it('GET /search/artist returns array of artists with expected fields', async () => {
    const { data } = await axios.get(
      `${DEEZER_BASE}/search/artist?q=FKJ&limit=5`,
    );

    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);

    for (const artist of data.data) {
      expect(typeof artist.id).toBe('number');
      expect(typeof artist.name).toBe('string');
      expect(typeof artist.picture_xl).toBe('string');
      expect(typeof artist.nb_fan).toBe('number');
    }
  });

  it('GET /artist/:invalidId returns an error object', async () => {
    const { data } = await axios.get(`${DEEZER_BASE}/artist/99999999999`);

    expect(data).toHaveProperty('error');
    expect(typeof data.error).toBe('object');
    expect(data.error).toHaveProperty('type');
    expect(data.error).toHaveProperty('message');
  });

  it('requests succeed without any Authorization header', async () => {
    // Explicitly ensure no auth headers are sent
    const { data, status } = await axios.get(
      `${DEEZER_BASE}/artist/${KNOWN_ARTIST_ID}`,
      { headers: {} },
    );

    expect(status).toBe(200);
    expect(typeof data.id).toBe('number');
    expect(typeof data.name).toBe('string');
  });
});
