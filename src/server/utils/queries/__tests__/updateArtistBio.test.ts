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
    const { db } = await import("@/server/db/drizzle");
    // updateArtistBio now snapshots the prior bio via getArtistById → db.query.artists.findFirst.
    (db as any).query.artists.findFirst = jest.fn().mockResolvedValue(null);
    const { updateArtistBio } = await import("../artistQueries");
    return { updateArtistBio, db };
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

  it("reports 'unchanged' when discovery finds nothing and the existing bio is preserved (no-op)", async () => {
    const { updateArtistBio, db } = await setup();
    (db as any).query.artists.findFirst = jest.fn().mockResolvedValue({ bio: "An existing, unchanged About." });
    mockRegenerate.mockResolvedValue("An existing, unchanged About."); // clobber-guard preserved the same bio

    const res = await updateArtistBio("a1", "", true);

    expect(res.status).toBe("success");
    expect(res.message).toMatch(/unchanged/i); // not the plain "Bio regenerated"
    expect(res.data).toBe("An existing, unchanged About.");
  });

  it("reports error when regenerate returns nothing", async () => {
    mockRegenerate.mockResolvedValue(null);
    const { updateArtistBio } = await setup();

    const res = await updateArtistBio("a1", "", true);

    expect(res.status).toBe("error");
  });
});
