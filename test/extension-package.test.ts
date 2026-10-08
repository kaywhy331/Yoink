import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ADD_LANES, ADD_LANE_IDS } from "../packages/contracts/src/index.js";

test("the extension release allowlist contains every observer and derives mutation runners from the lane registry", () => {
  const script = readFileSync(join(process.cwd(), "scripts", "package-extension.mjs"), "utf8");
  for (const file of [
    "target-shadow.js",
    "retailer-shadow.js",
    "observer-recipe-oracle.js",
    "trackalacker-push.js",
    "trackalacker-sync.js",
    "observer-recipe-root.js",
    "popup-state.js",
    "runtime-config.js",
    "options.html",
    "options.js",
    "options.css"
  ]) {
    assert.match(script, new RegExp(`\\"${file.replaceAll(".", "\\.")}\\"`), `${file} must be included in the release zip`);
  }
  assert.match(script, /add-lanes\.ts/);
  assert.match(script, /\.\.\.actionFiles/);
  for (const retailerId of ADD_LANE_IDS) {
    assert.match(ADD_LANES[retailerId].runnerFile, /^[a-z0-9]+-action\.js$/);
  }
});

test("every companion notification uses a PNG icon that ships in the package", () => {
  // chrome.notifications cannot decode SVG: create() rejects with "Unable to
  // download all specified images.", so no call was ever shown while the
  // companion used yoink-icon.svg.
  const background = readFileSync(join(process.cwd(), "apps", "extension", "background.js"), "utf8");
  const script = readFileSync(join(process.cwd(), "scripts", "package-extension.mjs"), "utf8");
  const creates = background.match(/chrome\.notifications\??\.create\??\.?\(/g) ?? [];
  const icons = [...background.matchAll(/iconUrl: chrome\.runtime\.getURL\(([^)]*)\)/g)].map(match => match[1]);
  assert.ok(creates.length > 0);
  assert.deepEqual(icons, creates.map(() => "NOTIFICATION_ICON"), "every notification uses NOTIFICATION_ICON");
  const icon = /const NOTIFICATION_ICON = "([^"]+)";/.exec(background)?.[1] ?? "";
  assert.match(icon, /\.png$/);
  assert.ok(script.includes(`"${icon}"`), `${icon} is in the release allowlist`);
  const bytes = readFileSync(join(process.cwd(), "apps", "extension", icon));
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${icon} is a PNG`);
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

    const packagedFiles = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
    assert.equal(packagedFiles.status, 0, packagedFiles.stderr);
    for (const file of [
      "options.html",
      "options.js",
      "options.css",
      ...ADD_LANE_IDS.map((retailerId) => ADD_LANES[retailerId].runnerFile)
    ]) {
      assert.match(packagedFiles.stdout, new RegExp(`^${file.replaceAll(".", "\\.")}$`, "m"));
    }

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
