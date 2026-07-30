import {
  artistNamesMatch,
  normalizeArtistName,
} from "../normalization";

describe("artist research name normalization", () => {
  it.each([
    ["Beyoncé", "beyonce"],
    ["The Beatles", "beatles"],
    ["Artist feat. Guest", "artist"],
    ["Artist ft Guest", "artist"],
    ["Artist featuring Guest", "artist"],
  ])("normalizes %s using the legacy rules", (input, expected) => {
    expect(normalizeArtistName(input)).toBe(expected);
  });

  it("preserves punctuation and internal whitespace", () => {
    expect(artistNamesMatch("AC/DC", "ACDC")).toBe(false);
    expect(artistNamesMatch("Artist  Name", "Artist Name")).toBe(false);
  });

  it("preserves the legacy trim-order edge case", () => {
    expect(normalizeArtistName("  The Beatles  ")).toBe("the beatles");
  });
});
