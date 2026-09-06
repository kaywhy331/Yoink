import type { JobState } from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { canTransitionJob } from "../../domain/src/job-state.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import { CHECKOUT_CORRECTION_REASON, CHECKOUT_REPORT_REASONS_SQL, checkoutReportOrderSql } from "./checkout-report-projection.js";
import type { YoinkDatabase } from "./database.js";
import { PurchaseSafetyError } from "./purchase-policy-repository.js";
import { currentRequestScope } from "./request-scope.js";
import { SignalRepository } from "./signal-repository.js";
import { SpendLedgerRepository } from "./spend-ledger-repository.js";

export const CHECKOUT_CORRECTION_CONFIRMATION = "CORRECT_CHECKOUT_REPORT";
interface ReportEvent { id: string; reasonCode: string; evidenceJson: string; createdAt: string }
interface PlanProgress { id: string; status: string; targetQuantity: number; fulfilledQuantity: number; updatedAt: string }
interface ReportValues { outcome: "got_it" | "missed_it"; actualTotalCents: number | null; refundedCents: number; netCents: number }
export interface CheckoutCorrectionInput {
  kind?: unknown; outcome?: unknown; actualTotalCents?: unknown; refundedCents?: unknown; refundAmountCents?: unknown;
  fulfilledQuantity?: unknown; reason?: unknown; expectedReportId?: unknown;
  fingerprint?: unknown; requestId?: unknown; confirmation?: unknown;
}
const invalid = (message: string, code = "checkout_correction_invalid", status: 400 | 404 | 409 = 400): never => {
  throw new PurchaseSafetyError(code, status, message);
};
function amount(value: unknown, label: string, allowZero = true): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 100_000_000) {
    return invalid(`${label} must be ${allowZero ? "zero or " : ""}a positive amount within the supported reporting range.`);
  }
  return value;
}
function evidence(event: ReportEvent): Record<string, any> {
  try {
    const data: unknown = JSON.parse(event.evidenceJson);
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, any>;
  } catch { /* Reject damaged history without overwriting it. */ }
  return invalid("This report needs administrator review before it can be corrected.", "checkout_report_inconsistent", 409);
}
function values(event: ReportEvent): ReportValues {
  const data = evidence(event);
  const outcome = event.reasonCode === "user_reported_order" ? "got_it"
    : event.reasonCode === "user_reported_missed_it" ? "missed_it" : data.outcome;
  if (outcome !== "got_it" && outcome !== "missed_it") return invalid("This report's outcome is unavailable.", "checkout_report_inconsistent", 409);
  const total = outcome === "got_it" ? amount(data.actualTotalCents, "The recorded charge", true) : null;
  const refundedCents = outcome === "got_it" ? amount(data.refundedCents ?? 0, "The recorded refunds") : 0;
  if (refundedCents > Number(total)) return invalid("Recorded refunds exceed the charge.", "checkout_report_inconsistent", 409);
  return { outcome, actualTotalCents: total, refundedCents, netCents: Number(total) - refundedCents };
}

export class CheckoutReportRepository {
  constructor(private readonly db: YoinkDatabase) {}

  private context(jobId: string) {
    const scope = currentRequestScope();
    const job = this.db.get<{ id: string; missionId: string; state: JobState; quantity: number; currency: string; title: string; retailerId: string; retailerSku: string; maxOrderTotalCents: number }>(
      `SELECT job.id, job.mission_id AS missionId, job.state, job.quantity, job.currency,
        variant.title, listing.retailer_id AS retailerId, listing.retailer_sku AS retailerSku,
        job.max_order_total_cents AS maxOrderTotalCents
       FROM action_jobs job JOIN listings listing ON listing.id = job.listing_id
       JOIN variants variant ON variant.id = listing.variant_id
       WHERE job.id = ? AND job.tenant_id = ? AND job.user_id = ? AND job.action = 'add_to_cart'`,
      jobId, scope.tenantId, scope.userId
    );
    if (!job) return invalid("This checkout report is unavailable.", "checkout_report_not_found", 404);
    const original = this.db.get<ReportEvent>(
      `SELECT id, reason_code AS reasonCode, evidence_json AS evidenceJson, created_at AS createdAt
       FROM action_events WHERE job_id = ? AND reason_code IN ('user_reported_order', 'user_reported_missed_it')
       ORDER BY created_at, id LIMIT 1`, job.id
    );
    if (!original) return invalid("Record Got it or Missed it before correcting this report.", "checkout_report_not_found", 404);
    const current = this.db.get<ReportEvent>(
      `SELECT report.id, report.reason_code AS reasonCode, report.evidence_json AS evidenceJson, report.created_at AS createdAt
       FROM action_events report WHERE report.job_id = ? AND report.reason_code IN (${CHECKOUT_REPORT_REASONS_SQL})
       ORDER BY ${checkoutReportOrderSql("report")} LIMIT 1`, job.id
    )!;
    const plan = this.db.get<PlanProgress>(
      `SELECT id, status, target_quantity AS targetQuantity, fulfilled_quantity AS fulfilledQuantity, updated_at AS updatedAt
       FROM missions WHERE id = ? AND tenant_id = ? AND user_id = ?`, job.missionId, scope.tenantId, scope.userId
    );
    if (!plan) return invalid("The report's plan is unavailable.", "checkout_report_not_found", 404);
    const accountingAt = this.db.get<{ createdAt: string }>(
      `SELECT created_at AS createdAt FROM spend_ledger_entries WHERE action_job_id = ? AND tenant_id = ? AND user_id = ?
       AND entry_type = 'committed' ORDER BY created_at, id LIMIT 1`, job.id, scope.tenantId, scope.userId
    )?.createdAt ?? original.createdAt;
    const pending = this.db.all<{ id: string; state: JobState }>(
      `SELECT id, state FROM action_jobs WHERE mission_id = ? AND tenant_id = ? AND user_id = ? AND id <> ?
       AND state NOT IN ('notify_only', 'confirmed', 'expired', 'cancelled', 'offer_rejected') ORDER BY id`,
      plan.id, scope.tenantId, scope.userId, job.id
    );
    return { job, original, current, plan, pending, accountingAt, before: values(current) };
  }

  get(jobId: string, offset = 0) {
    const context = this.context(jobId);
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const history = this.db.all<ReportEvent>(
      `SELECT report.id, report.reason_code AS reasonCode, report.evidence_json AS evidenceJson, report.created_at AS createdAt
       FROM action_events report WHERE report.job_id = ? AND report.reason_code IN (${CHECKOUT_REPORT_REASONS_SQL})
       ORDER BY ${checkoutReportOrderSql("report")} LIMIT 25 OFFSET ?`, context.job.id, safeOffset
    ).map(event => {
      const data = evidence(event);
      return { id: event.id, createdAt: event.createdAt, kind: event.reasonCode === CHECKOUT_CORRECTION_REASON ? data.kind : "original",
        reason: String(data.reason || data.note || ""), before: data.before ?? null, after: values(event), planChange: data.planChange ?? null };
    });
    const total = Number(this.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM action_events WHERE job_id = ? AND reason_code IN (${CHECKOUT_REPORT_REASONS_SQL})`, context.job.id)?.count ?? 0);
    return { job: context.job, report: { id: context.current.id, ...context.before, reportedAt: context.original.createdAt, updatedAt: context.current.createdAt },
      original: { id: context.original.id, ...values(context.original) }, accountingAt: context.accountingAt,
      plan: context.plan, history: { items: history, offset: safeOffset, total } };
  }

  preview(jobId: string, input: CheckoutCorrectionInput) {
    const context = this.context(jobId);
    if (input.expectedReportId !== context.current.id) return invalid("This report changed. Reload it before reviewing a correction.", "checkout_report_changed", 409);
    if (!["confirmed", "cancelled"].includes(context.job.state)) return invalid("Finish reviewing the current cart action before correcting its report.", "checkout_correction_unavailable", 409);
    if (input.kind !== "correction" && input.kind !== "refund") return invalid("Choose a report correction or refund.");
    const reason = cleanText(input.reason, 300);
    if (reason.length < 3) return invalid("Add a short reason for this change.");
    let after: ReportValues;
    let refundAmountCents: number | null = null;
    if (input.kind === "refund") {
      if (context.before.outcome !== "got_it") return invalid("A refund requires a recorded purchase.");
      refundAmountCents = amount(input.refundAmountCents, "The refund", false);
      if (refundAmountCents > context.before.netCents) return invalid("The refund cannot exceed the amount that has not been refunded.");
      after = { ...context.before, refundedCents: context.before.refundedCents + refundAmountCents, netCents: context.before.netCents - refundAmountCents };
    } else {
      if (input.outcome !== "got_it" && input.outcome !== "missed_it") return invalid("Choose Got it or Missed it.");
      const total = input.outcome === "got_it" ? amount(input.actualTotalCents, "The corrected charge", false) : null;
      const refundedCents = input.outcome === "got_it" ? amount(input.refundedCents ?? 0, "The corrected refunds") : 0;
      if (refundedCents > Number(total)) return invalid("Total refunds cannot exceed the corrected charge.");
      after = { outcome: input.outcome, actualTotalCents: total, refundedCents, netCents: Number(total) - refundedCents };
    }
    if (JSON.stringify(after) === JSON.stringify(context.before)) return invalid("Change the outcome, charge or refund total before reviewing a correction.");
    const outcomeChanged = after.outcome !== context.before.outcome;
    let planChange: { before: PlanProgress; after: PlanProgress; pendingActionCount: number } | null = null;
    let fulfilledQuantity: number | null = null;
    if (outcomeChanged && context.plan.status !== "deleted") {
      const suggested = Math.min(context.plan.targetQuantity, Math.max(0, context.plan.fulfilledQuantity + (after.outcome === "got_it" ? 1 : -1) * context.job.quantity));
      fulfilledQuantity = input.fulfilledQuantity === undefined || input.fulfilledQuantity === null ? suggested : amount(input.fulfilledQuantity, "The fulfilled quantity");
      if (fulfilledQuantity > context.plan.targetQuantity) return invalid("Plan progress cannot exceed the quantity wanted.");
      if (context.pending.some(job => !canTransitionJob(job.state, "cancelled") || !["shadow_ready", "awaiting_executor", "leased"].includes(job.state))) {
        return invalid("This plan has a cart action that needs your review. Resolve it before changing the reported outcome; amounts can still be corrected separately.", "checkout_plan_needs_review", 409);
      }
      const status = ["archived", "paused"].includes(context.plan.status) ? context.plan.status
        : fulfilledQuantity >= context.plan.targetQuantity ? "satisfied" : "paused";
      planChange = { before: context.plan, after: { ...context.plan, fulfilledQuantity, status }, pendingActionCount: context.pending.length };
    }
    const draft = { kind: input.kind, outcome: after.outcome, actualTotalCents: after.actualTotalCents, refundedCents: after.refundedCents,
      refundAmountCents, fulfilledQuantity, reason, expectedReportId: context.current.id };
    const fingerprint = stableHash(JSON.stringify({ jobId, current: context.current.id, draft, accountingAt: context.accountingAt,
      plan: planChange ? context.plan : null, pending: planChange ? context.pending : [] }));
    return { jobId, before: context.before, after, draft, fingerprint, accountingAt: context.accountingAt,
      planChange, overCapAmountCents: after.outcome === "got_it" ? Math.max(0, Number(after.actualTotalCents) - context.job.maxOrderTotalCents) : 0 };
  }

  correct(jobId: string, input: CheckoutCorrectionInput, now = Date.now()) {
    if (input.confirmation !== CHECKOUT_CORRECTION_CONFIRMATION) return invalid("Review and confirm this checkout report change.");
    if (typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(input.requestId)) return invalid("A unique correction request ID is required.");
    const requestId = input.requestId;
    const commandHash = stableHash(JSON.stringify({ jobId, kind: input.kind, outcome: input.outcome, actualTotalCents: input.actualTotalCents ?? null,
      refundedCents: input.refundedCents ?? null, refundAmountCents: input.refundAmountCents ?? null, fulfilledQuantity: input.fulfilledQuantity ?? null,
      reason: cleanText(input.reason, 300), expectedReportId: input.expectedReportId, fingerprint: input.fingerprint }));
    return this.db.transaction(() => {
      const scope = currentRequestScope();
      const previous = this.db.get<ReportEvent>(
        `SELECT event.id, event.reason_code AS reasonCode, event.evidence_json AS evidenceJson, event.created_at AS createdAt
         FROM action_events event JOIN action_jobs job ON job.id = event.job_id
         WHERE job.tenant_id = ? AND job.user_id = ? AND event.reason_code = ?
         AND json_extract(event.evidence_json, '$.requestId') = ? LIMIT 1`, scope.tenantId, scope.userId, CHECKOUT_CORRECTION_REASON, requestId
      );
      if (previous) {
        if (evidence(previous).commandHash !== commandHash) return invalid("This request ID was already used for a different correction.", "checkout_correction_request_conflict", 409);
        return { disposition: "unchanged", correctionId: previous.id, receipt: evidence(previous), report: this.get(jobId) };
      }
      const preview = this.preview(jobId, input);
      if (!input.fingerprint || input.fingerprint !== preview.fingerprint) return invalid("The report or plan changed after review. Review the correction again.", "checkout_correction_review_changed", 409);
      if (preview.planChange && (input.fulfilledQuantity === undefined || input.fulfilledQuantity === null)) return invalid("Review the revised plan progress before saving.");
      const context = this.context(jobId);
      const correctionId = newId("action_event");
      if (preview.planChange) {
        preview.planChange.after.updatedAt = nowIso(now);
        const signals = new SignalRepository(this.db);
        for (const job of context.pending) signals.transitionJob(job.id, "cancelled", "checkout_outcome_corrected", "The user corrected plan progress; this pending action was cancelled for review.", {}, now);
        this.db.run(`UPDATE missions SET fulfilled_quantity = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND user_id = ?`,
          preview.planChange.after.fulfilledQuantity, preview.planChange.after.status, nowIso(now), context.plan.id, scope.tenantId, scope.userId);
      }
      new SpendLedgerRepository(this.db).adjustUserReportedSpend({ actionJobId: jobId, expectedNetCents: preview.before.netCents,
        netCents: preview.after.netCents, purchased: preview.after.outcome === "got_it", entryType: input.kind === "refund" ? "refunded" : "adjusted",
        accountingAt: context.accountingAt, correctionId, requestId: input.requestId as string, reason: preview.draft.reason }, now);
      const revision = Number(evidence(context.current).revision || 0) + 1;
      const receipt = { contractVersion: 1, ...preview.after, revision, requestId: input.requestId, commandHash, kind: input.kind,
        actualTotalCents: preview.after.actualTotalCents, reason: preview.draft.reason, previousReportId: context.current.id,
        originalReportId: context.original.id, accountingAt: context.accountingAt, before: preview.before,
        planChange: preview.planChange, overCap: preview.overCapAmountCents > 0, overCapAmountCents: preview.overCapAmountCents,
        quantity: context.job.quantity, currency: context.job.currency, evidenceSource: "user_reported" };
      this.db.run(`INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        correctionId, jobId, context.job.state, CHECKOUT_CORRECTION_REASON,
        input.kind === "refund" ? "The user recorded a refund for manual checkout." : "The user corrected the manual checkout report.", JSON.stringify(receipt), nowIso(now));
      new AuditRepository(this.db).record({ correlationId: jobId, aggregateType: "checkout_report", eventType: CHECKOUT_CORRECTION_REASON,
        reasonCode: String(input.kind), message: "The user confirmed an append-only checkout report correction.",
        data: { correctionId, originalReportId: context.original.id, previousReportId: context.current.id, before: preview.before,
          after: preview.after, reason: preview.draft.reason, accountingAt: context.accountingAt, planChange: preview.planChange } }, now);
      return { disposition: "corrected", correctionId, receipt, report: this.get(jobId) };
    });
  }
}
