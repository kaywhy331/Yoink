#!/usr/bin/env node
// One command from a green tree to a running local app and a packaged
// companion. The local app runs from the compiled dist tree under a systemd
// user unit, so a fix is invisible to renewal until the app is rebuilt and
// restarted; this script makes that step impossible to forget.
//
// It also proves the tree is green before touching dist (PLAT-10): bundles,
// `npm run check` and `npm test` run first (`--skip-tests` skips only the
// tests). The build swaps dist atomically (scripts/build-dist.mjs), so a red
// build never replaces the running tree.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UNIT = process.env.YOINK_LOCAL_API_UNIT || "yoink-local-api.service";
const HEALTH_URL = process.env.YOINK_LOCAL_HEALTH_URL || "http://127.0.0.1:32991/api/v1/health";
// The same default the app and scripts/recheck-capsules.mjs resolve.
const DATA_DIRECTORY = resolve(process.env.YOINK_DATA_DIR || join(ROOT, "data"));
const argv = process.argv.slice(2);
const skipRestart = argv.includes("--no-restart");
const skipPackage = argv.includes("--no-package");
const skipTests = argv.includes("--skip-tests");
const uninstall = argv.includes("--uninstall");

function run(label, command, args) {
  process.stdout.write(`\n== ${label}\n`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status}.`);
}

function unitState() {
  const probe = spawnSync("systemctl", ["--user", "show", UNIT, "--property=LoadState,ActiveState,Transient"], { encoding: "utf8" });
  if (probe.status !== 0) return { loaded: false, active: false, transient: false };
  const values = Object.fromEntries(probe.stdout.trim().split("\n").map((line) => line.split("=")));
  return { loaded: values.LoadState === "loaded", active: values.ActiveState === "active", transient: values.Transient === "yes" };
}

/**
 * How the release brings the new build up. A transient unit (systemd-run)
 * would not survive a reboot, so the release replaces it with the persistent
 * unit — which also starts the new build — instead of only warning about it.
 */
export function unitRestartPlan(unit) {
  if (!unit?.loaded) return "missing";
  return unit.transient ? "replace_transient" : "restart";
}

/**
 * Capsules listed in the evidence index: 0 without an index, null when the
 * index exists but cannot be read — the recheck then runs and reports it
 * rather than the release skipping a damaged index silently.
 */
export function evidenceCapsuleCount(dataDirectory) {
  const path = join(dataDirectory, "evidence", "index.json");
  if (!existsSync(path)) return 0;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    const items = Array.isArray(value) ? value : value?.items;
    return Array.isArray(items) ? items.length : null;
  } catch {
    return null;
  }
}

/**
 * Whether the repair-capsule recheck runs, and why not. It needs the schema
 * the new build migrates to and the data-directory lock the running service
 * holds, so it can only run after the restart with the service briefly
 * stopped; inside packaging it could only ever skip. With no capsules there
 * is nothing to recheck and no reason to stop the app.
 */
export function capsuleRecheckPlan({ skipRestart, skipPackage, capsuleCount }) {
  if (skipPackage) return { run: false, reason: "Capsule recheck skipped (--no-package): it runs only when a new companion is packaged." };
  if (skipRestart) return { run: false, reason: "Capsule recheck skipped (--no-restart): the database has not migrated to this build; run npm run capsules:recheck while the service is stopped after it has." };
  if (capsuleCount === 0) return { run: false, reason: "No repair capsules to recheck." };
  return { run: true, reason: "" };
}

function builtStamp() {
  const path = join(ROOT, "dist", "build-info.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// How many polls in a row may report the same non-fatal degradation before
// the release gives up on it (PLAT-05).
export const DEGRADED_POLLS_BEFORE_FAILURE = 3;

/**
 * One health poll's verdict: `ready`, `wait`, or `fail` with a message.
 * A normal start is degraded until the embedded worker's first cycle ends
 * (`backgroundWorkerRuntime: "starting"`), and the database may still be
 * opening, so both keep waiting. `disk_low` fails at once: waiting cannot
 * free disk. Any other degradation fails only once it has repeated
 * unchanged for DEGRADED_POLLS_BEFORE_FAILURE polls.
 */
export function classifyHealth(body, state = { lastReasons: "", repeats: 0 }) {
  if (body?.status === "ready") return { verdict: "ready", state: { lastReasons: "", repeats: 0 } };
  const reasons = Array.isArray(body?.reasons) ? body.reasons.map(String) : [];
  if (body?.status !== "degraded" || !reasons.length) {
    return { verdict: "wait", state: { lastReasons: "", repeats: 0 } };
  }
  if (reasons.includes("disk_low")) {
    return { verdict: "fail", message: `The local app is up but degraded: ${reasons.join(", ")}. Free disk space, then run npm run doctor.`, state };
  }
  if (reasons.includes("database_unavailable") || body?.backgroundWorkerRuntime === "starting") {
    return { verdict: "wait", state: { lastReasons: "", repeats: 0 } };
  }
  const key = [...reasons].sort().join(",");
  const repeats = key === state.lastReasons ? state.repeats + 1 : 1;
  const next = { lastReasons: key, repeats };
  if (repeats >= DEGRADED_POLLS_BEFORE_FAILURE) {
    return { verdict: "fail", message: `The local app is up but degraded: ${reasons.join(", ")}. Run npm run doctor.`, state: next };
  }
  return { verdict: "wait", state: next };
}

export async function waitForHealth({ timeoutMs = 90_000, intervalMs = 1_000, fetchImpl = fetch, url = HEALTH_URL } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  let state = { lastReasons: "", repeats: 0 };
  while (Date.now() < deadline) {
    let body = null;
    try {
      const response = await fetchImpl(url);
      body = await response.json();
      last = `status ${body?.status ?? response.status}${Array.isArray(body?.reasons) && body.reasons.length ? ` (${body.reasons.join(", ")})` : ""}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (body) {
      const result = classifyHealth(body, state);
      if (result.verdict === "ready") return body;
      if (result.verdict === "fail") throw new Error(result.message);
      state = result.state;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
  throw new Error(`The local app did not report ready within ${timeoutMs / 1000}s (${last}). Check: journalctl --user -u ${UNIT} -n 50`);
}

/**
 * Whether the running process serves the build this release made. The
 * content-hash buildId tells two builds of one commit apart (PLAT-04); an
 * app that predates buildId reporting falls back to the commit.
 */
export function runningBuildMismatch(build, stamp) {
  if (!build) return "The restarted app does not report a build stamp; it is not running the tree that was just built.";
  const running = String(build.commit || "");
  if (stamp.buildId && build.buildId) {
    if (build.buildId !== stamp.buildId) {
      return `The restarted app runs build ${String(build.buildId).slice(0, 12)} (${running.slice(0, 12) || "unknown"}) but this release built ${String(stamp.buildId).slice(0, 12)}. Check WorkingDirectory/ExecStart in the unit (systemctl --user cat ${UNIT}).`;
    }
    return "";
  }
  if (running !== stamp.commit) {
    return `The restarted app runs build ${running.slice(0, 12) || "unknown"} but this release built ${String(stamp.commit).slice(0, 12)}. Check WorkingDirectory/ExecStart in the unit (systemctl --user cat ${UNIT}).`;
  }
  return "";
}

function describeBuild(build) {
  if (!build || typeof build !== "object") return "  (the running app predates build reporting)";
  return `  build ${String(build.commit || "unknown").slice(0, 12)}${build.dirty ? " (dirty)" : ""}${build.buildId ? ` · id ${String(build.buildId).slice(0, 12)}` : ""} · built ${build.builtAt || "unknown"} · started ${build.startedAt || "unknown"} · schema ${build.schemaVersion}/${build.expectedSchemaVersion}`;
}

function describeVersions(versions) {
  if (!versions || typeof versions !== "object") return "  (the running app predates version reporting; rebuild and restart it)";
  const lines = [`  app ${versions.extension}`];
  for (const store of Object.keys(versions.add || {})) {
    lines.push(`  ${store}: ${versions.observer?.[store]} · ${versions.add?.[store]} · ${versions.pack?.[store]}`);
  }
  return lines.join("\n");
}

async function main() {
  if (uninstall) {
    run("Stop and remove the local service", process.execPath, ["scripts/install-local-service.mjs", "--uninstall"]);
    return;
  }
  // Bundles first: `check` fails on a committed bundle that differs from its
  // source, and packaging ships whatever these produce.
  run("Build the companion bundles", "npm", ["run", "build:extension"]);
  run("Check types, bundles and packs", "npm", ["run", "check"]);
  if (skipTests) {
    process.stdout.write("\n== Tests skipped (--skip-tests); the release is not proven green.\n");
  } else {
    run("Run the test suite", "npm", ["test"]);
  }
  run("Build the app", "npm", ["run", "build:types"]);
  const stamp = builtStamp();
  if (!stamp) throw new Error("dist/build-info.json was not written; the build stamp is required to verify the restart.");
  // Packaging runs before the restart, so its capsule recheck could only skip
  // (schema not current, or the service holding the data directory); the
  // recheck runs below, once the new build has migrated.
  if (!skipPackage) run("Package the companion", process.execPath, ["scripts/package-extension.mjs", "--no-recheck"]);
  const unit = unitState();
  const unitPlan = unitRestartPlan(unit);
  if (skipRestart) {
    process.stdout.write(`\n== Restart skipped (--no-restart); the running app keeps its previous versions.\n`);
  } else if (unitPlan === "replace_transient") {
    // Stops the transient unit, writes the persistent one and starts it on
    // the build just swapped in (scripts/install-local-service.mjs, PLAT-06).
    run(`Replace the transient ${UNIT} with the persistent unit`, process.execPath, ["scripts/install-local-service.mjs"]);
  } else if (unitPlan === "restart") {
    run("Restart the local app", "systemctl", ["--user", "restart", UNIT]);
  } else {
    // A missing unit used to degrade silently into "restart it yourself",
    // which is how a rebuilt dist stayed unserved for a day (P-08, Z-04).
    throw new Error(`No ${UNIT} user unit exists, so the rebuilt app is not running. Install and start it with: npm run service:install (then loginctl enable-linger $USER to survive logout).`);
  }
  let health = await waitForHealth();
  process.stdout.write(`\n== Running app reports\n${describeBuild(health.build)}\n${describeVersions(health.packagedVersions)}\n`);
  if (!skipRestart) {
    const mismatch = runningBuildMismatch(health.build, stamp);
    if (mismatch) throw new Error(mismatch);
    if (health.build.schemaCurrent === false) {
      throw new Error(`The database is at schema ${health.build.schemaVersion} but the build expects ${health.build.expectedSchemaVersion}.`);
    }
  }
  const recheck = capsuleRecheckPlan({ skipRestart, skipPackage, capsuleCount: evidenceCapsuleCount(DATA_DIRECTORY) });
  if (recheck.run) {
    run("Stop the local app for the capsule recheck", "systemctl", ["--user", "stop", UNIT]);
    let recheckError = null;
    try {
      run("Recheck repair capsules against this build", process.execPath, ["--import", "tsx", "scripts/recheck-capsules.mjs"]);
    } catch (error) {
      recheckError = error;
    }
    // The app comes back whatever the recheck did; only then is a failed
    // recheck reported, so the error never reads as a failed deploy.
    run("Start the local app", "systemctl", ["--user", "start", UNIT]);
    health = await waitForHealth();
    const mismatch = runningBuildMismatch(health.build, stamp);
    if (mismatch) throw new Error(mismatch);
    if (recheckError) {
      throw new Error(`The new build is running, but the repair capsule recheck failed (${recheckError instanceof Error ? recheckError.message : String(recheckError)}). Rerun it with npm run capsules:recheck while the service is stopped.`);
    }
  } else {
    process.stdout.write(`\n== ${recheck.reason}\n`);
  }
  process.stdout.write("\nCompanion: Chrome loading this repository's apps/extension folder reloads itself within a minute of the app reporting new versions. Any other install (another computer, a ZIP) needs the new ZIP from release/ extracted over its existing folder, then Reload on chrome://extensions; a different folder is a new extension that must be paired again.\n");
  process.stdout.write(`Rollback: the previous build is in dist.prev/ (mv dist dist.bad && mv dist.prev dist && systemctl --user restart ${UNIT}).\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
