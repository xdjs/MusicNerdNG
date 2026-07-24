import { renderBioMarkdown } from "../renderBioMarkdown";

describe("renderBioMarkdown", () => {
  it("escapes HTML so script injection cannot execute", () => {
    const result = renderBioMarkdown('<script>alert(1)</script>');
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("escapes an img onerror payload", () => {
    const result = renderBioMarkdown('<img src=x onerror="alert(1)">');
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;img");
  });

  it("still converts **bold** and *italic*", () => {
    expect(renderBioMarkdown("The **WILD LIFE** EP is her *sharpest* work."))
      .toBe("The <strong>WILD LIFE</strong> EP is her <em>sharpest</em> work.");
  });

  it("escapes ampersands without breaking text", () => {
    expect(renderBioMarkdown("Simon & Garfunkel")).toBe("Simon &amp; Garfunkel");
  });

  it("handles null/undefined/empty", () => {
    expect(renderBioMarkdown(null)).toBe("");
    expect(renderBioMarkdown(undefined)).toBe("");
    expect(renderBioMarkdown("")).toBe("");
  });
});
