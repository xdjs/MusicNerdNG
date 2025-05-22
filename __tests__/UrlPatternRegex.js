describe('URL Pattern Tests', () => {
  const urlPatterns = [
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
    { regex: /^https:\/\/www\.youtube\.com\/(?:channel\/([^/]+)|@([^/]+))$/, sitename: "youtubechannel" },
    { regex: /^https:\/\/www\.sound\.xyz\/([^/]+)$/, sitename: "sound" },
    { regex: /^https:\/\/rainbow\.me\/([^/]+)$/, sitename: "rainbow" },
    { regex: /^https:\/\/wikipedia\.org\/wiki\/([^/]+)$/, sitename: "wikipedia" },
    { regex: /^https:\/\/superbadge\.xyz\/badges\/([^/]+)$/, sitename: "superbadge" },
    { regex: /^https:\/\/www\.tiktok\.com\/@([^/]+)$/, sitename: "tiktok" },
  ];

  // Test valid URLs
  test.each([
    ['x', 'https://x.com/elonmusk'],
    ['instagram', 'https://www.instagram.com/zuck'],
    ['instagram', 'https://www.instagram.com/zuck/'],
    ['instagram', 'https://www.instagram.com/zuck/posts'],
    ['facebook', 'https://www.facebook.com/mark'],
    ['supercollector', 'https://supercollector.xyz/collector123'],
    ['bandsintown', 'https://www.bandsintown.com/a/artist123'],
    ['hey', 'https://hey.xyz/u/user123'],
    ['warpcast', 'https://warpcast.com/user123'],
    ['twitch', 'https://www.twitch.tv/ninja'],
    ['futuretape', 'https://futuretape.xyz/user123'],
    ['linktree', 'https://linktr.ee/creator123'],
    ['audius', 'https://audius.co/artist123'],
    ['catalog', 'https://beta.catalog.works/artist123'],
    ['bandcamp', 'https://artist123.bandcamp.com'],
    ['youtubechannel', 'https://www.youtube.com/channel/UC12345abcdef', 'UC12345abcdef'],
    ['youtubechannel', 'https://www.youtube.com/@Yo-Sea', '@Yo-Sea'],
    ['sound', 'https://www.sound.xyz/artist123'],
    ['rainbow', 'https://rainbow.me/wallet123'],
    ['wikipedia', 'https://wikipedia.org/wiki/Article_Name'],
    ['superbadge', 'https://superbadge.xyz/badges/badge123'],
    ['tiktok', 'https://www.tiktok.com/@user123'],
  ])('should match valid %s URL', (sitename, url) => {
    const pattern = urlPatterns.find(p => p.sitename === sitename);
    expect(pattern.regex.test(url)).toBe(true);
    const match = url.match(pattern.regex);
    expect(match).not.toBeNull();
  });

  // Test invalid URLs
  test.each([
    ['x', 'https://x.com'],
    ['x', 'https://x.com/user/extra'],
    ['instagram', 'https://instagram.com/user'],
    ['facebook', 'https://facebook.com/user/extra'],
    ['supercollector', 'https://supercollector.xyz'],
    ['bandsintown', 'https://www.bandsintown.com/artist123'],
    ['hey', 'https://hey.xyz/user123'],
    ['warpcast', 'https://warpcast.com/user/extra'],
    ['twitch', 'https://twitch.tv/user'],
    ['futuretape', 'https://futuretape.xyz'],
    ['linktree', 'https://linktr.ee'],
    ['audius', 'https://audius.co'],
    ['catalog', 'https://catalog.works/artist123'],
    ['bandcamp', 'https://bandcamp.com'],
    ['youtubechannel', 'https://youtube.com/user123'],
    ['youtubechannel', 'https://www.youtube.com/c/invalidformat'],
    ['sound', 'https://sound.xyz/artist123'],
    ['rainbow', 'https://rainbow.me/wallet/extra'],
    ['wikipedia', 'https://wikipedia.org/Article_Name'],
    ['superbadge', 'https://superbadge.xyz/badge123'],
    ['tiktok', 'https://tiktok.com/@user123'],
  ])('should not match invalid %s URL', (sitename, url) => {
    const pattern = urlPatterns.find(p => p.sitename === sitename);
    expect(pattern.regex.test(url)).toBe(false);
  });

  // Test URL parameter extraction
  test.each([
    ['x', 'https://x.com/elonmusk', 'elonmusk'],
    ['instagram', 'https://www.instagram.com/zuck', 'zuck'],
    ['facebook', 'https://www.facebook.com/mark', 'mark'],
    ['bandcamp', 'https://artist123.bandcamp.com', 'artist123'],
    ['youtubechannel', 'https://www.youtube.com/channel/UC12345abcdef', 'UC12345abcdef'],
    ['youtubechannel', 'https://www.youtube.com/@Yo-Sea', '@Yo-Sea'],
    ['tiktok', 'https://www.tiktok.com/@user123', 'user123'],
  ])('should extract correct parameter from %s URL', (sitename, url, expectedParam) => {
    const pattern = urlPatterns.find(p => p.sitename === sitename);
    const match = url.match(pattern.regex);
    if (sitename === 'youtubechannel' && match[2]) {
        expect(match[2].startsWith('@') ? match[2] : `@${match[2]}`).toBe(expectedParam);
    } else {
        expect(match[1] || match[2]).toBe(expectedParam);
    }
  });

  // Test edge cases
  test('should handle special characters in usernames', () => {
    const pattern = urlPatterns.find(p => p.sitename === 'x');
    expect(pattern.regex.test('https://x.com/user-name')).toBe(true);
    expect(pattern.regex.test('https://x.com/user_name')).toBe(true);
    expect(pattern.regex.test('https://x.com/user.name')).toBe(true);
  });

  test('should handle case sensitivity', () => {
    const pattern = urlPatterns.find(p => p.sitename === 'instagram');
    expect(pattern.regex.test('https://www.INSTAGRAM.com/user')).toBe(false);
    expect(pattern.regex.test('https://www.instagram.com/USER')).toBe(true);
  });

  test('should accept URLs with query parameters', () => {
    const pattern = urlPatterns.find(p => p.sitename === 'x');
    expect(pattern.regex.test('https://x.com/user?ref=123')).toBe(true);
  });
});