import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { PostgresBackgroundWorkerQualificationStore } from "../packages/database/src/postgres-background-worker-store.js";
import {
  applyPostgresRuntimeReadRoles,
  verifyPostgresRuntimeReadRoles
} from "../packages/database/src/postgres-runtime-roles.js";
import {
  NodePostgresCutoverDatabase,
  importPostgresCutoverArchive,
  type PostgresCutoverDatabase
} from "../packages/database/src/postgres-cutover.js";
import {
  NodePostgresTenantReadDatabase,
  POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE,
  applyPostgresTenantSessionBoundary,
  buildPostgresTenantSessionManifest,
  verifyPostgresTenantSessionBoundary
} from "../packages/database/src/postgres-tenant-session.js";
import {
  NodePostgresTenantQueueWriteDatabase,
  applyPostgresTenantQueueWriteBoundary,
  buildPostgresTenantQueueWriteManifest,
  verifyPostgresTenantQueueWriteBoundary
} from "../packages/database/src/postgres-tenant-queue-writes.js";
import type { BackgroundWorkerContext } from "../packages/contracts/src/background-worker.js";
import {
  POSTGRES_TEST_WORKER_FINGERPRINT,
  POSTGRES_TEST_WORKER_VERSION,
  createPostgresCutoverFixture
} from "./support/postgres-cutover-fixture.js";

const NATIVE_NOW = new Date("2026-08-25T17:00:00.000Z").getTime();
const NATIVE_SCHEMA = "yoink_native_qualification";
const NATIVE_ROLE_NAMESPACE = "yoink_native_q";
const NATIVE_TENANT = "tenant_cutover_other";
const NATIVE_USER = "user_cutover_other";
const NATIVE_SESSION_ROLE_NAMESPACE = "yoink_native_session";
const NATIVE_QUEUE_WRITE_ROLE_NAMESPACE = "yoink_native_queue_write";
const NATIVE_PRINCIPAL_A = "yoink_native_principal_a";
const NATIVE_PRINCIPAL_B = "yoink_native_principal_b";
const NATIVE_PRINCIPAL_UNMAPPED = "yoink_native_principal_unmapped";
const NATIVE_PRINCIPAL_PASSWORD = "yoink_native_principal_only";

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("A temporary PostgreSQL test port was unavailable."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function insertProbeTask(
  database: PostgresCutoverDatabase,
  id: string,
  priority: number,
  scheduledFor: string
): Promise<void> {
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."background_tasks"(
       id, tenant_id, subject_user_id, task_kind, dedupe_key, state, priority,
       attempt_count, maximum_attempts, scheduled_for, privacy_classification,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'observer_recipe_witness_refresh', $4, 'pending', $5,
               0, 3, $6, 'operational_aggregate', $6, $6)`,
    [id, NATIVE_TENANT, NATIVE_USER, `native:${id}`, priority, scheduledFor]
  );
}

function workerContext(workerId: string): BackgroundWorkerContext {
  return {
    principal: { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
    workerId,
    runtimeKind: "standalone",
    runtimeVersion: POSTGRES_TEST_WORKER_VERSION,
    deploymentFingerprint: POSTGRES_TEST_WORKER_FINGERPRINT
  };
}

test("native PostgreSQL proves server-bound tenant reads, queue writes, and independent SKIP LOCKED leasing", {
  timeout: 180_000
}, async () => {
  const parent = mkdtempSync(join(tmpdir(), "yoink-native-postgres-"));
  const databaseDir = join(parent, "cluster");
  const fixture = createPostgresCutoverFixture();
  const port = await availableLoopbackPort();
  const password = "yoink_native_qualification_only";
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password,
    authMethod: "scram-sha-256",
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--no-sync"],
    postgresFlags: ["-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off"],
    onLog: () => undefined,
    onError: () => undefined
  });
  let importer: NodePostgresCutoverDatabase | null = null;
  let first: NodePostgresCutoverDatabase | null = null;
  let second: NodePostgresCutoverDatabase | null = null;
  let locker: Client | null = null;
  let directClient: Client | null = null;
  let tenantReaderA: NodePostgresTenantReadDatabase | null = null;
  let tenantReaderB: NodePostgresTenantReadDatabase | null = null;
  let tenantReaderUnmapped: NodePostgresTenantReadDatabase | null = null;
  let queueWriterA: NodePostgresTenantQueueWriteDatabase | null = null;
  let queueWriterASecond: NodePostgresTenantQueueWriteDatabase | null = null;
  let queueWriterB: NodePostgresTenantQueueWriteDatabase | null = null;
  let queueWriterUnmapped: NodePostgresTenantQueueWriteDatabase | null = null;
  try {
    await postgres.initialise();
    await postgres.start();
    const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    importer = new NodePostgresCutoverDatabase({
      connectionString,
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    });
    const imported = await importPostgresCutoverArchive(
      importer,
      fixture.archivePath,
      NATIVE_SCHEMA,
      "2026-08-25T16:30:00.000Z"
    );
    assert.equal(imported.matched, true);
    const roles = await applyPostgresRuntimeReadRoles(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      new Date("2026-08-25T16:45:00.000Z").getTime()
    );
    assert.equal(roles.roleCount, 5);
    assert.equal(roles.grantedTableCount, 94);
    assert.equal((await verifyPostgresRuntimeReadRoles(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE
    )).phase, "verified");
    const sessionBoundary = await applyPostgresTenantSessionBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      new Date("2026-08-25T16:50:00.000Z").getTime()
    );
    assert.equal(sessionBoundary.tenantRlsTableCount, 82);
    assert.equal(sessionBoundary.grantCount, 82);
    assert.equal(sessionBoundary.membershipCount, 0);
    assert.equal(sessionBoundary.activePrincipalCount, 0);
    assert.equal(sessionBoundary.restrictivePolicyCount, 82);
    assert.match(sessionBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(sessionBoundary.directParameterSetPrevented, false);
    assert.equal(sessionBoundary.directParameterScopeExpansionPrevented, true);
    assert.equal(sessionBoundary.serverBoundRestrictivePolicies, true);
    assert.equal(sessionBoundary.runtimeAuthority, false);
    assert.deepEqual(
      await verifyPostgresTenantSessionBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE
      ),
      sessionBoundary
    );
    const queueWriteBoundary = await applyPostgresTenantQueueWriteBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      new Date("2026-08-25T16:52:00.000Z").getTime()
    );
    assert.equal(queueWriteBoundary.tableCount, 4);
    assert.equal(queueWriteBoundary.grantCount, 11);
    assert.equal(queueWriteBoundary.functionGrantCount, 3);
    assert.equal(queueWriteBoundary.constraintHelperFunctionCount, 1);
    assert.equal(queueWriteBoundary.membershipCount, 0);
    assert.equal(queueWriteBoundary.activePrincipalCount, 0);
    assert.equal(queueWriteBoundary.restrictivePolicyCount, 4);
    assert.match(queueWriteBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(queueWriteBoundary.deleteAccess, false);
    assert.equal(queueWriteBoundary.handlerRepositoryParity, false);
    assert.equal(queueWriteBoundary.runtimeAuthority, false);
    assert.deepEqual(
      await verifyPostgresTenantQueueWriteBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
      ),
      queueWriteBoundary
    );
    await importer.close();
    importer = null;

    const qualificationConfig = {
      connectionString,
      tlsMode: "local-insecure" as const,
      certificateAuthorityPem: ""
    };
    first = new NodePostgresCutoverDatabase(qualificationConfig, {
      maxConnections: 1,
      applicationName: "yoink_postgres_fleet_qualification",
      transactionIsolation: "read-committed"
    });
    second = new NodePostgresCutoverDatabase(qualificationConfig, {
      maxConnections: 1,
      applicationName: "yoink_postgres_fleet_qualification",
      transactionIsolation: "read-committed"
    });
    locker = postgres.getPgClient("postgres", "127.0.0.1");
    await locker.connect();
    const [firstIdentity, secondIdentity, lockerIdentity] = await Promise.all([
      first.query<{ backendPid: number; serverVersion: string; applicationName: string }>(
        `SELECT pg_backend_pid() AS "backendPid",
                current_setting('server_version_num') AS "serverVersion",
                current_setting('application_name') AS "applicationName"`
      ),
      second.query<{ backendPid: number; serverVersion: string; applicationName: string }>(
        `SELECT pg_backend_pid() AS "backendPid",
                current_setting('server_version_num') AS "serverVersion",
                current_setting('application_name') AS "applicationName"`
      ),
      locker.query<{ backendPid: number; serverVersion: string }>(
        "SELECT pg_backend_pid() AS \"backendPid\", current_setting('server_version_num') AS \"serverVersion\""
      )
    ]);
    assert.equal(new Set([
      firstIdentity.rows[0]?.backendPid,
      secondIdentity.rows[0]?.backendPid,
      lockerIdentity.rows[0]?.backendPid
    ]).size, 3);
    assert.equal(Math.floor(Number(firstIdentity.rows[0]?.serverVersion ?? 0) / 10_000), 16);
    assert.equal(secondIdentity.rows[0]?.serverVersion, firstIdentity.rows[0]?.serverVersion);
    assert.equal(lockerIdentity.rows[0]?.serverVersion, firstIdentity.rows[0]?.serverVersion);
    assert.equal(firstIdentity.rows[0]?.applicationName, "yoink_postgres_fleet_qualification");
    assert.equal(secondIdentity.rows[0]?.applicationName, "yoink_postgres_fleet_qualification");

    const tenantSessionManifest = buildPostgresTenantSessionManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE
    );
    const queueWriteManifest = buildPostgresTenantQueueWriteManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
    );
    for (const principalRole of [NATIVE_PRINCIPAL_A, NATIVE_PRINCIPAL_B, NATIVE_PRINCIPAL_UNMAPPED]) {
      await first.query(
        `CREATE ROLE "${principalRole}"
         LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
         PASSWORD '${NATIVE_PRINCIPAL_PASSWORD}'`
      );
      await first.query(
        `GRANT "${tenantSessionManifest.sessionRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${queueWriteManifest.writeRole.name}" TO "${principalRole}"`
      );
    }
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4), ($5, $6, $7, TRUE, $4)`,
      [
        NATIVE_PRINCIPAL_A,
        NATIVE_TENANT,
        NATIVE_USER,
        "2026-08-25T16:55:00.000Z",
        NATIVE_PRINCIPAL_B,
        "tenant_local",
        "user_local"
      ]
    );
    const principalConnection = (principalRole: string): string =>
      `postgresql://${principalRole}:${NATIVE_PRINCIPAL_PASSWORD}@127.0.0.1:${port}/postgres`;
    tenantReaderA = new NodePostgresTenantReadDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE, { maxConnections: 1 });
    tenantReaderB = new NodePostgresTenantReadDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE, { maxConnections: 1 });
    tenantReaderUnmapped = new NodePostgresTenantReadDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_UNMAPPED),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE, { maxConnections: 1 });
    queueWriterA = new NodePostgresTenantQueueWriteDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, { maxConnections: 1 });
    queueWriterASecond = new NodePostgresTenantQueueWriteDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, { maxConnections: 1 });
    queueWriterB = new NodePostgresTenantQueueWriteDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, { maxConnections: 1 });
    queueWriterUnmapped = new NodePostgresTenantQueueWriteDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_UNMAPPED),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, { maxConnections: 1 });

    directClient = new Client({ connectionString: principalConnection(NATIVE_PRINCIPAL_A) });
    directClient.on("error", () => undefined);
    await directClient.connect();
    await directClient.query(`SET ROLE "${tenantSessionManifest.sessionRole.name}"`);
    await directClient.query(`SET ${"yoink.tenant_id"} = 'tenant_local'`);
    assert.deepEqual(
      (await directClient.query<{ id: string }>(
        `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
      )).rows,
      []
    );
    await directClient.query(`SET ${"yoink.tenant_id"} = '${NATIVE_TENANT}'`);
    assert.deepEqual(
      (await directClient.query<{ id: string }>(
        `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
      )).rows.map((row) => row.id),
      [NATIVE_USER]
    );
    await directClient.end();
    directClient = null;

    const [principalAView, principalBView] = await Promise.all([
      tenantReaderA.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => {
          const users = await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
          );
          const offers = await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."offer_observations" ORDER BY id`
          );
          return { users: users.rows.map((row) => row.id), offers: offers.rows.map((row) => row.id) };
        }
      ),
      tenantReaderB.readTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async (session) => {
          const users = await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
          );
          const offers = await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."offer_observations" ORDER BY id`
          );
          return { users: users.rows.map((row) => row.id), offers: offers.rows.map((row) => row.id) };
        }
      )
    ]);
    assert.deepEqual(principalAView, {
      users: [NATIVE_USER],
      offers: ["offer_cutover_other"]
    });
    assert.deepEqual(principalBView, {
      users: ["user_local"],
      offers: []
    });
    await assert.rejects(
      tenantReaderA.readTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async () => undefined
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      tenantReaderUnmapped.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async () => undefined
      ),
      /tenant session principal is not active/
    );
    assert.deepEqual(
      await tenantReaderA.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => {
          await session.query(`SET LOCAL ${"yoink.tenant_id"} = 'tenant_local'`);
          return (await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
          )).rows;
        }
      ),
      []
    );
    await assert.rejects(
      tenantReaderA.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(
          `INSERT INTO "${NATIVE_SCHEMA}"."app_settings"(user_id, updated_at) VALUES ($1, $2)`,
          [NATIVE_USER, "2026-08-25T16:56:00.000Z"]
        )
      ),
      /read-only|permission denied/i
    );
    assert.deepEqual(
      await tenantReaderA.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ tenantId: string; userId: string }>(
          `SELECT current_setting('yoink.tenant_id') AS "tenantId",
                  current_setting('yoink.user_id') AS "userId"`
        )).rows[0]
      ),
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER }
    );

    const heartbeatInsert = (
      writer: NodePostgresTenantQueueWriteDatabase,
      principal: { tenantId: string; userId: string },
      workerId: string
    ) => writer.writeTransaction(principal, async (session) =>
      (await session.query<{ tenantId: string; workerId: string }>(
        `INSERT INTO "${NATIVE_SCHEMA}"."background_worker_heartbeats"(
           tenant_id, subject_user_id, worker_id, runtime_kind, runtime_version,
           state, started_at, heartbeat_at, stopped_at, last_error_code,
           privacy_classification, deployment_fingerprint
         ) VALUES ($1, $2, $3, 'standalone', $4, 'running', $5, $5, '', '',
                   'operational_aggregate', $6)
         RETURNING tenant_id AS "tenantId", worker_id AS "workerId"`,
        [
          principal.tenantId,
          principal.userId,
          workerId,
          POSTGRES_TEST_WORKER_VERSION,
          "2026-08-25T16:57:00.000Z",
          POSTGRES_TEST_WORKER_FINGERPRINT
        ]
      )).rows[0]
    );
    assert.deepEqual(await Promise.all([
      heartbeatInsert(
        queueWriterA,
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "native_queue_writer_a"
      ),
      heartbeatInsert(
        queueWriterB,
        { tenantId: "tenant_local", userId: "user_local" },
        "native_queue_writer_b"
      )
    ]), [
      { tenantId: NATIVE_TENANT, workerId: "native_queue_writer_a" },
      { tenantId: "tenant_local", workerId: "native_queue_writer_b" }
    ]);
    const [queueViewA, queueViewB] = await Promise.all([
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ workerId: string }>(
          `SELECT worker_id AS "workerId"
           FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           WHERE worker_id LIKE 'native_queue_%' ORDER BY worker_id`
        )).rows.map((row) => row.workerId)
      ),
      queueWriterB.writeTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async (session) => (await session.query<{ workerId: string }>(
          `SELECT worker_id AS "workerId"
           FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           WHERE worker_id LIKE 'native_queue_%' ORDER BY worker_id`
        )).rows.map((row) => row.workerId)
      )
    ]);
    assert.deepEqual(queueViewA, ["native_queue_writer_a"]);
    assert.deepEqual(queueViewB, ["native_queue_writer_b"]);
    assert.deepEqual(
      await queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ errorCode: string }>(
          `UPDATE "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           SET last_error_code = 'native_probe'
           WHERE worker_id = 'native_queue_writer_a'
           RETURNING last_error_code AS "errorCode"`
        )).rows
      ),
      [{ errorCode: "native_probe" }]
    );
    assert.deepEqual(
      await queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ workerId: string }>(
          `UPDATE "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           SET last_error_code = 'cross_tenant_probe'
           WHERE worker_id = 'native_queue_writer_b'
           RETURNING worker_id AS "workerId"`
        )).rows
      ),
      []
    );
    assert.deepEqual(
      await queueWriterB.writeTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async (session) => (await session.query<{ errorCode: string }>(
          `SELECT last_error_code AS "errorCode"
           FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           WHERE worker_id = 'native_queue_writer_b'`
        )).rows
      ),
      [{ errorCode: "" }]
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(
          `INSERT INTO "${NATIVE_SCHEMA}"."background_worker_heartbeats"(
             tenant_id, subject_user_id, worker_id, runtime_kind, runtime_version,
             state, started_at, heartbeat_at, stopped_at, last_error_code,
             privacy_classification, deployment_fingerprint
           ) VALUES ('tenant_local', 'user_local', 'native_queue_cross', 'standalone',
                     $1, 'running', $2, $2, '', '', 'operational_aggregate', $3)`,
          [
            POSTGRES_TEST_WORKER_VERSION,
            "2026-08-25T16:57:01.000Z",
            POSTGRES_TEST_WORKER_FINGERPRINT
          ]
        )
      ),
      /row-level security/i
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(
          `DELETE FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           WHERE worker_id = 'native_queue_writer_a'`
        )
      ),
      /permission denied/i
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(
          `UPDATE "${NATIVE_SCHEMA}"."background_task_events"
           SET reason_code = reason_code WHERE tenant_id = $1`,
          [NATIVE_TENANT]
        )
      ),
      /permission denied/i
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(`SELECT id FROM "${NATIVE_SCHEMA}"."users"`)
      ),
      /permission denied/i
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async () => undefined
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      queueWriterUnmapped.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async () => undefined
      ),
      /tenant session principal is not active/
    );
    assert.deepEqual(
      await queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ tenantId: string; userId: string }>(
          `SELECT current_setting('yoink.tenant_id') AS "tenantId",
                  current_setting('yoink.user_id') AS "userId"`
        )).rows[0]
      ),
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER }
    );

    const firstStore = new PostgresBackgroundWorkerQualificationStore(first, NATIVE_SCHEMA, {
      tenantQueueWriteDatabase: queueWriterA
    });
    const secondStore = new PostgresBackgroundWorkerQualificationStore(second, NATIVE_SCHEMA, {
      tenantQueueWriteDatabase: queueWriterASecond
    });
    const [firstQualification, secondQualification] = await Promise.all([
      firstStore.qualify(),
      secondStore.qualify()
    ]);
    assert.equal(firstQualification.skipLockedLeaseImplemented, true);
    assert.equal(firstQualification.serverBoundQueueWriteTransactions, true);
    assert.equal(firstQualification.queueStoreWriteRoleParity, true);
    assert.equal(firstQualification.atomicDeploymentAttestationAndQueueWrite, false);
    assert.equal(firstQualification.controlRepositoryParity, false);
    assert.equal(firstQualification.handlerRepositoryParity, false);
    assert.deepEqual(secondQualification, firstQualification);

    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."background_task_events"
       WHERE tenant_id = $1 AND subject_user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."background_tasks"
       WHERE tenant_id = $1 AND subject_user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."background_task_schedules"
       WHERE tenant_id = $1 AND subject_user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    );

    await firstStore.ensureSchedules(workerContext("native_repository_probe"), NATIVE_NOW);
    assert.equal(
      await firstStore.enqueueDueSchedules(workerContext("native_repository_probe"), NATIVE_NOW),
      7
    );
    const restrictedRepositoryRows = await first.query<{
      schedules: string | number | bigint;
      tasks: string | number | bigint;
      events: string | number | bigint;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."background_task_schedules"
          WHERE tenant_id = $1 AND subject_user_id = $2) AS schedules,
         (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."background_tasks"
          WHERE tenant_id = $1 AND subject_user_id = $2) AS tasks,
         (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."background_task_events"
          WHERE tenant_id = $1 AND subject_user_id = $2) AS events`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    assert.deepEqual(restrictedRepositoryRows.rows.map((row) => ({
      schedules: Number(row.schedules),
      tasks: Number(row.tasks),
      events: Number(row.events)
    })), [{ schedules: 7, tasks: 7, events: 7 }]);
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."background_tasks"
       SET state = 'cancelled', completed_at = $3, updated_at = $3
       WHERE tenant_id = $1 AND subject_user_id = $2 AND state = 'pending'`,
      [NATIVE_TENANT, NATIVE_USER, "2026-08-25T17:00:00.001Z"]
    );

    await firstStore.heartbeat(workerContext("native_repository_probe"), "", NATIVE_NOW);
    assert.equal(
      (await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
         WHERE tenant_id = $1 AND subject_user_id = $2
           AND worker_id = 'native_repository_probe' AND state = 'running'`,
        [NATIVE_TENANT, NATIVE_USER]
      )).rows[0]?.count,
      "1"
    );
    const scheduledFor = "2026-08-25T16:59:00.000Z";
    await insertProbeTask(first, "native_repository_retry", 25, scheduledFor);
    const retryLease = await firstStore.leaseNext(
      workerContext("native_repository_probe"),
      60,
      NATIVE_NOW
    );
    assert.equal(retryLease?.id, "native_repository_retry");
    await firstStore.fail(
      workerContext("native_repository_probe"),
      retryLease!.id,
      retryLease!.capabilityToken,
      "native_repository_probe",
      NATIVE_NOW + 1
    );
    assert.deepEqual(
      (await first.query<{ state: string; errorCode: string }>(
        `SELECT state, last_error_code AS "errorCode"
         FROM "${NATIVE_SCHEMA}"."background_tasks" WHERE id = 'native_repository_retry'`
      )).rows,
      [{ state: "retry_wait", errorCode: "native_repository_probe" }]
    );

    await insertProbeTask(first, "native_contention_locked", 100, scheduledFor);
    await insertProbeTask(first, "native_contention_skipped", 50, scheduledFor);
    await locker.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await locker.query(
      `SELECT id FROM "${NATIVE_SCHEMA}"."background_tasks"
       WHERE id = 'native_contention_locked' FOR UPDATE`
    );

    const skippedLease = await secondStore.leaseNext(workerContext("native_worker_b"), 60, NATIVE_NOW);
    assert.equal(skippedLease?.id, "native_contention_skipped");
    assert.equal(
      await firstStore.leaseNext(workerContext("native_worker_a"), 60, NATIVE_NOW),
      null
    );
    await secondStore.complete(
      workerContext("native_worker_b"),
      skippedLease!.id,
      skippedLease!.capabilityToken,
      { nativeContentionProbe: true },
      NATIVE_NOW + 1
    );
    await locker.query("ROLLBACK");

    const releasedLease = await firstStore.leaseNext(workerContext("native_worker_a"), 60, NATIVE_NOW + 2);
    assert.equal(releasedLease?.id, "native_contention_locked");
    await assert.rejects(
      firstStore.complete(
        workerContext("native_worker_a"),
        releasedLease!.id,
        "A".repeat(43),
        { nativeContentionProbe: true },
        NATIVE_NOW + 3
      ),
      /capability is invalid or expired/
    );
    await firstStore.complete(
      workerContext("native_worker_a"),
      releasedLease!.id,
      releasedLease!.capabilityToken,
      { nativeContentionProbe: true },
      NATIVE_NOW + 4
    );

    await insertProbeTask(first, "native_contention_race", 75, scheduledFor);
    const raced = await Promise.all([
      firstStore.leaseNext(workerContext("native_worker_a"), 60, NATIVE_NOW + 5),
      secondStore.leaseNext(workerContext("native_worker_b"), 60, NATIVE_NOW + 5)
    ]);
    const winners = raced.filter((lease) => lease !== null);
    assert.equal(winners.length, 1);
    assert.equal(winners[0]?.id, "native_contention_race");
    const winnerIndex = raced.findIndex((lease) => lease !== null);
    const winnerStore = winnerIndex === 0 ? firstStore : secondStore;
    const winnerContext = workerContext(winnerIndex === 0 ? "native_worker_a" : "native_worker_b");
    await winnerStore.complete(
      winnerContext,
      winners[0]!.id,
      winners[0]!.capabilityToken,
      { nativeRaceWinner: true },
      NATIVE_NOW + 6
    );

    const finalTasks = await first.query<{
      id: string;
      state: string;
      attemptCount: string | number | bigint;
      leaseCapabilityHash: string;
    }>(
      `SELECT id, state, attempt_count AS "attemptCount",
              lease_capability_hash AS "leaseCapabilityHash"
       FROM "${NATIVE_SCHEMA}"."background_tasks"
       WHERE id LIKE 'native_contention_%' ORDER BY id`
    );
    assert.deepEqual(finalTasks.rows.map((row) => ({
      id: row.id,
      state: row.state,
      attemptCount: Number(row.attemptCount),
      capabilityCleared: row.leaseCapabilityHash === ""
    })), [
      { id: "native_contention_locked", state: "succeeded", attemptCount: 1, capabilityCleared: true },
      { id: "native_contention_race", state: "succeeded", attemptCount: 1, capabilityCleared: true },
      { id: "native_contention_skipped", state: "succeeded", attemptCount: 1, capabilityCleared: true }
    ]);
    const events = await first.query<{
      taskId: string;
      eventType: string;
      count: string | number | bigint;
    }>(
      `SELECT task_id AS "taskId", event_type AS "eventType", COUNT(*) AS count
       FROM "${NATIVE_SCHEMA}"."background_task_events"
       WHERE task_id LIKE 'native_contention_%'
       GROUP BY task_id, event_type ORDER BY task_id, event_type`
    );
    assert.deepEqual(events.rows.map((row) => ({
      taskId: row.taskId,
      eventType: row.eventType,
      count: Number(row.count)
    })), [
      { taskId: "native_contention_locked", eventType: "leased", count: 1 },
      { taskId: "native_contention_locked", eventType: "succeeded", count: 1 },
      { taskId: "native_contention_race", eventType: "leased", count: 1 },
      { taskId: "native_contention_race", eventType: "succeeded", count: 1 },
      { taskId: "native_contention_skipped", eventType: "leased", count: 1 },
      { taskId: "native_contention_skipped", eventType: "succeeded", count: 1 }
    ]);

    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"`
    );
    for (const principalRole of [NATIVE_PRINCIPAL_A, NATIVE_PRINCIPAL_B, NATIVE_PRINCIPAL_UNMAPPED]) {
      await first.query(
        `REVOKE "${tenantSessionManifest.sessionRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${queueWriteManifest.writeRole.name}" FROM "${principalRole}"`
      );
    }
    const cleanBoundary = await verifyPostgresTenantSessionBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE
    );
    assert.equal(cleanBoundary.boundaryCatalogFingerprint, sessionBoundary.boundaryCatalogFingerprint);
    const cleanQueueWriteBoundary = await verifyPostgresTenantQueueWriteBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
    );
    assert.equal(
      cleanQueueWriteBoundary.boundaryCatalogFingerprint,
      queueWriteBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_json_valid"(text) VOLATILE`
    );
    await assert.rejects(
      verifyPostgresTenantQueueWriteBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_json_valid"(text) IMMUTABLE`
    );
    assert.equal(
      (await verifyPostgresTenantQueueWriteBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      queueWriteBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER POLICY "yoink_server_queue_write_background_worker_heartbeats"
       ON "${NATIVE_SCHEMA}"."background_worker_heartbeats"
       USING (TRUE) WITH CHECK (TRUE)`
    );
    await assert.rejects(
      verifyPostgresTenantQueueWriteBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
      ),
      /no longer matches its verified receipt/
    );
    await first.query(
      `ALTER POLICY "yoink_server_bound_users" ON "${NATIVE_SCHEMA}"."users"
       USING (TRUE) WITH CHECK (TRUE)`
    );
    await assert.rejects(
      verifyPostgresTenantSessionBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE
      ),
      /no longer matches its verified receipt/
    );
  } finally {
    await locker?.query("ROLLBACK").catch(() => undefined);
    await Promise.allSettled([
      importer?.close(),
      first?.close(),
      second?.close(),
      locker?.end(),
      directClient?.end(),
      tenantReaderA?.close(),
      tenantReaderB?.close(),
      tenantReaderUnmapped?.close(),
      queueWriterA?.close(),
      queueWriterASecond?.close(),
      queueWriterB?.close(),
      queueWriterUnmapped?.close()
    ].filter(Boolean) as Array<Promise<void>>);
    await postgres.stop().catch(() => undefined);
    if (existsSync(parent)) rmSync(parent, { recursive: true, force: true });
    if (existsSync(fixture.directory)) rmSync(fixture.directory, { recursive: true, force: true });
  }
});
