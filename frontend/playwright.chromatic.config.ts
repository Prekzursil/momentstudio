import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/chromatic",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["line"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:4200",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --host 127.0.0.1 --port 4200",
    url: "http://127.0.0.1:4200",
    reuseExistingServer: !process.env.CI,
    timeout: 900_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
