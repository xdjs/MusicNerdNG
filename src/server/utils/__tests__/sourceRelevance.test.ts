// @ts-nocheck
import { jest } from "@jest/globals";

const mockGenerate = jest.fn();
jest.mock("@/server/lib/gemini", () => ({
  getGemini: jest.fn(() => ({ models: { generateContent: mockGenerate } })),
  GEMINI_MODEL_FLASH: "gemini-2.5-flash",
}));

const ANCHOR = {
  name: "Black Dave",
  catalog: ["Worst Generation", "Anime Rap"],
  identifiers: ["instagram: blackdave.xyz"],
};

const page = (url, text, title = "t") => ({ url, title, text });

describe("judgeSourceRelevance", () => {
  beforeEach(() => { jest.resetModules(); mockGenerate.mockReset(); });

  it("rejects a namesake the substring check would have accepted", async () => {
    // "Black Dave" reduces to the distinctive token "black", which matches a
    // large share of the web — including a Chord DAVE amplifier review and the
    // Guardian on Dave the UK rapper. Both reached a real artist's vault.
    mockGenerate.mockResolvedValue({ text: '[{"i":0,"about":false},{"i":1,"about":true}]' });
    const { judgeSourceRelevance } = await import("@/server/utils/sourceRelevance");
    const verdicts = await judgeSourceRelevance(ANCHOR, [
      page("https://head-fi.org/chord-dave", "The Chord DAVE is a black reference DAC..."),
      page("https://example.com/real", "Black Dave released Worst Generation..."),
    ]);
    expect(verdicts.get("https://head-fi.org/chord-dave")).toBe("not-about-artist");
    expect(verdicts.get("https://example.com/real")).toBe("about-artist");
  });

  it("binds verdicts by INDEX and never by a URL the model wrote", async () => {
    // A model asked to echo identifiers will invent them — that is precisely how
    // this pipeline once stored a YouTube video that does not exist. A verdict
    // naming a URL we never sent must not be able to affect anything.
    mockGenerate.mockResolvedValue({
      text: '[{"i":0,"about":false},{"url":"https://invented.example/never-sent","about":true}]',
    });
    const { judgeSourceRelevance } = await import("@/server/utils/sourceRelevance");
    const verdicts = await judgeSourceRelevance(ANCHOR, [page("https://a.example/x", "body")]);
    expect(verdicts.get("https://a.example/x")).toBe("not-about-artist");
    expect(verdicts.has("https://invented.example/never-sent")).toBe(false);
  });

  it("discards an index outside the batch rather than guessing", async () => {
    mockGenerate.mockResolvedValue({ text: '[{"i":7,"about":false}]' });
    const { judgeSourceRelevance } = await import("@/server/utils/sourceRelevance");
    const verdicts = await judgeSourceRelevance(ANCHOR, [page("https://a.example/x", "body")]);
    expect(verdicts.get("https://a.example/x")).toBe("undecided");
  });

  it("leaves everything undecided when the model fails — never rejects on error", async () => {
    // A judge that deletes an artist's real press on a bad Gemini day is worse
    // than no judge; the caller falls back to the name check.
    mockGenerate.mockRejectedValue(new Error("boom"));
    const { judgeSourceRelevance } = await import("@/server/utils/sourceRelevance");
    const verdicts = await judgeSourceRelevance(ANCHOR, [page("https://a.example/x", "body")]);
    expect(verdicts.get("https://a.example/x")).toBe("undecided");
  });

  it("leaves everything undecided on unparseable output", async () => {
    mockGenerate.mockResolvedValue({ text: "I think page one is about them, actually" });
    const { judgeSourceRelevance } = await import("@/server/utils/sourceRelevance");
    const verdicts = await judgeSourceRelevance(ANCHOR, [page("https://a.example/x", "body")]);
    expect(verdicts.get("https://a.example/x")).toBe("undecided");
  });

  it("does not call the model at all when nothing was readable", async () => {
    // Guessing from a URL is the failure mode this module removes.
    const { judgeSourceRelevance } = await import("@/server/utils/sourceRelevance");
    const verdicts = await judgeSourceRelevance(ANCHOR, [page("https://a.example/x", null), page("https://b.example/y", "")]);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(verdicts.get("https://a.example/x")).toBe("undecided");
  });

  it("sends the verified catalog as the anchor, not just the name", async () => {
    // The name alone is what got us here; the releases are the evidence a
    // namesake cannot fake.
    mockGenerate.mockResolvedValue({ text: "[]" });
    const { judgeSourceRelevance } = await import("@/server/utils/sourceRelevance");
    await judgeSourceRelevance(ANCHOR, [page("https://a.example/x", "body")]);
    const sent = mockGenerate.mock.calls[0][0].contents;
    expect(sent).toContain("Worst Generation");
    expect(sent).toContain("blackdave.xyz");
  });
});
