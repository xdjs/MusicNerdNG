import {
  buildWikidataArtistQuery,
  filterSafeWikidataLookupIds,
  parseWikidataArtistBindings,
  wikidataMatchToFindings,
} from "../wikidata";

describe("Wikidata artist research", () => {
  it("builds Spotify- and Deezer-primary queries from the same registry", () => {
    const spotifyQuery = buildWikidataArtistQuery("spotify", ["sp123"]);
    const deezerQuery = buildWikidataArtistQuery("deezer", ["145"]);

    expect(spotifyQuery).toContain("?item wdt:P1902 ?sourceId");
    expect(deezerQuery).toContain("?item wdt:P2722 ?sourceId");
    expect(deezerQuery).toContain("OPTIONAL { ?item wdt:P1902 ?spotify }");
    expect(deezerQuery).toContain("OPTIONAL { ?item wdt:P856 ?website }");
  });

  it("filters malformed lookup IDs before SPARQL interpolation", () => {
    expect(
      filterSafeWikidataLookupIds([
        "valid123",
        "valid123",
        "bad\" } UNION { ?s ?p ?o",
        " ",
      ]),
    ).toEqual(["valid123"]);
    expect(
      filterSafeWikidataLookupIds(["valid123", "not-a-spotify-id"], "spotify"),
    ).toEqual(["valid123"]);
  });

  it("can limit harvested properties for legacy callers", () => {
    const query = buildWikidataArtistQuery(
      "spotify",
      ["sp123"],
      ["deezer", "musicbrainz"],
    );

    expect(query).toContain("OPTIONAL { ?item wdt:P2722 ?deezer }");
    expect(query).toContain("OPTIONAL { ?item wdt:P434 ?mbid }");
    expect(query).not.toContain("P856");
  });

  it("exposes only the Deezer- and Spotify-primary lookup flow", () => {
    expect(() =>
      buildWikidataArtistQuery(
        "lastfm" as never,
        ["AC/DC"],
      ),
    ).toThrow("Wikidata lookup is not supported for lastfm");
  });

  it("deduplicates values while preserving first-seen order", () => {
    const parsed = parseWikidataArtistBindings([
      {
        sourceId: { value: "145" },
        item: { value: "http://www.wikidata.org/entity/Q36153" },
        spotify: { value: "spotify-first" },
        instagram: { value: "beyonce" },
      },
      {
        sourceId: { value: "145" },
        item: { value: "http://www.wikidata.org/entity/Q36153" },
        spotify: { value: "spotify-first" },
        instagram: { value: "beyonce-updated" },
      },
    ]);

    expect(parsed.ambiguous.size).toBe(0);
    expect(parsed.matches.get("145")).toEqual({
      entityId: "Q36153",
      values: {
        wikidata: ["Q36153"],
        spotify: ["spotify-first"],
        instagram: ["beyonce", "beyonce-updated"],
      },
    });
  });

  it("rejects a source ID that resolves to multiple Wikidata entities", () => {
    const parsed = parseWikidataArtistBindings([
      {
        sourceId: { value: "145" },
        item: { value: "http://www.wikidata.org/entity/Q1" },
      },
      {
        sourceId: { value: "145" },
        item: { value: "http://www.wikidata.org/entity/Q2" },
      },
    ]);

    expect(parsed.matches.has("145")).toBe(false);
    expect(parsed.ambiguous.get("145")).toEqual(["Q1", "Q2"]);
  });

  it("turns a Deezer-primary entity match into allowlisted findings", () => {
    const parsed = parseWikidataArtistBindings([
      {
        sourceId: { value: "145" },
        item: { value: "http://www.wikidata.org/entity/Q36153" },
        deezer: { value: "145" },
        spotify: { value: "6vWDO969PvNqNYHIOW5v0m" },
        mbid: { value: "859d0860-d480-4efd-970c-c05d5f1776b8" },
        twitter: { value: "Beyonce" },
        website: { value: "https://www.beyonce.com/" },
      },
    ]);
    const match = parsed.matches.get("145");
    expect(match).toBeDefined();

    const result = wikidataMatchToFindings({
      match: match!,
      sourcePlatform: "deezer",
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "platform_id",
          platform: "spotify",
          value: "6vWDO969PvNqNYHIOW5v0m",
          source: "wikidata",
          confidence: "high",
        }),
        expect.objectContaining({
          platform: "musicbrainz",
          value: "859d0860-d480-4efd-970c-c05d5f1776b8",
        }),
        expect.objectContaining({
          kind: "social_link",
          platform: "x",
          value: "beyonce",
        }),
        expect.objectContaining({
          kind: "official_website",
          platform: "official_website",
          value: "https://www.beyonce.com/",
        }),
      ]),
    );
    expect(
      result.findings.some((finding) => finding.platform === "deezer"),
    ).toBe(false);
    expect(result.ambiguities).toEqual([]);
  });

  it("surfaces multi-value properties for human review instead of choosing one", () => {
    const result = wikidataMatchToFindings({
      match: {
        entityId: "Q123",
        values: {
          wikidata: ["Q123"],
          spotify: ["spotify-one", "spotify-two"],
          instagram: ["single-handle"],
          x: ["SameHandle", "samehandle"],
        },
      },
      sourcePlatform: "deezer",
    });

    expect(result.ambiguities).toEqual([
      {
        platform: "spotify",
        values: ["spotify-one", "spotify-two"],
      },
    ]);
    expect(
      result.findings.some((finding) => finding.platform === "spotify"),
    ).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: "instagram",
          value: "single-handle",
        }),
        expect.objectContaining({
          platform: "x",
          value: "samehandle",
        }),
      ]),
    );
  });
});
