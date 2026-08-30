/* Playwright config for the Architecture Studio.
   The app is a single self-contained index.html served by server.mjs on :8080.
   Tests live in tests/playwright/. Run with: npx playwright test. */
const { defineConfig } = require("playwright/test");

module.exports = defineConfig({
  testDir: "./tests/playwright",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,          /* single browser, serial — the app shares localStorage origin */
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:8080",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        channel: undefined,      /* use the chromium Playwright downloaded, not Chrome */
      },
    },
  ],
  webServer: {
    /* server.mjs serves dist/index.html, so stage the self-contained
       index.html there first (same as run.sh). reuseExistingServer:false
       guarantees each run serves THIS checkout's index.html, never a
       stale server left running by another copy of the project. */
    command: "mkdir -p dist && cp index.html dist/index.html && PORT=8080 node server.mjs",
    port: 8080,
    cwd: __dirname,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
