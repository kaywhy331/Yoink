import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
    "trackalacker-sync.js",
    "observer-recipe-root.js",
    "runtime-config.js"
  ]) {
    assert.match(script, new RegExp(`\\"${file.replaceAll(".", "\\.")}\\"`), `${file} must be included in the release zip`);
  }
});

test("the production extension profile is deterministic, HTTPS-pinned, and contains no local update origin", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-production-extension-"));
  const packageVersion = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version as string;
  const archive = join(directory, `Yoink-Companion-${packageVersion}-production.zip`);
  const args = [
    "scripts/package-extension.mjs",
    "--profile=production",
    "--api-origin=https://api.yoink.example",
    "--app-origin=https://app.yoink.example",
    `--output-directory=${directory}`
  ];
  try {
    const first = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const firstHash = createHash("sha256").update(readFileSync(archive)).digest("hex");
    const second = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), firstHash);

    const manifestResult = spawnSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8" });
    assert.equal(manifestResult.status, 0, manifestResult.stderr);
    const manifest = JSON.parse(manifestResult.stdout) as { host_permissions: string[] };
    assert.deepEqual(manifest.host_permissions, ["https://api.yoink.example/*"]);
    assert.doesNotMatch(manifestResult.stdout, /127\.0\.0\.1|http:\/\//);

    const configResult = spawnSync("unzip", ["-p", archive, "runtime-config.js"], { encoding: "utf8" });
    assert.equal(configResult.status, 0, configResult.stderr);
    assert.match(configResult.stdout, /"profile": "production"/);
    assert.match(configResult.stdout, /"apiOrigin": "https:\/\/api\.yoink\.example"/);
    assert.match(configResult.stdout, /"appOrigin": "https:\/\/app\.yoink\.example"/);
    assert.match(configResult.stdout, /"localPackageUpdates": false/);
    assert.doesNotMatch(configResult.stdout, /127\.0\.0\.1|http:\/\//);

    const missingOrigin = spawnSync(process.execPath, [
      "scripts/package-extension.mjs",
      "--profile=production",
      `--output-directory=${directory}`
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(missingOrigin.status, 0);
    assert.match(missingOrigin.stderr, /exact credential-free HTTPS origin/);
    const loopbackOrigin = spawnSync(process.execPath, [
      "scripts/package-extension.mjs",
      "--profile=production",
      "--api-origin=https://127.0.0.1",
      `--output-directory=${directory}`
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(loopbackOrigin.status, 0);
    assert.match(loopbackOrigin.stderr, /exact credential-free HTTPS origin/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
