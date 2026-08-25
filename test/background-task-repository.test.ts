import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BackgroundTaskRepository } from "../packages/database/src/background-task-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-25T08:00:00.000Z").getTime();

function workerScope(tenantId = LOCAL_TENANT_ID, userId = LOCAL_USER_ID, workerId = "background_worker_test"): RequestScope {
  return { tenantId, userId, actorKind: "service", actorId: workerId };
}

function seedPrincipal(db: YoinkDatabase, tenantId: string, userId: string): void {
  const timestamp = new Date(NOW).toISOString();
  db.run("INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)", tenantId, tenantId, timestamp);
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)", userId, tenantId, userId, timestamp);
}

test("durable background schedules enqueue once and leases use one-use capability hashes", () => {
  const db = new YoinkDatabase();
  try {
    const tasks = new BackgroundTaskRepository(db);
    runWithRequestScope(workerScope(), () => {
      assert.equal(tasks.ensureDefaultSchedules(NOW).length, 5);
      assert.equal(tasks.enqueueDueSchedules(NOW), 5);
      assert.equal(tasks.enqueueDueSchedules(NOW), 0);
      const lease = tasks.leaseNext("background_worker_a", 60, NOW + 1);
      assert.ok(lease);
      assert.match(lease.capabilityToken, /^[A-Za-z0-9_-]{43}$/);
      const stored = db.get<{ capabilityHash: string }>(
        "SELECT lease_capability_hash AS capabilityHash FROM background_tasks WHERE id = ?",
        lease.id
      );
      assert.match(stored?.capabilityHash ?? "", /^[a-f0-9]{64}$/);
      assert.notEqual(stored?.capabilityHash, lease.capabilityToken);
      const completed = tasks.complete(lease.id, lease.capabilityToken, { handled: 1, safe: true }, NOW + 2);
      assert.equal(completed.state, "succeeded");
      assert.deepEqual(completed.result, { handled: 1, safe: true });
      assert.throws(
        () => tasks.complete(lease.id, lease.capabilityToken, { handled: 1 }, NOW + 3),
        /invalid or expired/
      );
      assert.throws(
        () => tasks.complete(lease.id, "x".repeat(43), { accessToken: "forbidden" }, NOW + 3),
        /forbidden field/
      );
      assert.throws(
        () => db.run("UPDATE background_task_events SET reason_code = 'tampered'"),
        /append-only/
      );
    });
    const snapshot = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => tasks.snapshot(NOW + 3));
    assert.equal(snapshot.durable, true);
    assert.equal(snapshot.containsCapabilityMaterial, false);
    assert.equal(snapshot.counts.schedules, 5);
    assert.equal(snapshot.counts.succeededTasks, 1);
    assert.equal(JSON.stringify(snapshot).includes("containsCapabilityMaterial"), true);
    assert.equal(JSON.stringify(snapshot).includes("capabilityToken"), false);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("two database connections contend safely and an expired lease is recovered with a new capability", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-background-contention-"));
  const file = join(directory, "yoink.sqlite");
  const firstDb = new YoinkDatabase(file);
  const secondDb = new YoinkDatabase(file);
  try {
    const first = new BackgroundTaskRepository(firstDb);
    const second = new BackgroundTaskRepository(secondDb);
    const schedule = runWithRequestScope(workerScope(), () => first.ensureDefaultSchedules(NOW)[0]);
    assert.ok(schedule);
    firstDb.run("UPDATE background_task_schedules SET next_run_at = ?", new Date(NOW + 86_400_000).toISOString());
    const task = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => first.enqueueScheduleNow(schedule.id, "request_run_once_001", NOW));

    const originalLease = runWithRequestScope(workerScope(), () => first.leaseNext("background_worker_a", 15, NOW + 1));
    assert.ok(originalLease);
    assert.equal(runWithRequestScope(workerScope(), () => second.leaseNext("background_worker_b", 15, NOW + 2)), null);

    const recoveredLease = runWithRequestScope(workerScope(), () => second.leaseNext("background_worker_b", 15, NOW + 16_001));
    assert.ok(recoveredLease);
    assert.equal(recoveredLease.id, task.id);
    assert.equal(recoveredLease.attemptCount, 2);
    assert.notEqual(recoveredLease.capabilityToken, originalLease.capabilityToken);
    assert.throws(
      () => runWithRequestScope(workerScope(), () => first.complete(task.id, originalLease.capabilityToken, {}, NOW + 16_002)),
      /invalid or expired/
    );
    const completed = runWithRequestScope(workerScope(), () => second.complete(task.id, recoveredLease.capabilityToken, { recovered: true }, NOW + 16_003));
    assert.equal(completed.state, "succeeded");
    assert.deepEqual(
      firstDb.all<{ eventType: string }>(
        "SELECT event_type AS eventType FROM background_task_events WHERE task_id = ? ORDER BY sequence",
        task.id
      ).map((event) => event.eventType),
      ["scheduled", "leased", "leased", "succeeded"]
    );
  } finally {
    secondDb.close();
    firstDb.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("background work remains tenant and user scoped", () => {
  const db = new YoinkDatabase();
  try {
    seedPrincipal(db, "tenant_background_second", "user_background_second");
    const tasks = new BackgroundTaskRepository(db);
    const localLease = runWithRequestScope(workerScope(), () => {
      tasks.ensureDefaultSchedules(NOW);
      tasks.enqueueDueSchedules(NOW);
      tasks.heartbeat("background_worker_local", "local_in_process", "test", "", NOW);
      return tasks.leaseNext("background_worker_local", 60, NOW + 1);
    });
    const secondLease = runWithRequestScope(
      workerScope("tenant_background_second", "user_background_second", "background_worker_second"),
      () => {
        tasks.ensureDefaultSchedules(NOW);
        tasks.enqueueDueSchedules(NOW);
        tasks.heartbeat("background_worker_second", "standalone", "test", "", NOW);
        return tasks.leaseNext("background_worker_second", 60, NOW + 1);
      }
    );
    assert.ok(localLease);
    assert.ok(secondLease);
    assert.notEqual(localLease.id, secondLease.id);
    assert.throws(
      () => runWithRequestScope(workerScope(), () => tasks.complete(secondLease.id, secondLease.capabilityToken, {}, NOW + 2)),
      /invalid or expired/
    );
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE tenant_id = ? AND subject_user_id = ?",
      LOCAL_TENANT_ID,
      LOCAL_USER_ID
    )?.count, 5);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE tenant_id = 'tenant_background_second' AND subject_user_id = 'user_background_second'"
    )?.count, 5);
    const localSnapshot = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => tasks.snapshot(NOW + 2));
    assert.equal(localSnapshot.counts.onlineWorkers, 1);
    assert.deepEqual(localSnapshot.workers.map((worker) => worker.workerId), ["background_worker_local"]);
  } finally {
    db.close();
  }
});

test("append-only task history cascades only with its owning user lifecycle", () => {
  const db = new YoinkDatabase();
  try {
    const tenantId = "tenant_background_lifecycle";
    const userId = "user_background_lifecycle";
    seedPrincipal(db, tenantId, userId);
    const tasks = new BackgroundTaskRepository(db);
    runWithRequestScope(workerScope(tenantId, userId), () => {
      tasks.ensureDefaultSchedules(NOW);
      tasks.enqueueDueSchedules(NOW);
      tasks.heartbeat("background_worker_lifecycle", "standalone", "test", "", NOW);
    });
    assert.throws(
      () => db.run(
        "DELETE FROM background_task_events WHERE tenant_id = ? AND subject_user_id = ?",
        tenantId,
        userId
      ),
      /append-only/
    );
    db.run("DELETE FROM users WHERE id = ? AND tenant_id = ?", userId, tenantId);
    for (const table of [
      "background_task_schedules",
      "background_tasks",
      "background_task_events",
      "background_worker_heartbeats"
    ]) {
      assert.equal(db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?`,
        tenantId
      )?.count, 0);
    }
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("successful task history is retained for 30 days and then pruned without deleting live work", () => {
  const db = new YoinkDatabase();
  try {
    const tasks = new BackgroundTaskRepository(db);
    const now = Date.now();
    const oldNow = now - 31 * 24 * 60 * 60_000;
    const completed = runWithRequestScope(workerScope(), () => {
      tasks.ensureDefaultSchedules(oldNow);
      tasks.enqueueDueSchedules(oldNow);
      const lease = tasks.leaseNext("background_worker_retention", 60, oldNow + 1);
      assert.ok(lease);
      return tasks.complete(lease.id, lease.capabilityToken, { handled: 0 }, oldNow + 2);
    });
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_task_events WHERE task_id = ?",
      completed.id
    )?.count, 3);
    const pending = db.get<{ id: string }>("SELECT id FROM background_tasks WHERE state = 'pending' ORDER BY id LIMIT 1");
    assert.ok(pending);
    assert.throws(() => db.run("DELETE FROM background_tasks WHERE id = ?", pending.id), /retained until bounded cleanup/);
    const pruned = runWithRequestScope(workerScope(), () => tasks.pruneCompletedHistory(now));
    assert.equal(pruned.deletedTaskRuns, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE id = ?",
      completed.id
    )?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_task_events WHERE task_id = ?",
      completed.id
    )?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE state = 'pending'"
    )?.count, 4);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("repeated failures stop in dead letter and require an audited manual retry", () => {
  const db = new YoinkDatabase();
  try {
    const tasks = new BackgroundTaskRepository(db);
    const schedule = runWithRequestScope(workerScope(), () => tasks.ensureDefaultSchedules(NOW)[0]);
    assert.ok(schedule);
    db.run("UPDATE background_task_schedules SET next_run_at = ?", new Date(NOW + 86_400_000).toISOString());
    const task = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => tasks.enqueueScheduleNow(schedule.id, "request_dead_letter_001", NOW));
    let at = NOW + 1;
    for (let attempt = 1; attempt <= task.maximumAttempts; attempt += 1) {
      const lease = runWithRequestScope(workerScope(), () => tasks.leaseNext("background_worker_failure_loop", 60, at));
      assert.ok(lease);
      assert.equal(lease.id, task.id);
      const failed = runWithRequestScope(workerScope(), () => tasks.fail(task.id, lease.capabilityToken, "fixture_failure", 1, at + 1));
      assert.equal(failed.state, attempt === task.maximumAttempts ? "dead_letter" : "retry_wait");
      at += 2_000;
    }
    assert.equal(runWithRequestScope(workerScope(), () => tasks.leaseNext("background_worker_failure_loop", 60, at)), null);
    const retried = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => tasks.retryDeadLetter(task.id, "request_dead_letter_retry_001", at));
    assert.equal(retried.state, "pending");
    assert.equal(retried.attemptCount, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'background_task_retried'"
    )?.count, 1);
    assert.equal(db.get<{ workerId: string }>(
      "SELECT worker_id AS workerId FROM background_task_events WHERE task_id = ? AND event_type = 'manually_retried'",
      task.id
    )?.workerId, "operator");
  } finally {
    db.close();
  }
});
