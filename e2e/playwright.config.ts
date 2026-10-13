import { defineConfig } from '@playwright/test';

/**
 * Browser tests of the built playground. `npm run e2e` builds nothing: run `npm run build` first.
 * CI uses Playwright's Chromium; locally set PW_CHANNEL=msedge (or chrome) to use a browser that is already installed.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1500, height: 950 },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run preview -w @bango/playground -- --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
