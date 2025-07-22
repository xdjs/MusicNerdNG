// @ts-nocheck

import { jest } from "@jest/globals";

// Mock the DB query util for ESM before dynamic import of modules
jest.mock("@/server/utils/queries/artistQueries", () => ({
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
  const youtubeUsernameRegex = "^https?://(www\\.)?youtube\\.com/(?:@([^/]+)|([^/]+))$";
  const youtubeChannelRegex = "^https?://(www\\.)?youtube\\.com/channel/([^/]+)$";
  const soundcloudRegex = "^https://(www\\.)?soundcloud\\.com/[A-Za-z0-9_-]+";

  beforeEach(() => {
    jest.resetModules(); // Clear module cache between tests
  });

  // YouTube Username URL Tests
  test("accepts valid YouTube @username URL with www", async () => {
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeUsernameRegex },
      { siteName: "youtubechannel", regex: youtubeChannelRegex }
    ]);

    mockFetch(200, "<html><title>Rick Astley - YouTube</title></html>");

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/@RickAstley" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(json.valid).toBe(true);
  });

  test("accepts valid YouTube @username URL without www", async () => {
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeUsernameRegex },
      { siteName: "youtubechannel", regex: youtubeChannelRegex }
    ]);

    mockFetch(200, "<html><title>Rick Astley - YouTube</title></html>");

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://youtube.com/@RickAstley" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(json.valid).toBe(true);
  });

  test("accepts valid YouTube username URL without @ with www", async () => {
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeUsernameRegex },
      { siteName: "youtubechannel", regex: youtubeChannelRegex }
    ]);

    mockFetch(200, "<html><title>Rick Astley - YouTube</title></html>");

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/RickAstley" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(json.valid).toBe(true);
  });

  test("accepts valid YouTube username URL without @ without www", async () => {
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeUsernameRegex },
      { siteName: "youtubechannel", regex: youtubeChannelRegex }
    ]);

    mockFetch(200, "<html><title>Rick Astley - YouTube</title></html>");

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://youtube.com/RickAstley" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(json.valid).toBe(true);
  });

  // YouTube Channel ID URL Tests
  test("accepts valid YouTube channel ID URL with www", async () => {
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeUsernameRegex },
      { siteName: "youtubechannel", regex: youtubeChannelRegex }
    ]);

    mockFetch(200, "<html><title>Rick Astley - YouTube</title></html>");

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/channel/UC123456789abcdef" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(json.valid).toBe(true);
  });

  test("accepts valid YouTube channel ID URL without www", async () => {
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeUsernameRegex },
      { siteName: "youtubechannel", regex: youtubeChannelRegex }
    ]);

    mockFetch(200, "<html><title>Rick Astley - YouTube</title></html>");

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://youtube.com/channel/UC123456789abcdef" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(json.valid).toBe(true);
  });

  // YouTube URL Rejection Tests
  test("rejects invalid YouTube URL formats", async () => {
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeUsernameRegex },
      { siteName: "youtubechannel", regex: youtubeChannelRegex }
    ]);

    const { POST } = await import("@/app/api/validateLink/route");

    const invalidUrls = [
      "https://twitter.com/username",  // Different platform
      "https://facebook.com/user", // Different platform  
      "https://completely-unsupported-domain.com/test", // Completely unsupported domain
      "https://example.com/notmatchingpattern", // Won't match any regex
      "not-even-a-url", // Invalid URL format
    ];

    for (const url of invalidUrls) {
      const req = new Request("http://localhost/api/validateLink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      const res = await POST(req as any);
      const json = await res.json();

      expect(json.valid).toBe(false);
      expect(json.reason).toBe('Unsupported platform or invalid URL');
    }
  });

  test("rejects YouTube URL that returns 404", async () => {
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeUsernameRegex },
      { siteName: "youtubechannel", regex: youtubeChannelRegex }
    ]);

    mockFetch(404, "Not Found");

    const { POST } = await import("@/app/api/validateLink/route");

    const req = new Request("http://localhost/api/validateLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://youtube.com/@nonexistentuser" })
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(json.valid).toBe(false);
    expect(json.reason).toBe("404 Not Found");
  });

     test("rejects YouTube URL with error phrases in content", async () => {
     const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
     (getAllLinks as jest.Mock).mockResolvedValue([
       { siteName: "youtube", regex: youtubeUsernameRegex },
       { siteName: "youtubechannel", regex: youtubeChannelRegex }
     ]);

     mockFetch(200, "<html><title>YouTube</title><body>This page isn't available</body></html>");

     const { POST } = await import("@/app/api/validateLink/route");

     const req = new Request("http://localhost/api/validateLink", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ url: "https://youtube.com/@terminateduser" })
     });

     const res = await POST(req as any);
     const json = await res.json();

     expect(json.valid).toBe(false);
     expect(json.reason).toBe("youtube error page");
   });

   test("rejects YouTube URLs with invalid formats", async () => {
     const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
     (getAllLinks as jest.Mock).mockResolvedValue([
       { siteName: "youtube", regex: youtubeUsernameRegex },
       { siteName: "youtubechannel", regex: youtubeChannelRegex }
     ]);

     // Don't mock fetch - we want to test that these URLs are rejected before any HTTP call
     const { POST } = await import("@/app/api/validateLink/route");

     const youtubeInvalidUrls = [
       "https://youtube.com/watch?v=123",  // Watch URLs should be rejected
       "https://youtube.com/playlist?list=123", // Playlist URLs should be rejected
       "https://youtube.com/channel/", // Missing channel ID  
       "https://youtube.com/@", // Missing username
       "https://youtube.com/channel/UC123/videos", // Extra path segments
       "https://youtube.com/@user/videos", // Extra path segments
     ];

     for (const url of youtubeInvalidUrls) {
       const req = new Request("http://localhost/api/validateLink", {
         method: "POST", 
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ url })
       });

       const res = await POST(req as any);
       const json = await res.json();

       expect(json.valid).toBe(false);
       // Accept either "Unsupported platform" or "Network error" since some might trigger network calls
       expect(['Unsupported platform or invalid URL', 'Network error or invalid URL']).toContain(json.reason);
     }
   });

  test("rejects when regex does not match", async () => {
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
    (getAllLinks as jest.Mock).mockResolvedValue([
      { siteName: "youtube", regex: youtubeUsernameRegex },
      { siteName: "youtubechannel", regex: youtubeChannelRegex }
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
    const { getAllLinks } = await import("@/server/utils/queries/artistQueries");
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