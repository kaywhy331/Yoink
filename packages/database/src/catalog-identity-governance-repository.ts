import type {
  CatalogIdentityOperationDecisionInput,
  CatalogIdentityOperationProposalInput
} from "../../contracts/src/index.js";
import {
  CATALOG_IDENTITY_APPROVAL_CONFIRMATION,
  CATALOG_IDENTITY_OPERATION_CONFIRMATION,
  CATALOG_IDENTITY_REJECTION_CONFIRMATION
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText, normalizedKey } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;
const ATTRIBUTE_KEYS = new Set(["size", "color", "edition", "language", "pack", "condition", "finish", "style"]);
const TERMINAL_JOB_STATES = ["notify_only", "confirmed", "offer_rejected", "expired", "cancelled"];

export class CatalogIdentityGovernanceError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "CatalogIdentityGovernanceError";
  }
}

type OperationKind = "merge_variants" | "split_variant" | "rollback";
type OperationStatus = "pending" | "applied" | "rejected";

interface MergePayload {
  kind: "merge_variants";
  sourceVariantId: string;
  targetVariantId: string;
  reviewedIdentityClaimId: string;
  reasonCode: string;
}

interface SplitPayload {
  kind: "split_variant";
  sourceVariantId: string;
  listingIds: string[];
  newTitle: string;
  newBrand: string;
  newVariantAttributes: Record<string, string>;
  reasonCode: string;
}

interface RollbackPayload {
  kind: "rollback";
  reversedOperationId: string;
  reasonCode: string;
}

type OperationPayload = MergePayload | SplitPayload | RollbackPayload;

interface OperationRow {
  id: string;
  tenantId: string;
  operationKind: OperationKind;
  requestedByUserId: string;
  requestedByActorKind: string;
  requestedByActorId: string;
  payloadJson: string;
  payloadHash: string;
  baseStateHash: string;
  status: OperationStatus;
  requiresDistinctApprover: number;
  reviewNote: string;
  reviewedByActorId: string;
  decidedAt: string;
  appliedAt: string;
  reversedOperationId: string | null;
  revertedByOperationId: string | null;
  resultJson: string;
  createdAt: string;
  updatedAt: string;
}

interface SnapshotRow {
  phase: "before" | "after";
  snapshotJson: string;
  snapshotHash: string;
  createdAt: string;
}

interface TopologyVariant {
  id: string;
  familyId: string;
  title: string;
  attributes: Record<string, string>;
}

interface VariantTopology {
  variantIds: string[];
  variants: TopologyVariant[];
  listings: Array<{ id: string; variantId: string; retailerId: string; retailerSku: string }>;
  identifiers: Array<{ id: string; variantId: string; kind: string; value: string; retailerId: string; verified: number }>;
  sourceProducts: Array<{ id: string; variantId: string; sourceConnectionId: string; externalProductId: string }>;
  sourceAliases: Array<{ id: string; variantId: string; sourceConnectionId: string; aliasKind: string; aliasValue: string }>;
  sourceCandidates: Array<{ id: string; variantId: string; sourceConnectionId: string; externalListingId: string; retailerId: string; retailerSku: string }>;
  preferredListings: Array<{ sourceConnectionId: string; variantId: string; retailerId: string; listingId: string }>;
  missions: Array<{ id: string; userId: string; variantId: string; targetListingIds: string[] }>;
  identityClaims: Array<{ id: string; currentVariantId: string; claimedVariantId: string; state: string }>;
  resolutionDecisions: Array<{ id: string; variantId: string; listingId: string }>;
  activeJobIds: string[];
  activeReservationIds: string[];
}

export interface CatalogIdentityOperation {
  id: string;
  tenantId: string;
  kind: OperationKind;
  requestedByUserId: string;
  requestedByActorKind: string;
  requestedByActorId: string;
  payload: OperationPayload;
  payloadHash: string;
  baseStateHash: string;
  status: OperationStatus;
  requiresDistinctApprover: boolean;
  reviewNote: string;
  reviewedByActorId: string;
  decidedAt: string;
  appliedAt: string;
  reversedOperationId: string;
  revertedByOperationId: string;
  result: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const SELECT_OPERATION = `
  SELECT id, tenant_id AS tenantId, operation_kind AS operationKind,
         requested_by_user_id AS requestedByUserId,
         requested_by_actor_kind AS requestedByActorKind,
         requested_by_actor_id AS requestedByActorId,
         payload_json AS payloadJson, payload_hash AS payloadHash,
         base_state_hash AS baseStateHash, status,
         requires_distinct_approver AS requiresDistinctApprover,
         review_note AS reviewNote, reviewed_by_actor_id AS reviewedByActorId,
         decided_at AS decidedAt, applied_at AS appliedAt,
         reversed_operation_id AS reversedOperationId,
         reverted_by_operation_id AS revertedByOperationId,
         result_json AS resultJson, created_at AS createdAt, updated_at AS updatedAt
  FROM catalog_identity_operations`;

function parsedObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function operationFromRow(row: OperationRow): CatalogIdentityOperation {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.operationKind,
    requestedByUserId: row.requestedByUserId,
    requestedByActorKind: row.requestedByActorKind,
    requestedByActorId: row.requestedByActorId,
    payload: parsedObject(row.payloadJson) as unknown as OperationPayload,
    payloadHash: row.payloadHash,
    baseStateHash: row.baseStateHash,
    status: row.status,
    requiresDistinctApprover: row.requiresDistinctApprover === 1,
    reviewNote: row.reviewNote,
    reviewedByActorId: row.reviewedByActorId,
    decidedAt: row.decidedAt,
    appliedAt: row.appliedAt,
    reversedOperationId: row.reversedOperationId ?? "",
    revertedByOperationId: row.revertedByOperationId ?? "",
    result: parsedObject(row.resultJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function requiredId(value: unknown, label: string): string {
  const id = cleanText(value, 120);
  if (!ID_PATTERN.test(id)) throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, `The ${label} is invalid.`);
  return id;
}

function reasonCode(value: unknown): string {
  const reason = normalizedKey(cleanText(value, 80), 80).replace(/[^a-z0-9_]/g, "_");
  if (!REASON_PATTERN.test(reason)) {
    throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "A short non-sensitive reason code is required.");
  }
  return reason;
}

function attributes(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "Explicit variant attributes are required for a split.");
  }
  const result: Record<string, string> = {};
  for (const rawKey of Object.keys(value as Record<string, unknown>).sort()) {
    const key = normalizedKey(rawKey, 40).replace(/[^a-z0-9_-]/g, "");
    if (!ATTRIBUTE_KEYS.has(key)) {
      throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, `Variant attribute ${key || "unknown"} is not allowlisted.`);
    }
    const item = cleanText((value as Record<string, unknown>)[rawKey], 120);
    if (item) result[key] = item;
  }
  if (!Object.keys(result).length) {
    throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "At least one explicit variant dimension is required for a split.");
  }
  return result;
}

function parseVariantAttributes(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const key of Object.keys(parsed as Record<string, unknown>).sort()) {
      const normalized = normalizedKey(key, 40).replace(/[^a-z0-9_-]/g, "");
      if (!ATTRIBUTE_KEYS.has(normalized)) continue;
      const item = cleanText((parsed as Record<string, unknown>)[key], 120);
      if (item) result[normalized] = item;
    }
    return result;
  } catch {
    return {};
  }
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function page(limit: number, offset: number): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.min(200, Math.floor(Number(limit) || 100))),
    offset: Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0
  };
}

export class CatalogIdentityGovernanceRepository {
  private readonly authorization: AuthorizationRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.authorization = new AuthorizationRepository(db);
    this.audit = new AuditRepository(db);
  }

  propose(input: CatalogIdentityOperationProposalInput, now = Date.now()): {
    operation: CatalogIdentityOperation;
    disposition: "created" | "duplicate_pending";
  } {
    this.authorization.require("catalog.identity.propose");
    if (input?.confirmation !== CATALOG_IDENTITY_OPERATION_CONFIRMATION) {
      throw new CatalogIdentityGovernanceError("catalog_identity_confirmation_required", 400, "Explicit catalog identity proposal confirmation is required.");
    }
    const payload = this.normalizedPayload(input);
    const topology = this.proposalTopology(payload);
    this.assertNoActiveWork(topology);
    const baseStateHash = this.topologyHash(topology);
    const payloadJson = JSON.stringify(payload);
    const payloadHash = stableHash("catalog-identity-operation-v1", currentRequestScope().tenantId, payloadJson, baseStateHash);
    const duplicate = this.db.get<OperationRow>(
      `${SELECT_OPERATION} WHERE tenant_id = ? AND payload_hash = ? AND status = 'pending'`,
      currentRequestScope().tenantId,
      payloadHash
    );
    if (duplicate) return { operation: operationFromRow(duplicate), disposition: "duplicate_pending" };

    const id = newId("catalog_identity_operation");
    const timestamp = nowIso(now);
    const requiresDistinctApprover = payload.kind === "merge_variants"
      || (payload.kind === "rollback" && this.requireOperation(payload.reversedOperationId).kind === "split_variant");
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO catalog_identity_operations(
           id, tenant_id, operation_kind, requested_by_user_id,
           requested_by_actor_kind, requested_by_actor_id, payload_json,
           payload_hash, base_state_hash, status, requires_distinct_approver,
           reversed_operation_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        id,
        currentRequestScope().tenantId,
        payload.kind,
        currentRequestScope().userId,
        currentRequestScope().actorKind,
        currentRequestScope().actorId,
        payloadJson,
        payloadHash,
        baseStateHash,
        requiresDistinctApprover ? 1 : 0,
        payload.kind === "rollback" ? payload.reversedOperationId : null,
        timestamp,
        timestamp
      );
      this.storeSnapshot(id, "before", topology, baseStateHash, now);
      this.recordEvent(id, "proposed", payload.reasonCode, baseStateHash, {
        kind: payload.kind,
        requiresDistinctApprover
      }, now);
      this.audit.record({
        correlationId: id,
        aggregateType: "catalog_identity_operation",
        eventType: "catalog_identity_operation_proposed",
        reasonCode: payload.reasonCode,
        message: "A reversible catalog identity operation was submitted for governed review.",
        data: { operationId: id, kind: payload.kind, payloadHash, baseStateHash, requiresDistinctApprover }
      }, now);
    });
    return { operation: this.requireOperation(id), disposition: "created" };
  }

  list(status: OperationStatus | "all" = "pending", limit = 100, offset = 0): CatalogIdentityOperation[] {
    this.authorization.require("admin.read");
    if (!["pending", "applied", "rejected", "all"].includes(status)) {
      throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "The catalog identity operation status filter is invalid.");
    }
    const selected = status;
    const pagination = page(limit, offset);
    return this.db.all<OperationRow>(
      `${SELECT_OPERATION}
       WHERE tenant_id = ? AND (? = 'all' OR status = ?)
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      currentRequestScope().tenantId,
      selected,
      selected,
      pagination.limit,
      pagination.offset
    ).map(operationFromRow);
  }

  detail(id: string): Record<string, unknown> {
    this.authorization.require("admin.read");
    const operation = this.requireOperation(requiredId(id, "catalog identity operation ID"));
    const snapshots = this.db.all<SnapshotRow>(
      `SELECT phase, snapshot_json AS snapshotJson, snapshot_hash AS snapshotHash,
              created_at AS createdAt
       FROM catalog_identity_operation_snapshots
       WHERE tenant_id = ? AND operation_id = ? ORDER BY phase`,
      currentRequestScope().tenantId,
      operation.id
    ).map((snapshot) => ({
      phase: snapshot.phase,
      snapshotHash: snapshot.snapshotHash,
      snapshot: JSON.parse(snapshot.snapshotJson) as unknown,
      createdAt: snapshot.createdAt
    }));
    const events = this.db.all<Record<string, unknown>>(
      `SELECT id, sequence, event_type AS eventType, actor_kind AS actorKind,
              actor_id AS actorId, reason_code AS reasonCode,
              state_hash AS stateHash, data_json AS dataJson,
              created_at AS createdAt
       FROM catalog_identity_operation_events
       WHERE tenant_id = ? AND operation_id = ? ORDER BY sequence`,
      currentRequestScope().tenantId,
      operation.id
    ).map((event) => ({ ...event, data: parsedObject(String(event.dataJson ?? "{}")), dataJson: undefined }));
    return { operation, snapshots, events };
  }

  counts(): { catalogIdentityOperations: number; pendingCatalogIdentityOperations: number; appliedCatalogIdentityOperations: number } {
    const row = this.db.get<{ total: number; pending: number; applied: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) AS applied
       FROM catalog_identity_operations WHERE tenant_id = ?`,
      currentRequestScope().tenantId
    );
    return {
      catalogIdentityOperations: Number(row?.total ?? 0),
      pendingCatalogIdentityOperations: Number(row?.pending ?? 0),
      appliedCatalogIdentityOperations: Number(row?.applied ?? 0)
    };
  }

  decide(id: string, input: CatalogIdentityOperationDecisionInput, now = Date.now()): {
    operation: CatalogIdentityOperation;
    replayed: boolean;
  } {
    this.authorization.require("catalog.identity.approve");
    const operationId = requiredId(id, "catalog identity operation ID");
    const outcome = input?.outcome;
    const expectedConfirmation = outcome === "approve"
      ? CATALOG_IDENTITY_APPROVAL_CONFIRMATION
      : outcome === "reject" ? CATALOG_IDENTITY_REJECTION_CONFIRMATION : "";
    if (!expectedConfirmation || input?.confirmation !== expectedConfirmation) {
      throw new CatalogIdentityGovernanceError("catalog_identity_confirmation_required", 400, "The review outcome and explicit confirmation are required.");
    }
    const note = cleanText(input.note, 500);
    if (!note) throw new CatalogIdentityGovernanceError("catalog_identity_review_note_required", 400, "A non-sensitive review note is required.");

    return this.db.transaction(() => {
      const operation = this.requireOperation(operationId);
      const desiredStatus: OperationStatus = outcome === "approve" ? "applied" : "rejected";
      if (operation.status === desiredStatus) return { operation, replayed: true };
      if (operation.status !== "pending") {
        throw new CatalogIdentityGovernanceError("catalog_identity_operation_terminal", 409, "Only a pending catalog identity operation can be reviewed.");
      }
      const scope = currentRequestScope();
      if (outcome === "approve" && operation.requiresDistinctApprover
        && (operation.requestedByUserId === scope.userId || operation.requestedByActorId === scope.actorId)) {
        throw new CatalogIdentityGovernanceError(
          "catalog_identity_independent_approval_required",
          409,
          "This safety-expanding identity operation requires approval by a different authorized user and actor."
        );
      }

      const timestamp = nowIso(now);
      if (outcome === "reject") {
        this.db.run(
          `UPDATE catalog_identity_operations
           SET status = 'rejected', review_note = ?, reviewed_by_actor_id = ?,
               decided_at = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
          note,
          scope.actorId,
          timestamp,
          timestamp,
          operationId,
          scope.tenantId
        );
        this.recordEvent(operationId, "rejected", "review_rejected", operation.baseStateHash, { note }, now);
        this.audit.record({
          correlationId: operationId,
          aggregateType: "catalog_identity_operation",
          eventType: "catalog_identity_operation_rejected",
          reasonCode: "review_rejected",
          message: "The catalog identity operation was rejected without changing catalog topology.",
          data: { operationId, kind: operation.kind, reviewerActorId: scope.actorId }
        }, now);
        return { operation: this.requireOperation(operationId), replayed: false };
      }

      this.assertSingleTenantCatalogScope();
      const currentTopology = this.proposalTopology(operation.payload);
      this.assertNoActiveWork(currentTopology);
      const currentHash = this.topologyHash(currentTopology);
      if (currentHash !== operation.baseStateHash) {
        throw new CatalogIdentityGovernanceError(
          "catalog_identity_topology_stale",
          409,
          "Catalog topology changed after this operation was proposed. Submit a fresh reviewed operation."
        );
      }
      this.recordEvent(operationId, "approved", "review_approved", currentHash, { note }, now);
      const applied = this.apply(operation, currentTopology, now);
      const afterHash = this.topologyHash(applied.afterTopology);
      this.storeSnapshot(operationId, "after", applied.afterTopology, afterHash, now);
      this.db.run(
        `UPDATE catalog_identity_operations
         SET status = 'applied', review_note = ?, reviewed_by_actor_id = ?,
             decided_at = ?, applied_at = ?, result_json = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
        note,
        scope.actorId,
        timestamp,
        timestamp,
        JSON.stringify(applied.result),
        timestamp,
        operationId,
        scope.tenantId
      );
      if (operation.kind === "rollback") {
        this.db.run(
          `UPDATE catalog_identity_operations SET reverted_by_operation_id = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND status = 'applied' AND reverted_by_operation_id IS NULL`,
          operationId,
          timestamp,
          operation.reversedOperationId,
          scope.tenantId
        );
      }
      this.recordEvent(operationId, "applied", operation.payload.reasonCode, afterHash, applied.result, now);
      if (operation.kind === "rollback") {
        this.recordEvent(operationId, "compensated", operation.payload.reasonCode, afterHash, {
          reversedOperationId: operation.reversedOperationId
        }, now);
      }
      this.audit.record({
        correlationId: operationId,
        aggregateType: "catalog_identity_operation",
        eventType: operation.kind === "rollback"
          ? "catalog_identity_operation_compensated"
          : "catalog_identity_operation_applied",
        reasonCode: operation.payload.reasonCode,
        message: operation.kind === "rollback"
          ? "A reviewed compensating catalog operation restored the prior exact topology."
          : "A reviewed catalog identity operation was applied with immutable before and after snapshots.",
        data: { operationId, kind: operation.kind, reviewerActorId: scope.actorId, beforeHash: currentHash, afterHash }
      }, now);
      return { operation: this.requireOperation(operationId), replayed: false };
    });
  }

  private normalizedPayload(input: CatalogIdentityOperationProposalInput): OperationPayload {
    if (!input || typeof input !== "object") {
      throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "A catalog identity operation is required.");
    }
    if (input.kind === "merge_variants") {
      const sourceVariantId = requiredId(input.sourceVariantId, "source variant ID");
      const targetVariantId = requiredId(input.targetVariantId, "target variant ID");
      if (sourceVariantId === targetVariantId) {
        throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "A merge requires two different exact variants.");
      }
      return {
        kind: input.kind,
        sourceVariantId,
        targetVariantId,
        reviewedIdentityClaimId: requiredId(input.reviewedIdentityClaimId, "reviewed identity claim ID"),
        reasonCode: reasonCode(input.reasonCode)
      };
    }
    if (input.kind === "split_variant") {
      if (!Array.isArray(input.listingIds) || input.listingIds.length < 1 || input.listingIds.length > 100) {
        throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "A split requires one through 100 exact listing IDs.");
      }
      const listingIds = [...new Set(input.listingIds.map((id) => requiredId(id, "listing ID")))].sort();
      if (listingIds.length !== input.listingIds.length) {
        throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "Split listing IDs must be unique.");
      }
      const newTitle = cleanText(input.newTitle, 240);
      if (!newTitle) throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "A split exact-variant title is required.");
      return {
        kind: input.kind,
        sourceVariantId: requiredId(input.sourceVariantId, "source variant ID"),
        listingIds,
        newTitle,
        newBrand: cleanText(input.newBrand, 160),
        newVariantAttributes: attributes(input.newVariantAttributes),
        reasonCode: reasonCode(input.reasonCode)
      };
    }
    if (input.kind === "rollback") {
      return {
        kind: input.kind,
        reversedOperationId: requiredId(input.reversedOperationId, "reversed operation ID"),
        reasonCode: reasonCode(input.reasonCode)
      };
    }
    throw new CatalogIdentityGovernanceError("catalog_identity_input_invalid", 400, "A supported catalog identity operation kind is required.");
  }

  private proposalTopology(payload: OperationPayload): VariantTopology {
    if (payload.kind === "merge_variants") {
      this.assertReviewedMergeEvidence(payload);
      return this.topology([payload.sourceVariantId, payload.targetVariantId]);
    }
    if (payload.kind === "split_variant") {
      const topology = this.topology([payload.sourceVariantId]);
      this.assertValidSplit(payload, topology);
      return topology;
    }
    const reversed = this.requireOperation(payload.reversedOperationId);
    if (reversed.kind === "rollback" || reversed.status !== "applied") {
      throw new CatalogIdentityGovernanceError("catalog_identity_rollback_invalid", 409, "Only an applied merge or split can be compensated.");
    }
    if (reversed.revertedByOperationId) {
      throw new CatalogIdentityGovernanceError("catalog_identity_already_reverted", 409, "The catalog identity operation already has an applied compensating operation.");
    }
    const after = this.requireSnapshot(reversed.id, "after");
    return this.topology(after.variantIds);
  }

  private assertReviewedMergeEvidence(payload: MergePayload): void {
    const claim = this.db.get<{
      state: string;
      currentVariantId: string;
      claimedVariantId: string;
      listingVariantId: string;
      referenceVariantId: string;
      conflictReason: string;
    }>(
      `SELECT c.claim_state AS state, c.current_variant_id AS currentVariantId,
              c.claimed_variant_id AS claimedVariantId,
              l.variant_id AS listingVariantId, rl.variant_id AS referenceVariantId,
              c.conflict_reason AS conflictReason
       FROM identity_equivalence_claims c
       JOIN listings l ON l.id = c.listing_id
       JOIN listings rl ON rl.id = c.reference_listing_id
       WHERE c.id = ? AND c.tenant_id = ?`,
      payload.reviewedIdentityClaimId,
      currentRequestScope().tenantId
    );
    if (!claim || claim.state !== "reviewed" || claim.conflictReason) {
      throw new CatalogIdentityGovernanceError("catalog_identity_evidence_required", 409, "A reviewed, conflict-free exact-identifier claim is required for a merge.");
    }
    const pair = new Set([payload.sourceVariantId, payload.targetVariantId]);
    if (!pair.has(claim.currentVariantId) || !pair.has(claim.claimedVariantId)
      || !pair.has(claim.listingVariantId) || !pair.has(claim.referenceVariantId)) {
      throw new CatalogIdentityGovernanceError("catalog_identity_evidence_stale", 409, "The reviewed exact-identifier claim no longer binds the selected variant pair.");
    }
    const variants = this.db.all<{ id: string; attributesJson: string }>(
      `SELECT id, attributes_json AS attributesJson FROM variants WHERE id IN (?, ?) ORDER BY id`,
      payload.sourceVariantId,
      payload.targetVariantId
    );
    if (variants.length !== 2) throw new CatalogIdentityGovernanceError("catalog_identity_variant_not_found", 404, "Both exact variants must exist.");
    const dimensions = variants.map((variant) => JSON.stringify(parseVariantAttributes(variant.attributesJson)));
    if (dimensions[0] !== dimensions[1]) {
      throw new CatalogIdentityGovernanceError("catalog_identity_variant_mismatch", 409, "Variants with different selected dimensions cannot be merged.");
    }
  }

  private assertValidSplit(payload: SplitPayload, topology: VariantTopology): void {
    const source = topology.variants.find((variant) => variant.id === payload.sourceVariantId);
    if (!source) throw new CatalogIdentityGovernanceError("catalog_identity_variant_not_found", 404, "The source exact variant does not exist.");
    const sourceListingIds = topology.listings.filter((listing) => listing.variantId === payload.sourceVariantId).map((listing) => listing.id);
    if (payload.listingIds.some((listingId) => !sourceListingIds.includes(listingId))) {
      throw new CatalogIdentityGovernanceError("catalog_identity_listing_mismatch", 409, "Every split listing must currently belong to the source exact variant.");
    }
    if (payload.listingIds.length >= sourceListingIds.length) {
      throw new CatalogIdentityGovernanceError("catalog_identity_split_not_partial", 409, "A split must leave at least one listing on the source exact variant.");
    }
    if (JSON.stringify(source.attributes) === JSON.stringify(payload.newVariantAttributes)) {
      throw new CatalogIdentityGovernanceError("catalog_identity_split_dimensions_unchanged", 409, "A split must identify a different explicit variant dimension.");
    }
    const selected = new Set(payload.listingIds);
    for (const mission of topology.missions) {
      const selectedTargets = mission.targetListingIds.filter((listingId) => selected.has(listingId)).length;
      if (selectedTargets > 0 && selectedTargets < mission.targetListingIds.length) {
        throw new CatalogIdentityGovernanceError(
          "catalog_identity_split_mission_ambiguous",
          409,
          "A purchase intent spans listings on both sides of this split and must be resolved before catalog identity can change."
        );
      }
    }
  }

  private topology(variantIdsInput: string[]): VariantTopology {
    const variantIds = [...new Set(variantIdsInput.map((id) => requiredId(id, "variant ID")))].sort();
    if (!variantIds.length) throw new CatalogIdentityGovernanceError("catalog_identity_variant_not_found", 404, "At least one exact variant is required.");
    const slots = placeholders(variantIds);
    const variants = this.db.all<{
      id: string;
      familyId: string;
      title: string;
      attributesJson: string;
    }>(
      `SELECT id, family_id AS familyId, title, attributes_json AS attributesJson
       FROM variants WHERE id IN (${slots}) ORDER BY id`,
      ...variantIds
    ).map((variant) => ({
      id: variant.id,
      familyId: variant.familyId,
      title: variant.title,
      attributes: parseVariantAttributes(variant.attributesJson)
    }));
    if (variants.length !== variantIds.length) {
      throw new CatalogIdentityGovernanceError("catalog_identity_variant_not_found", 404, "One or more exact variants do not exist.");
    }
    const listings = this.db.all<VariantTopology["listings"][number]>(
      `SELECT id, variant_id AS variantId, retailer_id AS retailerId, retailer_sku AS retailerSku
       FROM listings WHERE variant_id IN (${slots}) ORDER BY id`,
      ...variantIds
    );
    const identifiers = this.db.all<VariantTopology["identifiers"][number]>(
      `SELECT id, variant_id AS variantId, kind, value,
              COALESCE(retailer_id, '') AS retailerId, verified
       FROM identifiers WHERE variant_id IN (${slots}) ORDER BY id`,
      ...variantIds
    );
    const sourceProducts = this.db.all<VariantTopology["sourceProducts"][number]>(
      `SELECT id, variant_id AS variantId, source_connection_id AS sourceConnectionId,
              external_product_id AS externalProductId
       FROM source_product_refs WHERE variant_id IN (${slots}) ORDER BY id`,
      ...variantIds
    );
    const sourceAliases = this.db.all<VariantTopology["sourceAliases"][number]>(
      `SELECT id, variant_id AS variantId, source_connection_id AS sourceConnectionId,
              alias_kind AS aliasKind, alias_value AS aliasValue
       FROM source_product_aliases WHERE variant_id IN (${slots}) ORDER BY id`,
      ...variantIds
    );
    const sourceCandidates = this.db.all<VariantTopology["sourceCandidates"][number]>(
      `SELECT id, variant_id AS variantId, source_connection_id AS sourceConnectionId,
              external_listing_id AS externalListingId, retailer_id AS retailerId,
              retailer_sku AS retailerSku
       FROM source_listing_candidates WHERE variant_id IN (${slots}) ORDER BY id`,
      ...variantIds
    );
    const preferredListings = this.db.all<VariantTopology["preferredListings"][number]>(
      `SELECT source_connection_id AS sourceConnectionId, variant_id AS variantId,
              retailer_id AS retailerId, listing_id AS listingId
       FROM source_variant_retailer_refs WHERE variant_id IN (${slots})
       ORDER BY source_connection_id, variant_id, retailer_id`,
      ...variantIds
    );
    const missionRows = this.db.all<{ id: string; userId: string; variantId: string }>(
      `SELECT id, user_id AS userId, variant_id AS variantId
       FROM missions WHERE variant_id IN (${slots}) ORDER BY id`,
      ...variantIds
    );
    const missions = missionRows.map((mission) => ({
      ...mission,
      targetListingIds: this.db.all<{ listingId: string }>(
        "SELECT listing_id AS listingId FROM mission_targets WHERE mission_id = ? ORDER BY listing_id",
        mission.id
      ).map((target) => target.listingId)
    }));
    const identityClaims = this.db.all<VariantTopology["identityClaims"][number]>(
      `SELECT id, current_variant_id AS currentVariantId,
              claimed_variant_id AS claimedVariantId, claim_state AS state
       FROM identity_equivalence_claims
       WHERE current_variant_id IN (${slots}) OR claimed_variant_id IN (${slots})
       ORDER BY id`,
      ...variantIds,
      ...variantIds
    );
    const resolutionDecisions = this.db.all<VariantTopology["resolutionDecisions"][number]>(
      `SELECT id, COALESCE(variant_id, '') AS variantId,
              COALESCE(listing_id, '') AS listingId
       FROM resolution_decisions WHERE variant_id IN (${slots}) ORDER BY id`,
      ...variantIds
    );
    const activeJobIds = this.db.all<{ id: string }>(
      `SELECT DISTINCT aj.id
       FROM action_jobs aj
       JOIN listings l ON l.id = aj.listing_id
       JOIN missions m ON m.id = aj.mission_id
       WHERE (l.variant_id IN (${slots}) OR m.variant_id IN (${slots}))
         AND aj.state NOT IN (${placeholders(TERMINAL_JOB_STATES)})
       ORDER BY aj.id`,
      ...variantIds,
      ...variantIds,
      ...TERMINAL_JOB_STATES
    ).map((job) => job.id);
    const activeReservationIds = this.db.all<{ id: string }>(
      `SELECT DISTINCT sr.id
       FROM spend_reservations sr JOIN missions m ON m.id = sr.mission_id
       WHERE m.variant_id IN (${slots}) AND sr.status = 'active'
       ORDER BY sr.id`,
      ...variantIds
    ).map((reservation) => reservation.id);
    return {
      variantIds,
      variants,
      listings,
      identifiers,
      sourceProducts,
      sourceAliases,
      sourceCandidates,
      preferredListings,
      missions,
      identityClaims,
      resolutionDecisions,
      activeJobIds,
      activeReservationIds
    };
  }

  private topologyHash(topology: VariantTopology): string {
    return stableHash("catalog-identity-topology-v1", JSON.stringify(topology));
  }

  private assertNoActiveWork(topology: VariantTopology): void {
    if (topology.activeJobIds.length || topology.activeReservationIds.length) {
      throw new CatalogIdentityGovernanceError(
        "catalog_identity_active_work",
        409,
        "Catalog identity cannot change while an affected purchase action or spend reservation is active."
      );
    }
  }

  private assertSingleTenantCatalogScope(): void {
    const tenantCount = Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM tenants")?.count ?? 0);
    if (tenantCount !== 1) {
      throw new CatalogIdentityGovernanceError(
        "catalog_identity_global_authority_required",
        403,
        "Shared catalog identity mutation is disabled when more than one tenant exists; a future global curator authority is required."
      );
    }
  }

  private apply(operation: CatalogIdentityOperation, before: VariantTopology, now: number): {
    result: Record<string, unknown>;
    afterTopology: VariantTopology;
  } {
    if (operation.payload.kind === "merge_variants") return this.applyMerge(operation.payload, before, now);
    if (operation.payload.kind === "split_variant") return this.applySplit(operation.payload, before, now);
    return this.applyRollback(operation.payload, now);
  }

  private applyMerge(payload: MergePayload, before: VariantTopology, now: number): {
    result: Record<string, unknown>;
    afterTopology: VariantTopology;
  } {
    const source = payload.sourceVariantId;
    const target = payload.targetVariantId;
    const missionConflict = this.db.get<{ userId: string }>(
      `SELECT user_id AS userId FROM missions
       WHERE variant_id IN (?, ?) GROUP BY user_id
       HAVING COUNT(DISTINCT variant_id) > 1 LIMIT 1`,
      source,
      target
    );
    if (missionConflict) {
      throw new CatalogIdentityGovernanceError(
        "catalog_identity_merge_mission_conflict",
        409,
        "One user already has purchase intents for both variants; those intents must be resolved before merging identity."
      );
    }
    const preferredConflict = this.db.get<{ sourceConnectionId: string }>(
      `SELECT s.source_connection_id AS sourceConnectionId
       FROM source_variant_retailer_refs s
       JOIN source_variant_retailer_refs t
         ON t.source_connection_id = s.source_connection_id
        AND t.retailer_id = s.retailer_id AND t.variant_id = ?
       WHERE s.variant_id = ? LIMIT 1`,
      target,
      source
    );
    if (preferredConflict) {
      throw new CatalogIdentityGovernanceError(
        "catalog_identity_merge_preference_conflict",
        409,
        "The variants contain conflicting preferred retailer routes for the same source."
      );
    }
    const timestamp = nowIso(now);
    this.db.run("UPDATE listings SET variant_id = ?, updated_at = ? WHERE variant_id = ?", target, timestamp, source);
    this.db.run("UPDATE identifiers SET variant_id = ? WHERE variant_id = ?", target, source);
    this.db.run("UPDATE source_product_refs SET variant_id = ? WHERE variant_id = ?", target, source);
    this.db.run("UPDATE source_product_aliases SET variant_id = ? WHERE variant_id = ?", target, source);
    this.db.run("UPDATE source_listing_candidates SET variant_id = ?, updated_at = ? WHERE variant_id = ?", target, timestamp, source);
    this.db.run("UPDATE source_variant_retailer_refs SET variant_id = ? WHERE variant_id = ?", target, source);
    this.db.run("UPDATE missions SET variant_id = ?, updated_at = ? WHERE variant_id = ?", target, timestamp, source);
    this.db.run("UPDATE variants SET updated_at = ? WHERE id IN (?, ?)", timestamp, source, target);
    const moved = {
      listingIds: before.listings.filter((item) => item.variantId === source).map((item) => item.id),
      identifierIds: before.identifiers.filter((item) => item.variantId === source).map((item) => item.id),
      sourceProductIds: before.sourceProducts.filter((item) => item.variantId === source).map((item) => item.id),
      sourceAliasIds: before.sourceAliases.filter((item) => item.variantId === source).map((item) => item.id),
      sourceCandidateIds: before.sourceCandidates.filter((item) => item.variantId === source).map((item) => item.id),
      preferredListingIds: before.preferredListings.filter((item) => item.variantId === source).map((item) => item.listingId),
      missionIds: before.missions.filter((item) => item.variantId === source).map((item) => item.id)
    };
    return {
      result: { sourceVariantId: source, targetVariantId: target, reviewedIdentityClaimId: payload.reviewedIdentityClaimId, moved },
      afterTopology: this.topology([source, target])
    };
  }

  private applySplit(payload: SplitPayload, before: VariantTopology, now: number): {
    result: Record<string, unknown>;
    afterTopology: VariantTopology;
  } {
    const timestamp = nowIso(now);
    const newFamilyId = newId("family");
    const newVariantId = newId("variant");
    this.db.run(
      "INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      newFamilyId,
      payload.newTitle,
      payload.newBrand,
      timestamp,
      timestamp
    );
    this.db.run(
      "INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      newVariantId,
      newFamilyId,
      payload.newTitle,
      JSON.stringify(payload.newVariantAttributes),
      timestamp,
      timestamp
    );
    const selected = new Set(payload.listingIds);
    const selectedListings = before.listings.filter((listing) => selected.has(listing.id));
    const movedCandidateIds = before.sourceCandidates.filter((candidate) => selectedListings.some((listing) =>
      listing.retailerId === candidate.retailerId && listing.retailerSku === candidate.retailerSku
    )).map((candidate) => candidate.id);
    const movedPreferred = before.preferredListings.filter((preferred) => selected.has(preferred.listingId));
    const movedMissionIds = before.missions.filter((mission) =>
      mission.targetListingIds.length > 0 && mission.targetListingIds.every((listingId) => selected.has(listingId))
    ).map((mission) => mission.id);
    for (const listingId of payload.listingIds) {
      this.db.run("UPDATE listings SET variant_id = ?, updated_at = ? WHERE id = ? AND variant_id = ?", newVariantId, timestamp, listingId, payload.sourceVariantId);
    }
    for (const candidateId of movedCandidateIds) {
      this.db.run("UPDATE source_listing_candidates SET variant_id = ?, updated_at = ? WHERE id = ?", newVariantId, timestamp, candidateId);
    }
    for (const preferred of movedPreferred) {
      this.db.run(
        `UPDATE source_variant_retailer_refs SET variant_id = ?
         WHERE source_connection_id = ? AND variant_id = ? AND retailer_id = ?`,
        newVariantId,
        preferred.sourceConnectionId,
        payload.sourceVariantId,
        preferred.retailerId
      );
    }
    for (const missionId of movedMissionIds) {
      this.db.run("UPDATE missions SET variant_id = ?, updated_at = ? WHERE id = ? AND variant_id = ?", newVariantId, timestamp, missionId, payload.sourceVariantId);
    }
    this.db.run("UPDATE variants SET updated_at = ? WHERE id = ?", timestamp, payload.sourceVariantId);
    return {
      result: {
        sourceVariantId: payload.sourceVariantId,
        newVariantId,
        newFamilyId,
        listingIds: payload.listingIds,
        movedCandidateIds,
        movedPreferred,
        movedMissionIds
      },
      afterTopology: this.topology([payload.sourceVariantId, newVariantId])
    };
  }

  private applyRollback(payload: RollbackPayload, now: number): {
    result: Record<string, unknown>;
    afterTopology: VariantTopology;
  } {
    const original = this.requireOperation(payload.reversedOperationId);
    const originalBefore = this.requireSnapshot(original.id, "before");
    const originalAfter = this.requireSnapshot(original.id, "after");
    const current = this.topology(originalAfter.variantIds);
    this.assertNoActiveWork(current);
    if (this.topologyHash(current) !== originalAfter.snapshotHash) {
      throw new CatalogIdentityGovernanceError(
        "catalog_identity_rollback_drift",
        409,
        "The applied catalog topology has changed and cannot be compensated automatically."
      );
    }
    const timestamp = nowIso(now);
    if (original.payload.kind === "merge_variants") {
      const source = original.payload.sourceVariantId;
      const target = original.payload.targetVariantId;
      for (const listing of originalBefore.snapshot.listings.filter((item) => item.variantId === source)) {
        this.db.run("UPDATE listings SET variant_id = ?, updated_at = ? WHERE id = ? AND variant_id = ?", source, timestamp, listing.id, target);
      }
      for (const identifier of originalBefore.snapshot.identifiers.filter((item) => item.variantId === source)) {
        this.db.run("UPDATE identifiers SET variant_id = ? WHERE id = ? AND variant_id = ?", source, identifier.id, target);
      }
      for (const item of originalBefore.snapshot.sourceProducts.filter((candidate) => candidate.variantId === source)) {
        this.db.run("UPDATE source_product_refs SET variant_id = ? WHERE id = ? AND variant_id = ?", source, item.id, target);
      }
      for (const item of originalBefore.snapshot.sourceAliases.filter((candidate) => candidate.variantId === source)) {
        this.db.run("UPDATE source_product_aliases SET variant_id = ? WHERE id = ? AND variant_id = ?", source, item.id, target);
      }
      for (const item of originalBefore.snapshot.sourceCandidates.filter((candidate) => candidate.variantId === source)) {
        this.db.run("UPDATE source_listing_candidates SET variant_id = ?, updated_at = ? WHERE id = ? AND variant_id = ?", source, timestamp, item.id, target);
      }
      for (const item of originalBefore.snapshot.preferredListings.filter((candidate) => candidate.variantId === source)) {
        this.db.run(
          `UPDATE source_variant_retailer_refs SET variant_id = ?
           WHERE source_connection_id = ? AND variant_id = ? AND retailer_id = ? AND listing_id = ?`,
          source,
          item.sourceConnectionId,
          target,
          item.retailerId,
          item.listingId
        );
      }
      for (const mission of originalBefore.snapshot.missions.filter((candidate) => candidate.variantId === source)) {
        this.db.run("UPDATE missions SET variant_id = ?, updated_at = ? WHERE id = ? AND variant_id = ?", source, timestamp, mission.id, target);
      }
      this.db.run("UPDATE variants SET updated_at = ? WHERE id IN (?, ?)", timestamp, source, target);
      const restored = this.topology([source, target]);
      this.assertRestoredTopology(restored, originalBefore.snapshotHash);
      return {
        result: { compensatedOperationId: original.id, restoredOperationKind: original.kind, restoredStateHash: originalBefore.snapshotHash },
        afterTopology: restored
      };
    }

    if (original.payload.kind !== "split_variant") {
      throw new CatalogIdentityGovernanceError("catalog_identity_rollback_invalid", 409, "The selected operation cannot be compensated.");
    }
    const source = original.payload.sourceVariantId;
    const newVariantId = String(original.result.newVariantId ?? "");
    const newFamilyId = String(original.result.newFamilyId ?? "");
    if (!ID_PATTERN.test(newVariantId) || !ID_PATTERN.test(newFamilyId)) {
      throw new CatalogIdentityGovernanceError("catalog_identity_rollback_invalid", 409, "The split operation has no valid compensating identity record.");
    }
    const selected = new Set(original.payload.listingIds);
    for (const listingId of original.payload.listingIds) {
      this.db.run("UPDATE listings SET variant_id = ?, updated_at = ? WHERE id = ? AND variant_id = ?", source, timestamp, listingId, newVariantId);
    }
    for (const candidate of originalAfter.snapshot.sourceCandidates.filter((item) => item.variantId === newVariantId)) {
      this.db.run("UPDATE source_listing_candidates SET variant_id = ?, updated_at = ? WHERE id = ? AND variant_id = ?", source, timestamp, candidate.id, newVariantId);
    }
    for (const preferred of originalAfter.snapshot.preferredListings.filter((item) => item.variantId === newVariantId && selected.has(item.listingId))) {
      this.db.run(
        `UPDATE source_variant_retailer_refs SET variant_id = ?
         WHERE source_connection_id = ? AND variant_id = ? AND retailer_id = ? AND listing_id = ?`,
        source,
        preferred.sourceConnectionId,
        newVariantId,
        preferred.retailerId,
        preferred.listingId
      );
    }
    for (const mission of originalAfter.snapshot.missions.filter((item) => item.variantId === newVariantId)) {
      this.db.run("UPDATE missions SET variant_id = ?, updated_at = ? WHERE id = ? AND variant_id = ?", source, timestamp, mission.id, newVariantId);
    }
    this.db.run("DELETE FROM variants WHERE id = ?", newVariantId);
    this.db.run("DELETE FROM product_families WHERE id = ?", newFamilyId);
    this.db.run("UPDATE variants SET updated_at = ? WHERE id = ?", timestamp, source);
    const restored = this.topology([source]);
    this.assertRestoredTopology(restored, originalBefore.snapshotHash);
    return {
      result: { compensatedOperationId: original.id, restoredOperationKind: original.kind, restoredStateHash: originalBefore.snapshotHash },
      afterTopology: restored
    };
  }

  private assertRestoredTopology(topology: VariantTopology, expectedHash: string): void {
    if (this.topologyHash(topology) !== expectedHash) {
      throw new CatalogIdentityGovernanceError(
        "catalog_identity_compensation_mismatch",
        409,
        "The compensating operation could not restore the exact recorded topology."
      );
    }
  }

  private storeSnapshot(
    operationId: string,
    phase: "before" | "after",
    snapshot: VariantTopology,
    snapshotHash: string,
    now: number
  ): void {
    this.db.run(
      `INSERT INTO catalog_identity_operation_snapshots(
         id, tenant_id, operation_id, phase, snapshot_json,
         snapshot_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId("catalog_identity_snapshot"),
      currentRequestScope().tenantId,
      operationId,
      phase,
      JSON.stringify(snapshot),
      snapshotHash,
      nowIso(now)
    );
  }

  private requireSnapshot(operationId: string, phase: "before" | "after"): {
    snapshot: VariantTopology;
    snapshotHash: string;
  } & VariantTopology {
    const row = this.db.get<{ snapshotJson: string; snapshotHash: string }>(
      `SELECT snapshot_json AS snapshotJson, snapshot_hash AS snapshotHash
       FROM catalog_identity_operation_snapshots
       WHERE tenant_id = ? AND operation_id = ? AND phase = ?`,
      currentRequestScope().tenantId,
      operationId,
      phase
    );
    if (!row) throw new CatalogIdentityGovernanceError("catalog_identity_snapshot_not_found", 409, "The immutable catalog topology snapshot is unavailable.");
    const snapshot = JSON.parse(row.snapshotJson) as VariantTopology;
    return { ...snapshot, snapshot, snapshotHash: row.snapshotHash };
  }

  private recordEvent(
    operationId: string,
    eventType: "proposed" | "approved" | "rejected" | "applied" | "compensated",
    reason: string,
    stateHash: string,
    data: Record<string, unknown>,
    now: number
  ): void {
    const sequence = Number(this.db.get<{ sequence: number }>(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM catalog_identity_operation_events WHERE operation_id = ?",
      operationId
    )?.sequence ?? 1);
    this.db.run(
      `INSERT INTO catalog_identity_operation_events(
         id, tenant_id, operation_id, sequence, event_type, actor_kind, actor_id,
         reason_code, state_hash, data_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("catalog_identity_event"),
      currentRequestScope().tenantId,
      operationId,
      sequence,
      eventType,
      currentRequestScope().actorKind,
      currentRequestScope().actorId,
      cleanText(reason, 80),
      stateHash,
      JSON.stringify(data),
      nowIso(now)
    );
  }

  private requireOperation(id: string): CatalogIdentityOperation {
    const row = this.db.get<OperationRow>(
      `${SELECT_OPERATION} WHERE id = ? AND tenant_id = ?`,
      id,
      currentRequestScope().tenantId
    );
    if (!row) throw new CatalogIdentityGovernanceError("catalog_identity_operation_not_found", 404, "The catalog identity operation does not exist in this tenant.");
    return operationFromRow(row);
  }
}
