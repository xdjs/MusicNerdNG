import { extractArtistId } from '../services';

// Mock getAllLinks to supply a minimal mapping for X (Twitter) links
jest.mock('../queries/queriesTS', () => ({
  getAllLinks: jest.fn().mockResolvedValue([
    {
      // Regex captures the username portion of an x.com URL, ignoring any query params
      regex: /x\.com\/([A-Za-z0-9_]+)(?:\?[^#]*)?/,
      siteName: 'x',
      cardPlatformName: 'X',
    },
    {
      // Simplified regex to capture the article slug from an English Wikipedia link
      regex: /en\.wikipedia\.org\/wiki\/([^?#/]+)/,
      siteName: 'wikipedia',
      cardPlatformName: 'Wikipedia',
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

  describe('percent-decoding for Wikipedia links', () => {
    it('decodes percent-encoded characters in the article slug', async () => {
      const url = 'https://en.wikipedia.org/wiki/Yun%C3%A8_Pinku';
      const result = await extractArtistId(url);
      expect(result).not.toBeNull();
      expect(result?.siteName).toBe('wikipedia');
      expect(result?.id).toBe('Yunè_Pinku');
    });
  });
}); 