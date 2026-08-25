import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
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

test("native PostgreSQL proves independent-session SKIP LOCKED leasing and one-use completion", {
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
    await importer.close();
    importer = null;

    const qualificationConfig = {
      connectionString,
      tlsMode: "local-insecure" as const,
      certificateAuthorityPem: ""
    };
    first = new NodePostgresCutoverDatabase(qualificationConfig, {
      maxConnections: 1,
      applicationName: "yoink_postgres_fleet_qualification"
    });
    second = new NodePostgresCutoverDatabase(qualificationConfig, {
      maxConnections: 1,
      applicationName: "yoink_postgres_fleet_qualification"
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

    const firstStore = new PostgresBackgroundWorkerQualificationStore(first, NATIVE_SCHEMA);
    const secondStore = new PostgresBackgroundWorkerQualificationStore(second, NATIVE_SCHEMA);
    const [firstQualification, secondQualification] = await Promise.all([
      firstStore.qualify(),
      secondStore.qualify()
    ]);
    assert.equal(firstQualification.skipLockedLeaseImplemented, true);
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

    const scheduledFor = "2026-08-25T16:59:00.000Z";
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
  } finally {
    await locker?.query("ROLLBACK").catch(() => undefined);
    await Promise.allSettled([
      importer?.close(),
      first?.close(),
      second?.close(),
      locker?.end()
    ].filter(Boolean) as Array<Promise<void>>);
    await postgres.stop().catch(() => undefined);
    if (existsSync(parent)) rmSync(parent, { recursive: true, force: true });
    if (existsSync(fixture.directory)) rmSync(fixture.directory, { recursive: true, force: true });
  }
});
