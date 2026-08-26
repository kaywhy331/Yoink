import type {
  Action,
  PurchaseIntentPolicy,
  SpendPolicy,
  SpendPolicyUpdateInput
} from "../../contracts/src/index.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { PurchaseSafetyError } from "./purchase-policy-repository.js";
import { currentRequestScope } from "./request-scope.js";

export const SPEND_RESERVATION_EXPIRY_REASON = "reservation_expired";

export interface SpendReservation {
  id: string;
  missionId: string;
  intentRevisionId: string;
  exactOfferKeyId: string;
  offerSnapshotId: string;
  actionJobId: string;
  action: Exclude<Action, "notify">;
  quantity: number;
  reservedAmountCents: number;
  committedAmountCents: number;
  currency: string;
  status: "active" | "committed" | "released";
  releaseReason: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationDecision {
  allowed: boolean;
  reasonCode: string;
  message: string;
}

export interface SpendSummary {
  policy: SpendPolicy;
  activeReservedCents: number;
  spentTodayCents: number;
  spentThisMonthCents: number;
  availableTodayCents: number | null;
  availableThisMonthCents: number | null;
  activeReservationCount: number;
}

interface SpendPolicyRow {
  revision: number;
  currency: "USD";
  perOrderCapCents: number | null;
  dailyCapCents: number | null;
  monthlyCapCents: number | null;
  orderSubmissionEnabled: number;
  createdAt: string;
  updatedAt: string;
}

function nullableCap(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) {
    throw new PurchaseSafetyError("spend_policy_invalid", 400, `${label} must be a positive integer number of cents or blank.`);
  }
  return amount;
}

function spendPolicy(row: SpendPolicyRow): SpendPolicy {
  return {
    revision: Number(row.revision),
    currency: row.currency,
    perOrderCapCents: row.perOrderCapCents === null ? null : Number(row.perOrderCapCents),
    dailyCapCents: row.dailyCapCents === null ? null : Number(row.dailyCapCents),
    monthlyCapCents: row.monthlyCapCents === null ? null : Number(row.monthlyCapCents),
    orderSubmissionEnabled: row.orderSubmissionEnabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function periodStarts(now: number): { day: string; month: string } {
  const value = new Date(now);
  return {
    day: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())).toISOString(),
    month: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)).toISOString()
  };
}

export class SpendLedgerRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  policy(now = Date.now()): SpendPolicy {
    const scope = currentRequestScope();
    let row = this.policyRow();
    if (!row) {
      const timestamp = nowIso(now);
      this.db.run(
        `INSERT OR IGNORE INTO user_spend_policies(
           user_id, tenant_id, revision, currency, per_order_cap_cents,
           daily_cap_cents, monthly_cap_cents, order_submission_enabled,
           created_at, updated_at
         ) VALUES (?, ?, 1, 'USD', NULL, NULL, NULL, 0, ?, ?)`,
        scope.userId,
        scope.tenantId,
        timestamp,
        timestamp
      );
      row = this.policyRow();
    }
    if (!row) throw new Error("The user spend policy could not be loaded.");
    return spendPolicy(row);
  }

  updatePolicy(input: SpendPolicyUpdateInput, now = Date.now()): SpendPolicy {
    const expectedRevision = Number(input?.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new PurchaseSafetyError("spend_policy_invalid", 400, "The current spend-policy revision is required.");
    }
    const perOrder = nullableCap(input?.perOrderCapCents, "The per-order cap");
    const daily = nullableCap(input?.dailyCapCents, "The daily cap");
    const monthly = nullableCap(input?.monthlyCapCents, "The monthly cap");
    if (perOrder !== null && daily !== null && perOrder > daily) {
      throw new PurchaseSafetyError("spend_policy_invalid", 400, "The per-order cap cannot exceed the daily cap.");
    }
    if (daily !== null && monthly !== null && daily > monthly) {
      throw new PurchaseSafetyError("spend_policy_invalid", 400, "The daily cap cannot exceed the monthly cap.");
    }
    return this.db.transaction(() => {
      const current = this.policy(now);
      if (current.revision !== expectedRevision) {
        throw new PurchaseSafetyError(
          "spend_policy_revision_conflict",
          409,
          "The spending limits changed after they were loaded. Refresh before saving again."
        );
      }
      if (current.perOrderCapCents === perOrder
        && current.dailyCapCents === daily
        && current.monthlyCapCents === monthly) return current;
      const timestamp = nowIso(now);
      this.db.run(
        `UPDATE user_spend_policies
         SET revision = revision + 1, per_order_cap_cents = ?,
             daily_cap_cents = ?, monthly_cap_cents = ?, updated_at = ?
         WHERE user_id = ? AND tenant_id = ? AND revision = ?`,
        perOrder,
        daily,
        monthly,
        timestamp,
        currentRequestScope().userId,
        currentRequestScope().tenantId,
        expectedRevision
      );
      this.audit.record({
        correlationId: currentRequestScope().userId,
        aggregateType: "spend_policy",
        eventType: "spend_policy_revised",
        reasonCode: "user_preferences",
        message: "Periodic spending limits were revised.",
        data: { revision: expectedRevision + 1, perOrderCapCents: perOrder, dailyCapCents: daily, monthlyCapCents: monthly }
      }, now);
      return this.policy(now);
    });
  }

  evaluateReservation(
    missionId: string,
    policy: PurchaseIntentPolicy,
    action: Exclude<Action, "notify">,
    quantity: number,
    amountCents: number,
    now = Date.now()
  ): ReservationDecision {
    const rejected = (reasonCode: string, message: string): ReservationDecision => ({ allowed: false, reasonCode, message });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return rejected("reservation_quantity_invalid", "A valid reservation quantity is required.");
    }
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return rejected("reservation_amount_invalid", "A positive bounded order total is required before reserving spend.");
    }
    const currentIntentId = this.db.get<{ id: string }>(
      `SELECT ir.id FROM mission_intent_revisions ir JOIN missions m ON m.id = ir.mission_id
       WHERE ir.mission_id = ? AND m.user_id = ? ORDER BY ir.revision DESC LIMIT 1`,
      missionId,
      currentRequestScope().userId
    )?.id;
    if (currentIntentId !== policy.id) {
      return rejected("reservation_intent_stale", "The action was evaluated against a stale purchase-intent revision.");
    }
    const spend = this.policy(now);
    if (action === "submit_order" && !spend.orderSubmissionEnabled) {
      return rejected("order_submission_closed", "Order submission remains disabled for this account.");
    }
    if (spend.perOrderCapCents !== null && amountCents > spend.perOrderCapCents) {
      return rejected("per_order_cap_exceeded", "The reservation exceeds the user per-order spending cap.");
    }
    const fulfilled = Number(this.db.get<{ quantity: number }>(
      "SELECT fulfilled_quantity AS quantity FROM missions WHERE id = ? AND user_id = ?",
      missionId,
      currentRequestScope().userId
    )?.quantity ?? 0);
    const reservedQuantity = Number(this.db.get<{ quantity: number }>(
      `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM spend_reservations
       WHERE mission_id = ? AND user_id = ? AND status = 'active' AND expires_at > ?`,
      missionId,
      currentRequestScope().userId,
      nowIso(now)
    )?.quantity ?? 0);
    if (fulfilled + reservedQuantity + quantity > policy.quantity) {
      return rejected("reserved_quantity_exceeded", "Concurrent actions would exceed the remaining purchase-intent quantity.");
    }
    const summary = this.summary(now, false);
    if (spend.dailyCapCents !== null
      && summary.spentTodayCents + summary.activeReservedCents + amountCents > spend.dailyCapCents) {
      return rejected("daily_spend_cap_exceeded", "Concurrent reservations would exceed the daily spending cap.");
    }
    if (spend.monthlyCapCents !== null
      && summary.spentThisMonthCents + summary.activeReservedCents + amountCents > spend.monthlyCapCents) {
      return rejected("monthly_spend_cap_exceeded", "Concurrent reservations would exceed the monthly spending cap.");
    }
    return { allowed: true, reasonCode: "spend_reserved", message: "Quantity and spending capacity are available." };
  }

  reserve(input: {
    missionId: string;
    policy: PurchaseIntentPolicy;
    exactOfferKeyId: string;
    offerSnapshotId: string;
    actionJobId: string;
    idempotencyKey: string;
    action: Exclude<Action, "notify">;
    quantity: number;
    amountCents: number;
    currency: string;
    expiresAt: string;
  }, now = Date.now()): SpendReservation {
    return this.db.transaction(() => {
      this.releaseExpired(now);
      const existing = this.db.get<SpendReservation>(
        `SELECT id, mission_id AS missionId, intent_revision_id AS intentRevisionId,
                exact_offer_key_id AS exactOfferKeyId, offer_snapshot_id AS offerSnapshotId,
                action_job_id AS actionJobId, action, quantity,
                reserved_amount_cents AS reservedAmountCents,
                committed_amount_cents AS committedAmountCents, currency, status,
                release_reason AS releaseReason, expires_at AS expiresAt,
                created_at AS createdAt, updated_at AS updatedAt
         FROM spend_reservations WHERE user_id = ? AND idempotency_key = ?`,
        currentRequestScope().userId,
        cleanText(input.idempotencyKey, 160)
      );
      if (existing) {
        if (existing.actionJobId !== input.actionJobId
          || existing.missionId !== input.missionId
          || Number(existing.reservedAmountCents) !== input.amountCents
          || Number(existing.quantity) !== input.quantity) {
          throw new PurchaseSafetyError("reservation_idempotency_conflict", 409, "The spend-reservation idempotency key was reused with different bounds.");
        }
        return this.normalizedReservation(existing);
      }
      if (input.currency !== "USD") {
        throw new PurchaseSafetyError("reservation_currency_unsupported", 409, "Only USD spending reservations are currently supported.");
      }
      const decision = this.evaluateReservation(
        input.missionId,
        input.policy,
        input.action,
        input.quantity,
        input.amountCents,
        now
      );
      if (!decision.allowed) throw new PurchaseSafetyError(decision.reasonCode, 409, decision.message);
      const timestamp = nowIso(now);
      const reservationId = newId("spend_reservation");
      this.db.run(
        `INSERT INTO spend_reservations(
           id, tenant_id, user_id, mission_id, intent_revision_id,
           exact_offer_key_id, offer_snapshot_id, action_job_id, idempotency_key,
           action, quantity, reserved_amount_cents, committed_amount_cents,
           currency, status, release_reason, expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', '', ?, ?, ?)`,
        reservationId,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        input.missionId,
        input.policy.id,
        input.exactOfferKeyId,
        input.offerSnapshotId,
        input.actionJobId,
        cleanText(input.idempotencyKey, 160),
        input.action,
        input.quantity,
        input.amountCents,
        input.currency,
        input.expiresAt,
        timestamp,
        timestamp
      );
      this.recordLedger(
        reservationId,
        input.actionJobId,
        "reserved",
        input.amountCents,
        0,
        input.quantity,
        input.currency,
        "action_job_reserved",
        input.actionJobId,
        now
      );
      this.db.run("UPDATE action_jobs SET spend_reservation_id = ? WHERE id = ?", reservationId, input.actionJobId);
      this.audit.record({
        correlationId: input.actionJobId,
        aggregateType: "spend_reservation",
        eventType: "spend_reserved",
        reasonCode: "action_job_reserved",
        message: "Quantity and bounded spending capacity were reserved transactionally.",
        data: { reservationId, missionId: input.missionId, amountCents: input.amountCents, quantity: input.quantity, action: input.action }
      }, now);
      const saved = this.reservationForJob(input.actionJobId);
      if (!saved) throw new Error("The spend reservation could not be loaded.");
      return saved;
    });
  }

  reservationForJob(actionJobId: string): SpendReservation | null {
    const row = this.db.get<SpendReservation>(
      `SELECT id, mission_id AS missionId, intent_revision_id AS intentRevisionId,
              exact_offer_key_id AS exactOfferKeyId, offer_snapshot_id AS offerSnapshotId,
              action_job_id AS actionJobId, action, quantity,
              reserved_amount_cents AS reservedAmountCents,
              committed_amount_cents AS committedAmountCents, currency, status,
              release_reason AS releaseReason, expires_at AS expiresAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM spend_reservations WHERE action_job_id = ? AND user_id = ?`,
      cleanText(actionJobId, 120),
      currentRequestScope().userId
    );
    return row ? this.normalizedReservation(row) : null;
  }

  releaseForJob(actionJobId: string, reasonCode: string, now = Date.now()): SpendReservation | null {
    return this.db.transaction(() => {
      const reservation = this.reservationForJob(actionJobId);
      if (!reservation || reservation.status !== "active") return reservation;
      const reason = cleanText(reasonCode, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_") || "released";
      const timestamp = nowIso(now);
      this.db.run(
        `UPDATE spend_reservations SET status = 'released', release_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'active'`,
        reason,
        timestamp,
        reservation.id
      );
      this.recordLedger(
        reservation.id,
        reservation.actionJobId,
        "released",
        -reservation.reservedAmountCents,
        0,
        -reservation.quantity,
        reservation.currency,
        reason,
        reservation.actionJobId,
        now
      );
      this.audit.record({
        correlationId: reservation.actionJobId,
        aggregateType: "spend_reservation",
        eventType: "spend_reservation_released",
        reasonCode: reason,
        message: "The action reservation was released without recording a purchase.",
        data: { reservationId: reservation.id, amountCents: reservation.reservedAmountCents, quantity: reservation.quantity }
      }, now);
      return this.reservationForJob(actionJobId);
    });
  }

  commitForJob(actionJobId: string, actualAmountCents: number, now = Date.now()): SpendReservation {
    if (!Number.isSafeInteger(actualAmountCents) || actualAmountCents <= 0) {
      throw new PurchaseSafetyError("committed_total_required", 409, "A verified positive all-in order total is required to commit spend.");
    }
    return this.db.transaction(() => {
      const reservation = this.reservationForJob(actionJobId);
      if (!reservation) throw new PurchaseSafetyError("reservation_not_found", 404, "The action has no spend reservation.");
      if (reservation.action !== "submit_order") {
        throw new PurchaseSafetyError("spend_commit_action_invalid", 409, "Only a verified submit-order action may commit spend.");
      }
      if (reservation.status === "committed") {
        if (reservation.committedAmountCents !== actualAmountCents) {
          throw new PurchaseSafetyError("spend_commit_conflict", 409, "The committed total does not match the existing ledger receipt.");
        }
        return reservation;
      }
      if (reservation.status !== "active" || actualAmountCents > reservation.reservedAmountCents) {
        throw new PurchaseSafetyError("spend_commit_exceeds_reservation", 409, "The verified order total exceeds the active spend reservation.");
      }
      const timestamp = nowIso(now);
      this.db.run(
        `UPDATE spend_reservations
         SET status = 'committed', committed_amount_cents = ?, updated_at = ?
         WHERE id = ? AND status = 'active'`,
        actualAmountCents,
        timestamp,
        reservation.id
      );
      this.recordLedger(
        reservation.id,
        reservation.actionJobId,
        "committed",
        -reservation.reservedAmountCents,
        actualAmountCents,
        -reservation.quantity,
        reservation.currency,
        "verified_order_committed",
        reservation.actionJobId,
        now
      );
      this.audit.record({
        correlationId: reservation.actionJobId,
        aggregateType: "spend_reservation",
        eventType: "spend_committed",
        reasonCode: "verified_order_committed",
        message: "A verified submit-order total was committed to the append-only spend ledger.",
        data: { reservationId: reservation.id, actualAmountCents, quantity: reservation.quantity }
      }, now);
      const saved = this.reservationForJob(actionJobId);
      if (!saved) throw new Error("The committed spend reservation could not be loaded.");
      return saved;
    });
  }

  releaseExpired(now = Date.now()): number {
    const expired = this.db.all<{ actionJobId: string }>(
      `SELECT action_job_id AS actionJobId FROM spend_reservations
       WHERE user_id = ? AND status = 'active' AND expires_at <= ?
       ORDER BY expires_at, id`,
      currentRequestScope().userId,
      nowIso(now)
    );
    for (const reservation of expired) {
      this.releaseForJob(reservation.actionJobId, SPEND_RESERVATION_EXPIRY_REASON, now);
    }
    return expired.length;
  }

  summary(now = Date.now(), expire = true): SpendSummary {
    if (expire) this.releaseExpired(now);
    const policy = this.policy(now);
    const starts = periodStarts(now);
    const active = this.db.get<{ amount: number; count: number }>(
      `SELECT COALESCE(SUM(reserved_amount_cents), 0) AS amount, COUNT(*) AS count
       FROM spend_reservations
       WHERE user_id = ? AND status = 'active' AND expires_at > ?`,
      currentRequestScope().userId,
      nowIso(now)
    );
    const spentTodayCents = Number(this.db.get<{ amount: number }>(
      `SELECT COALESCE(SUM(spent_delta_cents), 0) AS amount FROM spend_ledger_entries
       WHERE user_id = ? AND created_at >= ?`,
      currentRequestScope().userId,
      starts.day
    )?.amount ?? 0);
    const spentThisMonthCents = Number(this.db.get<{ amount: number }>(
      `SELECT COALESCE(SUM(spent_delta_cents), 0) AS amount FROM spend_ledger_entries
       WHERE user_id = ? AND created_at >= ?`,
      currentRequestScope().userId,
      starts.month
    )?.amount ?? 0);
    const activeReservedCents = Number(active?.amount ?? 0);
    return {
      policy,
      activeReservedCents,
      spentTodayCents,
      spentThisMonthCents,
      availableTodayCents: policy.dailyCapCents === null
        ? null
        : Math.max(0, policy.dailyCapCents - spentTodayCents - activeReservedCents),
      availableThisMonthCents: policy.monthlyCapCents === null
        ? null
        : Math.max(0, policy.monthlyCapCents - spentThisMonthCents - activeReservedCents),
      activeReservationCount: Number(active?.count ?? 0)
    };
  }

  listLedger(limit = 100, offset = 0): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    return this.db.all(
      `SELECT sl.id, sl.reservation_id AS reservationId,
              sl.action_job_id AS actionJobId, sl.entry_type AS entryType,
              sl.reserved_delta_cents AS reservedDeltaCents,
              sl.spent_delta_cents AS spentDeltaCents,
              sl.quantity_delta AS quantityDelta, sl.currency,
              sl.reason_code AS reasonCode, sl.correlation_id AS correlationId,
              sl.created_at AS createdAt, sr.mission_id AS missionId,
              sr.action, sr.status AS reservationStatus
       FROM spend_ledger_entries sl
       JOIN spend_reservations sr ON sr.id = sl.reservation_id
       WHERE sl.tenant_id = ? AND sl.user_id = ?
       ORDER BY sl.created_at DESC, sl.id DESC LIMIT ? OFFSET ?`,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      safeLimit,
      safeOffset
    );
  }

  counts(): { activeReservations: number; ledgerEntries: number; committedSpendCents: number } {
    return {
      activeReservations: Number(this.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM spend_reservations WHERE user_id = ? AND status = 'active'",
        currentRequestScope().userId
      )?.count ?? 0),
      ledgerEntries: Number(this.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM spend_ledger_entries WHERE user_id = ?",
        currentRequestScope().userId
      )?.count ?? 0),
      committedSpendCents: Number(this.db.get<{ amount: number }>(
        "SELECT COALESCE(SUM(spent_delta_cents), 0) AS amount FROM spend_ledger_entries WHERE user_id = ?",
        currentRequestScope().userId
      )?.amount ?? 0)
    };
  }

  private policyRow(): SpendPolicyRow | null {
    return this.db.get<SpendPolicyRow>(
      `SELECT revision, currency, per_order_cap_cents AS perOrderCapCents,
              daily_cap_cents AS dailyCapCents,
              monthly_cap_cents AS monthlyCapCents,
              order_submission_enabled AS orderSubmissionEnabled,
              created_at AS createdAt, updated_at AS updatedAt
       FROM user_spend_policies WHERE user_id = ? AND tenant_id = ?`,
      currentRequestScope().userId,
      currentRequestScope().tenantId
    ) ?? null;
  }

  private normalizedReservation(reservation: SpendReservation): SpendReservation {
    return {
      ...reservation,
      quantity: Number(reservation.quantity),
      reservedAmountCents: Number(reservation.reservedAmountCents),
      committedAmountCents: Number(reservation.committedAmountCents)
    };
  }

  private recordLedger(
    reservationId: string,
    actionJobId: string,
    entryType: "reserved" | "released" | "committed" | "refunded" | "adjusted",
    reservedDeltaCents: number,
    spentDeltaCents: number,
    quantityDelta: number,
    currency: string,
    reasonCode: string,
    correlationId: string,
    now: number
  ): void {
    this.db.run(
      `INSERT INTO spend_ledger_entries(
         id, tenant_id, user_id, reservation_id, action_job_id, entry_type,
         reserved_delta_cents, spent_delta_cents, quantity_delta, currency,
         reason_code, correlation_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
      newId("spend_ledger"),
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      reservationId,
      actionJobId,
      entryType,
      reservedDeltaCents,
      spentDeltaCents,
      quantityDelta,
      currency,
      cleanText(reasonCode, 80),
      cleanText(correlationId, 120),
      nowIso(now)
    );
  }
}
