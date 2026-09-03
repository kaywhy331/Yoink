import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { SIGNAL_INGRESS_EVENT_TYPE } from "../packages/contracts/src/signal-ingress.js";
import { BACKGROUND_TASK_KINDS } from "../packages/domain/src/background-task.js";
import { BackgroundTaskRepository } from "../packages/database/src/background-task-repository.js";
import { HostedDeliveryRepository } from "../packages/database/src/hosted-delivery-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope } from "../packages/database/src/request-scope.js";

test("the admin worker API exposes safe controls without lease capability material", async () => {
  const db = new YoinkDatabase();
  const tasks = new BackgroundTaskRepository(db);
  const now = Date.now();
  let restartCount = 0;
  const schedules = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => tasks.ensureDefaultSchedules(now));
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "background-worker-api-test",
    backgroundWorkerStatus: () => ({
      state: "running",
      healthy: true,
      runtimeKind: "local_in_process",
      lastHeartbeatAt: new Date().toISOString(),
      lastErrorCode: "",
      deploymentAttested: true,
      deploymentContractVersion: 3
    }),
    backgroundWorkerRestart: async () => { restartCount += 1; }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(health.durableBackgroundTasks, true);
    assert.equal(health.durableSignalIngress, true);
    assert.equal(health.signalEvaluationOutsideDeviceRequest, true);
    assert.equal(health.durableObserverRepairCandidateEvaluation, true);
    assert.equal(health.generatedObserverRepairCandidatesExecutable, false);
    assert.equal(health.generatedObserverRepairCandidatesAutoPromoted, false);
    assert.equal(health.durableObserverRecipeWitnessRefresh, true);
    assert.equal(health.observerRecipeWitnessRefreshConfigured, false);
    assert.equal(health.standaloneWitnessRefreshLoadsSigningKeys, false);
    assert.equal(health.backgroundWorkerRuntime, "running");
    assert.equal(health.backgroundWorkerHealthy, true);
    assert.equal(health.backgroundWorkerMode, "embedded");
    assert.equal(health.backgroundWorkerDeploymentAttested, true);
    assert.equal(health.backgroundWorkerDeploymentContractVersion, 3);
    assert.equal(health.asyncBackgroundWorkerContract, true);
    assert.equal(health.standaloneBackgroundWorkerProcessReady, true);
    assert.equal(health.productionWorkerFleetReady, false);

    const userHealthResponse = await fetch(`${baseUrl}/api/v1/user/health`);
    assert.equal(userHealthResponse.status, 200);
    assert.equal(userHealthResponse.headers.get("x-yoink-api-surface"), "user");
    const userHealth = await userHealthResponse.json() as {
      contractVersion: number;
      version: string;
      worker: { state: string; healthy: boolean; lastHeartbeatAt: string };
      counts: { onlineDevices: number; watchQueue: number; sourceAttention: number; connectorFailures: number };
      diagnosticBundle: Record<string, unknown>;
    };
    assert.equal(userHealth.contractVersion, 1);
    assert.equal(userHealth.version, "background-worker-api-test");
    assert.equal(userHealth.worker.state, "running");
    assert.equal(userHealth.worker.healthy, true);
    assert.deepEqual({
      containsSecrets: userHealth.diagnosticBundle.containsSecrets,
      containsUrls: userHealth.diagnosticBundle.containsUrls,
      containsDom: userHealth.diagnosticBundle.containsDom,
      containsAccountOrPaymentData: userHealth.diagnosticBundle.containsAccountOrPaymentData
    }, {
      containsSecrets: false,
      containsUrls: false,
      containsDom: false,
      containsAccountOrPaymentData: false
    });
    assert.equal(JSON.stringify(userHealth).includes("capabilityToken"), false);

    const initialResponse = await fetch(`${baseUrl}/api/v1/admin/workers`);
    assert.equal(initialResponse.status, 200);
    assert.equal(initialResponse.headers.get("x-yoink-api-surface"), "admin");
    const initial = await initialResponse.json() as {
      backgroundWork: {
        containsCapabilityMaterial: boolean;
        asyncPersistenceContract: boolean;
        standaloneProcessCompatible: boolean;
        boundedPrincipalPagination: boolean;
        successfulHistoryRetentionDays: number;
        canManage: boolean;
        deployment: {
          state: string;
          healthy: boolean;
          runtimeKind: string;
          mode: string;
          lastHeartbeatAt: string;
          attested: boolean;
          contractVersion: number;
          lastErrorCode: string;
        };
        schedules: Array<{ id: string; taskKind: string; enabled: boolean }>;
        signalIngress: {
          eventType: string;
          accepted: number;
          processing: number;
          failed: number;
          processed: number;
          deadLetter: number;
          total: number;
        };
        signalDeadLetters: Array<{ id: string; attempt: number; lastErrorCode: string }>;
      };
    };
    assert.equal(initial.backgroundWork.containsCapabilityMaterial, false);
    assert.equal(initial.backgroundWork.asyncPersistenceContract, true);
    assert.equal(initial.backgroundWork.standaloneProcessCompatible, true);
    assert.equal(initial.backgroundWork.boundedPrincipalPagination, true);
    assert.equal(initial.backgroundWork.successfulHistoryRetentionDays, 30);
    assert.equal((initial.backgroundWork as { executionBoundary?: string }).executionBoundary, "outside_request_handler");
    assert.equal(initial.backgroundWork.canManage, true);
    assert.deepEqual(initial.backgroundWork.deployment, {
      state: "running",
      healthy: true,
      runtimeKind: "local_in_process",
      mode: "embedded",
      lastHeartbeatAt: initial.backgroundWork.deployment.lastHeartbeatAt,
      lastErrorCode: "",
      attested: true,
      contractVersion: 3
    });
    assert.equal(initial.backgroundWork.schedules.length, BACKGROUND_TASK_KINDS.length);
    assert.equal(initial.backgroundWork.schedules.some(
      (schedule) => schedule.taskKind === "observer_recipe_candidate_evaluation" && schedule.enabled
    ), true);
    assert.equal(initial.backgroundWork.schedules.some(
      (schedule) => schedule.taskKind === "observer_recipe_witness_refresh" && schedule.enabled
    ), true);
    assert.deepEqual(initial.backgroundWork.signalIngress, {
      eventType: "signal_event_v1",
      accepted: 0,
      processing: 0,
      failed: 0,
      processed: 0,
      deadLetter: 0,
      total: 0
    });
    assert.deepEqual(initial.backgroundWork.signalDeadLetters, []);
    assert.equal(JSON.stringify(initial).includes("capabilityToken"), false);

    const schedule = schedules[0];
    assert.ok(schedule);
    const paused = await fetch(`${baseUrl}/api/v1/admin/workers/schedules/${encodeURIComponent(schedule.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(paused.status, 200);
    assert.equal((await paused.json() as { schedule: { enabled: boolean } }).schedule.enabled, false);

    const resumed = await fetch(`${baseUrl}/api/v1/admin/workers/schedules/${encodeURIComponent(schedule.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ enabled: true, intervalSeconds: 45 })
    });
    assert.equal(resumed.status, 200);
    const resumedSchedule = (await resumed.json() as {
      schedule: { enabled: boolean; intervalSeconds: number };
    }).schedule;
    assert.equal(resumedSchedule.enabled, true);
    assert.equal(resumedSchedule.intervalSeconds, 45);

    const run = await fetch(`${baseUrl}/api/v1/admin/workers/schedules/${encodeURIComponent(schedule.id)}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(run.status, 202);
    const queued = await run.json() as { task: { id: string; state: string } };
    assert.equal(queued.task.state, "pending");
    db.run(
      `UPDATE background_tasks SET state = 'dead_letter', attempt_count = maximum_attempts,
         last_error_code = 'fixture_exhausted', completed_at = ?, updated_at = ? WHERE id = ?`,
      new Date(now + 1).toISOString(),
      new Date(now + 1).toISOString(),
      queued.task.id
    );
    const retried = await fetch(`${baseUrl}/api/v1/admin/workers/tasks/${encodeURIComponent(queued.task.id)}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(retried.status, 202);
    const retriedTask = (await retried.json() as { task: { state: string; attemptCount: number } }).task;
    assert.equal(retriedTask.state, "pending");
    assert.equal(retriedTask.attemptCount, 0);
    assert.ok(Number(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type IN ('background_schedule_updated', 'background_task_requested', 'background_task_retried')"
    )?.count ?? 0) >= 3);

    const delivery = new HostedDeliveryRepository(db);
    const deadLetter = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => delivery.acceptInbox({
      source: "trackalacker",
      messageKey: "worker-api:dead-signal:1",
      eventType: SIGNAL_INGRESS_EVENT_TYPE,
      payload: { parserVersion: "trackalacker-push-v1" }
    }, now + 2));
    db.run(
      "UPDATE inbox_messages SET state = 'dead_letter', delivery_attempts = 20, last_error_code = 'signal_processing_failed' WHERE id = ?",
      deadLetter.id
    );
    const withDeadLetter = await fetch(`${baseUrl}/api/v1/admin/workers`).then((response) => response.json()) as {
      backgroundWork: { signalDeadLetters: Array<{ id: string; attempt: number; lastErrorCode: string }> };
    };
    assert.deepEqual(withDeadLetter.backgroundWork.signalDeadLetters.map((item) => ({ ...item })), [{
      id: deadLetter.id,
      eventType: SIGNAL_INGRESS_EVENT_TYPE,
      attempt: 20,
      lastErrorCode: "signal_processing_failed",
      receivedAt: new Date(now + 2).toISOString(),
      updatedAt: new Date(now + 2).toISOString(),
      privacyClassification: "operational_aggregate"
    }]);
    const signalRetry = await fetch(`${baseUrl}/api/v1/admin/workers/signal-inbox/${encodeURIComponent(deadLetter.id)}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(signalRetry.status, 202);
    assert.equal((await signalRetry.json() as { receipt: { backgroundWakeState: string } }).receipt.backgroundWakeState, "created");
    const repeatedSignalRetry = await fetch(`${baseUrl}/api/v1/admin/workers/signal-inbox/${encodeURIComponent(deadLetter.id)}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(repeatedSignalRetry.status, 409);
    assert.equal((await repeatedSignalRetry.json() as { error: string }).error, "hosted_inbox_state_conflict");

    const restarted = await fetch(`${baseUrl}/api/v1/admin/workers/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(restarted.status, 200);
    assert.equal(restartCount, 1);
    const restartedBody = await restarted.json() as {
      restarted: boolean;
      worker: { state: string; healthy: boolean; runtimeKind: string; lastHeartbeatAt: string };
    };
    assert.equal(restartedBody.restarted, true);
    assert.equal(restartedBody.worker.state, "running");
    assert.equal(restartedBody.worker.healthy, true);
    assert.equal(restartedBody.worker.runtimeKind, "local_in_process");
    assert.ok(Number.isFinite(new Date(restartedBody.worker.lastHeartbeatAt).getTime()));

    const page = await fetch(`${baseUrl}/admin`).then((response) => response.text());
    const script = await fetch(`${baseUrl}/app.js`).then((response) => response.text());
    assert.match(page, /Durable maintenance/);
    assert.match(page, /Background work totals/);
    assert.match(page, /Recovery queue/);
    assert.match(script, /renderBackgroundWork/);
    assert.match(script, /data-worker-task-retry/);
    assert.match(script, /data-signal-inbox-retry/);
    assert.match(script, /deploymentMismatch \|\| activeProblems \? "Attention"/);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
