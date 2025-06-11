import { extractArtistId } from '../services';

// Mock getAllLinks to supply a minimal mapping for X (Twitter) links
jest.mock('../queriesTS', () => ({
  getAllLinks: jest.fn().mockResolvedValue([
    {
      // Regex captures the username portion of an x.com URL, ignoring any query params
      regex: /x\.com\/([A-Za-z0-9_]+)(?:\?[^#]*)?/,
      siteName: 'x',
      cardPlatformName: 'X',
    },
  ]),
}));

describe('extractArtistId – X links', () => {
  it('removes query parameters following a "?"', async () => {
    const url = 'https://x.com/sugar_plant?si=21';
    const result = await extractArtistId(url);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('sugar_plant');
  });

  it('returns the username unchanged when no query parameters are present', async () => {
    const url = 'https://x.com/sugar_plant';
    const result = await extractArtistId(url);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('sugar_plant');
  });
}); 