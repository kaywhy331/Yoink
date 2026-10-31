import { defineConfig } from "@playwright/test";
import base from "../../playwright.config.js";

const { webServer: _fixtureServer, ...config } = base;
export default defineConfig({ ...config, testDir: ".", testMatch: "suggested-want.spec.ts" });
