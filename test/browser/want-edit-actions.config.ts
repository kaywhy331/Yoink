import { defineConfig } from "@playwright/test";
import base from "../../playwright.config.js";

// Its own in-memory server, no fixture web server, and no report folder in the
// repository: run with --output pointing outside it.
const { webServer: _fixtureServer, reporter: _reporter, ...config } = base;
export default defineConfig({ ...config, reporter: [["list"]], testDir: ".", testMatch: "want-edit-actions.spec.ts" });
