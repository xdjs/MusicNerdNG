import {
  RESEARCH_PLATFORM_REGISTRY,
  WIKIDATA_PLATFORM_DEFINITIONS,
  buildResearchPlatformUrl,
  extractResearchPlatformFromUrl,
  normalizeResearchPlatformValue,
} from "../platformRegistry";
import { RESEARCH_PLATFORM_VALUES } from "../types";

describe("artist research platform registry", () => {
  it("defines every allowlisted platform exactly once", () => {
    expect(Object.keys(RESEARCH_PLATFORM_REGISTRY).sort()).toEqual(
      [...RESEARCH_PLATFORM_VALUES].sort(),
    );
  });

  it("contains the deterministic Wikidata property allowlist", () => {
    const properties = new Map(
      WIKIDATA_PLATFORM_DEFINITIONS.map((definition) => [
        definition.key,
        definition.wikidataProperty,
      ]),
    );

    expect(properties.get("spotify")).toBe("P1902");
    expect(properties.get("deezer")).toBe("P2722");
    expect(properties.get("musicbrainz")).toBe("P434");
    expect(properties.get("tidal")).toBe("P4576");
    expect(properties.get("amazon_music")).toBe("P6276");
    expect(properties.get("youtube_music")).toBe("P2397");
    expect(properties.get("official_website")).toBe("P856");
  });

  it("builds public URLs from native IDs and handles", () => {
    expect(buildResearchPlatformUrl("spotify", "abc123")).toBe(
      "https://open.spotify.com/artist/abc123",
    );
    expect(buildResearchPlatformUrl("x", "@musicnerd")).toBe(
      "https://x.com/musicnerd",
    );
    expect(buildResearchPlatformUrl("youtube_channel", "UC123")).toBe(
      "https://www.youtube.com/channel/UC123",
    );
  });

  it("extracts supported platform values from relationship URLs", () => {
    expect(
      extractResearchPlatformFromUrl(
        "https://www.deezer.com/us/artist/145?utm_source=test",
      ),
    ).toEqual({ platform: "deezer", value: "145" });
    expect(
      extractResearchPlatformFromUrl(
        "https://tidal.com/browse/artist/1566",
      ),
    ).toEqual({ platform: "tidal", value: "1566" });
    expect(
      extractResearchPlatformFromUrl("https://twitter.com/Beyonce"),
    ).toEqual({ platform: "x", value: "beyonce" });
    expect(
      extractResearchPlatformFromUrl(
        "https://facebook.com/profile.php?id=12345",
      ),
    ).toEqual({
      platform: "facebook_id",
      value: "https://www.facebook.com/profile.php?id=12345",
    });
    expect(
      extractResearchPlatformFromUrl(
        "https://facebook.com/people/Artist-Name/12345/?ref=about",
      ),
    ).toEqual({
      platform: "facebook_id",
      value: "https://www.facebook.com/people/Artist-Name/12345/",
    });
  });

  it("stores Wikidata Facebook usernames in the username column", () => {
    expect(RESEARCH_PLATFORM_REGISTRY.facebook.artistColumn).toBe("facebook");
    expect(RESEARCH_PLATFORM_REGISTRY.facebook_id.artistColumn).toBe(
      "facebookID",
    );
  });

  it("rejects malformed or reserved Facebook profile paths", () => {
    expect(
      extractResearchPlatformFromUrl(
        "https://facebook.com/profile.php?id=notanumber",
      ),
    ).toBeNull();
    expect(
      extractResearchPlatformFromUrl("https://facebook.com/pages/Artist/123"),
    ).toBeNull();
  });

  it("does not shift path segments after malformed encoding", () => {
    expect(
      extractResearchPlatformFromUrl(
        "https://open.spotify.com/artist/%E0%A4%A/abc123",
      ),
    ).toBeNull();
    expect(
      extractResearchPlatformFromUrl(
        "https://open.spotify.com/artist//abc123",
      ),
    ).toBeNull();
  });

  it("accepts only HTTP(S) official website values", () => {
    expect(
      normalizeResearchPlatformValue(
        "official_website",
        "https://artist.example",
      ),
    ).toBe("https://artist.example/");
    expect(
      normalizeResearchPlatformValue(
        "official_website",
        "javascript:alert(1)",
      ),
    ).toBe("");
  });
});
