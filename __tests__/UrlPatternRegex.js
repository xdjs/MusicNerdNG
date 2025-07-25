describe('URL Pattern Tests', () => {
  const urlPatterns = [
    { regex: /^https:\/\/x\.com\/([^/]+)$/, sitename: "x" },
    { regex: /^https:\/\/www\.instagram\.com\/([^/]+)(\/.*)?$/, sitename: "instagram" },
    { regex: /^https:\/\/www\.facebook\.com\/([^/]+)$/, sitename: "facebook" },
    { regex: /^https:\/\/release\.supercollector\.xyz\/artist\/([^/]+)(?:\/.*)?$/, sitename: "supercollector" },
    { regex: /^https:\/\/www\.bandsintown\.com\/a\/([^/]+)$/, sitename: "bandsintown" },
    { regex: /^https:\/\/hey\.xyz\/u\/([^/]+)$/, sitename: "hey" },
    { regex: /^https:\/\/warpcast\.com\/([^/]+)$/, sitename: "warpcast" },
    { regex: /^https:\/\/www\.twitch\.tv\/([^/]+)$/, sitename: "twitch" },
    { regex: /^https:\/\/futuretape\.xyz\/([^/]+)$/, sitename: "futuretape" },
    { regex: /^https:\/\/linktr\.ee\/([^/]+)$/, sitename: "linktree" },
    { regex: /^https:\/\/audius\.co\/([^/]+)$/, sitename: "audius" },
    { regex: /^https:\/\/beta\.catalog\.works\/([^/]+)$/, sitename: "catalog" },
    { regex: /^https:\/\/([^/]+)\.bandcamp\.com$/, sitename: "bandcamp" },
    // YouTube Username URLs (new dedicated platform)
    { regex: /^https:\/\/(www\.)?youtube\.com\/(?:@([A-Za-z0-9_-]+)|([A-Za-z0-9_-]+))$/, sitename: "youtube" },
    // YouTube Channel ID URLs (updated to only handle channel IDs)
    { regex: /^https:\/\/(www\.)?youtube\.com\/channel\/([^/]+)$/, sitename: "youtubechannel" },
    { regex: /^https:\/\/www\.sound\.xyz\/([^/]+)$/, sitename: "sound" },
    { regex: /^https:\/\/rainbow\.me\/([^/]+)$/, sitename: "rainbow" },
    { regex: /^https:\/\/wikipedia\.org\/wiki\/([^/]+)$/, sitename: "wikipedia" },
    { regex: /^https:\/\/www\.tiktok\.com\/@([^/]+)$/, sitename: "tiktok" },
    { regex: /^https:\/\/www\.discogs\.com\/artist\/([^/?#]+)$/, sitename: "discogs" },
    { regex: /^https:\/\/www\.imdb\.com\/name\/(nm\d+)\/?$/, sitename: "imdb" },
    { regex: /^https:\/\/warpcast\.com\/([^/]+)$/, sitename: "farcaster" },
  ];

  // Test valid URLs
  test.each([
    ['x', 'https://x.com/elonmusk'],
    ['instagram', 'https://www.instagram.com/zuck'],
    ['instagram', 'https://www.instagram.com/zuck/'],
    ['instagram', 'https://www.instagram.com/zuck/posts'],
    ['facebook', 'https://www.facebook.com/mark'],
    ['supercollector', 'https://release.supercollector.xyz/artist/collector123'],
    ['bandsintown', 'https://www.bandsintown.com/a/artist123'],
    ['hey', 'https://hey.xyz/u/user123'],
    ['warpcast', 'https://warpcast.com/user123'],
    ['twitch', 'https://www.twitch.tv/ninja'],
    ['futuretape', 'https://futuretape.xyz/user123'],
    ['linktree', 'https://linktr.ee/creator123'],
    ['audius', 'https://audius.co/artist123'],
    ['catalog', 'https://beta.catalog.works/artist123'],
    ['bandcamp', 'https://artist123.bandcamp.com'],
    // YouTube Channel ID URLs (both domains)
    ['youtubechannel', 'https://www.youtube.com/channel/UC12345abcdef', 'UC12345abcdef'],
    ['youtubechannel', 'https://youtube.com/channel/UC12345abcdef', 'UC12345abcdef'],
    // YouTube Username URLs with @ (both domains)
    ['youtube', 'https://www.youtube.com/@Yo-Sea', '@Yo-Sea'],
    ['youtube', 'https://youtube.com/@Yo-Sea', '@Yo-Sea'],  
    // YouTube Username URLs without @ (both domains - new format)
    ['youtube', 'https://www.youtube.com/RickAstley', 'RickAstley'],
    ['youtube', 'https://youtube.com/RickAstley', 'RickAstley'],
    ['sound', 'https://www.sound.xyz/artist123'],
    ['rainbow', 'https://rainbow.me/wallet123'],
    ['wikipedia', 'https://wikipedia.org/wiki/Article_Name'],
    ['tiktok', 'https://www.tiktok.com/@user123'],
    ['discogs', 'https://www.discogs.com/artist/12345'],
    ['discogs', 'https://www.discogs.com/artist/Some-Artist-Name'],
    ['imdb', 'https://www.imdb.com/name/nm1234567'],
    ['imdb', 'https://www.imdb.com/name/nm7654321/'],
    ['farcaster', 'https://warpcast.com/username'],
    ['farcaster', 'https://warpcast.com/another_user'],
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
    ['supercollector', 'https://release.supercollector.xyz/artist'],
    ['supercollector', 'https://release.supercollector.xyz'],
    ['bandsintown', 'https://www.bandsintown.com/artist123'],
    ['hey', 'https://hey.xyz/user123'],
    ['warpcast', 'https://warpcast.com/user/extra'],
    ['twitch', 'https://twitch.tv/user'],
    ['futuretape', 'https://futuretape.xyz'],
    ['linktree', 'https://linktr.ee'],
    ['audius', 'https://audius.co'],
    ['catalog', 'https://catalog.works/artist123'],
    ['bandcamp', 'https://bandcamp.com'],
    // YouTube invalid URLs - should not match either pattern
    ['youtube', 'https://youtube.com/watch?v=123'],  // Watch URLs should not match username pattern
    ['youtube', 'https://youtube.com/playlist?list=123'], // Playlist URLs should not match
    ['youtube', 'https://youtube.com/@'], // Missing username
    ['youtube', 'https://youtube.com/@user/videos'], // Extra path segments
    ['youtubechannel', 'https://youtube.com/channel/'], // Missing channel ID
    ['youtubechannel', 'https://youtube.com/channel/UC123/videos'], // Extra path segments
    ['youtubechannel', 'https://www.youtube.com/c/invalidformat'], // Old /c/ format should not match
    ['sound', 'https://sound.xyz/artist123'],
    ['rainbow', 'https://rainbow.me/wallet/extra'],
    ['wikipedia', 'https://wikipedia.org/Article_Name'],
    ['tiktok', 'https://tiktok.com/@user123'],
    ['discogs', 'https://www.discogs.com/artist/'],
    ['discogs', 'https://www.discogs.com/label/12345'],
    ['imdb', 'https://www.imdb.com/name/'],
    ['imdb', 'https://www.imdb.com/title/tt1234567'],
    ['farcaster', 'https://warpcast.com/'],
    ['farcaster', 'https://warpcast.com/user/extra'],
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
    // YouTube Channel ID parameter extraction (both domains)
    ['youtubechannel', 'https://www.youtube.com/channel/UC12345abcdef', 'UC12345abcdef'],
    ['youtubechannel', 'https://youtube.com/channel/UC12345abcdef', 'UC12345abcdef'],
    // YouTube Username parameter extraction with @ (both domains)
    ['youtube', 'https://www.youtube.com/@Yo-Sea', '@Yo-Sea'],
    ['youtube', 'https://youtube.com/@Yo-Sea', '@Yo-Sea'],
    // YouTube Username parameter extraction without @ (both domains - new format)
    ['youtube', 'https://www.youtube.com/RickAstley', 'RickAstley'],
    ['youtube', 'https://youtube.com/RickAstley', 'RickAstley'],
    ['tiktok', 'https://www.tiktok.com/@user123', 'user123'],
    ['discogs', 'https://www.discogs.com/artist/12345', '12345'],
    ['discogs', 'https://www.discogs.com/artist/Some-Artist-Name', 'Some-Artist-Name'],
    ['imdb', 'https://www.imdb.com/name/nm1234567', 'nm1234567'],
    ['farcaster', 'https://warpcast.com/username', 'username'],
  ])('should extract correct parameter from %s URL', (sitename, url, expectedParam) => {
    const pattern = urlPatterns.find(p => p.sitename === sitename);
    const match = url.match(pattern.regex);
    
    if (sitename === 'youtube') {
      // For youtube pattern: match[2] has @username (without @), match[3] has plain username
      const extractedParam = match[2] ? `@${match[2]}` : match[3];
      expect(extractedParam).toBe(expectedParam);
    } else if (sitename === 'youtubechannel') {
      // For youtubechannel pattern: match[2] has the channel ID
      expect(match[2]).toBe(expectedParam);
    } else {
      // For other patterns, use match[1] or match[2] as before
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

  // YouTube-specific edge cases
  describe('YouTube URL Pattern Edge Cases', () => {
    test('should distinguish between youtube and youtubechannel patterns', () => {
      const youtubePattern = urlPatterns.find(p => p.sitename === 'youtube');
      const youtubechannelPattern = urlPatterns.find(p => p.sitename === 'youtubechannel');

      // Username URLs should only match youtube pattern
      expect(youtubePattern.regex.test('https://youtube.com/@testuser')).toBe(true);
      expect(youtubechannelPattern.regex.test('https://youtube.com/@testuser')).toBe(false);

      expect(youtubePattern.regex.test('https://youtube.com/testuser')).toBe(true);
      expect(youtubechannelPattern.regex.test('https://youtube.com/testuser')).toBe(false);

      // Channel ID URLs should only match youtubechannel pattern
      expect(youtubechannelPattern.regex.test('https://youtube.com/channel/UC123456')).toBe(true);
      expect(youtubePattern.regex.test('https://youtube.com/channel/UC123456')).toBe(false);
    });

    test('should support both www and non-www domains for YouTube', () => {
      const youtubePattern = urlPatterns.find(p => p.sitename === 'youtube');
      const youtubechannelPattern = urlPatterns.find(p => p.sitename === 'youtubechannel');

      // Test youtube pattern with both domains
      expect(youtubePattern.regex.test('https://youtube.com/@user')).toBe(true);
      expect(youtubePattern.regex.test('https://www.youtube.com/@user')).toBe(true);
      expect(youtubePattern.regex.test('https://youtube.com/user')).toBe(true);
      expect(youtubePattern.regex.test('https://www.youtube.com/user')).toBe(true);

      // Test youtubechannel pattern with both domains
      expect(youtubechannelPattern.regex.test('https://youtube.com/channel/UC123')).toBe(true);
      expect(youtubechannelPattern.regex.test('https://www.youtube.com/channel/UC123')).toBe(true);
    });

    test('should extract usernames correctly from both @ and plain formats', () => {
      const youtubePattern = urlPatterns.find(p => p.sitename === 'youtube');

      // Test @username extraction
      const atMatch = 'https://youtube.com/@testuser'.match(youtubePattern.regex);
      expect(atMatch[2]).toBe('testuser'); // @username captured in group 2 (without @)

      // Test plain username extraction  
      const plainMatch = 'https://youtube.com/testuser'.match(youtubePattern.regex);
      expect(plainMatch[3]).toBe('testuser'); // plain username captured in group 3
    });
  });
});