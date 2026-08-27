// @ts-nocheck
import { jest } from "@jest/globals";

const mockWebSearch = jest.fn();
jest.mock("@/server/utils/webSearch", () => ({
  webSearch: (...a) => mockWebSearch(...a),
}));

const mockGetArtist = jest.fn().mockResolvedValue({
  id: "a1", name: "Grimes", spotify: "sp1", instagram: null, x: null, youtube: null, soundcloud: null, bandcamp: null,
});
const mockGetAllLinks = jest.fn(async () => [
  { siteName: "soundcloud", appStringFormat: "https://soundcloud.com/%@" },
  { siteName: "twitch", appStringFormat: "https://twitch.tv/%@" },
  { siteName: "youtube", appStringFormat: "https://youtube.com/@%@" },
]);
jest.mock("@/server/utils/queries/artistQueries", () => ({
  getArtistById: (...a) => mockGetArtist(...a),
  getAllLinks: (...a) => mockGetAllLinks(...a),
}));

// Propagation probes each verified handle and reads what comes back.
const mockPreview = jest.fn(async () => ({ title: null, imageUrl: null }));
jest.mock("@/server/utils/linkPreview", () => ({ fetchLinkPreview: (...a) => mockPreview(...a) }));

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
const mockDiscover = jest.fn(async () => []);
jest.mock("@/server/utils/profileDiscovery", () => ({
  discoverArtistProfiles: (...a) => mockDiscover(...a),
  // Real behaviour, not a stub: the account check depends on it deciding
  // whether a page title actually names this artist.
  titleMatchesArtist: (title, name) => {
    const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const t = norm(title), a = norm(name);
    return !!t && !!a && (t.includes(a) || a.includes(t));
  },
}));

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
    mockDiscover.mockReset(); mockDiscover.mockResolvedValue([]);
    mockPreview.mockReset(); mockPreview.mockResolvedValue({ title: null, imageUrl: null });
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

  it("asks in exact phrases AND the way a person would type it", async () => {
    mockWebSearch.mockResolvedValue([hit("https://example.com/a")]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    const queries = mockWebSearch.mock.calls.map(c => c[0]);
    expect(queries).toHaveLength(5);
    // The fifth asks a credits database. None of the editorial queries would
    // ever return one, and for a producer or engineer that is where most of
    // their actual work is recorded.
    expect(queries).toContain('"Grimes" discogs credits');

    // Three quoted. Unquoted, a multi-word name matches each token
    // independently — which is exactly how "Black Dave" returns Dave the UK
    // rapper.
    // Four quoted now: three editorial angles plus the credits lookup.
    expect(queries.filter(q => q.includes('"Grimes"'))).toHaveLength(4);

    // And one bare. All three quoted queries demand the exact phrase AND an
    // editorial word, so they systematically miss the artist's OWN pages: Black
    // Dave MK2's instagram is titled "Black Dave! (@blackdave.xyz)" and never
    // contains "Black Dave MK2", and his website appears only for the bare name.
    expect(queries).toContain("Grimes");
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

  it("keeps a scrape farm out of the vault, and does not even fetch it", async () => {
    // Pete, on finding a Boomplay page filed as press about him: "I don't want
    // boom play anywhere... That seems like just an agregator of music or
    // something. Not a legit source."
    //
    // Both routes it took are closed here. The readable one — Pharaoh Sistare's
    // Viberate stats page — is genuinely about the artist, so the judge affirms
    // it; the unreadable one carried his full name in its search title, so it
    // passed as a lead. Neither survives a host check, and the check runs before
    // the fetch so the page is never read or judged at all.
    mockJudge.mockImplementationOnce(async (_a, cands) => new Map(cands.map(c => [c.url, "about-artist"])));
    mockWebSearch.mockResolvedValue([
      hit("https://www.boomplay.com/artists/20993709", "Grimes Songs MP3 Download, New Songs & Albums | Boomplay"),
      hit("https://www.viberate.com/artist/grimes", "Grimes - Songs, Events and Music Stats | Viberate.com"),
      hit("https://example.com/real-article", "A real interview"),
    ]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    const stored = mockInsert.mock.calls.map(c => c[0].url);
    expect(stored).not.toContain("https://www.boomplay.com/artists/20993709");
    expect(stored).not.toContain("https://www.viberate.com/artist/grimes");
    expect(stored).toContain("https://example.com/real-article");
    for (const [url] of mockFetchPage.mock.calls) {
      expect(url).not.toContain("boomplay.com");
      expect(url).not.toContain("viberate.com");
    }
  });

  it("tells the judge what tier each candidate's host is", async () => {
    // Ranking orders a list that already exists. The tier is a fact handed to
    // the model WHILE it decides, which is the thing the meeting asked for: a
    // list the judge consults, not an ordering applied afterwards.
    mockWebSearch.mockResolvedValue([hit("https://example.com/a", "An interview")]);
    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");
    const candidates = mockJudge.mock.calls[0][1];
    expect(candidates[0]).toHaveProperty("ownDomain");
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

  it("will not adopt an instagram handle their own posts contradict", async () => {
    // An Instagram display name is free text, so an account can call itself
    // anything. A blank-slate run adopted instagram=pherosistar because the
    // page title read "Pharaoh Sistare (@pherosistar)" — the verification
    // asking "does this page name the artist" was satisfied by an account
    // merely CLAIMING to be him. His real handle is pharaohsistare, which we
    // already know because we scraped his feed and every post carries it.
    //
    // Requiring the handle to resemble the name would also catch this, and
    // would also reject p3t3rango for Pete Rango, which is his real account.
    const { db } = await import("@/server/db/drizzle");
    const chunkText = (q: any) => ((q?.queryChunks ?? []) as any[])
      .map(c => (Array.isArray(c?.value) ? c.value.join("") : "")).join(" ");
    (db.execute as jest.Mock).mockImplementation(async (q: any) =>
      chunkText(q).includes("artist_social_posts")
        ? { rows: [{ owner_username: "pharaohsistare" }] }
        : { rows: [] });

    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Pharaoh Sistare", spotify: null, deezer: null,
      instagram: null, x: null, youtube: null, soundcloud: null,
      bandcamp: null, facebook: null, twitch: null,
    });
    mockExtract.mockResolvedValue({ siteName: "instagram", id: "pherosistar" });
    mockJudge.mockImplementation(async () => new Map([["https://www.instagram.com/pherosistar/", "about-artist"]]));
    mockWebSearch.mockResolvedValue([
      hit("https://www.instagram.com/pherosistar/", "Pharaoh Sistare (@pherosistar) • Instagram photos and videos"),
    ]);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    expect(mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`)).not.toContain("instagram=pherosistar");
  });

  it("has no opinion about a handle when nothing has been scraped", async () => {
    // The guard above must stay silent for an artist we have never scraped,
    // or a genuinely cold start adopts nothing at all.
    const { db } = await import("@/server/db/drizzle");
    (db.execute as jest.Mock).mockImplementation(async () => ({ rows: [] }));

    mockExtract.mockResolvedValue({ siteName: "x", id: "p3t3rango" });
    mockJudge.mockImplementation(async () => new Map([["https://x.com/p3t3rango", "about-artist"]]));
    mockWebSearch.mockResolvedValue([hit("https://x.com/p3t3rango", "Pete Rango")]);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    expect(mockSetLink).toHaveBeenCalledWith("a1", "x", "p3t3rango");
  });

  it("will not treat a lookalike domain as the artist's own site", async () => {
    // Flagged by a security review. The check was a substring test on a
    // hostname, so anyone could register <artistname>-fans.example, publish
    // their own handles on it, and have the relevance judge affirm the page —
    // a fan site genuinely IS about the artist. Those handles then became the
    // artist's public profile links.
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Pete Rango", spotify: null, deezer: null,
      instagram: null, x: null, youtube: null, soundcloud: null,
      bandcamp: null, facebook: null, twitch: null,
    });
    mockWebSearch.mockResolvedValue([hit("https://peterango-fans.example/links", "Pete Rango")]);
    mockFetchPage.mockResolvedValue({
      ...goodPage,
      url: "https://peterango-fans.example/links",
      aboutArtist: true,
      outboundLinks: ["https://www.instagram.com/not_his_account/"],
    });
    mockExtract.mockImplementation(async (u) =>
      String(u).includes("instagram") ? { siteName: "instagram", id: "not_his_account" } : null);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    expect(mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`)).not.toContain("instagram=not_his_account");
  });

  it("will not treat an artist-named subdomain of someone else's domain as theirs", async () => {
    // Second security finding, on the fix for the first. Matching the leftmost
    // label was still bypassable: anyone who controls attacker.example can
    // serve an artist-themed page at peterango.attacker.example. Ownership
    // lives at the REGISTRABLE domain.
    mockGetArtist.mockResolvedValue({
      id: "a1", name: "Pete Rango", spotify: null, deezer: null,
      instagram: null, x: null, youtube: null, soundcloud: null,
      bandcamp: null, facebook: null, twitch: null,
    });
    mockWebSearch.mockResolvedValue([hit("https://peterango.attacker.example/", "Pete Rango")]);
    mockFetchPage.mockResolvedValue({
      ...goodPage,
      url: "https://peterango.attacker.example/",
      aboutArtist: true,
      outboundLinks: ["https://www.instagram.com/not_his_account/"],
    });
    mockExtract.mockImplementation(async (u) =>
      String(u).includes("instagram") ? { siteName: "instagram", id: "not_his_account" } : null);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    expect(mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`)).not.toContain("instagram=not_his_account");
  });

  it("drops an unreadable page whose title is about a different musician", async () => {
    // Real regression, seen by the product owner on his own profile:
    // blogcritics.org answers our fetch with 403, so the body is unreadable and
    // the page classifies as a "lead" — a real URL, filed as a non-citable
    // source. The only evidence we ever had was the search title, "Music
    // Review: Pete Seeger - Pete Seeger At 89", which is about somebody else.
    // We filed it against Pete Rango and made him look at it.
    mockWebSearch.mockResolvedValue([
      hit("https://blogcritics.org/music-review-pete-seeger-pete-seeger",
          "Music Review: Pete Seeger - Pete Seeger At 89 | Blogcritics"),
    ]);
    mockFetchPage.mockResolvedValue({
      title: "Source from blogcritics.org", snippet: "", extractedText: "",
      fullText: "", ogImage: null, status: 403,
      url: "https://blogcritics.org/music-review-pete-seeger-pete-seeger",
    });
    mockExtract.mockResolvedValue(null);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still keeps an unreadable page whose title IS about the artist", async () => {
    // The rule must not throw away a real interview behind a paywall. (This
    // block's artist is Grimes; an earlier version of this test named a
    // different artist in the title and was correctly rejected, which is the
    // guard working rather than failing.)
    mockWebSearch.mockResolvedValue([
      hit("https://example.com/interview", "An interview with Grimes on making records"),
    ]);
    mockFetchPage.mockResolvedValue({
      title: "Source from example.com", snippet: "", extractedText: "",
      fullText: "", ogImage: null, status: 403,
      url: "https://example.com/interview",
    });
    mockExtract.mockResolvedValue(null);

    const { searchAndPopulateVault } = await import("../vaultWebSearch");
    await searchAndPopulateVault("a1");

    expect(mockInsert).toHaveBeenCalled();
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

    it("adopts even when the corroborator only arrives partway through the run", async () => {
      // The realistic start. An artist arrives from a claim holding the DSP ids
      // MusicNerd creates them with — spotify and deezer — and nothing else.
      // Sherwinn Brice's site corroborates through his BANDCAMP, and his
      // bandcamp is itself only picked up later in the same run, from a
      // different page. Adopting inline meant deciding whose a page was before
      // the run had finished learning who the artist is, so nothing was
      // adopted at all and he finished with no socials.
      const live = {
        id: "a1", name: "Sherwinn Dupes Brice", spotify: "sp1", deezer: "dz1",
        bandcamp: null, instagram: null, x: null, youtube: null, soundcloud: null, facebook: null,
      };
      mockGetArtist.mockImplementation(async () => ({ ...live }));
      // Writes land on the record the way they do in production, so the
      // post-loop re-read can see them.
      mockSetLink.mockImplementation(async (_id, site, value) => { live[site] = value; return {}; });

      mockWebSearch.mockResolvedValue([hit("https://dupes.bandcamp.com/album/convergence", "Convergence"), hit(OWN_SITE, "Dupes")]);
      mockFetchPage.mockImplementation(async (url) => ({
        ...goodPage,
        outboundLinks: String(url).includes("dupes.rocks") ? OUTBOUND : [],
      }));
      // The bandcamp page is judged as the artist's, which is what routes it
      // into links mid-loop and makes it available as a corroborator after.
      mockJudge.mockImplementation(async (_a, candidates) =>
        new Map(candidates.map(c => [c.url, c.url.includes("bandcamp") ? "about-artist" : "undecided"])));
      mockExtract.mockImplementation(resolve);

      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");

      expect(live.bandcamp).toBe("dupes");           // picked up mid-run
      expect(live.instagram).toBe("dupesdidit");     // adopted after, via that
    });

    it("propagates a verified handle to a platform we had nothing for", async () => {
      // Profile discovery, given only the NAME "Sherwinn Dupes Brice", produced
      // `dupes` — wrong — and missed his SoundCloud. Given `dupesdidit`, read
      // off his own site, a probe finds it at once.
      mockGetArtist.mockResolvedValue({
        id: "a1", name: "Sherwinn Dupes Brice", spotify: "sp1", bandcamp: "dupes",
        instagram: null, x: null, youtube: null, soundcloud: null, facebook: null, twitch: null,
      });
      mockWebSearch.mockResolvedValue([hit(OWN_SITE, "Dupes")]);
      mockFetchPage.mockResolvedValue({ ...goodPage, outboundLinks: OUTBOUND });
      mockExtract.mockImplementation(resolve);
      // Only soundcloud answers for him.
      mockPreview.mockImplementation(async (url) =>
        String(url).includes("soundcloud.com/dupesdidit")
          ? { title: "Sherwinn Dupes Brice", imageUrl: "https://cdn/x.jpg" }
          : { title: null, imageUrl: null });

      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");

      expect(mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`)).toContain("soundcloud=dupesdidit");
    });

    it("never overwrites a platform the artist already has", async () => {
      // Restored after a code review noticed it had been dropped in the
      // rewrite. setArtistLink is an unconditional upsert, so nothing below it
      // protects a link the artist already had — the guard is the
      // `if (artist[platform]) continue` at the top of the propagation loop,
      // and it needs pinning against the three adoption paths that now exist.
      mockGetArtist.mockResolvedValue({
        id: "a1", name: "Sherwinn Dupes Brice", spotify: "sp1", bandcamp: "dupes",
        soundcloud: "his-real-soundcloud",   // already known, must survive
        instagram: null, x: null, youtube: null, facebook: null, twitch: null,
      });
      mockWebSearch.mockResolvedValue([hit(OWN_SITE, "Dupes")]);
      mockFetchPage.mockResolvedValue({ ...goodPage, outboundLinks: OUTBOUND });
      mockExtract.mockImplementation(resolve);
      // Everything answers, so only the already-have guard can stop the write.
      mockPreview.mockImplementation(async () => ({ title: "Sherwinn Dupes Brice", imageUrl: null }));

      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");

      const written = mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`);
      expect(written.filter(w => w.startsWith("soundcloud="))).toEqual([]);
    });

    it("abstains when the scan runs out of time before checking every handle", async () => {
      // A deadline check inside the handle loop used to `break` and leave
      // resolved.length === 1, which is indistinguishable from "exactly one
      // answered" — so a partial scan was adopted as a confirmed match. A scan
      // that did not finish cannot conclude anything.
      mockGetArtist.mockResolvedValue({
        id: "a1", name: "Pete Rango", spotify: "sp1", bandcamp: "peterango",
        instagram: null, x: null, youtube: null, soundcloud: null, facebook: null, twitch: null,
      });
      mockWebSearch.mockResolvedValue([hit(OWN_SITE, "Pete Rango")]);
      mockFetchPage.mockResolvedValue({ ...goodPage, outboundLinks: OUTBOUND });
      mockExtract.mockImplementation(resolve);

      // Every probe burns real time, so the budget is gone partway through.
      const realNow = Date.now;
      let clock = realNow();
      jest.spyOn(Date, "now").mockImplementation(() => clock);
      mockPreview.mockImplementation(async (url) => {
        clock += 6000; // six seconds a probe, against a 10s propagation budget
        return String(url).includes("p3t3rango")
          ? { title: "Pete Rango", imageUrl: null }
          : { title: null, imageUrl: null };
      });

      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");
      (Date.now as jest.Mock).mockRestore?.();

      // Whatever it managed to probe, a cut-short platform scan writes nothing.
      const written = mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`);
      expect(written.filter(w => w.startsWith("twitch="))).toEqual([]);
    });

    it("abstains when two verified handles both answer on one platform", async () => {
      // Pete Rango is p3t3rango on Instagram and X, peterango on SoundCloud.
      // twitch.tv answers for BOTH, with titles that only echo the handle back,
      // so there is nothing to choose between them. Taking whichever came first
      // gave him twitch=peterango when his Twitch is p3t3rango — a wrong link,
      // which is worse than the gap it replaced.
      mockGetArtist.mockResolvedValue({
        id: "a1", name: "Pete Rango", spotify: "sp1",
        instagram: null, x: null, youtube: null, soundcloud: null, facebook: null, twitch: null,
      });
      mockWebSearch.mockResolvedValue([
        hit("https://www.instagram.com/p3t3rango", "Pete Rango"),
        hit("https://soundcloud.com/peterango", "Pete Rango"),
      ]);
      // Identity is taken from the page we already fetched — title AND
      // description — rather than from a second request for the title alone.
      mockFetchPage.mockImplementation(async (url) => ({
        ...goodPage,
        outboundLinks: [],
        title: String(url).includes("instagram")
          ? "Pete Rango (@p3t3rango) • Instagram photos and videos"
          : "Pete Rango",
        snippet: "Pete Rango on the internet",
      }));
      mockExtract.mockImplementation(async (url) =>
        String(url).includes("instagram") ? { siteName: "instagram", cardPlatformName: "Instagram", id: "p3t3rango" }
        : String(url).includes("soundcloud") ? { siteName: "soundcloud", cardPlatformName: "SoundCloud", id: "peterango" }
        : undefined);
      // Both account pages confirm, and twitch answers for BOTH handles.
      mockPreview.mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("instagram.com/p3t3rango")) return { title: "Pete Rango (@p3t3rango)", imageUrl: "i" };
        if (u.includes("soundcloud.com/peterango")) return { title: "Pete Rango", imageUrl: "i" };
        if (u.includes("twitch.tv/")) return { title: `${u.split("/").pop()} - Twitch`, imageUrl: "i" };
        return { title: null, imageUrl: null };
      });

      const { searchAndPopulateVault } = await import("../vaultWebSearch");
      await searchAndPopulateVault("a1");

      const written = mockSetLink.mock.calls.map(c => `${c[1]}=${c[2]}`);
      expect(written).toContain("instagram=p3t3rango");
      expect(written).toContain("soundcloud=peterango");
      expect(written.some(w => w.startsWith("twitch="))).toBe(false);
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
