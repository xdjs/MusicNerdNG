// @ts-nocheck
import { jest } from "@jest/globals";
import { ABOUT_EMPTY_STATE } from "@/lib/bioConstants";

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
  getSpotifyHeaders: jest.fn().mockResolvedValue({ headers: {} }),
  getSpotifyArtist: jest.fn(),
  getArtistTopTrackName: jest.fn(),
  getNumberOfSpotifyReleases: jest.fn(),
  getSpotifyCatalogNames: jest.fn().mockResolvedValue({ releases: [], topTracks: [] }),
}));

const mockResolveGrounding = jest.fn().mockResolvedValue(null);
jest.mock("@/server/utils/verifiedGrounding", () => ({
  resolveVerifiedGrounding: (...args: unknown[]) => mockResolveGrounding(...args),
}));

const mockSearchAndPopulate = jest.fn();
jest.mock("@/server/utils/queries/vaultWebSearch", () => ({
  searchAndPopulateVault: (...args: unknown[]) => mockSearchAndPopulate(...args),
}));

jest.mock("@/server/utils/queries/dashboardQueries", () => ({
  getVaultSourcesByArtistId: jest.fn(),
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

// A single discovered source — enough to trigger synthesis (grounding-off write).
const DISCOVERED = [{ url: "https://d/1", title: "Discovered Source", snippet: "a real snippet", extractedText: "extracted text" }];

// Build an artist row with sensible null defaults; override what the test needs.
function artist(overrides = {}) {
  return {
    id: "artist-1", name: "Test Artist",
    spotify: null, instagram: null, x: null, soundcloud: null,
    youtube: null, youtubechannel: null,
    wikipedia: null, musicbrainz: null, discogs: null, wikidata: null,
    ...overrides,
  };
}

describe("artistBioQuery (unified sourcing flow)", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGenerateContent.mockClear();
    mockGenerateContent.mockResolvedValue({ text: "mocked gemini response" });
    mockResolveGrounding.mockClear();
    mockResolveGrounding.mockResolvedValue(null);
    // Default: empty vault, and discovery finds one source → synthesis runs.
    mockSearchAndPopulate.mockReset();
    mockSearchAndPopulate.mockResolvedValue(DISCOVERED);
  });

  async function setup() {
    const { db } = await import("@/server/db/drizzle");
    const { getArtistById } = await import("@/server/utils/queries/artistQueries");
    const { getVaultSourcesByArtistId } = await import("@/server/utils/queries/dashboardQueries");

    // Default: both approved + pending empty → discovery path.
    (getVaultSourcesByArtistId as jest.Mock).mockResolvedValue([]);

    db.update = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });

    const { generateArtistBio, regenerateArtistBio } = await import("../artistBioQuery");

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

  it("synthesizes the About from discovered sources when the vault is empty", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({ spotify: "spotify-123", instagram: "testinsta", x: "testx" }));

    const result = await generateArtistBio("artist-1");
    const data = await result.json();

    expect(data.bio).toBe("mocked gemini response");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArgs = (mockGenerateContent as jest.Mock).mock.calls[0][0];
    expect(callArgs.model).toBe("gemini-2.5-pro");
    expect(callArgs.contents).toContain("Test Artist");
    expect(callArgs.contents).toContain("open.spotify.com/artist/spotify-123");
    expect(callArgs.contents).not.toContain("Spotify ID: spotify-123"); // no bare ID
    expect(callArgs.contents).toContain("Instagram: https://instagram.com/testinsta");
    expect(callArgs.contents).toContain("X: https://x.com/testx");
    // Discovered source is injected as SOURCES for synthesis.
    expect(callArgs.contents).toContain("SOURCES");
    expect(callArgs.contents).toContain("Discovered Source");
  });

  it("enforces guardrails, uses 'Music Nerd' (two words), and tells the model it has NO web access", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({ name: "Black Dave MK2", spotify: "7cOl6pCLdiRKfC8nnNQ0ax" }));

    await generateArtistBio("artist-1");

    const call = (mockGenerateContent as jest.Mock).mock.calls[0][0];
    const sys = call.config.systemInstruction;
    expect(sys).toContain("Music Nerd");
    expect(sys).not.toMatch(/MusicNerd\b/);              // brand fixed
    expect(sys).toMatch(/IDENTITY/i);                     // identity anchoring
    expect(sys).toMatch(/CATALOG IS GROUND TRUTH|discard it/i); // catalog-anchor (Sammie fix)
    expect(sys).toMatch(/collaborated with/i);           // relationship precision
    expect(sys).toMatch(/your own words|never copy/i);   // originality
    expect(sys).toMatch(/NO web access|ONLY the curated sources/i); // grounding-off synthesis
  });

  it("injects verified encyclopedic grounding + real catalog when available", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    const external = await import("@/server/utils/queries/externalApiQueries");
    (external.getSpotifyCatalogNames as jest.Mock).mockResolvedValue({
      releases: ["SS23", "Aspiring Gundam Pilot"], topTracks: ["Lavender"],
    });
    mockResolveGrounding.mockResolvedValue({
      source: "wikipedia", url: "https://en.wikipedia.org/wiki/X", extract: "Dave Curry is a musician from Charleston.",
    });
    getArtistById.mockResolvedValue(artist({ name: "Black Dave MK2", spotify: "7cOl6pCLdiRKfC8nnNQ0ax" }));

    await generateArtistBio("artist-1");

    const contents = (mockGenerateContent as jest.Mock).mock.calls[0][0].contents;
    expect(contents).toContain("Charleston");        // grounding injected
    expect(contents).toContain("SS23");              // real releases injected
    expect(contents).toContain("Aspiring Gundam Pilot");
    expect(contents).toContain("Lavender");          // top track injected
  });

  it("researches (discovery) when the vault is empty", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({ id: "a3", name: "Thin Artist", spotify: "sp3" }));

    await generateArtistBio("a3");

    expect(mockSearchAndPopulate).toHaveBeenCalledWith("a3");
  });

  it("uses approved vault sources and does NOT re-run discovery", async () => {
    const { generateArtistBio, getArtistById, getVaultSourcesByArtistId } = await setup();
    getVaultSourcesByArtistId.mockImplementation((_id: string, status: string) =>
      Promise.resolve(status === "approved"
        ? [{ url: "http://e/1", title: "Approved Source", snippet: "s", extractedText: "x" }]
        : []));
    getArtistById.mockResolvedValue(artist({ id: "a4", name: "Curated Artist", spotify: "sp4" }));

    await generateArtistBio("a4");

    expect(mockSearchAndPopulate).not.toHaveBeenCalled();
    const contents = (mockGenerateContent as jest.Mock).mock.calls[0][0].contents;
    expect(contents).toContain("Approved Source");
  });

  it("uses already-discovered pending sources instead of re-running discovery", async () => {
    const { generateArtistBio, getArtistById, getVaultSourcesByArtistId } = await setup();
    getVaultSourcesByArtistId.mockImplementation((_id: string, status: string) =>
      Promise.resolve(status === "pending"
        ? [{ url: "http://e/2", title: "Pending Source", snippet: "s", extractedText: "x" }]
        : []));
    getArtistById.mockResolvedValue(artist({ id: "a5", name: "Pending Artist", spotify: "sp5" }));

    await generateArtistBio("a5");

    expect(mockSearchAndPopulate).not.toHaveBeenCalled();
    const contents = (mockGenerateContent as jest.Mock).mock.calls[0][0].contents;
    expect(contents).toContain("Pending Source");
  });

  it("returns and saves the claim-nudge (no synthesis) when no sources can be found", async () => {
    const { generateArtistBio, getArtistById, db } = await setup();
    mockSearchAndPopulate.mockResolvedValue([]); // discovery finds nothing
    getArtistById.mockResolvedValue(artist({ name: "Obscure Artist", spotify: "sp9" }));

    const result = await generateArtistBio("artist-1");
    const data = await result.json();

    expect(data.bio).toBe(ABOUT_EMPTY_STATE);
    expect(data.empty).toBe(true);
    expect(mockGenerateContent).not.toHaveBeenCalled();      // never guesses a bio
    const setMock = db.update.mock.results[0].value.set;
    expect(setMock).toHaveBeenCalledWith({ bio: ABOUT_EMPTY_STATE }); // cached so we don't re-discover every view
  });

  it("does NOT use Google Search grounding — synthesis is offline (namesake conflation fix)", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({ spotify: "sp1" }));

    await generateArtistBio("artist-1");

    const callArgs = (mockGenerateContent as jest.Mock).mock.calls[0][0];
    expect(callArgs.config.tools).toBeUndefined();
  });

  it("saves the synthesized bio to the DB on success", async () => {
    const { generateArtistBio, getArtistById, db } = await setup();
    getArtistById.mockResolvedValue(artist({ spotify: "sp1" }));

    await generateArtistBio("artist-1");

    expect(db.update).toHaveBeenCalled();
    const setMock = db.update.mock.results[0].value.set;
    expect(setMock).toHaveBeenCalledWith({ bio: "mocked gemini response" });
  });

  it("strips markdown citations before saving and returning the bio", async () => {
    const { generateArtistBio, getArtistById, db } = await setup();
    mockGenerateContent.mockResolvedValue({
      text: "Her debut landed in 2019. ([example.com](https://example.com/a?utm_source=openai))",
    });
    getArtistById.mockResolvedValue(artist({ spotify: "sp1" }));

    const result = await generateArtistBio("artist-1");
    const data = await result.json();

    expect(data.bio).toBe("Her debut landed in 2019.");
    const setMock = db.update.mock.results[0].value.set;
    expect(setMock).toHaveBeenCalledWith({ bio: "Her debut landed in 2019." });
  });

  it("returns error on Gemini failure", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({ spotify: "sp1" }));
    (mockGenerateContent as jest.Mock).mockRejectedValueOnce(new Error("Gemini API error"));

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await generateArtistBio("artist-1");
    const data = await result.json();

    expect(data.error).toBe("Failed to generate bio");
    consoleSpy.mockRestore();
  });

  it("includes YouTube with @ prefix stripped in prompt", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({ spotify: "sp1", youtube: "@TestChannel" }));

    await generateArtistBio("artist-1");

    const callArgs = (mockGenerateContent as jest.Mock).mock.calls[0][0];
    expect(callArgs.contents).toContain("YouTube: https://youtube.com/@TestChannel");
    expect(callArgs.contents).not.toContain("@@");
  });

  it("includes soundcloud + youtube channel prompt parts", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({ name: "Cool Band", spotify: "sp1", soundcloud: "sc-link", youtubechannel: "yt-channel-id" }));

    await generateArtistBio("artist-1");

    const callArgs = (mockGenerateContent as jest.Mock).mock.calls[0][0];
    expect(callArgs.contents).toContain("Cool Band");
    expect(callArgs.contents).toContain("SoundCloud: sc-link");
    expect(callArgs.contents).toContain("YouTube Channel: yt-channel-id");
  });

  it("passes identifier anchors as full URLs in the prompt", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({
      spotify: "sp1", wikipedia: "Test_Artist", musicbrainz: "abc-123", discogs: "999", wikidata: "Q42",
    }));

    await generateArtistBio("artist-1");

    const contents = (mockGenerateContent as jest.Mock).mock.calls[0][0].contents;
    expect(contents).toContain("https://en.wikipedia.org/wiki/Test_Artist");
    expect(contents).toContain("https://musicbrainz.org/artist/abc-123");
    expect(contents).toContain("https://www.discogs.com/artist/999");
    expect(contents).toContain("https://www.wikidata.org/wiki/Q42");
    expect(contents).not.toMatch(/Wikipedia:\s*Test_Artist(?!\/|")/);
  });

  it("does not double the base URL when an anchor value is already a full URL", async () => {
    const { generateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({
      spotify: "sp1", wikipedia: "https://en.wikipedia.org/wiki/Test_Artist",
    }));

    await generateArtistBio("artist-1");

    const contents = (mockGenerateContent as jest.Mock).mock.calls[0][0].contents;
    expect(contents).not.toContain("wiki/https://");
    expect(contents).toContain("https://en.wikipedia.org/wiki/Test_Artist");
  });

  // ------- regenerateArtistBio -------

  it("regenerateArtistBio returns bio string on success", async () => {
    const { regenerateArtistBio, getArtistById } = await setup();
    getArtistById.mockResolvedValue(artist({ spotify: "sp1" }));

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
