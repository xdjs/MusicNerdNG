// @ts-nocheck
import { jest } from "@jest/globals";
import { ABOUT_EMPTY_STATE } from "@/lib/bioConstants";

const mockRegenerate = jest.fn();
jest.mock("@/server/utils/queries/artistBioQuery", () => ({
  regenerateArtistBio: (...a: unknown[]) => mockRegenerate(...a),
}));

describe("updateArtistBio — regenerate degradation signal", () => {
  beforeEach(() => {
    jest.resetModules();
    mockRegenerate.mockReset();
  });

  async function setup() {
    const { updateArtistBio } = await import("../artistQueries");
    return { updateArtistBio };
  }

  it("reports a distinct message when regenerate degrades to the claim-nudge", async () => {
    mockRegenerate.mockResolvedValue(ABOUT_EMPTY_STATE);
    const { updateArtistBio } = await setup();

    const res = await updateArtistBio("a1", "", true);

    expect(res.status).toBe("success");
    expect(res.message).toMatch(/no verified sources/i); // not the plain "Bio regenerated"
    expect(res.data).toBe(ABOUT_EMPTY_STATE);
  });

  it("reports normal success for a real regenerated bio", async () => {
    mockRegenerate.mockResolvedValue("A real synthesized About.");
    const { updateArtistBio } = await setup();

    const res = await updateArtistBio("a1", "", true);

    expect(res.status).toBe("success");
    expect(res.message).toBe("Bio regenerated");
    expect(res.data).toBe("A real synthesized About.");
  });

  it("reports error when regenerate returns nothing", async () => {
    mockRegenerate.mockResolvedValue(null);
    const { updateArtistBio } = await setup();

    const res = await updateArtistBio("a1", "", true);

    expect(res.status).toBe("error");
  });
});
