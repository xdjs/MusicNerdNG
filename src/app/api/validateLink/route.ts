import { NextRequest } from 'next/server';
import { getAllLinks } from '@/server/utils/queries/artistQueries';

// Platform regexes and error phrases
const platforms = [
  {
    name: 'patreon',
    // Accept extra path segments or query parameters after username
    regex: /^https?:\/\/(?:www\.)?patreon\.com\/[A-Za-z0-9_-]+(?:[\/\?].*)?$/,
    errorPhrases: [
      "404 Not Found",
      "This page has moved",
      "Patreon page not found",
      "<title>404 Not Found</title>",
      "<title>Patreon</title>"
    ]
  },
  {
    name: 'youtube',
    regex: /^https?:\/\/(www\.)?youtube\.com\/(channel|user|c|@)[A-Za-z0-9_-]+/,
    errorPhrases: [
      "This page isn't available",
      "404 Not Found",
      "Channel does not exist",
      "has been terminated",
      "is not available",
      "This account has been terminated",
      "The page you are looking for does not exist",
      "<title>Not Found</title>",
      "<title>404 Not Found</title>",
      "<title>YouTube</title>"
    ]
  },
  {
    name: 'soundcloud',
    regex: /^https?:\/\/(www\.)?soundcloud\.com\/[A-Za-z0-9_-]+/,
    errorPhrases: [
      "Sorry! We can't find that user.",
      "We can't find that user.",
      "We can't find that user.",
      "We couldn't find that page.",
      "404 Not Found",
      "<title>404 Not Found</title>",
      "<title>Something went wrong on SoundCloud</title>"
    ]
  },
  {
    name: 'bandcamp',
    regex: /^https?:\/\/(?:([A-Za-z0-9_-]+)\.bandcamp\.[^\/]+|(?:www\.)?bandcamp\.com\/[A-Za-z0-9_-]+)/,
    errorPhrases: [
      "Sorry, that something isn't here.",
      "404 Not Found",
      "<title>404 Not Found</title>",
      "<title>Signup | Bandcamp</title>"
    ]
  },
  {
    name: 'audius',
    regex: /^https?:\/\/(www\.)?audius\.co\/[A-Za-z0-9_-]+/,
    errorPhrases: [
      "404 Not Found",
      "User not found",
      "<title>404 Not Found</title>"
    ]
  },
  {
    name: 'lastfm',
    regex: /^https?:\/\/(www\.)?last\.fm\/(user|music)\/[A-Za-z0-9_-]+/,
    errorPhrases: [
      "User not found",
      "404 Not Found",
      "<title>404 Not Found</title>"
    ]
  },
  {
    name: 'opensea',
    regex: /^https?:\/\/(www\.)?opensea\.io\/[A-Za-z0-9_-]+/,
    errorPhrases: [
      "404 Not Found",
      "This page could not be found",
      "<title>404 Not Found</title>"
    ]
  },
  {
    name: 'zora',
    regex: /^https?:\/\/(www\.)?zora\.co\/[A-Za-z0-9_-]+/,
    errorPhrases: [
      "404 Not Found",
      "This page could not be found",
      "<title>404 Not Found</title>"
    ]
  },
  {
    name: 'catalog',
    regex: /^https?:\/\/(www\.)?catalog\.works\/[A-Za-z0-9_-]+/,
    errorPhrases: [
      "404 Not Found",
      "This page could not be found",
      "<title>404 Not Found</title>"
    ]
  },
  {
    name: 'supercollector',
    regex: /^https?:\/\/(www\.)?supercollector\.xyz\/[A-Za-z0-9_-]+/,
    errorPhrases: [
      "404 Not Found",
      "This page could not be found",
      "<title>404 Not Found</title>"
    ]
  },
  {
    name: 'mintsongs',
    regex: /^https?:\/\/(www\.)?mintsongs\.com\/[A-Za-z0-9_-]+/,
    errorPhrases: [
      "404 Not Found",
      "This page could not be found",
      "<title>404 Not Found</title>"
    ]
  }
];

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== 'string') {
    return new Response(JSON.stringify({ valid: false, reason: 'No URL provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch regexes for all existing backend-validation platforms and override defaults
  try {
    const allLinks = await getAllLinks();
    // Build a lookup map of siteName -> regex string from DB (excluding ens and wallets)
    const regexMap: Record<string, string> = {};
    for (const link of allLinks) {
      if (link.siteName === 'ens' || link.siteName === 'wallets') continue;
      if (typeof link.regex === 'string' && link.regex.trim().length > 0) {
        regexMap[link.siteName] = link.regex.trim();
      }
    }

    // Override the regex for each platform if a DB regex exists
    for (const p of platforms) {
      const dbRegex = regexMap[p.name];
      if (dbRegex) {
        try {
          p.regex = new RegExp(dbRegex);
        } catch (err) {
          console.error(`Invalid regex from DB for ${p.name}:`, dbRegex, err);
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch platform regexes from DB:', e);
  }

  // Find the first matching platform
  const platform = platforms.find(p => p.regex.test(url));
  if (!platform) {
    return new Response(JSON.stringify({ valid: false, reason: 'Unsupported platform or invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(url, { method: 'GET' });
    const text = await response.text();
    console.debug(`${platform.name} status:`, response.status);
    console.debug(`${platform.name} backend validation HTML:`, text);
    if (response.status === 404) {
      return new Response(JSON.stringify({ valid: false, reason: '404 Not Found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (response.status === 200) {
      // Special case: SoundCloud sometimes redirects to /404 page.
      if (platform.name === 'soundcloud' && response.url.includes('/404')) {
        return new Response(JSON.stringify({ valid: false, reason: 'soundcloud 404 redirect' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      for (const phrase of platform.errorPhrases) {
        if (text.toLowerCase().includes(phrase.toLowerCase())) {
          return new Response(JSON.stringify({ valid: false, reason: `${platform.name} error page` }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }
    return new Response(JSON.stringify({ valid: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ valid: false, reason: 'Network error or invalid URL' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
} 