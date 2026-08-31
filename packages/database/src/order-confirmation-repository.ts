import type { OrderConfirmationObservationInput } from "../../contracts/src/action-platform.js";
import { ORDER_CONFIRMATION_OBSERVER_CONTRACT_VERSION } from "../../contracts/src/action-platform.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const OBSERVATION_ID = /^order_confirmation_[a-f0-9]{32}$/;

export interface OrderConfirmationObservation {
  id: string;
  actionJobId: string;
  retailerId: string;
  pageClass: "confirmation";
  observedAt: string;
  receivedAt: string;
  acknowledged: boolean;
  createdAt: string;
}

interface ObservationRow extends Omit<OrderConfirmationObservation, "acknowledged"> {
  acknowledged: number;
}

function record(row: ObservationRow): OrderConfirmationObservation {
  return { ...row, acknowledged: Number(row.acknowledged) === 1 };
}

const SELECT = `SELECT id, action_job_id AS actionJobId, retailer_id AS retailerId,
  page_class AS pageClass, observed_at AS observedAt, received_at AS receivedAt,
  acknowledged, created_at AS createdAt FROM order_confirmation_observations`;

export class OrderConfirmationRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  record(deviceId: string, input: OrderConfirmationObservationInput, now = Date.now()): OrderConfirmationObservation {
    if (input?.contractVersion !== ORDER_CONFIRMATION_OBSERVER_CONTRACT_VERSION
      || input.pageClass !== "confirmation") {
      throw new Error("The order-confirmation observation contract is invalid.");
    }
    const safeDeviceId = cleanText(deviceId, 120);
    const actionJobId = cleanText(input.actionJobId, 120);
    const scope = currentRequestScope();
    const job = this.db.get<{ retailerId: string; state: string }>(
      `SELECT listing.retailer_id AS retailerId, job.state
       FROM action_jobs job JOIN listings listing ON listing.id = job.listing_id
       WHERE job.id = ? AND job.tenant_id = ? AND job.user_id = ?
         AND job.assigned_device_id = ?`,
      actionJobId, scope.tenantId, scope.userId, safeDeviceId
    );
    if (!job || job.retailerId !== input.retailerId
      || !["confirmed", "manual_review", "submission_uncertain"].includes(job.state)) {
      throw new Error("The confirmation page is not bound to a current cart handoff for this device.");
    }
    const observedTime = new Date(cleanText(input.observedAt, 40)).getTime();
    if (!Number.isFinite(observedTime) || observedTime > now + 5 * 60_000 || observedTime < now - 30 * 60_000) {
      throw new Error("The order-confirmation observation is stale or invalid.");
    }
    const observedAt = new Date(observedTime).toISOString();
    const receivedAt = nowIso(now);
    const evidenceHash = stableHash(
      "yoink_order_confirmation_observation_v1",
      scope.tenantId,
      scope.userId,
      safeDeviceId,
      actionJobId,
      input.retailerId,
      observedAt
    );
    this.db.run(
      `INSERT INTO order_confirmation_observations(
         id, tenant_id, user_id, device_id, action_job_id, retailer_id,
         page_class, evidence_hash, observed_at, received_at, acknowledged, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'confirmation', ?, ?, ?, 0, ?)
       ON CONFLICT(action_job_id, device_id) DO UPDATE SET
         evidence_hash = excluded.evidence_hash,
         observed_at = excluded.observed_at,
         received_at = excluded.received_at`,
      newId("order_confirmation"), scope.tenantId, scope.userId, safeDeviceId,
      actionJobId, input.retailerId, evidenceHash, observedAt, receivedAt, receivedAt
    );
    const saved = this.forJob(actionJobId);
    if (!saved) throw new Error("The order-confirmation observation could not be loaded.");
    this.audit.record({
      correlationId: actionJobId,
      aggregateType: "order_confirmation",
      eventType: "order_confirmation_page_observed",
      reasonCode: "read_only_confirmation_page",
      message: "Chrome observed a retailer confirmation page without collecting order, account, address, or payment data.",
      data: { actionJobId, retailerId: input.retailerId, pageClass: "confirmation", readOnly: true }
    }, now);
    return saved;
  }

  list(limit = 100): OrderConfirmationObservation[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const scope = currentRequestScope();
    return this.db.all<ObservationRow>(
      `${SELECT} WHERE tenant_id = ? AND user_id = ?
       ORDER BY observed_at DESC, id DESC LIMIT ?`,
      scope.tenantId, scope.userId, safeLimit
    ).map(record);
  }

  acknowledge(id: string, now = Date.now()): OrderConfirmationObservation {
    const observationId = cleanText(id, 120);
    if (!OBSERVATION_ID.test(observationId)) throw new Error("The order-confirmation observation ID is invalid.");
    const scope = currentRequestScope();
    this.db.run(
      `UPDATE order_confirmation_observations SET acknowledged = 1
       WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      observationId, scope.tenantId, scope.userId
    );
    const row = this.db.get<ObservationRow>(
      `${SELECT} WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      observationId, scope.tenantId, scope.userId
    );
    if (!row) throw new Error("The order-confirmation observation does not exist.");
    this.audit.record({
      correlationId: row.actionJobId,
      aggregateType: "order_confirmation",
      eventType: "order_confirmation_acknowledged",
      reasonCode: "user_acknowledged",
      message: "The user acknowledged the read-only confirmation-page observation.",
      data: { observationId }
    }, now);
    return record(row);
  }

  private forJob(actionJobId: string): OrderConfirmationObservation | null {
    const scope = currentRequestScope();
    const row = this.db.get<ObservationRow>(
      `${SELECT} WHERE action_job_id = ? AND tenant_id = ? AND user_id = ?`,
      actionJobId, scope.tenantId, scope.userId
    );
    return row ? record(row) : null;
  }
}
