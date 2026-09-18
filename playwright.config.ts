import { defineConfig, devices } from "@playwright/test";

/**
 * The real-editor suite needs the dev server on the same port every time so the
 * mount assertion is reproducible. `reuseExistingServer` keeps a hand-started
 * server usable while iterating.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 45_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5178",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5178 --strictPort",
    url: "http://localhost:5178",
    reuseExistingServer: true,
    timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
