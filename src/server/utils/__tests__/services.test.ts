import {
  getArtistSplitPlatforms,
  getArtistDetailsText,
  isObjKey,
  extractArtistId,
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
      // Comprehensive YouTube regex for all formats:
      // Group 1: optional www.
      // Group 2: channel ID (from /channel/ID pattern)
      // Group 3: @username (from /@username pattern)  
      // Group 4: plain username (from /username pattern, not channel or @)
      regex: /^https?:\/\/(www\.)?youtube\.com\/(?:channel\/([^/?]+)|@([^/?]+)|([^/?@]+))$/,
      siteName: "youtubechannel",
      cardPlatformName: "YouTube",
    },
  ]),
}));

describe("utils/services", () => {
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

    it("returns null when url does not match any pattern", async () => {
      const res = await extractArtistId("https://unknown.com/user");
      expect(res).toBeNull();
    });
  });

}); 