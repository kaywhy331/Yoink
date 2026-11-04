import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { MIGRATIONS, type Migration } from "../packages/database/src/migrations.js";
import { RELEASED_DIGEST, RELEASED_HISTORY, RENUMBERED_DIGEST } from "./released-migration-history.js";

const byName = new Map(MIGRATIONS.map((migration) => [migration.name, migration]));
const privacy = byName.get("guarded_cart_user_privacy_deletion")!;
const released = RELEASED_HISTORY.map(([version, name]) => ({ ...byName.get(name)!, version }));
const renumbered = [
  ...released.slice(0, -2),
  { ...privacy, version: 82 },
  ...released.slice(-2).map((migration) => ({ ...migration, version: migration.version + 1 }))
];
const digest = (migrations: readonly Migration[]) => createHash("sha256").update(JSON.stringify(migrations)).digest("hex");

// Full-history qualification imports temporary modules made with git show.
// Shallow CI reconstructs those same objects, checked against frozen digests.
async function historicalList(environment: string, fallback: readonly Migration[], expectedDigest: string): Promise<readonly Migration[]> {
  const path = process.env[environment];
  const migrations = path
    ? (await import(pathToFileURL(resolve(path)).href) as { MIGRATIONS: readonly Migration[] }).MIGRATIONS
    : fallback;
  assert.equal(digest(migrations), expectedDigest, `${environment} must match its original commit`);
  return migrations;
}

function applyHistory(path: string, migrations: readonly Migration[]): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        ) STRICT;
    `);
    for (const migration of migrations) {
      if (migration.foreignKeysDisabled) db.exec("PRAGMA foreign_keys = OFF");
      try {
        db.exec("BEGIN");
        db.exec(migration.sql);
        db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(
          migration.version, migration.name, `historical-${migration.version}`
        );
        assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
        db.exec("COMMIT");
      } finally {
        if (db.isTransaction) db.exec("ROLLBACK");
        db.exec("PRAGMA foreign_keys = ON");
      }
    }
  } finally {
    db.close();
  }
}

function schema(db: DatabaseSync) {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
}

function ledger(db: DatabaseSync) {
  return db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
}

function timestamps(db: DatabaseSync) {
  return db.prepare("SELECT name, applied_at FROM schema_migrations ORDER BY name").all();
}

function assertCurrent(path: string): void {
  const db = new YoinkDatabase(path, { readOnly: true, migrationMode: "require_current" });
  db.close();
}

function seed(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO bot_providers(id, tenant_id, kind, bot_identity, username, encrypted_secret, verified_at)
      VALUES('fixture_provider', 'tenant_local', 'telegram', 'synthetic_bot', 'synthetic_bot', 'synthetic_ciphertext', 'fixture-time');
    INSERT INTO retailers(id, display_name, created_at, updated_at) VALUES('fixture_store', 'Synthetic store', 'fixture-time', 'fixture-time');
    INSERT INTO product_families(id, title, created_at, updated_at) VALUES('fixture_family', 'Synthetic item', 'fixture-time', 'fixture-time');
    INSERT INTO variants(id, family_id, title, created_at, updated_at) VALUES('fixture_variant', 'fixture_family', 'Item', 'fixture-time', 'fixture-time');
    INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, msrp_cents, created_at, updated_at)
      VALUES('fixture_listing', 'fixture_variant', 'fixture_store', 'item', 'https://store.example/item', 2999, 'fixture-time', 'fixture-time');
    INSERT INTO official_msrp_evidence(id, tenant_id, user_id, listing_id, revision, identity_hash, evidence_hash,
      desired_variant, variant_attributes_json, msrp_cents, source_url, manufacturer_host, source_excerpt,
      source_checked_at, reviewed_by_actor_id, reviewed_at, expires_at, status)
      VALUES('fixture_evidence', 'tenant_local', 'user_local', 'fixture_listing', 1, 'synthetic-identity', 'synthetic-evidence',
      'Item', '{}', 2999, 'https://maker.example/item', 'maker.example', 'Synthetic evidence',
      'fixture-time', 'user_local', 'fixture-time', 'fixture-expiry', 'approved');
    INSERT INTO app_settings(user_id, actions_paused, pause_reason, updated_at)
      VALUES('user_local', 1, 'Synthetic pause', 'fixture-time');
  `);
}

function seededRows(db: DatabaseSync) {
  return ["bot_providers", "retailers", "product_families", "variants", "listings", "official_msrp_evidence"].map(
    (table) => db.prepare(`SELECT * FROM ${table} WHERE id LIKE 'fixture_%' ORDER BY id`).all()
  );
}

test("migration versions are unique and strictly increasing; released history is frozen", () => {
  assert.equal(new Set(MIGRATIONS.map((migration) => migration.version)).size, MIGRATIONS.length);
  assert.equal(new Set(MIGRATIONS.map((migration) => migration.name)).size, MIGRATIONS.length);
  for (const [index, migration] of MIGRATIONS.entries()) {
    assert.ok(migration.version > (MIGRATIONS[index - 1]?.version ?? 0));
  }
  assert.deepEqual(MIGRATIONS.slice(0, RELEASED_HISTORY.length).map(({ version, name }) => [version, name]), RELEASED_HISTORY);
  assert.equal(digest(released), RELEASED_DIGEST);
  assert.equal(digest(renumbered), RENUMBERED_DIGEST);
});

test("released, renumbered, and fresh databases converge without replay or lost data", async () => {
  const root = mkdtempSync(join(tmpdir(), "yoink-history-"));
  const fresh = new YoinkDatabase(join(root, "fresh", "db.sqlite"));
  try {
    const expectedSchema = schema(fresh.connection);
    const expectedLedger = ledger(fresh.connection);
    assertCurrent(fresh.path);
    for (const [label, migrations, pending] of [
      ["released", await historicalList("YOINK_RELEASED_MIGRATIONS", released, RELEASED_DIGEST), [privacy]],
      ["renumbered", await historicalList("YOINK_RENUMBERED_MIGRATIONS", renumbered, RENUMBERED_DIGEST), []]
    ] as const) {
      const path = join(root, `${label}.sqlite`);
      applyHistory(path, migrations);
      const before = new DatabaseSync(path);
      seed(before);
      const rows = seededRows(before);
      const appliedAt = timestamps(before);
      const schemaVersion = before.prepare("PRAGMA schema_version").get();
      before.close();
      const logs: string[] = [];
      const upgraded = new YoinkDatabase(path, { logger: (line) => logs.push(line) });
      let upgradedTimestamps;
      try {
        assert.deepEqual(schema(upgraded.connection), expectedSchema, `${label}: schema`);
        assert.deepEqual(ledger(upgraded.connection), expectedLedger, `${label}: ledger`);
        assert.deepEqual(seededRows(upgraded.connection), rows, `${label}: seeded rows`);
        assert.equal(upgraded.get<{ pause_reason: string }>("SELECT pause_reason FROM app_settings WHERE user_id='user_local'")?.pause_reason, "Synthetic pause");
        upgradedTimestamps = timestamps(upgraded.connection);
        assert.deepEqual(upgradedTimestamps.filter((row) => !pending.some((migration) => migration.name === row.name)), appliedAt);
        assert.equal(logs.filter((line) => line.includes("applying")).length, pending.length ? 1 : 0);
        assert.equal(logs.filter((line) => line.includes("reconciled")).length, label === "renumbered" ? 1 : 0);
        if (!pending.length) assert.deepEqual(upgraded.connection.prepare("PRAGMA schema_version").get(), schemaVersion, "no migration DDL ran");
        else assert.ok(logs.some((line) => line.includes(`applying 1 (${privacy.version} through ${privacy.version})`)));
        for (const table of ["official_msrp_evidence", "single_cart_attempts", "amazon_approved_test"]) {
          assert.equal(upgraded.connection.prepare(`PRAGMA foreign_key_list(${table})`).all().find((row) => row.from === "user_id")?.on_delete, "CASCADE");
        }
        assert.deepEqual(upgraded.connection.prepare("PRAGMA foreign_key_check").all(), []);
        upgraded.assertIntegrity();
      } finally {
        upgraded.close();
      }
      assertCurrent(path);
      const reopenedLogs: string[] = [];
      const reopened = new YoinkDatabase(path, { logger: (line) => reopenedLogs.push(line) });
      try {
        assert.deepEqual(timestamps(reopened.connection), upgradedTimestamps);
        assert.deepEqual(seededRows(reopened.connection), rows);
        assert.ok(!reopenedLogs.some((line) => line.startsWith("Yoink migrations:")), "second open does not replay or reconcile");
      } finally {
        reopened.close();
      }
    }
  } finally {
    fresh.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("partially applied renumbered history reconciles before finding pending migrations", () => {
  const root = mkdtempSync(join(tmpdir(), "yoink-partial-history-"));
  const path = join(root, "db.sqlite");
  try {
    applyHistory(path, renumbered.slice(0, -2));
    const db = new YoinkDatabase(path);
    try {
      assert.deepEqual(ledger(db.connection).map(({ version, name }) => [version, name]), MIGRATIONS.map(({ version, name }) => [version, name]));
      assert.equal(db.get<{ applied_at: string }>("SELECT applied_at FROM schema_migrations WHERE name = ?", privacy.name)?.applied_at, "historical-82");
    } finally {
      db.close();
    }
    assertCurrent(path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reconciliation skips occupied negative keys and leaves unknown names untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "yoink-negative-history-"));
  const path = join(root, "db.sqlite");
  try {
    applyHistory(path, renumbered);
    const before = new DatabaseSync(path);
    before.exec("INSERT INTO schema_migrations VALUES (-1, 'unknown_migration', 'untouched')");
    before.close();
    const db = new YoinkDatabase(path);
    try {
      assert.deepEqual(ledger(db.connection).slice(1).map(({ version, name }) => [version, name]), MIGRATIONS.map(({ version, name }) => [version, name]));
      assert.deepEqual({ ...db.get("SELECT * FROM schema_migrations WHERE version = -1") }, { version: -1, name: "unknown_migration", applied_at: "untouched" });
    } finally {
      db.close();
    }
    assert.throws(() => assertCurrent(path), /schema is not current/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a canonical key occupied by an unknown name rolls back the entire reconciliation", () => {
  const root = mkdtempSync(join(tmpdir(), "yoink-history-collision-"));
  const path = join(root, "db.sqlite");
  try {
    applyHistory(path, renumbered);
    const before = new DatabaseSync(path);
    before.exec("UPDATE schema_migrations SET version = -10 WHERE name = 'guarded_cart_user_privacy_deletion'; INSERT INTO schema_migrations VALUES (82, 'unknown_migration', 'untouched');");
    const original = before.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
    const originalSchema = schema(before);
    before.close();
    const logs: string[] = [];
    assert.throws(() => new YoinkDatabase(path, { logger: (line) => logs.push(line) }), /UNIQUE constraint failed: schema_migrations.version/);
    const after = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual(after.prepare("SELECT * FROM schema_migrations ORDER BY version").all(), original);
      assert.deepEqual(schema(after), originalSchema);
      assert.ok(!logs.some((line) => line.startsWith("Yoink migrations:")));
    } finally {
      after.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
