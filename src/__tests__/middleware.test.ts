import { NextRequest } from 'next/server';

// NextRequest.ip is read-only, so we set x-forwarded-for as the fallback.
// The middleware uses: x-real-ip ?? rightmost x-forwarded-for ?? null (skip if no IP)
function makeRequest(path: string, ip = '1.2.3.4'): NextRequest {
  const url = `https://localhost:3000${path}`;
  return new NextRequest(url, {
    headers: { 'x-forwarded-for': ip },
  });
}

// Re-import middleware per test group so the in-memory Map resets
async function loadMiddleware() {
  jest.resetModules();
  const mod = await import('../middleware');
  return mod;
}

beforeEach(() => {
  jest.useFakeTimers();
  delete process.env.RATE_LIMIT_DEFAULT;
  delete process.env.RATE_LIMIT_STRICT;
  delete process.env.RATE_LIMIT_MEDIUM;
  delete process.env.RATE_LIMIT_WINDOW_MS;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('middleware rate limiting', () => {
  it('passes through requests under the default limit', async () => {
    const { middleware } = await loadMiddleware();
    for (let i = 0; i < 60; i++) {
      const res = middleware(makeRequest('/api/leaderboard'));
      expect(res.status).not.toBe(429);
    }
  });

  it('returns 429 when default limit is exceeded', async () => {
    const { middleware } = await loadMiddleware();
    for (let i = 0; i < 60; i++) {
      middleware(makeRequest('/api/leaderboard'));
    }
    const res = middleware(makeRequest('/api/leaderboard'));
    expect(res.status).toBe(429);
  });

  it('strict paths have lower limits (5/min)', async () => {
    const { middleware } = await loadMiddleware();
    for (let i = 0; i < 5; i++) {
      const res = middleware(makeRequest('/api/funFacts/random'));
      expect(res.status).not.toBe(429);
    }
    const res = middleware(makeRequest('/api/funFacts/random'));
    expect(res.status).toBe(429);
  });

  it('strict limit applies to artistBio path', async () => {
    const { middleware } = await loadMiddleware();
    for (let i = 0; i < 5; i++) {
      middleware(makeRequest('/api/artistBio/123'));
    }
    const res = middleware(makeRequest('/api/artistBio/123'));
    expect(res.status).toBe(429);
  });

  it('medium paths have their own limit (20/min)', async () => {
    const { middleware } = await loadMiddleware();
    for (let i = 0; i < 20; i++) {
      const res = middleware(makeRequest('/api/validateLink'));
      expect(res.status).not.toBe(429);
    }
    const res = middleware(makeRequest('/api/validateLink'));
    expect(res.status).toBe(429);
  });

  it('window resets after expiry', async () => {
    const { middleware } = await loadMiddleware();
    for (let i = 0; i < 60; i++) {
      middleware(makeRequest('/api/leaderboard'));
    }
    expect(middleware(makeRequest('/api/leaderboard')).status).toBe(429);

    jest.advanceTimersByTime(61_000);

    const res = middleware(makeRequest('/api/leaderboard'));
    expect(res.status).not.toBe(429);
  });

  it('env vars override defaults', async () => {
    process.env.RATE_LIMIT_STRICT = '10';
    const { middleware } = await loadMiddleware();

    for (let i = 0; i < 10; i++) {
      const res = middleware(makeRequest('/api/funFacts/random'));
      expect(res.status).not.toBe(429);
    }
    const res = middleware(makeRequest('/api/funFacts/random'));
    expect(res.status).toBe(429);
  });

  it('invalid env var values fall back to defaults', async () => {
    process.env.RATE_LIMIT_STRICT = '0';
    const { middleware } = await loadMiddleware();

    // Should use the default of 5, not 0
    for (let i = 0; i < 5; i++) {
      const res = middleware(makeRequest('/api/funFacts/random'));
      expect(res.status).not.toBe(429);
    }
    const res = middleware(makeRequest('/api/funFacts/random'));
    expect(res.status).toBe(429);
  });

  it('429 response includes Retry-After header', async () => {
    const { middleware } = await loadMiddleware();
    for (let i = 0; i < 60; i++) {
      middleware(makeRequest('/api/leaderboard'));
    }
    const res = middleware(makeRequest('/api/leaderboard'));
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
  });

  it('includes X-RateLimit-* headers on successful responses', async () => {
    const { middleware } = await loadMiddleware();

    const res = middleware(makeRequest('/api/leaderboard'));
    expect(res.status).not.toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('59');
    // X-RateLimit-Reset is a Unix timestamp (seconds since epoch)
    const reset = Number(res.headers.get('X-RateLimit-Reset'));
    const nowSec = Math.ceil(Date.now() / 1000);
    expect(reset).toBeGreaterThanOrEqual(nowSec);
    expect(reset).toBeLessThanOrEqual(nowSec + 60);
  });

  it('X-RateLimit-Remaining decrements correctly', async () => {
    const { middleware } = await loadMiddleware();

    middleware(makeRequest('/api/leaderboard'));
    const res = middleware(makeRequest('/api/leaderboard'));
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('58');
  });

  it('429 response includes X-RateLimit-* headers', async () => {
    const { middleware } = await loadMiddleware();
    for (let i = 0; i < 60; i++) {
      middleware(makeRequest('/api/leaderboard'));
    }
    const res = middleware(makeRequest('/api/leaderboard'));
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('different IPs are tracked independently', async () => {
    const { middleware } = await loadMiddleware();
    for (let i = 0; i < 60; i++) {
      middleware(makeRequest('/api/leaderboard', '10.0.0.1'));
    }
    expect(middleware(makeRequest('/api/leaderboard', '10.0.0.1')).status).toBe(429);

    const res = middleware(makeRequest('/api/leaderboard', '10.0.0.2'));
    expect(res.status).not.toBe(429);
  });

  it('uses rightmost x-forwarded-for IP (not client-spoofable leftmost)', async () => {
    const { middleware } = await loadMiddleware();
    // Simulate proxy chain: client-supplied, cdn-appended
    const url = 'https://localhost:3000/api/leaderboard';
    const req = new NextRequest(url, {
      headers: { 'x-forwarded-for': 'spoofed.ip, real.proxy.ip' },
    });

    middleware(req);

    // Make requests from "real.proxy.ip" to exhaust its limit
    for (let i = 1; i < 60; i++) {
      const r = new NextRequest(url, {
        headers: { 'x-forwarded-for': 'different.spoof, real.proxy.ip' },
      });
      middleware(r);
    }

    // 61st request from same real IP should be blocked
    const blocked = new NextRequest(url, {
      headers: { 'x-forwarded-for': 'yet.another.spoof, real.proxy.ip' },
    });
    expect(middleware(blocked).status).toBe(429);
  });

  it('expired entries are cleaned up from the map', async () => {
    const { middleware, _rateLimitMap } = await loadMiddleware();

    for (let i = 0; i < 5; i++) {
      middleware(makeRequest('/api/leaderboard', `10.0.0.${i}`));
    }
    expect(_rateLimitMap.size).toBe(5);

    jest.advanceTimersByTime(61_000);

    // Trigger cleanup — requestCount wraps at 100, cleanup fires when it hits 0
    for (let i = 0; i < 100; i++) {
      middleware(makeRequest('/api/leaderboard', '99.99.99.99'));
    }

    expect(_rateLimitMap.has('10.0.0.0:default')).toBe(false);
    expect(_rateLimitMap.has('99.99.99.99:default')).toBe(true);
  });

  it('skips rate limiting when IP cannot be determined', async () => {
    const { middleware, _rateLimitMap } = await loadMiddleware();
    const url = 'https://localhost:3000/api/leaderboard';

    // No x-real-ip or x-forwarded-for headers
    for (let i = 0; i < 100; i++) {
      const req = new NextRequest(url);
      const res = middleware(req);
      expect(res.status).not.toBe(429);
    }

    // No entries should be created for unknown IPs
    expect(_rateLimitMap.size).toBe(0);
  });

  it('auth paths are excluded by matcher config', async () => {
    const { config } = await loadMiddleware();
    const patterns = Array.isArray(config.matcher) ? config.matcher : [config.matcher];
    const apiPattern = patterns.find(p => p.startsWith('/api/'));
    expect(apiPattern).toBeDefined();
    const matcher = new RegExp(apiPattern as string);

    // Auth paths should NOT match
    expect(matcher.test('/api/auth/signin')).toBe(false);
    expect(matcher.test('/api/auth/callback')).toBe(false);
    expect(matcher.test('/api/auth/session')).toBe(false);

    // Regular API paths should match
    expect(matcher.test('/api/leaderboard')).toBe(true);
    expect(matcher.test('/api/funFacts/random')).toBe(true);
    expect(matcher.test('/api/validateLink')).toBe(true);
  });

  it('covers the LLM-facing routes, which are not under /api', async () => {
    // /artist/<id>/llms.txt hands out a whole knowledge document and the
    // sitemaps enumerate every artist id, so an unthrottled one is a bulk
    // export of the catalogue. These live outside the /api matcher and were
    // getting no rate limiting at all.
    const { config } = await loadMiddleware();
    const patterns = Array.isArray(config.matcher) ? config.matcher : [config.matcher];
    expect(patterns).toContain('/llms.txt');
    expect(patterns).toContain('/artist/:id/llms.txt');
  });

  it('rate limits the per-artist document at the default tier', async () => {
    const { middleware } = await loadMiddleware();
    const ip = '203.0.113.42';
    for (let i = 0; i < 60; i++) {
      const res = middleware(makeRequest('/artist/abc/llms.txt', ip));
      expect(res.status).not.toBe(429);
    }
    expect(middleware(makeRequest('/artist/abc/llms.txt', ip)).status).toBe(429);
  });
});
