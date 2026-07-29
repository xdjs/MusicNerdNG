import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

/**
 * FRONT-TO-BACK: uploaded vault files actually feed the "Ask About" chat.
 *
 * Uploads a file containing a UNIQUE, un-Googleable fact to an artist's vault,
 * then asks /api/askArtist a question whose answer exists ONLY in that file. If
 * the answer echoes the marker, the uploaded file was used as LLM context —
 * proving the vault → askArtist pipeline (upload → extractedText → approved
 * source → Gemini "VERIFIED SOURCES") works end-to-end.
 *
 * Runs against the local dev server by default, or a deployed host via
 * E2E_BASE_URL, e.g.:
 *   E2E_BASE_URL=https://staging.musicnerd.xyz npx playwright test askartist-vault-context
 */
const ADMIN = { email: 'test-6184@privy.io', otp: '413532' };

// A nonsense proper noun that appears in no public source. If it shows up in the
// answer, it can only have come from the uploaded vault file.
const MARKER = 'Blorptangle Marmalade Protocol';

test.describe('Ask About uses uploaded vault files as context', () => {
  test.setTimeout(180_000);

  test('uploaded file answers an otherwise-unknowable question', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.otp);

    // Pick any artist from the homepage.
    await page.goto('/');
    const firstArtist = page.locator('a[href^="/artist/"]').first();
    await firstArtist.waitFor({ state: 'visible', timeout: 20_000 });
    const href = await firstArtist.getAttribute('href');
    expect(href, 'expected an artist link on the homepage').toBeTruthy();
    const artistId = href!.replace(/^\/artist\//, '').split(/[?#]/)[0];
    await page.goto(href!);

    // Enter edit mode and upload a .txt file carrying the unique fact.
    const toggle = page.getByTestId('edit-mode-toggle');
    await toggle.waitFor({ state: 'visible', timeout: 20_000 });
    await toggle.click();

    const fileInput = page.locator('input[type="file"][accept*=".pdf"]'); // the vault input
    await fileInput.waitFor({ state: 'attached', timeout: 20_000 });

    const fileName = `askabout-context-${Date.now()}.txt`;
    const fileText = `Verification note for testing. This artist's debut mixtape is titled "${MARKER}", released in 2094. This fact appears in no public source.`;
    await fileInput.setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from(fileText) });

    // Part 1: the upload actually lands in the vault (on whatever host we target).
    await expect(page.getByRole('heading', { name: fileName })).toBeVisible({ timeout: 30_000 });

    // Part 2: ask the public Ask-About endpoint a question only the file can answer.
    const res = await page.request.post('/api/askArtist', {
      data: { artistId, question: "What is the title of this artist's debut mixtape?" },
      timeout: 60_000,
    });
    expect(res.ok(), `askArtist HTTP ${res.status()}`).toBeTruthy();
    const body = await res.json();
    const answer: string = body.answer ?? '';
    console.log(`\n[askArtist answer]\n${answer}\n`);

    // The marker can only be in the answer if the uploaded file fed the context.
    expect(answer.toLowerCase()).toContain('blorptangle');

    // Cleanup — remove the test source so the artist's vault/answers aren't polluted.
    const deleteBtn = page
      .getByRole('heading', { name: fileName })
      .locator('xpath=ancestor::*[.//button[@aria-label="Delete"]][1]')
      .locator('button[aria-label="Delete"]')
      .first();
    if (await deleteBtn.count().catch(() => 0)) {
      await deleteBtn.click().catch(() => {});
      await expect(page.getByRole('heading', { name: fileName })).toBeHidden({ timeout: 10_000 }).catch(() => {});
    }
  });
});
