import {
  escapeMusicBrainzLuceneValue,
  parseMusicBrainzRelations,
  selectUniqueMusicBrainzNameMatch,
} from "../musicbrainz";

describe("MusicBrainz artist research", () => {
  it("parses allowlisted URL relationships and preserves legacy fields", () => {
    const result = parseMusicBrainzRelations([
      {
        type: "free streaming",
        url: { resource: "https://www.deezer.com/us/artist/145" },
      },
      {
        type: "free streaming",
        url: { resource: "https://www.deezer.com/artist/999" },
      },
      {
        type: "streaming",
        url: { resource: "https://tidal.com/browse/artist/1566" },
      },
      {
        type: "streaming",
        url: { resource: "https://tidal.com/artist/1566" },
      },
      {
        type: "social network",
        url: { resource: "https://www.instagram.com/beyonce/" },
      },
      {
        type: "social network",
        url: {
          resource:
            "https://www.facebook.com/profile.php?id=12345&ref=musicbrainz",
        },
      },
      {
        type: "official homepage",
        url: { resource: "https://www.beyonce.com" },
      },
    ]);

    expect(result.deezerId).toBe("999");
    expect(result.otherUrls).toEqual([
      { platform: "tidal", id: "1566" },
      { platform: "tidal", id: "1566" },
      { platform: "instagram", id: "beyonce" },
      {
        platform: "facebook_id",
        id: "https://www.facebook.com/profile.php?id=12345",
      },
    ]);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: "tidal", value: "1566" }),
        expect.objectContaining({ platform: "instagram", value: "beyonce" }),
        expect.objectContaining({
          platform: "facebook_id",
          value: "https://www.facebook.com/profile.php?id=12345",
        }),
        expect.objectContaining({
          platform: "official_website",
          value: "https://www.beyonce.com/",
        }),
      ]),
    );
    expect(result.ambiguities).toContainEqual({
      platform: "deezer",
      values: ["145", "999"],
    });
    expect(
      result.findings.filter((finding) => finding.platform === "tidal"),
    ).toHaveLength(1);
  });

  it("ignores missing and malformed relationship URLs", () => {
    expect(
      parseMusicBrainzRelations([
        {},
        { type: "official homepage", url: { resource: "not a url" } },
      ]),
    ).toEqual({ otherUrls: [], findings: [], ambiguities: [] });
  });

  it("ignores malformed percent-encoded relationship paths", () => {
    expect(() =>
      parseMusicBrainzRelations([
        {
          type: "streaming",
          url: { resource: "https://www.deezer.com/artist/%E0%A4%A" },
        },
      ]),
    ).not.toThrow();
  });

  it("selects exactly one normalized name match", () => {
    expect(
      selectUniqueMusicBrainzNameMatch(
        [
          { id: "mb1", name: "Beyoncé" },
          { id: "mb2", name: "Different Artist" },
        ],
        "Beyonce",
      ),
    ).toEqual({ mbid: "mb1", name: "Beyoncé" });

    expect(
      selectUniqueMusicBrainzNameMatch(
        [
          { id: "mb1", name: "The Beatles" },
          { id: "mb2", name: "Beatles" },
        ],
        "Beatles",
      ),
    ).toBeNull();
  });

  it("escapes Lucene syntax without changing ordinary names", () => {
    expect(escapeMusicBrainzLuceneValue("AC/DC + Friends")).toBe(
      "AC\\/DC \\+ Friends",
    );
    expect(escapeMusicBrainzLuceneValue("Beyoncé")).toBe("Beyoncé");
  });
});
