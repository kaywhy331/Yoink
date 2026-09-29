import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { basename, join, resolve } from "node:path";

export const DATA_DIRECTORY_LOCK_FILE = "yoink.lock";

/** A takeover directory older than this is left over from a crashed replacement and may be removed. */
const TAKEOVER_STALE_MS = 10_000;
/** An unreadable lock younger than this is probably being written by a live process right now. */
const UNREADABLE_GRACE_MS = 2_000;
/** Two boot times further apart than this are different boots; closer ones are clock jitter. */
const BOOT_TIME_TOLERANCE_MS = 120_000;

export interface DataDirectoryLockOwner {
  pid: number;
  startedAt: string;
  command: string;
  /** Kernel boot id when the lock was written (Linux); a different boot means the owner is gone. */
  bootId?: string;
  /** Owner process start time in clock ticks (/proc/<pid>/stat field 22); a mismatch means the PID was reused. */
  processStartTicks?: string;
  /** Boot time where there is no kernel boot id (Windows); a different boot means the owner is gone. */
  bootedAt?: string;
  /** Owner executable file name on Windows; a live PID running something else was reused. */
  executable?: string;
}

export interface DataDirectoryLock {
  path: string;
  owner: DataDirectoryLockOwner;
  /**
   * "owner" holds the lock file; "shared" is a deliberate YOINK_ALLOW_SHARED_DATA
   * open next to a live owner, and its release never touches the owner's file.
   */
  mode: "owner" | "shared";
  release(): void;
}

export class DataDirectoryLockedError extends Error {
  readonly code = "data_directory_locked";
  readonly exitCode = 78;
  readonly owner: DataDirectoryLockOwner;

  constructor(directory: string, owner: DataDirectoryLockOwner) {
    super(
      `Another Yoink process (pid ${owner.pid}, started ${owner.startedAt}, ${owner.command}) owns the data directory ${directory}. `
      + "Stop it first (systemctl --user stop yoink-local-api), or use npm run release:local instead of npm run dev. "
      + "Set YOINK_ALLOW_SHARED_DATA=1 only for a deliberate shared open."
    );
    this.name = "DataDirectoryLockedError";
    this.owner = owner;
  }
}

/** Locks this process holds, by resolved directory, so a second acquire (server.ts, then YoinkDatabase) is re-entrant. */
const heldLocks = new Map<string, { owner: DataDirectoryLockOwner; references: number }>();

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function currentBootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return "";
  }
}

function currentBootTime(): string {
  return new Date(Date.now() - uptime() * 1000).toISOString();
}

/**
 * Whether two recorded boot times belong to the same boot. An unreadable time
 * counts as the same boot, so a lock is never judged stale on missing data.
 */
export function sameBootTime(recorded: string, current: string): boolean {
  const recordedMs = Date.parse(recorded);
  const currentMs = Date.parse(current);
  if (!Number.isFinite(recordedMs) || !Number.isFinite(currentMs)) return true;
  return Math.abs(recordedMs - currentMs) <= BOOT_TIME_TOLERANCE_MS;
}

/**
 * The executable file name a Windows PID runs now, lower-cased, or "" when it
 * cannot be read. Windows reuses PIDs quickly and has no /proc start time.
 */
function windowsProcessExecutable(pid: number): string {
  try {
    const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true
    });
    if (result.status !== 0) return "";
    const match = /^"([^"]+)","(\d+)"/m.exec(String(result.stdout));
    return match && Number(match[2]) === pid ? match[1]!.toLowerCase() : "";
  } catch {
    return "";
  }
}

/** Start time of a process in clock ticks since boot, or "" where /proc is unavailable. */
function processStartTicks(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Field 2 (comm) may contain spaces; fields after the last ')' start at field 3.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[19] ?? "";
  } catch {
    return "";
  }
}

/**
 * A lock is live only while its PID runs AND is the same process that wrote
 * it: a different boot or a different process start time means the PID was
 * reused after a crash, OOM kill or reboot, so the lock is stale.
 */
function ownerAlive(owner: DataDirectoryLockOwner): boolean {
  if (!processAlive(owner.pid)) return false;
  const bootId = currentBootId();
  if (owner.bootId && bootId && owner.bootId !== bootId) return false;
  if (owner.processStartTicks) {
    const ticks = processStartTicks(owner.pid);
    if (ticks && ticks !== owner.processStartTicks) return false;
  }
  if (owner.bootedAt && !bootId && !sameBootTime(owner.bootedAt, currentBootTime())) return false;
  if (owner.executable && process.platform === "win32") {
    const executable = windowsProcessExecutable(owner.pid);
    if (executable && executable !== owner.executable) return false;
  }
  return true;
}

function sameOwner(left: DataDirectoryLockOwner, right: DataDirectoryLockOwner): boolean {
  return left.pid === right.pid && left.startedAt === right.startedAt;
}

export function readDataDirectoryLock(directory: string): DataDirectoryLockOwner | null {
  const path = join(directory, DATA_DIRECTORY_LOCK_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DataDirectoryLockOwner>;
    return {
      pid: Number(parsed.pid ?? 0),
      startedAt: String(parsed.startedAt ?? ""),
      command: String(parsed.command ?? ""),
      ...(parsed.bootId ? { bootId: String(parsed.bootId) } : {}),
      ...(parsed.processStartTicks ? { processStartTicks: String(parsed.processStartTicks) } : {}),
      ...(parsed.bootedAt ? { bootedAt: String(parsed.bootedAt) } : {}),
      ...(parsed.executable ? { executable: String(parsed.executable) } : {})
    };
  } catch {
    return { pid: 0, startedAt: "", command: "unreadable lock file" };
  }
}

function recentlyWritten(path: string, milliseconds: number): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < milliseconds;
  } catch {
    return false;
  }
}

/**
 * Removes a stale lock under a mkdir-based takeover mutex, so two starters
 * that both judged the same file stale cannot both delete it (the second
 * would delete the first one's fresh lock). The file is removed only if it
 * is still the exact stale owner that was judged.
 */
function removeStaleLock(path: string, directory: string, stale: DataDirectoryLockOwner): void {
  const takeover = `${path}.takeover`;
  try {
    mkdirSync(takeover);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!recentlyWritten(takeover, TAKEOVER_STALE_MS)) {
      try { rmdirSync(takeover); } catch { /* another starter removed it */ }
    }
    return;
  }
  try {
    const current = readDataDirectoryLock(directory);
    if (current && sameOwner(current, stale)) unlinkSync(path);
  } catch {
    // Someone else already replaced or removed it; the caller re-reads.
  } finally {
    try { rmdirSync(takeover); } catch { /* already gone */ }
  }
}

function ownerHandle(key: string, directory: string, path: string, owner: DataDirectoryLockOwner): DataDirectoryLock {
  let released = false;
  return {
    path,
    owner,
    mode: "owner",
    release(): void {
      if (released) return;
      released = true;
      const held = heldLocks.get(key);
      if (!held || !sameOwner(held.owner, owner)) return;
      held.references -= 1;
      if (held.references > 0) return;
      heldLocks.delete(key);
      const current = readDataDirectoryLock(directory);
      if (current && sameOwner(current, owner)) {
        try {
          unlinkSync(path);
        } catch {
          // The directory may already be gone; nothing to release.
        }
      }
    }
  };
}

/**
 * Takes the exclusive owner lock for a data directory before the database is
 * opened, so a stray `npm run dev`, script, or test can never migrate the
 * production database underneath the running service (P-04).
 *
 * - Creation is atomic (`wx`): two starters cannot both win.
 * - A lock whose process is gone, or whose PID now belongs to a different
 *   process (boot id / start time mismatch on Linux; boot time / executable
 *   mismatch on Windows), is stale and is replaced.
 * - Re-entrant within one process: a second acquire by the same pid (the
 *   entrypoint, then the YoinkDatabase constructor) returns a handle whose
 *   release only decrements; the file goes when the last handle is released.
 * - `allowShared` next to a live owner never rewrites or deletes the owner's
 *   file; it returns a shared handle whose release does nothing.
 */
export function acquireDataDirectoryLock(
  directory: string,
  options: { pid?: number; command?: string; allowShared?: boolean; now?: () => string } = {}
): DataDirectoryLock {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, DATA_DIRECTORY_LOCK_FILE);
  const key = resolve(directory);
  const pid = options.pid ?? process.pid;
  const held = heldLocks.get(key);
  if (held && held.owner.pid === pid) {
    held.references += 1;
    return ownerHandle(key, directory, path, held.owner);
  }
  const bootId = currentBootId();
  const startTicks = processStartTicks(pid);
  const owner: DataDirectoryLockOwner = {
    pid,
    startedAt: (options.now ?? (() => new Date().toISOString()))(),
    command: options.command ?? process.argv.slice(1).join(" ").slice(0, 200),
    ...(bootId ? { bootId } : {}),
    ...(startTicks ? { processStartTicks: startTicks } : {}),
    ...(bootId ? {} : { bootedAt: currentBootTime() }),
    ...(process.platform === "win32" && pid === process.pid
      ? { executable: basename(process.execPath).toLowerCase() }
      : {})
  };
  let lastSeen: DataDirectoryLockOwner | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(owner)}\n`, { mode: 0o600, flag: "wx" });
      heldLocks.set(key, { owner, references: 1 });
      return ownerHandle(key, directory, path, owner);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const existing = readDataDirectoryLock(directory);
    if (!existing) continue; // Released between our create and read; try again.
    lastSeen = existing;
    const unreadableButFresh = existing.pid === 0 && recentlyWritten(path, UNREADABLE_GRACE_MS);
    if (unreadableButFresh || ownerAlive(existing)) {
      // Same live process through another module instance (for example a
      // dist and a source import): it already owns the directory, so share
      // without ever deleting the owning handle's file.
      if (options.allowShared === true || existing.pid === pid) {
        return { path, owner: existing, mode: "shared", release(): void { /* the owner keeps its lock */ } };
      }
      throw new DataDirectoryLockedError(directory, existing);
    }
    removeStaleLock(path, directory, existing);
  }
  throw new DataDirectoryLockedError(directory, lastSeen ?? readDataDirectoryLock(directory) ?? owner);
}
