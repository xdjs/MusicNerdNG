// @ts-nocheck

import { jest } from "@jest/globals";

// Mock the DB query util for ESM before dynamic import of modules
jest.mock("@/server/utils/queriesTS", () => ({
  __esModule: true,
  getAllLinks: jest.fn()
}));

// Helper: mock global fetch
function mockFetch(status: number, body = "") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = (jest.fn() as any).mockResolvedValue(
    new Response(body, {
      status,
      headers: { "Content-Type": "text/html" }
    })
  );
}

describe("/api/validateLink backend validation", () => {
  const youtubeRegex = "^https://(www\\.)?youtube\\.com/(channel|user|c|@)[A-Za-z0-9_-]+";
  const soundcloudRegex = "^https://(www\\.)?soundcloud\\.com/[A-Za-z0-9_-]+";

  beforeEach(() => {
    jest.resetModules(); // Clear module cache between tests
  });

  test("accepts a valid YouTube link", async () => {
    const { getAllLinks } = await import("@/server/utils/queriesTS");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeRegex }
    ]);

    mockFetch(200, "<html><title>Rick Astley Channel</title></html>");

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/@RickAstley" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(json.valid).toBe(true);
    expect((getAllLinks as jest.Mock).mock.calls.length).toBe(1);
  });

  test("rejects when regex does not match", async () => {
    const { getAllLinks } = await import("@/server/utils/queriesTS");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeRegex }
    ]);

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://unsupported.com/not-matching" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.valid).toBe(false);
  });

  test("rejects invalid SoundCloud link (404)", async () => {
    const { getAllLinks } = await import("@/server/utils/queriesTS");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "soundcloud", regex: soundcloudRegex }
    ]);

    mockFetch(404, "Not Found");

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://soundcloud.com/nonexistentuser" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(json.valid).toBe(false);
    expect(json.reason).toBe("404 Not Found");
  });
}); 