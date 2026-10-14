import { defineConfig } from "@playwright/test";
import base from "../../playwright.config.js";
export default defineConfig({...base, testDir: ".", testMatch: "yoinkbot.spec.ts", webServer: {
  command: "node --import tsx test/browser/yoinkbot-server.ts", cwd: process.cwd(),
  url: "http://127.0.0.1:33993", reuseExistingServer: false, timeout: 60000
}});
