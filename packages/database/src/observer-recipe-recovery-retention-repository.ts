import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

export const OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION = "observer_recipe_recovery_retention_v1";
export const OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS = 90;
export const OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH = 500;
export const OBSERVER_RECIPE_RECOVERY_RETENTION_AUDIT_MESSAGE =
  "Expired quarantined observer recovery evidence was removed under the bounded retention policy.";

const DAY_MS = 24 * 60 * 60_000;

interface RecoveryRetentionReceiptRow {
  id: string;
  userId: string;
  cutoffAt: string;
  deletedEvidenceCount: number;
  deletedReviewEventCount: number;
  createdAt: string;
}

export interface ObserverRecipeRecoveryRetentionResult {
  deletedRecoveryEvidence: number;
  deletedRecoveryReviewEvents: number;
  recoveryEvidenceCutoffAt: string;
  recoveryEvidenceRetentionDays: number;
  recoveryEvidenceRetentionReceiptId: string;
}

export class ObserverRecipeRecoveryRetentionRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  prune(now = Date.now()): ObserverRecipeRecoveryRetentionResult {
    const scope = currentRequestScope();
    if (scope.actorKind !== "service") {
      throw new Error("A trusted background service scope is required for recovery-evidence retention.");
    }
    const cutoffAt = nowIso(now - OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS * DAY_MS);
    const eligible = this.db.all<{ id: string }>(
      `SELECT evidence.id
       FROM observer_recipe_recovery_evidence evidence
       WHERE evidence.tenant_id = ? AND evidence.user_id = ?
         AND evidence.received_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM observer_recipe_recovery_reviews review
           WHERE review.tenant_id = evidence.tenant_id
             AND review.user_id = evidence.user_id
             AND review.evidence_id = evidence.id
             AND review.created_at > ?
         )
       ORDER BY evidence.received_at, evidence.id
       LIMIT ?`,
      scope.tenantId,
      scope.userId,
      cutoffAt,
      cutoffAt,
      OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH
    );
    if (!eligible.length) return this.emptyResult(cutoffAt);

    const evidenceIds = eligible.map((row) => row.id);
    const placeholders = evidenceIds.map(() => "?").join(", ");
    let deletedRecoveryEvidence = 0;
    let deletedRecoveryReviewEvents = 0;
    let receiptId = "";
    this.db.transaction(() => {
      deletedRecoveryReviewEvents = Number(this.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM observer_recipe_recovery_reviews
         WHERE tenant_id = ? AND user_id = ? AND evidence_id IN (${placeholders})`,
        scope.tenantId,
        scope.userId,
        ...evidenceIds
      )?.count ?? 0);
      deletedRecoveryEvidence = Number(this.db.run(
        `DELETE FROM observer_recipe_recovery_evidence
         WHERE tenant_id = ? AND user_id = ? AND id IN (${placeholders})`,
        scope.tenantId,
        scope.userId,
        ...evidenceIds
      ).changes);
      if (deletedRecoveryEvidence !== evidenceIds.length) {
        throw new Error("The bounded recovery-evidence retention set changed before deletion completed.");
      }
      receiptId = newId("observer_recovery_retention");
      this.db.run(
        `INSERT INTO observer_recipe_recovery_retention_receipts(
           id, tenant_id, user_id, policy_version, retention_days, cutoff_at,
           deleted_evidence_count, deleted_review_event_count,
           application_affected, field_fill_applied, created_by_actor_id,
           privacy_classification, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'restricted_user_aggregate', ?)`,
        receiptId,
        scope.tenantId,
        scope.userId,
        OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION,
        OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
        cutoffAt,
        deletedRecoveryEvidence,
        deletedRecoveryReviewEvents,
        scope.actorId,
        nowIso(now)
      );
      this.audit.record({
        correlationId: receiptId,
        aggregateType: "observer_recipe_recovery_retention",
        eventType: "observer_recipe_recovery_retention_applied",
        reasonCode: OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION,
        message: OBSERVER_RECIPE_RECOVERY_RETENTION_AUDIT_MESSAGE,
        data: {
          policyVersion: OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION,
          retentionDays: OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
          cutoffAt,
          deletedEvidenceCount: deletedRecoveryEvidence,
          deletedReviewEventCount: deletedRecoveryReviewEvents,
          normalizedValuesRecorded: false,
          applicationAffected: false,
          fieldFillApplied: false,
          qualificationAffected: false,
          actionEnqueued: false,
          browserInvoked: false
        }
      }, now);
    });
    return {
      deletedRecoveryEvidence,
      deletedRecoveryReviewEvents,
      recoveryEvidenceCutoffAt: cutoffAt,
      recoveryEvidenceRetentionDays: OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
      recoveryEvidenceRetentionReceiptId: receiptId
    };
  }

  status(limit = 20, ownerOnly = false, now = Date.now()): Record<string, unknown> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
    const scope = currentRequestScope();
    const ownerClause = ownerOnly ? " AND user_id = ?" : "";
    const parameters = ownerOnly ? [scope.tenantId, scope.userId] : [scope.tenantId];
    const totals = this.db.get<{
      receipts: number;
      deletedEvidence: number;
      deletedReviewEvents: number;
    }>(
      `SELECT COUNT(*) AS receipts,
              COALESCE(SUM(deleted_evidence_count), 0) AS deletedEvidence,
              COALESCE(SUM(deleted_review_event_count), 0) AS deletedReviewEvents
       FROM observer_recipe_recovery_retention_receipts
       WHERE tenant_id = ?${ownerClause}`,
      ...parameters
    );
    const cutoffAt = nowIso(now - OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS * DAY_MS);
    const eligible = this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM observer_recipe_recovery_evidence evidence
       WHERE evidence.tenant_id = ?${ownerOnly ? " AND evidence.user_id = ?" : ""}
         AND evidence.received_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM observer_recipe_recovery_reviews review
           WHERE review.tenant_id = evidence.tenant_id
             AND review.user_id = evidence.user_id
             AND review.evidence_id = evidence.id
             AND review.created_at > ?
         )`,
      ...parameters,
      cutoffAt,
      cutoffAt
    );
    const receipts = this.db.all<RecoveryRetentionReceiptRow>(
      `SELECT id, user_id AS userId, cutoff_at AS cutoffAt,
              deleted_evidence_count AS deletedEvidenceCount,
              deleted_review_event_count AS deletedReviewEventCount,
              created_at AS createdAt
       FROM observer_recipe_recovery_retention_receipts
       WHERE tenant_id = ?${ownerClause}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      ...parameters,
      safeLimit
    ).map((row) => ({
      id: row.id,
      contributorRef: stableHash("observer-recipe-recovery-contributor-v1", row.userId).slice(0, 12),
      cutoffAt: row.cutoffAt,
      deletedEvidenceCount: Number(row.deletedEvidenceCount),
      deletedReviewEventCount: Number(row.deletedReviewEventCount),
      createdAt: row.createdAt,
      privacyClassification: "restricted_user_aggregate",
      normalizedValuesRecorded: false,
      applicationAffected: false,
      fieldFillApplied: false
    }));
    return {
      policyVersion: OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION,
      retentionDays: OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
      activityResetsExpiry: true,
      maximumEvidencePerRun: OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH,
      eligibleEvidence: Number(eligible?.count ?? 0),
      receiptCount: Number(totals?.receipts ?? 0),
      deletedEvidenceCount: Number(totals?.deletedEvidence ?? 0),
      deletedReviewEventCount: Number(totals?.deletedReviewEvents ?? 0),
      receipts,
      applicationAffected: false,
      fieldFillEnabled: false
    };
  }

  private emptyResult(cutoffAt: string): ObserverRecipeRecoveryRetentionResult {
    return {
      deletedRecoveryEvidence: 0,
      deletedRecoveryReviewEvents: 0,
      recoveryEvidenceCutoffAt: cutoffAt,
      recoveryEvidenceRetentionDays: OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
      recoveryEvidenceRetentionReceiptId: ""
    };
  }
}
