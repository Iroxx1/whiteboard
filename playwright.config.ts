import { defineConfig } from '@playwright/test'

export const E2E_PORT = 3100

// End-to-end tests against the production build (`pnpm build` first). The server is started by
// e2e/global-setup.ts with a fresh data directory.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    // Locally the installed Chrome is used; CI installs Playwright's Chromium.
    ...(process.env.CI ? {} : { channel: 'chrome' }),
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
})
