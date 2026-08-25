import type {
  BackgroundWorkerContext,
  BackgroundWorkerDeploymentStatus,
  BackgroundWorkerPrincipal,
  BackgroundWorkerPrincipalPage,
  BackgroundWorkerRuntimeKind,
  BackgroundWorkerStore
} from "../../contracts/src/background-worker.js";
import { nowIso } from "../../domain/src/ids.js";
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
    this.scoped(context, () => this.tasks.ensureDefaultSchedules(now));
  }

  async enqueueDueSchedules(context: BackgroundWorkerContext, now: number): Promise<number> {
    return this.scoped(context, () => this.tasks.enqueueDueSchedules(now));
  }

  async leaseNext(context: BackgroundWorkerContext, leaseSeconds: number, now: number) {
    return this.scoped(context, () => {
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

  async deploymentStatus(expectedRuntimeKind: BackgroundWorkerRuntimeKind, now: number): Promise<BackgroundWorkerDeploymentStatus> {
    const safeRuntimeKind = runtimeKind(expectedRuntimeKind);
    const cutoff = nowIso(now - ONLINE_HEARTBEAT_MS);
    const totalPrincipals = Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count ?? 0);
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
         GROUP BY tenant_id, subject_user_id
       )`,
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
    const totalRows = Number(runtimeRows?.total ?? 0);
    const state = coveredPrincipals > 0 ? "running" : totalRows > 0 ? "stopped" : "waiting";
    const healthy = totalPrincipals > 0 && coveredPrincipals === totalPrincipals && onlineErrors === 0;
    return {
      state,
      healthy,
      runtimeKind: safeRuntimeKind,
      lastHeartbeatAt: deployment?.lastHeartbeatAt ?? runtimeRows?.lastHeartbeatAt ?? "",
      lastErrorCode: onlineErrors > 0
        ? "worker_scope_errors"
        : coveredPrincipals > 0 && coveredPrincipals < totalPrincipals
          ? "worker_coverage_incomplete"
          : state === "waiting"
            ? "worker_waiting"
            : state === "stopped"
              ? "worker_stopped"
              : "",
      coveredPrincipals,
      totalPrincipals
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
    if (!version) throw new Error("A background worker runtime version is required.");
    return normalizedRequestScope({
      tenantId: owner.tenantId,
      userId: owner.userId,
      actorKind: "service",
      actorId: workerId
    });
  }
}
