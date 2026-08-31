import type {
  BackgroundWorkerContext,
  BackgroundWorkerDeploymentStatus,
  BackgroundWorkerPrincipal,
  BackgroundWorkerPrincipalPage,
  BackgroundWorkerRuntimeKind,
  BackgroundWorkerStore
} from "../../contracts/src/background-worker.js";
import {
  BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION,
  type BackgroundWorkerDeploymentMode
} from "../../domain/src/background-worker-deployment.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { BackgroundTaskRepository } from "./background-task-repository.js";
import {
  LOCAL_TENANT_ID,
  LOCAL_USER_ID,
  type YoinkDatabase
} from "./database.js";
import {
  normalizedRequestScope,
  runWithRequestScope,
  type RequestScope
} from "./request-scope.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const MINIMUM_PAGE_SIZE = 1;
const MAXIMUM_PAGE_SIZE = 500;
const ONLINE_HEARTBEAT_MS = 30_000;

export interface SqliteBackgroundWorkerStoreOptions {
  principalMode?: "fixed" | "all";
  fixedPrincipal?: BackgroundWorkerPrincipal;
}

interface PrincipalRow {
  tenantId: string;
  userId: string;
}

interface DeploymentRow {
  coveredPrincipals: number;
  onlineErrors: number;
  lastHeartbeatAt: string | null;
}

interface DeploymentExpectationRow {
  desiredMode: BackgroundWorkerDeploymentMode;
  runtimeVersion: string;
  deploymentFingerprint: string;
}

class BackgroundWorkerDeploymentAttestationError extends Error {
  constructor(readonly code: "worker_deployment_expectation_missing" | "worker_deployment_mismatch") {
    super("The standalone background worker deployment contract does not match the API-owned expectation.");
    this.name = "BackgroundWorkerDeploymentAttestationError";
  }
}

function principal(value: BackgroundWorkerPrincipal): BackgroundWorkerPrincipal {
  const normalized = normalizedRequestScope({
    tenantId: value?.tenantId,
    userId: value?.userId,
    actorKind: "service",
    actorId: "background_worker_principal_validation"
  });
  return { tenantId: normalized.tenantId, userId: normalized.userId };
}

function workerIdentifier(value: unknown): string {
  const normalized = cleanText(value, 120);
  if (!IDENTIFIER_PATTERN.test(normalized)) throw new Error("A valid background worker ID is required.");
  return normalized;
}

function errorCode(value: unknown, fallback = ""): string {
  return cleanText(value, 80)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function pageSize(value: number): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < MINIMUM_PAGE_SIZE || parsed > MAXIMUM_PAGE_SIZE) {
    throw new Error(`A background worker principal page must contain ${MINIMUM_PAGE_SIZE} through ${MAXIMUM_PAGE_SIZE} users.`);
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
    throw new Error("The background worker principal cursor is invalid.");
  }
}

function runtimeKind(value: BackgroundWorkerRuntimeKind): BackgroundWorkerRuntimeKind {
  if (!(["local_in_process", "standalone"] as const).includes(value)) {
    throw new Error("The background worker runtime kind is invalid.");
  }
  return value;
}

function deploymentFingerprint(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("A valid background worker deployment fingerprint is required.");
  }
  return normalized;
}

function deploymentMode(value: unknown): BackgroundWorkerDeploymentMode {
  if (!(["embedded", "external", "disabled"] as unknown[]).includes(value)) {
    throw new Error("The background worker deployment mode is invalid.");
  }
  return value as BackgroundWorkerDeploymentMode;
}

export class SqliteBackgroundWorkerStore implements BackgroundWorkerStore {
  private readonly tasks: BackgroundTaskRepository;
  private readonly principalMode: "fixed" | "all";
  private readonly fixedPrincipal: BackgroundWorkerPrincipal;

  constructor(private readonly db: YoinkDatabase, options: SqliteBackgroundWorkerStoreOptions = {}) {
    this.tasks = new BackgroundTaskRepository(db);
    this.principalMode = options.principalMode ?? "fixed";
    this.fixedPrincipal = principal(options.fixedPrincipal ?? {
      tenantId: LOCAL_TENANT_ID,
      userId: LOCAL_USER_ID
    });
  }

  async listPrincipals(cursor: string, limit: number): Promise<BackgroundWorkerPrincipalPage> {
    const safeLimit = pageSize(limit);
    if (this.principalMode === "fixed") {
      if (cursor) throw new Error("A fixed background worker principal source does not accept a cursor.");
      return { principals: [{ ...this.fixedPrincipal }], nextCursor: "" };
    }
    const after = decodeCursor(cursor);
    const rows = this.db.all<PrincipalRow>(
      `SELECT tenant_id AS tenantId, id AS userId FROM users
       WHERE (? = '' OR tenant_id > ? OR (tenant_id = ? AND id > ?))
       ORDER BY tenant_id, id LIMIT ?`,
      after ? "after" : "",
      after?.tenantId ?? "",
      after?.tenantId ?? "",
      after?.userId ?? "",
      safeLimit + 1
    );
    const principals = rows.slice(0, safeLimit).map((row) => principal(row));
    return {
      principals,
      nextCursor: rows.length > safeLimit && principals.length
        ? encodeCursor(principals.at(-1) as BackgroundWorkerPrincipal)
        : ""
    };
  }

  async ensureSchedules(context: BackgroundWorkerContext, now: number): Promise<void> {
    this.scoped(context, () => {
      this.assertDeploymentExpectation(context);
      this.tasks.ensureDefaultSchedules(now);
    });
  }

  async enqueueDueSchedules(context: BackgroundWorkerContext, now: number): Promise<number> {
    return this.scoped(context, () => {
      this.assertDeploymentExpectation(context);
      return this.tasks.enqueueDueSchedules(now);
    });
  }

  async leaseNext(context: BackgroundWorkerContext, leaseSeconds: number, now: number) {
    return this.scoped(context, () => {
      this.assertDeploymentExpectation(context);
      const lease = this.tasks.leaseNext(context.workerId, leaseSeconds, now);
      return lease ? {
        id: lease.id,
        taskKind: lease.taskKind,
        capabilityToken: lease.capabilityToken
      } : null;
    });
  }

  async complete(
    context: BackgroundWorkerContext,
    taskId: string,
    capabilityToken: string,
    result: Parameters<BackgroundTaskRepository["complete"]>[2],
    now: number
  ): Promise<void> {
    this.scoped(context, () => this.tasks.complete(taskId, capabilityToken, result, now));
  }

  async fail(
    context: BackgroundWorkerContext,
    taskId: string,
    capabilityToken: string,
    failureCode: string,
    now: number
  ): Promise<void> {
    this.scoped(context, () => this.tasks.fail(taskId, capabilityToken, failureCode, 0, now));
  }

  async heartbeat(context: BackgroundWorkerContext, lastErrorCode: string, now: number): Promise<void> {
    this.scoped(context, () => this.tasks.heartbeat(
      context.workerId,
      context.runtimeKind,
      context.runtimeVersion,
      context.deploymentFingerprint,
      lastErrorCode,
      now
    ));
  }

  async stopWorker(
    workerId: string,
    expectedRuntimeKind: BackgroundWorkerRuntimeKind,
    lastErrorCode: string,
    now: number
  ): Promise<void> {
    const safeWorkerId = workerIdentifier(workerId);
    const safeRuntimeKind = runtimeKind(expectedRuntimeKind);
    const timestamp = nowIso(now);
    this.db.run(
      `UPDATE background_worker_heartbeats
       SET state = 'stopped', heartbeat_at = ?, stopped_at = ?, last_error_code = ?
       WHERE worker_id = ? AND runtime_kind = ?`,
      timestamp,
      timestamp,
      errorCode(lastErrorCode),
      safeWorkerId,
      safeRuntimeKind
    );
  }

  configureDeploymentExpectation(
    mode: BackgroundWorkerDeploymentMode,
    expectedDeploymentFingerprint: string,
    runtimeVersion: string,
    now = Date.now()
  ): void {
    const safeMode = deploymentMode(mode);
    const safeFingerprint = deploymentFingerprint(expectedDeploymentFingerprint);
    const safeVersion = cleanText(runtimeVersion, 40);
    if (!safeVersion) throw new Error("A background worker runtime version is required.");
    const current = this.deploymentExpectation();
    if (current?.desiredMode === safeMode
      && current.runtimeVersion === safeVersion
      && current.deploymentFingerprint === safeFingerprint) return;
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      const previousEvent = this.db.get<{ sequence: number; eventHash: string }>(
        `SELECT sequence, event_hash AS eventHash
         FROM background_worker_deployment_events ORDER BY sequence DESC LIMIT 1`
      );
      const sequence = Number(previousEvent?.sequence ?? 0) + 1;
      const previousEventHash = previousEvent?.eventHash ?? "";
      const eventHash = stableHash(
        "yoink_background_worker_deployment_event_v3",
        BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION,
        sequence,
        current?.desiredMode ?? "",
        safeMode,
        current?.deploymentFingerprint ?? "",
        safeFingerprint,
        safeVersion,
        previousEventHash,
        timestamp
      );
      this.db.run(
        `INSERT INTO background_worker_deployment_events(
           id, sequence, contract_version, from_mode, to_mode,
           from_deployment_fingerprint, to_deployment_fingerprint,
           runtime_version, previous_event_hash, event_hash, reason_code,
           privacy_classification, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api_startup_contract',
                   'operational_configuration', ?)`,
        newId("background_worker_deployment_event"),
        sequence,
        BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION,
        current?.desiredMode ?? "",
        safeMode,
        current?.deploymentFingerprint ?? "",
        safeFingerprint,
        safeVersion,
        previousEventHash,
        eventHash,
        timestamp
      );
      this.db.run(
        `INSERT INTO background_worker_deployment_expectations(
           id, contract_version, desired_mode, runtime_version,
           deployment_fingerprint, privacy_classification, updated_at
         ) VALUES ('active', ?, ?, ?, ?, 'operational_configuration', ?)
         ON CONFLICT(id) DO UPDATE SET
           contract_version = excluded.contract_version,
           desired_mode = excluded.desired_mode,
           runtime_version = excluded.runtime_version,
           deployment_fingerprint = excluded.deployment_fingerprint,
           updated_at = excluded.updated_at`,
        BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION,
        safeMode,
        safeVersion,
        safeFingerprint,
        timestamp
      );
    });
  }

  async deploymentStatus(
    expectedRuntimeKind: BackgroundWorkerRuntimeKind,
    expectedDeploymentFingerprint: string,
    now: number
  ): Promise<BackgroundWorkerDeploymentStatus> {
    const safeRuntimeKind = runtimeKind(expectedRuntimeKind);
    const safeFingerprint = deploymentFingerprint(expectedDeploymentFingerprint);
    const cutoff = nowIso(now - ONLINE_HEARTBEAT_MS);
    const totalPrincipals = Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count ?? 0);
    const expectation = this.deploymentExpectation();
    const expectedMode = safeRuntimeKind === "standalone" ? "external" : "embedded";
    const expectationMatches = expectation?.desiredMode === expectedMode
      && expectation.deploymentFingerprint === safeFingerprint;
    const deployment = this.db.get<DeploymentRow>(
      `SELECT COUNT(*) AS coveredPrincipals,
              COALESCE(SUM(CASE WHEN lastErrorCode <> '' THEN 1 ELSE 0 END), 0) AS onlineErrors,
              MAX(heartbeatAt) AS lastHeartbeatAt
       FROM (
         SELECT tenant_id, subject_user_id,
                MAX(heartbeat_at) AS heartbeatAt,
                MAX(CASE WHEN last_error_code <> '' THEN last_error_code ELSE '' END) AS lastErrorCode
         FROM background_worker_heartbeats
         WHERE runtime_kind = ? AND state = 'running' AND heartbeat_at >= ?
           AND deployment_fingerprint = ?
         GROUP BY tenant_id, subject_user_id
       )`,
      safeRuntimeKind,
      cutoff,
      safeFingerprint
    );
    const onlineRows = this.db.get<{ total: number; mismatched: number; lastHeartbeatAt: string | null }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN deployment_fingerprint <> ? THEN 1 ELSE 0 END), 0) AS mismatched,
              MAX(heartbeat_at) AS lastHeartbeatAt
       FROM background_worker_heartbeats
       WHERE runtime_kind = ? AND state = 'running' AND heartbeat_at >= ?`,
      safeFingerprint,
      safeRuntimeKind,
      cutoff
    );
    const runtimeRows = this.db.get<{ total: number; lastHeartbeatAt: string | null }>(
      `SELECT COUNT(*) AS total,
              MAX(heartbeat_at) AS lastHeartbeatAt
       FROM background_worker_heartbeats WHERE runtime_kind = ?`,
      safeRuntimeKind
    );
    const coveredPrincipals = Number(deployment?.coveredPrincipals ?? 0);
    const onlineErrors = Number(deployment?.onlineErrors ?? 0);
    const onlineTotal = Number(onlineRows?.total ?? 0);
    const mismatchedOnline = Number(onlineRows?.mismatched ?? 0);
    const totalRows = Number(runtimeRows?.total ?? 0);
    const state = onlineTotal > 0 ? "running" : totalRows > 0 ? "stopped" : "waiting";
    const deploymentAttested = expectationMatches && mismatchedOnline === 0
      && totalPrincipals > 0 && coveredPrincipals === totalPrincipals;
    const healthy = deploymentAttested && onlineErrors === 0;
    return {
      state,
      healthy,
      runtimeKind: safeRuntimeKind,
      lastHeartbeatAt: onlineRows?.lastHeartbeatAt ?? deployment?.lastHeartbeatAt ?? runtimeRows?.lastHeartbeatAt ?? "",
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

  private scoped<T>(context: BackgroundWorkerContext, operation: () => T): T {
    return runWithRequestScope(this.workerScope(context), operation);
  }

  private workerScope(context: BackgroundWorkerContext): RequestScope {
    const owner = principal(context.principal);
    const workerId = workerIdentifier(context.workerId);
    runtimeKind(context.runtimeKind);
    const version = cleanText(context.runtimeVersion, 40);
    deploymentFingerprint(context.deploymentFingerprint);
    if (!version) throw new Error("A background worker runtime version is required.");
    return normalizedRequestScope({
      tenantId: owner.tenantId,
      userId: owner.userId,
      actorKind: "service",
      actorId: workerId
    });
  }

  private deploymentExpectation(): DeploymentExpectationRow | undefined {
    return this.db.get<DeploymentExpectationRow>(
      `SELECT desired_mode AS desiredMode, runtime_version AS runtimeVersion,
              deployment_fingerprint AS deploymentFingerprint
       FROM background_worker_deployment_expectations WHERE id = 'active'`
    );
  }

  private assertDeploymentExpectation(context: BackgroundWorkerContext): void {
    if (context.runtimeKind !== "standalone") return;
    const expected = this.deploymentExpectation();
    if (!expected) throw new BackgroundWorkerDeploymentAttestationError("worker_deployment_expectation_missing");
    if (expected.desiredMode !== "external"
      || expected.runtimeVersion !== context.runtimeVersion
      || expected.deploymentFingerprint !== context.deploymentFingerprint) {
      throw new BackgroundWorkerDeploymentAttestationError("worker_deployment_mismatch");
    }
  }
}
