import { defineConfig, devices } from "@playwright/test";

// Browser e2e (e2e/*.spec.ts) in Chromium and WebKit, the engines of Chrome/Edge and Safari. scripts/e2e.mjs sets
// DSON_LIB to the installed tarball's build; the server then hands that file to the page instead of the copy in docs/.
// VERIFIED: both projects pass locally with Playwright 1.63; only the clipboard test is Chromium-only.
const port = Number(process.env.E2E_PORT ?? 4319);

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "output/e2e/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "output/e2e/playwright-report", open: "never" }],
    ["json", { outputFile: "output/e2e/playwright.json" }],
  ],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node scripts/server.mjs",
    url: `http://127.0.0.1:${port}/`,
    env: { PORT: String(port), DSON_LIB: process.env.DSON_LIB ?? "" },
    reuseExistingServer: false,
  },
});
