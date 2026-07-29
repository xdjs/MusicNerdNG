import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

/**
 * FRONT-TO-BACK E2E for vault file upload.
 *
 * Drives the real UI in a real browser with a real (Privy test-account) session,
 * through the real Next.js server → canEditArtist → Supabase Storage → DB. This
 * is the layer that would catch a regression anywhere along that path — including
 * the empty-MIME `.md` rejection and the storage-config break — that a mocked unit
 * test can't. Runs against the local HTTPS dev server (see playwright.config.ts),
 * which uses the Dev database + storage.
 *
 *   npm run test:e2e -- vault-upload
 *
 * Admin test account → canEdit is true for any artist, so no claim setup needed.
 */
// Admin test account (is_admin = true in Dev) ⇒ canEdit is true for any artist,
// so no per-artist claim setup is needed. Same account the agent-work/mcp-keys specs use.
const ADMIN = { email: 'test-6184@privy.io', otp: '413532' };

// A real, magic-byte-valid PDF payload.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test.describe('Vault file upload', () => {
  test.setTimeout(120_000);

  test('admin uploads a PDF via the edit UI and it appears in the vault', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.otp);

    // Land on any artist page (homepage surfaces artist links).
    await page.goto('/');
    const firstArtist = page.locator('a[href^="/artist/"]').first();
    await firstArtist.waitFor({ state: 'visible', timeout: 20_000 });
    const href = await firstArtist.getAttribute('href');
    expect(href, 'expected an artist link on the homepage').toBeTruthy();
    await page.goto(href!);

    // Enter edit mode (admin ⇒ canEdit ⇒ toggle is rendered).
    const toggle = page.getByTestId('edit-mode-toggle');
    await toggle.waitFor({ state: 'visible', timeout: 20_000 });
    await toggle.click();

    // The vault file input is present once editing. Drive it directly — no native
    // file dialog — by setting files on the hidden <input type="file">. Target the
    // VAULT input specifically (accept includes ".pdf") — the HeroSection
    // profile-image input (accept="image/*") also exists in edit mode.
    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await fileInput.waitFor({ state: 'attached', timeout: 20_000 });

    const fileName = `e2e-upload-${Date.now()}.pdf`;
    await fileInput.setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: PDF });

    // Front-to-back success: the uploaded file surfaces in the vault UI as its
    // own source card (the filename is the card heading). Target the heading
    // specifically — the "Uploaded file: <name>" caption also contains the name.
    const uploadedHeading = page.getByRole('heading', { name: fileName });
    await expect(uploadedHeading).toBeVisible({ timeout: 30_000 });

    // Cleanup so the run is idempotent — delete the card we just added via its
    // Delete button. Best-effort: a cleanup miss shouldn't fail the upload test.
    const deleteBtn = uploadedHeading
      .locator('xpath=ancestor::*[.//button[@aria-label="Delete"]][1]')
      .locator('button[aria-label="Delete"]')
      .first();
    if (await deleteBtn.count().catch(() => 0)) {
      await deleteBtn.click().catch(() => {});
      await expect(uploadedHeading).toBeHidden({ timeout: 10_000 }).catch(() => {});
    }
  });
});
