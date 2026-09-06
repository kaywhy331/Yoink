import { CHECKOUT_REPORT_REASONS_SQL, checkoutOriginalReportedAtSql, checkoutOutcomeSql, checkoutReportJoinSql } from "./checkout-report-projection.js";
import { nowIso } from "../../domain/src/ids.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

export const ADMIN_ANALYTICS_WINDOWS = ["24h", "7d", "30d"] as const;
export type AdminAnalyticsWindow = typeof ADMIN_ANALYTICS_WINDOWS[number];

const WINDOW_MS: Record<AdminAnalyticsWindow, number> = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000
};

const METRICS = [
  "signals", "matched", "jobs", "carted", "gotIt", "missed",
  "routesIssued", "affiliateRoutesIssued", "clicks", "affiliateClicks", "conversions"
] as const;
type AdminAnalyticsMetric = typeof METRICS[number];
type MetricCounts = Record<AdminAnalyticsMetric, number>;

export const ADMIN_ACTION_LATENCY_HOPS = [
  "observedToReceivedMs",
  "receivedToJobMs",
  "jobToLeaseMs",
  "leaseToBaselineMs",
  "baselineToOfferMs",
  "offerToClickMs",
  "clickToSettleMs",
  "settleToCartReadyMs",
  "leaseToCartReadyMs",
  "clickToCartReadyMs"
] as const;
export type AdminActionLatencyHop = typeof ADMIN_ACTION_LATENCY_HOPS[number];

export interface AdminActionLatencySnapshot {
  contractVersion: 1;
  maximumSampleSize: number;
  jobsSampled: number;
  hops: Record<AdminActionLatencyHop, {
    samples: number;
    p50Ms: number | null;
    p95Ms: number | null;
  }>;
}

interface MetricRow {
  day: string;
  retailerId: string;
  metric: AdminAnalyticsMetric;
  value: number;
}

export interface AdminAnalyticsSnapshot {
  contractVersion: 1;
  generatedAt: string;
  window: AdminAnalyticsWindow;
  since: string;
  through: string;
  totals: MetricCounts;
  overCap: { count: number; amountCents: number };
  latency: AdminActionLatencySnapshot;
  stores: Array<{ retailerId: string } & MetricCounts>;
  days: Array<{ day: string } & MetricCounts>;
}

function emptyMetrics(): MetricCounts {
  return Object.fromEntries(METRICS.map((metric) => [metric, 0])) as MetricCounts;
}

function boundedDuration(from: unknown, to: unknown, maximumMs = 24 * 60 * 60_000): number | null {
  const start = new Date(String(from || "")).getTime();
  const end = new Date(String(to || "")).getTime();
  const duration = Math.round(end - start);
  return Number.isSafeInteger(duration) && duration >= 0 && duration <= maximumMs ? duration : null;
}

function boundedStoredDuration(value: unknown): number | null {
  const duration = Number(value);
  return Number.isSafeInteger(duration) && duration >= 0 && duration <= 60 * 60_000 ? duration : null;
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? null;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function normalizeAdminAnalyticsWindow(value: unknown): AdminAnalyticsWindow {
  return ADMIN_ANALYTICS_WINDOWS.includes(value as AdminAnalyticsWindow)
    ? value as AdminAnalyticsWindow
    : "7d";
}

export class AdminAnalyticsRepository {
  private readonly authorization: AuthorizationRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.authorization = new AuthorizationRepository(db);
  }

  private actionLatency(tenantId: string, since: string, sampleLimit = 500): AdminActionLatencySnapshot {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(sampleLimit) || 500)));
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT job.created_at AS createdAt,
              (SELECT signal.observed_at
               FROM signal_occurrences occurrence
               JOIN signal_events signal ON signal.id = occurrence.event_id
               WHERE occurrence.incident_id = job.incident_id AND signal.user_id = job.user_id
               ORDER BY signal.received_at DESC, signal.id DESC LIMIT 1) AS signalObservedAt,
              (SELECT signal.received_at
               FROM signal_occurrences occurrence
               JOIN signal_events signal ON signal.id = occurrence.event_id
               WHERE occurrence.incident_id = job.incident_id AND signal.user_id = job.user_id
               ORDER BY signal.received_at DESC, signal.id DESC LIMIT 1) AS signalReceivedAt,
              (SELECT event.created_at FROM action_events event
               WHERE event.job_id = job.id AND event.state = 'leased'
               ORDER BY event.created_at, event.id LIMIT 1) AS leasedAt,
              (SELECT event.created_at FROM action_events event
               WHERE event.job_id = job.id AND event.state = 'confirmed'
                 AND event.reason_code NOT IN (${CHECKOUT_REPORT_REASONS_SQL})
               ORDER BY event.created_at, event.id LIMIT 1) AS cartReadyAt,
              (SELECT json_extract(event.evidence_json, '$.latency.leaseToCartReadyMs')
               FROM action_events event WHERE event.job_id = job.id
                 AND json_type(event.evidence_json, '$.latency.leaseToCartReadyMs') IN ('integer', 'real')
               ORDER BY event.created_at DESC, event.id DESC LIMIT 1) AS storedLeaseToCartReadyMs,
              (SELECT json_extract(event.evidence_json, '$.latency.leaseToBaselineMs')
               FROM action_events event WHERE event.job_id = job.id
                 AND json_type(event.evidence_json, '$.latency.leaseToBaselineMs') IN ('integer', 'real')
               ORDER BY event.created_at DESC, event.id DESC LIMIT 1) AS storedLeaseToBaselineMs,
              (SELECT json_extract(event.evidence_json, '$.latency.baselineToOfferMs')
               FROM action_events event WHERE event.job_id = job.id
                 AND json_type(event.evidence_json, '$.latency.baselineToOfferMs') IN ('integer', 'real')
               ORDER BY event.created_at DESC, event.id DESC LIMIT 1) AS storedBaselineToOfferMs,
              (SELECT json_extract(event.evidence_json, '$.latency.offerToClickMs')
               FROM action_events event WHERE event.job_id = job.id
                 AND json_type(event.evidence_json, '$.latency.offerToClickMs') IN ('integer', 'real')
               ORDER BY event.created_at DESC, event.id DESC LIMIT 1) AS storedOfferToClickMs,
              (SELECT json_extract(event.evidence_json, '$.latency.clickToSettleMs')
               FROM action_events event WHERE event.job_id = job.id
                 AND json_type(event.evidence_json, '$.latency.clickToSettleMs') IN ('integer', 'real')
               ORDER BY event.created_at DESC, event.id DESC LIMIT 1) AS storedClickToSettleMs,
              (SELECT json_extract(event.evidence_json, '$.latency.clickToCartReadyMs')
               FROM action_events event WHERE event.job_id = job.id
                 AND json_type(event.evidence_json, '$.latency.clickToCartReadyMs') IN ('integer', 'real')
               ORDER BY event.created_at DESC, event.id DESC LIMIT 1) AS storedClickToCartReadyMs,
              (SELECT json_extract(event.evidence_json, '$.latency.settleToCartReadyMs')
               FROM action_events event WHERE event.job_id = job.id
                 AND json_type(event.evidence_json, '$.latency.settleToCartReadyMs') IN ('integer', 'real')
               ORDER BY event.created_at DESC, event.id DESC LIMIT 1) AS storedSettleToCartReadyMs
       FROM action_jobs job
       WHERE job.tenant_id = ? AND job.created_at >= ?
       ORDER BY job.created_at DESC LIMIT ?`,
      tenantId,
      since,
      safeLimit
    );
    const samples = rows.map((row) => ({
      observedToReceivedMs: boundedDuration(row.signalObservedAt, row.signalReceivedAt),
      receivedToJobMs: boundedDuration(row.signalReceivedAt, row.createdAt),
      jobToLeaseMs: boundedDuration(row.createdAt, row.leasedAt),
      leaseToBaselineMs: boundedStoredDuration(row.storedLeaseToBaselineMs),
      baselineToOfferMs: boundedStoredDuration(row.storedBaselineToOfferMs),
      offerToClickMs: boundedStoredDuration(row.storedOfferToClickMs),
      clickToSettleMs: boundedStoredDuration(row.storedClickToSettleMs),
      settleToCartReadyMs: boundedStoredDuration(row.storedSettleToCartReadyMs),
      leaseToCartReadyMs: boundedStoredDuration(row.storedLeaseToCartReadyMs)
        ?? boundedDuration(row.leasedAt, row.cartReadyAt, 60 * 60_000),
      clickToCartReadyMs: boundedStoredDuration(row.storedClickToCartReadyMs)
    } satisfies Record<AdminActionLatencyHop, number | null>));
    const hops = Object.fromEntries(ADMIN_ACTION_LATENCY_HOPS.map((hop) => {
      const values = samples.map((sample) => sample[hop]).filter((value): value is number => Number.isSafeInteger(value));
      return [hop, { samples: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) }];
    })) as AdminActionLatencySnapshot["hops"];
    return { contractVersion: 1, maximumSampleSize: safeLimit, jobsSampled: samples.length, hops };
  }

  snapshot(windowInput: unknown = "7d", now = Date.now()): AdminAnalyticsSnapshot {
    this.authorization.require("admin.read");
    const window = normalizeAdminAnalyticsWindow(windowInput);
    const through = nowIso(now);
    const since = nowIso(now - WINDOW_MS[window]);
    const tenantId = currentRequestScope().tenantId;
    const rows = this.db.all<MetricRow>(
      `SELECT day, retailerId, metric, COUNT(*) AS value FROM (
         SELECT substr(signal.received_at, 1, 10) AS day,
                lower(COALESCE(json_extract(signal.identity_json, '$.retailerId'), '')) AS retailerId,
                'signals' AS metric, signal.id AS identity
         FROM signal_events signal
         WHERE signal.tenant_id = ? AND signal.received_at >= ?
         UNION ALL
         SELECT substr(signal.received_at, 1, 10),
                lower(COALESCE(json_extract(signal.identity_json, '$.retailerId'), '')),
                'matched', signal.id
         FROM signal_events signal
         WHERE signal.tenant_id = ? AND signal.received_at >= ? AND signal.resolution_status = 'matched'
         UNION ALL
         SELECT substr(job.created_at, 1, 10), listing.retailer_id, 'jobs', job.id
         FROM action_jobs job JOIN listings listing ON listing.id = job.listing_id
         WHERE job.tenant_id = ? AND job.created_at >= ?
         UNION ALL
         SELECT substr(MIN(event.created_at), 1, 10), listing.retailer_id, 'carted', event.job_id
         FROM action_events event
         JOIN action_jobs job ON job.id = event.job_id
         JOIN listings listing ON listing.id = job.listing_id
         WHERE job.tenant_id = ? AND event.created_at >= ? AND event.state = 'confirmed'
           AND event.reason_code NOT IN (${CHECKOUT_REPORT_REASONS_SQL})
         GROUP BY event.job_id, listing.retailer_id
         UNION ALL
         SELECT substr(${checkoutOriginalReportedAtSql("job")}, 1, 10), listing.retailer_id, 'gotIt', event.job_id
         FROM action_jobs job ${checkoutReportJoinSql("job", "event")}
         JOIN listings listing ON listing.id = job.listing_id
         WHERE job.tenant_id = ? AND ${checkoutOriginalReportedAtSql("job")} >= ? AND ${checkoutOutcomeSql("event")} = 'got_it'
         UNION ALL
         SELECT substr(${checkoutOriginalReportedAtSql("job")}, 1, 10), listing.retailer_id, 'missed', event.job_id
         FROM action_jobs job ${checkoutReportJoinSql("job", "event")}
         JOIN listings listing ON listing.id = job.listing_id
         WHERE job.tenant_id = ? AND ${checkoutOriginalReportedAtSql("job")} >= ? AND ${checkoutOutcomeSql("event")} = 'missed_it'
         UNION ALL
         SELECT substr(receipt.created_at, 1, 10), receipt.retailer_id, 'routesIssued', receipt.id
         FROM attribution_receipts receipt
         WHERE receipt.tenant_id = ? AND receipt.created_at >= ?
         UNION ALL
         SELECT substr(receipt.created_at, 1, 10), receipt.retailer_id, 'affiliateRoutesIssued', receipt.id
         FROM attribution_receipts receipt
         WHERE receipt.tenant_id = ? AND receipt.created_at >= ? AND receipt.outcome = 'affiliate_route'
         UNION ALL
         SELECT substr(audit.created_at, 1, 10), lower(json_extract(audit.data_json, '$.retailerId')), 'clicks', audit.id
         FROM audit_events audit
         WHERE audit.tenant_id = ? AND audit.created_at >= ?
           AND audit.event_type IN ('store_link_clicked', 'walmart_purchase_handoff_clicked')
         UNION ALL
         SELECT substr(audit.created_at, 1, 10), lower(json_extract(audit.data_json, '$.retailerId')), 'affiliateClicks', audit.id
         FROM audit_events audit
         WHERE audit.tenant_id = ? AND audit.created_at >= ?
           AND audit.event_type IN ('store_link_clicked', 'walmart_purchase_handoff_clicked')
           AND json_extract(audit.data_json, '$.routeKind') IN ('affiliate', 'howl')
         UNION ALL
         SELECT substr(${checkoutOriginalReportedAtSql("job")}, 1, 10), listing.retailer_id, 'conversions', event.job_id
         FROM action_jobs job ${checkoutReportJoinSql("job", "event")}
         JOIN listings listing ON listing.id = job.listing_id
         WHERE job.tenant_id = ? AND ${checkoutOriginalReportedAtSql("job")} >= ? AND ${checkoutOutcomeSql("event")} = 'got_it'
           AND EXISTS (
             SELECT 1 FROM audit_events click
             WHERE click.tenant_id = job.tenant_id AND click.correlation_id = job.id
               AND click.event_type IN ('store_link_clicked', 'walmart_purchase_handoff_clicked')
               AND json_extract(click.data_json, '$.routeKind') IN ('affiliate', 'howl')
               AND click.created_at <= ${checkoutOriginalReportedAtSql("job")}
           )
       ) event_metrics
       WHERE retailerId <> ''
       GROUP BY day, retailerId, metric
       ORDER BY day, retailerId, metric`,
      tenantId, since,
      tenantId, since,
      tenantId, since,
      tenantId, since,
      tenantId, since,
      tenantId, since,
      tenantId, since,
      tenantId, since,
      tenantId, since,
      tenantId, since,
      tenantId, since
    );
    const overCap = this.db.get<{ count: number; amountCents: number }>(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CAST(json_extract(event.evidence_json, '$.overCapAmountCents') AS INTEGER)), 0) AS amountCents
       FROM action_jobs job ${checkoutReportJoinSql("job", "event")}
       WHERE job.tenant_id = ? AND ${checkoutOriginalReportedAtSql("job")} >= ?
         AND ${checkoutOutcomeSql("event")} = 'got_it'
         AND json_extract(event.evidence_json, '$.overCap') = 1`,
      tenantId,
      since
    );
    const latency = this.actionLatency(tenantId, since);
    const totals = emptyMetrics();
    const stores = new Map<string, MetricCounts>();
    const days = new Map<string, MetricCounts>();
    for (const row of rows) {
      if (!METRICS.includes(row.metric)) continue;
      const value = Number(row.value ?? 0);
      totals[row.metric] += value;
      const store = stores.get(row.retailerId) ?? emptyMetrics();
      store[row.metric] += value;
      stores.set(row.retailerId, store);
      const day = days.get(row.day) ?? emptyMetrics();
      day[row.metric] += value;
      days.set(row.day, day);
    }
    return {
      contractVersion: 1,
      generatedAt: through,
      window,
      since,
      through,
      totals,
      overCap: {
        count: Number(overCap?.count ?? 0),
        amountCents: Number(overCap?.amountCents ?? 0)
      },
      latency,
      stores: [...stores.entries()].map(([retailerId, counts]) => ({ retailerId, ...counts }))
        .sort((left, right) => right.signals - left.signals || left.retailerId.localeCompare(right.retailerId)),
      days: [...days.entries()].map(([day, counts]) => ({ day, ...counts }))
        .sort((left, right) => left.day.localeCompare(right.day))
    };
  }

  csv(windowInput: unknown = "7d", now = Date.now()): string {
    const snapshot = this.snapshot(windowInput, now);
    const rows: unknown[][] = [
      ["scope", "period", "retailer", "metric", "value"],
      ...METRICS.map((metric) => ["total", snapshot.window, "", metric, snapshot.totals[metric]]),
      ["total", snapshot.window, "", "overCapOrders", snapshot.overCap.count],
      ["total", snapshot.window, "", "overCapAmountCents", snapshot.overCap.amountCents],
      ...ADMIN_ACTION_LATENCY_HOPS.flatMap((hop) => [
        ["latency", snapshot.window, "", `${hop}.samples`, snapshot.latency.hops[hop].samples],
        ["latency", snapshot.window, "", `${hop}.p50Ms`, snapshot.latency.hops[hop].p50Ms ?? ""],
        ["latency", snapshot.window, "", `${hop}.p95Ms`, snapshot.latency.hops[hop].p95Ms ?? ""]
      ]),
      ...snapshot.stores.flatMap((store) => METRICS.map((metric) => ["store", snapshot.window, store.retailerId, metric, store[metric]])),
      ...snapshot.days.flatMap((day) => METRICS.map((metric) => ["day", day.day, "", metric, day[metric]]))
    ];
    return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  }
}
