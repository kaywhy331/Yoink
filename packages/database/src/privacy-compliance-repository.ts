import {
  PRIVACY_CHANGE_VERSION,
  PRIVACY_POLICY_VERSION
} from "../../contracts/src/action-platform.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

export type PrivacyNoticeKind = "privacy_policy" | "change_notice" | "local_deletion";
export type PrivacyNoticeAction = "viewed" | "acknowledged" | "deletion_completed";

interface ReceiptRow {
  id: string;
  policyVersion: string;
  changeVersion: string;
  noticeKind: PrivacyNoticeKind;
  action: PrivacyNoticeAction;
  createdAt: string;
}

export interface PrivacyComplianceStatus {
  policyVersion: typeof PRIVACY_POLICY_VERSION;
  changeVersion: typeof PRIVACY_CHANGE_VERSION;
  policyUrl: "/privacy";
  policyViewed: boolean;
  changeAcknowledged: boolean;
  localDeletionVerified: boolean;
  localDeletionScope: readonly ["chrome.storage.local", "chrome.storage.session"];
  receipts: ReceiptRow[];
}

const RECEIPT_SELECT = `SELECT id, policy_version AS policyVersion,
  change_version AS changeVersion, notice_kind AS noticeKind,
  action, created_at AS createdAt FROM privacy_notice_receipts`;

function validTransition(kind: PrivacyNoticeKind, action: PrivacyNoticeAction): boolean {
  return (kind === "privacy_policy" && action === "viewed")
    || (kind === "change_notice" && action === "acknowledged")
    || (kind === "local_deletion" && action === "deletion_completed");
}

export class PrivacyComplianceRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  status(): PrivacyComplianceStatus {
    const scope = currentRequestScope();
    const receipts = this.db.all<ReceiptRow>(
      `${RECEIPT_SELECT}
       WHERE tenant_id = ? AND user_id = ?
         AND policy_version = ? AND change_version = ?
       ORDER BY created_at DESC, id DESC`,
      scope.tenantId,
      scope.userId,
      PRIVACY_POLICY_VERSION,
      PRIVACY_CHANGE_VERSION
    );
    const has = (kind: PrivacyNoticeKind, action: PrivacyNoticeAction): boolean =>
      receipts.some((receipt) => receipt.noticeKind === kind && receipt.action === action);
    return {
      policyVersion: PRIVACY_POLICY_VERSION,
      changeVersion: PRIVACY_CHANGE_VERSION,
      policyUrl: "/privacy",
      policyViewed: has("privacy_policy", "viewed"),
      changeAcknowledged: has("change_notice", "acknowledged"),
      localDeletionVerified: has("local_deletion", "deletion_completed"),
      localDeletionScope: ["chrome.storage.local", "chrome.storage.session"],
      receipts
    };
  }

  record(
    noticeKind: PrivacyNoticeKind,
    action: PrivacyNoticeAction,
    deviceId = "",
    now = Date.now()
  ): PrivacyComplianceStatus {
    if (!validTransition(noticeKind, action)) {
      throw new Error("The privacy-notice transition is invalid.");
    }
    const scope = currentRequestScope();
    const safeDeviceId = cleanText(deviceId, 120);
    if (noticeKind === "local_deletion") {
      const device = this.db.get<{ id: string }>(
        `SELECT id FROM extension_devices
         WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'active'`,
        safeDeviceId,
        scope.tenantId,
        scope.userId
      );
      if (!device) throw new Error("Verified local deletion requires the paired Chrome companion.");
    }
    const timestamp = nowIso(now);
    const evidenceHash = stableHash(
      "yoink_privacy_notice_receipt_v1",
      scope.tenantId,
      scope.userId,
      PRIVACY_POLICY_VERSION,
      PRIVACY_CHANGE_VERSION,
      noticeKind,
      action,
      safeDeviceId,
      timestamp
    );
    this.db.run(
      `INSERT OR IGNORE INTO privacy_notice_receipts(
         id, tenant_id, user_id, policy_version, change_version,
         notice_kind, action, evidence_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("privacy_receipt"),
      scope.tenantId,
      scope.userId,
      PRIVACY_POLICY_VERSION,
      PRIVACY_CHANGE_VERSION,
      noticeKind,
      action,
      evidenceHash,
      timestamp
    );
    if (noticeKind === "change_notice" && action === "acknowledged") {
      this.db.run(
        `UPDATE app_settings SET privacy_notice_version = ?, updated_at = ? WHERE user_id = ?`,
        PRIVACY_CHANGE_VERSION,
        timestamp,
        scope.userId
      );
    }
    this.audit.record({
      correlationId: safeDeviceId || scope.userId,
      aggregateType: "privacy_compliance",
      eventType: `privacy_${noticeKind}_${action}`,
      reasonCode: noticeKind === "local_deletion" ? "extension_storage_cleared" : "user_acknowledged",
      message: noticeKind === "local_deletion"
        ? "The paired Chrome companion reported both extension storage areas cleared."
        : "The user recorded a current privacy notice action.",
      data: {
        policyVersion: PRIVACY_POLICY_VERSION,
        changeVersion: PRIVACY_CHANGE_VERSION,
        noticeKind,
        action,
        ...(safeDeviceId ? { deviceId: safeDeviceId } : {})
      }
    }, now);
    return this.status();
  }
}
