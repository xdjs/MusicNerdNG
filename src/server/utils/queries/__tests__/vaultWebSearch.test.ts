// @ts-nocheck
import { jest } from "@jest/globals";

const mockGenerate = jest.fn();
jest.mock("@/server/lib/gemini", () => ({
  getGemini: jest.fn(() => ({ models: { generateContent: mockGenerate } })),
  GEMINI_MODEL_FLASH: "gemini-2.5-flash",
}));

jest.mock("@/server/utils/queries/artistQueries", () => ({
  getArtistById: jest.fn().mockResolvedValue({ id: "a1", name: "Grimes", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null }),
}));

const mockInsert = jest.fn().mockResolvedValue({ id: "src-1", url: "https://example.com/a", title: "A", status: "pending" });
jest.mock("@/server/utils/queries/dashboardQueries", () => ({
  insertVaultSource: (...a) => mockInsert(...a),
  getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
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

describe("searchAndPopulateVault — retry on empty/unparseable response", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGenerate.mockReset();
    mockInsert.mockClear();
    mockInsert.mockResolvedValue({ id: "src-1", url: "https://example.com/a", title: "A", status: "pending" });
    mockFetchPage.mockReset();
    mockFetchPage.mockResolvedValue(goodPage);
  });

  it("retries when Gemini returns empty responses, then succeeds (the Grimes bug)", async () => {
    // 2 transient empties, then a valid list — mirrors real Gemini flakiness.
    mockGenerate
      .mockResolvedValueOnce({ text: "" })
      .mockResolvedValueOnce({ text: "" })
      .mockResolvedValueOnce({ text: '[{"url":"https://example.com/a","title":"A Grimes Interview","snippet":"s","type":"interview"}]' });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");

    expect(mockGenerate).toHaveBeenCalledTimes(3);   // retried past the 2 empties
    expect(mockInsert).toHaveBeenCalledTimes(1);      // inserted the recovered source
    expect(result).toHaveLength(1);
  }, 15000);

  // ---- Verification gate -------------------------------------------------
  // Gemini is asked to TYPE urls and descriptions, so it produces plausible ones:
  // a real run stored five Apple Music IDs of which one existed, two invented
  // slugs for one real article, and a domain one letter off from the real site.
  // Nothing may become a source until we have fetched it ourselves.

  it("verifies a candidate BEFORE storing it, and keeps the page's own content", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: '[{"url":"https://example.com/a","title":"Model Title","snippet":"model description","type":"article"}]',
    });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");

    // Awaited, not fire-and-forget: the fetch must happen before the row exists.
    expect(mockFetchPage).toHaveBeenCalledWith("https://example.com/a", { timeoutMs: 5000 });
    expect(result).toHaveLength(1);
    const stored = mockInsert.mock.calls[0][0];
    // The page is the authority on itself — not the model's guess about it.
    expect(stored.title).toBe("A");
    expect(stored.snippet).toBe("s");
    expect(stored.extractedText).toBe(GOOD_BODY);
  }, 15000);

  it("drops a candidate whose URL does not exist (404)", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: '[{"url":"https://example.com/invented","title":"A","snippet":"s","type":"article"}]',
    });
    mockFetchPage.mockResolvedValue({ title: "t", extractedText: null, status: 404 });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");

    expect(mockInsert).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  }, 15000);

  it("drops a candidate whose hostname does not resolve", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: '[{"url":"https://exampl.com/typo","title":"A","snippet":"s","type":"article"}]',
    });
    mockFetchPage.mockResolvedValue({ title: "t", extractedText: null, status: null, failure: "dns" });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    expect(await searchAndPopulateVault("a1")).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
  }, 15000);

  it("keeps a bot-blocked page as an UNCITABLE lead rather than deleting a real source", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: '[{"url":"https://example.com/walled","title":"Walled","snippet":"model description","type":"article"}]',
    });
    mockFetchPage.mockResolvedValue({ title: "t", extractedText: null, status: 403 });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");

    expect(result).toHaveLength(1);
    const stored = mockInsert.mock.calls[0][0];
    // Empty extractedText IS the "not verified" record that isCitableSource reads.
    expect(stored.extractedText).toBeNull();
    // The model's description survives only as something to recognize the link
    // by while curating; it never reaches synthesis.
    expect(stored.snippet).toBe("model description");
  }, 15000);

  it("keeps a page we fetched but that never mentions the artist as a lead, not a source", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: '[{"url":"https://example.com/parked","title":"Parked","snippet":"s","type":"article"}]',
    });
    const unrelated = "This domain is registered but may still be available. ".repeat(20);
    mockFetchPage.mockResolvedValue({ title: "t", extractedText: unrelated, fullText: unrelated, status: 200 });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");

    // A parked/soft-404 page is dead, not a lead — it is not a real page about anyone.
    expect(result).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
  }, 15000);

  it("never stores a Google grounding-redirect URL when it cannot be resolved", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: '[{"url":"https://vertexaisearch.cloud.google.com/grounding-api-redirect/TOKEN","title":"A","snippet":"s","type":"article"}]',
    });
    // Resolution attempt fails — these tokens expire and then 404, so storing the
    // redirect itself (the old fallback) put a guaranteed-broken link in the vault.
    global.fetch = jest.fn().mockRejectedValue(new Error("expired"));

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    expect(await searchAndPopulateVault("a1")).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
  }, 15000);

  it("returns [] after exhausting attempts if every response is empty", async () => {
    mockGenerate.mockResolvedValue({ text: "" });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");

    expect(mockGenerate).toHaveBeenCalledTimes(4);   // MAX_ATTEMPTS
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  }, 15000);
});
