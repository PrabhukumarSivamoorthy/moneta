import { defineConfig } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  // One retry in CI absorbs runner flakiness; locally a failure should fail.
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1440, height: 900 },
    // Debugging artifacts only when something goes wrong.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    port: 1420,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
