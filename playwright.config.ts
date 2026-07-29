import { defineConfig } from '@playwright/test';

// Set E2E_BASE_URL to run the E2E suite against a deployed environment (e.g.
// https://staging.musicnerd.xyz) instead of a local dev server. When set, the
// local dev webServer is not started.
const remoteBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: remoteBaseUrl ?? 'https://localhost:3001',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  // Only spin up the local dev server when targeting localhost.
  webServer: remoteBaseUrl
    ? undefined
    : {
        command: 'npx next dev --experimental-https --port 3001',
        url: 'https://localhost:3001',
        reuseExistingServer: true,
        ignoreHTTPSErrors: true,
        timeout: 60_000,
      },
});
