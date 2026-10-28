import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "node_modules/@playwright/test/cli.js");
let failed = false;
for (const [phase, config] of [["app", []], ["bot", ["--config", "test/browser/yoinkbot.config.ts"]]]) {
  const result = spawnSync(process.execPath, [cli, "test", ...config, ...process.argv.slice(2), "--output", join(root, "test-results", phase)], { cwd: root, stdio: "inherit", env: { ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: join(root, "playwright-report", phase), PLAYWRIGHT_JSON_OUTPUT_NAME: join(root, "playwright-report", phase, "results.json") } });
  failed ||= result.error !== undefined || result.status !== 0;
}
process.exitCode = failed ? 1 : 0;
