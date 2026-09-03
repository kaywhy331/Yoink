import {
  deriveWalmartPurchaseHandoff,
  type WalmartHowlAttribution,
  type WalmartPurchaseHandoff
} from "../../domain/src/walmart-purchase-handoff.js";
import { nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { type YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const ROUTE_KINDS = new Set(["howl", "direct"] as const);

export type WalmartPurchaseHandoffRouteKind = "howl" | "direct";
export type WalmartPurchaseHandoffSurface = "calls" | "home";

interface WalmartHandoffCandidate {
  jobId: string;
  createdAt: string;
  title: string;
  retailer_id: string;
  retailer_sku: string;
  canonical_url: string;
  action: string;
  state: string;
  expires_at: string;
  max_unit_price_cents: number | null;
  seller_policy: string;
  fulfillment: string;
  attribution_provider: string;
  attribution_metadata_json: string;
  snapshot_availability: string | null;
  snapshot_unit_price_cents: number | null;
  snapshot_currency: string | null;
  snapshot_seller_name: string | null;
  snapshot_seller_type: string | null;
  snapshot_fulfillment: string | null;
  snapshot_observed_at: string | null;
  snapshot_expires_at: string | null;
  source_trust_level: string | null;
  qualification_reason: string | null;
}

export interface WalmartPurchaseHandoffClickReceipt {
  jobId: string;
  walmartItemId: string;
  routeKind: WalmartPurchaseHandoffRouteKind;
  trackingId: string;
  surface: WalmartPurchaseHandoffSurface;
  recorded: boolean;
  duplicate: boolean;
  recordedAt: string;
}

export interface CurrentWalmartPurchaseHandoff {
  jobId: string;
  createdAt: string;
  title: string;
  retailerId: "walmart";
  retailerSku: string;
  canonicalUrl: string;
  purchaseHandoff: WalmartPurchaseHandoff;
}

function parsedHowlAttribution(candidate: WalmartHandoffCandidate): WalmartHowlAttribution | null {
  if (candidate.attribution_provider !== "howl") return null;
  try {
    const metadata = JSON.parse(candidate.attribution_metadata_json) as Record<string, unknown>;
    return {
      publisherSlug: metadata.publisherSlug,
      articleName: candidate.title,
      articleUrl: metadata.articleUrl
    };
  } catch {
    return null;
  }
}

function earliestExpiry(candidate: WalmartHandoffCandidate): string {
  const expiries = [candidate.expires_at, candidate.snapshot_expires_at]
    .map((value) => new Date(String(value ?? "")).getTime())
    .filter(Number.isFinite);
  return expiries.length ? new Date(Math.min(...expiries)).toISOString() : "";
}

function deriveCandidateHandoff(candidate: WalmartHandoffCandidate | undefined, now: number): WalmartPurchaseHandoff | null {
  if (!candidate?.snapshot_observed_at || !candidate.snapshot_expires_at) return null;
  return deriveWalmartPurchaseHandoff({
    retailerId: candidate.retailer_id,
    retailerSku: candidate.retailer_sku,
    canonicalUrl: candidate.canonical_url,
    availability: candidate.snapshot_availability,
    observedAt: candidate.snapshot_observed_at,
    unitPriceCents: candidate.snapshot_unit_price_cents,
    currency: candidate.snapshot_currency,
    sellerName: candidate.snapshot_seller_name,
    sellerType: candidate.snapshot_seller_type,
    fulfillment: candidate.snapshot_fulfillment,
    sourceTrustLevel: candidate.source_trust_level,
    missionDecision: ["purchase_intent_qualified", "strategy_qualified"].includes(
      candidate.qualification_reason ?? ""
    ) ? "qualified" : "blocked",
    effectiveUnitCapCents: candidate.max_unit_price_cents,
    actionJobAction: candidate.action,
    actionJobState: candidate.state,
    actionJobExpiresAt: earliestExpiry(candidate),
    actionJobMaxUnitPriceCents: candidate.max_unit_price_cents,
    actionJobSellerPolicy: candidate.seller_policy,
    actionJobFulfillment: candidate.fulfillment
  }, now, parsedHowlAttribution(candidate));
}

function parsedClickReceipt(
  row: { data_json: string; created_at: string } | undefined,
  jobId: string
): WalmartPurchaseHandoffClickReceipt | null {
  if (!row) return null;
  try {
    const data = JSON.parse(row.data_json) as Record<string, unknown>;
    const walmartItemId = cleanText(data.walmartItemId, 32);
    const routeKind = cleanText(data.routeKind, 20) as WalmartPurchaseHandoffRouteKind;
    const surface = cleanText(data.surface, 20) as WalmartPurchaseHandoffSurface;
    const trackingId = cleanText(data.trackingId, 80);
    if (!/^\d{5,20}$/.test(walmartItemId)
      || !ROUTE_KINDS.has(routeKind)
      || !["calls", "home"].includes(surface)
      || trackingId !== `walmart_${walmartItemId}`) return null;
    return {
      jobId,
      walmartItemId,
      routeKind,
      trackingId,
      surface,
      recorded: false,
      duplicate: true,
      recordedAt: row.created_at
    };
  } catch {
    return null;
  }
}

export class WalmartPurchaseHandoffInteractionRepository {
  constructor(private readonly db: YoinkDatabase) {}

  private closeNotificationDelivery(jobId: string, timestamp: string): void {
    this.db.run(
      `UPDATE notification_deliveries
       SET state = 'clicked', capability_hash = '', lease_expires_at = '',
           interaction_at = ?, updated_at = ?
       WHERE tenant_id = ? AND user_id = ? AND job_id = ?
         AND state IN ('pending', 'leased', 'delivered')`,
      timestamp,
      timestamp,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      jobId
    );
  }

  current(jobId: string, now = Date.now()): WalmartPurchaseHandoff | null {
    const normalizedJobId = cleanText(jobId, 120);
    if (!JOB_ID_PATTERN.test(normalizedJobId)) return null;
    const candidate = this.db.get<WalmartHandoffCandidate>(
      `SELECT aj.id AS jobId, aj.created_at AS createdAt,
              v.title, l.retailer_id, l.retailer_sku,
              aj.canonical_url, aj.action, aj.state, aj.expires_at,
              aj.max_unit_price_cents, aj.seller_policy, aj.fulfillment,
              aj.attribution_provider, aj.attribution_metadata_json,
              os.availability AS snapshot_availability,
              os.unit_price_cents AS snapshot_unit_price_cents,
              os.currency AS snapshot_currency,
              os.seller_name AS snapshot_seller_name,
              os.seller_type AS snapshot_seller_type,
              os.fulfillment AS snapshot_fulfillment,
              os.observed_at AS snapshot_observed_at,
              os.expires_at AS snapshot_expires_at,
              sc.trust_level AS source_trust_level,
              (SELECT ae.reason_code FROM action_events ae
               WHERE ae.job_id = aj.id ORDER BY ae.created_at, ae.id LIMIT 1) AS qualification_reason
       FROM action_jobs aj
       JOIN listings l ON l.id = aj.listing_id
       JOIN variants v ON v.id = l.variant_id
       LEFT JOIN offer_snapshots os ON os.id = aj.offer_snapshot_id
       LEFT JOIN offer_observations oo ON oo.id = os.source_observation_id
       LEFT JOIN source_connections sc ON sc.id = oo.source_connection_id
       WHERE aj.id = ? AND aj.tenant_id = ? AND aj.user_id = ? AND aj.action = 'notify'
         AND NOT EXISTS (
           SELECT 1 FROM audit_events clicked
           WHERE clicked.tenant_id = aj.tenant_id AND clicked.user_id = aj.user_id
             AND clicked.correlation_id = aj.id
             AND clicked.event_type = 'walmart_purchase_handoff_clicked'
         )`,
      normalizedJobId,
      currentRequestScope().tenantId,
      currentRequestScope().userId
    );
    return deriveCandidateHandoff(candidate, now);
  }

  latest(now = Date.now()): CurrentWalmartPurchaseHandoff | null {
    const scope = currentRequestScope();
    const lowerBound = nowIso(now - 120_000);
    const upperBound = nowIso(now + 30_000);
    const candidates = this.db.all<WalmartHandoffCandidate>(
      `SELECT aj.id AS jobId, aj.created_at AS createdAt,
              v.title, l.retailer_id, l.retailer_sku,
              aj.canonical_url, aj.action, aj.state, aj.expires_at,
              aj.max_unit_price_cents, aj.seller_policy, aj.fulfillment,
              aj.attribution_provider, aj.attribution_metadata_json,
              os.availability AS snapshot_availability,
              os.unit_price_cents AS snapshot_unit_price_cents,
              os.currency AS snapshot_currency,
              os.seller_name AS snapshot_seller_name,
              os.seller_type AS snapshot_seller_type,
              os.fulfillment AS snapshot_fulfillment,
              os.observed_at AS snapshot_observed_at,
              os.expires_at AS snapshot_expires_at,
              sc.trust_level AS source_trust_level,
              (SELECT ae.reason_code FROM action_events ae
               WHERE ae.job_id = aj.id ORDER BY ae.created_at, ae.id LIMIT 1) AS qualification_reason
       FROM action_jobs aj
       JOIN listings l ON l.id = aj.listing_id
       JOIN variants v ON v.id = l.variant_id
       LEFT JOIN offer_snapshots os ON os.id = aj.offer_snapshot_id
       LEFT JOIN offer_observations oo ON oo.id = os.source_observation_id
       LEFT JOIN source_connections sc ON sc.id = oo.source_connection_id
       WHERE aj.tenant_id = ? AND aj.user_id = ?
         AND aj.action = 'notify' AND aj.state = 'notify_only'
         AND l.retailer_id = 'walmart'
         AND os.observed_at >= ? AND os.observed_at <= ?
         AND os.expires_at > ? AND aj.expires_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM audit_events clicked
           WHERE clicked.tenant_id = aj.tenant_id AND clicked.user_id = aj.user_id
             AND clicked.correlation_id = aj.id
             AND clicked.event_type = 'walmart_purchase_handoff_clicked'
         )
       ORDER BY aj.created_at DESC, aj.id DESC
       LIMIT 25`,
      scope.tenantId,
      scope.userId,
      lowerBound,
      upperBound,
      nowIso(now),
      nowIso(now)
    );
    for (const candidate of candidates) {
      const purchaseHandoff = deriveCandidateHandoff(candidate, now);
      if (!purchaseHandoff) continue;
      return {
        jobId: candidate.jobId,
        createdAt: candidate.createdAt,
        title: candidate.title,
        retailerId: "walmart",
        retailerSku: candidate.retailer_sku,
        canonicalUrl: candidate.canonical_url,
        purchaseHandoff
      };
    }
    return null;
  }

  recordClick(
    jobId: string,
    routeKind: WalmartPurchaseHandoffRouteKind,
    now = Date.now(),
    surface: WalmartPurchaseHandoffSurface = "calls"
  ): WalmartPurchaseHandoffClickReceipt {
    const normalizedJobId = cleanText(jobId, 120);
    if (!JOB_ID_PATTERN.test(normalizedJobId)
      || !ROUTE_KINDS.has(routeKind)
      || !["calls", "home"].includes(surface)) {
      throw new Error("The Walmart purchase handoff click is invalid.");
    }
    const scope = currentRequestScope();
    const previous = parsedClickReceipt(this.db.get<{ data_json: string; created_at: string }>(
      `SELECT data_json, created_at FROM audit_events
       WHERE tenant_id = ? AND user_id = ? AND correlation_id = ?
         AND event_type = 'walmart_purchase_handoff_clicked'
       ORDER BY created_at, id LIMIT 1`,
      scope.tenantId,
      scope.userId,
      normalizedJobId
    ), normalizedJobId);
    if (previous) {
      this.closeNotificationDelivery(normalizedJobId, previous.recordedAt);
      return previous;
    }
    const handoff = this.current(normalizedJobId, now);
    if (!handoff) {
      throw new Error("The Walmart purchase handoff is no longer current. Open the store page instead.");
    }
    const reasonCode = routeKind === "howl" ? "howl_route_opened" : "direct_route_opened";
    const fingerprint = stableHash(
      "walmart-purchase-handoff-click-v2",
      scope.tenantId,
      scope.userId,
      normalizedJobId
    );
    const auditId = `audit_${fingerprint.slice(0, 32)}`;
    const outboxId = `outbox_${stableHash("walmart-purchase-handoff-click-outbox-v2", fingerprint).slice(0, 32)}`;
    const recordedAt = nowIso(now);
    const data = {
      retailerId: "walmart",
      walmartItemId: handoff.walmartItemId,
      routeKind,
      trackingId: handoff.trackingId,
      surface
    } as const;
    const receipt = this.db.transaction(() => {
      const existing = parsedClickReceipt(this.db.get<{ data_json: string; created_at: string }>(
        `SELECT data_json, created_at FROM audit_events
         WHERE tenant_id = ? AND user_id = ? AND correlation_id = ?
           AND event_type = 'walmart_purchase_handoff_clicked'
         ORDER BY created_at, id LIMIT 1`,
        scope.tenantId,
        scope.userId,
        normalizedJobId
      ), normalizedJobId);
      if (existing) return existing;
      const inserted = this.db.run(
        `INSERT OR IGNORE INTO audit_events(
           id, tenant_id, user_id, correlation_id, event_type,
           reason_code, message, data_json, created_at
         ) VALUES (?, ?, ?, ?, 'walmart_purchase_handoff_clicked', ?, ?, ?, ?)`,
        auditId,
        scope.tenantId,
        scope.userId,
        normalizedJobId,
        reasonCode,
        `A user opened a validated Walmart purchase handoff from ${surface === "home" ? "Home" : "Calls"}.`,
        JSON.stringify(data),
        recordedAt
      );
      if (Number(inserted.changes) !== 1) {
        throw new Error("The Walmart purchase handoff could not be recorded safely.");
      }
      this.closeNotificationDelivery(normalizedJobId, recordedAt);
      this.db.run(
        `INSERT INTO outbox_events(
           id, tenant_id, aggregate_type, aggregate_id, event_type,
           payload_json, created_at, delivered_at
         ) VALUES (?, ?, 'walmart_purchase_handoff', ?,
           'walmart_purchase_handoff_clicked', ?, ?, '')`,
        outboxId,
        scope.tenantId,
        normalizedJobId,
        JSON.stringify({
          auditId,
          correlationId: normalizedJobId,
          reasonCode,
          message: `A user opened a validated Walmart purchase handoff from ${surface === "home" ? "Home" : "Calls"}.`,
          data
        }),
        recordedAt
      );
      return {
        jobId: normalizedJobId,
        walmartItemId: handoff.walmartItemId,
        routeKind,
        trackingId: handoff.trackingId,
        surface,
        recorded: true,
        duplicate: false,
        recordedAt
      } satisfies WalmartPurchaseHandoffClickReceipt;
    });
    return receipt;
  }
}
