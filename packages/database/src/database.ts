import { chmodSync, existsSync, mkdirSync, readdirSync, statfsSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementResultingChanges } from "node:sqlite";
import { nowIso, stableHash } from "../../domain/src/ids.js";
import { acquireDataDirectoryLock, type DataDirectoryLock } from "./data-directory-lock.js";
import { MIGRATIONS } from "./migrations.js";

export const LOCAL_TENANT_ID = "tenant_local";
export const LOCAL_USER_ID = "user_local";
export const MIGRATION_BACKUP_RETENTION_COUNT = 3;
/** A full `VACUUM INTO` copy needs the database size plus headroom for the WAL and page growth. */
export const BACKUP_FREE_SPACE_FACTOR = 1.2;
export const BACKUP_FREE_SPACE_FLOOR_BYTES = 64 * 1024 * 1024;
/** Health reports `disk_low` once the volume could no longer take one more pre-migration copy. */
export const DISK_LOW_FREE_FRACTION = 0.05;
const BACKUP_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

type Row = Record<string, unknown>;

export interface YoinkDatabaseOptions {
  readOnly?: boolean;
  migrationMode?: "apply" | "require_current";
  /** Receives one line per startup phase (backup pruning, backup copy, migrations). */
  logger?: (line: string) => void;
  /**
   * A file-backed apply-mode open takes the data-directory lock; true shares a
   * live owner's directory without touching its lock (defaults to
   * YOINK_ALLOW_SHARED_DATA=1, the same switch server.ts honours).
   */
  allowSharedDataDirectory?: boolean;
}

export interface DatabaseBackupEntry {
  name: string;
  path: string;
  bytes: number;
  modifiedAt: string;
  kind: "pre_migration" | "manual" | "other";
}

export interface DatabaseStorage {
  inMemory: boolean;
  dataDirectory: string;
  databasePath: string;
  /** Live pages: page_count × page_size. */
  databaseBytes: number;
  /** Bytes of the main database file on disk. */
  databaseFileBytes: number;
  walBytes: number;
  backupCount: number;
  backupBytes: number;
  lastBackupAt: string;
  dataDirectoryBytes: number;
  freeBytes: number;
  totalBytes: number;
  /** Free space needed before another full backup copy is attempted. */
  requiredForBackupBytes: number;
  diskLow: boolean;
  backupAllowed: boolean;
}

export interface BackupPruneReceipt {
  kept: number;
  keptBytes: number;
  removed: number;
  removedBytes: number;
}

/**
 * A startup failure that must not be retried by a supervisor: the fix is on
 * disk or in configuration, and looping would only fill the journal. Entry
 * points map `exitCode` to the process exit status; the persistent unit sets
 * `RestartPreventExitStatus=78`.
 */
export class YoinkStartupError extends Error {
  readonly exitCode = 78;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "YoinkStartupError";
    this.code = code;
  }
}

/**
 * The migration target of a generated pre-migration copy, or null when the
 * name is not one Yoink generated (legacy `before-v0.91.0.<stamp>.sqlite`
 * release copies and current `before-v69.<stamp>.sqlite` copies both match).
 */
function preMigrationTarget(live: string, name: string): string | null {
  if (!name.startsWith(`${live}.`)) return null;
  const match = /^before-v(\d+(?:\.\d+)*)\.([A-Za-z0-9_-]+)\.sqlite$/.exec(name.slice(live.length + 1));
  return match?.[1] ?? null;
}

function formatMegabytes(bytes: number): string {
  return `${Math.max(0, Math.round(bytes / (1024 * 1024)))} MB`;
}

/** Total bytes under a directory, bounded so a runaway tree cannot stall health. */
function directoryBytes(directory: string, budget = { entries: 20_000 }): number {
  let total = 0;
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (budget.entries <= 0) break;
    budget.entries -= 1;
    const path = join(directory, name);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (stats.isDirectory()) total += directoryBytes(path, budget);
    else if (stats.isFile()) total += stats.size;
  }
  return total;
}

export class YoinkDatabase {
  readonly path: string;
  readonly connection: DatabaseSync;
  readonly readOnly: boolean;
  readonly migrationMode: "apply" | "require_current";
  private readonly logger: (line: string) => void;
  private transactionDepth = 0;
  private savepointSequence = 0;
  private dataDirectoryLock: DataDirectoryLock | null = null;

  constructor(filePath = ":memory:", options: YoinkDatabaseOptions = {}) {
    this.path = filePath;
    this.readOnly = options.readOnly === true;
    this.migrationMode = options.migrationMode ?? "apply";
    this.logger = options.logger ?? (() => {});
    if (this.readOnly && filePath === ":memory:") {
      throw new Error("A read-only Yoink database must use an existing file path.");
    }
    const existed = filePath !== ":memory:" && existsSync(filePath);
    if (this.readOnly && !existed) {
      throw new Error("The read-only Yoink database file does not exist.");
    }
    if (this.migrationMode === "require_current" && !existed) {
      throw new Error("The Yoink database must be initialized and migrated by the API before this process starts.");
    }
    if (filePath !== ":memory:" && !this.readOnly) {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      chmodSync(dirname(filePath), 0o700);
    }
    // The migration owner (a file-backed open in apply mode) holds the data
    // directory lock for the life of the connection, so no second process can
    // migrate the live database underneath it (C18). Re-entrant: server.ts
    // takes the same lock first, and this acquire only adds a reference.
    if (filePath !== ":memory:" && !this.readOnly && this.migrationMode === "apply") {
      this.dataDirectoryLock = acquireDataDirectoryLock(dirname(filePath), {
        allowShared: options.allowSharedDataDirectory ?? process.env.YOINK_ALLOW_SHARED_DATA === "1"
      });
    }
    try {
      this.connection = new DatabaseSync(filePath, { readOnly: this.readOnly });
    } catch (error) {
      this.releaseDataDirectoryLock();
      throw error;
    }
    this.connection.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (this.readOnly) {
      try {
        this.assertQuickIntegrity();
        if (this.migrationMode === "require_current") this.assertCurrentSchema();
      } catch (error) {
        this.connection.close();
        throw error;
      }
      return;
    }
    try {
      if (filePath !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
      this.secureDatabaseFiles();
    } catch (error) {
      this.connection.close();
      this.releaseDataDirectoryLock();
      throw error;
    }
    if (this.migrationMode === "require_current") {
      try {
        this.assertQuickIntegrity();
        this.assertCurrentSchema();
      } catch (error) {
        this.connection.close();
        throw error;
      }
      return;
    }
    try {
      this.connection.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        ) STRICT;
      `);
      if (existed) this.assertQuickIntegrity();
      // Prune on every open, before any copy is attempted, so the retention
      // rule frees space ahead of the pre-migration backup instead of after it.
      if (existed) {
        const pruned = this.pruneBackups();
        this.logger(
          `Yoink backups: kept ${pruned.kept} (${formatMegabytes(pruned.keptBytes)}), removed ${pruned.removed} (${formatMegabytes(pruned.removedBytes)}).`
        );
      }
      this.applyMigrations(existed);
      this.seedLocalDefaults();
    } catch (error) {
      this.connection.close();
      this.releaseDataDirectoryLock();
      throw error;
    }
  }

  close(): void {
    try {
      this.connection.close();
    } finally {
      this.releaseDataDirectoryLock();
    }
  }

  private releaseDataDirectoryLock(): void {
    const lock = this.dataDirectoryLock;
    this.dataDirectoryLock = null;
    lock?.release();
  }

  /** Applied and expected schema versions, so health can name drift instead of hiding it. */
  schemaVersions(): { applied: number; expected: number; current: boolean } {
    const expected = Number(MIGRATIONS.at(-1)?.version ?? 0);
    let applied = 0;
    try {
      applied = Number(this.get<{ version: number | null }>("SELECT MAX(version) AS version FROM schema_migrations")?.version ?? 0);
    } catch {
      applied = 0;
    }
    return { applied, expected, current: applied === expected };
  }

  /** Every backup copy in the data directory, newest first. */
  listBackups(): DatabaseBackupEntry[] {
    if (this.path === ":memory:") return [];
    const directory = dirname(this.path);
    const live = basename(this.path);
    const prefix = `${live}.`;
    const entries: DatabaseBackupEntry[] = [];
    for (const name of readdirSync(directory)) {
      if (!name.startsWith(prefix)) continue;
      if (BACKUP_SIDECAR_SUFFIXES.some((suffix) => name === `${live}${suffix}`)) continue;
      if (BACKUP_SIDECAR_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;
      const path = join(directory, name);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;
      entries.push({
        name,
        path,
        bytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        kind: name.startsWith(`${prefix}before-v`) ? "pre_migration" : name.startsWith(`${prefix}manual.`) ? "manual" : "other"
      });
    }
    return entries.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || right.name.localeCompare(left.name));
  }

  /**
   * Bounded retention for the copies Yoink generates itself. Only
   * pre-migration copies (`<live>.before-v<target>.<stamp>.sqlite`) are
   * pruned automatically: the newest copy per migration target is kept, for
   * the newest `retain` targets, so repeated failed attempts at one migration
   * can never push the last known-good copy of an older schema out. Manual
   * copies are pruned (to the newest `retain`) only when an operator asks with
   * `includeManual`; any other `<live>.*` file (a hand-made `.bak`, a
   * pre-restore copy) is never touched. Sidecars of removed copies and
   * sidecars whose parent file is gone are removed too; the live database and
   * its own sidecars are never touched.
   */
  pruneBackups(
    retain = MIGRATION_BACKUP_RETENTION_COUNT,
    options: { includeManual?: boolean } = {}
  ): BackupPruneReceipt {
    const receipt: BackupPruneReceipt = { kept: 0, keptBytes: 0, removed: 0, removedBytes: 0 };
    if (this.path === ":memory:") return receipt;
    const directory = dirname(this.path);
    const live = basename(this.path);
    const backups = this.listBackups();
    const limit = Math.max(0, retain);
    const removable = new Set<string>();
    const seenTargets = new Set<string>();
    for (const backup of backups) {
      if (backup.kind !== "pre_migration") continue;
      const target = preMigrationTarget(live, backup.name);
      if (target === null) continue;
      if (seenTargets.has(target) || seenTargets.size >= limit) {
        removable.add(backup.name);
        continue;
      }
      seenTargets.add(target);
    }
    if (options.includeManual === true) {
      backups.filter((backup) => backup.kind === "manual").slice(limit).forEach((backup) => removable.add(backup.name));
    }
    const remove = (name: string): void => {
      const path = join(directory, name);
      let bytes = 0;
      try {
        bytes = statSync(path).size;
        unlinkSync(path);
      } catch {
        return;
      }
      receipt.removed += 1;
      receipt.removedBytes += bytes;
    };
    for (const backup of backups) {
      if (removable.has(backup.name)) {
        remove(backup.name);
        continue;
      }
      receipt.kept += 1;
      receipt.keptBytes += backup.bytes;
    }
    // Orphaned sidecars: any `<live>.<something>-wal|-shm|-journal` whose parent
    // is not the live file and no longer exists.
    for (const name of readdirSync(directory)) {
      if (!name.startsWith(`${live}.`)) continue;
      const suffix = BACKUP_SIDECAR_SUFFIXES.find((candidate) => name.endsWith(candidate));
      if (!suffix) continue;
      const parent = name.slice(0, -suffix.length);
      if (parent === live || existsSync(join(directory, parent))) continue;
      remove(name);
    }
    return receipt;
  }

  /** Disk, database, WAL and backup sizes for the health payload and the admin storage view. */
  storage(): DatabaseStorage {
    if (this.path === ":memory:") {
      return {
        inMemory: true,
        dataDirectory: "",
        databasePath: this.path,
        databaseBytes: 0,
        databaseFileBytes: 0,
        walBytes: 0,
        backupCount: 0,
        backupBytes: 0,
        lastBackupAt: "",
        dataDirectoryBytes: 0,
        freeBytes: Number.MAX_SAFE_INTEGER,
        totalBytes: Number.MAX_SAFE_INTEGER,
        requiredForBackupBytes: 0,
        diskLow: false,
        backupAllowed: false
      };
    }
    const directory = dirname(this.path);
    const pageCount = Number(this.get<{ page_count: number }>("PRAGMA page_count")?.page_count ?? 0);
    const pageSize = Number(this.get<{ page_size: number }>("PRAGMA page_size")?.page_size ?? 0);
    const size = (path: string): number => {
      try {
        return statSync(path).size;
      } catch {
        return 0;
      }
    };
    const databaseFileBytes = size(this.path);
    const walBytes = size(`${this.path}-wal`);
    const backups = this.listBackups();
    const backupBytes = backups.reduce((total, backup) => total + backup.bytes, 0);
    const dataDirectoryBytes = directoryBytes(directory);
    let freeBytes = 0;
    let totalBytes = 0;
    try {
      const volume = statfsSync(directory);
      freeBytes = Number(volume.bavail) * Number(volume.bsize);
      totalBytes = Number(volume.blocks) * Number(volume.bsize);
    } catch {
      freeBytes = 0;
      totalBytes = 0;
    }
    const requiredForBackupBytes = Math.ceil((databaseFileBytes + walBytes) * BACKUP_FREE_SPACE_FACTOR) + BACKUP_FREE_SPACE_FLOOR_BYTES;
    const backupAllowed = freeBytes >= requiredForBackupBytes;
    const diskLow = !backupAllowed || (totalBytes > 0 && freeBytes < totalBytes * DISK_LOW_FREE_FRACTION);
    return {
      inMemory: false,
      dataDirectory: directory,
      databasePath: this.path,
      databaseBytes: pageCount * pageSize,
      databaseFileBytes,
      walBytes,
      backupCount: backups.length,
      backupBytes,
      lastBackupAt: backups[0]?.modifiedAt ?? "",
      dataDirectoryBytes,
      freeBytes,
      totalBytes,
      requiredForBackupBytes,
      diskLow,
      backupAllowed
    };
  }

  /**
   * Refuses a full copy when the volume cannot hold it, naming the numbers and
   * the exact next step instead of filling the disk and crash-looping.
   */
  assertBackupSpace(purpose = "the pre-migration backup"): DatabaseStorage {
    const storage = this.storage();
    if (storage.inMemory || storage.backupAllowed) return storage;
    throw new YoinkStartupError(
      "disk_low",
      `Yoink cannot take ${purpose}: ${formatMegabytes(storage.freeBytes)} free in ${storage.dataDirectory}, `
      + `but the database is ${formatMegabytes(storage.databaseFileBytes + storage.walBytes)} and a safe copy needs ${formatMegabytes(storage.requiredForBackupBytes)}. `
      + `Free at least ${formatMegabytes(storage.requiredForBackupBytes - storage.freeBytes)} on that volume (npm run doctor lists the largest consumers), then start Yoink again. `
      + `Backups already kept: ${storage.backupCount} (${formatMegabytes(storage.backupBytes)}).`
    );
  }

  /**
   * Online full copy of the live WAL database via `VACUUM INTO`. A failed copy
   * never leaves a partial file behind.
   */
  backupNow(label = "manual"): DatabaseBackupEntry {
    if (this.path === ":memory:") throw new YoinkStartupError("backup_unavailable", "An in-memory database has nothing to back up.");
    this.assertBackupSpace(`a ${label} backup`);
    const suffix = nowIso().replace(/[:.]/g, "-");
    const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "manual";
    const backupPath = `${this.path}.${safeLabel}.${suffix}.sqlite`;
    this.copyInto(backupPath);
    const stats = statSync(backupPath);
    return {
      name: basename(backupPath),
      path: backupPath,
      bytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      kind: safeLabel === "manual" ? "manual" : "other"
    };
  }

  private copyInto(backupPath: string): void {
    const escaped = backupPath.replaceAll("'", "''");
    try {
      this.connection.exec(`VACUUM INTO '${escaped}'`);
      chmodSync(backupPath, 0o600);
    } catch (error) {
      for (const path of [backupPath, ...BACKUP_SIDECAR_SUFFIXES.map((suffix) => `${backupPath}${suffix}`)]) {
        try {
          if (existsSync(path)) unlinkSync(path);
        } catch {
          // Best effort: the failure below is the one that matters.
        }
      }
      throw new YoinkStartupError(
        "backup_failed",
        `Yoink could not copy the database to ${backupPath}: ${error instanceof Error ? error.message : String(error)}. The partial copy was removed.`
      );
    }
  }

  exec(sql: string): void {
    this.connection.exec(sql);
  }

  run(sql: string, ...params: SQLInputValue[]): StatementResultingChanges {
    return this.connection.prepare(sql).run(...params);
  }

  get<T extends object = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.connection.prepare(sql).get(...params) as T | undefined;
  }

  all<T extends object = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.connection.prepare(sql).all(...params) as T[];
  }

  transaction<T>(operation: () => T): T {
    if (this.readOnly) throw new Error("A read-only Yoink database cannot start a write transaction.");
    return this.transactionWithBegin("BEGIN IMMEDIATE", operation);
  }

  readTransaction<T>(operation: () => T): T {
    return this.transactionWithBegin("BEGIN", operation);
  }

  private transactionWithBegin<T>(beginSql: "BEGIN" | "BEGIN IMMEDIATE", operation: () => T): T {
    const outermost = this.transactionDepth === 0;
    const savepoint = `yoink_sp_${this.savepointSequence += 1}`;
    this.connection.exec(outermost ? beginSql : `SAVEPOINT ${savepoint}`);
    this.transactionDepth += 1;
    let result: T;
    try {
      result = operation();
    } catch (error) {
      this.transactionDepth -= 1;
      this.rollbackQuietly(outermost, savepoint);
      throw error;
    }
    // The depth is decremented exactly once, before COMMIT: a failed COMMIT
    // (SQLITE_FULL, IOERR, deferred FK) must not leave the counter at -1, or
    // every later nested call would skip BEGIN IMMEDIATE.
    this.transactionDepth -= 1;
    try {
      this.connection.exec(outermost ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
    } catch (error) {
      this.rollbackQuietly(outermost, savepoint);
      throw error;
    }
    return result;
  }

  /**
   * Undo the current transaction or savepoint without ever replacing the
   * original error: SQLite auto-rolls back on some failures (disk full,
   * IOERR), and a second ROLLBACK would then throw "no transaction is active".
   */
  private rollbackQuietly(outermost: boolean, savepoint: string): void {
    try {
      if (outermost) {
        if (this.connection.isTransaction) this.connection.exec("ROLLBACK");
      } else if (this.connection.isTransaction) {
        this.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.connection.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
    } catch {
      // The original error is the one the caller needs.
    }
  }

  /**
   * The startup check: `quick_check` verifies page and record structure
   * without cross-checking every index against its table, so opening a large
   * database stays fast. The full `assertIntegrity` is for portability imports,
   * doctor and scheduled maintenance.
   */
  assertQuickIntegrity(): void {
    const result = this.get<{ quick_check: string }>("PRAGMA quick_check");
    if (result?.quick_check !== "ok") throw new Error("Yoink database integrity check failed; startup was stopped safely.");
  }

  assertIntegrity(): void {
    const result = this.get<{ integrity_check: string }>("PRAGMA integrity_check");
    if (result?.integrity_check !== "ok") throw new Error("Yoink database integrity check failed; startup was stopped safely.");
  }

  private assertCurrentSchema(): void {
    try {
      const applied = this.all<{ version: number; name: string }>(
        "SELECT version, name FROM schema_migrations ORDER BY version"
      );
      const current = applied.length === MIGRATIONS.length
        && MIGRATIONS.every((migration, index) => {
          const row = applied[index];
          return Number(row?.version) === migration.version && row?.name === migration.name;
        });
      if (!current) throw new Error("schema mismatch");
    } catch {
      throw new Error("The Yoink database schema is not current; start the API migration owner before this process.");
    }
  }

  private applyMigrations(existed: boolean): void {
    const applied = new Set(this.all<{ version: number }>("SELECT version FROM schema_migrations").map((row) => Number(row.version)));
    const pending = MIGRATIONS.filter((migration) => !applied.has(migration.version));
    if (!pending.length) return;
    if (existed && this.path !== ":memory:") {
      const storage = this.assertBackupSpace();
      const suffix = nowIso().replace(/[:.]/g, "-");
      const backupPath = `${this.path}.before-v${pending.at(-1)?.version}.${suffix}.sqlite`;
      this.logger(
        `Yoink backup: copying ${formatMegabytes(storage.databaseFileBytes + storage.walBytes)} to ${basename(backupPath)} before migrations ${pending[0]?.version}-${pending.at(-1)?.version} (${formatMegabytes(storage.freeBytes)} free).`
      );
      this.copyInto(backupPath);
    }
    this.logger(`Yoink migrations: applying ${pending.length} (${pending[0]?.version} through ${pending.at(-1)?.version}).`);
    for (const migration of pending) {
      const existingForeignKeyFailures = migration.foreignKeysDisabled
        ? new Set(this.all<Record<string, unknown>>("PRAGMA foreign_key_check").map((failure) => JSON.stringify(failure)))
        : new Set<string>();
      const apply = (): void => this.transaction(() => {
        this.connection.exec(migration.sql);
        const foreignKeyFailures = migration.foreignKeysDisabled
          ? this.all<Record<string, unknown>>("PRAGMA foreign_key_check")
          : [];
        const introducedForeignKeyFailures = foreignKeyFailures.filter(
          (failure) => !existingForeignKeyFailures.has(JSON.stringify(failure))
        );
        if (introducedForeignKeyFailures.length) {
          throw new Error(
            `Yoink migration ${migration.version} produced an invalid foreign-key graph: `
            + JSON.stringify(introducedForeignKeyFailures.slice(0, 3))
          );
        }
        this.run(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          migration.version,
          migration.name,
          nowIso()
        );
      });
      if (!migration.foreignKeysDisabled) {
        apply();
        continue;
      }
      this.connection.exec("PRAGMA foreign_keys = OFF");
      try {
        apply();
      } finally {
        this.connection.exec("PRAGMA foreign_keys = ON");
      }
      const foreignKeys = this.get<{ foreign_keys: number }>("PRAGMA foreign_keys");
      if (Number(foreignKeys?.foreign_keys) !== 1) {
        throw new Error(`Yoink migration ${migration.version} did not restore foreign-key enforcement.`);
      }
    }
  }

  private secureDatabaseFiles(): void {
    if (this.path === ":memory:") return;
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }

  private seedLocalDefaults(): void {
    const timestamp = nowIso();
    this.transaction(() => {
      this.run("INSERT OR IGNORE INTO tenants(id, name, created_at) VALUES (?, ?, ?)", LOCAL_TENANT_ID, "Local", timestamp);
      this.run(
        "INSERT OR IGNORE INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
        LOCAL_USER_ID,
        LOCAL_TENANT_ID,
        "Local user",
        timestamp
      );
      this.run(
        `INSERT OR IGNORE INTO authorization_memberships(
           tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
         ) VALUES (?, ?, 'yoink_user', 'active', 'local_bootstrap', ?, ?)`,
        LOCAL_TENANT_ID,
        LOCAL_USER_ID,
        timestamp,
        timestamp
      );
      this.run(
        `INSERT OR IGNORE INTO operator_alert_rules(
           id, tenant_id, event_family, name, enabled, severity,
           minimum_occurrences, dedupe_window_seconds, escalation_after_seconds,
           retailer_scope, operation_scope, routes_json, privacy_classification,
           created_by_actor_id, updated_by_actor_id, created_at, updated_at
         ) VALUES (
           'alert_rule_adapter_repair_local', ?, 'adapter_repair',
           'All adapter repair failures', 1, 'warning', 1, 900, 3600,
           '*', '*', '["dashboard","audit_outbox"]', 'operational_configuration',
           'local_bootstrap', 'local_bootstrap', ?, ?
         )`,
        LOCAL_TENANT_ID,
        timestamp,
        timestamp
      );
      const retailers = [
        ["target", "Target", 1, ["target.com"]],
        ["walmart", "Walmart", 0, ["walmart.com"]],
        ["amazon", "Amazon", 0, ["amazon.com"]],
        ["bestbuy", "Best Buy", 0, ["bestbuy.com"]],
        ["disney", "Disney Store", 0, ["disneystore.com"]],
        ["ravensburger", "Ravensburger", 0, ["ravensburger.us"]],
        ["riot", "Riot Games Merch", 0, ["merch.riotgames.com"]],
        ["booksamillion", "Books-A-Million", 0, ["booksamillion.com"]],
        ["fanatics", "Fanatics", 0, ["fanatics.com"]],
        ["kohls", "Kohl's", 0, ["kohls.com"]],
        ["macys", "Macy's", 0, ["macys.com"]],
        ["pbandai", "Premium Bandai", 0, ["p-bandai.com"]],
        ["pokemoncenter", "Pokémon Center", 0, ["pokemoncenter.com"]],
        ["asus", "ASUS", 0, ["eshop.asus.com"]],
        ["audioadvice", "Audio Advice", 0, ["www.audioadvice.com"]],
        ["bananarepublic", "Banana Republic", 0, ["bananarepublic.gap.com", "secure-bananarepublic.gap.com"]],
        ["bananarepublicfactory", "Banana Republic Factory", 0, ["bananarepublicfactory.gapfactory.com", "secure-bananarepublicfactory.gapfactory.com"]],
        ["athleta", "Athleta", 0, ["athleta.gap.com", "secure-athleta.gap.com"]],
        ["americaneagle", "American Eagle", 0, ["ae.com"]],
        ["aninebing", "ANINE BING", 0, ["aninebing.com"]]
      ] as const;
      for (const [id, name, supported, domains] of retailers) {
        this.run(
          `INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name,
             domains_json = excluded.domains_json, updated_at = excluded.updated_at`,
          id,
          name,
          supported,
          JSON.stringify(domains),
          timestamp,
          timestamp
        );
      }
      // Discord is not connectable in this release, so no placeholder row is
      // seeded; an older install's never-connected placeholder is removed once
      // nothing references it.
      this.run(
        `DELETE FROM source_connections
         WHERE id = 'source_discord_local' AND status = 'disconnected'
           AND NOT EXISTS (SELECT 1 FROM source_listing_refs r WHERE r.source_connection_id = source_connections.id)
           AND NOT EXISTS (SELECT 1 FROM source_product_refs d WHERE d.source_connection_id = source_connections.id)
           AND NOT EXISTS (SELECT 1 FROM offer_observations d WHERE d.source_connection_id = source_connections.id)
           AND NOT EXISTS (SELECT 1 FROM signal_events d WHERE d.source_connection_id = source_connections.id)
           AND NOT EXISTS (SELECT 1 FROM signal_occurrences d WHERE d.source_connection_id = source_connections.id)
           AND NOT EXISTS (SELECT 1 FROM source_product_aliases d WHERE d.source_connection_id = source_connections.id)
           AND NOT EXISTS (SELECT 1 FROM source_variant_retailer_refs d WHERE d.source_connection_id = source_connections.id)
           AND NOT EXISTS (SELECT 1 FROM source_listing_candidates d WHERE d.source_connection_id = source_connections.id)
           AND NOT EXISTS (SELECT 1 FROM source_device_states d WHERE d.source_connection_id = source_connections.id)
           AND NOT EXISTS (SELECT 1 FROM source_sync_runs d WHERE d.source_connection_id = source_connections.id)`
      );
      const sources = [
        ["source_trackalacker_local", "trackalacker", "TrackaLacker", "trusted_exact", 1],
        ["source_browser_local", "browser", "Browser observations", "trusted_exact", 1]
      ] as const;
      for (const [id, source, name, trust, autoCreate] of sources) {
        this.run(
          `INSERT OR IGNORE INTO source_connections(
             id, tenant_id, user_id, source, name, status, trust_level,
             auto_create_missions, is_private, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'disconnected', ?, ?, 1, ?, ?)`,
          id,
          LOCAL_TENANT_ID,
          LOCAL_USER_ID,
          source,
          name,
          trust,
          autoCreate,
          timestamp,
          timestamp
        );
      }
      this.run(
        `INSERT OR IGNORE INTO app_settings(
           user_id, actions_paused, pause_reason, execution_mode,
           dedupe_window_seconds, affiliate_mode, tax_bps,
           store_allowances_json, updated_at
         ) VALUES (?, 1, 'First-run safety pause', 'shadow', 300,
           'prefer_fallback', 1200,
           '{"target":3000,"walmart":3000,"amazon":3000,"bestbuy":3000}', ?)`,
        LOCAL_USER_ID,
        timestamp
      );
      this.run(
        `INSERT OR IGNORE INTO user_spend_policies(
           user_id, tenant_id, revision, currency, per_order_cap_cents,
           daily_cap_cents, monthly_cap_cents, order_submission_enabled,
           created_at, updated_at
         ) VALUES (?, ?, 1, 'USD', NULL, NULL, NULL, 0, ?, ?)`,
        LOCAL_USER_ID,
        LOCAL_TENANT_ID,
        timestamp,
        timestamp
      );
      const attributionPolicies = [
        ["target", "howl", "collectwithdodo", "", ""],
        ["walmart", "howl", "collectwithdodo", "", ""],
        ["amazon", "amazon_associates", "", "", "pokemon-restocks-20"],
        ["bestbuy", "canonical", "", "", ""],
        ["disney", "canonical", "", "", ""],
        ["ravensburger", "canonical", "", "", ""],
        ["riot", "canonical", "", "", ""],
        ["booksamillion", "canonical", "", "", ""],
        ["fanatics", "canonical", "", "", ""],
        ["kohls", "canonical", "", "", ""],
        ["macys", "canonical", "", "", ""],
        ["pbandai", "canonical", "", "", ""],
        ["pokemoncenter", "canonical", "", "", ""],
        ["asus", "canonical", "", "", ""],
        ["audioadvice", "canonical", "", "", ""],
        ["bananarepublic", "canonical", "", "", ""],
        ["bananarepublicfactory", "canonical", "", "", ""],
        ["athleta", "canonical", "", "", ""],
        ["americaneagle", "canonical", "", "", ""],
        ["aninebing", "canonical", "", "", ""]
      ] as const;
      for (const [retailerId, provider, publisherSlug, articleBaseUrl, associateTag] of attributionPolicies) {
        this.run(
          `INSERT OR IGNORE INTO attribution_policies(
             id, tenant_id, user_id, retailer_id, enabled, provider,
             publisher_slug, article_base_url, associate_tag, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
          `attribution_${retailerId}_local`,
          LOCAL_TENANT_ID,
          LOCAL_USER_ID,
          retailerId,
          provider,
          publisherSlug,
          articleBaseUrl,
          associateTag,
          timestamp,
          timestamp
        );
      }
      // Backfill disabled policies for new stores without replacing saved choices.
      for (const [retailerId, provider, publisherSlug, articleBaseUrl, associateTag] of attributionPolicies) {
        for (const user of this.all<{ id: string; tenant_id: string }>(
          `SELECT id, tenant_id FROM users WHERE id <> ? AND NOT EXISTS (
             SELECT 1 FROM attribution_policies policy
             WHERE policy.user_id = users.id AND policy.retailer_id = ?
           )`, LOCAL_USER_ID, retailerId
        )) {
          this.run(
            `INSERT OR IGNORE INTO attribution_policies(
               id, tenant_id, user_id, retailer_id, enabled, provider,
               publisher_slug, article_base_url, associate_tag, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
            `attribution_${retailerId}_${stableHash("yoink_owned_id_v1", user.id, `attribution_${retailerId}`).slice(0, 24)}`,
            user.tenant_id, user.id, retailerId, provider, publisherSlug, articleBaseUrl, associateTag, timestamp, timestamp
          );
        }
      }
      const defaultStrategy = {
        id: "strategy_default_notify",
        name: "Default catchall",
        enabled: true,
        position: 1_000,
        revision: 1,
        sources: [],
        retailers: [],
        pricePolicy: { kind: "any" },
        sellerPolicy: "first_party_only",
        allowedSellers: [],
        includeKeywords: "",
        excludeKeywords: "",
        action: "notify",
        quantity: 1,
        fulfillment: "shipping",
        maxSignalAgeSeconds: 120
      };
      this.run(
        `INSERT OR IGNORE INTO strategies(
           id, tenant_id, user_id, name, enabled, position, revision,
           definition_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?, ?)`,
        defaultStrategy.id,
        LOCAL_TENANT_ID,
        LOCAL_USER_ID,
        defaultStrategy.name,
        defaultStrategy.position,
        JSON.stringify(defaultStrategy),
        timestamp,
        timestamp
      );
    });
  }
}
