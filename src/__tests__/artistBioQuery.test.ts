// @ts-nocheck
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { NextResponse } from 'next/server';

// Mock NextResponse
const mockNextResponseJson = jest.fn().mockImplementation((data, options) => ({
  json: () => Promise.resolve(data),
  status: (options as any)?.status ?? 200,
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: mockNextResponseJson
  }
}));

// Mock dependencies
const mockGenerateContent = jest.fn();
jest.mock('@/server/lib/gemini', () => ({
  getGemini: jest.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
  GEMINI_MODEL_PRO: 'gemini-2.5-pro',
  GEMINI_MODEL_FLASH: 'gemini-2.5-flash',
}));

jest.mock('@/server/utils/queries/artistQueries', () => ({
  getArtistById: jest.fn()
}));

jest.mock('@/server/db/drizzle', () => ({
  db: {
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn(() => Promise.resolve()),
      }),
    }),
  },
}));

jest.mock('@/server/db/schema', () => ({
  artists: {}
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn()
}));

jest.mock('@/server/utils/queries/externalApiQueries', () => ({
  getArtistTopTrackName: jest.fn(),
  getNumberOfSpotifyReleases: jest.fn(),
  getSpotifyArtist: jest.fn(),
  getSpotifyHeaders: jest.fn()
}));

jest.mock('@/server/utils/queries/dashboardQueries', () => ({
  getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
}));

describe('artistBioQuery - Gemini bio generation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockNextResponseJson.mockClear();
    mockGenerateContent.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should generate a bio using Gemini', async () => {
    // Mock the artist data
    const mockArtist = {
      id: 'test-id',
      name: 'Test Artist',
      spotify: null,
      instagram: null,
      x: null,
      soundcloud: null,
      youtube: null,
      youtubechannel: null,
      wikipedia: null
    } as any;

    // Mock the Gemini response
    const mockGeminiResponse = {
      text: 'Generated bio text from Gemini'
    } as any;

    // Import mocked modules
    const { getArtistById } = await import('@/server/utils/queries/artistQueries');

    // Setup mocks
    (getArtistById as any).mockResolvedValue(mockArtist);
    mockGenerateContent.mockResolvedValue(mockGeminiResponse);

    // Import and call the function
    const { generateArtistBio } = await import('@/server/utils/queries/artistBioQuery');
    await generateArtistBio('test-id');

    // Verify Gemini was called
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-pro',
        contents: expect.stringContaining('Test Artist'),
        config: expect.objectContaining({
          systemInstruction: expect.any(String),
        }),
      })
    );

    // Verify NextResponse.json was called with the bio
    expect(mockNextResponseJson).toHaveBeenCalledWith({ bio: 'Generated bio text from Gemini' });
  });

  it('should use Google Search grounding when vault sources exist', async () => {
    const mockArtist = {
      id: 'test-id',
      name: 'Test Artist',
      spotify: null,
      instagram: null,
      x: null,
      soundcloud: null,
      youtube: null,
      youtubechannel: null,
      wikipedia: null
    } as any;

    const mockGeminiResponse = {
      text: 'Bio with vault context'
    } as any;

    const { getArtistById } = await import('@/server/utils/queries/artistQueries');
    const { getVaultSourcesByArtistId } = await import('@/server/utils/queries/dashboardQueries');

    (getArtistById as any).mockResolvedValue(mockArtist);
    mockGenerateContent.mockResolvedValue(mockGeminiResponse);
    (getVaultSourcesByArtistId as any).mockResolvedValue([
      { url: 'https://example.com/article', title: 'Test Article', snippet: 'A snippet', extractedText: 'Some text' },
    ]);

    const { generateArtistBio } = await import('@/server/utils/queries/artistBioQuery');
    await generateArtistBio('test-id');

    // Verify Gemini was called with google search tool
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          tools: [{ googleSearch: {} }],
        }),
      })
    );
  });

  it('should return 404 when artist not found', async () => {
    const { getArtistById } = await import('@/server/utils/queries/artistQueries');
    (getArtistById as any).mockResolvedValue(null);

    const { generateArtistBio } = await import('@/server/utils/queries/artistBioQuery');
    await generateArtistBio('nonexistent-id');

    expect(mockNextResponseJson).toHaveBeenCalledWith(
      { error: "Artist not found" },
      { status: 404 }
    );
  });
});
