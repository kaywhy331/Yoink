import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { exportPortabilityArchive } from "../packages/database/src/portability.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  importPostgresCutoverArchive,
  inspectPostgresCutoverPreflight,
  loadPostgresCutoverConnectionConfig,
  verifyPostgresCutoverArchive,
  type PostgresCutoverDatabase,
  type PostgresQueryResult,
  type PostgresQuerySession
} from "../packages/database/src/postgres-cutover.js";
import { buildPostgresSchemaManifest } from "../packages/database/src/postgres-schema-manifest.js";

class PgliteCutoverDatabase implements PostgresCutoverDatabase {
  constructor(readonly connection = new PGlite()) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.connection.query<T>(sql, [...parameters]);
  }

  async transaction<T>(operation: (session: PostgresQuerySession) => Promise<T>): Promise<T> {
    return this.connection.transaction(async (transaction) => operation({
      query: async <R extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = []
      ): Promise<PostgresQueryResult<R>> => transaction.query<R>(sql, [...parameters])
    }));
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}

function fixture(): {
  directory: string;
  sourcePath: string;
  archivePath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "yoink-postgres-cutover-"));
  const sourcePath = join(directory, "source.sqlite");
  const archivePath = join(directory, "snapshot.yoink.ndjson");
  const source = new YoinkDatabase(sourcePath);
  try {
    source.run(
      "INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)",
      "tenant_cutover_other",
      "Other cutover tenant",
      "2026-08-25T12:00:00.000Z"
    );
    source.run(
      "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
      "user_cutover_other",
      "tenant_cutover_other",
      "Other cutover user",
      "2026-08-25T12:00:00.000Z"
    );
    for (let index = 0; index < 520; index += 1) {
      source.run(
        `INSERT INTO audit_events(
           id, tenant_id, user_id, correlation_id, event_type,
           reason_code, message, data_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `audit_cutover_${index.toString().padStart(4, "0")}`,
        "tenant_cutover_other",
        "user_cutover_other",
        `correlation_cutover_${index}`,
        "postgres_cutover_fixture",
        "fixture",
        `Cutover event ${index}`,
        JSON.stringify({ index, bounded: true }),
        "2026-08-25T12:00:00.000Z"
      );
    }
    exportPortabilityArchive(source, archivePath, "2026-08-25T13:00:00.000Z");
  } finally {
    source.close();
  }
  return { directory, sourcePath, archivePath };
}

test("the PostgreSQL cutover manifest covers every current invariant family deterministically", () => {
  const first = buildPostgresSchemaManifest();
  const second = buildPostgresSchemaManifest();
  assert.deepEqual(second, first);
  assert.equal(first.contractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(first.tableCount, 95);
  assert.equal(first.foreignKeyCount, 243);
  assert.equal(first.indexCount, 177);
  assert.equal(first.defaultExpressionCount, 282);
  assert.equal(first.checkConstraintCount, 327);
  assert.equal(first.triggerCount, 50);
  assert.equal(first.directTenantTableCount, 68);
  assert.equal(first.inheritedTenantPathTableCount, 14);
  assert.equal(first.noTenantPathTableCount, 13);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(first.tables.every((table) => table.name !== "schema_migrations"));
  assert.ok(first.tables.every((table) => table.indexes.every((index) => Buffer.byteLength(index.name) <= 63)));
});

test("one verified archive imports atomically into real PostgreSQL semantics and reconciles exactly", async () => {
  const paths = fixture();
  const postgres = new PgliteCutoverDatabase();
  try {
    const preflight = await inspectPostgresCutoverPreflight(postgres);
    assert.equal(preflight.serverVersionSupported, true);
    assert.equal(preflight.rowSecurityAvailable, true);
    assert.equal(preflight.skipLockedAvailable, true);
    assert.equal(preflight.cutoverRoleBypassesRls, true);
    assert.equal(preflight.productionReady, false);

    const imported = await importPostgresCutoverArchive(
      postgres,
      paths.archivePath,
      "yoink_cutover_test",
      "2026-08-25T14:00:00.000Z"
    );
    assert.equal(imported.matched, true);
    assert.deepEqual(imported.mismatchedTables, []);
    assert.equal(imported.databaseDataSha256, imported.archiveDataSha256);
    assert.equal(imported.database.tableCount, 95);
    assert.ok(imported.database.rowCount > 520);
    assert.equal(imported.receipt.phase, "verified");
    assert.equal(imported.receipt.qualification.runtimeAuthority, false);
    assert.equal(imported.receipt.qualification.cutoverReady, false);
    assert.equal(imported.receipt.qualification.defaultExpressionParity, true);
    assert.equal(imported.receipt.qualification.checkConstraintParity, true);
    assert.equal(imported.receipt.qualification.triggerParity, true);
    assert.equal(imported.receipt.qualification.asyncRuntimeRepositoryParity, false);

    const verified = await verifyPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_test");
    assert.equal(verified.matched, true);
    assert.equal(verified.receipt.sourceFileSha256, imported.archive.fileSha256);

    const tenantPolicies = await postgres.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_policies WHERE schemaname = 'yoink_cutover_test'`
    );
    assert.equal(tenantPolicies.rows[0]?.count, imported.manifest.directTenantTableCount);
    const triggerCount = await postgres.query<{ count: number }>(`
      SELECT COUNT(*)::integer AS count
      FROM pg_catalog.pg_trigger trigger
      JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'yoink_cutover_test' AND trigger.tgisinternal = FALSE
    `);
    assert.equal(triggerCount.rows[0]?.count, imported.manifest.triggerCount);
    const defaultCount = await postgres.query<{ count: number }>(`
      SELECT COUNT(*)::integer AS count
      FROM information_schema.columns
      WHERE table_schema = 'yoink_cutover_test'
        AND table_name <> 'yoink_cutover_receipt'
        AND column_default IS NOT NULL
    `);
    assert.equal(defaultCount.rows[0]?.count, imported.manifest.defaultExpressionCount);

    await postgres.query("BEGIN");
    await postgres.query(
      `INSERT INTO yoink_cutover_test.retailers(id, display_name, created_at, updated_at)
       VALUES ('retailer_postgres_default_test', 'Default test', $1, $1)`,
      ["2026-08-25T14:20:00.000Z"]
    );
    const defaulted = await postgres.query<{ execution_supported: bigint; domains_json: string }>(
      `SELECT execution_supported, domains_json
       FROM yoink_cutover_test.retailers WHERE id = 'retailer_postgres_default_test'`
    );
    assert.equal(String(defaulted.rows[0]?.execution_supported), "0");
    assert.equal(defaulted.rows[0]?.domains_json, "[]");
    await postgres.query("ROLLBACK");

    await postgres.query("BEGIN");
    await assert.rejects(
      postgres.query(
        `INSERT INTO yoink_cutover_test.retailers(
           id, display_name, execution_supported, created_at, updated_at
         ) VALUES ('retailer_postgres_invalid_check', 'Invalid check', 7, $1, $1)`,
        ["2026-08-25T14:21:00.000Z"]
      ),
      /check constraint/i
    );
    await postgres.query("ROLLBACK");

    await postgres.query("BEGIN");
    await assert.rejects(
      postgres.query(
        `INSERT INTO yoink_cutover_test.users(id, tenant_id, display_name, created_at)
         VALUES ('user_postgres_invalid_fk', 'tenant_does_not_exist', 'Invalid FK', $1)`,
        ["2026-08-25T14:22:00.000Z"]
      ),
      /foreign key/i
    );
    await postgres.query("ROLLBACK");

    await postgres.query("BEGIN");
    await postgres.query(
      `INSERT INTO yoink_cutover_test.extension_devices(
         id, tenant_id, user_id, name, token_hash, created_at, updated_at
       ) VALUES ($1, 'tenant_cutover_other', 'user_cutover_other', 'Trigger test', $2, $3, $3)`,
      [
        "device_postgres_backfill_test",
        "c".repeat(64),
        "2026-08-25T14:25:00.000Z"
      ]
    );
    const backfilled = await postgres.query<{ credential_issued_at: string }>(
      `SELECT credential_issued_at FROM yoink_cutover_test.extension_devices
       WHERE id = 'device_postgres_backfill_test'`
    );
    assert.equal(backfilled.rows[0]?.credential_issued_at, "2026-08-25T14:25:00.000Z");
    await postgres.query("ROLLBACK");

    const insertImmutableEvent = () => postgres.query(
      `INSERT INTO yoink_cutover_test.background_worker_deployment_events(
         id, sequence, contract_version, from_mode, to_mode,
         from_deployment_fingerprint, to_deployment_fingerprint,
         runtime_version, previous_event_hash, event_hash, reason_code,
         privacy_classification, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        "deployment_event_postgres_trigger_test",
        999,
        2,
        "",
        "disabled",
        "",
        "a".repeat(64),
        "0.56.0-test",
        "",
        "b".repeat(64),
        "api_startup_contract",
        "operational_configuration",
        "2026-08-25T14:30:00.000Z"
      ]
    );
    await postgres.query("BEGIN");
    await insertImmutableEvent();
    await assert.rejects(
      postgres.query(
        "UPDATE yoink_cutover_test.background_worker_deployment_events SET runtime_version = 'changed' WHERE sequence = 999"
      ),
      /append-only/
    );
    await postgres.query("ROLLBACK");
    await postgres.query("BEGIN");
    await insertImmutableEvent();
    await assert.rejects(
      postgres.query("DELETE FROM yoink_cutover_test.background_worker_deployment_events WHERE sequence = 999"),
      /append-only/
    );
    await postgres.query("ROLLBACK");

    await postgres.query("CREATE ROLE yoink_cutover_reader NOLOGIN");
    await postgres.query("GRANT USAGE ON SCHEMA yoink_cutover_test TO yoink_cutover_reader");
    await postgres.query("GRANT SELECT, INSERT, UPDATE ON yoink_cutover_test.users TO yoink_cutover_reader");
    await postgres.query("SET ROLE yoink_cutover_reader");
    const defaultDenied = await postgres.query<{ id: string }>("SELECT id FROM yoink_cutover_test.users");
    assert.deepEqual(defaultDenied.rows, []);
    await assert.rejects(
      postgres.query(
        `INSERT INTO yoink_cutover_test.users(id, tenant_id, display_name, created_at)
         VALUES ('user_postgres_cross_tenant', 'tenant_local', 'Cross tenant', $1)`,
        ["2026-08-25T14:40:00.000Z"]
      ),
      /row-level security/i
    );
    await postgres.query("SET yoink.tenant_id = 'tenant_cutover_other'");
    const visible = await postgres.query<{ id: string }>("SELECT id FROM yoink_cutover_test.users ORDER BY id");
    assert.deepEqual(visible.rows.map((row) => row.id), ["user_cutover_other"]);
    const blocked = await postgres.query(
      "UPDATE yoink_cutover_test.users SET display_name = 'blocked' WHERE id = 'user_local' RETURNING id"
    );
    assert.equal(blocked.rows.length, 0);
    await postgres.query("RESET ROLE");
    await postgres.query("RESET yoink.tenant_id");

    await postgres.query(
      "UPDATE yoink_cutover_test.users SET display_name = 'Changed after reconciliation' WHERE id = 'user_cutover_other'"
    );
    const mismatch = await verifyPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_test");
    assert.equal(mismatch.matched, false);
    assert.deepEqual(mismatch.mismatchedTables, ["users"]);
  } finally {
    await postgres.close();
    rmSync(paths.directory, { recursive: true, force: true });
  }
});

test("corruption and reused schemas fail closed without replacing a verified cutover receipt", async () => {
  const paths = fixture();
  const postgres = new PgliteCutoverDatabase();
  try {
    const imported = await importPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_guard");
    await assert.rejects(
      importPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_guard"),
      /schema|exist|duplicate/i
    );
    const afterDuplicate = await verifyPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_guard");
    assert.equal(afterDuplicate.matched, true);
    assert.equal(afterDuplicate.receipt.sourceDataSha256, imported.receipt.sourceDataSha256);

    const corruptPath = join(paths.directory, "corrupt.yoink.ndjson");
    const corrupt = readFileSync(paths.archivePath, "utf8").replace("Other cutover tenant", "Poisoned cutover tenant");
    writeFileSync(corruptPath, corrupt, { mode: 0o600 });
    await assert.rejects(
      importPostgresCutoverArchive(postgres, corruptPath, "yoink_cutover_corrupt"),
      /hash/i
    );
    const absent = await postgres.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM pg_namespace WHERE nspname = 'yoink_cutover_corrupt'"
    );
    assert.equal(absent.rows[0]?.count, 0);
  } finally {
    await postgres.close();
    rmSync(paths.directory, { recursive: true, force: true });
  }
});

test("PostgreSQL connection configuration keeps TLS explicit and loopback-only exceptions bounded", () => {
  assert.deepEqual(
    loadPostgresCutoverConnectionConfig({
      YOINK_POSTGRES_URL: "postgresql://yoink@db.internal/yoink",
      YOINK_POSTGRES_TLS_MODE: "verify-full"
    }),
    {
      connectionString: "postgresql://yoink@db.internal/yoink",
      tlsMode: "verify-full",
      certificateAuthorityPem: ""
    }
  );
  assert.equal(
    loadPostgresCutoverConnectionConfig({
      YOINK_POSTGRES_URL: "postgresql://yoink@127.0.0.1/yoink",
      YOINK_POSTGRES_TLS_MODE: "local-insecure"
    }).tlsMode,
    "local-insecure"
  );
  assert.throws(
    () => loadPostgresCutoverConnectionConfig({
      YOINK_POSTGRES_URL: "postgresql://yoink@db.internal/yoink",
      YOINK_POSTGRES_TLS_MODE: "local-insecure"
    }),
    /loopback/
  );
  assert.throws(
    () => loadPostgresCutoverConnectionConfig({
      YOINK_POSTGRES_URL: "postgresql://yoink@db.internal/yoink?sslmode=disable"
    }),
    /TLS policy/
  );
  assert.throws(() => loadPostgresCutoverConnectionConfig({}), /YOINK_POSTGRES_URL/);
});
