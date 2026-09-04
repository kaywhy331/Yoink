import { chmodSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementResultingChanges } from "node:sqlite";
import { nowIso } from "../../domain/src/ids.js";
import { MIGRATIONS } from "./migrations.js";

export const LOCAL_TENANT_ID = "tenant_local";
export const LOCAL_USER_ID = "user_local";
export const MIGRATION_BACKUP_RETENTION_COUNT = 3;

type Row = Record<string, unknown>;

export interface YoinkDatabaseOptions {
  readOnly?: boolean;
  migrationMode?: "apply" | "require_current";
}

export class YoinkDatabase {
  readonly path: string;
  readonly connection: DatabaseSync;
  readonly readOnly: boolean;
  readonly migrationMode: "apply" | "require_current";
  private transactionDepth = 0;
  private savepointSequence = 0;

  constructor(filePath = ":memory:", options: YoinkDatabaseOptions = {}) {
    this.path = filePath;
    this.readOnly = options.readOnly === true;
    this.migrationMode = options.migrationMode ?? "apply";
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
    this.connection = new DatabaseSync(filePath, { readOnly: this.readOnly });
    this.connection.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (this.readOnly) {
      try {
        this.assertIntegrity();
        if (this.migrationMode === "require_current") this.assertCurrentSchema();
      } catch (error) {
        this.connection.close();
        throw error;
      }
      return;
    }
    if (filePath !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.secureDatabaseFiles();
    if (this.migrationMode === "require_current") {
      try {
        this.assertIntegrity();
        this.assertCurrentSchema();
      } catch (error) {
        this.connection.close();
        throw error;
      }
      return;
    }
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    if (existed) this.assertIntegrity();
    try {
      this.applyMigrations(existed);
      this.seedLocalDefaults();
      this.pruneMigrationBackups();
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }

  close(): void {
    this.connection.close();
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
    try {
      const result = operation();
      this.transactionDepth -= 1;
      this.connection.exec(outermost ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      this.transactionDepth -= 1;
      if (outermost) {
        this.connection.exec("ROLLBACK");
      } else {
        this.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.connection.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw error;
    }
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
      const suffix = nowIso().replace(/[:.]/g, "-");
      const backupPath = `${this.path}.before-v${pending.at(-1)?.version}.${suffix}.sqlite`;
      const escaped = backupPath.replaceAll("'", "''");
      this.connection.exec(`VACUUM INTO '${escaped}'`);
      chmodSync(backupPath, 0o600);
    }
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

  private pruneMigrationBackups(): void {
    if (this.path === ":memory:") return;
    const directory = dirname(this.path);
    const prefix = `${basename(this.path)}.before-v`;
    const backups = readdirSync(directory)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".sqlite"))
      .map((name) => ({ name, timestamp: /\.before-v\d+\.(.+)\.sqlite$/.exec(name)?.[1] ?? "" }))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.name.localeCompare(left.name));
    for (const backup of backups.slice(MIGRATION_BACKUP_RETENTION_COUNT)) {
      unlinkSync(join(directory, backup.name));
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
        ["pokemoncenter", "Pokémon Center", 0, ["pokemoncenter.com"]]
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
      const sources = [
        ["source_trackalacker_local", "trackalacker", "TrackaLacker", "trusted_exact", 1],
        ["source_browser_local", "browser", "Browser observations", "trusted_exact", 1],
        ["source_discord_local", "discord", "Discord", "informational", 0]
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
        ["pokemoncenter", "canonical", "", "", ""]
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
