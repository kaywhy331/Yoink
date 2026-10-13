import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  CapturedDiscordNotification,
  DiscordIntakeOutcome,
  DiscordIntakeResult
} from "../../../packages/engine/src/discord-notification-intake.js";
import {
  discordNotificationReference,
  discordToast,
  mayBeDiscordToastApp
} from "../../../packages/sources/src/discord-notification.js";
import { parseWindowsToast, windowsFiletimeMs } from "../../../packages/sources/src/windows-toast.js";

/**
 * Reads the Discord notifications Windows shows (Kevin, 2026-10-12: Discord
 * signals "captured by various notifications that populates to my windows
 * notification tab"). Windows keeps the notification centre in a SQLite file
 * the signed-in user can read, so no Discord login, bot or Windows permission
 * prompt is involved. Only rows from Discord's app or a browser are read; a
 * browser's notification is kept only when its site is Discord.
 */

export interface DiscordNotificationHandler {
  enabled(): boolean;
  /** Records one notification; may first follow its short links. */
  receive(notification: CapturedDiscordNotification, now?: number): Promise<DiscordIntakeResult>;
}

export interface WindowsNotificationDecision {
  at: string;
  outcome: DiscordIntakeOutcome;
  channelName: string;
  traceMethod: string;
  reason: string;
  /** A skipped notification's line, word, link and mention counts. */
  shape?: string;
}

export interface WindowsNotificationWatcherStatus {
  /** This install can read Windows notifications (a Windows PC, or a test database). */
  supported: boolean;
  state: "unsupported" | "off" | "starting" | "watching" | "error";
  readMode: "direct" | "copy" | "";
  lastCheckedAt: string;
  lastError: string;
  lastErrorMessage: string;
  lastErrorAt: string;
  /** What the notification centre held at the last check. */
  notificationsInCentre: number;
  discordAppInCentre: number;
  /**
   * Which apps have toasts in the notification centre, by app ID and count only
   * (never their text), so diagnostics show it when Discord's app ID isn't one
   * Yoink recognises. Refreshed once a minute.
   */
  appsInCentre: Array<{ appId: string; toasts: number }>;
  /** Since the server started. */
  discordSeen: number;
  calls: number;
  ignored: number;
  olderSkipped: number;
  lastDiscordAt: string;
  lastCallAt: string;
  startedAt: string;
  /** The newest decisions, without message text. */
  recent: WindowsNotificationDecision[];
}

export interface WindowsNotificationWatcherOptions {
  /** wpndatabase.db, or null where Windows notifications don't exist. */
  databasePath: string | null;
  /**
   * Where a short-lived copy is read when the live file can't be opened
   * (default: the system temp folder). The copy holds every app's
   * notifications, so it is deleted as soon as it has been read.
   */
  snapshotDirectory?: string;
  intervalMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

/** Windows' own notification database for the signed-in user. */
export function windowsNotificationDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  const override = String(env.YOINK_WINDOWS_NOTIFICATION_DB ?? "").trim();
  if (override) return override;
  if (platform !== "win32" || !env.LOCALAPPDATA) return null;
  return win32.join(env.LOCALAPPDATA, "Microsoft", "Windows", "Notifications", "wpndatabase.db");
}

interface ToastRow {
  ord: bigint;
  id: bigint;
  arrival: bigint;
  appId: string;
  payload: Uint8Array | string | null;
}

// Rows from apps that can show a Discord message; every other app's text is never read.
const APP_FILTER = ["discord", "vesktop", "legcord", "armcord", "webcord", "chrome", "chromium", "brave", "msedge",
  "opera", "vivaldi", "firefox", "browsercompany"].map((word) => `h.PrimaryId LIKE '%${word}%'`).join(" OR ");
const MAX_AGE_MS = 15 * 60_000;
const REOPEN_AFTER_MS = 10 * 60_000;
const COPY_MODE_RETRY_DIRECT_MS = 5 * 60_000;
const ROWS_PER_CHECK = 200;
const RECENT_DECISIONS = 25;
const APPS_REFRESH_MS = 60_000;
const REMEMBERED_REFERENCES = 2_000;

function sqliteCode(error: unknown): number {
  const code = Number((error as { errcode?: unknown } | null)?.errcode);
  return Number.isInteger(code) ? code & 0xff : -1;
}

function errorCode(error: unknown): string {
  const code = sqliteCode(error);
  if (code === 5 || code === 6) return "database_locked";
  if (code === 14 || code === 3 || code === 23) return "database_unreadable";
  if (code === 11 || code === 26) return "database_damaged";
  if (code === 1) return "database_unexpected";
  return "read_failed";
}

export class WindowsNotificationWatcher {
  private readonly databasePath: string | null;
  private readonly snapshotDirectory: string;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private handler: DiscordNotificationHandler | null = null;
  private database: DatabaseSync | null = null;
  private openedAt = 0;
  private copyModeSince = 0;
  private snapshotStamp = "";
  private appsCheckedAt = 0;
  private highWater = 0n;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;
  private polling: Promise<void> | null = null;
  /** Reading was turned off: what arrived meanwhile is never read. */
  private skipBacklog = false;
  private readonly seen = new Set<string>();
  private readonly current: WindowsNotificationWatcherStatus;

  constructor(options: WindowsNotificationWatcherOptions) {
    this.databasePath = options.databasePath;
    this.snapshotDirectory = options.snapshotDirectory ?? tmpdir();
    this.intervalMs = Math.max(250, Math.floor(options.intervalMs ?? 1_000));
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.current = {
      supported: Boolean(this.databasePath),
      state: this.databasePath ? "starting" : "unsupported",
      readMode: "",
      lastCheckedAt: "",
      lastError: "",
      lastErrorMessage: "",
      lastErrorAt: "",
      notificationsInCentre: 0,
      discordAppInCentre: 0,
      appsInCentre: [],
      discordSeen: 0,
      calls: 0,
      ignored: 0,
      olderSkipped: 0,
      lastDiscordAt: "",
      lastCallAt: "",
      startedAt: "",
      recent: []
    };
  }

  attach(handler: DiscordNotificationHandler): void {
    this.handler = handler;
  }

  status(): WindowsNotificationWatcherStatus {
    return { ...this.current, recent: [...this.current.recent], appsInCentre: [...this.current.appsInCentre] };
  }

  start(): void {
    if (this.running || !this.databasePath) return;
    this.running = true;
    this.stopped = false;
    this.current.startedAt = new Date(this.now()).toISOString();
    this.log(`Yoink Discord notifications: reading ${this.databasePath}.`);
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // A check under way finishes the notification it is on, and records no more.
    await this.polling?.catch(() => undefined);
    this.close();
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.polling = this.pollOnce().catch(() => undefined).finally(() => {
        this.polling = null;
        this.schedule(this.intervalMs);
      });
    }, delayMs);
    this.timer.unref?.();
  }

  private close(): void {
    try {
      this.database?.close();
    } catch {
      // A database that is already gone has nothing left to close.
    }
    this.database = null;
  }

  private fail(code: string, message: string): void {
    const at = new Date(this.now()).toISOString();
    if (this.current.lastError !== code) this.log(`Yoink Discord notifications: ${message}`);
    this.current.state = "error";
    this.current.lastError = code;
    this.current.lastErrorMessage = message;
    this.current.lastErrorAt = at;
    this.current.lastCheckedAt = at;
  }

  private openDirect(): DatabaseSync {
    if (this.database && this.current.readMode === "direct" && this.now() - this.openedAt < REOPEN_AFTER_MS) return this.database;
    this.close();
    const database = new DatabaseSync(String(this.databasePath), { readOnly: true, timeout: 250 });
    this.database = database;
    this.openedAt = this.now();
    this.current.readMode = "direct";
    return database;
  }

  /**
   * Reads a private copy of the database and its write-ahead log, made only when
   * Windows changed them, and deletes it at once: it holds every app's notifications.
   */
  private readCopy(): ToastRow[] {
    const source = String(this.databasePath);
    const stamp = [source, `${source}-wal`].map((path) => {
      try {
        const stats = statSync(path);
        return `${stats.size}:${stats.mtimeMs}`;
      } catch {
        return "-";
      }
    }).join("|");
    this.current.readMode = "copy";
    if (stamp === this.snapshotStamp) return [];
    mkdirSync(this.snapshotDirectory, { recursive: true });
    const directory = mkdtempSync(join(this.snapshotDirectory, "yoink-notifications-"));
    try {
      const target = join(directory, "wpndatabase.db");
      copyFileSync(source, target);
      if (existsSync(`${source}-wal`)) copyFileSync(`${source}-wal`, `${target}-wal`);
      const database = new DatabaseSync(target, { timeout: 250 });
      try {
        const rows = this.query(database);
        this.snapshotStamp = stamp;
        return rows;
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  /** One check of the notification centre. Public for tests; the timer calls it a second after the last one ends. */
  async pollOnce(): Promise<void> {
    const handler = this.handler;
    if (!handler || !this.databasePath) return;
    let enabled = false;
    try {
      enabled = handler.enabled();
    } catch (error) {
      this.fail("settings_unreadable", `Yoink couldn't read its Discord setting (${error instanceof Error ? error.message : String(error)}).`);
      return;
    }
    if (!enabled) {
      this.close();
      this.skipBacklog = true;
      this.current.state = "off";
      this.current.readMode = "";
      return;
    }
    if (!existsSync(this.databasePath)) {
      this.close();
      this.fail("database_missing", "Windows' notification database isn't where Windows keeps it, so Yoink can't see notifications.");
      return;
    }
    let rows: ToastRow[];
    try {
      rows = this.read();
    } catch (error) {
      this.close();
      const code = errorCode(error);
      this.fail(code, `Yoink couldn't read Windows notifications (${code.replaceAll("_", " ")}: ${error instanceof Error ? error.message : String(error)}).`.slice(0, 300));
      return;
    }
    const now = this.now();
    this.current.state = "watching";
    this.current.lastCheckedAt = new Date(now).toISOString();
    if (this.current.lastError) {
      this.log("Yoink Discord notifications: reading Windows notifications again.");
      this.current.lastError = "";
      this.current.lastErrorMessage = "";
    }
    for (const row of rows) {
      if (this.stopped) break;
      const reference = discordNotificationReference(row.id, row.arrival);
      if (this.seen.has(reference)) continue;
      const toast = discordToast(String(row.appId ?? ""), parseWindowsToast(row.payload));
      this.remember(reference);
      if (!toast) continue;
      const arrivedAt = windowsFiletimeMs(row.arrival);
      this.current.discordSeen += 1;
      this.current.lastDiscordAt = new Date(Number.isFinite(arrivedAt) ? arrivedAt : now).toISOString();
      if (!Number.isFinite(arrivedAt) || arrivedAt < now - MAX_AGE_MS) {
        this.current.olderSkipped += 1;
        continue;
      }
      let decision: DiscordIntakeResult;
      try {
        decision = await handler.receive({ reference, arrivedAt, toast }, now);
      } catch (error) {
        decision = {
          outcome: "rejected",
          reason: error instanceof Error ? error.message.slice(0, 200) : "The notification couldn't be recorded.",
          signalId: "",
          channelName: "",
          traceMethod: ""
        };
      }
      if (decision.outcome === "call") {
        this.current.calls += 1;
        this.current.lastCallAt = new Date(now).toISOString();
      } else if (decision.outcome === "ignored") this.current.ignored += 1;
      if (decision.outcome !== "duplicate") {
        this.current.recent.unshift({
          at: new Date(now).toISOString(),
          outcome: decision.outcome,
          channelName: decision.channelName,
          traceMethod: decision.traceMethod,
          reason: decision.reason.slice(0, 300),
          ...(decision.shape ? { shape: decision.shape.slice(0, 120) } : {})
        });
        this.current.recent.length = Math.min(this.current.recent.length, RECENT_DECISIONS);
      }
    }
  }

  private remember(reference: string): void {
    this.seen.add(reference);
    if (this.seen.size > REMEMBERED_REFERENCES) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  private read(): ToastRow[] {
    // A copy is read only while the live file can't be; the live file is tried again every few minutes.
    if (this.current.readMode === "copy" && this.now() - this.copyModeSince < COPY_MODE_RETRY_DIRECT_MS) return this.readCopy();
    const wasCopy = this.current.readMode === "copy";
    try {
      return this.query(this.openDirect());
    } catch (error) {
      this.close();
      this.copyModeSince = this.now();
      if (!wasCopy) this.log(`Yoink Discord notifications: the live file couldn't be read (${errorCode(error)}); reading a copy instead.`);
      return this.readCopy();
    }
  }

  private query(database: DatabaseSync): ToastRow[] {
    const statement = (sql: string): StatementSync => {
      const prepared = database.prepare(sql);
      prepared.setReadBigInts(true);
      return prepared;
    };
    const totals = statement(
      `SELECT SUM(CASE WHEN n.Type = 'toast' THEN 1 ELSE 0 END) AS total, COALESCE(MAX(n."Order"), 0) AS maxOrder,
              SUM(CASE WHEN n.Type = 'toast' AND h.PrimaryId LIKE '%discord%' THEN 1 ELSE 0 END) AS discord
       FROM Notification n LEFT JOIN NotificationHandler h ON h.RecordId = n.HandlerId`
    ).get() as { total: bigint | null; maxOrder: bigint; discord: bigint | null };
    this.current.notificationsInCentre = Number(totals.total ?? 0n);
    this.current.discordAppInCentre = Number(totals.discord ?? 0n);
    if (!this.appsCheckedAt || this.now() - this.appsCheckedAt >= APPS_REFRESH_MS) {
      this.current.appsInCentre = (statement(
        `SELECT h.PrimaryId AS appId, COUNT(*) AS toasts
         FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId
         WHERE n.Type = 'toast' GROUP BY h.PrimaryId ORDER BY toasts DESC, appId LIMIT 12`
      ).all() as Array<{ appId: string; toasts: bigint }>)
        .map((row) => ({ appId: String(row.appId ?? "").slice(0, 200), toasts: Number(row.toasts) }));
      this.appsCheckedAt = this.now();
    }
    const maxOrder = BigInt(totals.maxOrder ?? 0n);
    // Windows rebuilt its database: start over from its first row.
    if (maxOrder < this.highWater) this.highWater = 0n;
    if (this.skipBacklog) {
      this.skipBacklog = false;
      this.highWater = maxOrder;
      return [];
    }
    if (maxOrder === this.highWater) return [];
    const rows = statement(
      `SELECT n."Order" AS ord, n.Id AS id, n.ArrivalTime AS arrival, h.PrimaryId AS appId, n.Payload AS payload
       FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId
       WHERE n.Type = 'toast' AND n."Order" > ? AND n."Order" <= ? AND (${APP_FILTER})
       ORDER BY n."Order" LIMIT ${ROWS_PER_CHECK}`
    ).all(this.highWater, maxOrder) as unknown as ToastRow[];
    this.highWater = rows.length === ROWS_PER_CHECK ? BigInt(rows.at(-1)?.ord ?? maxOrder) : maxOrder;
    return rows.filter((row) => mayBeDiscordToastApp(String(row.appId ?? "")));
  }
}
