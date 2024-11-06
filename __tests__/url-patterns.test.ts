import { describe, test, expect } from '@jest/globals';

type UrlPattern = {
  regex: RegExp;
  sitename: SiteName;
}

type SiteName = 
  | "x"
  | "instagram"
  | "facebook"
  | "supercollector"
  | "bandsintown"
  | "hey"
  | "warpcast"
  | "twitch"
  | "futuretape"
  | "linktree"
  | "audius"
  | "catalog"
  | "bandcamp"
  | "youtube"
  | "sound"
  | "rainbow"
  | "wikipedia"
  | "superbadge"
  | "tiktok";

const urlPatterns: UrlPattern[] = [
  { regex: /^https:\/\/x\.com\/([^/]+)$/, sitename: "x" },
  { regex: /^https:\/\/www\.instagram\.com\/([^/]+)(\/.*)?$/, sitename: "instagram" },
  { regex: /^https:\/\/www\.facebook\.com\/([^/]+)$/, sitename: "facebook" },
  { regex: /^https:\/\/supercollector\.xyz\/([^/]+)$/, sitename: "supercollector" },
  { regex: /^https:\/\/www\.bandsintown\.com\/a\/([^/]+)$/, sitename: "bandsintown" },
  { regex: /^https:\/\/hey\.xyz\/u\/([^/]+)$/, sitename: "hey" },
  { regex: /^https:\/\/warpcast\.com\/([^/]+)$/, sitename: "warpcast" },
  { regex: /^https:\/\/www\.twitch\.tv\/([^/]+)$/, sitename: "twitch" },
  { regex: /^https:\/\/futuretape\.xyz\/([^/]+)$/, sitename: "futuretape" },
  { regex: /^https:\/\/linktr\.ee\/([^/]+)$/, sitename: "linktree" },
  { regex: /^https:\/\/audius\.co\/([^/]+)$/, sitename: "audius" },
  { regex: /^https:\/\/beta\.catalog\.works\/([^/]+)$/, sitename: "catalog" },
  { regex: /^https:\/\/([^/]+)\.bandcamp\.com$/, sitename: "bandcamp" },
  { regex: /^https:\/\/www\.youtube\.com\/channel\/([^/]+)$/, sitename: "youtube" },
  { regex: /^https:\/\/www\.sound\.xyz\/([^/]+)$/, sitename: "sound" },
  { regex: /^https:\/\/rainbow\.me\/([^/]+)$/, sitename: "rainbow" },
  { regex: /^https:\/\/wikipedia\.org\/wiki\/([^/]+)$/, sitename: "wikipedia" },
  { regex: /^https:\/\/superbadge\.xyz\/badges\/([^/]+)$/, sitename: "superbadge" },
  { regex: /^https:\/\/www\.tiktok\.com\/@([^/]+)$/, sitename: "tiktok" },
];

type TestCase = {
  sitename: SiteName;
  url: string;
  param?: string;
}

describe('URL Pattern Tests', () => {
  // Valid URL test cases
  const validUrls: TestCase[] = [
    { sitename: 'x', url: 'https://x.com/elonmusk' },
    { sitename: 'instagram', url: 'https://www.instagram.com/zuck' },
    { sitename: 'instagram', url: 'https://www.instagram.com/zuck/' },
    { sitename: 'instagram', url: 'https://www.instagram.com/zuck/posts' },
    { sitename: 'facebook', url: 'https://www.facebook.com/mark' },
    { sitename: 'supercollector', url: 'https://supercollector.xyz/collector123' },
    { sitename: 'bandsintown', url: 'https://www.bandsintown.com/a/artist123' },
    { sitename: 'hey', url: 'https://hey.xyz/u/user123' },
    { sitename: 'warpcast', url: 'https://warpcast.com/user123' },
    { sitename: 'twitch', url: 'https://www.twitch.tv/ninja' },
    { sitename: 'futuretape', url: 'https://futuretape.xyz/user123' },
    { sitename: 'linktree', url: 'https://linktr.ee/creator123' },
    { sitename: 'audius', url: 'https://audius.co/artist123' },
    { sitename: 'catalog', url: 'https://beta.catalog.works/artist123' },
    { sitename: 'bandcamp', url: 'https://artist123.bandcamp.com' },
    { sitename: 'youtube', url: 'https://www.youtube.com/channel/UC12345abcdef' },
    { sitename: 'sound', url: 'https://www.sound.xyz/artist123' },
    { sitename: 'rainbow', url: 'https://rainbow.me/wallet123' },
    { sitename: 'wikipedia', url: 'https://wikipedia.org/wiki/Article_Name' },
    { sitename: 'superbadge', url: 'https://superbadge.xyz/badges/badge123' },
    { sitename: 'tiktok', url: 'https://www.tiktok.com/@user123' },
  ];

  // Invalid URL test cases
  const invalidUrls: TestCase[] = [
    { sitename: 'x', url: 'https://x.com' },
    { sitename: 'x', url: 'https://x.com/user/extra' },
    { sitename: 'instagram', url: 'https://instagram.com/user' },
    { sitename: 'facebook', url: 'https://facebook.com/user/extra' },
    { sitename: 'supercollector', url: 'https://supercollector.xyz' },
    { sitename: 'bandsintown', url: 'https://www.bandsintown.com/artist123' },
    { sitename: 'hey', url: 'https://hey.xyz/user123' },
    { sitename: 'warpcast', url: 'https://warpcast.com/user/extra' },
    { sitename: 'twitch', url: 'https://twitch.tv/user' },
    { sitename: 'futuretape', url: 'https://futuretape.xyz' },
    { sitename: 'linktree', url: 'https://linktr.ee' },
    { sitename: 'audius', url: 'https://audius.co' },
    { sitename: 'catalog', url: 'https://catalog.works/artist123' },
    { sitename: 'bandcamp', url: 'https://bandcamp.com' },
    { sitename: 'youtube', url: 'https://youtube.com/user123' },
    { sitename: 'sound', url: 'https://sound.xyz/artist123' },
    { sitename: 'rainbow', url: 'https://rainbow.me/wallet/extra' },
    { sitename: 'wikipedia', url: 'https://wikipedia.org/Article_Name' },
    { sitename: 'superbadge', url: 'https://superbadge.xyz/badge123' },
    { sitename: 'tiktok', url: 'https://tiktok.com/@user123' },
  ];

  // Parameter extraction test cases
  const parameterExtractionCases: TestCase[] = [
    { sitename: 'x', url: 'https://x.com/elonmusk', param: 'elonmusk' },
    { sitename: 'instagram', url: 'https://www.instagram.com/zuck', param: 'zuck' },
    { sitename: 'facebook', url: 'https://www.facebook.com/mark', param: 'mark' },
    { sitename: 'bandcamp', url: 'https://artist123.bandcamp.com', param: 'artist123' },
    { sitename: 'youtube', url: 'https://www.youtube.com/channel/UC12345abcdef', param: 'UC12345abcdef' },
    { sitename: 'tiktok', url: 'https://www.tiktok.com/@user123', param: 'user123' },
  ];

  // Test valid URLs
  test.each(validUrls)('should match valid $sitename URL: $url', ({ sitename, url }) => {
    const pattern = urlPatterns.find(p => p.sitename === sitename);
    expect(pattern).toBeDefined();
    expect(pattern?.regex.test(url)).toBe(true);
    const match = url.match(pattern!.regex);
    expect(match).not.toBeNull();
  });

  // Test invalid URLs
  test.each(invalidUrls)('should not match invalid $sitename URL: $url', ({ sitename, url }) => {
    const pattern = urlPatterns.find(p => p.sitename === sitename);
    expect(pattern).toBeDefined();
    expect(pattern?.regex.test(url)).toBe(false);
  });

  // Test URL parameter extraction
  test.each(parameterExtractionCases)(
    'should extract correct parameter from $sitename URL',
    ({ sitename, url, param }) => {
      const pattern = urlPatterns.find(p => p.sitename === sitename);
      expect(pattern).toBeDefined();
      const match = url.match(pattern!.regex);
      expect(match?.[1]).toBe(param);
    }
  );

  // Test edge cases
  describe('Edge Cases', () => {
    test('should handle special characters in usernames', () => {
      const pattern = urlPatterns.find(p => p.sitename === 'x');
      expect(pattern).toBeDefined();
      expect(pattern?.regex.test('https://x.com/user-name')).toBe(true);
      expect(pattern?.regex.test('https://x.com/user_name')).toBe(true);
      expect(pattern?.regex.test('https://x.com/user.name')).toBe(true);
    });

    test('should handle case sensitivity', () => {
      const pattern = urlPatterns.find(p => p.sitename === 'instagram');
      expect(pattern).toBeDefined();
      expect(pattern?.regex.test('https://www.INSTAGRAM.com/user')).toBe(false);
      expect(pattern?.regex.test('https://www.instagram.com/USER')).toBe(true);
    });

  });
});