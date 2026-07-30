import {
  deezerArtistMatchesName,
  fetchDeezerArtistIdentity,
  verifyDeezerArtistId,
} from "../deezer";

describe("Deezer artist verification", () => {
  it("uses the legacy normalized-name comparison", () => {
    expect(
      deezerArtistMatchesName(
        { id: "145", name: "Beyoncé" },
        "Beyonce",
      ),
    ).toBe(true);
  });

  it("fetches a Deezer artist identity", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 145, name: "Beyoncé" }),
    });

    await expect(fetchDeezerArtistIdentity("145", fetchImpl)).resolves.toEqual(
      { id: "145", name: "Beyoncé" },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.deezer.com/artist/145",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    { ok: false, json: jest.fn() },
    {
      ok: true,
      json: jest.fn().mockResolvedValue({ error: { code: 800 } }),
    },
  ])("treats HTTP/API failures as an unverified match", async (response) => {
    const fetchImpl = jest.fn().mockResolvedValue(response);
    await expect(
      verifyDeezerArtistId("145", "Beyoncé", fetchImpl),
    ).resolves.toBe(false);
  });

  it("preserves the legacy false-on-fetch-error behavior", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("timeout"));
    await expect(
      verifyDeezerArtistId("145", "Beyoncé", fetchImpl),
    ).resolves.toBe(false);
  });
});
