import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundWorkerContext } from "../packages/contracts/src/background-worker.js";
import { BACKGROUND_TASK_KINDS } from "../packages/domain/src/background-task.js";
import { SqliteBackgroundWorkerStore } from "../packages/database/src/background-worker-store.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

const NOW = new Date("2026-08-25T12:00:00.000Z").getTime();
const DEPLOYMENT_FINGERPRINT = "a".repeat(64);

function seedPrincipal(db: YoinkDatabase, tenantId: string, userId: string): void {
  const timestamp = new Date(NOW).toISOString();
  db.run("INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)", tenantId, tenantId, timestamp);
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)", userId, tenantId, userId, timestamp);
}

function context(tenantId: string, userId: string, workerId = "background_worker_store_test"): BackgroundWorkerContext {
  return {
    principal: { tenantId, userId },
    workerId,
    runtimeKind: "standalone",
    runtimeVersion: "store-test",
    deploymentFingerprint: DEPLOYMENT_FINGERPRINT
  };
}

test("the async SQLite worker store paginates every principal without overlap", async () => {
  const db = new YoinkDatabase();
  try {
    seedPrincipal(db, "tenant_worker_a", "user_worker_a");
    seedPrincipal(db, "tenant_worker_b", "user_worker_b");
    const store = new SqliteBackgroundWorkerStore(db, { principalMode: "all" });
    const seen: Array<{ tenantId: string; userId: string }> = [];
    let cursor = "";
    do {
      const page = await store.listPrincipals(cursor, 1);
      assert.equal(page.principals.length, 1);
      seen.push(...page.principals);
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 3);
    assert.equal(new Set(seen.map((item) => `${item.tenantId}/${item.userId}`)).size, 3);
    const first = await store.listPrincipals("", 1);
    assert.ok(first.nextCursor);
    await assert.rejects(() => store.listPrincipals(`${first.nextCursor}x`, 1), /cursor is invalid/);
  } finally {
    db.close();
  }
});

test("the async SQLite worker store scopes queues and reports complete standalone coverage", async () => {
  const db = new YoinkDatabase();
  try {
    seedPrincipal(db, "tenant_worker_coverage", "user_worker_coverage");
    const store = new SqliteBackgroundWorkerStore(db, { principalMode: "all" });
    store.configureDeploymentExpectation("external", DEPLOYMENT_FINGERPRINT, "store-test", NOW - 1);
    const waiting = await store.deploymentStatus("standalone", DEPLOYMENT_FINGERPRINT, NOW);
    assert.equal(waiting.state, "waiting");
    assert.equal(waiting.healthy, false);
    assert.equal(waiting.lastErrorCode, "worker_waiting");
    assert.equal(waiting.totalPrincipals, 2);
    const page = await store.listPrincipals("", 100);
    assert.equal(page.principals.length, 2);
    for (const owner of page.principals) {
      const worker = context(owner.tenantId, owner.userId);
      await store.ensureSchedules(worker, NOW);
      assert.equal(await store.enqueueDueSchedules(worker, NOW), BACKGROUND_TASK_KINDS.length);
      await store.heartbeat(worker, "", NOW);
    }
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_task_schedules WHERE tenant_id = 'tenant_worker_coverage' AND subject_user_id = 'user_worker_coverage'"
    )?.count, BACKGROUND_TASK_KINDS.length);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE tenant_id = 'tenant_worker_coverage' AND subject_user_id = 'user_worker_coverage'"
    )?.count, BACKGROUND_TASK_KINDS.length);
    assert.deepEqual(await store.deploymentStatus("standalone", DEPLOYMENT_FINGERPRINT, NOW + 1), {
      state: "running",
      healthy: true,
      runtimeKind: "standalone",
      lastHeartbeatAt: new Date(NOW).toISOString(),
      lastErrorCode: "",
      coveredPrincipals: 2,
      totalPrincipals: 2,
      deploymentAttested: true,
      deploymentContractVersion: 1
    });
    await store.stopWorker("background_worker_store_test", "standalone", "", NOW + 2);
    const stopped = await store.deploymentStatus("standalone", DEPLOYMENT_FINGERPRINT, NOW + 3);
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.healthy, false);
    assert.equal(stopped.lastErrorCode, "worker_stopped");
  } finally {
    db.close();
  }
});

test("standalone deployment health treats an expired running heartbeat as stopped", async () => {
  const db = new YoinkDatabase();
  try {
    const store = new SqliteBackgroundWorkerStore(db, { principalMode: "all" });
    store.configureDeploymentExpectation("external", DEPLOYMENT_FINGERPRINT, "store-test", NOW - 1);
    await store.heartbeat(context("tenant_local", "user_local", "background_worker_stale_test"), "", NOW);
    const stale = await store.deploymentStatus("standalone", DEPLOYMENT_FINGERPRINT, NOW + 30_001);
    assert.equal(stale.state, "stopped");
    assert.equal(stale.healthy, false);
    assert.equal(stale.coveredPrincipals, 0);
    assert.equal(stale.lastErrorCode, "worker_stopped");
  } finally {
    db.close();
  }
});

test("standalone work and health fail closed on a deployment attestation mismatch", async () => {
  const db = new YoinkDatabase();
  try {
    const store = new SqliteBackgroundWorkerStore(db, { principalMode: "all" });
    store.configureDeploymentExpectation("external", DEPLOYMENT_FINGERPRINT, "store-test", NOW - 2);
    store.configureDeploymentExpectation("external", DEPLOYMENT_FINGERPRINT, "store-test", NOW - 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_worker_deployment_events"
    )?.count, 1, "an unchanged API startup must not flood attestation history");

    const mismatched = {
      ...context("tenant_local", "user_local", "background_worker_mismatch_test"),
      deploymentFingerprint: "b".repeat(64)
    };
    await assert.rejects(() => store.ensureSchedules(mismatched, NOW), /does not match/);
    await store.heartbeat(mismatched, "worker_deployment_mismatch", NOW);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_task_schedules"
    )?.count, 0);
    const status = await store.deploymentStatus("standalone", DEPLOYMENT_FINGERPRINT, NOW + 1);
    assert.equal(status.state, "running");
    assert.equal(status.healthy, false);
    assert.equal(status.deploymentAttested, false);
    assert.equal(status.lastErrorCode, "worker_deployment_mismatch");

    store.configureDeploymentExpectation("embedded", DEPLOYMENT_FINGERPRINT, "store-test", NOW + 2);
    await assert.rejects(
      () => store.ensureSchedules(context("tenant_local", "user_local", "background_worker_wrong_mode"), NOW + 3),
      /does not match/
    );
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_worker_deployment_events"
    )?.count, 2);
    const wrongMode = await store.deploymentStatus("standalone", DEPLOYMENT_FINGERPRINT, NOW + 3);
    assert.equal(wrongMode.healthy, false);
    assert.equal(wrongMode.lastErrorCode, "worker_deployment_expectation_mismatch");

    assert.throws(() => db.run(
      "UPDATE background_worker_deployment_events SET reason_code = 'changed' WHERE sequence = 1"
    ), /append-only/);
  } finally {
    db.close();
  }
});
