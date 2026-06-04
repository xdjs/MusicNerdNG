import { NextRequest, NextResponse } from 'next/server';

// NOTE: This uses in-memory storage which resets on serverless cold starts and is
// not shared across worker instances. This provides best-effort protection for a
// low-traffic site. For stronger guarantees, swap to @upstash/ratelimit + @upstash/redis.

const STRICT_PATHS = ['/api/funFacts', '/api/artistBio', '/api/askArtist'];
const MEDIUM_PATHS = ['/api/validateLink', '/api/directEditLink'];

type Tier = 'strict' | 'medium' | 'default';

function getTier(pathname: string): Tier {
  if (STRICT_PATHS.some((p) => pathname.startsWith(p))) return 'strict';
  if (MEDIUM_PATHS.some((p) => pathname.startsWith(p))) return 'medium';
  return 'default';
}

function envInt(name: string, fallback: number): number {
  const val = Number(process.env[name]);
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

// Cached at module load so env vars aren't re-read on every request.
// jest.resetModules() in tests causes re-evaluation, so env override tests still work.
const LIMITS = {
  strict: envInt('RATE_LIMIT_STRICT', 5),
  medium: envInt('RATE_LIMIT_MEDIUM', 20),
  default: envInt('RATE_LIMIT_DEFAULT', 60),
} as const;
const WINDOW_MS = envInt('RATE_LIMIT_WINDOW_MS', 60_000);

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export const _rateLimitMap = new Map<string, RateLimitEntry>();
let requestCount = 0;

function cleanup(now: number) {
  for (const [key, entry] of _rateLimitMap) {
    if (now >= entry.resetTime) {
      _rateLimitMap.delete(key);
    }
  }
}

function rateLimitHeaders(entry: RateLimitEntry, limit: number): Record<string, string> {
  const remaining = Math.max(0, limit - entry.count);
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.ceil(entry.resetTime / 1000)),
  };
}

export function middleware(request: NextRequest): NextResponse {
  // x-real-ip is set by Vercel/nginx from the actual TCP connection, not spoofable.
  // Fall back to rightmost x-forwarded-for (proxy-appended, not client-controlled).
  const ip =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
    null;

  // Skip rate limiting if IP can't be determined (local dev, health checks)
  // to avoid all anonymous requests sharing one bucket.
  if (!ip) return NextResponse.next();

  const pathname = request.nextUrl.pathname;
  const now = Date.now();
  const tier = getTier(pathname);
  const limit = LIMITS[tier];
  const key = `${ip}:${tier}`;

  // Periodic cleanup to prevent memory leaks
  requestCount = (requestCount + 1) % 100;
  if (requestCount === 0) {
    cleanup(now);
  }

  const entry = _rateLimitMap.get(key);

  if (!entry || now >= entry.resetTime) {
    const newEntry = { count: 1, resetTime: now + WINDOW_MS };
    _rateLimitMap.set(key, newEntry);
    const response = NextResponse.next();
    for (const [h, v] of Object.entries(rateLimitHeaders(newEntry, limit))) {
      response.headers.set(h, v);
    }
    return response;
  }

  // Count increments before the limit check: first request sets count=1 in the
  // branch above, subsequent requests increment here. The (limit+1)th request
  // is the first to be rejected (entry.count > limit).
  entry.count++;

  const headers = rateLimitHeaders(entry, limit);

  if (entry.count > limit) {
    const retryAfterSec = Math.ceil((entry.resetTime - now) / 1000);
    return new NextResponse(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSec),
        ...headers,
      },
    });
  }

  const response = NextResponse.next();
  for (const [h, v] of Object.entries(headers)) {
    response.headers.set(h, v);
  }
  return response;
}

export const config = {
  matcher: '/api/((?!auth/).*)',
};
