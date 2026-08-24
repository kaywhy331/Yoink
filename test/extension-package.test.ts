import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("the extension release allowlist contains every packaged observer and mutation runner", () => {
  const script = readFileSync(join(process.cwd(), "scripts", "package-extension.mjs"), "utf8");
  for (const file of [
    "target-shadow.js",
    "target-action.js",
    "walmart-action.js",
    "amazon-action.js",
    "bestbuy-action.js",
    "retailer-shadow.js",
    "trackalacker-push.js",
    "trackalacker-sync.js"
  ]) {
    assert.match(script, new RegExp(`\\"${file.replaceAll(".", "\\.")}\\"`), `${file} must be included in the release zip`);
  }
});
