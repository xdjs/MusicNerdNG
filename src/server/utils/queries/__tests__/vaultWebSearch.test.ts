// @ts-nocheck
import { jest } from "@jest/globals";

const mockWebSearch = jest.fn();
jest.mock("@/server/utils/webSearch", () => ({
  webSearch: (...a) => mockWebSearch(...a),
}));

const mockGetArtist = jest.fn().mockResolvedValue({
  id: "a1", name: "Grimes", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null,
});
jest.mock("@/server/utils/queries/artistQueries", () => ({
  getArtistById: (...a) => mockGetArtist(...a),
}));

const mockInsert = jest.fn().mockResolvedValue({ id: "src-1", url: "https://example.com/a", title: "A", status: "pending" });
const mockGetSources = jest.fn().mockResolvedValue([]);
jest.mock("@/server/utils/queries/dashboardQueries", () => ({
  insertVaultSource: (...a) => mockInsert(...a),
  getVaultSourcesByArtistId: (...a) => mockGetSources(...a),
  updateVaultSourceContent: jest.fn().mockResolvedValue(undefined),
}));

// A page that verifies: 200, plenty of body text, and it names the artist.
const GOOD_BODY = "Grimes gave a long interview about her new record. ".repeat(20);
const goodPage = { title: "A", snippet: "s", extractedText: GOOD_BODY, fullText: GOOD_BODY, ogImage: null, status: 200 };

const mockFetchPage = jest.fn().mockResolvedValue(goodPage);
jest.mock("@/server/utils/fetchPageContent", () => ({
  fetchPageContent: (...a) => mockFetchPage(...a),
  isUnsafeUrl: jest.fn().mockReturnValue(false),
}));

const hit = (url, title = "A Grimes Interview") => ({ url, title, snippet: "s" });

describe("searchAndPopulateVault", () => {
  beforeEach(() => {
    jest.resetModules();
    mockWebSearch.mockReset();
    mockWebSearch.mockResolvedValue([]);
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Grimes", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null,
    });
    mockInsert.mockClear();
    mockInsert.mockResolvedValue({ id: "src-1", url: "https://example.com/a", title: "A", status: "pending" });
    mockFetchPage.mockReset();
    mockFetchPage.mockResolvedValue(goodPage);
    mockGetSources.mockReset();
    mockGetSources.mockResolvedValue([]);
  });

  // ---- Retrieval ---------------------------------------------------------
  // Retrieval must be a search API, never a model. The previous implementation
  // enabled googleSearch grounding and then asked Gemini to "return ONLY a JSON
  // array", so the model AUTHORED the URLs — nothing bound its output to what
  // search actually returned. A real artist's vault filled with a YouTube video
  // whose ID 404s and a channel page that never mentions him.

  it("retrieves candidates from the search API, quoting the artist name", async () => {
    mockWebSearch.mockResolvedValue([hit("https://example.com/a")]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    expect(mockWebSearch).toHaveBeenCalledTimes(3);
    for (const [query] of mockWebSearch.mock.calls) {
      // Unquoted, a multi-word name matches each token independently — which is
      // exactly how "Black Dave" returns Dave the UK rapper.
      expect(query).toContain('"Grimes"');
    }
  });

  it("dedupes the same URL returned by more than one query", async () => {
    mockWebSearch.mockResolvedValue([hit("https://example.com/a"), hit("https://example.com/a")]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it("returns [] when the search API finds nothing, without inserting", async () => {
    mockWebSearch.mockResolvedValue([]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("never re-offers a source the artist has already rejected", async () => {
    // A rejection is the most reliable signal we have about who an artist is
    // NOT, and it used to be discarded — discovery deduped against pending and
    // approved only, so Black Dave could reject the Chord DAVE amplifier
    // reviews and get them straight back on the next run.
    mockGetSources.mockImplementation(async (_id, status) =>
      status === "rejected" ? [{ id: "old", url: "https://example.com/not-me", status: "rejected" }] : []);
    mockWebSearch.mockResolvedValue([hit("https://example.com/not-me"), hit("https://example.com/new")]);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    const inserted = mockInsert.mock.calls.map(c => c[0].url);
    expect(inserted).not.toContain("https://example.com/not-me");
    expect(inserted).toContain("https://example.com/new");
    // Rejected URLs are dropped BEFORE the verification pass, so a rejection
    // also saves the fetch it would otherwise have cost.
    expect(mockFetchPage).not.toHaveBeenCalledWith("https://example.com/not-me", expect.anything());
  });

  it("still re-discovers a URL that was deleted rather than rejected", async () => {
    // A deleted row is gone from the table entirely, so it appears in none of
    // the three status sets — deletion must stay a way to get a fresh look.
    mockGetSources.mockResolvedValue([]);
    mockWebSearch.mockResolvedValue([hit("https://example.com/deleted-before")]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    expect(mockInsert.mock.calls.map(c => c[0].url)).toContain("https://example.com/deleted-before");
  });

  // ---- Verification gate -------------------------------------------------
  // A search API cannot invent a URL, but a search hit is a claim about a page,
  // not the page: it can be dead, paywalled, repurposed, or about a namesake.
  // Nothing becomes a source until we have fetched it ourselves.

  it("verifies a candidate BEFORE storing it, and keeps the page's own content", async () => {
    mockWebSearch.mockResolvedValue([hit("https://example.com/a")]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    expect(mockFetchPage).toHaveBeenCalledWith("https://example.com/a", expect.objectContaining({ timeoutMs: expect.any(Number) }));
    const row = mockInsert.mock.calls[0][0];
    expect(row.extractedText).toBe(GOOD_BODY); // the verification record
    expect(row.title).toBe("A");               // the PAGE's title, not the search hit's
  });

  it("drops a candidate whose URL does not exist (404)", async () => {
    mockWebSearch.mockResolvedValue([hit("https://example.com/gone")]);
    mockFetchPage.mockResolvedValue({ title: null, snippet: null, extractedText: null, fullText: null, ogImage: null, status: 404 });
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("keeps a bot-blocked page as an UNCITABLE lead rather than deleting a real source", async () => {
    mockWebSearch.mockResolvedValue([hit("https://example.com/blocked")]);
    mockFetchPage.mockResolvedValue({ title: null, snippet: null, extractedText: null, fullText: null, ogImage: null, status: 403 });
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    const row = mockInsert.mock.calls[0][0];
    expect(row.extractedText).toBeNull(); // stored, but never citable
  });

  // ---- Namesakes ---------------------------------------------------------

  it("does not let a namesake article become citable (the Black Dave case)", async () => {
    // Real, working, readable page — about Dave the UK rapper and his song
    // "Black". `nameAppearsIn`'s distinctive-token fallback reduces "Black Dave"
    // to "black", which this page contains, so without requireFullName it would
    // classify as `verified`, gain extractedText, and be cited in the artist's
    // About. A plausible wrong-artist source is worse than an obvious fake.
    const RAPPER = "Dave talks about his song Black and growing up in south London. ".repeat(20);
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Black Dave", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null,
    });
    mockWebSearch.mockResolvedValue([hit("https://theguardian.com/dave", "Dave: 'Black is confusing'")]);
    mockFetchPage.mockResolvedValue({ title: "Dave", snippet: "s", extractedText: RAPPER, fullText: RAPPER, ogImage: null, status: 200 });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    const row = mockInsert.mock.calls[0][0];
    expect(row.extractedText).toBeNull(); // demoted to an unverified lead
  });

  it("still verifies a page that names the artist in full", async () => {
    const REAL = "Black Dave released a new project this week in Charleston. ".repeat(20);
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Black Dave", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null,
    });
    mockWebSearch.mockResolvedValue([hit("https://example.com/real", "Black Dave interview")]);
    mockFetchPage.mockResolvedValue({ title: "T", snippet: "s", extractedText: REAL, fullText: REAL, ogImage: null, status: 200 });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    const row = mockInsert.mock.calls[0][0];
    expect(row.extractedText).toBe(REAL);
  });
});
