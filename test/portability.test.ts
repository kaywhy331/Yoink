import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import {
  compareDatabaseToPortabilityArchive,
  exportPortabilityArchive,
  restorePortabilityArchiveToNewDatabase,
  summarizePortableDatabase,
  verifyPortabilityArchive
} from "../packages/database/src/portability.js";

function temporaryPaths(prefix: string): {
  directory: string;
  source: string;
  archive: string;
  restored: string;
} {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return {
    directory,
    source: join(directory, "source.sqlite"),
    archive: join(directory, "snapshot.yoink.ndjson"),
    restored: join(directory, "restored.sqlite")
  };
}

test("the streaming portability archive round-trips every table with exact parity and private permissions", () => {
  const paths = temporaryPaths("yoink-portability-roundtrip-");
  try {
    const source = new YoinkDatabase(paths.source);
    try {
      source.run("UPDATE app_settings SET pause_reason = ? WHERE user_id = ?", "Portable state", LOCAL_USER_ID);
      source.run(
        "INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)",
        "tenant_portability_test",
        "Portable tenant",
        "2026-08-24T00:00:00.000Z"
      );
      source.run(
        "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
        "user_portability_test",
        "tenant_portability_test",
        "Portable user",
        "2026-08-24T00:00:00.000Z"
      );
      for (let index = 0; index < 250; index += 1) {
        source.run(
          `INSERT INTO audit_events(
             id, tenant_id, user_id, correlation_id, event_type,
             reason_code, message, data_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `audit_portability_${index.toString().padStart(4, "0")}`,
          "tenant_portability_test",
          "user_portability_test",
          `correlation_${index}`,
          "portability_fixture",
          "fixture",
          `Portable event ${index}`,
          JSON.stringify({ index, exact: true }),
          "2026-08-24T00:00:00.000Z"
        );
      }

      const exported = exportPortabilityArchive(source, paths.archive, "2026-08-24T01:00:00.000Z");
      assert.equal(statSync(paths.archive).mode & 0o777, 0o600);
      assert.equal(exported.schemaVersion, 26);
      assert.ok(exported.tableCount > 40);
      assert.ok(exported.rowCount > 250);
      assert.match(exported.fileSha256, /^[a-f0-9]{64}$/);
      assert.match(exported.dataSha256, /^[a-f0-9]{64}$/);

      const verified = verifyPortabilityArchive(paths.archive);
      assert.equal(verified.fileSha256, exported.fileSha256);
      assert.equal(verified.dataSha256, exported.dataSha256);
      assert.equal(verified.rowCount, exported.rowCount);

      const secondArchive = join(paths.directory, "snapshot-second.yoink.ndjson");
      const second = exportPortabilityArchive(source, secondArchive, "2026-08-24T02:00:00.000Z");
      assert.equal(second.dataSha256, exported.dataSha256, "generation time is not part of the logical data hash");
      assert.notEqual(second.fileSha256, exported.fileSha256, "the complete file hash binds archive metadata");

      const sourceParity = compareDatabaseToPortabilityArchive(source, paths.archive);
      assert.equal(sourceParity.matched, true);
      assert.deepEqual(sourceParity.mismatchedTables, []);
    } finally {
      source.close();
    }

    const restored = restorePortabilityArchiveToNewDatabase(paths.archive, paths.restored);
    assert.equal(restored.matched, true);
    assert.equal(statSync(paths.restored).mode & 0o777, 0o600);

    const readOnly = new YoinkDatabase(paths.restored, { readOnly: true });
    try {
      assert.equal(readOnly.readOnly, true);
      assert.equal(
        readOnly.get<{ pause_reason: string }>("SELECT pause_reason FROM app_settings WHERE user_id = ?", LOCAL_USER_ID)?.pause_reason,
        "Portable state"
      );
      assert.equal(
        readOnly.get<{ display_name: string }>("SELECT display_name FROM users WHERE id = 'user_portability_test'")?.display_name,
        "Portable user"
      );
      assert.equal(
        readOnly.get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'portability_fixture'")?.count,
        250
      );
      assert.equal(summarizePortableDatabase(readOnly).dataSha256, restored.archiveDataSha256);
      assert.throws(() => readOnly.transaction(() => undefined), /read-only/);
      assert.throws(() => readOnly.run("DELETE FROM users"), /read.?only/i);
    } finally {
      readOnly.close();
    }
  } finally {
    rmSync(paths.directory, { recursive: true, force: true });
  }
});

test("portability export refuses overwrite and parity identifies changed tables", () => {
  const paths = temporaryPaths("yoink-portability-parity-");
  try {
    const db = new YoinkDatabase(paths.source);
    try {
      const first = exportPortabilityArchive(db, paths.archive);
      assert.throws(() => exportPortabilityArchive(db, paths.archive), /EEXIST|exist/i);
      assert.equal(verifyPortabilityArchive(paths.archive).fileSha256, first.fileSha256);

      db.run("UPDATE app_settings SET pause_reason = ? WHERE user_id = ?", "Changed after export", LOCAL_USER_ID);
      const parity = compareDatabaseToPortabilityArchive(db, paths.archive);
      assert.equal(parity.matched, false);
      assert.deepEqual(parity.mismatchedTables, ["app_settings"]);
      assert.notEqual(parity.databaseDataSha256, parity.archiveDataSha256);
    } finally {
      db.close();
    }
  } finally {
    rmSync(paths.directory, { recursive: true, force: true });
  }
});

test("corrupt and truncated archives fail before creating a restore destination", () => {
  const paths = temporaryPaths("yoink-portability-corruption-");
  try {
    const db = new YoinkDatabase(paths.source);
    try {
      exportPortabilityArchive(db, paths.archive);
    } finally {
      db.close();
    }

    const original = readFileSync(paths.archive, "utf8");
    const corruptPath = join(paths.directory, "corrupt.yoink.ndjson");
    const corrupt = original.replace('"Local"', '"L0cal"');
    assert.notEqual(corrupt, original);
    writeFileSync(corruptPath, corrupt, { mode: 0o600 });
    assert.throws(() => verifyPortabilityArchive(corruptPath), /content-hash|data-hash/);
    assert.throws(() => restorePortabilityArchiveToNewDatabase(corruptPath, paths.restored), /content-hash|data-hash/);
    assert.equal(existsSync(paths.restored), false);

    const truncatedPath = join(paths.directory, "truncated.yoink.ndjson");
    writeFileSync(truncatedPath, Buffer.from(original).subarray(0, Buffer.byteLength(original) - 17), { mode: 0o600 });
    assert.throws(() => verifyPortabilityArchive(truncatedPath), /truncated|incomplete|final newline/);
  } finally {
    rmSync(paths.directory, { recursive: true, force: true });
  }
});

test("restore rejects an archive from a different migration/schema ledger and removes its fresh output", () => {
  const paths = temporaryPaths("yoink-portability-schema-");
  try {
    const legacy = new DatabaseSync(paths.source);
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations(version, name, applied_at)
      VALUES (1, 'legacy-fixture', '2026-08-24T00:00:00.000Z');
      CREATE TABLE legacy_records (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      INSERT INTO legacy_records(id, value) VALUES ('legacy_1', 'preserved');
    `);
    legacy.close();

    const readOnly = new YoinkDatabase(paths.source, { readOnly: true });
    try {
      exportPortabilityArchive(readOnly, paths.archive);
    } finally {
      readOnly.close();
    }
    assert.throws(
      () => restorePortabilityArchiveToNewDatabase(paths.archive, paths.restored),
      /migration ledger|table schema/
    );
    assert.equal(existsSync(paths.restored), false);
    assert.equal(existsSync(`${paths.restored}-wal`), false);
    assert.equal(existsSync(`${paths.restored}-shm`), false);
    assert.throws(() => new YoinkDatabase(join(paths.directory, "missing.sqlite"), { readOnly: true }), /does not exist/);
    assert.throws(() => new YoinkDatabase(":memory:", { readOnly: true }), /existing file path/);
  } finally {
    rmSync(paths.directory, { recursive: true, force: true });
  }
});
