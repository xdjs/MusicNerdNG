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

jest.mock("@/server/utils/fetchPageContent", () => ({
  fetchPageContent: jest.fn().mockResolvedValue({ title: "A", snippet: "s", extractedText: "t", ogImage: null }),
  isUnsafeUrl: jest.fn().mockReturnValue(false),
}));

describe("searchAndPopulateVault — retry on empty/unparseable response", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGenerate.mockReset();
    mockInsert.mockClear();
    mockInsert.mockResolvedValue({ id: "src-1", url: "https://example.com/a", title: "A", status: "pending" });
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

  it("returns sources immediately and enriches page content in the background (not awaited)", async () => {
    // Enrichment is fire-and-forget so it never adds latency to inline About generation;
    // the snippet is enough for synthesis and the fuller text lands for later views.
    mockGenerate.mockResolvedValueOnce({
      text: '[{"url":"https://example.com/a","title":"A","snippet":"snip","type":"article"}]',
    });

    const { fetchPageContent } = await import("@/server/utils/fetchPageContent");
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");

    expect(result).toHaveLength(1);
    // Background enrichment fetch was fired (not awaited) for the inserted source.
    expect(fetchPageContent).toHaveBeenCalledWith("https://example.com/a");
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
