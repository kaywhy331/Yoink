import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { BackgroundTaskRepository } from "../packages/database/src/background-task-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope } from "../packages/database/src/request-scope.js";

test("the admin worker API exposes safe controls without lease capability material", async () => {
  const db = new YoinkDatabase();
  const tasks = new BackgroundTaskRepository(db);
  const now = Date.now();
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
      lastErrorCode: ""
    })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(health.durableBackgroundTasks, true);
    assert.equal(health.backgroundWorkerRuntime, "running");
    assert.equal(health.backgroundWorkerHealthy, true);
    assert.equal(health.productionWorkerFleetReady, false);

    const initialResponse = await fetch(`${baseUrl}/api/v1/admin/workers`);
    assert.equal(initialResponse.status, 200);
    assert.equal(initialResponse.headers.get("x-yoink-api-surface"), "admin");
    const initial = await initialResponse.json() as {
      backgroundWork: {
        containsCapabilityMaterial: boolean;
        successfulHistoryRetentionDays: number;
        canManage: boolean;
        schedules: Array<{ id: string; enabled: boolean }>;
      };
    };
    assert.equal(initial.backgroundWork.containsCapabilityMaterial, false);
    assert.equal(initial.backgroundWork.successfulHistoryRetentionDays, 30);
    assert.equal((initial.backgroundWork as { executionBoundary?: string }).executionBoundary, "outside_request_handler");
    assert.equal(initial.backgroundWork.canManage, true);
    assert.equal(initial.backgroundWork.schedules.length, 5);
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

    const page = await fetch(`${baseUrl}/admin`).then((response) => response.text());
    const script = await fetch(`${baseUrl}/app.js`).then((response) => response.text());
    assert.match(page, /Durable maintenance/);
    assert.match(page, /Closed maintenance tasks only/);
    assert.match(script, /renderBackgroundWork/);
    assert.match(script, /data-worker-task-retry/);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
