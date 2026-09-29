#!/usr/bin/env node
// One command that says whether the local Yoink install is the code you
// think it is and has the disk it needs (P-09, P-03, P-01, P-08):
//   build   running commit vs source vs compiled stamp
//   schema  applied vs expected migrations
//   disk    free space, database, backups, next-backup headroom
//   unit    persistent vs transient vs absent
//   worker  last heartbeat
//   companion  packaged ZIP for the running version
//   footprint  sizes of data/, release/ and the dist.prev rollback copy
// Exit 0 when everything passes, 1 on any warning, 2 on any failure.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UNIT = process.env.YOINK_LOCAL_API_UNIT || "yoink-local-api.service";
const HEALTH_URL = process.env.YOINK_LOCAL_HEALTH_URL || `http://127.0.0.1:${process.env.YOINK_PORT || 32991}/api/v1/health`;
const asJson = process.argv.includes("--json");

const checks = [];
function report(name, level, detail) {
  checks.push({ name, level, detail });
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? result.stdout.trim() : "";
}

function megabytes(bytes) {
  return `${Math.round(Number(bytes || 0) / (1024 * 1024))} MB`;
}

function ageHours(iso) {
  const time = Date.parse(iso || "");
  return Number.isFinite(time) ? Math.round((Date.now() - time) / 3_600_000) : null;
}

async function fetchHealth() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5_000) });
    return { status: response.status, body: await response.json() };
  } catch (error) {
    return { status: 0, body: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function unitState() {
  const probe = spawnSync("systemctl", ["--user", "show", UNIT, "--property=LoadState,ActiveState,FragmentPath,Transient,Result,NRestarts"], { encoding: "utf8" });
  if (probe.status !== 0) return null;
  return Object.fromEntries(probe.stdout.trim().split("\n").map((line) => line.split("=")));
}

const health = await fetchHealth();
const body = health.body ?? {};
const packageVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const sourceCommit = git(["rev-parse", "HEAD"]);
const sourceCommittedAt = git(["log", "-1", "--format=%cI"]);
const stampPath = join(ROOT, "dist", "build-info.json");
// An interrupted build can leave a truncated stamp; report it instead of
// crashing in exactly the broken-build case doctor exists for (PLAT-23).
let stamp = null;
let stampUnreadable = false;
if (existsSync(stampPath)) {
  try {
    stamp = JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    stampUnreadable = true;
  }
}

// 1. Reachability.
if (!health.body) {
  report("app", "fail", `No health response from ${HEALTH_URL} (${health.error ?? "no body"}). Start the unit: npm run service:install, or npm run release:local.`);
} else if (body.status !== "ready") {
  report("app", "fail", `Health is ${body.status} (${(body.reasons || []).join(", ") || "no reason"}).`);
} else {
  report("app", "pass", `Ready, version ${body.version}.`);
}

// 2. Build stamp: running vs source vs compiled.
const build = body.build ?? null;
if (!build) {
  report("build", "fail", "The running app predates build reporting; rebuild and restart (npm run release:local).");
} else {
  const running = String(build.commit || "unknown");
  const short = (value) => String(value || "").slice(0, 12) || "unknown";
  if (build.kind !== "dist") {
    report("build", "warn", `Running from ${build.kind} (${short(running)}); the unit should run the compiled dist tree.`);
  } else if (sourceCommit && running !== sourceCommit) {
    const hours = build.builtAt && sourceCommittedAt ? Math.max(0, Math.round((Date.parse(sourceCommittedAt) - Date.parse(build.builtAt)) / 3_600_000)) : null;
    report("build", "fail", `Running build ${short(running)} differs from source ${short(sourceCommit)}${hours !== null ? ` (source is ${hours} h newer)` : ""}. Run npm run release:local.`);
  } else if (stampUnreadable) {
    report("build", "fail", `${stampPath} is unreadable (interrupted build?). Rebuild: npm run build:types, then restart the unit.`);
  } else if (stamp && stamp.commit !== running) {
    report("build", "fail", `dist is stamped ${short(stamp.commit)} but the process runs ${short(running)}: restart the unit.`);
  } else if (stamp?.buildId && build.buildId && stamp.buildId !== build.buildId) {
    // Same commit, different content: dist was rebuilt after the process
    // started, so the process serves an older build (PLAT-04).
    report("build", "fail", `dist was rebuilt after start (dist ${short(stamp.buildId)}, running ${short(build.buildId)}): restart the unit.`);
  } else {
    report("build", "pass", `Running ${short(running)}${build.dirty ? " (dirty)" : ""}${build.buildId ? ` build ${short(build.buildId)}` : ""}, built ${build.builtAt || "unknown"}, started ${build.startedAt || "unknown"}.`);
  }
  if (String(build.version || "") !== packageVersion) {
    report("version", "warn", `Running version ${build.version} but package.json says ${packageVersion}.`);
  }
  if (build.schemaCurrent === false) {
    report("schema", "fail", `Database schema ${build.schemaVersion} but the running build expects ${build.expectedSchemaVersion}.`);
  } else if (build.schemaVersion !== undefined) {
    report("schema", "pass", `Schema ${build.schemaVersion} of ${build.expectedSchemaVersion}.`);
  }
}

// 3. Disk and backups.
const storage = body.storage ?? null;
if (storage && storage.available) {
  // Fail only when the next pre-migration copy no longer fits; under the 5 %
  // line with room for it is a warning, as in health (disk_space_low).
  const level = storage.diskLow && storage.backupAllowed !== true ? "fail"
    : storage.diskLow || (storage.percentFree !== null && storage.percentFree < 10) ? "warn" : "pass";
  report("disk", level, `${megabytes(storage.freeBytes)} free (${storage.percentFree ?? "?"} %), database ${megabytes(storage.databaseFileBytes)} + WAL ${megabytes(storage.walBytes)}, ${storage.backupCount} backups ${megabytes(storage.backupBytes)}, next backup needs ${megabytes(storage.requiredForBackupBytes)}${storage.reason ? ` — ${storage.reason.replaceAll("_", " ")}` : ""}.`);
  if (storage.lastBackupAt) {
    const hours = ageHours(storage.lastBackupAt);
    report("backup", hours !== null && hours > 24 * 14 ? "warn" : "pass", `Last backup ${storage.lastBackupAt} (${hours ?? "?"} h ago).`);
  } else {
    report("backup", "warn", "No backup copy exists yet. Admin › Operations › Workers › Back up now.");
  }
} else {
  try {
    const dataDirectory = process.env.YOINK_DATA_DIR ? resolve(ROOT, process.env.YOINK_DATA_DIR) : join(ROOT, "data");
    const volume = statfsSync(dataDirectory);
    report("disk", "warn", `Health has no storage block; volume has ${megabytes(Number(volume.bavail) * Number(volume.bsize))} free at ${dataDirectory}.`);
  } catch {
    report("disk", "warn", "Health has no storage block and the data directory could not be inspected.");
  }
}

// 4. Unit.
const unit = unitState();
if (!unit || unit.LoadState !== "loaded") {
  report("unit", "fail", `No ${UNIT} user unit. Install it: npm run service:install`);
} else if (unit.Transient === "yes") {
  report("unit", "warn", `${UNIT} is transient (${unit.ActiveState}); it will not survive a reboot. Install the persistent unit: npm run service:install`);
} else {
  report("unit", unit.ActiveState === "active" ? "pass" : "fail", `${UNIT} ${unit.ActiveState} from ${unit.FragmentPath}${Number(unit.NRestarts || 0) > 0 ? `, ${unit.NRestarts} restarts` : ""}.`);
}
const lingerPath = join("/var/lib/systemd/linger", process.env.USER || "");
if (unit && unit.LoadState === "loaded" && unit.Transient !== "yes" && process.env.USER && !existsSync(lingerPath)) {
  report("linger", "warn", `Lingering is off for ${process.env.USER}; the unit stops at logout. loginctl enable-linger ${process.env.USER}`);
}

// 5. Worker.
if (body.backgroundWorkerMode && body.backgroundWorkerMode !== "disabled") {
  const hours = ageHours(body.backgroundWorkerLastHeartbeatAt);
  report("worker", body.backgroundWorkerHealthy ? "pass" : "fail", `${body.backgroundWorkerRuntime || "unknown"} (${body.backgroundWorkerMode}), last heartbeat ${body.backgroundWorkerLastHeartbeatAt || "never"}${hours !== null ? ` (${hours} h ago)` : ""}${body.backgroundWorkerLastErrorCode ? `, last error ${body.backgroundWorkerLastErrorCode}` : ""}.`);
}

// 6. Companion package for the running version.
// The local endpoint serves exactly Yoink-Companion-<version>.zip; the
// -production ZIP does not count (PLAT-23).
const releaseRoot = join(ROOT, "release");
const zips = existsSync(releaseRoot) ? readdirSync(releaseRoot).filter((name) => name.endsWith(".zip")) : [];
const runningVersion = String(body.version || packageVersion);
if (zips.includes(`Yoink-Companion-${runningVersion}.zip`)) {
  report("companion", "pass", `Packaged companion ${runningVersion} is in release/ (${zips.length} ZIPs kept).`);
} else {
  report("companion", "warn", `No packaged companion Yoink-Companion-${runningVersion}.zip in release/ — npm run package:extension.`);
}

// 7. Footprint of the directories that grow on a nearly full disk (PLAT-22).
function directoryBytes(path) {
  let total = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) {
        try {
          total += statSync(child).size;
        } catch {
          // Removed while walking.
        }
      }
    }
  };
  walk(path);
  return total;
}
const footprint = [];
const dataRoot = process.env.YOINK_DATA_DIR ? resolve(ROOT, process.env.YOINK_DATA_DIR) : join(ROOT, "data");
for (const [label, path] of [["data", dataRoot], ["release", releaseRoot], ["dist.prev", join(ROOT, "dist.prev")]]) {
  if (existsSync(path)) footprint.push(`${label}/ ${megabytes(directoryBytes(path))}`);
}
if (footprint.length) report("footprint", "pass", `${footprint.join(", ")}.`);

const worst = checks.some((check) => check.level === "fail") ? 2 : checks.some((check) => check.level === "warn") ? 1 : 0;
if (asJson) {
  process.stdout.write(`${JSON.stringify({ ok: worst === 0, checks }, null, 2)}\n`);
} else {
  const badge = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  for (const check of checks) process.stdout.write(`${badge[check.level]}  ${check.name.padEnd(10)} ${check.detail}\n`);
  process.stdout.write(worst === 0 ? "\nYoink is healthy.\n" : worst === 1 ? "\nYoink runs, with warnings above.\n" : "\nYoink needs attention: see FAIL lines above.\n");
}
process.exitCode = worst;
