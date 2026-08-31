import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import { SignalRepository } from "./signal-repository.js";
import { SpendLedgerRepository } from "./spend-ledger-repository.js";

export interface UserActionAnalytics {
  contractVersion: 1;
  generatedAt: string;
  funnel: Record<string, number>;
  hitRateBps: number | null;
  spend: {
    committedCents: number;
    reservedCents: number;
    perOrderCapCents: number | null;
    dailyCapCents: number | null;
    monthlyCapCents: number | null;
    availableTodayCents: number | null;
    availableThisMonthCents: number | null;
    currency: "USD";
    savingsVsMsrpCents: number | null;
    savingsCoveredOrders: number;
    reportedOrders: number;
    savingsCoverage: "complete" | "partial" | "unavailable_without_msrp_evidence";
  };
  latency: Record<string, unknown>;
  retailers: Array<{
    retailerId: string;
    actions: number;
    carted: number;
    gotIt: number;
    missed: number;
    committedCents: number;
  }>;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class ActionAnalyticsRepository {
  private readonly signals: SignalRepository;
  private readonly spend: SpendLedgerRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.signals = new SignalRepository(db);
    this.spend = new SpendLedgerRepository(db);
  }

  snapshot(now = Date.now()): UserActionAnalytics {
    const scope = currentRequestScope();
    const insights = this.signals.actionInsights(500);
    const funnel = insights.stages as Record<string, number>;
    const outcomes = this.db.get<{ gotIt: number; missed: number }>(
      `SELECT
         SUM(CASE WHEN event.reason_code = 'user_reported_order' THEN 1 ELSE 0 END) AS gotIt,
         SUM(CASE WHEN event.reason_code = 'user_reported_missed_it' THEN 1 ELSE 0 END) AS missed
       FROM action_events event JOIN action_jobs job ON job.id = event.job_id
       WHERE job.tenant_id = ? AND job.user_id = ?
         AND event.reason_code IN ('user_reported_order', 'user_reported_missed_it')`,
      scope.tenantId,
      scope.userId
    );
    const gotIt = Number(outcomes?.gotIt ?? 0);
    const closedOutcomes = gotIt + Number(outcomes?.missed ?? 0);
    const spendSummary = this.spend.summary(now, false);
    const committedCents = Number(this.db.get<{ amount: number }>(
      `SELECT COALESCE(SUM(spent_delta_cents), 0) AS amount FROM spend_ledger_entries
       WHERE tenant_id = ? AND user_id = ? AND entry_type = 'committed'`,
      scope.tenantId,
      scope.userId
    )?.amount ?? 0);
    const savings = this.db.get<{ amount: number; covered: number; reported: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN listing.msrp_cents IS NOT NULL
           THEN listing.msrp_cents * job.quantity
             - CAST(json_extract(event.evidence_json, '$.actualTotalCents') AS INTEGER)
           ELSE 0 END), 0) AS amount,
         SUM(CASE WHEN listing.msrp_cents IS NOT NULL THEN 1 ELSE 0 END) AS covered,
         COUNT(*) AS reported
       FROM action_events event
       JOIN action_jobs job ON job.id = event.job_id
       JOIN listings listing ON listing.id = job.listing_id
       WHERE job.tenant_id = ? AND job.user_id = ?
         AND event.reason_code = 'user_reported_order'
         AND json_type(event.evidence_json, '$.actualTotalCents') = 'integer'`,
      scope.tenantId,
      scope.userId
    );
    const reportedOrders = Number(savings?.reported ?? 0);
    const savingsCoveredOrders = Number(savings?.covered ?? 0);
    const retailers = this.db.all<{
      retailerId: string;
      actions: number;
      carted: number;
      gotIt: number;
      missed: number;
      committedCents: number;
    }>(
      `SELECT listing.retailer_id AS retailerId, COUNT(*) AS actions,
              SUM(CASE WHEN job.state = 'confirmed' THEN 1 ELSE 0 END) AS carted,
              SUM(CASE WHEN EXISTS (
                SELECT 1 FROM action_events event WHERE event.job_id = job.id
                  AND event.reason_code = 'user_reported_order'
              ) THEN 1 ELSE 0 END) AS gotIt,
              SUM(CASE WHEN EXISTS (
                SELECT 1 FROM action_events event WHERE event.job_id = job.id
                  AND event.reason_code = 'user_reported_missed_it'
              ) THEN 1 ELSE 0 END) AS missed,
              COALESCE(SUM(CASE WHEN reservation.status = 'committed'
                THEN reservation.committed_amount_cents ELSE 0 END), 0) AS committedCents
       FROM action_jobs job
       JOIN listings listing ON listing.id = job.listing_id
       LEFT JOIN spend_reservations reservation ON reservation.id = job.spend_reservation_id
       WHERE job.tenant_id = ? AND job.user_id = ?
       GROUP BY listing.retailer_id ORDER BY actions DESC, listing.retailer_id`,
      scope.tenantId,
      scope.userId
    ).map((row) => ({
      retailerId: row.retailerId,
      actions: Number(row.actions),
      carted: Number(row.carted),
      gotIt: Number(row.gotIt),
      missed: Number(row.missed),
      committedCents: Number(row.committedCents)
    }));
    return {
      contractVersion: 1,
      generatedAt: new Date(now).toISOString(),
      funnel,
      hitRateBps: closedOutcomes ? Math.round(gotIt * 10_000 / closedOutcomes) : null,
      spend: {
        committedCents,
        reservedCents: spendSummary.activeReservedCents,
        perOrderCapCents: spendSummary.policy.perOrderCapCents,
        dailyCapCents: spendSummary.policy.dailyCapCents,
        monthlyCapCents: spendSummary.policy.monthlyCapCents,
        availableTodayCents: spendSummary.availableTodayCents,
        availableThisMonthCents: spendSummary.availableThisMonthCents,
        currency: "USD",
        savingsVsMsrpCents: savingsCoveredOrders ? Number(savings?.amount ?? 0) : null,
        savingsCoveredOrders,
        reportedOrders,
        savingsCoverage: savingsCoveredOrders === 0
          ? "unavailable_without_msrp_evidence"
          : savingsCoveredOrders === reportedOrders ? "complete" : "partial"
      },
      latency: insights.latency as Record<string, unknown>,
      retailers
    };
  }

  csv(now = Date.now()): string {
    const snapshot = this.snapshot(now);
    const latency = snapshot.latency as {
      hops?: Record<string, { samples?: unknown; p50Ms?: unknown; p95Ms?: unknown }>;
    };
    const rows = [
      ["section", "metric", "retailer", "value", "unit", "coverage"],
      ["meta", "generated_at", "", snapshot.generatedAt, "iso8601", ""],
      ...Object.entries(snapshot.funnel).map(([stage, value]) =>
        ["funnel", stage, "", value, "actions", "complete"]),
      ["outcome", "hit_rate_bps", "", snapshot.hitRateBps ?? "", "basis_points",
        snapshot.hitRateBps === null ? "no_closed_outcomes" : "complete"],
      ["spend", "committed_cents", "", snapshot.spend.committedCents, "cents", "USD"],
      ["spend", "reserved_cents", "", snapshot.spend.reservedCents, "cents", "USD"],
      ["spend", "per_order_cap_cents", "", snapshot.spend.perOrderCapCents ?? "", "cents", "USD"],
      ["spend", "daily_cap_cents", "", snapshot.spend.dailyCapCents ?? "", "cents", "USD"],
      ["spend", "monthly_cap_cents", "", snapshot.spend.monthlyCapCents ?? "", "cents", "USD"],
      ["spend", "available_today_cents", "", snapshot.spend.availableTodayCents ?? "", "cents", "USD"],
      ["spend", "available_this_month_cents", "", snapshot.spend.availableThisMonthCents ?? "", "cents", "USD"],
      ["savings", "vs_msrp_cents", "", snapshot.spend.savingsVsMsrpCents ?? "", "cents", snapshot.spend.savingsCoverage],
      ["savings", "covered_orders", "", snapshot.spend.savingsCoveredOrders, "orders", snapshot.spend.savingsCoverage],
      ["savings", "reported_orders", "", snapshot.spend.reportedOrders, "orders", snapshot.spend.savingsCoverage],
      ...Object.entries(latency.hops || {}).flatMap(([hop, value]) => [
        ["latency", `${hop}_p50`, "", value.p50Ms ?? "", "milliseconds", `${Number(value.samples ?? 0)} samples`],
        ["latency", `${hop}_p95`, "", value.p95Ms ?? "", "milliseconds", `${Number(value.samples ?? 0)} samples`]
      ]),
      ...snapshot.retailers.flatMap((retailer) => [
        ["retailer", "actions", retailer.retailerId, retailer.actions, "actions", "complete"],
        ["retailer", "carted", retailer.retailerId, retailer.carted, "actions", "complete"],
        ["retailer", "got_it", retailer.retailerId, retailer.gotIt, "outcomes", "complete"],
        ["retailer", "missed", retailer.retailerId, retailer.missed, "outcomes", "complete"],
        ["retailer", "committed_cents", retailer.retailerId, retailer.committedCents, "cents", "USD"]
      ])
    ];
    return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  }
}
