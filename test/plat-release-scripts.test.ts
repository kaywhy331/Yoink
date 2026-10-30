import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
// @ts-expect-error The release command is an importable JavaScript module without declarations.
import { capsuleRecheckPlan, classifyHealth, DEGRADED_POLLS_BEFORE_FAILURE, evidenceCapsuleCount, runningBuildMismatch, unitRestartPlan, waitForHealth } from "../scripts/release-local.mjs";
// @ts-expect-error The build stamp writer is an importable JavaScript module without declarations.
import { computeBuildId } from "../scripts/write-build-info.mjs";
// @ts-expect-error The ratchet is an importable JavaScript module without declarations.
import { compareToBaseline } from "../scripts/lint-error-ratchet.mjs";
// @ts-expect-error The installer is an importable JavaScript module without declarations.
import { renderUnit, systemdQuote } from "../scripts/install-local-service.mjs";
// @ts-expect-error The release recheck is intentionally an importable JavaScript command module.
import { recheckCapsules } from "../scripts/recheck-capsules.mjs";

type Health = { status: string; reasons?: string[]; backgroundWorkerRuntime?: string };

test("release health keeps waiting through a normal start and fails only on a settled or disk degradation", () => {
  const starting: Health = { status: "degraded", reasons: ["background_worker_unhealthy"], backgroundWorkerRuntime: "starting" };
  let result = classifyHealth(starting);
  assert.equal(result.verdict, "wait", "the worker's first cycle is not a failure");
  assert.equal(classifyHealth({ status: "degraded", reasons: ["database_unavailable"] }).verdict, "wait");
  assert.equal(classifyHealth({ status: "starting" }).verdict, "wait");
  assert.equal(classifyHealth({ status: "ready" }).verdict, "ready");

  const disk = classifyHealth({ status: "degraded", reasons: ["disk_low"], backgroundWorkerRuntime: "starting" });
  assert.equal(disk.verdict, "fail", "waiting cannot free disk");
  assert.match(disk.message, /disk_low/);

  const settled: Health = { status: "degraded", reasons: ["witness_stale"], backgroundWorkerRuntime: "running" };
  let state = { lastReasons: "", repeats: 0 };
  for (let poll = 1; poll < DEGRADED_POLLS_BEFORE_FAILURE; poll += 1) {
    result = classifyHealth(settled, state);
    assert.equal(result.verdict, "wait", `poll ${poll} of a new degradation waits`);
    state = result.state;
  }
  result = classifyHealth(settled, state);
  assert.equal(result.verdict, "fail");
  assert.match(result.message, /witness_stale/);

  // A change of reasons restarts the count.
  const changed = classifyHealth({ ...settled, reasons: ["background_worker_unhealthy"] }, state);
  assert.equal(changed.verdict, "wait");
  assert.equal(changed.state.repeats, 1);
});

test("waitForHealth returns once a starting app becomes ready", async () => {
  const bodies: Health[] = [
    { status: "degraded", reasons: ["background_worker_unhealthy"], backgroundWorkerRuntime: "starting" },
    { status: "degraded", reasons: ["background_worker_unhealthy"], backgroundWorkerRuntime: "starting" },
    { status: "ready" }
  ];
  let calls = 0;
  const fetchImpl = async () => {
    const body = bodies[Math.min(calls, bodies.length - 1)];
    calls += 1;
    return { status: 200, json: async () => body };
  };
  const body = await waitForHealth({ timeoutMs: 5_000, intervalMs: 1, fetchImpl, url: "http://fixture/health" });
  assert.equal(body.status, "ready");
  assert.equal(calls, 3);

  await assert.rejects(
    waitForHealth({ timeoutMs: 5_000, intervalMs: 1, url: "http://fixture/health", fetchImpl: async () => ({ status: 200, json: async () => ({ status: "degraded", reasons: ["disk_low"] }) }) }),
    /disk_low/
  );
});

test("the release compares the content buildId, falling back to the commit for an older app", () => {
  const stamp = { commit: "a".repeat(40), buildId: "1".repeat(64) };
  assert.equal(runningBuildMismatch({ commit: stamp.commit, buildId: stamp.buildId }, stamp), "");
  assert.match(runningBuildMismatch({ commit: stamp.commit, buildId: "2".repeat(64) }, stamp), /runs build 222222222222/);
  assert.equal(runningBuildMismatch({ commit: stamp.commit }, stamp), "", "an app without buildId is matched by commit");
  assert.match(runningBuildMismatch({ commit: "b".repeat(40) }, stamp), /runs build bbbbbbbbbbbb/);
  assert.match(runningBuildMismatch(null, stamp), /does not report a build stamp/);
});

test("the release replaces a transient unit with the persistent one instead of only warning", () => {
  assert.equal(unitRestartPlan({ loaded: true, active: true, transient: true }), "replace_transient");
  assert.equal(unitRestartPlan({ loaded: true, active: false, transient: false }), "restart");
  assert.equal(unitRestartPlan({ loaded: false, active: false, transient: false }), "missing");
  assert.equal(unitRestartPlan(null), "missing");
});

test("the capsule recheck runs after the migrating restart, and only when there is something to recheck", () => {
  const root = mkdtempSync(join(tmpdir(), "yoink-release-capsules-"));
  try {
    assert.equal(evidenceCapsuleCount(root), 0, "no evidence index");
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "index.json"), "{not json");
    assert.equal(evidenceCapsuleCount(root), null, "an unreadable index is unknown, not empty");
    assert.equal(capsuleRecheckPlan({ skipRestart: false, skipPackage: false, capsuleCount: null }).run, true,
      "a damaged index still runs the recheck, which reports it");
    writeFileSync(join(root, "evidence", "index.json"), JSON.stringify({ items: [{ id: "capsule_a" }, { id: "capsule_b" }] }));
    assert.equal(evidenceCapsuleCount(root), 2);
    writeFileSync(join(root, "evidence", "index.json"), JSON.stringify([{ id: "capsule_a" }]));
    assert.equal(evidenceCapsuleCount(root), 1, "the index may also be a bare list");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.deepEqual(capsuleRecheckPlan({ skipRestart: false, skipPackage: false, capsuleCount: 3 }), { run: true, reason: "" });
  const none = capsuleRecheckPlan({ skipRestart: false, skipPackage: false, capsuleCount: 0 });
  assert.equal(none.run, false, "no capsules means no reason to stop the app");
  assert.match(none.reason, /No repair capsules/);
  const unmigrated = capsuleRecheckPlan({ skipRestart: true, skipPackage: false, capsuleCount: 3 });
  assert.equal(unmigrated.run, false, "without the restart the database has not migrated to this build");
  assert.match(unmigrated.reason, /--no-restart/);
  const unpackaged = capsuleRecheckPlan({ skipRestart: false, skipPackage: true, capsuleCount: 3 });
  assert.equal(unpackaged.run, false);
  assert.match(unpackaged.reason, /--no-package/);
});

test("buildId hashes the compiled content, not the stamp, maps or declarations", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-build-id-"));
  try {
    mkdirSync(join(directory, "apps", "api"), { recursive: true });
    writeFileSync(join(directory, "apps", "api", "server.js"), "console.log(1);\n");
    const first = computeBuildId(directory);
    assert.match(first, /^[0-9a-f]{64}$/);
    writeFileSync(join(directory, "build-info.json"), "{}\n");
    writeFileSync(join(directory, "apps", "api", "server.js.map"), "{}\n");
    writeFileSync(join(directory, "apps", "api", "server.d.ts"), "export {};\n");
    assert.equal(computeBuildId(directory), first);
    writeFileSync(join(directory, "apps", "api", "server.js"), "console.log(2);\n");
    assert.notEqual(computeBuildId(directory), first, "a rebuild of the same commit gets a new id");
    mkdirSync(join(directory, "web"));
    writeFileSync(join(directory, "web", "user.js"), "ui();\n");
    const withWeb = computeBuildId(directory);
    writeFileSync(join(directory, "web", "user.js"), "ui(2);\n");
    assert.notEqual(computeBuildId(directory), withWeb, "the copied web UI is part of the build");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the error ratchet fails only when a repository gains bare throws", () => {
  assert.deepEqual(compareToBaseline({ "a-repository.ts": 2 }, { "a-repository.ts": 2 }), { over: [], under: [] });
  assert.equal(compareToBaseline({ "a-repository.ts": 3 }, { "a-repository.ts": 2 }).over.length, 1);
  assert.equal(compareToBaseline({ "new-repository.ts": 1 }, {}).over.length, 1);
  assert.equal(compareToBaseline({}, { "a-repository.ts": 2 }).under.length, 1);
});

test("the service unit quotes its environment and runs a resolved node", () => {
  const unit = renderUnit({ projectRoot: "/srv/yoink", dataDirectory: "/data/my yoink%1", port: "32991", nodePath: "/usr/bin/node" });
  assert.match(unit, /^Environment="YOINK_DATA_DIR=\/data\/my yoink%%1"$/m);
  assert.match(unit, /^ExecStart="\/usr\/bin\/node" dist\/apps\/api\/src\/server\.js$/m);
  assert.match(unit, /^UMask=0077$/m);
  assert.match(unit, /^NoNewPrivileges=yes$/m);
  assert.doesNotMatch(unit, /network-online\.target/);
  assert.equal(systemdQuote('a"b\\c'), '"a\\"b\\\\c"');
});

const PRINT_UNIT = `${JSON.stringify(process.execPath)} scripts/install-local-service.mjs --print`;

/**
 * bash, the shell the README documents, with a temp HOME and no reachable user
 * bus: `~` and `$HOME` expand into the temp folder, and nothing on this machine
 * is installed, stopped or restarted.
 */
function sandboxShell() {
  const home = mkdtempSync(join(tmpdir(), "yoink-service-install-"));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, XDG_RUNTIME_DIR: join(home, "run"), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(home, "no-bus")}` };
  delete env.YOINK_DATA_DIR;
  const bash = (script: string) => spawnSync("bash", ["-c", script], { cwd: process.cwd(), env, encoding: "utf8" });
  return { home, bash, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function unitDataDirectory(unit: string): string | undefined {
  return unit.match(/^Environment="YOINK_DATA_DIR=(.*)"$/m)?.[1];
}

test("the README migration reinstalls the service on the folder the data was moved to", () => {
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
  const section = readme.slice(readme.indexOf("### Move the data directory out of the app folder"));
  const block = section.slice(section.indexOf("```bash"), section.indexOf("```", section.indexOf("```bash") + 1));
  const steps = block.split("\n");
  const moved = steps.find((line) => line.startsWith("mv data "))?.match(/^mv data (\S+)/)?.[1];
  const install = steps.find((line) => line.startsWith("npm run service:install -- "));
  assert.ok(moved && install, "the migration moves data/ and then reinstalls the service");
  assert.equal(JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).scripts["service:install"], "node scripts/install-local-service.mjs");
  const { home, bash, cleanup } = sandboxShell();
  try {
    const target = bash(`printf %s ${moved}`).stdout;
    assert.equal(target, join(home, ".local", "share", "yoink"));
    // The documented line exactly, with npm's script expanded and --print added.
    const printed = bash(install.replace("npm run service:install -- ", `${PRINT_UNIT} `));
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /^ExecStart=.* dist\/apps\/api\/src\/server\.js$/m);
    assert.equal(unitDataDirectory(printed.stdout), target, "the unit's YOINK_DATA_DIR is the folder the data was moved to");
  } finally {
    cleanup();
  }
});

test("the installer takes --data-dir <path> as well as --data-dir=<path> and refuses a missing or relative one", () => {
  const { home, bash, cleanup } = sandboxShell();
  try {
    const expected = join(home, ".local", "share", "yoink");
    for (const args of ["--data-dir ~/.local/share/yoink", '--data-dir "$HOME/.local/share/yoink"', '--data-dir="$HOME/.local/share/yoink"']) {
      const printed = bash(`${PRINT_UNIT} ${args}`);
      assert.equal(printed.status, 0, `${args}: ${printed.stderr}`);
      assert.equal(unitDataDirectory(printed.stdout), expected, args);
    }
    assert.match(bash(`${PRINT_UNIT} --port 32992`).stdout, /^Environment="YOINK_PORT=32992"$/m);

    for (const [args, message] of [
      ["--data-dir", /--data-dir needs a value/],
      ["--data-dir --port=32992", /--data-dir needs a value/],
      ['--data-dir="$YOINK_TEST_UNSET_FOLDER"', /--data-dir needs a value/],
      ["--port", /--port needs a value/],
      ["--data-dir=~/.local/share/yoink", /--data-dir must be an absolute path/],
      ["--data-dir data", /--data-dir must be an absolute path/]
    ] as const) {
      const refused = bash(`${PRINT_UNIT} ${args}`);
      assert.equal(refused.status, 1, `${args} is refused`);
      assert.match(refused.stderr, message, args);
      assert.equal(refused.stdout, "", `${args}: no unit is printed`);
    }
  } finally {
    cleanup();
  }
});

function evidenceDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "yoink-recheck-skip-"));
  mkdirSync(join(directory, "evidence"), { recursive: true });
  writeFileSync(join(directory, "evidence", "index.json"), JSON.stringify({
    items: [{ id: "capsule_1", retailerId: "target", operation: "observe", layoutFingerprint: "f", capturedAt: "2026-09-01T00:00:00.000Z" }]
  }));
  return directory;
}

test("the release recheck never migrates a database that is not current", async () => {
  const directory = evidenceDirectory();
  try {
    const databasePath = join(directory, "yoink.sqlite");
    const raw = new DatabaseSync(databasePath);
    raw.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    raw.close();
    const result = await recheckCapsules({ dataDirectory: directory, databasePath });
    assert.equal(result.skipped, "schema_not_current");
    assert.equal(result.checked, 0);
    const after = new DatabaseSync(databasePath, { readOnly: true });
    const tables = after.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    after.close();
    assert.deepEqual(tables, ["unrelated"], "no migration ran against the file");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the release recheck skips while another process owns the data directory", async () => {
  const directory = evidenceDirectory();
  const databasePath = join(directory, "yoink.sqlite");
  writeFileSync(databasePath, "");
  const holder = spawn(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    `const m = await import(${JSON.stringify(new URL("../packages/database/src/data-directory-lock.ts", import.meta.url).href)});
     m.acquireDataDirectoryLock(${JSON.stringify(directory)}, { command: "fixture holder" });
     process.stdout.write("locked\\n");
     setInterval(() => {}, 1000);`
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.once("exit", (code) => reject(new Error(`lock holder exited ${code}`)));
      holder.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("locked")) resolve();
      });
    });
    const result = await recheckCapsules({ dataDirectory: directory, databasePath });
    assert.equal(result.skipped, "data_directory_locked");
    assert.match(result.detail, new RegExp(`pid ${holder.pid}`));
  } finally {
    holder.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("build-extension --check reports stale bundles without writing them", () => {
  const result = spawnSync(process.execPath, ["scripts/build-extension.mjs", "--check"], { cwd: process.cwd(), encoding: "utf8" });
  if (result.status === 0) {
    assert.match(result.stdout, /All \d+ extension bundles match their sources\./);
  } else {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Stale extension bundles \(run npm run build:extension\): [a-z0-9-]+\.js/);
  }
});
