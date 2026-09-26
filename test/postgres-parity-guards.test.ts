import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import test from "node:test";
import type { Pool } from "pg";
import { NOTIFY_JOB_LIFETIME_SECONDS } from "../packages/domain/src/delivery-health.js";
import {
  POSTGRES_GRAPH_INVARIANT_SQLSTATE,
  POSTGRES_STALE_STATE_SQLSTATE,
  isRetryablePostgresConcurrencyError,
  logIdlePostgresClientErrors,
  retryPostgresConcurrencyFailures
} from "../packages/database/src/postgres-cutover.js";
import { PostgresBackgroundWorkerQualificationStore } from "../packages/database/src/postgres-background-worker-store.js";
import {
  buildPostgresSignalActionSpendApplyManifest,
  signalActionSpendApplyFunctionSource
} from "../packages/database/src/postgres-signal-action-spend-apply.js";
import {
  buildPostgresSignalPostIncidentDecisionApplyManifest,
  signalPostIncidentDecisionApplyFunctionSource
} from "../packages/database/src/postgres-signal-post-incident-decision-apply.js";

const SOURCE_DIRECTORY = join(import.meta.dirname, "..", "packages", "database", "src");
const postgresSources = readdirSync(SOURCE_DIRECTORY)
  .filter((name) => name.startsWith("postgres-") && name.endsWith(".ts"))
  .map((name) => ({ name, source: readFileSync(join(SOURCE_DIRECTORY, name), "utf8") }));

test("Yoink PL/pgSQL never raises PostgreSQL's retryable concurrency SQLSTATEs", () => {
  assert.ok(postgresSources.length > 40);
  for (const { name, source } of postgresSources) {
    assert.doesNotMatch(source, /ERRCODE = '(40001|40P01)'/, name);
  }
  const raised = postgresSources.flatMap(({ source }) => [...source.matchAll(/ERRCODE = '(YK\d{3})'/g)])
    .map((match) => match[1]);
  assert.ok(raised.includes(POSTGRES_STALE_STATE_SQLSTATE));
  assert.ok(raised.includes(POSTGRES_GRAPH_INVARIANT_SQLSTATE));
  assert.deepEqual([...new Set(raised)].sort(), [POSTGRES_STALE_STATE_SQLSTATE, POSTGRES_GRAPH_INVARIANT_SQLSTATE]);
});

test("only server-raised serialization failures and deadlocks are retried", async () => {
  const serverError = (code: string) => Object.assign(new Error("server"), { code, severity: "ERROR" });
  assert.equal(isRetryablePostgresConcurrencyError(serverError("40001")), true);
  assert.equal(isRetryablePostgresConcurrencyError(serverError("40P01")), true);
  assert.equal(isRetryablePostgresConcurrencyError(serverError("YK409")), false);
  assert.equal(isRetryablePostgresConcurrencyError(Object.assign(new Error("js"), { code: "40001" })), false);
  assert.equal(isRetryablePostgresConcurrencyError(null), false);

  const delays: number[] = [];
  let calls = 0;
  const value = await retryPostgresConcurrencyFailures(async () => {
    calls += 1;
    if (calls < 3) throw serverError(calls === 1 ? "40001" : "40P01");
    return "committed";
  }, { delay: async (attempt) => { delays.push(attempt); } });
  assert.equal(value, "committed");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1, 2]);

  calls = 0;
  await assert.rejects(retryPostgresConcurrencyFailures(async () => {
    calls += 1;
    throw serverError("40001");
  }, { delay: async () => undefined }), /server/);
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(retryPostgresConcurrencyFailures(async () => {
    calls += 1;
    throw serverError("YK500");
  }, { delay: async () => undefined }), /server/);
  assert.equal(calls, 1);
});

test("every PostgreSQL pool reports idle-client errors instead of crashing or hiding them", () => {
  for (const { name, source } of postgresSources) {
    assert.doesNotMatch(source, /pool\.on\("error", \(\) => undefined\)/, name);
    if (/new Pool\(/.test(source)) assert.match(source, /logIdlePostgresClientErrors\(this\.pool, /, name);
  }
  const pool = new EventEmitter();
  const lines: string[] = [];
  logIdlePostgresClientErrors(pool as unknown as Pool, "yoink_test_pool", (line) => lines.push(line));
  pool.emit("error", Object.assign(new Error("terminating connection password=secret"), { code: "57P01" }));
  pool.emit("error", new Error("socket closed"));
  assert.deepEqual(lines, [
    "PostgreSQL idle client error (yoink_test_pool): 57P01",
    "PostgreSQL idle client error (yoink_test_pool): unknown"
  ]);
});

test("the worker store refuses to run tenant work as the cutover role unless asked to", () => {
  const database = {} as ConstructorParameters<typeof PostgresBackgroundWorkerQualificationStore>[0];
  assert.throws(
    () => new PostgresBackgroundWorkerQualificationStore(database, "yoink_worker_test"),
    /requires the tenant queue-write and worker-control databases/
  );
  assert.ok(new PostgresBackgroundWorkerQualificationStore(database, "yoink_worker_test", {
    allowCutoverRoleFallback: true
  }));
  const source = postgresSources.find(({ name }) => name === "postgres-background-worker-store.ts")?.source ?? "";
  assert.match(source, /WHERE task_id = \$1 AND tenant_id = \$2/);
});

test("PostgreSQL notify jobs keep the SQLite notify lifetime while snapshots keep the signal window", () => {
  const source = signalActionSpendApplyFunctionSource(buildPostgresSignalActionSpendApplyManifest());
  assert.match(source, new RegExp(
    `IF effective_action_value = 'notify' THEN\\s+job_expires_at_value := pg_catalog\\.to_char\\(GREATEST\\(\\s+`
      + `expires_at_value::timestamptz,\\s+authorization_clock \\+ INTERVAL '${NOTIFY_JOB_LIFETIME_SECONDS} seconds'`
  ));
  assert.match(source, /job_expires_at_value, authorization_timestamp, authorization_timestamp,\s+policy_revision_id_value/);
  // The offer snapshot and the spend reservation stay on the signal window.
  assert.match(source, /offer_evidence_hash_value, observed_at_value, expires_at_value,/);
  assert.match(source, /'add_to_cart', 1, maximum_all_in_cents_value, 0, 'USD', 'active', '',\s+expires_at_value,/);
  assert.match(source, /expires_at_value := replay_record\.snapshot_expires_at;/);
});

test("PostgreSQL corroboration uses the SQLite jobForIncident predicate", () => {
  const source = signalPostIncidentDecisionApplyFunctionSource(buildPostgresSignalPostIncidentDecisionApplyManifest());
  const live = /job\.action <> 'notify'\s+AND job\.state NOT IN \('confirmed', 'expired', 'cancelled', 'offer_rejected', 'notify_only'\)\s+AND \(job\.state IN \('manual_review', 'submission_uncertain'\)\s+OR job\.expires_at::timestamptz > evaluation_clock\)/g;
  assert.equal([...source.matchAll(live)].length, 2);
  assert.match(source, /ORDER BY job\.created_at DESC, job\.id DESC\s+LIMIT 1;/);
  assert.doesNotMatch(source, /action_job_count > 1/);
});

test("no PostgreSQL writer leases notifications without stamping the device poll receipt", () => {
  // SQLite stamps extension_devices.last_notification_poll_at inside every
  // notification lease (I2). postgres-notification-recovery reads that column
  // to tell `no_device_poll` from `job_window_expired`, so a PostgreSQL lease
  // writer that skips the stamp would mislabel every expiry.
  for (const { name, source } of postgresSources) {
    const leasesNotifications = /UPDATE[^;]{0,120}notification_deliveries[\s\S]{0,400}?SET\s+state\s*=\s*'leased'/.test(source);
    if (leasesNotifications) assert.match(source, /last_notification_poll_at\s*=/, name);
  }
});

test("no PostgreSQL writer pauses plans or leases plan work without the I3 plan-pause rules", () => {
  // SQLite (I3): pausing a plan cancels its shadow_ready/awaiting_executor
  // jobs and expires its pending/leased notification deliveries with
  // `plan_paused`, and both lease queries require an active plan with an
  // enabled target. The PostgreSQL plane has no plan-status writer and no
  // job/notification lease writer yet; whichever twin adds one must carry
  // the same rules.
  for (const { name, source } of postgresSources) {
    if (/UPDATE[^;]{0,120}"missions"\)\}[^;]{0,400}?status\s*=\s*'(paused|deleted)'/.test(source)) {
      assert.match(source, /'plan_paused'/, name);
    }
    const leasesPlanWork = /UPDATE[^;]{0,120}"(action_jobs|notification_deliveries)"\)\}[\s\S]{0,400}?SET\s+state\s*=\s*'leased'/.test(source);
    if (leasesPlanWork) {
      assert.match(source, /mission\.status\s*=\s*'active'/, name);
      assert.match(source, /target\.enabled\s*=\s*1/, name);
    }
  }
});

test("PostgreSQL notification recovery mirrors the SQLite expiry receipts", () => {
  const source = postgresSources.find(({ name }) => name === "postgres-notification-recovery.ts")?.source ?? "";
  const sqlite = readFileSync(join(SOURCE_DIRECTORY, "notification-repository.ts"), "utf8");
  for (const code of ["no_device_poll", "device_poll_refused", "job_window_expired"]) {
    assert.match(sqlite, new RegExp(`'${code}'`), `SQLite ${code}`);
    assert.match(source, new RegExp(`'${code}'`), `PostgreSQL ${code}`);
  }
  assert.match(source, /\{loopHealth,notifications,ok\}/);
  assert.match(source, /EXCEPTION WHEN others THEN\s+device_capabilities := NULL;/);
});

test("the PostgreSQL job lifecycle expires a satisfied plan's pending calls like SQLite", () => {
  const source = postgresSources.find(({ name }) => name === "postgres-signal-job-lifecycle-apply.ts")?.source ?? "";
  assert.match(source, /IF mission_status_before = 'active' AND mission_status_after = 'satisfied' THEN/);
  assert.match(source, /failure_code = 'plan_satisfied'/);
  assert.match(source, /delivery\.state IN \('pending', 'leased'\)/);
});
