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

// Hermetic by default: the judge abstains unless a test says otherwise, so
// every existing expectation still exercises the name-check path.
const mockJudge = jest.fn(async (_anchor, candidates) => new Map(candidates.map(c => [c.url, "undecided"])));
jest.mock("@/server/utils/sourceRelevance", () => ({ judgeSourceRelevance: (...a) => mockJudge(...a) }));

const mockExtract = jest.fn(async () => undefined);
jest.mock("@/server/utils/services", () => ({ extractArtistId: (...a) => mockExtract(...a) }));
const mockSetLink = jest.fn(async () => ({}));
jest.mock("@/server/utils/artistLinkService", () => ({ setArtistLink: (...a) => mockSetLink(...a) }));

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
    mockExtract.mockReset(); mockExtract.mockResolvedValue(undefined);
    mockSetLink.mockReset(); mockSetLink.mockResolvedValue({});
    mockJudge.mockReset();
    mockJudge.mockImplementation(async (_anchor, candidates) => new Map(candidates.map(c => [c.url, "undecided"])));
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

  it("skips a profile we already hold as a link, but keeps other content on the same host", async () => {
    // Discovery kept offering an artist their own Spotify and X pages as
    // "sources about you". They are identity we already have, not research.
    // Matched on the stored VALUE appearing in the URL, not the host — host
    // matching would have discarded the Shockoe Sessions interview, the best
    // source found for another artist, purely because he has a YouTube link.
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Pete Rango", spotify: "3DmaZbBPnKSGnxYRpHobss",
      instagram: null, x: null, youtube: "p3t3rango", soundcloud: null, bandcamp: null,
    });
    mockWebSearch.mockResolvedValue([
      hit("https://open.spotify.com/artist/3DmaZbBPnKSGnxYRpHobss", "Pete Rango - Spotify"),
      hit("https://www.youtube.com/watch?v=GvqK4m2i9Mc", "Live session"),
    ]);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    const inserted = mockInsert.mock.calls.map(c => c[0].url);
    expect(inserted).not.toContain("https://open.spotify.com/artist/3DmaZbBPnKSGnxYRpHobss");
    expect(inserted).toContain("https://www.youtube.com/watch?v=GvqK4m2i9Mc");
  });

  it("never stores a feed, and does not even fetch it", async () => {
    // A real artist's vault held rvamag.com/tags/<tag> AND
    // rvamag.com/tags/<tag>/feed. They looked like duplicates because an RSS
    // channel carries the same <title> as its page, but the second was raw XML
    // — clicking it hands a fan an XML document.
    mockWebSearch.mockResolvedValue([
      hit("https://rvamag.com/tags/pete-rango-kevin-carroll/feed", "Pete Rango Kevin Carroll Archives - RVA Mag"),
      hit("https://example.com/press.rss", "Press"),
      hit("https://example.com/real-article", "A real article"),
    ]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    const stored = mockInsert.mock.calls.map(c => c[0].url);
    expect(stored).not.toContain("https://rvamag.com/tags/pete-rango-kevin-carroll/feed");
    expect(stored).not.toContain("https://example.com/press.rss");
    expect(stored).toContain("https://example.com/real-article");
    // Filtered before the fetch, so it costs nothing.
    expect(mockFetchPage).not.toHaveBeenCalledWith("https://rvamag.com/tags/pete-rango-kevin-carroll/feed", expect.anything());
  });

  it("drops an XML document served from an ordinary-looking URL", async () => {
    mockWebSearch.mockResolvedValue([hit("https://example.com/press", "Press")]);
    mockFetchPage.mockResolvedValue({
      title: "Press", snippet: "s", status: 200,
      extractedText: '<?xml version="1.0"?><rss><channel><title>Press</title></channel></rss>',
      fullText: '<?xml version="1.0"?><rss><channel><title>Press</title></channel></rss>',
      ogImage: null,
    });
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    expect(mockInsert).not.toHaveBeenCalled();
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

  // ---- Relevance judgement ------------------------------------------------

  it("drops a page the judge says is about someone else, rather than keeping it as a lead", async () => {
    // We READ it and it isn't them. Leads exist for pages we could not read,
    // not for pages we read and rejected — a Chord DAVE amplifier review has no
    // business sitting in an artist's vault waiting to be dismissed by hand.
    mockJudge.mockImplementation(async () => new Map([["https://head-fi.org/chord-dave", "not-about-artist"]]));
    mockWebSearch.mockResolvedValue([hit("https://head-fi.org/chord-dave", "Chord DAVE review")]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    const result = await searchAndPopulateVault("a1");
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("lets an affirmed page be citable even when it never spells the full name", async () => {
    // Black Dave's press is written under "Black Dave", which can never satisfy
    // requireFullName against "Black Dave MK2". The judge is stronger evidence
    // than a string match, so it lifts that constraint.
    const PRESS = "Dave has been putting out anime-inflected rap out of Charleston for years. ".repeat(20);
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Black Dave MK2", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null,
    });
    mockJudge.mockImplementation(async () => new Map([["https://example.com/press", "about-artist"]]));
    mockWebSearch.mockResolvedValue([hit("https://example.com/press", "An interview")]);
    mockFetchPage.mockResolvedValue({ title: "T", snippet: "s", extractedText: PRESS, fullText: PRESS, ogImage: null, status: 200 });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    expect(mockInsert.mock.calls[0][0].extractedText).toBe(PRESS);
  });

  it("falls back to the name check when the judge abstains", async () => {
    // An unavailable judge must not delete real press.
    const RAPPER = "Dave talks about his song Black and growing up in south London. ".repeat(20);
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Black Dave", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null,
    });
    mockJudge.mockImplementation(async (_a, c) => new Map(c.map(x => [x.url, "undecided"])));
    mockWebSearch.mockResolvedValue([hit("https://theguardian.com/dave", "Dave")]);
    mockFetchPage.mockResolvedValue({ title: "Dave", snippet: "s", extractedText: RAPPER, fullText: RAPPER, ogImage: null, status: 200 });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    // Stored, but demoted — exactly the pre-judge behaviour.
    expect(mockInsert.mock.calls[0][0].extractedText).toBeNull();
  });

  it("never writes a link from a URL pattern alone, before the page is judged", async () => {
    // This shipped: en.wikipedia.org/wiki/Rango:_Music_from_the_Motion_Picture
    // was saved as a real artist's Wikipedia link, because the URL matched the
    // wikipedia pattern. Matching a platform's URL shape says nothing about
    // whose page it is.
    mockExtract.mockResolvedValue({ siteName: "wikipedia", id: "Rango:_Music_from_the_Motion_Picture" });
    mockJudge.mockImplementation(async () => new Map([["https://en.wikipedia.org/wiki/Rango:_Music_from_the_Motion_Picture", "not-about-artist"]]));
    mockWebSearch.mockResolvedValue([hit("https://en.wikipedia.org/wiki/Rango:_Music_from_the_Motion_Picture", "Rango soundtrack")]);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    expect(mockSetLink).not.toHaveBeenCalled();
  });

  it("does not infer an encyclopedia entry is the artist's account, even when affirmed", async () => {
    // A wikipedia or imdb identifier is an article title ABOUT a subject. An
    // article being about someone does not make it their account.
    mockExtract.mockResolvedValue({ siteName: "wikipedia", id: "Pete_Rango" });
    mockJudge.mockImplementation(async () => new Map([["https://en.wikipedia.org/wiki/Pete_Rango", "about-artist"]]));
    mockWebSearch.mockResolvedValue([hit("https://en.wikipedia.org/wiki/Pete_Rango", "Pete Rango")]);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    expect(mockSetLink).not.toHaveBeenCalled();
  });

  it("routes an AFFIRMED social account to links instead of filing it as press", async () => {
    // The bug this exists for: a real artist finished onboarding with
    // x.com/<handle> in his vault as a "source" and no X link on his profile.
    mockExtract.mockResolvedValue({ siteName: "x", id: "p3t3rango" });
    mockJudge.mockImplementation(async () => new Map([["https://x.com/p3t3rango", "about-artist"]]));
    mockWebSearch.mockResolvedValue([hit("https://x.com/p3t3rango", "Pete Rango")]);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    expect(mockSetLink).toHaveBeenCalledWith("a1", "x", "p3t3rango");
    expect(mockInsert).not.toHaveBeenCalled(); // and not stored as a source
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

  it("verifies the artist's OWN domain even when the page never spells the full name", async () => {
    // Regression I introduced with requireFullName: peterango.com reads fine and
    // is unambiguously his, but renders the two words apart so a full-name text
    // match fails. Measured on the real site — strict said lead, loose said
    // verified. A hostname that IS the artist's name outranks body text.
    const SITE = "RANGO. Producer, artist, and builder. Selected work below. ".repeat(20);
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Pete Rango", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null,
    });
    mockWebSearch.mockResolvedValue([hit("https://peterango.com", "Pete Rango")]);
    mockFetchPage.mockResolvedValue({ title: "Pete Rango", snippet: "s", extractedText: SITE, fullText: SITE, ogImage: null, status: 200 });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    expect(mockInsert.mock.calls[0][0].extractedText).toBe(SITE);
  });

  it("does not extend that exemption to a third-party domain", async () => {
    // The namesake gate must still hold everywhere else.
    const RAPPER = "Dave talks about his song Black and growing up in south London. ".repeat(20);
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Black Dave", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null,
    });
    mockWebSearch.mockResolvedValue([hit("https://theguardian.com/dave", "Dave")]);
    mockFetchPage.mockResolvedValue({ title: "Dave", snippet: "s", extractedText: RAPPER, fullText: RAPPER, ogImage: null, status: 200 });

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    expect(mockInsert.mock.calls[0][0].extractedText).toBeNull();
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

  describe("adopting handles from the artist's own page", () => {
    // An artist's own site is the only first-party statement of their handles,
    // and it lives entirely in href attributes — so the text extractor strips it
    // and the same-host `links` rule excludes it. Sherwinn Brice's Instagram is
    // `dupesdidit`, published on dupes.rocks; profile discovery guessed `dupes`
    // from his name and missed it. No name-derived slug reaches `dupesdidit`.
    const OWN_SITE = "https://www.dupes.rocks";
    const OUTBOUND = [
      "https://dupes.bandcamp.com/album/convergence",
      "https://www.instagram.com/dupesdidit",
      "https://www.facebook.com/dupesdidit/",
    ];
    const resolve = async (url) => {
      if (url.includes("bandcamp")) return { siteName: "bandcamp", cardPlatformName: "Bandcamp", id: "dupes" };
      if (url.includes("instagram")) return { siteName: "instagram", cardPlatformName: "Instagram", id: "dupesdidit" };
      if (url.includes("facebook")) return { siteName: "facebook", cardPlatformName: "Facebook", id: "dupesdidit" };
      return undefined;
    };

    it("adopts them when the page links to an id we already hold", async () => {
      // bandcamp=dupes is already confirmed for this artist, so a page linking
      // to it is his hub. That is identity through a matched ID, never a name.
      mockGetArtist.mockResolvedValue({
        id: "a1", name: "Sherwinn Dupes Brice", spotify: "sp1", bandcamp: "dupes",
        instagram: null, x: null, youtube: null, soundcloud: null, facebook: null,
      });
      mockWebSearch.mockResolvedValue([hit(OWN_SITE, "Dupes")]);
      mockFetchPage.mockResolvedValue({ ...goodPage, outboundLinks: OUTBOUND });
      mockExtract.mockImplementation(resolve);
      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");

      const adopted = mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`);
      expect(adopted).toContain("instagram=dupesdidit");
      expect(adopted).toContain("facebook=dupesdidit");
      // Already held — re-writing it is pointless churn.
      expect(adopted).not.toContain("bandcamp=dupes");
    });

    it("adopts NOTHING from a page that proves no connection to the artist", async () => {
      // The dangerous case: a magazine's footer links to the MAGAZINE's
      // Instagram. Without corroboration we would put a publication's social
      // account on an artist's profile.
      mockGetArtist.mockResolvedValue({
        id: "a1", name: "Sherwinn Dupes Brice", spotify: "sp1", bandcamp: "dupes",
        instagram: null, x: null, youtube: null, soundcloud: null, facebook: null,
      });
      mockWebSearch.mockResolvedValue([hit("https://somemagazine.com/review", "Review")]);
      mockFetchPage.mockResolvedValue({
        ...goodPage,
        outboundLinks: ["https://www.instagram.com/somemagazine", "https://www.facebook.com/somemagazine"],
      });
      mockExtract.mockImplementation(async (url) =>
        url.includes("instagram") ? { siteName: "instagram", cardPlatformName: "Instagram", id: "somemagazine" }
        : url.includes("facebook") ? { siteName: "facebook", cardPlatformName: "Facebook", id: "somemagazine" }
        : undefined);
      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");

      expect(mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`)).not.toContain("instagram=somemagazine");
    });

    it("corroborates against an @-prefixed stored handle", async () => {
      // isKnownProfileUrl in the same file already strips a leading "@", as do
      // profileDiscovery, socialIngest and socialSignals. A stored
      // "@dupes" comparing unequal to a resolved "dupes" would silently
      // disable this whole feature for that artist, with no error anywhere.
      mockGetArtist.mockResolvedValue({
        id: "a1", name: "Sherwinn Dupes Brice", spotify: "sp1", bandcamp: "@dupes",
        instagram: null, x: null, youtube: null, soundcloud: null, facebook: null,
      });
      mockWebSearch.mockResolvedValue([hit(OWN_SITE, "Dupes")]);
      mockFetchPage.mockResolvedValue({ ...goodPage, outboundLinks: OUTBOUND });
      mockExtract.mockImplementation(resolve);
      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");

      expect(mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`)).toContain("instagram=dupesdidit");
    });

    it("adopts NEITHER when the page names two handles for one platform", async () => {
      // An artist's footer can carry their own Instagram beside their label's.
      // The pre-loop artist snapshot never sees what the loop just wrote, so
      // without a guard the second silently overwrites the first and link order
      // decides which handle an artist ends up with.
      mockGetArtist.mockResolvedValue({
        id: "a1", name: "Sherwinn Dupes Brice", spotify: "sp1", bandcamp: "dupes",
        instagram: null, x: null, youtube: null, soundcloud: null, facebook: null,
      });
      mockWebSearch.mockResolvedValue([hit(OWN_SITE, "Dupes")]);
      mockFetchPage.mockResolvedValue({
        ...goodPage,
        outboundLinks: [
          "https://dupes.bandcamp.com/album/convergence",
          "https://www.instagram.com/dupesdidit",
          "https://www.instagram.com/hislabelrecords",
        ],
      });
      mockExtract.mockImplementation(async (url) =>
        url.includes("bandcamp") ? { siteName: "bandcamp", cardPlatformName: "Bandcamp", id: "dupes" }
        : url.includes("dupesdidit") ? { siteName: "instagram", cardPlatformName: "Instagram", id: "dupesdidit" }
        : url.includes("hislabelrecords") ? { siteName: "instagram", cardPlatformName: "Instagram", id: "hislabelrecords" }
        : undefined);
      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");

      const adopted = mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`);
      expect(adopted).not.toContain("instagram=dupesdidit");
      expect(adopted).not.toContain("instagram=hislabelrecords");
    });

    it("will not adopt a platform route mistaken for a handle", async () => {
      // instagram.com/p/<id> resolves to the "handle" p — one adoption away
      // from writing that onto an artist row.
      mockGetArtist.mockResolvedValue({
        id: "a1", name: "Sherwinn Dupes Brice", spotify: "sp1", bandcamp: "dupes",
        instagram: null, x: null, youtube: null, soundcloud: null, facebook: null,
      });
      mockWebSearch.mockResolvedValue([hit(OWN_SITE, "Dupes")]);
      mockFetchPage.mockResolvedValue({
        ...goodPage,
        outboundLinks: ["https://dupes.bandcamp.com/album/convergence", "https://www.instagram.com/p/DN3G"],
      });
      mockExtract.mockImplementation(async (url) =>
        url.includes("bandcamp") ? { siteName: "bandcamp", cardPlatformName: "Bandcamp", id: "dupes" }
        : url.includes("instagram") ? { siteName: "instagram", cardPlatformName: "Instagram", id: "p" }
        : undefined);
      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");

      expect(mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`)).not.toContain("instagram=p");
    });
  });
});
