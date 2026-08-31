import {
  getArtistSplitPlatforms,
  getArtistDetailsText,
  isObjKey,
  extractArtistId,
  artistPlatforms,
} from "../services";

import type { Artist } from "../../db/DbTypes";

// Mock the getAllLinks function used inside extractArtistId
jest.mock("../queries/queriesTS", () => ({
  // Provide deterministic regex patterns for a few platforms
  getAllLinks: jest.fn().mockResolvedValue([
    {
      // THE PATTERN URLMAP ACTUALLY STORES. This mock used to carry
      // `twitter.com/([^/?]+)`, which is the pattern from before the rename —
      // so every test here passed against a regex production has not used for
      // years, and the real one's defect (below) was invisible.
      regex: /https:\/\/[^/]*x\.[^/]+\/([^/]+)(?:\/.*)?$/,
      siteName: "x",
      cardPlatformName: "Twitter",
    },
    {
      // YouTube channel regex for channel IDs only
      regex: /^https?:\/\/(www\.)?youtube\.com\/channel\/([^/?]+)$/,
      siteName: "youtubechannel", 
      cardPlatformName: "YouTube",
    },
    {
      // YouTube username regex for @username and plain username
      regex: /^https?:\/\/(www\.)?youtube\.com\/(?:@([^/]+)|([^/]+))$/,
      siteName: "youtube",
      cardPlatformName: "YouTube", 
    },
    {
      // TikTok regex for @username format (supports both www and non-www)
      regex: /^https?:\/\/(?:www\.)?tiktok\.com\/@([^/]+)$/,
      siteName: "tiktok",
      cardPlatformName: "TikTok",
    },
    {
      // Subvert (music support platform) — bare-slug artist URLs
      regex: /^https?:\/\/(?:www\.)?subvert\.fm\/([^/?#]+)/,
      siteName: "subvert",
      cardPlatformName: "Subvert",
    },
    {
      // Bluesky (social) — /profile/<handle>
      regex: /^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/?#]+)/,
      siteName: "bluesky",
      cardPlatformName: "Bluesky",
    },
    {
      // Real urlmap Spotify regex — group 1 is the URL *type* segment
      // (track|album|artist|playlist|episode|show), group 2 is the ID.
      regex: /^https:\/\/open\.spotify\.com\/(track|album|artist|playlist|episode|show)\/([a-zA-Z0-9]+)(?:\?.*)?$/,
      siteName: "spotify",
      cardPlatformName: "Spotify",
    },
    {
      // Real urlmap SoundCloud regex — group 1 is the OPTIONAL literal
      // "www." prefix, group 2 is the real username.
      regex: /^https:\/\/(www\.)?soundcloud\.com\/([^/]+)(?:\/.*)?$/,
      siteName: "soundcloud",
      cardPlatformName: "SoundCloud",
    },
  ]),
}));

describe("utils/services", () => {
  describe("artistPlatforms array", () => {
    it("includes both YouTube platform types", () => {
      expect(artistPlatforms).toContain("youtube");
      expect(artistPlatforms).toContain("youtubechannel");
    });

    it("includes all expected social platforms", () => {
      const expectedSocialPlatforms = [
        "x", "instagram", "facebook", "tiktok", "soundcloud", 
        "youtube", "youtubechannel", "lastfm", "audius", "bandisintown"
      ];
      
      expectedSocialPlatforms.forEach(platform => {
        expect(artistPlatforms).toContain(platform);
      });
    });

    it("includes all expected web3 platforms", () => {
      const expectedWeb3Platforms = [
        "catalog", "soundxyz", "opensea", "zora", "mintsongs",
        "supercollector", "wallets", "ens"
      ];
      
      expectedWeb3Platforms.forEach(platform => {
        expect(artistPlatforms).toContain(platform);
      });
    });
  });

  describe("getArtistSplitPlatforms", () => {
    it("splits web3 and social platforms correctly", () => {
      const artist = {
        catalog: "catalog-handle",
        soundxyz: null,
        x: "twitterUser",
        instagram: "instaUser",
        supercollector: "scUser",
      } as unknown as Artist;

      const { web3Platforms, socialPlatforms } = getArtistSplitPlatforms(artist);

      expect(web3Platforms).toEqual([
        "Catalog",
        "Supercollector",
      ]);
      expect(socialPlatforms).toEqual(["X", "Instagram"]);
    });

    it("includes both YouTube platform types in social platforms", () => {
      const artist = {
        youtube: "@testuser",
        youtubechannel: "UC1234567890",
        x: "twitterUser",
      } as unknown as Artist;

      const { web3Platforms, socialPlatforms } = getArtistSplitPlatforms(artist);

      expect(socialPlatforms).toContain("Youtube");
      expect(socialPlatforms).toContain("Youtubechannel");
      expect(socialPlatforms).toContain("X");
      expect(web3Platforms).toEqual([]);
    });

    it("handles single YouTube platform type correctly", () => {
      const artistWithUsername = {
        youtube: "@testuser",
        instagram: "instaUser",
      } as unknown as Artist;

      const artistWithChannel = {
        youtubechannel: "UC1234567890",
        instagram: "instaUser",
      } as unknown as Artist;

      const result1 = getArtistSplitPlatforms(artistWithUsername);
      const result2 = getArtistSplitPlatforms(artistWithChannel);

      expect(result1.socialPlatforms).toContain("Youtube");
      expect(result1.socialPlatforms).not.toContain("Youtubechannel");
      
      expect(result2.socialPlatforms).toContain("Youtubechannel");
      expect(result2.socialPlatforms).not.toContain("Youtube");
    });
  });

  describe("getArtistDetailsText", () => {
    const baseArtist = {
      catalog: "catalog-handle",
      supercollector: null,
      bio: null
    } as unknown as Artist;

    it("returns empty string when no data", () => {
      const text = getArtistDetailsText({} as unknown as Artist, 0);
      expect(text).toBe("");
    });

    it("returns release text when releases present", () => {
      const text = getArtistDetailsText({} as unknown as Artist, 3);
      expect(text).toBe("3 releases");
    });

    it("returns empty string when zero releases", () => {
      const text = getArtistDetailsText({ catalog: "cat" } as unknown as Artist, 0);
      expect(text).toBe("");
    });

    it("returns release text when releases present and platforms available", () => {
      const text = getArtistDetailsText(baseArtist, 5);
      expect(text).toBe("5 releases");
    });
  });

  describe("isObjKey", () => {
    it("correctly identifies keys present in object", () => {
      const obj = { a: 1, b: 2 };
      expect(isObjKey("a", obj)).toBe(true);
      expect(isObjKey("c", obj)).toBe(false);
    });
  });

  describe("extractArtistId", () => {
    it.each([
      ["https://x.com/someuser", "x.com"],
      ["https://twitter.com/someuser", "legacy twitter.com"],
      ["https://www.twitter.com/someuser", "www.twitter.com"],
      ["https://mobile.twitter.com/someuser", "mobile.twitter.com"],
    ])("extracts an X handle from %s (%s)", async (url) => {
      // urlmap's pattern only matches x.com, so every legacy twitter.com link
      // was dropped as an unrecognised platform — and legacy is what the
      // sources we read carry. MusicBrainz returned twitter.com/p3t3rango for
      // Pete Rango and we discarded it.
      const res = await extractArtistId(url);
      expect(res).toEqual({
        siteName: "x",
        cardPlatformName: "Twitter",
        id: "someuser",
      });
    });

    it.each([
      "https://max.com/movie",
      "https://linux.org/thread",
    ])("does not read %s as an X handle", async (url) => {
      // The stored pattern is `[^/]*x\.[^/]+` — an "x." ANYWHERE in the host.
      // max.com/movie resolved to x=movie and linux.org/thread to x=thread.
      // Not a missed link: a stranger's URL written onto an artist as their
      // X handle.
      const res = await extractArtistId(url);
      expect(res?.siteName).not.toBe("x");
    });

    it("still extracts a twitter username", async () => {
      const res = await extractArtistId("https://twitter.com/someuser");
      expect(res).toEqual({
        siteName: "x",
        cardPlatformName: "Twitter",
        id: "someuser",
      });
    });

    // YouTube Channel ID Tests
    it("extracts youtube channel id from www.youtube.com", async () => {
      const res = await extractArtistId(
        "https://www.youtube.com/channel/UC1234567890abcdef"
      );
      expect(res).toEqual({
        siteName: "youtubechannel",
        cardPlatformName: "YouTube",
        id: "UC1234567890abcdef",
      });
    });

    it("extracts youtube channel id from youtube.com", async () => {
      const res = await extractArtistId(
        "https://youtube.com/channel/UC1234567890abcdef"
      );
      expect(res).toEqual({
        siteName: "youtubechannel",
        cardPlatformName: "YouTube",
        id: "UC1234567890abcdef",
      });
    });

    // YouTube Username Tests (@username format)
    it("extracts youtube @username from www.youtube.com", async () => {
      const res = await extractArtistId("https://www.youtube.com/@artistname");
      expect(res).toEqual({
        siteName: "youtube",
        cardPlatformName: "YouTube",
        id: "artistname",
      });
    });

    it("extracts youtube @username from youtube.com", async () => {
      const res = await extractArtistId("https://youtube.com/@artistname");
      expect(res).toEqual({
        siteName: "youtube",
        cardPlatformName: "YouTube",
        id: "artistname",
      });
    });

    // YouTube Username Tests (plain username format - new feature)
    it("extracts youtube username from www.youtube.com and adds @ prefix", async () => {
      const res = await extractArtistId("https://www.youtube.com/artistname");
      expect(res).toEqual({
        siteName: "youtube",
        cardPlatformName: "YouTube",
        id: "artistname",
      });
    });

    it("extracts youtube username from youtube.com and adds @ prefix", async () => {
      const res = await extractArtistId("https://youtube.com/artistname");
      expect(res).toEqual({
        siteName: "youtube",
        cardPlatformName: "YouTube",
        id: "artistname",
      });
    });

    // Test the specific failing case from UGC
    it("extracts youtube username correctly for UGC case (www.youtube.com/@fkj)", async () => {
      const res = await extractArtistId("https://www.youtube.com/@fkj");
      expect(res).toEqual({
        siteName: "youtube",
        cardPlatformName: "YouTube",
        id: "fkj",
      });
    });

    it("extracts TikTok username correctly without storing full URL", async () => {
        const result = await extractArtistId('https://www.tiktok.com/@tatemcrae');
        expect(result).toEqual({
            siteName: 'tiktok',
            cardPlatformName: 'TikTok',
            id: 'tatemcrae'
        });
    });

    it('extracts TikTok username from URL without www subdomain', async () => {
        const result = await extractArtistId('https://tiktok.com/@tatemcrae');
        expect(result).toEqual({
            siteName: 'tiktok',
            cardPlatformName: 'TikTok',
            id: 'tatemcrae'
        });
    });

    it('returns null when TikTok URL does not match pattern', async () => {
        const result = await extractArtistId('https://tiktok.com/invalid-format');
        expect(result).toBeNull();
    });

    it("resolves a Subvert artist URL to the subvert siteName + slug", async () => {
      const res = await extractArtistId("https://www.subvert.fm/pete-rango");
      expect(res).toMatchObject({ siteName: "subvert", id: "pete-rango" });
    });

    it("resolves a non-www Subvert URL", async () => {
      const res = await extractArtistId("https://subvert.fm/pete-rango");
      expect(res).toMatchObject({ siteName: "subvert", id: "pete-rango" });
    });

    it("resolves a Bluesky profile URL to the bluesky siteName + handle", async () => {
      const res = await extractArtistId("https://bsky.app/profile/pete.bsky.social");
      expect(res).toMatchObject({ siteName: "bluesky", id: "pete.bsky.social" });
    });

    it("resolves a www Bluesky profile URL", async () => {
      const res = await extractArtistId("https://www.bsky.app/profile/pete.bsky.social");
      expect(res).toMatchObject({ siteName: "bluesky", id: "pete.bsky.social" });
    });

    it("returns null when url does not match any pattern", async () => {
      const res = await extractArtistId("https://unknown.com/user");
      expect(res).toBeNull();
    });

    // Bug 1 regression: the generic `match[1] || match[2] || match[3]`
    // fallback returned the URL *type* segment ("artist") as the ID instead
    // of the real base62 ID in match[2]. Proven to have already corrupted a
    // production-shaped row (spotify column literally == "artist").
    describe("Spotify links (Bug 1 regression)", () => {
      it("extracts the real base62 artist ID from a Spotify artist URL", async () => {
        const res = await extractArtistId("https://open.spotify.com/artist/3DmaZbBPnKSGnxYRpHobss");
        expect(res).toEqual({
          siteName: "spotify",
          cardPlatformName: "Spotify",
          id: "3DmaZbBPnKSGnxYRpHobss",
        });
      });

      it("still extracts the real ID when a ?si=... query string is present", async () => {
        const res = await extractArtistId("https://open.spotify.com/artist/3DmaZbBPnKSGnxYRpHobss?si=abc123def456");
        expect(res).toEqual({
          siteName: "spotify",
          cardPlatformName: "Spotify",
          id: "3DmaZbBPnKSGnxYRpHobss",
        });
      });

      it("rejects a Spotify TRACK url — a track is not an artist profile", async () => {
        const res = await extractArtistId("https://open.spotify.com/track/3DmaZbBPnKSGnxYRpHobss");
        expect(res).toBeNull();
      });

      it("rejects a Spotify ALBUM url", async () => {
        const res = await extractArtistId("https://open.spotify.com/album/3DmaZbBPnKSGnxYRpHobss");
        expect(res).toBeNull();
      });

      it("rejects a malformed/short Spotify ID", async () => {
        const res = await extractArtistId("https://open.spotify.com/artist/short123");
        expect(res).toBeNull();
      });

      it("never returns the literal string \"artist\" as the id (regression for Bug 1)", async () => {
        const res = await extractArtistId("https://open.spotify.com/artist/3DmaZbBPnKSGnxYRpHobss");
        expect(res?.id).not.toBe("artist");
      });
    });

    describe("SoundCloud links (www.-prefix regression)", () => {
      it("extracts the real username from a www.soundcloud.com URL, not the literal \"www.\" prefix", async () => {
        const res = await extractArtistId("https://www.soundcloud.com/peterango");
        expect(res).toEqual({
          siteName: "soundcloud",
          cardPlatformName: "SoundCloud",
          id: "peterango",
        });
      });

      it("still extracts the username from a soundcloud.com URL with no www. prefix", async () => {
        const res = await extractArtistId("https://soundcloud.com/peterango");
        expect(res).toEqual({
          siteName: "soundcloud",
          cardPlatformName: "SoundCloud",
          id: "peterango",
        });
      });

      it("never returns the literal string \"www.\" as the id (regression)", async () => {
        const res = await extractArtistId("https://www.soundcloud.com/peterango");
        expect(res?.id).not.toBe("www.");
      });
    });
  });

}); 