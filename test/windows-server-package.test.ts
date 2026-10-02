import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import test from "node:test";
import { watchControlStdin, type ControlStopReason } from "../apps/api/src/control-channel.js";
import { sameBootTime } from "../packages/database/src/data-directory-lock.js";
// @ts-expect-error -- plain .mjs build script without type declarations
import { productionPackagePaths, renderManifest, renderStartScript, SERVER_ENTRY } from "../scripts/package-windows-server.mjs";

test("a `stop` line stops the server once; later input and the stdin close add nothing", () => {
  const input = new PassThrough();
  const reasons: ControlStopReason[] = [];
  watchControlStdin(input, (reason) => reasons.push(reason));
  input.write("status\r\n  St");
  assert.deepEqual(reasons, [], "a partial line is not a command");
  input.write("OP \r\n");
  input.write("stop\n");
  input.emit("close");
  assert.deepEqual(reasons, ["CONTROL_STOP"]);
});

test("a closed stdin stops the server: the tray app exited and nobody is left to stop it", () => {
  const input = new PassThrough();
  const reasons: ControlStopReason[] = [];
  watchControlStdin(input, (reason) => reasons.push(reason));
  input.end();
  input.emit("end");
  assert.deepEqual(reasons, ["CONTROL_CLOSED"]);
});

test("boot times within two minutes are one boot; unreadable times never make a lock stale", () => {
  assert.equal(sameBootTime("2026-09-29T08:00:00.000Z", "2026-09-29T08:01:30.000Z"), true);
  assert.equal(sameBootTime("2026-09-29T08:00:00.000Z", "2026-09-29T09:00:00.000Z"), false);
  assert.equal(sameBootTime("not a time", "2026-09-29T09:00:00.000Z"), true);
});

test("the package carries pg's run-time closure only: no dev or optional packages", () => {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages: Record<string, { dev?: boolean; optional?: boolean }> };
  const paths = productionPackagePaths(lock) as string[];
  assert.ok(paths.includes("node_modules/pg"));
  assert.ok(paths.includes("node_modules/pg-protocol"));
  assert.ok(!paths.includes("node_modules/pg-cloudflare"), "pg-cloudflare is optional and Workers-only");
  assert.ok(!paths.includes("node_modules/typescript"));
  for (const path of paths) assert.ok(!lock.packages[path]!.dev && !lock.packages[path]!.optional, path);
});

test("the launcher uses CRLF, relative paths, the local data folder, and the same entry as the manifest", () => {
  const script = renderStartScript() as string;
  assert.ok(script.split("\n").slice(0, -1).every((line) => line.endsWith("\r")), "every line ends CRLF");
  assert.match(script, /%LOCALAPPDATA%\\Yoink\\data/);
  assert.match(script, /"%YOINK_HOME%node\\node\.exe" dist\\apps\\api\\src\\server\.js/);
  const manifest = renderManifest({
    version: "1.28.4",
    build: { commit: "abc", dirty: false, buildId: "id" },
    nodeVersion: "22.22.0",
    nodeSha256: "f".repeat(64)
  });
  assert.equal(manifest.server.entry, SERVER_ENTRY);
  assert.equal(manifest.server.environment.YOINK_CONTROL_STDIN, "1");
  assert.equal(manifest.server.nonRetryableExitCode, 78);
  assert.equal(manifest.build.dirty, false);
});

test("a data export carries the database snapshot, keys and evidence, not locks, WAL files or old backups", async () => {
  // @ts-expect-error -- plain .mjs script without type declarations
  const { exportedEntry } = await import("../scripts/export-data.mjs");
  for (const name of ["observer-recipe-ed25519-private.pem", "observer-recipe-trust-manifest.json", "evidence", "offline-observer-recipe-root"]) {
    assert.equal(exportedEntry(name), true, name);
  }
  for (const name of ["yoink.sqlite", "yoink.lock", "yoink.sqlite-wal", "yoink.sqlite-shm", "yoink.sqlite.before-v70.2026-09-26T03-50-40-340Z.sqlite", "portability", "yoink-data.json"]) {
    assert.equal(exportedEntry(name), false, name);
  }
});

test("the Windows release README walks the move from TrixBot in order, with CRLF line endings", async () => {
  // @ts-expect-error -- plain .mjs script without type declarations
  const { renderReadme } = await import("../scripts/package-windows.mjs");
  const readme = renderReadme("1.28.4") as string;
  assert.ok(readme.startsWith("Yoink 1.28.4 for Windows\r\n"));
  const steps = ["systemctl --user stop yoink-local-api", "export-data.mjs", "Close the SSH tunnel", "imports the Yoink-Data ZIP", "Delete the Yoink-Data ZIP"];
  const positions = steps.map((step) => readme.indexOf(step));
  assert.ok(positions.every((position) => position >= 0), JSON.stringify(positions));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("review Windows packages retain the full application without depot credentials or activation instructions", async () => {
  // @ts-expect-error -- plain .mjs build script without type declarations
  const { windowsPackagePlan, renderReviewReadme } = await import("../scripts/package-windows.mjs");
  const plan = windowsPackagePlan("1.30.0", true);
  assert.equal(plan.name, "Yoink-win-x64-1.30.0-review.zip");
  assert.equal(plan.includeDepotConfig, false);
  assert.deepEqual(plan.files, ["Yoink.exe", "Yoink-Server-win-x64-1.30.0.zip", "README.txt"]);
  const readme = renderReviewReadme("1.30.0") as string;
  assert.match(readme, /UNRELEASED REVIEW BUILD/);
  assert.match(readme, /Do not launch or install without separate approval/);
  assert.match(readme, /Existing depot settings remain active/);
  assert.equal(windowsPackagePlan("1.30.0").includeDepotConfig, true);
});
