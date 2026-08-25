import assert from "node:assert/strict";
import test from "node:test";
import type {
  BackgroundWorkerContext,
  BackgroundWorkerTaskHandler
} from "../packages/contracts/src/background-worker.js";
import { BACKGROUND_TASK_KINDS, type BackgroundTaskKind } from "../packages/domain/src/background-task.js";
import { SqliteBackgroundWorkerStore } from "../packages/database/src/background-worker-store.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { BackgroundMaintenanceHandler } from "../packages/engine/src/background-maintenance.js";
import { BackgroundWorkerRuntime } from "../packages/engine/src/background-worker-runtime.js";

const NOW = new Date("2026-08-25T09:00:00.000Z").getTime();

function runtimeFor(
  db: YoinkDatabase,
  options: {
    handler?: BackgroundWorkerTaskHandler;
    principalMode?: "fixed" | "all";
    maximumPrincipalsPerCycle?: number;
    maximumTasksPerCycle?: number;
  } = {}
): { runtime: BackgroundWorkerRuntime; store: SqliteBackgroundWorkerStore } {
  const store = new SqliteBackgroundWorkerStore(db, { principalMode: options.principalMode ?? "fixed" });
  return {
    store,
    runtime: new BackgroundWorkerRuntime({
      store,
      handler: options.handler ?? new BackgroundMaintenanceHandler(db),
      version: "runtime-test",
      workerId: "background_worker_runtime_test",
      ...(options.maximumPrincipalsPerCycle !== undefined
        ? { maximumPrincipalsPerCycle: options.maximumPrincipalsPerCycle }
        : {}),
      maximumTasksPerCycle: options.maximumTasksPerCycle ?? 20
    })
  };
}

test("the async runtime executes every due idempotent maintenance handler outside the request lifecycle", async () => {
  const db = new YoinkDatabase();
  try {
    const { runtime } = runtimeFor(db);
    const cycle = await runtime.runOnce(NOW);
    assert.deepEqual(cycle, {
      principalsVisited: 1,
      enqueued: BACKGROUND_TASK_KINDS.length,
      leased: BACKGROUND_TASK_KINDS.length,
      succeeded: BACKGROUND_TASK_KINDS.length,
      failed: 0,
      uncertainTransitions: 0,
      principalFailures: 0
    });
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE state = 'succeeded'"
    )?.count, BACKGROUND_TASK_KINDS.length);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE state IN ('leased', 'retry_wait', 'dead_letter')"
    )?.count, 0);
    const retentionResult = JSON.parse(db.get<{ resultJson: string }>(
      "SELECT result_json AS resultJson FROM background_tasks WHERE task_kind = 'operational_telemetry_retention'"
    )?.resultJson ?? "{}") as Record<string, unknown>;
    assert.equal(retentionResult.deletedTaskRuns, 0);
    assert.match(String(retentionResult.taskHistoryCutoffAt), /^\d{4}-\d{2}-\d{2}T/);
    const witnessResult = JSON.parse(db.get<{ resultJson: string }>(
      "SELECT result_json AS resultJson FROM background_tasks WHERE task_kind = 'observer_recipe_witness_refresh'"
    )?.resultJson ?? "{}") as Record<string, unknown>;
    assert.deepEqual(witnessResult, {
      witnessConfigured: false,
      checkpointReady: false,
      refreshAttempted: false,
      receiptAccepted: false,
      deliveryAllowed: true,
      witnessState: "disabled",
      witnessSequence: 0
    });
    const second = await runtime.runOnce(NOW + 1_000);
    assert.equal(second.enqueued, 0);
    assert.equal(second.leased, 0);
    assert.equal(runtime.status(NOW + 1_000).tasksSucceeded, BACKGROUND_TASK_KINDS.length);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("the maintenance handler awaits the configured witness refresh service", async () => {
  const db = new YoinkDatabase();
  try {
    let calls = 0;
    const handler = new BackgroundMaintenanceHandler(db, {
      observerRecipeWitnessRefresh: {
        async execute(now) {
          calls += 1;
          return {
            witnessConfigured: true,
            checkpointReady: true,
            refreshAttempted: true,
            receiptAccepted: true,
            deliveryAllowed: true,
            witnessState: "healthy",
            witnessSequence: now === NOW ? 2 : 0
          };
        }
      }
    });
    const result = await handler.execute({
      principal: { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID },
      workerId: "background_worker_witness_test",
      runtimeKind: "standalone",
      runtimeVersion: "witness-test"
    }, "observer_recipe_witness_refresh", NOW);
    assert.equal(calls, 1);
    assert.deepEqual(result, {
      witnessConfigured: true,
      checkpointReady: true,
      refreshAttempted: true,
      receiptAccepted: true,
      deliveryAllowed: true,
      witnessState: "healthy",
      witnessSequence: 2
    });
  } finally {
    db.close();
  }
});

test("handler failures retry durably without persisting exception text", async () => {
  const db = new YoinkDatabase();
  try {
    const handler: BackgroundWorkerTaskHandler = {
      async execute(_context: BackgroundWorkerContext, _taskKind: BackgroundTaskKind): Promise<never> {
        throw new Error("secret checkout text must never be persisted");
      }
    };
    const { runtime } = runtimeFor(db, { handler });
    const cycle = await runtime.runOnce(NOW);
    assert.equal(cycle.failed, BACKGROUND_TASK_KINDS.length);
    assert.equal(cycle.uncertainTransitions, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE state = 'retry_wait' AND last_error_code = 'background_handler_failed'"
    )?.count, BACKGROUND_TASK_KINDS.length);
    assert.equal(JSON.stringify(db.all("SELECT * FROM background_tasks")).includes("secret checkout"), false);
    assert.equal(runtime.status(NOW).lastErrorCode, "background_handler_failed");
  } finally {
    db.close();
  }
});

test("an ambiguous async completion never triggers a second failure transition", async () => {
  const db = new YoinkDatabase();
  try {
    const { runtime, store } = runtimeFor(db, { maximumTasksPerCycle: 1 });
    let failCalls = 0;
    store.complete = async () => {
      throw new Error("simulated acknowledgement loss");
    };
    store.fail = async () => {
      failCalls += 1;
    };
    const cycle = await runtime.runOnce(NOW);
    assert.equal(cycle.succeeded, 0);
    assert.equal(cycle.failed, 0);
    assert.equal(cycle.uncertainTransitions, 1);
    assert.equal(failCalls, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE state = 'leased'"
    )?.count, 1);
    assert.equal(runtime.status(NOW).lastErrorCode, "background_completion_uncertain");
    assert.equal(JSON.stringify(db.all("SELECT * FROM background_tasks")).includes("acknowledgement loss"), false);
  } finally {
    db.close();
  }
});

test("bounded pagination eventually runs every persisted principal without a queue sweep", async () => {
  const db = new YoinkDatabase();
  try {
    const timestamp = new Date(NOW).toISOString();
    db.run("INSERT INTO tenants(id, name, created_at) VALUES ('tenant_runtime_second', 'Second', ?)", timestamp);
    db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES ('user_runtime_second', 'tenant_runtime_second', 'Second', ?)", timestamp);
    const { runtime } = runtimeFor(db, {
      principalMode: "all",
      maximumPrincipalsPerCycle: 1,
      maximumTasksPerCycle: 5
    });
    const first = await runtime.runOnce(NOW);
    const second = await runtime.runOnce(NOW + 1);
    assert.equal(first.principalsVisited, 1);
    assert.equal(second.principalsVisited, 1);
    assert.equal(first.succeeded, 5);
    assert.equal(second.succeeded, 5);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE tenant_id = ? AND subject_user_id = ? AND state = 'succeeded'",
      LOCAL_TENANT_ID,
      LOCAL_USER_ID
    )?.count, 5);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE tenant_id = 'tenant_runtime_second' AND subject_user_id = 'user_runtime_second' AND state = 'succeeded'"
    )?.count, 5);
    assert.equal(runtime.status(NOW + 1).principalsVisited, 2);
  } finally {
    db.close();
  }
});

test("runtime start and stop publish an observable heartbeat lifecycle", async () => {
  const db = new YoinkDatabase();
  try {
    const startedAt = Date.now();
    const store = new SqliteBackgroundWorkerStore(db);
    const runtime = new BackgroundWorkerRuntime({
      store,
      handler: new BackgroundMaintenanceHandler(db),
      version: "heartbeat-test",
      workerId: "background_worker_heartbeat_test",
      pollIntervalMs: 60_000
    });
    await runtime.start(startedAt);
    assert.equal(runtime.status(Date.now()).state, "running");
    assert.equal(runtime.status(Date.now()).healthy, true);
    assert.equal(db.get<{ state: string }>(
      "SELECT state FROM background_worker_heartbeats WHERE worker_id = 'background_worker_heartbeat_test'"
    )?.state, "running");
    await runtime.stop(Date.now());
    assert.equal(runtime.status(Date.now()).state, "stopped");
    assert.equal(db.get<{ state: string; stoppedAt: string }>(
      `SELECT state, stopped_at AS stoppedAt FROM background_worker_heartbeats
       WHERE worker_id = 'background_worker_heartbeat_test'`
    )?.state, "stopped");
  } finally {
    db.close();
  }
});
