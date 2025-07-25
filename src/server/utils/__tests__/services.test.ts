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
      regex: /https?:\/\/twitter\.com\/([^/?]+)/,
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
      const text = getArtistDetailsText({} as unknown as Artist, { releases: 0 });
      expect(text).toBe("");
    });

    it("returns spotify release text when only releases present", () => {
      const text = getArtistDetailsText({} as unknown as Artist, { releases: 3 });
      expect(text).toBe("3 releases on Spotify");
    });

    it("returns empty string when only web3 platform and zero releases", () => {
      const text = getArtistDetailsText({ catalog: "cat" } as unknown as Artist, { releases: 0 });
      expect(text).toBe("");
    });

    it("returns spotify release text when releases present and platforms available", () => {
      const text = getArtistDetailsText(baseArtist, { releases: 5 });
      expect(text).toBe("5 releases on Spotify");
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
    it("extracts twitter username", async () => {
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
        id: "@artistname",
      });
    });

    it("extracts youtube @username from youtube.com", async () => {
      const res = await extractArtistId("https://youtube.com/@artistname");
      expect(res).toEqual({
        siteName: "youtube",
        cardPlatformName: "YouTube",
        id: "@artistname",
      });
    });

    // YouTube Username Tests (plain username format - new feature)
    it("extracts youtube username from www.youtube.com and adds @ prefix", async () => {
      const res = await extractArtistId("https://www.youtube.com/artistname");
      expect(res).toEqual({
        siteName: "youtube",
        cardPlatformName: "YouTube",
        id: "@artistname",
      });
    });

    it("extracts youtube username from youtube.com and adds @ prefix", async () => {
      const res = await extractArtistId("https://youtube.com/artistname");
      expect(res).toEqual({
        siteName: "youtube",
        cardPlatformName: "YouTube",
        id: "@artistname",
      });
    });

    // Test the specific failing case from UGC
    it("extracts youtube username correctly for UGC case (www.youtube.com/@fkj)", async () => {
      const res = await extractArtistId("https://www.youtube.com/@fkj");
      expect(res).toEqual({
        siteName: "youtube",
        cardPlatformName: "YouTube",
        id: "@fkj",
      });
    });

    it("returns null when url does not match any pattern", async () => {
      const res = await extractArtistId("https://unknown.com/user");
      expect(res).toBeNull();
    });
  });

}); 