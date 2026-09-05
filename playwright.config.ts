import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:33993",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.YOINK_TEST_CHROME ? { executablePath: process.env.YOINK_TEST_CHROME } : {}
  },
  webServer: {
    command: "node --import tsx test/browser/fixture-server.ts",
    url: "http://127.0.0.1:33993",
    reuseExistingServer: false,
    timeout: 60_000
  }
});
