// @ts-nocheck
import { jest } from '@jest/globals';

// Mock the two things the health check inspects.
jest.mock('@/server/lib/supabase', () => ({ isSupabaseStorageConfigured: jest.fn(() => true) }));
jest.mock('@/server/db/drizzle', () => ({ db: { execute: jest.fn().mockResolvedValue([{ result: 1 }]) } }));

if (!('json' in Response)) {
  Response.json = (data, init) =>
    new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      status: init?.status || 200,
    });
}

describe('GET /api/health', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('returns 200 and ok:true when storage + database are healthy', async () => {
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checks.storage).toBe(true);
    expect(body.checks.database).toBe(true);
  });

  it('returns 503 and ok:false when storage is not configured (the outage we just had)', async () => {
    const supabase = await import('@/server/lib/supabase');
    (supabase.isSupabaseStorageConfigured as jest.Mock).mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.storage).toBe(false);
  });

  it('returns 503 when the database ping throws', async () => {
    const drizzle = await import('@/server/db/drizzle');
    (drizzle.db.execute as jest.Mock).mockRejectedValue(new Error('connection refused'));
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.database).toBe(false);
  });

  it('never leaks secrets (connection strings, service keys, JWTs) in the response', async () => {
    const { GET } = await import('../route');
    const res = await GET();
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//i);
    expect(serialized).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE_KEY/i);
    expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT-looking blobs
  });
});
