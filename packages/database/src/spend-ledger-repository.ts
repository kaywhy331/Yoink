import { CHECKOUT_CORRECTION_REASON, spendAccountingTimeSql } from "./checkout-report-projection.js";
import type {
  Action,
  PurchaseIntentPolicy,
  SpendPolicy,
  SpendPolicyUpdateInput
} from "../../contracts/src/index.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { validTimezone, zonedPeriodStarts } from "../../domain/src/time-period.js";
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
  timezone: string;
  periodResetHour: number;
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
    timezone: row.timezone,
    periodResetHour: Number(row.periodResetHour),
    orderSubmissionEnabled: row.orderSubmissionEnabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
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
           timezone, period_reset_hour,
           created_at, updated_at
         ) VALUES (?, ?, 1, 'USD', NULL, NULL, NULL, 0, 'UTC', 0, ?, ?)`,
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
    const timezone = validTimezone(input?.timezone ?? this.policy(now).timezone);
    const periodResetHour = input?.periodResetHour === undefined
      ? this.policy(now).periodResetHour
      : Number(input.periodResetHour);
    if (!Number.isInteger(periodResetHour) || periodResetHour < 0 || periodResetHour > 23) {
      throw new PurchaseSafetyError("spend_policy_invalid", 400, "The spending-period reset hour must be from 0 through 23.");
    }
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
        && current.monthlyCapCents === monthly
        && current.timezone === timezone
        && current.periodResetHour === periodResetHour) return current;
      const timestamp = nowIso(now);
      this.db.run(
        `UPDATE user_spend_policies
         SET revision = revision + 1, per_order_cap_cents = ?,
             daily_cap_cents = ?, monthly_cap_cents = ?, timezone = ?,
             period_reset_hour = ?, updated_at = ?
         WHERE user_id = ? AND tenant_id = ? AND revision = ?`,
        perOrder,
        daily,
        monthly,
        timezone,
        periodResetHour,
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
        data: {
          revision: expectedRevision + 1,
          perOrderCapCents: perOrder,
          dailyCapCents: daily,
          monthlyCapCents: monthly,
          timezone,
          periodResetHour
        }
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
    const spendingLimit = this.evaluatePlannedAmount(amountCents, now);
    if (!spendingLimit.allowed) return spendingLimit;
    return { allowed: true, reasonCode: "spend_reserved", message: "Quantity and spending capacity are available." };
  }

  evaluatePlannedAmount(amountCents: number, now = Date.now()): ReservationDecision {
    const rejected = (reasonCode: string, message: string): ReservationDecision => ({ allowed: false, reasonCode, message });
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return rejected("reservation_amount_invalid", "Set a positive maximum total before using cart adds.");
    }
    const summary = this.summary(now, false);
    if (summary.policy.perOrderCapCents !== null && amountCents > summary.policy.perOrderCapCents) {
      return rejected(
        "per_order_cap_exceeded",
        `This plan's maximum total is above your $${(summary.policy.perOrderCapCents / 100).toFixed(2)} per-order spending limit.`
      );
    }
    if (summary.availableTodayCents !== null && amountCents > summary.availableTodayCents) {
      return rejected(
        "daily_spend_cap_exceeded",
        `This plan needs $${(amountCents / 100).toFixed(2)}, but only $${(summary.availableTodayCents / 100).toFixed(2)} remains in today's spending limit.`
      );
    }
    if (summary.availableThisMonthCents !== null && amountCents > summary.availableThisMonthCents) {
      return rejected(
        "monthly_spend_cap_exceeded",
        `This plan needs $${(amountCents / 100).toFixed(2)}, but only $${(summary.availableThisMonthCents / 100).toFixed(2)} remains in this month's spending limit.`
      );
    }
    return { allowed: true, reasonCode: "within_spending_limits", message: "The reviewed maximum fits your current spending limits." };
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
       FROM spend_reservations WHERE action_job_id = ? AND tenant_id = ? AND user_id = ?`,
      cleanText(actionJobId, 120),
      currentRequestScope().tenantId,
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

  commitUserReportedAddForJob(
    actionJobId: string,
    actualAmountCents: number,
    now = Date.now(),
    options: { allowExpiredReservation?: boolean } = {}
  ): SpendReservation {
    if (!Number.isSafeInteger(actualAmountCents) || actualAmountCents <= 0) {
      throw new PurchaseSafetyError("user_reported_total_required", 409, "Enter the positive amount charged for this item before recording this purchase.");
    }
    return this.db.transaction(() => {
      const reservation = this.reservationForJob(actionJobId);
      if (!reservation) throw new PurchaseSafetyError("reservation_not_found", 404, "The cart action has no spend reservation.");
      if (reservation.action !== "add_to_cart") {
        throw new PurchaseSafetyError("user_reported_order_action_invalid", 409, "Only a confirmed add-to-cart action can accept this checkout report.");
      }
      if (reservation.status === "committed") {
        if (reservation.committedAmountCents !== actualAmountCents) {
          throw new PurchaseSafetyError("user_reported_order_conflict", 409, "This checkout result was already recorded with a different item amount.");
        }
        return reservation;
      }
      const releaseReasonAccepted = reservation.releaseReason === "add_to_cart_confirmed_without_order"
        || (options.allowExpiredReservation === true
          && reservation.releaseReason === SPEND_RESERVATION_EXPIRY_REASON);
      if (reservation.status !== "released" || !releaseReasonAccepted) {
        throw new PurchaseSafetyError(
          "user_reported_order_reservation_invalid",
          409,
          "The reported item amount can be attached only to the released reservation for this exact cart action."
        );
      }
      const overCapAmountCents = Math.max(0, actualAmountCents - reservation.reservedAmountCents);
      const timestamp = nowIso(now);
      this.db.run(
        `UPDATE spend_reservations
         SET status = 'committed', committed_amount_cents = ?, release_reason = '', updated_at = ?
         WHERE id = ? AND status = 'released' AND release_reason = ?`,
        actualAmountCents,
        timestamp,
        reservation.id,
        reservation.releaseReason
      );
      this.recordLedger(
        reservation.id,
        reservation.actionJobId,
        "committed",
        0,
        actualAmountCents,
        0,
        reservation.currency,
        "user_reported_order_committed",
        reservation.actionJobId,
        now
      );
      this.audit.record({
        correlationId: reservation.actionJobId,
        aggregateType: "spend_reservation",
        eventType: "user_reported_spend_committed",
        reasonCode: overCapAmountCents ? "user_reported_order_over_cap" : "user_reported_order_committed",
        message: overCapAmountCents
          ? "The user reported actual manual-checkout spend above the reviewed cart reservation."
          : "The user reported completing manual checkout within the reviewed cart reservation.",
        data: {
          reservationId: reservation.id,
          actualAmountCents,
          reviewedAmountCents: reservation.reservedAmountCents,
          overCap: overCapAmountCents > 0,
          overCapAmountCents,
          quantity: reservation.quantity,
          evidenceSource: "user_reported"
        }
      }, now);
      const saved = this.reservationForJob(actionJobId);
      if (!saved) throw new Error("The user-reported spend receipt could not be loaded.");
      return saved;
    });
  }

  adjustUserReportedSpend(input: {
    actionJobId: string; expectedNetCents: number; netCents: number; purchased: boolean;
    entryType: "adjusted" | "refunded"; accountingAt: string; correctionId: string;
    requestId: string; reason: string;
  }, now = Date.now()): void {
    if (![input.expectedNetCents, input.netCents].every(amount => Number.isSafeInteger(amount) && amount >= 0 && amount <= 100_000_000)
      || !["adjusted", "refunded"].includes(input.entryType)
      || !Number.isFinite(new Date(input.accountingAt).getTime())) {
      throw new PurchaseSafetyError("checkout_correction_invalid", 400, "The revised report amounts are invalid.");
    }
    this.db.transaction(() => {
      const scope = currentRequestScope();
      const reservation = this.reservationForJob(input.actionJobId);
      if (!reservation || reservation.action !== "add_to_cart" || reservation.status === "active") {
        throw new PurchaseSafetyError("checkout_correction_unavailable", 409, "Only a closed cart report can be corrected.");
      }
      const current = this.db.get<{ amount: number }>(
        `SELECT COALESCE(SUM(spent_delta_cents), 0) AS amount FROM spend_ledger_entries
         WHERE tenant_id = ? AND user_id = ? AND reservation_id = ? AND action_job_id = ?`,
        scope.tenantId, scope.userId, reservation.id, input.actionJobId
      );
      if (Number(current?.amount) !== input.expectedNetCents || reservation.committedAmountCents !== input.expectedNetCents) {
        throw new PurchaseSafetyError("checkout_report_inconsistent", 409, "The report and spending record differ. Ask an administrator to review them before correcting this report.");
      }
      this.db.run(
        `INSERT INTO spend_ledger_entries(id, tenant_id, user_id, reservation_id, action_job_id, entry_type,
          reserved_delta_cents, spent_delta_cents, quantity_delta, currency, reason_code, correlation_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?)`,
        newId("spend_ledger"), scope.tenantId, scope.userId, reservation.id, input.actionJobId, input.entryType,
        input.netCents - input.expectedNetCents, reservation.currency, CHECKOUT_CORRECTION_REASON, input.requestId,
        JSON.stringify({ correctionId: input.correctionId, accountingAt: input.accountingAt,
          previousNetCents: input.expectedNetCents, revisedNetCents: input.netCents, reason: input.reason }), nowIso(now)
      );
      this.db.run(
        `UPDATE spend_reservations SET committed_amount_cents = ?, status = ?, release_reason = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ?`,
        input.netCents, input.purchased ? "committed" : "released", input.purchased ? "" : CHECKOUT_CORRECTION_REASON,
        nowIso(now), reservation.id, scope.tenantId, scope.userId
      );
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
    const starts = zonedPeriodStarts(now, policy.timezone, policy.periodResetHour);
    const active = this.db.get<{ amount: number; count: number }>(
      `SELECT COALESCE(SUM(reserved_amount_cents), 0) AS amount, COUNT(*) AS count
       FROM spend_reservations
       WHERE user_id = ? AND status = 'active' AND expires_at > ?`,
      currentRequestScope().userId,
      nowIso(now)
    );
    const spentTodayCents = Number(this.db.get<{ amount: number }>(
      `SELECT COALESCE(SUM(spent_delta_cents), 0) AS amount FROM spend_ledger_entries
       WHERE tenant_id = ? AND user_id = ? AND ${spendAccountingTimeSql("sqlite")} >= ?`,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      starts.day
    )?.amount ?? 0);
    const spentThisMonthCents = Number(this.db.get<{ amount: number }>(
      `SELECT COALESCE(SUM(spent_delta_cents), 0) AS amount FROM spend_ledger_entries
       WHERE tenant_id = ? AND user_id = ? AND ${spendAccountingTimeSql("sqlite")} >= ?`,
      currentRequestScope().tenantId,
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
              sl.created_at AS createdAt, sl.metadata_json AS metadataJson,
              ${spendAccountingTimeSql("sqlite", "sl")} AS accountingAt, sr.mission_id AS missionId,
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
              timezone, period_reset_hour AS periodResetHour,
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
