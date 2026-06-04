// @ts-nocheck

import { jest } from "@jest/globals";

jest.mock("@/server/auth", () => ({
  getServerAuthSession: jest.fn(),
}));

jest.mock("@/server/db/drizzle", () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock("@/server/db/schema", () => ({
  ugcresearch: {
    id: "ugcresearch.id",
    artistId: "ugcresearch.artistId",
    updatedAt: "ugcresearch.updatedAt",
    userId: "ugcresearch.userId",
    accepted: "ugcresearch.accepted",
  },
  artists: {
    id: "artists.id",
    name: "artists.name",
    spotify: "artists.spotify",
    deezer: "artists.deezer",
  },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((...args) => ({ type: "eq", args })),
  and: jest.fn((...args) => ({ type: "and", args })),
  desc: jest.fn((col) => ({ type: "desc", col })),
}));

jest.mock("@/server/utils/musicPlatform", () => ({
  musicPlatformData: {
    getArtistImage: jest.fn(),
  },
}));

// Polyfill Response.json for test environment
if (!("json" in Response)) {
  Response.json = (data, init) =>
    new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      status: init?.status || 200,
    });
}

describe("GET /api/recentEdited", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function setup() {
    const { getServerAuthSession } = await import("@/server/auth");
    const { db } = await import("@/server/db/drizzle");
    const { musicPlatformData } = await import("@/server/utils/musicPlatform");
    const { GET } = await import("../route");

    return {
      GET,
      mockGetSession: getServerAuthSession as jest.Mock,
      mockDb: db as any,
      mockGetArtistImage: musicPlatformData.getArtistImage as jest.Mock,
    };
  }

  function createRequest(params: Record<string, string> = {}) {
    const url = new URL("http://localhost/api/recentEdited");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return new Request(url.toString());
  }

  function setupDbSelect(mockDb: any, rows: any[]) {
    const chain = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(rows),
    };
    mockDb.select.mockReturnValue(chain);
    return chain;
  }

  it("returns [] when not authenticated and no userId param", async () => {
    const { GET, mockGetSession } = await setup();
    mockGetSession.mockResolvedValue(null);

    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual([]);
  });

  it("returns enriched entries for authenticated user", async () => {
    const { GET, mockGetSession, mockDb, mockGetArtistImage } =
      await setup();
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      expires: "2025-12-31",
    });

    const mockRows = [
      { ugcId: "u1", artistId: "a1", updatedAt: "2025-01-01", artistName: "Artist1", spotifyId: "sp1", deezerId: "dz1" },
      { ugcId: "u2", artistId: "a2", updatedAt: "2025-01-02", artistName: "Artist2", spotifyId: "sp2", deezerId: null },
    ];
    setupDbSelect(mockDb, mockRows);
    mockGetArtistImage.mockResolvedValue("https://cdn.deezer.com/artist1.jpg");

    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveLength(2);
    expect(data[0].imageUrl).toBe("https://cdn.deezer.com/artist1.jpg");
  });

  it("uses userId query param when provided (bypasses session)", async () => {
    const { GET, mockGetSession, mockDb } =
      await setup();
    // Session is NOT called when userId param is provided
    mockGetSession.mockResolvedValue(null);

    const mockRows = [
      { ugcId: "u1", artistId: "a1", updatedAt: "2025-01-01", artistName: "Artist1", spotifyId: null, deezerId: null },
    ];
    setupDbSelect(mockDb, mockRows);

    const response = await GET(createRequest({ userId: "other-user" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0].artistName).toBe("Artist1");
    expect(data[0].imageUrl).toBeNull();
  });

  it("deduplicates by artistId, limits to 3", async () => {
    const { GET, mockGetSession, mockDb } =
      await setup();
    mockGetSession.mockResolvedValue(null);

    // 5 rows, but only 4 unique artistIds, and we should only get 3
    const mockRows = [
      { ugcId: "u1", artistId: "a1", updatedAt: "2025-01-05", artistName: "Artist1", spotifyId: null, deezerId: null },
      { ugcId: "u2", artistId: "a1", updatedAt: "2025-01-04", artistName: "Artist1", spotifyId: null, deezerId: null },
      { ugcId: "u3", artistId: "a2", updatedAt: "2025-01-03", artistName: "Artist2", spotifyId: null, deezerId: null },
      { ugcId: "u4", artistId: "a3", updatedAt: "2025-01-02", artistName: "Artist3", spotifyId: null, deezerId: null },
      { ugcId: "u5", artistId: "a4", updatedAt: "2025-01-01", artistName: "Artist4", spotifyId: null, deezerId: null },
    ];
    setupDbSelect(mockDb, mockRows);

    const response = await GET(createRequest({ userId: "user-1" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveLength(3);
    // Should be a1, a2, a3 (first 3 unique)
    expect(data.map((d) => d.artistId)).toEqual(["a1", "a2", "a3"]);
  });

  it("returns [] on error", async () => {
    const { GET, mockGetSession, mockDb } = await setup();
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      expires: "2025-12-31",
    });

    mockDb.select.mockImplementation(() => {
      throw new Error("DB error");
    });

    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual([]);
  });
});
