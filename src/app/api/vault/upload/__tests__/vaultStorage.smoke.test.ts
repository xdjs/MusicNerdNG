/**
 * @jest-environment node
 */

/**
 * REAL-STORAGE INTEGRATION SMOKE TEST — exercises the ACTUAL Supabase Storage
 * round-trip (upload → public URL → list → delete) against the real project in
 * `.env.local` (Dev). This is the layer that catches storage-integration
 * regressions the mocked unit tests structurally cannot: a revoked service-role
 * key, a missing/renamed `vault-files` bucket, a changed bucket policy.
 *
 * Excluded from the unit suite via the `*.smoke.test.ts` name. Run on demand:
 *   npm run test:smoke
 *
 * Reads real creds from `.env.local` (jest forces NODE_ENV=test, which makes
 * `@/env` return stubs — so we go straight to process.env here). Skips cleanly
 * when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent.
 */
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "vault-files";
const ready = Boolean(SUPABASE_URL && SERVICE_KEY);

(ready ? describe : describe.skip)("real-storage integration: vault-files bucket", () => {
  jest.setTimeout(30_000);

  const sb: SupabaseClient = ready
    ? createClient(SUPABASE_URL as string, SERVICE_KEY as string, { auth: { persistSession: false } })
    : (null as unknown as SupabaseClient);

  const baseName = `${Date.now()}_probe.pdf`;
  const path = `__smoke__/${baseName}`;

  afterAll(async () => {
    // Belt-and-suspenders cleanup in case an assertion aborted before the remove.
    if (ready) await sb.storage.from(BUCKET).remove([path]).catch(() => {});
  });

  it("uploads a PDF, exposes a public URL, reads it back, and deletes it", async () => {
    // Real %PDF payload so it would pass the route's magic-byte validation too.
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(path, pdf, { contentType: "application/pdf" });
    expect(uploadErr).toBeNull();

    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
    expect(urlData.publicUrl).toMatch(/\/vault-files\/__smoke__\/.+\.pdf$/);

    // Read-back: download the exact object and verify its bytes round-tripped.
    const { data: blob, error: downloadErr } = await sb.storage.from(BUCKET).download(path);
    expect(downloadErr).toBeNull();
    const readBack = Buffer.from(await (blob as Blob).arrayBuffer());
    expect(readBack.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(readBack.length).toBe(pdf.length);

    const { error: removeErr } = await sb.storage.from(BUCKET).remove([path]);
    expect(removeErr).toBeNull();
  });
});
