import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { BackgroundWorkerRuntime } from "../apps/api/src/background-worker-runtime.js";
import type { BackgroundTaskKind } from "../packages/domain/src/background-task.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

const NOW = new Date("2026-08-25T09:00:00.000Z").getTime();

test("the local worker executes every due idempotent maintenance handler outside the request lifecycle", () => {
  const db = new YoinkDatabase();
  try {
    const runtime = new BackgroundWorkerRuntime({
      db,
      version: "runtime-test",
      workerId: "background_worker_runtime_test",
      maximumTasksPerCycle: 20
    });
    const cycle = runtime.runOnce(NOW);
    assert.deepEqual(cycle, { enqueued: 5, leased: 5, succeeded: 5, failed: 0 });
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE state = 'succeeded'"
    )?.count, 5);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE state IN ('leased', 'retry_wait', 'dead_letter')"
    )?.count, 0);
    const retentionResult = JSON.parse(db.get<{ resultJson: string }>(
      "SELECT result_json AS resultJson FROM background_tasks WHERE task_kind = 'operational_telemetry_retention'"
    )?.resultJson ?? "{}") as Record<string, unknown>;
    assert.equal(retentionResult.deletedTaskRuns, 0);
    assert.match(String(retentionResult.taskHistoryCutoffAt), /^\d{4}-\d{2}-\d{2}T/);
    const second = runtime.runOnce(NOW + 1_000);
    assert.deepEqual(second, { enqueued: 0, leased: 0, succeeded: 0, failed: 0 });
    assert.equal(runtime.status(NOW + 1_000).tasksSucceeded, 5);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("handler failures retry durably without persisting exception text", () => {
  const db = new YoinkDatabase();
  try {
    const handler = {
      execute(_taskKind: BackgroundTaskKind): never {
        throw new Error("secret checkout text must never be persisted");
      }
    };
    const runtime = new BackgroundWorkerRuntime({
      db,
      version: "runtime-failure-test",
      workerId: "background_worker_failure_test",
      handler,
      maximumTasksPerCycle: 20
    });
    const cycle = runtime.runOnce(NOW);
    assert.deepEqual(cycle, { enqueued: 5, leased: 5, succeeded: 0, failed: 5 });
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE state = 'retry_wait' AND last_error_code = 'background_handler_failed'"
    )?.count, 5);
    assert.equal(JSON.stringify(db.all("SELECT * FROM background_tasks")).includes("secret checkout"), false);
    assert.equal(runtime.status(NOW).lastErrorCode, "background_handler_failed");
  } finally {
    db.close();
  }
});

test("runtime start and stop publish an observable heartbeat lifecycle", async () => {
  const db = new YoinkDatabase();
  try {
    const startedAt = Date.now();
    const runtime = new BackgroundWorkerRuntime({
      db,
      version: "heartbeat-test",
      workerId: "background_worker_heartbeat_test",
      pollIntervalMs: 60_000
    });
    runtime.start(startedAt);
    await nextTurn();
    assert.equal(runtime.status(Date.now()).state, "running");
    assert.equal(runtime.status(Date.now()).healthy, true);
    assert.equal(db.get<{ state: string }>(
      "SELECT state FROM background_worker_heartbeats WHERE worker_id = 'background_worker_heartbeat_test'"
    )?.state, "running");
    runtime.stop(Date.now());
    assert.equal(runtime.status(Date.now()).state, "stopped");
    assert.equal(db.get<{ state: string; stoppedAt: string }>(
      `SELECT state, stopped_at AS stoppedAt FROM background_worker_heartbeats
       WHERE worker_id = 'background_worker_heartbeat_test'`
    )?.state, "stopped");
  } finally {
    db.close();
  }
});
