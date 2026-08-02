import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const continuousIntegrationSettings = process.env.CI
  ? { forbidOnly: true, retries: 2, workers: 1 }
  : { forbidOnly: false, retries: 0 };

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  ...continuousIntegrationSettings,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
