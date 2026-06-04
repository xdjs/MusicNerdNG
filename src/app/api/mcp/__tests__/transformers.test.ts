import { describe, it, expect, beforeEach } from "@jest/globals";
import { getArtistLinks } from "@/server/utils/queries/artistQueries";
import { toArtistSummary } from "../transformers/artist-summary";
import { toArtistDetail } from "../transformers/artist-detail";
import type { Artist } from "@/server/db/DbTypes";
import type { ArtistLink } from "@/server/utils/queries/artistQueries";

// Mock the artistQueries module
jest.mock("@/server/utils/queries/artistQueries", () => ({
  getArtistLinks: jest.fn(),
}));

const mockedGetArtistLinks = getArtistLinks as jest.MockedFunction<typeof getArtistLinks>;

// Helper to create a minimal mock Artist with required fields
function createMockArtist(overrides: Partial<Artist> = {}): Artist {
  return {
    id: "test-artist-id-123",
    name: "Test Artist",
    bio: null,
    spotify: null,
    legacyId: null,
    bandcamp: null,
    facebook: null,
    x: null,
    soundcloud: null,
    notes: null,
    patreon: null,
    instagram: null,
    youtube: null,
    youtubechannel: null,
    lcname: null,
    soundcloudId: null,
    twitch: null,
    imdb: null,
    musicbrainz: null,
    wikidata: null,
    mixcloud: null,
    facebookId: null,
    discogs: null,
    tiktok: null,
    tiktokId: null,
    jaxsta: null,
    famousbirthdays: null,
    songexploder: null,
    colorsxstudios: null,
    bandsintown: null,
    linktree: null,
    onlyfans: null,
    wikipedia: null,
    audius: null,
    zora: null,
    catalog: null,
    opensea: null,
    foundation: null,
    lastfm: null,
    linkedin: null,
    soundxyz: null,
    mirror: null,
    glassnode: null,
    collectsNfTs: null,
    spotifyusername: null,
    bandcampfan: null,
    tellie: null,
    wallets: null,
    ens: null,
    lens: null,
    addedBy: null,
    cameo: null,
    farcaster: null,
    createdAt: null,
    updatedAt: new Date().toISOString(),
    supercollector: null,
    webmapdata: null,
    nodePfp: null,
    customImage: null,
    deezer: null,
    ...overrides,
  };
}

// Helper to create a mock ArtistLink
function createMockArtistLink(overrides: Partial<ArtistLink> = {}): ArtistLink {
  return {
    id: "link-id-123",
    siteUrl: "https://example.com",
    siteName: "example",
    example: "example.com/user",
    appStringFormat: "https://example.com/%@",
    order: 1,
    isIframeEnabled: false,
    isEmbedEnabled: false,
    cardDescription: null,
    cardPlatformName: "Example",
    isWeb3Site: false,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    siteImage: null,
    regex: '""',
    regexMatcher: null,
    isMonetized: false,
    regexOptions: null,
    colorHex: "#000000",
    platformTypeList: ["social"],
    artistUrl: "https://example.com/testuser",
    ...overrides,
  };
}

describe("toArtistSummary", () => {
  describe("transforms Artist correctly", () => {
    it("returns ArtistSummary with id and name from artist", () => {
      const artist = createMockArtist({
        id: "abc-123-def-456",
        name: "Daft Punk",
      });

      const result = toArtistSummary(artist);

      expect(result).toEqual({
        id: "abc-123-def-456",
        name: "Daft Punk",
      });
    });
  });

  describe("handles null name", () => {
    it("returns empty string for name when artist.name is null", () => {
      const artist = createMockArtist({
        id: "xyz-789",
        name: null,
      });

      const result = toArtistSummary(artist);

      expect(result).toEqual({
        id: "xyz-789",
        name: "",
      });
    });
  });

  describe("only includes id and name", () => {
    it("should not include any other fields from the artist", () => {
      const artist = createMockArtist({
        id: "artist-id",
        name: "Test Artist",
        bio: "This is a bio",
        spotify: "spotify123",
        instagram: "testartist",
        youtube: "testchannel",
      });

      const result = toArtistSummary(artist);

      expect(Object.keys(result)).toHaveLength(2);
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name");
      expect(result).not.toHaveProperty("bio");
      expect(result).not.toHaveProperty("spotify");
      expect(result).not.toHaveProperty("instagram");
      expect(result).not.toHaveProperty("youtube");
    });
  });
});

describe("toArtistDetail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("transforms Artist with social links", () => {
    it("populates socialLinks object correctly from getArtistLinks result", async () => {
      const artist = createMockArtist({
        id: "artist-detail-id",
        name: "Social Artist",
        bio: "Artist biography here",
        spotify: "spotify456",
        instagram: "socialartist",
        x: "socialartist_x",
      });

      const mockLinks: ArtistLink[] = [
        createMockArtistLink({
          siteName: "spotify",
          artistUrl: "https://open.spotify.com/artist/spotify456",
          cardPlatformName: "Spotify",
        }),
        createMockArtistLink({
          siteName: "instagram",
          artistUrl: "https://instagram.com/socialartist",
          cardPlatformName: "Instagram",
        }),
        createMockArtistLink({
          siteName: "x",
          artistUrl: "https://twitter.com/socialartist_x",
          cardPlatformName: "X (Twitter)",
        }),
      ];

      mockedGetArtistLinks.mockResolvedValue(mockLinks);

      const result = await toArtistDetail(artist);

      expect(mockedGetArtistLinks).toHaveBeenCalledWith(artist);
      expect(result.id).toBe("artist-detail-id");
      expect(result.name).toBe("Social Artist");
      expect(result.bio).toBe("Artist biography here");
      expect(result.spotifyId).toBe("spotify456");
      expect(result.deezerId).toBeNull();

      expect(result.socialLinks).toHaveProperty("spotify");
      expect(result.socialLinks.spotify).toEqual({
        handle: "spotify456",
        url: "https://open.spotify.com/artist/spotify456",
      });

      expect(result.socialLinks).toHaveProperty("instagram");
      expect(result.socialLinks.instagram).toEqual({
        handle: "socialartist",
        url: "https://instagram.com/socialartist",
      });

      expect(result.socialLinks).toHaveProperty("x");
      expect(result.socialLinks.x).toEqual({
        handle: "socialartist_x",
        url: "https://twitter.com/socialartist_x",
      });
    });
  });

  describe("handles artist with no social links", () => {
    it("returns empty object for socialLinks when getArtistLinks returns empty array", async () => {
      const artist = createMockArtist({
        id: "no-links-artist",
        name: "No Links Artist",
        bio: null,
        spotify: null,
      });

      mockedGetArtistLinks.mockResolvedValue([]);

      const result = await toArtistDetail(artist);

      expect(mockedGetArtistLinks).toHaveBeenCalledWith(artist);
      expect(result.id).toBe("no-links-artist");
      expect(result.name).toBe("No Links Artist");
      expect(result.socialLinks).toEqual({});
    });
  });

  describe("handles null bio", () => {
    it("returns null for bio in output when artist.bio is null", async () => {
      const artist = createMockArtist({
        id: "null-bio-artist",
        name: "Null Bio Artist",
        bio: null,
      });

      mockedGetArtistLinks.mockResolvedValue([]);

      const result = await toArtistDetail(artist);

      expect(result.bio).toBeNull();
    });

    it("returns bio string when artist.bio has a value", async () => {
      const artist = createMockArtist({
        id: "with-bio-artist",
        name: "With Bio Artist",
        bio: "This artist has a detailed biography.",
      });

      mockedGetArtistLinks.mockResolvedValue([]);

      const result = await toArtistDetail(artist);

      expect(result.bio).toBe("This artist has a detailed biography.");
    });
  });

  describe("normalizes YouTube handles", () => {
    it("strips leading @ from youtube handle", async () => {
      const artist = createMockArtist({
        id: "yt-artist",
        name: "YT Artist",
        youtube: "@legacyhandle",
      });

      mockedGetArtistLinks.mockResolvedValue([
        createMockArtistLink({
          siteName: "youtube",
          artistUrl: "https://youtube.com/@legacyhandle",
        }),
      ]);

      const result = await toArtistDetail(artist);

      expect(result.socialLinks.youtube.handle).toBe("legacyhandle");
    });

    it("passes through youtube handle without @", async () => {
      const artist = createMockArtist({
        id: "yt-artist-2",
        name: "YT Artist 2",
        youtube: "cleanhandle",
      });

      mockedGetArtistLinks.mockResolvedValue([
        createMockArtistLink({
          siteName: "youtube",
          artistUrl: "https://youtube.com/@cleanhandle",
        }),
      ]);

      const result = await toArtistDetail(artist);

      expect(result.socialLinks.youtube.handle).toBe("cleanhandle");
    });

    it("strips leading @ from youtubechannel handle", async () => {
      const artist = createMockArtist({
        id: "ytc-artist",
        name: "YTC Artist",
        youtubechannel: "@legacychannel",
      });

      mockedGetArtistLinks.mockResolvedValue([
        createMockArtistLink({
          siteName: "youtubechannel",
          artistUrl: "https://youtube.com/@legacychannel",
        }),
      ]);

      const result = await toArtistDetail(artist);

      expect(result.socialLinks.youtubechannel.handle).toBe("legacychannel");
    });
  });

  describe("maps spotifyId from artist.spotify", () => {
    it("returns spotifyId from the spotify column", async () => {
      const artist = createMockArtist({
        id: "spotify-artist",
        name: "Spotify Artist",
        spotify: "4tZwfgrHOc3mvqYlEYSvVi",
      });

      mockedGetArtistLinks.mockResolvedValue([]);

      const result = await toArtistDetail(artist);

      expect(result.spotifyId).toBe("4tZwfgrHOc3mvqYlEYSvVi");
    });

    it("returns null for spotifyId when artist.spotify is null", async () => {
      const artist = createMockArtist({
        id: "no-spotify-artist",
        name: "No Spotify Artist",
        spotify: null,
      });

      mockedGetArtistLinks.mockResolvedValue([]);

      const result = await toArtistDetail(artist);

      expect(result.spotifyId).toBeNull();
    });
  });

  describe("maps deezerId from artist.deezer", () => {
    it("returns deezerId from the deezer column", async () => {
      const artist = createMockArtist({
        id: "deezer-artist",
        name: "Deezer Artist",
        deezer: "11600",
      });

      mockedGetArtistLinks.mockResolvedValue([]);

      const result = await toArtistDetail(artist);

      expect(result.deezerId).toBe("11600");
    });

    it("returns null for deezerId when artist.deezer is null", async () => {
      const artist = createMockArtist({
        id: "no-deezer-artist",
        name: "No Deezer Artist",
        deezer: null,
      });

      mockedGetArtistLinks.mockResolvedValue([]);

      const result = await toArtistDetail(artist);

      expect(result.deezerId).toBeNull();
    });
  });
});
