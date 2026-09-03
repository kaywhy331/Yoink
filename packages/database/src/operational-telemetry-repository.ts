import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

export const OPERATIONAL_TELEMETRY_RETENTION_DAYS = 30;
export const OPERATIONAL_TELEMETRY_WINDOWS = Object.freeze({
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000
});
export type OperationalTelemetryWindow = keyof typeof OPERATIONAL_TELEMETRY_WINDOWS;

export const OPERATIONAL_ROUTE_KEYS = Object.freeze([
  "public.health",
  "public.extension_release",
  "public.device_pair",
  "public.other",
  "user.overview",
  "user.authorization",
  "user.catalog",
  "user.purchase_intents",
  "user.spend",
  "user.library",
  "user.missions",
  "user.signals",
  "user.jobs",
  "user.audit",
  "user.strategies",
  "user.devices",
  "user.community",
  "user.identity",
  "user.attribution",
  "user.settings",
  "user.actions",
  "user.privacy",
  "user.other",
  "admin.snapshot",
  "admin.operations",
  "admin.authorization",
  "admin.catalog",
  "admin.identity",
  "admin.observer_recipes",
  "admin.qualifications",
  "admin.alerts",
  "admin.sources",
  "admin.attribution",
  "admin.change_control",
  "admin.workers",
  "admin.other",
  "device.heartbeat",
  "device.credential_rotation",
  "device.adapter_diagnostics",
  "device.observations",
  "device.drawings",
  "device.qualification_trials",
  "device.jobs",
  "device.notifications",
  "device.sources",
  "device.community",
  "device.recipes",
  "device.other",
  "internal.principals",
  "internal.delivery",
  "internal.eligibility",
  "internal.other"
] as const);
export type OperationalRouteKey = typeof OPERATIONAL_ROUTE_KEYS[number];

type OperationalActorKind = "maintainer" | "user" | "device" | "service";
type OperationalStatusClass = "success" | "redirect" | "client_error" | "server_error";
type OperationalLatencyBucket = "lt_100" | "lt_500" | "lt_2000" | "gte_2000";

export interface OperationalTelemetryRecordInput {
  correlationId: string;
  routeKey: OperationalRouteKey;
  method: string;
  actorKind: OperationalActorKind;
  statusCode: number;
  errorCode?: string;
  durationMs: number;
}

export interface OperationalTelemetrySummary {
  window: OperationalTelemetryWindow;
  windowStart: string;
  generatedAt: string;
  retentionDays: number;
  privacyClassification: "operational_aggregate";
  containsRequestBodies: false;
  containsRawUrls: false;
  containsProductIdentifiers: false;
  totals: {
    requests: number;
    successes: number;
    redirects: number;
    clientErrors: number;
    serverErrors: number;
    errorRatePercent: number;
    averageDurationMs: number;
    maximumDurationMs: number;
    latencyP95Bucket: OperationalLatencyBucket | "no_data";
  };
  routes: Array<{
    routeKey: OperationalRouteKey;
    requests: number;
    errors: number;
    errorRatePercent: number;
    averageDurationMs: number;
    maximumDurationMs: number;
    lastSeenAt: string;
  }>;
  errorCodes: Array<{ errorCode: string; occurrences: number; lastSeenAt: string }>;
  recentErrors: Array<{
    id: string;
    correlationKey: string;
    routeKey: OperationalRouteKey;
    method: string;
    actorKind: OperationalActorKind;
    statusCode: number;
    errorCode: string;
    durationMs: number;
    privacyClassification: "operational_aggregate";
    occurredAt: string;
  }>;
}

const ROUTE_KEY_SET = new Set<string>(OPERATIONAL_ROUTE_KEYS);
const METHOD_SET = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const DAY_MS = 24 * 60 * 60_000;

function statusClass(statusCode: number): OperationalStatusClass {
  if (statusCode < 300) return "success";
  if (statusCode < 400) return "redirect";
  if (statusCode < 500) return "client_error";
  return "server_error";
}

function latencyBucket(durationMs: number): OperationalLatencyBucket {
  if (durationMs < 100) return "lt_100";
  if (durationMs < 500) return "lt_500";
  if (durationMs < 2_000) return "lt_2000";
  return "gte_2000";
}

function safeErrorCode(value: unknown, statusCode: number): string {
  if (statusCode < 400) return "";
  const code = cleanText(value, 80).toLocaleLowerCase("en-US");
  return /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : `http_${statusCode}`;
}

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function p95Bucket(rows: Array<{ latencyBucket: OperationalLatencyBucket; requests: number }>, total: number): OperationalLatencyBucket | "no_data" {
  if (!total) return "no_data";
  const counts = new Map<OperationalLatencyBucket, number>();
  for (const row of rows) counts.set(row.latencyBucket, (counts.get(row.latencyBucket) ?? 0) + row.requests);
  const target = Math.ceil(total * 0.95);
  let cumulative = 0;
  for (const bucket of ["lt_100", "lt_500", "lt_2000", "gte_2000"] as const) {
    cumulative += counts.get(bucket) ?? 0;
    if (cumulative >= target) return bucket;
  }
  return "gte_2000";
}

export class OperationalTelemetryRepository {
  private readonly retentionDays: number;
  private readonly nextPruneAt = new Map<string, number>();

  constructor(private readonly db: YoinkDatabase, options: { retentionDays?: number } = {}) {
    const requested = Number(options.retentionDays ?? OPERATIONAL_TELEMETRY_RETENTION_DAYS);
    if (!Number.isInteger(requested) || requested < 1 || requested > 90) {
      throw new Error("Operational telemetry retention must be from 1 through 90 days.");
    }
    this.retentionDays = requested;
  }

  record(input: OperationalTelemetryRecordInput, now = Date.now()): void {
    const scope = currentRequestScope();
    if (!ROUTE_KEY_SET.has(input.routeKey)) throw new Error("The operational telemetry route key is not allowlisted.");
    const method = cleanText(input.method, 12).toLocaleUpperCase("en-US");
    if (!METHOD_SET.has(method)) throw new Error("The operational telemetry method is invalid.");
    const statusCode = Number(input.statusCode);
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      throw new Error("The operational telemetry status code is invalid.");
    }
    if (!["maintainer", "user", "device", "service"].includes(input.actorKind)) {
      throw new Error("The operational telemetry actor kind is invalid.");
    }
    const durationMs = Math.min(3_600_000, Math.max(0, Math.round(Number(input.durationMs) || 0)));
    const bucketStart = nowIso(Math.floor(now / 60_000) * 60_000);
    const createdAt = nowIso(now);
    const outcome = statusClass(statusCode);
    const latency = latencyBucket(durationMs);
    const errorCode = safeErrorCode(input.errorCode, statusCode);
    const correlationKey = `opcorr_${stableHash(
      "yoink_operational_correlation_v1",
      scope.tenantId,
      cleanText(input.correlationId, 160) || "unavailable"
    ).slice(0, 48)}`;

    this.pruneIfDue(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO operational_request_rollups(
           tenant_id, bucket_start, route_key, method, actor_kind,
           status_class, latency_bucket, request_count, total_duration_ms,
           max_duration_ms, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(
           tenant_id, bucket_start, route_key, method, actor_kind,
           status_class, latency_bucket
         ) DO UPDATE SET
           request_count = operational_request_rollups.request_count + 1,
           total_duration_ms = operational_request_rollups.total_duration_ms + excluded.total_duration_ms,
           max_duration_ms = MAX(operational_request_rollups.max_duration_ms, excluded.max_duration_ms),
           updated_at = excluded.updated_at`,
        scope.tenantId,
        bucketStart,
        input.routeKey,
        method,
        input.actorKind,
        outcome,
        latency,
        durationMs,
        durationMs,
        createdAt,
        createdAt
      );
      if (statusCode >= 400) {
        this.db.run(
          `INSERT INTO operational_error_events(
             id, tenant_id, correlation_key, route_key, method, actor_kind,
             status_code, error_code, duration_ms, privacy_classification,
             occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'operational_aggregate', ?)`,
          newId("operational_error"),
          scope.tenantId,
          correlationKey,
          input.routeKey,
          method,
          input.actorKind,
          statusCode,
          errorCode,
          durationMs,
          createdAt
        );
      }
    });
  }

  pruneExpired(now = Date.now()): { deletedRollupRows: number; deletedErrorEvents: number; cutoffAt: string; receiptId: string } {
    const scope = currentRequestScope();
    const cutoffAt = nowIso(now - this.retentionDays * DAY_MS);
    let deletedRollupRows = 0;
    let deletedErrorEvents = 0;
    let receiptId = "";
    this.db.transaction(() => {
      deletedRollupRows = Number(this.db.run(
        "DELETE FROM operational_request_rollups WHERE tenant_id = ? AND bucket_start < ?",
        scope.tenantId,
        cutoffAt
      ).changes);
      deletedErrorEvents = Number(this.db.run(
        "DELETE FROM operational_error_events WHERE tenant_id = ? AND occurred_at < ?",
        scope.tenantId,
        cutoffAt
      ).changes);
      if (deletedRollupRows || deletedErrorEvents) {
        receiptId = newId("telemetry_retention");
        this.db.run(
          `INSERT INTO operational_telemetry_retention_receipts(
             id, tenant_id, cutoff_at, deleted_rollup_rows,
             deleted_error_events, privacy_classification, created_at
           ) VALUES (?, ?, ?, ?, ?, 'operational_aggregate', ?)`,
          receiptId,
          scope.tenantId,
          cutoffAt,
          deletedRollupRows,
          deletedErrorEvents,
          nowIso(now)
        );
      }
    });
    this.nextPruneAt.set(scope.tenantId, now + 6 * 60 * 60_000);
    return { deletedRollupRows, deletedErrorEvents, cutoffAt, receiptId };
  }

  summary(window: OperationalTelemetryWindow = "24h", now = Date.now()): OperationalTelemetrySummary {
    if (!(window in OPERATIONAL_TELEMETRY_WINDOWS)) throw new Error("The operational telemetry window is invalid.");
    const scope = currentRequestScope();
    const windowStart = nowIso(now - OPERATIONAL_TELEMETRY_WINDOWS[window]);
    const rows = this.db.all<{
      routeKey: OperationalRouteKey;
      statusClass: OperationalStatusClass;
      latencyBucket: OperationalLatencyBucket;
      requests: number;
      totalDurationMs: number;
      maximumDurationMs: number;
      lastSeenAt: string;
    }>(
      `SELECT route_key AS routeKey, status_class AS statusClass,
              latency_bucket AS latencyBucket, SUM(request_count) AS requests,
              SUM(total_duration_ms) AS totalDurationMs,
              MAX(max_duration_ms) AS maximumDurationMs,
              MAX(updated_at) AS lastSeenAt
       FROM operational_request_rollups
       WHERE tenant_id = ? AND bucket_start >= ?
       GROUP BY route_key, status_class, latency_bucket
       ORDER BY route_key, status_class, latency_bucket`,
      scope.tenantId,
      windowStart
    ).map((row) => ({
      ...row,
      requests: Number(row.requests),
      totalDurationMs: Number(row.totalDurationMs),
      maximumDurationMs: Number(row.maximumDurationMs)
    }));
    const requests = rows.reduce((sum, row) => sum + row.requests, 0);
    const successes = rows.filter((row) => row.statusClass === "success").reduce((sum, row) => sum + row.requests, 0);
    const redirects = rows.filter((row) => row.statusClass === "redirect").reduce((sum, row) => sum + row.requests, 0);
    const clientErrors = rows.filter((row) => row.statusClass === "client_error").reduce((sum, row) => sum + row.requests, 0);
    const serverErrors = rows.filter((row) => row.statusClass === "server_error").reduce((sum, row) => sum + row.requests, 0);
    const totalDurationMs = rows.reduce((sum, row) => sum + row.totalDurationMs, 0);
    const maximumDurationMs = rows.reduce((maximum, row) => Math.max(maximum, row.maximumDurationMs), 0);
    const routes = new Map<OperationalRouteKey, {
      routeKey: OperationalRouteKey;
      requests: number;
      errors: number;
      totalDurationMs: number;
      maximumDurationMs: number;
      lastSeenAt: string;
    }>();
    for (const row of rows) {
      const current = routes.get(row.routeKey) ?? {
        routeKey: row.routeKey,
        requests: 0,
        errors: 0,
        totalDurationMs: 0,
        maximumDurationMs: 0,
        lastSeenAt: ""
      };
      current.requests += row.requests;
      if (row.statusClass === "client_error" || row.statusClass === "server_error") current.errors += row.requests;
      current.totalDurationMs += row.totalDurationMs;
      current.maximumDurationMs = Math.max(current.maximumDurationMs, row.maximumDurationMs);
      if (row.lastSeenAt > current.lastSeenAt) current.lastSeenAt = row.lastSeenAt;
      routes.set(row.routeKey, current);
    }
    const errorCodes = this.db.all<{ errorCode: string; occurrences: number; lastSeenAt: string }>(
      `SELECT error_code AS errorCode, COUNT(*) AS occurrences, MAX(occurred_at) AS lastSeenAt
       FROM operational_error_events
       WHERE tenant_id = ? AND occurred_at >= ?
       GROUP BY error_code
       ORDER BY occurrences DESC, lastSeenAt DESC, errorCode
       LIMIT 20`,
      scope.tenantId,
      windowStart
    ).map((row) => ({ ...row, occurrences: Number(row.occurrences) }));
    const recentErrors = this.db.all<OperationalTelemetrySummary["recentErrors"][number]>(
      `SELECT id, correlation_key AS correlationKey, route_key AS routeKey,
              method, actor_kind AS actorKind, status_code AS statusCode,
              error_code AS errorCode, duration_ms AS durationMs,
              privacy_classification AS privacyClassification,
              occurred_at AS occurredAt
       FROM operational_error_events
       WHERE tenant_id = ? AND occurred_at >= ?
       ORDER BY occurred_at DESC, id DESC LIMIT 50`,
      scope.tenantId,
      windowStart
    ).map((row) => ({
      ...row,
      statusCode: Number(row.statusCode),
      durationMs: Number(row.durationMs)
    }));

    return {
      window,
      windowStart,
      generatedAt: nowIso(now),
      retentionDays: this.retentionDays,
      privacyClassification: "operational_aggregate",
      containsRequestBodies: false,
      containsRawUrls: false,
      containsProductIdentifiers: false,
      totals: {
        requests,
        successes,
        redirects,
        clientErrors,
        serverErrors,
        errorRatePercent: percent(clientErrors + serverErrors, requests),
        averageDurationMs: requests ? Math.round(totalDurationMs / requests) : 0,
        maximumDurationMs,
        latencyP95Bucket: p95Bucket(rows.map((row) => ({ latencyBucket: row.latencyBucket, requests: row.requests })), requests)
      },
      routes: [...routes.values()]
        .map((route) => ({
          routeKey: route.routeKey,
          requests: route.requests,
          errors: route.errors,
          errorRatePercent: percent(route.errors, route.requests),
          averageDurationMs: route.requests ? Math.round(route.totalDurationMs / route.requests) : 0,
          maximumDurationMs: route.maximumDurationMs,
          lastSeenAt: route.lastSeenAt
        }))
        .sort((left, right) => right.errors - left.errors || right.requests - left.requests || left.routeKey.localeCompare(right.routeKey))
        .slice(0, 50),
      errorCodes,
      recentErrors
    };
  }

  counts(): { operationalRollupRows: number; operationalErrorEvents: number; operationalRetentionReceipts: number } {
    const tenantId = currentRequestScope().tenantId;
    return {
      operationalRollupRows: Number(this.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM operational_request_rollups WHERE tenant_id = ?",
        tenantId
      )?.count ?? 0),
      operationalErrorEvents: Number(this.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM operational_error_events WHERE tenant_id = ?",
        tenantId
      )?.count ?? 0),
      operationalRetentionReceipts: Number(this.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM operational_telemetry_retention_receipts WHERE tenant_id = ?",
        tenantId
      )?.count ?? 0)
    };
  }

  private pruneIfDue(now: number): void {
    const tenantId = currentRequestScope().tenantId;
    if ((this.nextPruneAt.get(tenantId) ?? 0) > now) return;
    this.pruneExpired(now);
  }
}
