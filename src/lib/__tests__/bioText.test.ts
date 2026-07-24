import { sanitizeBioText } from "../bioText";

describe("sanitizeBioText", () => {
  // The exact string from the reported artist page (legacy OpenAI-era bio).
  const REPORTED_BIO =
    "Pete Rango's most recent public updates include HONEY featuring Betty Dawl on Sound.xyz and the December 2, 2024 single OH-KAY! listed on Apple Music. ([sound.xyz](https://www.sound.xyz/p3t3rango/honey-ft-betty-dawl?utm_source=openai)) To become a fan, expect a genre-blending vibe—lo-fi electronic with funk and neo-soul textures—backed by collaborations like KIKI with Cherele and Breakdown with Elle Symone, plus the WILD LIFE EP. ([music.apple.com](https://music.apple.com/us/song/1758574026?utm_source=openai)) Keep up with new releases and projects at peterango.com. ([peterango.com](https://peterango.com/?utm_source=openai))";

  it("removes parenthesized markdown citations from the reported bio", () => {
    const result = sanitizeBioText(REPORTED_BIO);

    expect(result).not.toMatch(/\]\(/); // no markdown link syntax
    expect(result).not.toMatch(/https?:\/\//); // no raw URLs
    expect(result).not.toMatch(/utm_source/);
  });

  it("leaves no empty parens or doubled spaces where citations were removed", () => {
    const result = sanitizeBioText(REPORTED_BIO);

    expect(result).not.toMatch(/\(\s*\)/);
    expect(result).not.toMatch(/ {2,}/);
    expect(result).not.toMatch(/\s+\./); // no space stranded before a period
  });

  it("keeps the prose around a removed citation intact", () => {
    const result = sanitizeBioText(REPORTED_BIO);

    expect(result).toContain("listed on Apple Music. To become a fan");
    expect(result).toContain("plus the WILD LIFE EP. Keep up with new releases");
    expect(result.endsWith("projects at peterango.com.")).toBe(true);
  });

  it("keeps the label when a markdown link is part of the sentence", () => {
    const result = sanitizeBioText("She released [Blue Weekend](https://example.com/blue) in 2021.");

    expect(result).toBe("She released Blue Weekend in 2021.");
  });

  it("strips bare URLs left in the prose", () => {
    const result = sanitizeBioText("Hear it at https://example.com/track today.");

    expect(result).toBe("Hear it at today.");
  });

  it("keeps sentence punctuation when a bare URL ends a sentence", () => {
    const result = sanitizeBioText("Visit https://example.com. Great artist.");

    expect(result).toBe("Visit. Great artist.");
  });

  it("leaves a clean bio untouched, including legitimate parentheses", () => {
    const clean =
      "Her debut EP (recorded across three Brooklyn basements) landed in 2019, and the follow-up sharpened every edge.";

    expect(sanitizeBioText(clean)).toBe(clean);
  });

  it("preserves markdown emphasis so the renderer can still bold and italicize", () => {
    const withEmphasis = "The **WILD LIFE** EP is her *sharpest* work yet.";

    expect(sanitizeBioText(withEmphasis)).toBe(withEmphasis);
  });

  it("handles empty, null, and undefined input", () => {
    expect(sanitizeBioText("")).toBe("");
    expect(sanitizeBioText(null)).toBe("");
    expect(sanitizeBioText(undefined)).toBe("");
  });

  it("returns a citation-only bio as an empty string rather than stray punctuation", () => {
    expect(sanitizeBioText("([sound.xyz](https://www.sound.xyz/x?utm_source=openai))")).toBe("");
  });
});
