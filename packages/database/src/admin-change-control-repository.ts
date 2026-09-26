import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope, isExactLocalRequestScope, type RequestScope } from "./request-scope.js";

export const ADMIN_CHANGE_OPERATION_POLICIES = Object.freeze({
  authorization_role_grant: Object.freeze({
    label: "Grant an administrative role",
    controlLevel: "two_person",
    summaryKeys: Object.freeze(["subjectUserId", "roleId", "action"])
  }),
  authorization_role_revoke: Object.freeze({
    label: "Revoke an administrative role",
    controlLevel: "step_up",
    summaryKeys: Object.freeze(["subjectUserId", "roleId", "action"])
  }),
  observer_recipe_trust_install: Object.freeze({
    label: "Install observer recipe trust",
    controlLevel: "two_person",
    summaryKeys: Object.freeze(["generation", "action"])
  }),
  observer_recipe_promote: Object.freeze({
    label: "Promote an observer recipe",
    controlLevel: "two_person",
    summaryKeys: Object.freeze(["recipeId", "targetState", "action"])
  }),
  observer_recipe_resign: Object.freeze({
    label: "Re-sign an observer recipe",
    controlLevel: "step_up",
    summaryKeys: Object.freeze(["recipeId", "action"])
  }),
  observer_recipe_disable: Object.freeze({
    label: "Disable an observer recipe",
    controlLevel: "step_up",
    summaryKeys: Object.freeze(["recipeId", "reasonCode", "action"])
  }),
  observer_recipe_rollback: Object.freeze({
    label: "Roll back an observer recipe",
    controlLevel: "two_person",
    summaryKeys: Object.freeze(["recipeId", "action"])
  }),
  retailer_lane_activate: Object.freeze({
    label: "Activate a retailer mutation lane",
    controlLevel: "two_person",
    summaryKeys: Object.freeze(["retailerId", "action"])
  }),
  affiliate_policy_replace: Object.freeze({
    label: "Replace affiliate policies",
    controlLevel: "step_up",
    summaryKeys: Object.freeze(["policyCount", "enabledCount", "action"])
  }),
  global_actions_resume: Object.freeze({
    label: "Resume global purchase actions",
    controlLevel: "two_person",
    summaryKeys: Object.freeze(["action"])
  })
} as const);

export type AdminChangeOperationType = keyof typeof ADMIN_CHANGE_OPERATION_POLICIES;
export type AdminChangeControlLevel = "step_up" | "two_person";
export type AdminChangeStatus = "pending" | "approved" | "consumed" | "rejected" | "expired";
type SummaryValue = string | number | boolean | null;
export type AdminChangeSummary = Record<string, SummaryValue>;

export class AdminChangeControlError extends Error {
  constructor(
    readonly code:
      | "step_up_required"
      | "step_up_expired"
      | "change_request_invalid"
      | "change_request_not_found"
      | "change_request_mismatch"
      | "change_request_not_ready"
      | "change_request_expired"
      | "independent_approval_required"
      | "change_decision_confirmation_required",
    readonly status: 400 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "AdminChangeControlError";
  }
}

interface ChangeRow {
  id: string;
  tenantId: string;
  operationType: AdminChangeOperationType;
  targetKey: string;
  payloadHash: string;
  summaryJson: string;
  controlLevel: AdminChangeControlLevel;
  status: AdminChangeStatus;
  requestedByUserId: string;
  requestedByActorKind: "maintainer" | "user";
  requestedByActorId: string;
  requestedAssurance: "step_up" | "local_trusted";
  correlationId: string;
  expiresAt: string;
  approvedAt: string;
  consumedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminChangeRequest {
  id: string;
  operationType: AdminChangeOperationType;
  operationLabel: string;
  targetKey: string;
  summary: AdminChangeSummary;
  controlLevel: AdminChangeControlLevel;
  status: AdminChangeStatus;
  requestedByUserId: string;
  requestedByDisplayName: string;
  requestedByActorKind: "maintainer" | "user";
  requestedAssurance: "step_up" | "local_trusted";
  correlationId: string;
  expiresAt: string;
  approvedAt: string;
  consumedAt: string;
  createdAt: string;
  updatedAt: string;
  decisions: Array<{
    id: string;
    decision: "approve" | "reject";
    reviewerUserId: string;
    reviewerDisplayName: string;
    reviewerActorKind: "maintainer" | "user";
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    sequence: number;
    eventType: string;
    actorKind: "maintainer" | "user";
    correlationId: string;
    privacyClassification: "restricted_admin";
    createdAt: string;
  }>;
}

export type AdminChangeExecution<T> =
  | { disposition: "pending_approval"; request: AdminChangeRequest }
  | { disposition: "executed"; request: AdminChangeRequest; result: T };

export interface AdminChangeExecutionInput {
  operationType: AdminChangeOperationType;
  targetKey: string;
  payload: unknown;
  summary: AdminChangeSummary;
  correlationId: string;
  changeRequestId?: string;
}

const TARGET_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const REQUEST_ID_PATTERN = /^admin_change_[a-f0-9]{32}$/;
const CORRELATION_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
const DEFAULT_STEP_UP_AGE_SECONDS = 300;
const DEFAULT_REQUEST_TTL_SECONDS = 900;

function canonicalValue(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new AdminChangeControlError("change_request_invalid", 400, "The protected change payload is too deeply nested.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, item]) => [key, canonicalValue(item, depth + 1)]));
  }
  throw new AdminChangeControlError("change_request_invalid", 400, "The protected change payload is invalid.");
}

function normalizedSummary(operationType: AdminChangeOperationType, summary: AdminChangeSummary): AdminChangeSummary {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new AdminChangeControlError("change_request_invalid", 400, "A bounded change summary is required.");
  }
  const allowed = new Set<string>(ADMIN_CHANGE_OPERATION_POLICIES[operationType].summaryKeys);
  const entries = Object.entries(summary);
  if (!entries.length || entries.length > allowed.size) {
    throw new AdminChangeControlError("change_request_invalid", 400, "The bounded change summary is invalid.");
  }
  const result: AdminChangeSummary = {};
  for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right, "en-US"))) {
    if (!allowed.has(key)) {
      throw new AdminChangeControlError("change_request_invalid", 400, "The change summary contains an unapproved field.");
    }
    if (typeof value === "string") {
      const cleaned = cleanText(value, 160);
      if (!cleaned) throw new AdminChangeControlError("change_request_invalid", 400, "The change summary contains an empty value.");
      result[key] = cleaned;
    } else if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
        throw new AdminChangeControlError("change_request_invalid", 400, "The change summary contains an invalid number.");
      }
      result[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      result[key] = value;
    } else {
      throw new AdminChangeControlError("change_request_invalid", 400, "The change summary contains an invalid value.");
    }
  }
  return result;
}

function parsedSummary(value: string): AdminChangeSummary {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as AdminChangeSummary : {};
  } catch {
    return {};
  }
}

export class AdminChangeControlRepository {
  private readonly authorization: AuthorizationRepository;
  private readonly audit: AuditRepository;
  private readonly maximumStepUpAgeSeconds: number;
  private readonly requestTtlSeconds: number;

  constructor(
    private readonly db: YoinkDatabase,
    options: { maximumStepUpAgeSeconds?: number; requestTtlSeconds?: number } = {}
  ) {
    this.authorization = new AuthorizationRepository(db);
    this.audit = new AuditRepository(db);
    this.maximumStepUpAgeSeconds = Number.isSafeInteger(options.maximumStepUpAgeSeconds)
      && Number(options.maximumStepUpAgeSeconds) >= 60
      && Number(options.maximumStepUpAgeSeconds) <= 900
      ? Number(options.maximumStepUpAgeSeconds)
      : DEFAULT_STEP_UP_AGE_SECONDS;
    this.requestTtlSeconds = Number.isSafeInteger(options.requestTtlSeconds)
      && Number(options.requestTtlSeconds) >= 60
      && Number(options.requestTtlSeconds) <= 3_600
      ? Number(options.requestTtlSeconds)
      : DEFAULT_REQUEST_TTL_SECONDS;
  }

  requireFreshStepUp(now = Date.now()): "step_up" | "local_trusted" {
    const scope = currentRequestScope();
    if (isExactLocalRequestScope(scope)) return "local_trusted";
    if (!(["maintainer", "user"] as const).includes(scope.actorKind as "maintainer" | "user")) {
      throw new AdminChangeControlError("step_up_required", 403, "A human administrator must freshly authenticate for this operation.");
    }
    if (scope.authenticationAssurance !== "step_up") {
      throw new AdminChangeControlError("step_up_required", 403, "Fresh step-up authentication is required for this operation.");
    }
    const authenticationTimeMs = Number(scope.authenticationTime) * 1_000;
    if (!Number.isSafeInteger(scope.authenticationTime)
      || authenticationTimeMs > now + 30_000
      || now - authenticationTimeMs > this.maximumStepUpAgeSeconds * 1_000) {
      throw new AdminChangeControlError("step_up_expired", 403, "The step-up authentication is no longer fresh.");
    }
    return "step_up";
  }

  assuranceStatus(now = Date.now()): {
    level: "baseline" | "step_up" | "local_trusted";
    fresh: boolean;
    expiresAt: string;
  } {
    const scope = currentRequestScope();
    if (isExactLocalRequestScope(scope)) return { level: "local_trusted", fresh: true, expiresAt: "local_session" };
    const authenticationTimeMs = Number(scope.authenticationTime) * 1_000;
    const expiresAtMs = authenticationTimeMs + this.maximumStepUpAgeSeconds * 1_000;
    const fresh = scope.authenticationAssurance === "step_up"
      && Number.isSafeInteger(scope.authenticationTime)
      && authenticationTimeMs <= now + 30_000
      && expiresAtMs > now;
    return {
      level: scope.authenticationAssurance === "step_up" ? "step_up" : "baseline",
      fresh,
      expiresAt: fresh ? nowIso(expiresAtMs) : ""
    };
  }

  execute<T>(input: AdminChangeExecutionInput, operation: () => T, now = Date.now()): AdminChangeExecution<T> {
    const prepared = this.prepare(input);
    const scope = currentRequestScope();
    const assurance = this.requireFreshStepUp(now);
    const policy = ADMIN_CHANGE_OPERATION_POLICIES[prepared.operationType];

    if (assurance === "local_trusted" || policy.controlLevel === "step_up") {
      return this.db.transaction(() => {
        const requestId = newId("admin_change");
        const timestamp = nowIso(now);
        this.insertRequest({
          ...prepared,
          id: requestId,
          status: "consumed",
          assurance,
          expiresAt: timestamp,
          approvedAt: "",
          consumedAt: timestamp,
          createdAt: timestamp
        });
        this.event(requestId, assurance === "local_trusted" ? "local_trusted_consumed" : "consumed", input.correlationId, now);
        const result = operation();
        this.auditChange(requestId, prepared.operationType, prepared.targetKey, "consumed", input.correlationId, now);
        return { disposition: "executed" as const, request: this.detailUnchecked(requestId), result };
      });
    }

    let suppliedRequestId = input.changeRequestId;
    if (!suppliedRequestId) {
      const active = this.request(prepared, assurance, now);
      if (active.status !== "approved") return { disposition: "pending_approval", request: active };
      suppliedRequestId = active.id;
    }

    const requestId = cleanText(suppliedRequestId, 120);
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw new AdminChangeControlError("change_request_invalid", 400, "The change request ID is invalid.");
    }
    const existing = this.row(requestId);
    if (!existing) throw new AdminChangeControlError("change_request_not_found", 404, "The change request does not exist.");
    if (new Date(existing.expiresAt).getTime() <= now && existing.status !== "consumed") {
      this.expire(existing, input.correlationId, now);
      throw new AdminChangeControlError("change_request_expired", 409, "The change request expired before execution.");
    }
    if (existing.operationType !== prepared.operationType
      || existing.targetKey !== prepared.targetKey
      || existing.payloadHash !== prepared.payloadHash) {
      throw new AdminChangeControlError("change_request_mismatch", 409, "The approved change does not match this exact operation payload.");
    }
    if (existing.status !== "approved") {
      throw new AdminChangeControlError("change_request_not_ready", 409, "The change request has not received an independent approval.");
    }
    return this.db.transaction(() => {
      const claimed = this.db.run(
        `UPDATE admin_change_requests
         SET status = 'consumed', consumed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status = 'approved'`,
        nowIso(now),
        nowIso(now),
        requestId,
        scope.tenantId
      );
      if (Number(claimed.changes) !== 1) {
        throw new AdminChangeControlError("change_request_not_ready", 409, "The approved change was already consumed or is no longer available.");
      }
      const result = operation();
      this.event(requestId, "consumed", input.correlationId, now);
      this.auditChange(requestId, prepared.operationType, prepared.targetKey, "consumed", input.correlationId, now);
      return { disposition: "executed" as const, request: this.detailUnchecked(requestId), result };
    });
  }

  decide(
    requestId: string,
    input: { decision: "approve" | "reject"; confirmation: string },
    correlationId: string,
    now = Date.now()
  ): AdminChangeRequest {
    this.authorization.require("change.approve");
    const reviewerAssurance = this.requireFreshStepUp(now);
    const id = cleanText(requestId, 120);
    if (!REQUEST_ID_PATTERN.test(id) || !["approve", "reject"].includes(input?.decision)) {
      throw new AdminChangeControlError("change_request_invalid", 400, "A valid change request decision is required.");
    }
    const expectedConfirmation = input.decision === "approve" ? "APPROVE_HIGH_RISK_CHANGE" : "REJECT_HIGH_RISK_CHANGE";
    if (input.confirmation !== expectedConfirmation) {
      throw new AdminChangeControlError(
        "change_decision_confirmation_required",
        400,
        `Type ${expectedConfirmation} to confirm this decision.`
      );
    }
    const row = this.row(id);
    if (!row) throw new AdminChangeControlError("change_request_not_found", 404, "The change request does not exist.");
    if (new Date(row.expiresAt).getTime() <= now) {
      this.expire(row, correlationId, now);
      throw new AdminChangeControlError("change_request_expired", 409, "The change request expired before review.");
    }
    if (row.status !== "pending") {
      throw new AdminChangeControlError("change_request_not_ready", 409, "The change request is no longer pending review.");
    }
    const scope = currentRequestScope();
    if (input.decision === "approve"
      && (row.requestedByUserId === scope.userId || row.requestedByActorId === scope.actorId)) {
      throw new AdminChangeControlError(
        "independent_approval_required",
        409,
        "A different authenticated user and actor must approve this safety-expanding change."
      );
    }
    return this.db.transaction(() => {
      const timestamp = nowIso(now);
      this.db.run(
        `INSERT INTO admin_change_decisions(
           id, tenant_id, request_id, decision, reviewer_user_id,
           reviewer_actor_kind, reviewer_actor_id, reviewer_assurance,
           correlation_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId("admin_change_decision"),
        scope.tenantId,
        id,
        input.decision,
        scope.userId,
        scope.actorKind,
        scope.actorId,
        reviewerAssurance,
        this.correlation(correlationId),
        timestamp
      );
      this.db.run(
        `UPDATE admin_change_requests
         SET status = ?, approved_at = CASE WHEN ? = 'approve' THEN ? ELSE '' END, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
        input.decision === "approve" ? "approved" : "rejected",
        input.decision,
        timestamp,
        timestamp,
        id,
        scope.tenantId
      );
      this.event(id, input.decision === "approve" ? "approved" : "rejected", correlationId, now);
      this.auditChange(id, row.operationType, row.targetKey, input.decision === "approve" ? "approved" : "rejected", correlationId, now);
      return this.detailUnchecked(id);
    });
  }

  /**
   * The live request (pending or approved, unexpired) for one operation on one
   * target, if any. No permission gate: the caller is asking about its own
   * tenant's state so a shopper surface can say "waiting for approval" without
   * admin.read. Payload hash is ignored on purpose; any pending resume counts.
   */
  pendingRequest(operationType: AdminChangeOperationType, targetKey: string, now = Date.now()): AdminChangeRequest | null {
    const row = this.db.get<{ id: string }>(
      `SELECT id FROM admin_change_requests
       WHERE tenant_id = ? AND operation_type = ? AND target_key = ?
         AND status IN ('pending', 'approved') AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      currentRequestScope().tenantId,
      operationType,
      cleanText(targetKey, 200),
      nowIso(now)
    );
    return row ? this.detailUnchecked(row.id) : null;
  }

  list(status: AdminChangeStatus | "all" = "all", limit = 100, offset = 0): AdminChangeRequest[] {
    this.authorization.require("admin.read");
    if (!["pending", "approved", "consumed", "rejected", "expired", "all"].includes(status)) {
      throw new AdminChangeControlError("change_request_invalid", 400, "The change request status filter is invalid.");
    }
    const scope = currentRequestScope();
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));
    const safeOffset = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
    return this.db.all<{ id: string }>(
      `SELECT id FROM admin_change_requests
       WHERE tenant_id = ? AND (? = 'all' OR status = ?)
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      scope.tenantId,
      status,
      status,
      safeLimit,
      safeOffset
    ).map((item) => this.detailUnchecked(item.id));
  }

  detail(requestId: string): AdminChangeRequest {
    this.authorization.require("admin.read");
    const id = cleanText(requestId, 120);
    if (!REQUEST_ID_PATTERN.test(id) || !this.row(id)) {
      throw new AdminChangeControlError("change_request_not_found", 404, "The change request does not exist.");
    }
    return this.detailUnchecked(id);
  }

  counts(now = Date.now()): { total: number; pending: number; approved: number; consumed: number; rejected: number; expired: number } {
    const scope = currentRequestScope();
    const row = this.db.get<{ total: number; pending: number; approved: number; consumed: number; rejected: number; expired: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' AND expires_at > ? THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'approved' AND expires_at > ? THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN status = 'consumed' THEN 1 ELSE 0 END) AS consumed,
              SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN status = 'expired' OR (status IN ('pending', 'approved') AND expires_at <= ?) THEN 1 ELSE 0 END) AS expired
       FROM admin_change_requests WHERE tenant_id = ?`,
      nowIso(now),
      nowIso(now),
      nowIso(now),
      scope.tenantId
    );
    return {
      total: Number(row?.total ?? 0),
      pending: Number(row?.pending ?? 0),
      approved: Number(row?.approved ?? 0),
      consumed: Number(row?.consumed ?? 0),
      rejected: Number(row?.rejected ?? 0),
      expired: Number(row?.expired ?? 0)
    };
  }

  private prepare(input: AdminChangeExecutionInput): {
    operationType: AdminChangeOperationType;
    targetKey: string;
    payloadHash: string;
    summary: AdminChangeSummary;
    correlationId: string;
  } {
    if (!(input?.operationType in ADMIN_CHANGE_OPERATION_POLICIES)) {
      throw new AdminChangeControlError("change_request_invalid", 400, "The protected change operation is not allowlisted.");
    }
    const targetKey = cleanText(input.targetKey, 160);
    if (!TARGET_PATTERN.test(targetKey)) {
      throw new AdminChangeControlError("change_request_invalid", 400, "The protected change target is invalid.");
    }
    const operationType = input.operationType;
    const canonicalPayload = JSON.stringify(canonicalValue(input.payload));
    const payloadHash = stableHash("yoink_admin_change_payload_v1", operationType, targetKey, canonicalPayload);
    return {
      operationType,
      targetKey,
      payloadHash,
      summary: normalizedSummary(operationType, input.summary),
      correlationId: this.correlation(input.correlationId)
    };
  }

  private request(
    prepared: ReturnType<AdminChangeControlRepository["prepare"]>,
    assurance: "step_up",
    now: number
  ): AdminChangeRequest {
    const existing = this.db.get<{ id: string }>(
      `SELECT id FROM admin_change_requests
       WHERE tenant_id = ? AND operation_type = ? AND target_key = ?
         AND payload_hash = ? AND status IN ('pending', 'approved') AND expires_at > ?`,
      currentRequestScope().tenantId,
      prepared.operationType,
      prepared.targetKey,
      prepared.payloadHash,
      nowIso(now)
    );
    if (existing) return this.detailUnchecked(existing.id);
    const stale = this.db.get<{ id: string }>(
      `SELECT id FROM admin_change_requests
       WHERE tenant_id = ? AND operation_type = ? AND target_key = ?
         AND payload_hash = ? AND status IN ('pending', 'approved') AND expires_at <= ?`,
      currentRequestScope().tenantId,
      prepared.operationType,
      prepared.targetKey,
      prepared.payloadHash,
      nowIso(now)
    );
    if (stale) {
      const staleRow = this.row(stale.id);
      if (staleRow) this.expire(staleRow, prepared.correlationId, now);
    }
    return this.db.transaction(() => {
      const id = newId("admin_change");
      const timestamp = nowIso(now);
      this.insertRequest({
        ...prepared,
        id,
        status: "pending",
        assurance,
        expiresAt: nowIso(now + this.requestTtlSeconds * 1_000),
        approvedAt: "",
        consumedAt: "",
        createdAt: timestamp
      });
      this.event(id, "requested", prepared.correlationId, now);
      this.auditChange(id, prepared.operationType, prepared.targetKey, "requested", prepared.correlationId, now);
      return this.detailUnchecked(id);
    });
  }

  private insertRequest(input: {
    id: string;
    operationType: AdminChangeOperationType;
    targetKey: string;
    payloadHash: string;
    summary: AdminChangeSummary;
    correlationId: string;
    status: AdminChangeStatus;
    assurance: "step_up" | "local_trusted";
    expiresAt: string;
    approvedAt: string;
    consumedAt: string;
    createdAt: string;
  }): void {
    const scope = currentRequestScope();
    if (scope.actorKind !== "maintainer" && scope.actorKind !== "user") {
      throw new AdminChangeControlError("step_up_required", 403, "A human administrator must authorize this change.");
    }
    this.db.run(
      `INSERT INTO admin_change_requests(
         id, tenant_id, operation_type, target_key, payload_hash, summary_json,
         control_level, status, requested_by_user_id, requested_by_actor_kind,
         requested_by_actor_id, requested_assurance, correlation_id, expires_at,
         approved_at, consumed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      scope.tenantId,
      input.operationType,
      input.targetKey,
      input.payloadHash,
      JSON.stringify(input.summary),
      ADMIN_CHANGE_OPERATION_POLICIES[input.operationType].controlLevel,
      input.status,
      scope.userId,
      scope.actorKind,
      scope.actorId,
      input.assurance,
      input.correlationId,
      input.expiresAt,
      input.approvedAt,
      input.consumedAt,
      input.createdAt,
      input.createdAt
    );
  }

  private row(requestId: string): ChangeRow | undefined {
    return this.db.get<ChangeRow>(
      `SELECT id, tenant_id AS tenantId, operation_type AS operationType,
              target_key AS targetKey, payload_hash AS payloadHash,
              summary_json AS summaryJson, control_level AS controlLevel,
              status, requested_by_user_id AS requestedByUserId,
              requested_by_actor_kind AS requestedByActorKind,
              requested_by_actor_id AS requestedByActorId,
              requested_assurance AS requestedAssurance,
              correlation_id AS correlationId, expires_at AS expiresAt,
              approved_at AS approvedAt, consumed_at AS consumedAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM admin_change_requests WHERE id = ? AND tenant_id = ?`,
      requestId,
      currentRequestScope().tenantId
    );
  }

  private detailUnchecked(requestId: string): AdminChangeRequest {
    const row = this.row(requestId);
    if (!row) throw new AdminChangeControlError("change_request_not_found", 404, "The change request does not exist.");
    const requester = this.db.get<{ displayName: string }>(
      "SELECT display_name AS displayName FROM users WHERE tenant_id = ? AND id = ?",
      row.tenantId,
      row.requestedByUserId
    );
    const decisions = this.db.all<{
      id: string;
      decision: "approve" | "reject";
      reviewerUserId: string;
      reviewerDisplayName: string;
      reviewerActorKind: "maintainer" | "user";
      createdAt: string;
    }>(
      `SELECT d.id, d.decision, d.reviewer_user_id AS reviewerUserId,
              u.display_name AS reviewerDisplayName,
              d.reviewer_actor_kind AS reviewerActorKind,
              d.created_at AS createdAt
       FROM admin_change_decisions d
       JOIN users u ON u.id = d.reviewer_user_id AND u.tenant_id = d.tenant_id
       WHERE d.tenant_id = ? AND d.request_id = ?
       ORDER BY d.created_at, d.id`,
      row.tenantId,
      row.id
    );
    const events = this.db.all<{
      id: string;
      sequence: number;
      eventType: string;
      actorKind: "maintainer" | "user";
      correlationId: string;
      privacyClassification: "restricted_admin";
      createdAt: string;
    }>(
      `SELECT id, sequence, event_type AS eventType, actor_kind AS actorKind,
              correlation_id AS correlationId,
              privacy_classification AS privacyClassification,
              created_at AS createdAt
       FROM admin_change_events
       WHERE tenant_id = ? AND request_id = ? ORDER BY sequence, id`,
      row.tenantId,
      row.id
    );
    return {
      id: row.id,
      operationType: row.operationType,
      operationLabel: ADMIN_CHANGE_OPERATION_POLICIES[row.operationType].label,
      targetKey: row.targetKey,
      summary: parsedSummary(row.summaryJson),
      controlLevel: row.controlLevel,
      status: row.status,
      requestedByUserId: row.requestedByUserId,
      requestedByDisplayName: requester?.displayName ?? "Unknown operator",
      requestedByActorKind: row.requestedByActorKind,
      requestedAssurance: row.requestedAssurance,
      correlationId: row.correlationId,
      expiresAt: row.expiresAt,
      approvedAt: row.approvedAt,
      consumedAt: row.consumedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      decisions,
      events
    };
  }

  private event(
    requestId: string,
    eventType: "requested" | "approved" | "rejected" | "consumed" | "expired" | "local_trusted_consumed",
    correlationId: string,
    now: number
  ): void {
    const scope = currentRequestScope();
    if (scope.actorKind !== "maintainer" && scope.actorKind !== "user") {
      throw new AdminChangeControlError("step_up_required", 403, "A human administrator must authorize this change.");
    }
    const sequence = Number(this.db.get<{ sequence: number }>(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM admin_change_events WHERE request_id = ?",
      requestId
    )?.sequence ?? 1);
    this.db.run(
      `INSERT INTO admin_change_events(
         id, tenant_id, request_id, sequence, event_type, actor_kind,
         actor_id, correlation_id, privacy_classification, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'restricted_admin', ?)`,
      newId("admin_change_event"),
      scope.tenantId,
      requestId,
      sequence,
      eventType,
      scope.actorKind,
      scope.actorId,
      this.correlation(correlationId),
      nowIso(now)
    );
  }

  private expire(row: ChangeRow, correlationId: string, now: number): void {
    if (row.status !== "pending" && row.status !== "approved") return;
    this.db.transaction(() => {
      const result = this.db.run(
        `UPDATE admin_change_requests SET status = 'expired', updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'approved')`,
        nowIso(now),
        row.id,
        row.tenantId
      );
      if (Number(result.changes) === 1) {
        this.event(row.id, "expired", correlationId, now);
        this.auditChange(row.id, row.operationType, row.targetKey, "expired", correlationId, now);
      }
    });
  }

  private auditChange(
    requestId: string,
    operationType: AdminChangeOperationType,
    targetKey: string,
    state: "requested" | "approved" | "rejected" | "consumed" | "expired",
    correlationId: string,
    now: number
  ): void {
    this.audit.record({
      correlationId: this.correlation(correlationId),
      aggregateType: "admin_change_request",
      eventType: `admin_change_${state}`,
      reasonCode: operationType,
      message: `A protected administrative change was ${state}.`,
      data: { requestId, operationType, targetKey, state }
    }, now);
  }

  private correlation(value: unknown): string {
    const correlation = cleanText(value, 160);
    return CORRELATION_PATTERN.test(correlation) ? correlation : newId("change_correlation");
  }
}
