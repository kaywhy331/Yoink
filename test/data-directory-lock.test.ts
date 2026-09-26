import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireDataDirectoryLock,
  DATA_DIRECTORY_LOCK_FILE,
  DataDirectoryLockedError,
  readDataDirectoryLock
} from "../packages/database/src/data-directory-lock.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "yoink-lock-"));
}

/** A PID that is alive but is not this process: the test runner's parent. */
const LIVE_OTHER_PID = process.ppid;

function writeOwner(directory: string, owner: Record<string, unknown>): void {
  writeFileSync(join(directory, DATA_DIRECTORY_LOCK_FILE), `${JSON.stringify(owner)}\n`);
}

test("a live owner refuses a second acquire, and a dead owner's lock is replaced", () => {
  const directory = scratch();
  try {
    writeOwner(directory, { pid: LIVE_OTHER_PID, startedAt: "2026-09-25T00:00:00.000Z", command: "yoink service" });
    assert.throws(
      () => acquireDataDirectoryLock(directory),
      (error) => error instanceof DataDirectoryLockedError && error.owner.pid === LIVE_OTHER_PID
    );
    // Nothing was overwritten by the refused attempt.
    assert.equal(readDataDirectoryLock(directory)?.pid, LIVE_OTHER_PID);

    writeOwner(directory, { pid: 2_147_483_000, startedAt: "2026-09-24T00:00:00.000Z", command: "crashed" });
    const lock = acquireDataDirectoryLock(directory);
    assert.equal(lock.mode, "owner");
    assert.equal(readDataDirectoryLock(directory)?.pid, process.pid);
    lock.release();
    assert.equal(existsSync(join(directory, DATA_DIRECTORY_LOCK_FILE)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a reused PID is stale when the recorded process start time or boot differs (API-06)", { skip: !existsSync("/proc/self/stat") }, () => {
  const directory = scratch();
  try {
    writeOwner(directory, {
      pid: LIVE_OTHER_PID,
      startedAt: "2026-09-24T00:00:00.000Z",
      command: "oom-killed service",
      processStartTicks: "1"
    });
    const reused = acquireDataDirectoryLock(directory);
    assert.equal(reused.mode, "owner");
    assert.equal(readDataDirectoryLock(directory)?.pid, process.pid);
    reused.release();

    writeOwner(directory, {
      pid: LIVE_OTHER_PID,
      startedAt: "2026-09-24T00:00:00.000Z",
      command: "previous boot",
      bootId: "00000000-0000-0000-0000-000000000000"
    });
    const rebooted = acquireDataDirectoryLock(directory);
    assert.equal(rebooted.mode, "owner");
    rebooted.release();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the lock records boot id and start time, and acquisition is re-entrant within one process", () => {
  const directory = scratch();
  try {
    const first = acquireDataDirectoryLock(directory);
    const owner = JSON.parse(readFileSync(join(directory, DATA_DIRECTORY_LOCK_FILE), "utf8")) as Record<string, unknown>;
    if (existsSync("/proc/self/stat")) {
      assert.match(String(owner.processStartTicks), /^\d+$/);
      assert.match(String(owner.bootId), /^[0-9a-f-]{36}$/);
    }
    // server.ts takes the lock, then the YoinkDatabase constructor takes it again.
    const second = acquireDataDirectoryLock(directory);
    assert.equal(second.mode, "owner");
    second.release();
    assert.equal(readDataDirectoryLock(directory)?.pid, process.pid, "the inner release only decrements");
    second.release();
    assert.equal(readDataDirectoryLock(directory)?.pid, process.pid, "a double release is a no-op");
    first.release();
    assert.equal(readDataDirectoryLock(directory), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a shared open never rewrites or deletes the live owner's lock (API-04)", () => {
  const directory = scratch();
  try {
    writeOwner(directory, { pid: LIVE_OTHER_PID, startedAt: "2026-09-25T00:00:00.000Z", command: "yoink service" });
    const shared = acquireDataDirectoryLock(directory, { allowShared: true });
    assert.equal(shared.mode, "shared");
    assert.equal(shared.owner.pid, LIVE_OTHER_PID);
    assert.equal(readDataDirectoryLock(directory)?.pid, LIVE_OTHER_PID);
    shared.release();
    assert.equal(readDataDirectoryLock(directory)?.pid, LIVE_OTHER_PID);
    // A later stray starter is still refused.
    assert.throws(() => acquireDataDirectoryLock(directory), DataDirectoryLockedError);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("creation is exclusive: a lock written between check and create wins, and a young unreadable lock is treated as live", () => {
  const directory = scratch();
  try {
    // Another process's fresh lock (as if it won the wx race) is not replaced.
    writeOwner(directory, { pid: LIVE_OTHER_PID, startedAt: "2026-09-25T00:00:00.000Z", command: "racing starter" });
    assert.throws(() => acquireDataDirectoryLock(directory, { command: "second starter" }), DataDirectoryLockedError);

    // A lock file caught mid-write (empty) is live for a short grace period.
    writeFileSync(join(directory, DATA_DIRECTORY_LOCK_FILE), "");
    assert.throws(() => acquireDataDirectoryLock(directory), DataDirectoryLockedError);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent starters in separate processes: exactly one owns the directory (API-05)", async () => {
  const directory = scratch();
  const script = `
    import { acquireDataDirectoryLock } from "./packages/database/src/data-directory-lock.ts";
    let lock = null;
    try { lock = acquireDataDirectoryLock(${JSON.stringify(directory)}); process.stdout.write("won"); }
    catch (error) { process.stdout.write(error.code === "data_directory_locked" ? "locked" : "error:" + error.message); }
    setTimeout(() => { lock?.release(); }, 4000);
  `;
  try {
    const children = Array.from({ length: 4 }, () => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    }));
    const outputs = await Promise.all(children.map(async (child) => {
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
      await once(child, "exit");
      return output;
    }));
    assert.equal(outputs.filter((output) => output === "won").length, 1, outputs.join(", "));
    assert.equal(outputs.filter((output) => output === "locked").length, 3, outputs.join(", "));
    assert.equal(readDataDirectoryLock(directory), null, "the winner released on exit");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
