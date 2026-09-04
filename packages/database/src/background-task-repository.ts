import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  BACKGROUND_TASK_DEFINITIONS,
  BACKGROUND_TASK_KINDS,
  isBackgroundTaskKind,
  type BackgroundTaskEventType,
  type BackgroundTaskKind,
  type BackgroundTaskResult,
  type BackgroundTaskState
} from "../../domain/src/background-task.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MINIMUM_INTERVAL_SECONDS = 15;
const MAXIMUM_INTERVAL_SECONDS = 604_800;
const ONLINE_HEARTBEAT_MS = 30_000;
const DAY_MS = 24 * 60 * 60_000;
export const BACKGROUND_TASK_HISTORY_RETENTION_DAYS = 30;
const FORBIDDEN_RESULT_KEY = /(token|secret|password|cookie|credential|authorization|nonce|address|payment|url|sku|product|account)/i;

export type { BackgroundTaskResult } from "../../domain/src/background-task.js";

export interface BackgroundTaskSchedule {
  id: string;
  taskKind: BackgroundTaskKind;
  displayName: string;
  description: string;
  enabled: boolean;
  intervalSeconds: number;
  nextRunAt: string;
  lastEnqueuedAt: string;
  privacyClassification: "operational_configuration";
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundTaskRecord {
  id: string;
  scheduleId: string;
  taskKind: BackgroundTaskKind;
  state: BackgroundTaskState;
  priority: number;
  attemptCount: number;
  maximumAttempts: number;
  scheduledFor: string;
  leaseOwnerId: string;
  leaseExpiresAt: string;
  lastErrorCode: string;
  result: BackgroundTaskResult;
  completedAt: string;
  privacyClassification: "operational_aggregate";
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundTaskLease extends BackgroundTaskRecord {
  capabilityToken: string;
}

export interface BackgroundTaskEvent {
  id: string;
  taskId: string;
  sequence: number;
  eventType: BackgroundTaskEventType;
  attempt: number;
  reasonCode: string;
  workerId: string;
  privacyClassification: "operational_aggregate";
  createdAt: string;
}

export interface BackgroundTaskEnqueueReceipt {
  taskId: string;
  created: boolean;
  state: "created" | "deduplicated" | "schedule_paused";
}

export interface BackgroundWorkerRecord {
  workerId: string;
  runtimeKind: "local_in_process" | "standalone";
  runtimeVersion: string;
  deploymentFingerprintPresent: boolean;
  state: "running" | "stopped";
  online: boolean;
  startedAt: string;
  heartbeatAt: string;
  stoppedAt: string;
  lastErrorCode: string;
  privacyClassification: "operational_aggregate";
}

export interface BackgroundWorkSnapshot {
  durable: true;
  executionBoundary: "outside_request_handler";
  asyncPersistenceContract: true;
  standaloneProcessCompatible: true;
  boundedPrincipalPagination: true;
  productionWorkerFleetReady: false;
  containsCapabilityMaterial: false;
  successfulHistoryRetentionDays: number;
  privacyClassification: "operational_aggregate";
  canManage: boolean;
  counts: {
    schedules: number;
    enabledSchedules: number;
    pendingTasks: number;
    leasedTasks: number;
    retryingTasks: number;
    succeededTasks: number;
    deadLetterTasks: number;
    onlineWorkers: number;
  };
  schedules: BackgroundTaskSchedule[];
  tasks: BackgroundTaskRecord[];
  deadLetterTasks: BackgroundTaskRecord[];
  events: BackgroundTaskEvent[];
  workers: BackgroundWorkerRecord[];
}

interface TaskRow {
  id: string;
  scheduleId: string | null;
  taskKind: BackgroundTaskKind;
  state: BackgroundTaskState;
  priority: number;
  attemptCount: number;
  maximumAttempts: number;
  scheduledFor: string;
  leaseOwnerId: string;
  leaseCapabilityHash: string;
  leaseExpiresAt: string;
  lastErrorCode: string;
  resultJson: string;
  completedAt: string;
  privacyClassification: "operational_aggregate";
  createdAt: string;
  updatedAt: string;
}

interface ScheduleRow {
  id: string;
  taskKind: BackgroundTaskKind;
  displayName: string;
  description: string;
  enabled: number;
  intervalSeconds: number;
  nextRunAt: string;
  lastEnqueuedAt: string;
  privacyClassification: "operational_configuration";
  createdAt: string;
  updatedAt: string;
}

const TASK_SELECT = `SELECT id, schedule_id AS scheduleId, task_kind AS taskKind, state,
  priority, attempt_count AS attemptCount, maximum_attempts AS maximumAttempts,
  scheduled_for AS scheduledFor, lease_owner_id AS leaseOwnerId,
  lease_capability_hash AS leaseCapabilityHash, lease_expires_at AS leaseExpiresAt,
  last_error_code AS lastErrorCode, result_json AS resultJson,
  completed_at AS completedAt, privacy_classification AS privacyClassification,
  created_at AS createdAt, updated_at AS updatedAt FROM background_tasks`;

const SCHEDULE_SELECT = `SELECT id, task_kind AS taskKind, display_name AS displayName,
  description, enabled, interval_seconds AS intervalSeconds,
  next_run_at AS nextRunAt, last_enqueued_at AS lastEnqueuedAt,
  privacy_classification AS privacyClassification,
  created_at AS createdAt, updated_at AS updatedAt FROM background_task_schedules`;

export class BackgroundTaskError extends Error {
  constructor(
    readonly code:
      | "background_task_invalid"
      | "background_task_not_found"
      | "background_task_state_conflict"
      | "background_task_capability_invalid",
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "BackgroundTaskError";
  }
}

function identifier(value: unknown, label: string, maximum = 120): string {
  const normalized = cleanText(value, maximum);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BackgroundTaskError("background_task_invalid", 400, `A valid ${label} is required.`);
  }
  return normalized;
}

function reasonCode(value: unknown, fallback: string): string {
  return cleanText(value, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function intervalSeconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < MINIMUM_INTERVAL_SECONDS || parsed > MAXIMUM_INTERVAL_SECONDS) {
    throw new BackgroundTaskError(
      "background_task_invalid",
      400,
      `A background schedule interval must be from ${MINIMUM_INTERVAL_SECONDS} through ${MAXIMUM_INTERVAL_SECONDS} seconds.`
    );
  }
  return parsed;
}

function parsedResult(value: string): BackgroundTaskResult {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as BackgroundTaskResult
      : {};
  } catch {
    return {};
  }
}

function normalizedResult(value: unknown): { value: BackgroundTaskResult; json: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackgroundTaskError("background_task_invalid", 400, "A background task result object is required.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 32) {
    throw new BackgroundTaskError("background_task_invalid", 400, "A background task result may contain at most 32 bounded fields.");
  }
  const result: BackgroundTaskResult = {};
  for (const [key, raw] of entries) {
    if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(key) || FORBIDDEN_RESULT_KEY.test(key)) {
      throw new BackgroundTaskError("background_task_invalid", 400, "The background task result contains a forbidden field.");
    }
    if (raw === null || typeof raw === "boolean") {
      result[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) <= Number.MAX_SAFE_INTEGER) {
      result[key] = raw;
    } else if (typeof raw === "string") {
      result[key] = cleanText(raw, 160);
    } else {
      throw new BackgroundTaskError("background_task_invalid", 400, "Background task result values must be bounded primitives.");
    }
  }
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json, "utf8") > 4_000) {
    throw new BackgroundTaskError("background_task_invalid", 400, "The background task result is too large.");
  }
  return { value: result, json };
}

function backgroundTaskResultDidWork(result: BackgroundTaskResult): boolean {
  const workField = /(created|updated|deleted|recovered|expired|released|requeued|processed|accepted|attempted|succeeded|retried|deadLettered|cancelled|mutated|enqueued|handled|evaluated|refreshed|dispatched|reconciled)/i;
  return Object.entries(result).some(([key, value]) => workField.test(key)
    && ((typeof value === "number" && value > 0) || value === true));
}

function taskRecord(row: TaskRow): BackgroundTaskRecord {
  return {
    id: row.id,
    scheduleId: row.scheduleId ?? "",
    taskKind: row.taskKind,
    state: row.state,
    priority: Number(row.priority),
    attemptCount: Number(row.attemptCount),
    maximumAttempts: Number(row.maximumAttempts),
    scheduledFor: row.scheduledFor,
    leaseOwnerId: row.leaseOwnerId,
    leaseExpiresAt: row.leaseExpiresAt,
    lastErrorCode: row.lastErrorCode,
    result: parsedResult(row.resultJson),
    completedAt: row.completedAt,
    privacyClassification: "operational_aggregate",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function scheduleRecord(row: ScheduleRow): BackgroundTaskSchedule {
  return {
    id: row.id,
    taskKind: row.taskKind,
    displayName: row.displayName,
    description: row.description,
    enabled: row.enabled === 1,
    intervalSeconds: Number(row.intervalSeconds),
    nextRunAt: row.nextRunAt,
    lastEnqueuedAt: row.lastEnqueuedAt,
    privacyClassification: "operational_configuration",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function capabilityHash(taskId: string, token: string): string {
  return stableHash("yoink_background_task_capability_v1", taskId, token);
}

function trustedWorker(): void {
  if (!new Set(["service", "maintainer"]).has(currentRequestScope().actorKind)) {
    throw new BackgroundTaskError("background_task_invalid", 400, "A trusted background worker scope is required.");
  }
}

function defaultScheduleId(taskKind: BackgroundTaskKind): string {
  const scope = currentRequestScope();
  return `background_schedule_${stableHash("yoink_background_schedule_v1", scope.tenantId, scope.userId, taskKind).slice(0, 32)}`;
}

function nextOccurrence(dueAt: string, everySeconds: number, now: number): string {
  const parsed = new Date(dueAt).getTime();
  const base = Number.isFinite(parsed) ? parsed : now;
  const intervalMs = everySeconds * 1_000;
  const elapsedIntervals = base <= now ? Math.floor((now - base) / intervalMs) + 1 : 0;
  return nowIso(base + elapsedIntervals * intervalMs);
}

export class BackgroundTaskRepository {
  private readonly authorization: AuthorizationRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.authorization = new AuthorizationRepository(db);
    this.audit = new AuditRepository(db);
  }

  ensureDefaultSchedules(now = Date.now()): BackgroundTaskSchedule[] {
    trustedWorker();
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      for (const taskKind of BACKGROUND_TASK_KINDS) {
        const definition = BACKGROUND_TASK_DEFINITIONS[taskKind];
        this.db.run(
          `INSERT OR IGNORE INTO background_task_schedules(
             id, tenant_id, subject_user_id, task_kind, display_name, description,
             enabled, interval_seconds, next_run_at, last_enqueued_at,
             created_by_actor_id, updated_by_actor_id, privacy_classification,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, '', ?, ?, 'operational_configuration', ?, ?)`,
          defaultScheduleId(taskKind),
          scope.tenantId,
          scope.userId,
          taskKind,
          definition.label,
          definition.description,
          definition.intervalSeconds,
          timestamp,
          scope.actorId,
          scope.actorId,
          timestamp,
          timestamp
        );
        this.db.run(
          `UPDATE background_task_schedules
           SET display_name = ?, description = ?, updated_by_actor_id = ?, updated_at = ?
           WHERE tenant_id = ? AND subject_user_id = ? AND task_kind = ?
             AND (display_name <> ? OR description <> ?)`,
          definition.label,
          definition.description,
          scope.actorId,
          timestamp,
          scope.tenantId,
          scope.userId,
          taskKind,
          definition.label,
          definition.description
        );
      }
    });
    return this.listSchedulesInternal();
  }

  enqueueDueSchedules(now = Date.now()): number {
    trustedWorker();
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      const schedules = this.db.all<ScheduleRow>(
        `${SCHEDULE_SELECT}
         WHERE tenant_id = ? AND subject_user_id = ? AND enabled = 1 AND next_run_at <= ?
         ORDER BY next_run_at, id`,
        scope.tenantId,
        scope.userId,
        timestamp
      );
      let enqueued = 0;
      for (const schedule of schedules) {
        const inserted = this.insertTask(
          schedule.taskKind,
          schedule.id,
          `scheduled:${schedule.nextRunAt}`,
          schedule.nextRunAt,
          BACKGROUND_TASK_DEFINITIONS[schedule.taskKind].maximumAttempts,
          "schedule_due",
          now
        );
        enqueued += inserted ? 1 : 0;
        this.db.run(
          `UPDATE background_task_schedules
           SET next_run_at = ?, last_enqueued_at = ?, updated_by_actor_id = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND subject_user_id = ?`,
          nextOccurrence(schedule.nextRunAt, Number(schedule.intervalSeconds), now),
          timestamp,
          scope.actorId,
          timestamp,
          schedule.id,
          scope.tenantId,
          scope.userId
        );
      }
      return enqueued;
    });
  }

  leaseNext(workerId: string, leaseSeconds = 60, now = Date.now()): BackgroundTaskLease | null {
    trustedWorker();
    const scope = currentRequestScope();
    const safeWorkerId = identifier(workerId, "background worker ID");
    const safeLeaseSeconds = Math.max(15, Math.min(300, Math.floor(Number(leaseSeconds) || 60)));
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      this.deadLetterExhaustedLeases(safeWorkerId, now);
      const candidate = this.db.get<TaskRow>(
        `${TASK_SELECT}
         WHERE tenant_id = ? AND subject_user_id = ? AND attempt_count < maximum_attempts
           AND ((state IN ('pending', 'retry_wait') AND scheduled_for <= ?)
             OR (state = 'leased' AND lease_expires_at <> '' AND lease_expires_at <= ?))
         ORDER BY priority DESC, scheduled_for, created_at, id LIMIT 1`,
        scope.tenantId,
        scope.userId,
        timestamp,
        timestamp
      );
      if (!candidate) return null;
      const token = randomBytes(32).toString("base64url");
      const leaseExpiresAt = nowIso(now + safeLeaseSeconds * 1_000);
      const attempt = Number(candidate.attemptCount) + 1;
      const updated = this.db.run(
        `UPDATE background_tasks
         SET state = 'leased', attempt_count = ?, lease_owner_id = ?,
             lease_capability_hash = ?, lease_expires_at = ?, last_error_code = '', updated_at = ?
         WHERE id = ? AND tenant_id = ? AND subject_user_id = ? AND state = ?`,
        attempt,
        safeWorkerId,
        capabilityHash(candidate.id, token),
        leaseExpiresAt,
        timestamp,
        candidate.id,
        scope.tenantId,
        scope.userId,
        candidate.state
      );
      if (Number(updated.changes) !== 1) return null;
      this.event(
        candidate.id,
        "leased",
        attempt,
        candidate.state === "leased" ? "expired_lease_reclaimed" : "worker_lease",
        safeWorkerId,
        now
      );
      const leased = this.taskRow(candidate.id);
      if (!leased) throw new Error("The leased background task disappeared.");
      return { ...taskRecord(leased), capabilityToken: token };
    });
  }

  complete(taskId: string, capabilityToken: string, result: BackgroundTaskResult, now = Date.now()): BackgroundTaskRecord {
    trustedWorker();
    const safeTaskId = identifier(taskId, "background task ID", 160);
    const normalized = normalizedResult(result);
    const didWork = backgroundTaskResultDidWork(normalized.value);
    const storedResult = didWork
      ? normalized
      : {
          value: { ...normalized.value, historyDisposition: "no_work" },
          json: JSON.stringify({ ...normalized.value, historyDisposition: "no_work" })
        };
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      const row = this.assertCapability(safeTaskId, capabilityToken, now);
      this.db.run(
        `UPDATE background_tasks
         SET state = 'succeeded', lease_owner_id = '', lease_capability_hash = '',
             lease_expires_at = '', last_error_code = '', result_json = ?,
             completed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND subject_user_id = ? AND state = 'leased'`,
        storedResult.json,
        timestamp,
        timestamp,
        safeTaskId,
        currentRequestScope().tenantId,
        currentRequestScope().userId
      );
      this.event(safeTaskId, "succeeded", Number(row.attemptCount), "handler_completed", row.leaseOwnerId, now);
      const completed = taskRecord(this.taskRow(safeTaskId) as TaskRow);
      if (!didWork) {
        this.db.run(
          "DELETE FROM background_tasks WHERE id = ? AND tenant_id = ? AND subject_user_id = ?",
          safeTaskId,
          currentRequestScope().tenantId,
          currentRequestScope().userId
        );
      }
      return completed;
    });
  }

  fail(taskId: string, capabilityToken: string, errorCode: string, retryAfterSeconds = 0, now = Date.now()): BackgroundTaskRecord {
    trustedWorker();
    const safeTaskId = identifier(taskId, "background task ID", 160);
    const safeErrorCode = reasonCode(errorCode, "handler_failed");
    return this.db.transaction(() => {
      const row = this.assertCapability(safeTaskId, capabilityToken, now);
      const exhausted = Number(row.attemptCount) >= Number(row.maximumAttempts);
      const retrySeconds = retryAfterSeconds > 0
        ? Math.max(1, Math.min(3_600, Math.floor(Number(retryAfterSeconds))))
        : Math.min(300, 5 * (2 ** Math.max(0, Number(row.attemptCount) - 1)));
      const nextState: BackgroundTaskState = exhausted ? "dead_letter" : "retry_wait";
      const timestamp = nowIso(now);
      this.db.run(
        `UPDATE background_tasks
         SET state = ?, scheduled_for = ?, lease_owner_id = '', lease_capability_hash = '',
             lease_expires_at = '', last_error_code = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND subject_user_id = ? AND state = 'leased'`,
        nextState,
        exhausted ? row.scheduledFor : nowIso(now + retrySeconds * 1_000),
        safeErrorCode,
        exhausted ? timestamp : "",
        timestamp,
        safeTaskId,
        currentRequestScope().tenantId,
        currentRequestScope().userId
      );
      this.event(
        safeTaskId,
        exhausted ? "dead_lettered" : "retry_scheduled",
        Number(row.attemptCount),
        safeErrorCode,
        row.leaseOwnerId,
        now
      );
      return taskRecord(this.taskRow(safeTaskId) as TaskRow);
    });
  }

  heartbeat(
    workerId: string,
    runtimeKind: "local_in_process" | "standalone",
    runtimeVersion: string,
    deploymentFingerprint: string,
    lastErrorCode = "",
    now = Date.now()
  ): void {
    trustedWorker();
    const scope = currentRequestScope();
    const safeWorkerId = identifier(workerId, "background worker ID");
    const safeVersion = cleanText(runtimeVersion, 40);
    const safeDeploymentFingerprint = String(deploymentFingerprint ?? "").trim();
    if (!safeVersion || !["local_in_process", "standalone"].includes(runtimeKind)
      || !/^[a-f0-9]{64}$/.test(safeDeploymentFingerprint)) {
      throw new BackgroundTaskError("background_task_invalid", 400, "The background worker runtime identity is invalid.");
    }
    const timestamp = nowIso(now);
    this.db.run(
      `INSERT INTO background_worker_heartbeats(
         tenant_id, subject_user_id, worker_id, runtime_kind, runtime_version,
         state, started_at, heartbeat_at, stopped_at, last_error_code,
         privacy_classification, deployment_fingerprint
       ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, '', ?, 'operational_aggregate', ?)
       ON CONFLICT(tenant_id, subject_user_id, worker_id) DO UPDATE SET
         runtime_kind = excluded.runtime_kind,
         runtime_version = excluded.runtime_version,
         deployment_fingerprint = excluded.deployment_fingerprint,
         state = 'running',
         started_at = CASE WHEN background_worker_heartbeats.state = 'stopped'
           THEN excluded.started_at ELSE background_worker_heartbeats.started_at END,
         heartbeat_at = excluded.heartbeat_at,
         stopped_at = '',
         last_error_code = excluded.last_error_code`,
      scope.tenantId,
      scope.userId,
      safeWorkerId,
      runtimeKind,
      safeVersion,
      timestamp,
      timestamp,
      reasonCode(lastErrorCode, ""),
      safeDeploymentFingerprint
    );
  }

  stopWorker(workerId: string, lastErrorCode = "", now = Date.now()): void {
    trustedWorker();
    const scope = currentRequestScope();
    const safeWorkerId = identifier(workerId, "background worker ID");
    const timestamp = nowIso(now);
    this.db.run(
      `UPDATE background_worker_heartbeats
       SET state = 'stopped', heartbeat_at = ?, stopped_at = ?, last_error_code = ?
       WHERE tenant_id = ? AND subject_user_id = ? AND worker_id = ?`,
      timestamp,
      timestamp,
      reasonCode(lastErrorCode, ""),
      scope.tenantId,
      scope.userId,
      safeWorkerId
    );
  }

  updateSchedule(
    scheduleId: string,
    input: { enabled?: boolean; intervalSeconds?: number },
    correlationId: string,
    now = Date.now()
  ): BackgroundTaskSchedule {
    this.authorization.require("worker.manage");
    const scope = currentRequestScope();
    const safeScheduleId = identifier(scheduleId, "background schedule ID", 160);
    if (!input || typeof input !== "object" || (input.enabled === undefined && input.intervalSeconds === undefined)) {
      throw new BackgroundTaskError("background_task_invalid", 400, "Choose a background schedule setting to update.");
    }
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
      throw new BackgroundTaskError("background_task_invalid", 400, "The background schedule enabled state must be true or false.");
    }
    const existing = this.scheduleRow(safeScheduleId);
    if (!existing) throw new BackgroundTaskError("background_task_not_found", 404, "The background schedule does not exist.");
    const nextEnabled = input.enabled ?? (existing.enabled === 1);
    const nextInterval = input.intervalSeconds === undefined ? Number(existing.intervalSeconds) : intervalSeconds(input.intervalSeconds);
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE background_task_schedules
         SET enabled = ?, interval_seconds = ?, next_run_at = CASE
           WHEN enabled = 0 AND ? = 1 THEN ? ELSE next_run_at END,
           updated_by_actor_id = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND subject_user_id = ?`,
        nextEnabled ? 1 : 0,
        nextInterval,
        nextEnabled ? 1 : 0,
        timestamp,
        scope.actorId,
        timestamp,
        safeScheduleId,
        scope.tenantId,
        scope.userId
      );
      this.audit.record({
        correlationId,
        aggregateType: "background_schedule",
        eventType: "background_schedule_updated",
        reasonCode: nextEnabled ? "schedule_enabled" : "schedule_disabled",
        message: `${existing.displayName} background maintenance was ${nextEnabled ? "enabled" : "paused"}.`,
        data: { scheduleId: safeScheduleId, taskKind: existing.taskKind, enabled: nextEnabled, intervalSeconds: nextInterval }
      }, now);
    });
    return scheduleRecord(this.scheduleRow(safeScheduleId) as ScheduleRow);
  }

  enqueueScheduleNow(scheduleId: string, correlationId: string, now = Date.now()): BackgroundTaskRecord {
    this.authorization.require("worker.manage");
    const safeScheduleId = identifier(scheduleId, "background schedule ID", 160);
    const schedule = this.scheduleRow(safeScheduleId);
    if (!schedule) throw new BackgroundTaskError("background_task_not_found", 404, "The background schedule does not exist.");
    let taskId = "";
    this.db.transaction(() => {
      taskId = this.insertTask(
        schedule.taskKind,
        schedule.id,
        `manual:${newId("run")}`,
        nowIso(now),
        BACKGROUND_TASK_DEFINITIONS[schedule.taskKind].maximumAttempts,
        "operator_run_now",
        now
      );
      this.audit.record({
        correlationId,
        aggregateType: "background_task",
        eventType: "background_task_requested",
        reasonCode: "operator_run_now",
        message: `${schedule.displayName} was queued for an immediate bounded run.`,
        data: { taskId, scheduleId: safeScheduleId, taskKind: schedule.taskKind }
      }, now);
    });
    return taskRecord(this.taskRow(taskId) as TaskRow);
  }

  enqueueServiceTask(
    taskKind: BackgroundTaskKind,
    dedupeKey: string,
    now = Date.now()
  ): BackgroundTaskEnqueueReceipt {
    trustedWorker();
    if (!isBackgroundTaskKind(taskKind)) {
      throw new BackgroundTaskError("background_task_invalid", 400, "A packaged background task kind is required.");
    }
    const safeDedupeKey = cleanText(dedupeKey, 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$/.test(safeDedupeKey)) {
      throw new BackgroundTaskError("background_task_invalid", 400, "A valid background task deduplication key is required.");
    }
    this.ensureDefaultSchedules(now);
    const scope = currentRequestScope();
    const schedule = this.db.get<ScheduleRow>(
      `${SCHEDULE_SELECT} WHERE tenant_id = ? AND subject_user_id = ? AND task_kind = ?`,
      scope.tenantId,
      scope.userId,
      taskKind
    );
    if (!schedule) {
      throw new BackgroundTaskError("background_task_state_conflict", 409, "The packaged background schedule is unavailable.");
    }
    const activeTask = () => this.db.get<{ id: string }>(
      `SELECT id FROM background_tasks
       WHERE tenant_id = ? AND subject_user_id = ? AND task_kind = ? AND dedupe_key = ?
         AND state IN ('pending', 'leased', 'retry_wait')
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      scope.tenantId,
      scope.userId,
      taskKind,
      safeDedupeKey
    );
    const alreadyActive = activeTask();
    if (alreadyActive) return { taskId: alreadyActive.id, created: false, state: "deduplicated" };
    if (schedule.enabled !== 1) return { taskId: "", created: false, state: "schedule_paused" };
    const createdTaskId = this.insertTask(
      taskKind,
      schedule.id,
      safeDedupeKey,
      nowIso(now),
      BACKGROUND_TASK_DEFINITIONS[taskKind].maximumAttempts,
      "service_event",
      now,
      80
    );
    if (createdTaskId) return { taskId: createdTaskId, created: true, state: "created" };
    const existing = activeTask();
    if (!existing) {
      throw new BackgroundTaskError("background_task_state_conflict", 409, "The background task could not be queued safely.");
    }
    return { taskId: existing.id, created: false, state: "deduplicated" };
  }

  retryDeadLetter(taskId: string, correlationId: string, now = Date.now()): BackgroundTaskRecord {
    this.authorization.require("worker.manage");
    const scope = currentRequestScope();
    const safeTaskId = identifier(taskId, "background task ID", 160);
    const task = this.taskRow(safeTaskId);
    if (!task) throw new BackgroundTaskError("background_task_not_found", 404, "The background task does not exist.");
    if (task.state !== "dead_letter") {
      throw new BackgroundTaskError("background_task_state_conflict", 409, "Only a dead-lettered background task can be retried manually.");
    }
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE background_tasks
         SET state = 'pending', attempt_count = 0, scheduled_for = ?, lease_owner_id = '',
             lease_capability_hash = '', lease_expires_at = '', last_error_code = '',
             result_json = '{}', completed_at = '', updated_at = ?
         WHERE id = ? AND tenant_id = ? AND subject_user_id = ? AND state = 'dead_letter'`,
        timestamp,
        timestamp,
        safeTaskId,
        scope.tenantId,
        scope.userId
      );
      this.event(safeTaskId, "manually_retried", 0, "operator_retry", "operator", now);
      this.audit.record({
        correlationId,
        aggregateType: "background_task",
        eventType: "background_task_retried",
        reasonCode: "operator_retry",
        message: "A dead-lettered maintenance task was reset for a bounded retry.",
        data: { taskId: safeTaskId, taskKind: task.taskKind }
      }, now);
    });
    return taskRecord(this.taskRow(safeTaskId) as TaskRow);
  }

  pruneCompletedHistory(now = Date.now()): { deletedTaskRuns: number; taskHistoryCutoffAt: string } {
    trustedWorker();
    const scope = currentRequestScope();
    const taskHistoryCutoffAt = nowIso(now - BACKGROUND_TASK_HISTORY_RETENTION_DAYS * DAY_MS);
    const deletedTaskRuns = Number(this.db.run(
      `DELETE FROM background_tasks
       WHERE tenant_id = ? AND subject_user_id = ?
         AND state IN ('succeeded', 'cancelled')
         AND completed_at <> '' AND completed_at <= ?`,
      scope.tenantId,
      scope.userId,
      taskHistoryCutoffAt
    ).changes);
    return { deletedTaskRuns, taskHistoryCutoffAt };
  }

  snapshot(now = Date.now()): BackgroundWorkSnapshot {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    const counts = this.db.get<{
      schedules: number;
      enabledSchedules: number;
      pendingTasks: number;
      leasedTasks: number;
      retryingTasks: number;
      succeededTasks: number;
      deadLetterTasks: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM background_task_schedules s
           WHERE s.tenant_id = ? AND s.subject_user_id = ?) AS schedules,
         (SELECT COUNT(*) FROM background_task_schedules s
           WHERE s.tenant_id = ? AND s.subject_user_id = ? AND s.enabled = 1) AS enabledSchedules,
         SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pendingTasks,
         SUM(CASE WHEN state = 'leased' THEN 1 ELSE 0 END) AS leasedTasks,
         SUM(CASE WHEN state = 'retry_wait' THEN 1 ELSE 0 END) AS retryingTasks,
         SUM(CASE WHEN state = 'succeeded' THEN 1 ELSE 0 END) AS succeededTasks,
         SUM(CASE WHEN state = 'dead_letter' THEN 1 ELSE 0 END) AS deadLetterTasks
       FROM background_tasks WHERE tenant_id = ? AND subject_user_id = ?`,
      scope.tenantId,
      scope.userId,
      scope.tenantId,
      scope.userId,
      scope.tenantId,
      scope.userId
    );
    const workers = this.workerRecords(now);
    return {
      durable: true,
      executionBoundary: "outside_request_handler",
      asyncPersistenceContract: true,
      standaloneProcessCompatible: true,
      boundedPrincipalPagination: true,
      productionWorkerFleetReady: false,
      containsCapabilityMaterial: false,
      successfulHistoryRetentionDays: BACKGROUND_TASK_HISTORY_RETENTION_DAYS,
      privacyClassification: "operational_aggregate",
      canManage: this.authorization.has("worker.manage"),
      counts: {
        schedules: Number(counts?.schedules ?? 0),
        enabledSchedules: Number(counts?.enabledSchedules ?? 0),
        pendingTasks: Number(counts?.pendingTasks ?? 0),
        leasedTasks: Number(counts?.leasedTasks ?? 0),
        retryingTasks: Number(counts?.retryingTasks ?? 0),
        succeededTasks: Number(counts?.succeededTasks ?? 0),
        deadLetterTasks: Number(counts?.deadLetterTasks ?? 0),
        onlineWorkers: workers.filter((worker) => worker.online).length
      },
      schedules: this.listSchedulesInternal(),
      tasks: this.db.all<TaskRow>(
        `${TASK_SELECT} WHERE tenant_id = ? AND subject_user_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 100`,
        scope.tenantId,
        scope.userId
      ).map(taskRecord),
      // Recovery work must never disappear merely because 100 newer success
      // rows exist. This deliberately uncapped view contains only unresolved
      // operational aggregates; successful history remains bounded above.
      deadLetterTasks: this.db.all<TaskRow>(
        `${TASK_SELECT} WHERE tenant_id = ? AND subject_user_id = ? AND state = 'dead_letter'
         ORDER BY created_at ASC, id ASC`,
        scope.tenantId,
        scope.userId
      ).map(taskRecord),
      events: this.db.all<{
        id: string;
        taskId: string;
        sequence: number;
        eventType: BackgroundTaskEventType;
        attempt: number;
        reasonCode: string;
        workerId: string;
        privacyClassification: "operational_aggregate";
        createdAt: string;
      }>(
        `SELECT id, task_id AS taskId, sequence, event_type AS eventType,
                attempt, reason_code AS reasonCode, worker_id AS workerId,
                privacy_classification AS privacyClassification, created_at AS createdAt
         FROM background_task_events
         WHERE tenant_id = ? AND subject_user_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 100`,
        scope.tenantId,
        scope.userId
      ),
      workers
    };
  }

  private insertTask(
    taskKind: BackgroundTaskKind,
    scheduleId: string,
    dedupeKey: string,
    scheduledFor: string,
    maximumAttempts: number,
    scheduledReason: string,
    now: number,
    priority = 50
  ): string {
    const scope = currentRequestScope();
    const id = newId("background_task");
    const timestamp = nowIso(now);
    const result = this.db.run(
      `INSERT OR IGNORE INTO background_tasks(
         id, tenant_id, subject_user_id, schedule_id, task_kind, dedupe_key,
         state, priority, attempt_count, maximum_attempts, scheduled_for,
         privacy_classification, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, 'operational_aggregate', ?, ?)`,
      id,
      scope.tenantId,
      scope.userId,
      scheduleId,
      taskKind,
      cleanText(dedupeKey, 200),
      Math.max(0, Math.min(100, Math.floor(Number(priority) || 0))),
      maximumAttempts,
      scheduledFor,
      timestamp,
      timestamp
    );
    if (Number(result.changes) !== 1) return "";
    this.event(
      id,
      "scheduled",
      0,
      scheduledReason,
      scheduledReason === "operator_run_now" ? "operator" : scope.actorId,
      now
    );
    return id;
  }

  private deadLetterExhaustedLeases(workerId: string, now: number): number {
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const exhausted = this.db.all<{ id: string; attemptCount: number }>(
      `SELECT id, attempt_count AS attemptCount FROM background_tasks
       WHERE tenant_id = ? AND subject_user_id = ? AND state = 'leased'
         AND lease_expires_at <> '' AND lease_expires_at <= ?
         AND attempt_count >= maximum_attempts
       ORDER BY lease_expires_at, id`,
      scope.tenantId,
      scope.userId,
      timestamp
    );
    for (const task of exhausted) {
      const updated = this.db.run(
        `UPDATE background_tasks
         SET state = 'dead_letter', lease_owner_id = '', lease_capability_hash = '',
             lease_expires_at = '', last_error_code = 'lease_attempts_exhausted',
             completed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND subject_user_id = ? AND state = 'leased'`,
        timestamp,
        timestamp,
        task.id,
        scope.tenantId,
        scope.userId
      );
      if (Number(updated.changes) === 1) {
        this.event(task.id, "dead_lettered", Number(task.attemptCount), "lease_attempts_exhausted", workerId, now);
      }
    }
    return exhausted.length;
  }

  private assertCapability(taskId: string, token: string, now: number): TaskRow {
    const row = this.taskRow(taskId);
    const cleanToken = cleanText(token, 100);
    const expected = capabilityHash(taskId, cleanToken);
    const stored = Buffer.from(row?.leaseCapabilityHash ?? "", "hex");
    const supplied = Buffer.from(expected, "hex");
    if (!row || row.state !== "leased" || !CAPABILITY_PATTERN.test(cleanToken)
      || stored.length !== supplied.length || !timingSafeEqual(stored, supplied)
      || !row.leaseExpiresAt || row.leaseExpiresAt < nowIso(now)) {
      throw new BackgroundTaskError(
        "background_task_capability_invalid",
        409,
        "The background task lease capability is invalid or expired."
      );
    }
    return row;
  }

  private event(
    taskId: string,
    eventType: BackgroundTaskEventType,
    attempt: number,
    eventReason: string,
    workerId: string,
    now: number
  ): void {
    const scope = currentRequestScope();
    const sequence = Number(this.db.get<{ sequence: number }>(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM background_task_events WHERE task_id = ?",
      taskId
    )?.sequence ?? 1);
    this.db.run(
      `INSERT INTO background_task_events(
         id, tenant_id, subject_user_id, task_id, sequence, event_type,
         attempt, reason_code, worker_id, privacy_classification, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'operational_aggregate', ?)`,
      newId("background_task_event"),
      scope.tenantId,
      scope.userId,
      taskId,
      sequence,
      eventType,
      Math.max(0, Math.min(20, Math.floor(Number(attempt) || 0))),
      reasonCode(eventReason, "task_event"),
      cleanText(workerId, 120),
      nowIso(now)
    );
  }

  private taskRow(taskId: string): TaskRow | undefined {
    const scope = currentRequestScope();
    return this.db.get<TaskRow>(
      `${TASK_SELECT} WHERE id = ? AND tenant_id = ? AND subject_user_id = ?`,
      taskId,
      scope.tenantId,
      scope.userId
    );
  }

  private scheduleRow(scheduleId: string): ScheduleRow | undefined {
    const scope = currentRequestScope();
    return this.db.get<ScheduleRow>(
      `${SCHEDULE_SELECT} WHERE id = ? AND tenant_id = ? AND subject_user_id = ?`,
      scheduleId,
      scope.tenantId,
      scope.userId
    );
  }

  private listSchedulesInternal(): BackgroundTaskSchedule[] {
    const scope = currentRequestScope();
    return this.db.all<ScheduleRow>(
      `${SCHEDULE_SELECT} WHERE tenant_id = ? AND subject_user_id = ? ORDER BY display_name, id`,
      scope.tenantId,
      scope.userId
    ).map(scheduleRecord);
  }

  private workerRecords(now: number): BackgroundWorkerRecord[] {
    const scope = currentRequestScope();
    return this.db.all<{
      workerId: string;
      runtimeKind: "local_in_process" | "standalone";
      runtimeVersion: string;
      deploymentFingerprintPresent: number;
      state: "running" | "stopped";
      startedAt: string;
      heartbeatAt: string;
      stoppedAt: string;
      lastErrorCode: string;
      privacyClassification: "operational_aggregate";
    }>(
      `SELECT worker_id AS workerId, runtime_kind AS runtimeKind,
              runtime_version AS runtimeVersion, state, started_at AS startedAt,
              heartbeat_at AS heartbeatAt, stopped_at AS stoppedAt,
              last_error_code AS lastErrorCode,
              CASE WHEN deployment_fingerprint <> '' THEN 1 ELSE 0 END AS deploymentFingerprintPresent,
              privacy_classification AS privacyClassification
       FROM background_worker_heartbeats
       WHERE tenant_id = ? AND subject_user_id = ?
       ORDER BY heartbeat_at DESC, worker_id LIMIT 20`,
      scope.tenantId,
      scope.userId
    ).map((worker) => ({
      ...worker,
      deploymentFingerprintPresent: worker.deploymentFingerprintPresent === 1,
      online: worker.state === "running" && new Date(worker.heartbeatAt).getTime() >= now - ONLINE_HEARTBEAT_MS
    }));
  }
}
