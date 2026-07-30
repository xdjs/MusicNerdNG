// @ts-nocheck
import { jest } from "@jest/globals";

jest.mock("@/server/utils/queries/artistBioQuery", () => ({
  regenerateArtistBio: jest.fn().mockResolvedValue("unused"),
}));

describe("applyResearchFindings", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function setup(artist = {
    id: "artist-123",
    name: "Test Artist",
    spotify: null,
    deezer: "145",
    instagram: null,
  }) {
    const { db } = await import("@/server/db/drizzle");
    db.execute = jest.fn().mockResolvedValue([{}]);
    db.query.artists.findFirst = jest.fn().mockResolvedValue(artist);
    db.query.artistIdMappings.findFirst = jest.fn().mockResolvedValue(null);

    let rolledBack = false;
    db.transaction = jest.fn(async (callback) => {
      try {
        return await callback(db);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    });

    const { applyResearchFindings } = await import("../applyResearchFindings");
    const { regenerateArtistBio } = await import(
      "@/server/utils/queries/artistBioQuery"
    );
    return {
      db,
      applyResearchFindings,
      regenerateArtistBio,
      wasRolledBack: () => rolledBack,
    };
  }

  const spotifyFinding = {
    kind: "platform_id",
    platform: "spotify",
    value: "6vWDO969PvNqNYHIOW5v0m",
    confidence: "high",
    source: "wikidata",
  };

  it("atomically creates a Spotify mapping and fills artists.spotify", async () => {
    const { db, applyResearchFindings, regenerateArtistBio } = await setup();

    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [spotifyFinding],
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        appliedCount: 1,
        conflictCount: 0,
        errorCount: 0,
      }),
    );
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: "applied",
        mutated: true,
        winningValue: "6vWDO969PvNqNYHIOW5v0m",
        mapping: expect.objectContaining({ created: true }),
        artistField: expect.objectContaining({
          column: "spotify",
          status: "written",
        }),
      }),
    );
    expect(regenerateArtistBio).not.toHaveBeenCalled();
  });

  it("rolls back both sides when a populated artist column conflicts", async () => {
    const { applyResearchFindings, wasRolledBack } = await setup({
      id: "artist-123",
      name: "Test Artist",
      spotify: "existing-spotify-id",
      deezer: "145",
      instagram: null,
    });

    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [spotifyFinding],
    });

    expect(wasRolledBack()).toBe(true);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: "conflict",
        mutated: false,
        conflict: {
          reason: "existing_artist_value",
          field: "spotify",
          existingValue: "existing-spotify-id",
        },
      }),
    );
  });

  it("reports the other artist that already owns a Spotify ID", async () => {
    const { db, applyResearchFindings, wasRolledBack } = await setup();
    db.query.artists.findFirst
      .mockResolvedValueOnce({ id: "artist-123", spotify: null })
      .mockResolvedValueOnce({ id: "other-artist" })
      .mockResolvedValue({ id: "artist-123", spotify: null });

    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [spotifyFinding],
    });

    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: "conflict",
        conflict: {
          reason: "platform_id_owned_by_another_artist",
          conflictingArtistId: "other-artist",
        },
      }),
    );
    expect(wasRolledBack()).toBe(true);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("classifies a concurrent artist-column unique violation as a conflict", async () => {
    const { db, applyResearchFindings, wasRolledBack } = await setup();
    const uniqueError = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "artists_spotify_uniq",
    });
    db.execute
      .mockResolvedValueOnce([{ id: "mapping-1" }])
      .mockRejectedValueOnce(uniqueError);

    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [spotifyFinding],
    });

    expect(wasRolledBack()).toBe(true);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: "conflict",
        mutated: false,
        conflict: {
          reason: "platform_id_owned_by_another_artist",
        },
      }),
    );
  });

  it("uses the higher-confidence existing mapping to repair an empty mirror", async () => {
    const { db, applyResearchFindings } = await setup();
    db.query.artistIdMappings.findFirst
      .mockResolvedValueOnce({
        artistId: "artist-123",
        platform: "spotify",
        platformId: "trusted-existing-id",
        confidence: "manual",
      });

    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [spotifyFinding],
    });

    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: "applied",
        winningValue: "trusted-existing-id",
        mapping: expect.objectContaining({ skipped: true }),
        artistField: expect.objectContaining({ status: "written" }),
      }),
    );
    // Mapping was skipped; only the artist mirror was written.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("atomically upgrades the exact artist-column mirror with a stronger mapping", async () => {
    const { db, applyResearchFindings, wasRolledBack } = await setup({
      id: "artist-123",
      name: "Test Artist",
      spotify: "older-mirrored-id",
      deezer: "145",
      instagram: null,
    });
    db.query.artistIdMappings.findFirst.mockResolvedValueOnce({
      artistId: "artist-123",
      platform: "spotify",
      platformId: "older-mirrored-id",
      confidence: "low",
    });

    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [spotifyFinding],
    });

    expect(wasRolledBack()).toBe(false);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: "applied",
        winningValue: spotifyFinding.value,
        mapping: expect.objectContaining({
          updated: true,
          previousMapping: {
            platformId: "older-mirrored-id",
            confidence: "low",
          },
        }),
        artistField: expect.objectContaining({ status: "written" }),
      }),
    );
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("does not replace an existing mirror with an equal-confidence candidate", async () => {
    const { db, applyResearchFindings, wasRolledBack } = await setup({
      id: "artist-123",
      name: "Test Artist",
      spotify: "existing-high-id",
      deezer: "145",
      instagram: null,
    });
    db.query.artistIdMappings.findFirst.mockResolvedValueOnce({
      artistId: "artist-123",
      platform: "spotify",
      platformId: "existing-high-id",
      confidence: "high",
    });

    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [spotifyFinding],
    });

    expect(wasRolledBack()).toBe(true);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: "conflict",
        mutated: false,
        conflict: {
          reason: "existing_artist_value",
          field: "spotify",
          existingValue: "existing-high-id",
        },
      }),
    );
    // The mapping update was attempted inside the transaction and rolled back.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("continues after one finding conflicts", async () => {
    const { applyResearchFindings } = await setup({
      id: "artist-123",
      name: "Test Artist",
      spotify: "existing-spotify-id",
      deezer: "145",
      instagram: null,
    });

    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [
        spotifyFinding,
        {
          kind: "social_link",
          platform: "instagram",
          value: "@testartist",
          confidence: "high",
          source: "wikidata",
        },
      ],
    });

    expect(result.conflictCount).toBe(1);
    expect(result.appliedCount).toBe(1);
    expect(result.results[0].status).toBe("conflict");
    expect(result.results[1]).toEqual(
      expect.objectContaining({
        status: "applied",
        finding: expect.objectContaining({
          platform: "instagram",
          value: "testartist",
        }),
      }),
    );
    expect(result.results[1].mapping).toBeUndefined();
  });

  it("rejects order-dependent duplicate findings before starting work", async () => {
    const { db, applyResearchFindings } = await setup();

    await expect(
      applyResearchFindings({
        artistId: "artist-123",
        findings: [
          spotifyFinding,
          { ...spotifyFinding, value: "different-id" },
        ],
      }),
    ).rejects.toThrow("Conflicting findings for spotify");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("deterministically keeps the strongest equivalent finding", async () => {
    const { applyResearchFindings } = await setup();
    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [
        {
          ...spotifyFinding,
          confidence: "low",
          source: "web_search",
          reasoning: "fallback result",
        },
        {
          ...spotifyFinding,
          confidence: "high",
          source: "wikidata",
          reasoning: "deterministic result",
        },
      ],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].finding).toEqual(
      expect.objectContaining({
        confidence: "high",
        source: "wikidata",
        reasoning: "deterministic result | fallback result",
      }),
    );
  });

  it("leaves official websites for the research findings store", async () => {
    const { db, applyResearchFindings } = await setup();
    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [
        {
          kind: "official_website",
          platform: "official_website",
          value: "https://artist.example",
          confidence: "high",
          source: "wikidata",
        },
      ],
    });

    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: "skipped",
        mutated: false,
        winningValue: "https://artist.example/",
        skipReason: "no_storage_target",
      }),
    );
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("does not let competing websites block a valid platform finding", async () => {
    const { db, applyResearchFindings } = await setup();
    const result = await applyResearchFindings({
      artistId: "artist-123",
      findings: [
        {
          kind: "official_website",
          platform: "official_website",
          value: "https://first.example",
          confidence: "high",
          source: "wikidata",
        },
        {
          kind: "official_website",
          platform: "official_website",
          value: "https://second.example",
          confidence: "high",
          source: "musicbrainz",
        },
        spotifyFinding,
      ],
    });

    expect(result.appliedCount).toBe(1);
    expect(result.conflictCount).toBe(0);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          finding: expect.objectContaining({ platform: "spotify" }),
          status: "applied",
        }),
        expect.objectContaining({
          finding: expect.objectContaining({
            value: "https://first.example/",
          }),
          status: "skipped",
          skipReason: "no_storage_target",
        }),
        expect.objectContaining({
          finding: expect.objectContaining({
            value: "https://second.example/",
          }),
          status: "skipped",
          skipReason: "no_storage_target",
        }),
      ]),
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe official website values", async () => {
    const { db, applyResearchFindings } = await setup();

    await expect(
      applyResearchFindings({
        artistId: "artist-123",
        findings: [
          {
            kind: "official_website",
            platform: "official_website",
            value: "javascript:alert(1)",
            confidence: "high",
            source: "wikidata",
          },
        ],
      }),
    ).rejects.toThrow("Invalid or empty value for official_website");
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
