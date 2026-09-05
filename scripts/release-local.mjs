#!/usr/bin/env node
// One command from a green tree to a running local app and a packaged
// companion. The local app runs from the compiled dist tree under a systemd
// user unit, so a fix is invisible to renewal until the app is rebuilt and
// restarted; this script makes that step impossible to forget.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UNIT = process.env.YOINK_LOCAL_API_UNIT || "yoink-local-api.service";
const HEALTH_URL = process.env.YOINK_LOCAL_HEALTH_URL || "http://127.0.0.1:32991/api/v1/health";
const argv = process.argv.slice(2);
const skipRestart = argv.includes("--no-restart");
const skipPackage = argv.includes("--no-package");

function run(label, command, args) {
  process.stdout.write(`\n== ${label}\n`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status}.`);
}

function unitState() {
  const probe = spawnSync("systemctl", ["--user", "show", UNIT, "--property=LoadState,ActiveState"], { encoding: "utf8" });
  if (probe.status !== 0) return { loaded: false, active: false };
  const values = Object.fromEntries(probe.stdout.trim().split("\n").map((line) => line.split("=")));
  return { loaded: values.LoadState === "loaded", active: values.ActiveState === "active" };
}

async function waitForHealth(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL);
      const body = await response.json();
      if (body?.status === "ready") return body;
      last = `status ${body?.status ?? response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`The local app did not report ready within ${timeoutMs / 1000}s (${last}).`);
}

function describeVersions(versions) {
  if (!versions || typeof versions !== "object") return "  (the running app predates version reporting; rebuild and restart it)";
  const lines = [`  app ${versions.extension}`];
  for (const store of Object.keys(versions.add || {})) {
    lines.push(`  ${store}: ${versions.observer?.[store]} · ${versions.add?.[store]} · ${versions.pack?.[store]}`);
  }
  return lines.join("\n");
}

try {
  run("Build the app", "npm", ["run", "build:types"]);
  if (!skipPackage) run("Package the companion", "npm", ["run", "package:extension"]);
  const unit = unitState();
  if (skipRestart) {
    process.stdout.write(`\n== Restart skipped (--no-restart); the running app keeps its previous versions.\n`);
  } else if (unit.loaded) {
    run("Restart the local app", "systemctl", ["--user", "restart", UNIT]);
  } else {
    process.stdout.write(`\n== No ${UNIT} user unit found; restart the local app yourself.\n`);
  }
  const health = await waitForHealth();
  process.stdout.write(`\n== Running app reports\n${describeVersions(health.packagedVersions)}\n`);
  process.stdout.write("\nCompanion: an unpacked local install reloads itself within a minute of the app reporting new versions; a ZIP install needs a reload on chrome://extensions.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
