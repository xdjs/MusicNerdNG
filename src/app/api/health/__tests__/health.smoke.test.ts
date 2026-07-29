/**
 * @jest-environment node
 */

/**
 * POST-DEPLOY SMOKE TEST — hits the LIVE /api/health of a deployed environment
 * and fails if storage/database aren't actually wired. This is the layer that
 * catches deploy/config regressions (e.g. missing SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY on Vercel) that mocked unit tests structurally cannot.
 *
 * Excluded from the unit suite via the `*.smoke.test.ts` name. Run it against a
 * deployed URL:
 *
 *   SMOKE_BASE_URL=https://staging.musicnerd.xyz npm run test:smoke
 *
 * Intended to run automatically after each deploy (see CI). With no SMOKE_BASE_URL
 * set, it skips so a local `npm run test:smoke` doesn't fail for lack of a target.
 */
const BASE = process.env.SMOKE_BASE_URL?.replace(/\/$/, "");

(BASE ? describe : describe.skip)("post-deploy smoke: /api/health", () => {
  jest.setTimeout(30_000);

  it(`reports storage + database healthy at ${BASE}`, async () => {
    const res = await fetch(`${BASE}/api/health`);
    const body = await res.json().catch(() => ({}));
    // Include the actual payload in the assertion so a failure shows exactly
    // which check is red (e.g. { storage: false }) for fast diagnosis.
    expect({ httpStatus: res.status, ...body }).toMatchObject({
      httpStatus: 200,
      ok: true,
      checks: { storage: true, database: true },
    });
  });
});
