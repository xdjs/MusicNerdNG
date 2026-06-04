// @ts-nocheck
import { jest } from "@jest/globals";

// Polyfill Response.json (JSDOM doesn't have it)
if (!('json' in Response)) {
  Response.json = (data, init) =>
    new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      status: init?.status || 200,
    });
}

// Static mocks BEFORE dynamic imports
jest.mock("@/server/utils/queries/artistQueries", () => ({
  getArtistById: jest.fn(),
}));

jest.mock("@/server/utils/queries/externalApiQueries", () => ({
  getSpotifyHeaders: jest.fn(),
  getSpotifyArtist: jest.fn(),
  getArtistTopTrackName: jest.fn(),
  getNumberOfSpotifyReleases: jest.fn(),
}));

jest.mock("@/server/utils/queries/dashboardQueries", () => ({
  getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
}));

const mockGenerateContent = jest.fn().mockResolvedValue({ text: "mocked gemini response" });
jest.mock("@/server/lib/gemini", () => ({
  getGemini: jest.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
  GEMINI_MODEL_PRO: "gemini-2.5-pro",
  GEMINI_MODEL_FLASH: "gemini-2.5-flash",
}));

describe("artistBioQuery", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGenerateContent.mockClear();
    mockGenerateContent.mockResolvedValue({ text: "mocked gemini response" });
  });

  async function setup() {
    const { db } = await import("@/server/db/drizzle");
    const { getArtistById } = await import(
      "@/server/utils/queries/artistQueries"
    );
    const { getVaultSourcesByArtistId } = await import(
      "@/server/utils/queries/dashboardQueries"
    );

    // Wire up db mocks
    db.update = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });

    const { generateArtistBio, regenerateArtistBio } =
      await import("../artistBioQuery");

    return {
      db,
      getArtistById: getArtistById as jest.Mock,
      getVaultSourcesByArtistId: getVaultSourcesByArtistId as jest.Mock,
      generateArtistBio,
      regenerateArtistBio,
    };
  }

  // ------- generateArtistBio -------

  it("returns 404 if artist not found", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(null);

    const result = await generateArtistBio("nonexistent-id");
    const data = await result.json();
    expect(data.error).toBe("Artist not found");
  });

  it("calls Gemini with constructed prompt and returns bio", async () => {
    const { generateArtistBio, getArtistById } = await setup();

    getArtistById.mockResolvedValue({
      id: "artist-1",
      name: "Test Artist",
      spotify: "spotify-123",
      instagram: "testinsta",
      x: "testx",
      soundcloud: null,
      youtube: null,
      youtubechannel: null,
      wikipedia: null,
    });

    const result = await generateArtistBio("artist-1");
    const data = await result.json();

    expect(data.bio).toBe("mocked gemini response");

    // Verify Gemini was called
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArgs = (mockGenerateContent as jest.Mock).mock.calls[0][0];
    expect(callArgs.model).toBe("gemini-2.5-pro");
    expect(callArgs.contents).toContain("Test Artist");
    expect(callArgs.contents).toContain("Spotify ID: spotify-123");
    expect(callArgs.contents).toContain("Instagram: https://instagram.com/testinsta");
    expect(callArgs.contents).toContain("X: https://x.com/testx");
  });

  it("saves bio to DB on success", async () => {
    const { generateArtistBio, getArtistById, db } = await setup();

    getArtistById.mockResolvedValue({
      id: "artist-1",
      name: "Test Artist",
      spotify: null,
      instagram: null,
      x: null,
      soundcloud: null,
      youtube: null,
      youtubechannel: null,
      wikipedia: null,
    });

    await generateArtistBio("artist-1");

    expect(db.update).toHaveBeenCalled();
    const setMock = db.update.mock.results[0].value.set;
    expect(setMock).toHaveBeenCalledWith({ bio: "mocked gemini response" });
  });

  it("returns error on Gemini failure", async () => {
    const { generateArtistBio, getArtistById } = await setup();

    getArtistById.mockResolvedValue({
      id: "artist-1",
      name: "Test Artist",
      spotify: null,
      instagram: null,
      x: null,
      soundcloud: null,
      youtube: null,
      youtubechannel: null,
      wikipedia: null,
    });

    // Override the mock to throw
    (mockGenerateContent as jest.Mock).mockRejectedValueOnce(
      new Error("Gemini API error")
    );

    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const result = await generateArtistBio("artist-1");
    const data = await result.json();

    expect(data.error).toBe("Failed to generate bio");
    consoleSpy.mockRestore();
  });

  it("includes YouTube with @ prefix stripped in prompt", async () => {
    const { generateArtistBio, getArtistById } = await setup();

    getArtistById.mockResolvedValue({
      id: "artist-1",
      name: "Test Artist",
      spotify: null,
      instagram: null,
      x: null,
      soundcloud: null,
      youtube: "@TestChannel",
      youtubechannel: null,
      wikipedia: null,
    });

    await generateArtistBio("artist-1");

    const callArgs = (mockGenerateContent as jest.Mock).mock.calls[0][0];
    expect(callArgs.contents).toContain("YouTube: https://youtube.com/@TestChannel");
    expect(callArgs.contents).not.toContain("@@");
  });

  it("includes prompt parts in correct order", async () => {
    const { generateArtistBio, getArtistById } = await setup();

    getArtistById.mockResolvedValue({
      id: "artist-1",
      name: "Cool Band",
      spotify: null,
      instagram: null,
      x: null,
      soundcloud: "sc-link",
      youtube: null,
      youtubechannel: "yt-channel-id",
      wikipedia: null,
    });

    await generateArtistBio("artist-1");

    const callArgs = (mockGenerateContent as jest.Mock).mock.calls[0][0];
    expect(callArgs.contents).toContain("Cool Band");
    expect(callArgs.contents).toContain("SoundCloud: sc-link");
    expect(callArgs.contents).toContain("YouTube Channel: yt-channel-id");
  });

  it("uses Google Search grounding when vault sources exist", async () => {
    const { generateArtistBio, getArtistById, gemini, getVaultSourcesByArtistId } = await setup();

    getArtistById.mockResolvedValue({
      id: "artist-1",
      name: "Test Artist",
      spotify: null,
      instagram: null,
      x: null,
      soundcloud: null,
      youtube: null,
      youtubechannel: null,
      wikipedia: null,
    });
    getVaultSourcesByArtistId.mockResolvedValue([
      { url: "https://example.com/article", title: "Test Article", snippet: "A snippet", extractedText: "Some text" },
    ]);

    await generateArtistBio("artist-1");

    const callArgs = (mockGenerateContent as jest.Mock).mock.calls[0][0];
    expect(callArgs.config.tools).toEqual([{ googleSearch: {} }]);
    expect(callArgs.contents).toContain("VAULT CONTEXT");
  });

  // ------- regenerateArtistBio -------

  it("regenerateArtistBio returns bio string on success", async () => {
    const { regenerateArtistBio, getArtistById } = await setup();

    getArtistById.mockResolvedValue({
      id: "artist-1",
      name: "Test Artist",
      spotify: null,
      instagram: null,
      x: null,
      soundcloud: null,
      youtube: null,
      youtubechannel: null,
      wikipedia: null,
    });

    const result = await regenerateArtistBio("artist-1");
    expect(result).toBe("mocked gemini response");
  });

  it("regenerateArtistBio returns null when artist not found", async () => {
    const { regenerateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(null);

    const result = await regenerateArtistBio("nonexistent-id");
    expect(result).toBeNull();
  });
});
