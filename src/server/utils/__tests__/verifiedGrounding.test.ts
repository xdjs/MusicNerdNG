// @ts-nocheck
import { resolveVerifiedGrounding } from "../verifiedGrounding";

function mockFetchSequence(responses: Array<{ ok?: boolean; json: any }>) {
  const fn = jest.fn();
  responses.forEach(r => fn.mockResolvedValueOnce({ ok: r.ok ?? true, json: async () => r.json }));
  global.fetch = fn as any;
  return fn;
}

describe("resolveVerifiedGrounding", () => {
  it("returns a Wikipedia extract when the Spotify ID resolves via Wikidata P1902", async () => {
    mockFetchSequence([
      { json: { results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q123" }, sitelink: { value: "https://en.wikipedia.org/wiki/Grimes_(musician)" } }] } } },
      { json: { extract: "Claire Elise Boucher, known as Grimes, is a Canadian musician." } },
    ]);
    const r = await resolveVerifiedGrounding("053q0ukIDRgzwTr4vNSwab");
    expect(r).toEqual({
      source: "wikipedia",
      url: "https://en.wikipedia.org/wiki/Grimes_(musician)",
      extract: expect.stringContaining("Grimes"),
    });
  });

  it("returns null when no Wikidata item is linked to the Spotify ID", async () => {
    mockFetchSequence([{ json: { results: { bindings: [] } } }]);
    expect(await resolveVerifiedGrounding("7cOl6pCLdiRKfC8nnNQ0ax")).toBeNull();
  });

  it("returns null for a null/empty spotifyId without calling fetch", async () => {
    const fn = mockFetchSequence([]);
    expect(await resolveVerifiedGrounding(null)).toBeNull();
    expect(await resolveVerifiedGrounding("")).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns null when a Wikidata item exists but has no English Wikipedia article", async () => {
    mockFetchSequence([{ json: { results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q9" } }] } } }]);
    expect(await resolveVerifiedGrounding("abc")).toBeNull();
  });

  it("returns null when the Wikipedia extract is too short to be useful", async () => {
    mockFetchSequence([
      { json: { results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q1" }, sitelink: { value: "https://en.wikipedia.org/wiki/Tiny" } }] } } },
      { json: { extract: "Stub." } },
    ]);
    expect(await resolveVerifiedGrounding("xyz")).toBeNull();
  });

  it("returns null (never throws) when the network fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as any;
    expect(await resolveVerifiedGrounding("abc")).toBeNull();
  });
});
