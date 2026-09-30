import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real app in a real browser against a real backend:
//   * by default the app at http://localhost:3000 (start it with `npm run dev`
//     against `supabase start`, or with `npm run dev:local` for the emulator);
//   * set E2E_BASE_URL to point somewhere else.
// The backend must have the seed alpha code LOCAL-ALPHA (supabase/seed.sql).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "./test-results",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 860 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
