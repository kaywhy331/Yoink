import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
  BackgroundWorkerContext,
  BackgroundWorkerDeploymentStatus,
  BackgroundWorkerPrincipal,
  BackgroundWorkerPrincipalPage,
  BackgroundWorkerRuntimeKind,
  BackgroundWorkerStore
} from "../../contracts/src/background-worker.js";
import {
  BACKGROUND_TASK_DEFINITIONS,
  BACKGROUND_TASK_KINDS,
  isBackgroundTaskKind,
  type BackgroundTaskEventType,
  type BackgroundTaskKind,
  type BackgroundTaskResult
} from "../../domain/src/background-task.js";
import { BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION } from "../../domain/src/background-worker-deployment.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  inspectPostgresCutoverPreflight,
  type PostgresCutoverDatabase,
  type PostgresQuerySession
} from "./postgres-cutover.js";
import { buildPostgresSchemaManifest } from "./postgres-schema-manifest.js";
import type { NodePostgresTenantQueueWriteDatabase } from "./postgres-tenant-queue-writes.js";

const SCOPE_IDENTIFIER = /^[A-Za-z0-9_-]{3,120}$/;
const TASK_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/;
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const MINIMUM_PAGE_SIZE = 1;
const MAXIMUM_PAGE_SIZE = 500;
const ONLINE_HEARTBEAT_MS = 30_000;
const FORBIDDEN_RESULT_KEY = /(token|secret|password|cookie|credential|authorization|nonce|address|payment|url|sku|product|account)/i;

interface QualifiedContext {
  tenantId: string;
  userId: string;
  workerId: string;
  runtimeKind: BackgroundWorkerRuntimeKind;
  runtimeVersion: string;
  deploymentFingerprint: string;
}

interface QualificationReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  phase: string;
  schema_manifest_fingerprint: string;
  runtime_authority: boolean;
  cutover_ready: boolean;
}

interface DeploymentExpectationRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  desired_mode: string;
  runtime_version: string;
  deployment_fingerprint: string;
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  task_kind: string;
  state: string;
  attempt_count: string | number | bigint;
  maximum_attempts: string | number | bigint;
  scheduled_for: string;
  lease_owner_id: string;
  lease_capability_hash: string;
  lease_expires_at: string;
}

export interface PostgresBackgroundWorkerStoreQualification {
  qualificationOnly: true;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  schemaManifestFingerprint: string;
  serverVersionMajor: number;
  verifiedTenantPolicyCount: number;
  storeContractImplemented: true;
  tenantPredicatesApplied: true;
  skipLockedLeaseImplemented: true;
  singleConnectionSemanticsQualified: true;
  nativePostgresQualificationSuite: true;
  independentBackendSessionCount: 3;
  multiConnectionContentionQualified: true;
  serverBoundQueueWriteTransactions: boolean;
  queueStoreWriteRoleParity: boolean;
  atomicDeploymentAttestationAndQueueWrite: boolean;
  controlRepositoryParity: false;
  handlerRepositoryParity: false;
  runtimeAuthority: false;
}

export interface PostgresBackgroundWorkerQualificationStoreOptions {
  tenantQueueWriteDatabase?: Pick<
    NodePostgresTenantQueueWriteDatabase,
    "manifest" | "writeTransaction"
  >;
}

export class PostgresBackgroundWorkerQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresBackgroundWorkerQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresBackgroundWorkerQualificationError("The PostgreSQL worker qualification schema is invalid.");
  }
  return normalized;
}

function identifier(value: string): string {
  return `"${value}"`;
}

function relation(schema: string, table: string): string {
  return `${identifier(schema)}.${identifier(table)}`;
}

function exactCount(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new PostgresBackgroundWorkerQualificationError(`The PostgreSQL worker ${label} is invalid.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresBackgroundWorkerQualificationError(`The PostgreSQL worker ${label} is out of range.`);
  }
  return parsed;
}

function scopeIdentifier(value: unknown, label: string): string {
  const normalized = cleanText(value, 120);
  if (!SCOPE_IDENTIFIER.test(normalized)) {
    throw new PostgresBackgroundWorkerQualificationError(`A valid ${label} is required.`);
  }
  return normalized;
}

function taskIdentifier(value: unknown): string {
  const normalized = cleanText(value, 160);
  if (!TASK_IDENTIFIER.test(normalized)) {
    throw new PostgresBackgroundWorkerQualificationError("A valid background task ID is required.");
  }
  return normalized;
}

function runtimeKind(value: unknown): BackgroundWorkerRuntimeKind {
  if (!(value === "local_in_process" || value === "standalone")) {
    throw new PostgresBackgroundWorkerQualificationError("The background worker runtime kind is invalid.");
  }
  return value;
}

function fingerprint(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!SHA256.test(normalized)) {
    throw new PostgresBackgroundWorkerQualificationError("A valid background worker deployment fingerprint is required.");
  }
  return normalized;
}

function contextValue(context: BackgroundWorkerContext): QualifiedContext {
  if (!context || typeof context !== "object" || !context.principal) {
    throw new PostgresBackgroundWorkerQualificationError("A background worker context is required.");
  }
  const runtimeVersion = cleanText(context.runtimeVersion, 40);
  if (!runtimeVersion) {
    throw new PostgresBackgroundWorkerQualificationError("A background worker runtime version is required.");
  }
  return {
    tenantId: scopeIdentifier(context.principal.tenantId, "background worker tenant ID"),
    userId: scopeIdentifier(context.principal.userId, "background worker user ID"),
    workerId: scopeIdentifier(context.workerId, "background worker ID"),
    runtimeKind: runtimeKind(context.runtimeKind),
    runtimeVersion,
    deploymentFingerprint: fingerprint(context.deploymentFingerprint)
  };
}

function principal(value: BackgroundWorkerPrincipal): BackgroundWorkerPrincipal {
  return {
    tenantId: scopeIdentifier(value?.tenantId, "background worker tenant ID"),
    userId: scopeIdentifier(value?.userId, "background worker user ID")
  };
}

function pageSize(value: number): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < MINIMUM_PAGE_SIZE || parsed > MAXIMUM_PAGE_SIZE) {
    throw new PostgresBackgroundWorkerQualificationError(
      `A background worker principal page must contain ${MINIMUM_PAGE_SIZE} through ${MAXIMUM_PAGE_SIZE} users.`
    );
  }
  return parsed;
}

function encodeCursor(value: BackgroundWorkerPrincipal): string {
  return Buffer.from(JSON.stringify(principal(value)), "utf8").toString("base64url");
}

function decodeCursor(value: string): BackgroundWorkerPrincipal | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).sort().join(",") !== "tenantId,userId") {
      throw new Error("invalid cursor shape");
    }
    const decoded = principal({ tenantId: String(parsed.tenantId ?? ""), userId: String(parsed.userId ?? "") });
    if (encodeCursor(decoded) !== value) throw new Error("non-canonical cursor");
    return decoded;
  } catch {
    throw new PostgresBackgroundWorkerQualificationError("The background worker principal cursor is invalid.");
  }
}

function errorCode(value: unknown, fallback: string): string {
  return cleanText(value, 80)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function defaultScheduleId(owner: BackgroundWorkerPrincipal, taskKind: BackgroundTaskKind): string {
  return `background_schedule_${stableHash(
    "yoink_background_schedule_v1",
    owner.tenantId,
    owner.userId,
    taskKind
  ).slice(0, 32)}`;
}

function nextOccurrence(dueAt: string, everySeconds: number, now: number): string {
  const parsed = new Date(dueAt).getTime();
  const base = Number.isFinite(parsed) ? parsed : now;
  const intervalMs = everySeconds * 1_000;
  const elapsedIntervals = base <= now ? Math.floor((now - base) / intervalMs) + 1 : 0;
  return nowIso(base + elapsedIntervals * intervalMs);
}

function capabilityHash(taskId: string, token: string): string {
  return stableHash("yoink_background_task_capability_v1", taskId, token);
}

function normalizedResult(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresBackgroundWorkerQualificationError("A background task result object is required.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 32) {
    throw new PostgresBackgroundWorkerQualificationError("A background task result may contain at most 32 bounded fields.");
  }
  const result: BackgroundTaskResult = {};
  for (const [key, raw] of entries) {
    if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(key) || FORBIDDEN_RESULT_KEY.test(key)) {
      throw new PostgresBackgroundWorkerQualificationError("The background task result contains a forbidden field.");
    }
    if (raw === null || typeof raw === "boolean") {
      result[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) <= Number.MAX_SAFE_INTEGER) {
      result[key] = raw;
    } else if (typeof raw === "string") {
      result[key] = cleanText(raw, 160);
    } else {
      throw new PostgresBackgroundWorkerQualificationError("Background task result values must be bounded primitives.");
    }
  }
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json, "utf8") > 4_000) {
    throw new PostgresBackgroundWorkerQualificationError("The background task result is too large.");
  }
  return json;
}

function assertCapability(row: TaskRow | undefined, taskId: string, token: string, now: number): TaskRow {
  const normalizedToken = cleanText(token, 100);
  const expected = Buffer.from(capabilityHash(taskId, normalizedToken), "hex");
  const stored = Buffer.from(String(row?.lease_capability_hash ?? ""), "hex");
  if (!row || row.state !== "leased" || !CAPABILITY_TOKEN.test(normalizedToken)
    || stored.length !== expected.length || !timingSafeEqual(stored, expected)
    || !row.lease_expires_at || row.lease_expires_at < nowIso(now)) {
    throw new PostgresBackgroundWorkerQualificationError(
      "The background task lease capability is invalid or expired."
    );
  }
  return row;
}

/**
 * Exercises the complete asynchronous worker-store contract against an inert,
 * verified cutover schema. When a tenant queue-write database is supplied,
 * every tenant queue transaction uses that server-bound least-privilege role;
 * deployment attestation executes inside the same server-bound transaction as
 * each new-work schedule, enqueue, or lease mutation. Principal enumeration,
 * deployment status, and worker stopping still use the cutover/control role. It is intentionally not
 * wired into either runtime, and task handlers still depend on SQLite
 * repositories.
 */
export class PostgresBackgroundWorkerQualificationStore implements BackgroundWorkerStore {
  private qualified = false;

  readonly schema: string;

  constructor(
    private readonly database: PostgresCutoverDatabase,
    requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
    private readonly options: PostgresBackgroundWorkerQualificationStoreOptions = {}
  ) {
    this.schema = schemaName(requestedSchema);
  }

  async qualify(): Promise<PostgresBackgroundWorkerStoreQualification> {
    const manifest = buildPostgresSchemaManifest();
    const preflight = await inspectPostgresCutoverPreflight(this.database);
    if (!preflight.serverVersionSupported || !preflight.skipLockedAvailable || !preflight.cutoverRoleBypassesRls) {
      throw new PostgresBackgroundWorkerQualificationError(
        "PostgreSQL worker qualification requires the supported cutover/control role with SKIP LOCKED."
      );
    }
    const receipt = await this.database.query<QualificationReceiptRow>(
      `SELECT contract_version, phase, schema_manifest_fingerprint, runtime_authority, cutover_ready
       FROM ${relation(this.schema, "yoink_cutover_receipt")} WHERE id = 'active'`
    );
    const row = receipt.rows[0];
    if (receipt.rows.length !== 1 || !row
      || exactCount(row.contract_version, "cutover contract version") !== POSTGRES_CUTOVER_CONTRACT_VERSION
      || row.phase !== "verified"
      || row.schema_manifest_fingerprint !== manifest.fingerprint
      || row.runtime_authority !== false
      || row.cutover_ready !== false) {
      throw new PostgresBackgroundWorkerQualificationError(
        "The PostgreSQL worker store requires an exact verified, inert cutover receipt."
      );
    }
    const policies = await this.database.query<{ count: string | number | bigint }>(
      `SELECT COUNT(DISTINCT tablename) AS count FROM pg_catalog.pg_policies WHERE schemaname = $1`,
      [this.schema]
    );
    const verifiedTenantPolicyCount = exactCount(policies.rows[0]?.count, "tenant policy count");
    const expectedPolicies = manifest.directTenantTableCount
      + manifest.inheritedTenantTableCount
      + manifest.mixedTenantTableCount;
    if (verifiedTenantPolicyCount !== expectedPolicies) {
      throw new PostgresBackgroundWorkerQualificationError(
        "The PostgreSQL worker store tenant-policy surface does not match the cutover manifest."
      );
    }
    const queueWriteManifest = this.options.tenantQueueWriteDatabase?.manifest;
    if (queueWriteManifest && queueWriteManifest.schemaName !== this.schema) {
      throw new PostgresBackgroundWorkerQualificationError(
        "The server-bound tenant queue writer does not match the worker qualification schema."
      );
    }
    this.qualified = true;
    return {
      qualificationOnly: true,
      cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
      schemaManifestFingerprint: manifest.fingerprint,
      serverVersionMajor: preflight.serverVersionMajor,
      verifiedTenantPolicyCount,
      storeContractImplemented: true,
      tenantPredicatesApplied: true,
      skipLockedLeaseImplemented: true,
      singleConnectionSemanticsQualified: true,
      nativePostgresQualificationSuite: true,
      independentBackendSessionCount: 3,
      multiConnectionContentionQualified: true,
      serverBoundQueueWriteTransactions: Boolean(queueWriteManifest),
      queueStoreWriteRoleParity: Boolean(queueWriteManifest),
      atomicDeploymentAttestationAndQueueWrite: Boolean(queueWriteManifest),
      controlRepositoryParity: false,
      handlerRepositoryParity: false,
      runtimeAuthority: false
    };
  }

  async listPrincipals(cursor: string, limit: number): Promise<BackgroundWorkerPrincipalPage> {
    this.assertQualified();
    const safeLimit = pageSize(limit);
    const after = decodeCursor(cursor);
    const rows = await this.database.query<{ tenant_id: string; user_id: string }>(
      `SELECT tenant_id, id AS user_id FROM ${relation(this.schema, "users")}
       WHERE ($1 = '' OR tenant_id > $1 OR (tenant_id = $1 AND id > $2))
       ORDER BY tenant_id, id LIMIT $3`,
      [after?.tenantId ?? "", after?.userId ?? "", safeLimit + 1]
    );
    const principals = rows.rows.slice(0, safeLimit).map((row) => principal({
      tenantId: row.tenant_id,
      userId: row.user_id
    }));
    return {
      principals,
      nextCursor: rows.rows.length > safeLimit && principals.length
        ? encodeCursor(principals.at(-1) as BackgroundWorkerPrincipal)
        : ""
    };
  }

  async ensureSchedules(context: BackgroundWorkerContext, now: number): Promise<void> {
    await this.scoped(context, true, async (session, scope) => {
      const timestamp = nowIso(now);
      for (const taskKind of BACKGROUND_TASK_KINDS) {
        const definition = BACKGROUND_TASK_DEFINITIONS[taskKind];
        await session.query(
          `INSERT INTO ${relation(this.schema, "background_task_schedules")}(
             id, tenant_id, subject_user_id, task_kind, display_name, description,
             enabled, interval_seconds, next_run_at, last_enqueued_at,
             created_by_actor_id, updated_by_actor_id, privacy_classification,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, '', $9, $9,
                     'operational_configuration', $8, $8)
           ON CONFLICT DO NOTHING`,
          [
            defaultScheduleId(scope, taskKind),
            scope.tenantId,
            scope.userId,
            taskKind,
            definition.label,
            definition.description,
            definition.intervalSeconds,
            timestamp,
            scope.workerId
          ]
        );
        await session.query(
          `UPDATE ${relation(this.schema, "background_task_schedules")}
           SET display_name = $1, description = $2, updated_by_actor_id = $3, updated_at = $4
           WHERE tenant_id = $5 AND subject_user_id = $6 AND task_kind = $7
             AND (display_name <> $1 OR description <> $2)`,
          [
            definition.label,
            definition.description,
            scope.workerId,
            timestamp,
            scope.tenantId,
            scope.userId,
            taskKind
          ]
        );
      }
    });
  }

  async enqueueDueSchedules(context: BackgroundWorkerContext, now: number): Promise<number> {
    return this.scoped(context, true, async (session, scope) => {
      const timestamp = nowIso(now);
      const schedules = await session.query<{
        id: string;
        task_kind: string;
        next_run_at: string;
        interval_seconds: string | number | bigint;
      }>(
        `SELECT id, task_kind, next_run_at, interval_seconds
         FROM ${relation(this.schema, "background_task_schedules")}
         WHERE tenant_id = $1 AND subject_user_id = $2 AND enabled = 1 AND next_run_at <= $3
         ORDER BY next_run_at, id FOR UPDATE SKIP LOCKED`,
        [scope.tenantId, scope.userId, timestamp]
      );
      let enqueued = 0;
      for (const schedule of schedules.rows) {
        if (!isBackgroundTaskKind(schedule.task_kind)) {
          throw new PostgresBackgroundWorkerQualificationError("The PostgreSQL worker queue contains an unknown task kind.");
        }
        const taskId = newId("background_task");
        const inserted = await session.query<{ id: string }>(
          `INSERT INTO ${relation(this.schema, "background_tasks")}(
             id, tenant_id, subject_user_id, schedule_id, task_kind, dedupe_key,
             state, priority, attempt_count, maximum_attempts, scheduled_for,
             privacy_classification, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', 50, 0, $7, $8,
                     'operational_aggregate', $9, $9)
           ON CONFLICT DO NOTHING RETURNING id`,
          [
            taskId,
            scope.tenantId,
            scope.userId,
            schedule.id,
            schedule.task_kind,
            `scheduled:${schedule.next_run_at}`,
            BACKGROUND_TASK_DEFINITIONS[schedule.task_kind].maximumAttempts,
            schedule.next_run_at,
            timestamp
          ]
        );
        if (inserted.rows.length === 1) {
          await this.event(
            session,
            scope,
            taskId,
            "scheduled",
            0,
            "schedule_due",
            scope.workerId,
            now
          );
          enqueued += 1;
        }
        await session.query(
          `UPDATE ${relation(this.schema, "background_task_schedules")}
           SET next_run_at = $1, last_enqueued_at = $2, updated_by_actor_id = $3, updated_at = $2
           WHERE id = $4 AND tenant_id = $5 AND subject_user_id = $6`,
          [
            nextOccurrence(
              schedule.next_run_at,
              exactCount(schedule.interval_seconds, "schedule interval"),
              now
            ),
            timestamp,
            scope.workerId,
            schedule.id,
            scope.tenantId,
            scope.userId
          ]
        );
      }
      return enqueued;
    });
  }

  async leaseNext(
    context: BackgroundWorkerContext,
    leaseSeconds: number,
    now: number
  ): Promise<{ id: string; taskKind: BackgroundTaskKind; capabilityToken: string } | null> {
    return this.scoped(context, true, async (session, scope) => {
      const timestamp = nowIso(now);
      const safeLeaseSeconds = Math.max(15, Math.min(300, Math.floor(Number(leaseSeconds) || 60)));
      const exhausted = await session.query<TaskRow>(
        `SELECT id, task_kind, state, attempt_count, maximum_attempts, scheduled_for,
                lease_owner_id, lease_capability_hash, lease_expires_at
         FROM ${relation(this.schema, "background_tasks")}
         WHERE tenant_id = $1 AND subject_user_id = $2 AND state = 'leased'
           AND lease_expires_at <> '' AND lease_expires_at <= $3
           AND attempt_count >= maximum_attempts
         ORDER BY lease_expires_at, id FOR UPDATE SKIP LOCKED`,
        [scope.tenantId, scope.userId, timestamp]
      );
      for (const task of exhausted.rows) {
        const updated = await session.query<{ id: string }>(
          `UPDATE ${relation(this.schema, "background_tasks")}
           SET state = 'dead_letter', lease_owner_id = '', lease_capability_hash = '',
               lease_expires_at = '', last_error_code = 'lease_attempts_exhausted',
               completed_at = $1, updated_at = $1
           WHERE id = $2 AND tenant_id = $3 AND subject_user_id = $4 AND state = 'leased'
           RETURNING id`,
          [timestamp, task.id, scope.tenantId, scope.userId]
        );
        if (updated.rows.length === 1) {
          await this.event(
            session,
            scope,
            task.id,
            "dead_lettered",
            exactCount(task.attempt_count, "task attempt count"),
            "lease_attempts_exhausted",
            scope.workerId,
            now
          );
        }
      }

      const candidates = await session.query<TaskRow>(
        `SELECT id, task_kind, state, attempt_count, maximum_attempts, scheduled_for,
                lease_owner_id, lease_capability_hash, lease_expires_at
         FROM ${relation(this.schema, "background_tasks")}
         WHERE tenant_id = $1 AND subject_user_id = $2 AND attempt_count < maximum_attempts
           AND ((state IN ('pending', 'retry_wait') AND scheduled_for <= $3)
             OR (state = 'leased' AND lease_expires_at <> '' AND lease_expires_at <= $3))
         ORDER BY priority DESC, scheduled_for, created_at, id
         FOR UPDATE SKIP LOCKED LIMIT 1`,
        [scope.tenantId, scope.userId, timestamp]
      );
      const candidate = candidates.rows[0];
      if (!candidate) return null;
      if (!isBackgroundTaskKind(candidate.task_kind)) {
        throw new PostgresBackgroundWorkerQualificationError("The PostgreSQL worker queue contains an unknown task kind.");
      }
      const token = randomBytes(32).toString("base64url");
      const attempt = exactCount(candidate.attempt_count, "task attempt count") + 1;
      const leaseExpiresAt = nowIso(now + safeLeaseSeconds * 1_000);
      const updated = await session.query<{ id: string }>(
        `UPDATE ${relation(this.schema, "background_tasks")}
         SET state = 'leased', attempt_count = $1, lease_owner_id = $2,
             lease_capability_hash = $3, lease_expires_at = $4,
             last_error_code = '', updated_at = $5
         WHERE id = $6 AND tenant_id = $7 AND subject_user_id = $8 AND state = $9
         RETURNING id`,
        [
          attempt,
          scope.workerId,
          capabilityHash(candidate.id, token),
          leaseExpiresAt,
          timestamp,
          candidate.id,
          scope.tenantId,
          scope.userId,
          candidate.state
        ]
      );
      if (updated.rows.length !== 1) return null;
      await this.event(
        session,
        scope,
        candidate.id,
        "leased",
        attempt,
        candidate.state === "leased" ? "expired_lease_reclaimed" : "worker_lease",
        scope.workerId,
        now
      );
      return { id: candidate.id, taskKind: candidate.task_kind, capabilityToken: token };
    });
  }

  async complete(
    context: BackgroundWorkerContext,
    taskId: string,
    capabilityToken: string,
    result: BackgroundTaskResult,
    now: number
  ): Promise<void> {
    const safeTaskId = taskIdentifier(taskId);
    const resultJson = normalizedResult(result);
    await this.scoped(context, false, async (session, scope) => {
      const row = assertCapability(
        await this.taskForUpdate(session, scope, safeTaskId),
        safeTaskId,
        capabilityToken,
        now
      );
      const timestamp = nowIso(now);
      const updated = await session.query<{ id: string }>(
        `UPDATE ${relation(this.schema, "background_tasks")}
         SET state = 'succeeded', lease_owner_id = '', lease_capability_hash = '',
             lease_expires_at = '', last_error_code = '', result_json = $1,
             completed_at = $2, updated_at = $2
         WHERE id = $3 AND tenant_id = $4 AND subject_user_id = $5 AND state = 'leased'
         RETURNING id`,
        [resultJson, timestamp, safeTaskId, scope.tenantId, scope.userId]
      );
      if (updated.rows.length !== 1) {
        throw new PostgresBackgroundWorkerQualificationError("The background task completion lost its lease.");
      }
      await this.event(
        session,
        scope,
        safeTaskId,
        "succeeded",
        exactCount(row.attempt_count, "task attempt count"),
        "handler_completed",
        row.lease_owner_id,
        now
      );
    });
  }

  async fail(
    context: BackgroundWorkerContext,
    taskId: string,
    capabilityToken: string,
    failureCode: string,
    now: number
  ): Promise<void> {
    const safeTaskId = taskIdentifier(taskId);
    const safeFailureCode = errorCode(failureCode, "handler_failed");
    await this.scoped(context, false, async (session, scope) => {
      const row = assertCapability(
        await this.taskForUpdate(session, scope, safeTaskId),
        safeTaskId,
        capabilityToken,
        now
      );
      const attempt = exactCount(row.attempt_count, "task attempt count");
      const maximumAttempts = exactCount(row.maximum_attempts, "task maximum attempts");
      const exhausted = attempt >= maximumAttempts;
      const retrySeconds = Math.min(300, 5 * (2 ** Math.max(0, attempt - 1)));
      const timestamp = nowIso(now);
      const updated = await session.query<{ id: string }>(
        `UPDATE ${relation(this.schema, "background_tasks")}
         SET state = $1, scheduled_for = $2, lease_owner_id = '', lease_capability_hash = '',
             lease_expires_at = '', last_error_code = $3, completed_at = $4, updated_at = $5
         WHERE id = $6 AND tenant_id = $7 AND subject_user_id = $8 AND state = 'leased'
         RETURNING id`,
        [
          exhausted ? "dead_letter" : "retry_wait",
          exhausted ? row.scheduled_for : nowIso(now + retrySeconds * 1_000),
          safeFailureCode,
          exhausted ? timestamp : "",
          timestamp,
          safeTaskId,
          scope.tenantId,
          scope.userId
        ]
      );
      if (updated.rows.length !== 1) {
        throw new PostgresBackgroundWorkerQualificationError("The background task failure transition lost its lease.");
      }
      await this.event(
        session,
        scope,
        safeTaskId,
        exhausted ? "dead_lettered" : "retry_scheduled",
        attempt,
        safeFailureCode,
        row.lease_owner_id,
        now
      );
    });
  }

  async heartbeat(context: BackgroundWorkerContext, lastErrorCode: string, now: number): Promise<void> {
    await this.scoped(context, false, async (session, scope) => {
      const timestamp = nowIso(now);
      await session.query(
        `INSERT INTO ${relation(this.schema, "background_worker_heartbeats")}(
           tenant_id, subject_user_id, worker_id, runtime_kind, runtime_version,
           state, started_at, heartbeat_at, stopped_at, last_error_code,
           privacy_classification, deployment_fingerprint
         ) VALUES ($1, $2, $3, $4, $5, 'running', $6, $6, '', $7,
                   'operational_aggregate', $8)
         ON CONFLICT (tenant_id, subject_user_id, worker_id) DO UPDATE SET
           runtime_kind = EXCLUDED.runtime_kind,
           runtime_version = EXCLUDED.runtime_version,
           deployment_fingerprint = EXCLUDED.deployment_fingerprint,
           state = 'running',
           started_at = CASE WHEN background_worker_heartbeats.state = 'stopped'
             THEN EXCLUDED.started_at ELSE background_worker_heartbeats.started_at END,
           heartbeat_at = EXCLUDED.heartbeat_at,
           stopped_at = '',
           last_error_code = EXCLUDED.last_error_code`,
        [
          scope.tenantId,
          scope.userId,
          scope.workerId,
          scope.runtimeKind,
          scope.runtimeVersion,
          timestamp,
          errorCode(lastErrorCode, ""),
          scope.deploymentFingerprint
        ]
      );
    });
  }

  async stopWorker(
    workerId: string,
    expectedRuntimeKind: BackgroundWorkerRuntimeKind,
    lastErrorCode: string,
    now: number
  ): Promise<void> {
    this.assertQualified();
    const safeWorkerId = scopeIdentifier(workerId, "background worker ID");
    const safeRuntimeKind = runtimeKind(expectedRuntimeKind);
    const timestamp = nowIso(now);
    await this.database.query(
      `UPDATE ${relation(this.schema, "background_worker_heartbeats")}
       SET state = 'stopped', heartbeat_at = $1, stopped_at = $1, last_error_code = $2
       WHERE worker_id = $3 AND runtime_kind = $4`,
      [timestamp, errorCode(lastErrorCode, ""), safeWorkerId, safeRuntimeKind]
    );
  }

  async deploymentStatus(
    expectedRuntimeKind: BackgroundWorkerRuntimeKind,
    expectedDeploymentFingerprint: string,
    now: number
  ): Promise<BackgroundWorkerDeploymentStatus> {
    this.assertQualified();
    const safeRuntimeKind = runtimeKind(expectedRuntimeKind);
    const safeFingerprint = fingerprint(expectedDeploymentFingerprint);
    const cutoff = nowIso(now - ONLINE_HEARTBEAT_MS);
    const expectationResult = await this.database.query<DeploymentExpectationRow>(
      `SELECT contract_version, desired_mode, runtime_version, deployment_fingerprint
       FROM ${relation(this.schema, "background_worker_deployment_expectations")} WHERE id = 'active'`
    );
    const expectation = expectationResult.rows[0];
    const totalResult = await this.database.query<{ count: string | number | bigint }>(
      `SELECT COUNT(*) AS count FROM ${relation(this.schema, "users")}`
    );
    const totalPrincipals = exactCount(totalResult.rows[0]?.count, "principal count");
    const deployment = await this.database.query<{
      covered_principals: string | number | bigint;
      online_errors: string | number | bigint;
      last_heartbeat_at: string | null;
    }>(
      `SELECT COUNT(*) AS covered_principals,
              COALESCE(SUM(CASE WHEN last_error_code <> '' THEN 1 ELSE 0 END), 0) AS online_errors,
              MAX(heartbeat_at) AS last_heartbeat_at
       FROM (
         SELECT tenant_id, subject_user_id,
                MAX(heartbeat_at) AS heartbeat_at,
                MAX(CASE WHEN last_error_code <> '' THEN last_error_code ELSE '' END) AS last_error_code
         FROM ${relation(this.schema, "background_worker_heartbeats")}
         WHERE runtime_kind = $1 AND state = 'running' AND heartbeat_at >= $2
           AND deployment_fingerprint = $3
         GROUP BY tenant_id, subject_user_id
       ) AS covered`,
      [safeRuntimeKind, cutoff, safeFingerprint]
    );
    const online = await this.database.query<{
      total: string | number | bigint;
      mismatched: string | number | bigint;
      last_heartbeat_at: string | null;
    }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN deployment_fingerprint <> $1 THEN 1 ELSE 0 END), 0) AS mismatched,
              MAX(heartbeat_at) AS last_heartbeat_at
       FROM ${relation(this.schema, "background_worker_heartbeats")}
       WHERE runtime_kind = $2 AND state = 'running' AND heartbeat_at >= $3`,
      [safeFingerprint, safeRuntimeKind, cutoff]
    );
    const runtime = await this.database.query<{
      total: string | number | bigint;
      last_heartbeat_at: string | null;
    }>(
      `SELECT COUNT(*) AS total, MAX(heartbeat_at) AS last_heartbeat_at
       FROM ${relation(this.schema, "background_worker_heartbeats")} WHERE runtime_kind = $1`,
      [safeRuntimeKind]
    );
    const coveredPrincipals = exactCount(deployment.rows[0]?.covered_principals, "covered principal count");
    const onlineErrors = exactCount(deployment.rows[0]?.online_errors, "online error count");
    const onlineTotal = exactCount(online.rows[0]?.total, "online worker count");
    const mismatchedOnline = exactCount(online.rows[0]?.mismatched, "mismatched worker count");
    const totalRows = exactCount(runtime.rows[0]?.total, "runtime worker count");
    const expectedMode = safeRuntimeKind === "standalone" ? "external" : "embedded";
    const expectationMatches = expectation?.desired_mode === expectedMode
      && expectation.deployment_fingerprint === safeFingerprint;
    const state = onlineTotal > 0 ? "running" : totalRows > 0 ? "stopped" : "waiting";
    const deploymentAttested = expectationMatches && mismatchedOnline === 0
      && totalPrincipals > 0 && coveredPrincipals === totalPrincipals;
    return {
      state,
      healthy: deploymentAttested && onlineErrors === 0,
      runtimeKind: safeRuntimeKind,
      lastHeartbeatAt: online.rows[0]?.last_heartbeat_at
        ?? deployment.rows[0]?.last_heartbeat_at
        ?? runtime.rows[0]?.last_heartbeat_at
        ?? "",
      lastErrorCode: !expectation
        ? "worker_deployment_expectation_missing"
        : !expectationMatches
          ? "worker_deployment_expectation_mismatch"
          : mismatchedOnline > 0
            ? "worker_deployment_mismatch"
            : onlineErrors > 0
              ? "worker_scope_errors"
              : coveredPrincipals > 0 && coveredPrincipals < totalPrincipals
                ? "worker_coverage_incomplete"
                : state === "waiting"
                  ? "worker_waiting"
                  : state === "stopped"
                    ? "worker_stopped"
                    : "",
      coveredPrincipals,
      totalPrincipals,
      deploymentAttested,
      deploymentContractVersion: BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION
    };
  }

  private async scoped<T>(
    context: BackgroundWorkerContext,
    requireAttestation: boolean,
    operation: (session: PostgresQuerySession, scope: QualifiedContext) => Promise<T>
  ): Promise<T> {
    this.assertQualified();
    const scope = contextValue(context);
    const tenantQueueWrites = this.options.tenantQueueWriteDatabase;
    if (tenantQueueWrites) {
      return tenantQueueWrites.writeTransaction(
        { tenantId: scope.tenantId, userId: scope.userId },
        async (session) => {
          if (requireAttestation) await this.assertDeploymentExpectation(session, scope);
          return operation(session, scope);
        }
      );
    }
    return this.database.transaction(async (session) => {
      await session.query("SELECT set_config('yoink.tenant_id', $1, true)", [scope.tenantId]);
      const user = await session.query<{ id: string }>(
        `SELECT id FROM ${relation(this.schema, "users")}
         WHERE tenant_id = $1 AND id = $2`,
        [scope.tenantId, scope.userId]
      );
      if (user.rows.length !== 1) {
        throw new PostgresBackgroundWorkerQualificationError(
          "The PostgreSQL worker principal does not belong to the requested tenant."
        );
      }
      if (requireAttestation) await this.assertDeploymentExpectation(session, scope);
      return operation(session, scope);
    });
  }

  private async assertDeploymentExpectation(
    session: PostgresQuerySession,
    context: QualifiedContext
  ): Promise<void> {
    if (context.runtimeKind !== "standalone") return;
    const result = await session.query<DeploymentExpectationRow>(
      `SELECT contract_version, desired_mode, runtime_version, deployment_fingerprint
       FROM ${relation(this.schema, "background_worker_deployment_expectations")} WHERE id = 'active'`
    );
    const expected = result.rows[0];
    if (!expected) {
      throw new PostgresBackgroundWorkerQualificationError(
        "The PostgreSQL worker deployment expectation is missing."
      );
    }
    if (exactCount(expected.contract_version, "deployment contract version")
        !== BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION
      || expected.desired_mode !== "external"
      || expected.runtime_version !== context.runtimeVersion
      || expected.deployment_fingerprint !== context.deploymentFingerprint) {
      throw new PostgresBackgroundWorkerQualificationError(
        "The PostgreSQL worker deployment contract does not match the API-owned expectation."
      );
    }
  }

  private async taskForUpdate(
    session: PostgresQuerySession,
    scope: QualifiedContext,
    taskId: string
  ): Promise<TaskRow | undefined> {
    const result = await session.query<TaskRow>(
      `SELECT id, task_kind, state, attempt_count, maximum_attempts, scheduled_for,
              lease_owner_id, lease_capability_hash, lease_expires_at
       FROM ${relation(this.schema, "background_tasks")}
       WHERE id = $1 AND tenant_id = $2 AND subject_user_id = $3 FOR UPDATE`,
      [taskId, scope.tenantId, scope.userId]
    );
    return result.rows[0];
  }

  private async event(
    session: PostgresQuerySession,
    scope: QualifiedContext,
    taskId: string,
    eventType: BackgroundTaskEventType,
    attempt: number,
    eventReason: string,
    workerId: string,
    now: number
  ): Promise<void> {
    const next = await session.query<{ sequence: string | number | bigint }>(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
       FROM ${relation(this.schema, "background_task_events")} WHERE task_id = $1`,
      [taskId]
    );
    await session.query(
      `INSERT INTO ${relation(this.schema, "background_task_events")}(
         id, tenant_id, subject_user_id, task_id, sequence, event_type,
         attempt, reason_code, worker_id, privacy_classification, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'operational_aggregate', $10)`,
      [
        newId("background_task_event"),
        scope.tenantId,
        scope.userId,
        taskId,
        exactCount(next.rows[0]?.sequence, "task event sequence"),
        eventType,
        Math.max(0, Math.min(20, Math.floor(Number(attempt) || 0))),
        errorCode(eventReason, "task_event"),
        cleanText(workerId, 120),
        nowIso(now)
      ]
    );
  }

  private assertQualified(): void {
    if (!this.qualified) {
      throw new PostgresBackgroundWorkerQualificationError(
        "The PostgreSQL background worker store must pass qualification before use."
      );
    }
  }
}
