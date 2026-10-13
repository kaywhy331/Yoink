import { randomBytes } from "node:crypto";
import { cleanText } from "../../domain/src/normalize.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import {
  deriveWalmartPurchaseHandoff,
  type WalmartHowlAttribution,
  type WalmartPurchaseHandoff
} from "../../domain/src/walmart-purchase-handoff.js";
import type { PlanClosedDeliveryFailureCode } from "../../domain/src/delivery-health.js";
import { type YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

/**
 * Expire a plan's (or some of its listings') undelivered Chrome calls because
 * the shopper's plan change closed them. The lease never hands these out (it
 * requires an active plan and an enabled listing), so without this they sat
 * pending until the job window and were then blamed on the device. Notify
 * jobs are terminal (`notify_only`), so cancelling jobs never reaches them.
 */
export function expirePlanNotificationDeliveries(
  db: YoinkDatabase,
  userId: string,
  target: { missionId: string; missionTargetIds?: readonly string[] },
  failureCode: PlanClosedDeliveryFailureCode,
  now: number
): number {
  const targetIds = target.missionTargetIds ? [...new Set(target.missionTargetIds)] : null;
  if (targetIds && targetIds.length === 0) return 0;
  let expired = 0;
  // Chunked so a plan with thousands of listings stays under the bound-parameter limit.
  const chunks = targetIds ? Array.from({ length: Math.ceil(targetIds.length / 500) }, (_, index) => targetIds.slice(index * 500, index * 500 + 500)) : [null];
  for (const chunk of chunks) {
    expired += Number(db.run(
      `UPDATE notification_deliveries SET state = 'expired', assigned_device_id = NULL,
         capability_hash = '', lease_expires_at = '', failure_code = ?, updated_at = ?
       WHERE user_id = ? AND state IN ('pending', 'leased')
         AND job_id IN (SELECT id FROM action_jobs WHERE mission_id = ? AND user_id = ?${chunk ? ` AND mission_target_id IN (${chunk.map(() => "?").join(",")})` : ""})`,
      failureCode,
      nowIso(now),
      userId,
      target.missionId,
      userId,
      ...(chunk ?? [])
    ).changes ?? 0);
  }
  return expired;
}

const DELIVERY_LEASE_MS = 60_000;
export const NOTIFICATION_DELIVERY_MAX_ATTEMPTS = 3;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9_-]{3,160}$/;
const SAFE_RETAILERS = new Set([
  "target", "walmart", "amazon", "bestbuy", "disney", "ravensburger", "riot",
  "booksamillion", "fanatics", "kohls", "macys", "pbandai", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"
]);

export interface NotificationLease {
  id: string;
  capabilityToken: string;
  title: string;
  message: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  attributionUrl: string;
  unitPriceCents: number | null;
  currency: string;
  action: string;
  expiresAt: string;
  leaseExpiresAt: string;
  purchaseHandoff: WalmartPurchaseHandoff | null;
  /**
   * Whether Chrome shows it as a desktop alert. Only a test alert does (Kevin,
   * 2026-10-13: a call that doesn't meet a plan "should still log it and display
   * the information on the dashboard, however windows notification is not
   * needed"); Chrome takes a call in quietly for its popup and Yoink's call log.
   */
  alert: boolean;
}

export type NotificationLeaseResult =
  | { notification: NotificationLease; reason: "leased"; closedDeliveryIds: string[] }
  | {
      notification: null;
      reason: "no_notifications" | "device_unavailable";
      closedDeliveryIds: string[];
    };

interface DeliveryCandidate {
  id: string;
  title: string;
  retailer_id: string;
  retailer_sku: string;
  canonical_url: string;
  attribution_url: string;
  action: string;
  state: string;
  unit_price_cents: number | null;
  currency: string;
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
  incident_closed_reason: string | null;
  qualification_reason: string | null;
}

function capabilityHash(token: string): string {
  return stableHash("yoink-notification-capability-v1", token);
}

function notificationMessage(candidate: DeliveryCandidate): string {
  const names: Record<string, string> = {
    bestbuy: "Best Buy",
    disney: "Disney Store",
    ravensburger: "Ravensburger",
    riot: "Riot Games Merch",
    booksamillion: "Books-A-Million",
    fanatics: "Fanatics",
    kohls: "Kohl's",
    macys: "Macy's",
    pbandai: "Premium Bandai",
    pokemoncenter: "Pokémon Center",
    asus: "ASUS",
    audioadvice: "Audio Advice",
    bananarepublic: "Banana Republic",
    bananarepublicfactory: "Banana Republic Factory",
    athleta: "Athleta",
    americaneagle: "American Eagle",
    aninebing: "ANINE BING"
  };
  const retailer = names[candidate.retailer_id]
    || `${candidate.retailer_id.slice(0, 1).toUpperCase()}${candidate.retailer_id.slice(1)}`;
  const price = Number.isSafeInteger(candidate.unit_price_cents) && Number(candidate.unit_price_cents) > 0
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: candidate.currency }).format(Number(candidate.unit_price_cents) / 100)
    : "price unavailable";
  return `${retailer} · ${price} · ${candidate.action.replaceAll("_", " ")}`.slice(0, 240);
}

function parsedHowlAttribution(candidate: DeliveryCandidate): WalmartHowlAttribution | null {
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

function earliestExpiry(candidate: DeliveryCandidate): string {
  const expiries = [candidate.expires_at, candidate.snapshot_expires_at]
    .map((value) => new Date(String(value ?? "")).getTime())
    .filter(Number.isFinite);
  return expiries.length ? new Date(Math.min(...expiries)).toISOString() : "";
}

function walmartPurchaseHandoff(candidate: DeliveryCandidate, now: number): WalmartPurchaseHandoff | null {
  if (!candidate.snapshot_observed_at || !candidate.snapshot_expires_at) return null;
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
    missionDecision: ["purchase_intent_qualified", "strategy_qualified"].includes(candidate.qualification_reason ?? "")
      ? "qualified"
      : "blocked",
    effectiveUnitCapCents: candidate.max_unit_price_cents,
    actionJobAction: candidate.action,
    actionJobState: candidate.state,
    actionJobExpiresAt: earliestExpiry(candidate),
    actionJobMaxUnitPriceCents: candidate.max_unit_price_cents,
    actionJobSellerPolicy: candidate.seller_policy,
    actionJobFulfillment: candidate.fulfillment
  }, now, parsedHowlAttribution(candidate));
}

export class NotificationRepository {
  constructor(private readonly db: YoinkDatabase) {}

  ensureForJob(jobId: string, now = Date.now()): void {
    const job = this.db.get<{ tenant_id: string; user_id: string; action: string }>(
      "SELECT tenant_id, user_id, action FROM action_jobs WHERE id = ? AND user_id = ?",
      cleanText(jobId, 160),
      currentRequestScope().userId
    );
    if (!job || job.action !== "notify") return;
    const timestamp = nowIso(now);
    this.db.run(
      `INSERT OR IGNORE INTO notification_deliveries(
         id, tenant_id, user_id, job_id, state, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      newId("notification"),
      job.tenant_id || currentRequestScope().tenantId,
      job.user_id || currentRequestScope().userId,
      jobId,
      timestamp,
      timestamp
    );
  }

  leaseNext(deviceId: string, now = Date.now()): NotificationLeaseResult {
    const normalizedDeviceId = cleanText(deviceId, 120);
    return this.db.transaction(() => {
      const device = this.db.get<{ capabilities_json: string }>(
        "SELECT capabilities_json FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'",
        normalizedDeviceId,
        currentRequestScope().userId
      );
      if (!device) return { notification: null, reason: "device_unavailable", closedDeliveryIds: [] };
      const timestamp = nowIso(now);
      // The poll receipt is stamped here, not by the route, so every caller of
      // leaseNext records it (delivery health and the `no_device_poll` expiry
      // code read it). Mirrored in the Postgres writer.
      this.db.run(
        "UPDATE extension_devices SET last_notification_poll_at = ? WHERE id = ? AND user_id = ? AND status = 'active'",
        timestamp,
        normalizedDeviceId,
        currentRequestScope().userId
      );
      let capabilities: Record<string, unknown> = {};
      try { capabilities = JSON.parse(device.capabilities_json) as Record<string, unknown>; } catch { capabilities = {}; }
      if (capabilities.notifications !== true) {
        return { notification: null, reason: "device_unavailable", closedDeliveryIds: [] };
      }

      this.recoverExpired(now);
      const closedDeliveryIds = this.db.all<{ id: string }>(
        `SELECT id FROM notification_deliveries
         WHERE tenant_id = ? AND user_id = ? AND assigned_device_id = ?
           AND state IN ('clicked', 'dismissed') AND interaction_at <> ''
         ORDER BY interaction_at DESC, id DESC LIMIT 100`,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        normalizedDeviceId
      ).map((row) => row.id);

      // A paused, archived or deleted plan, or a disabled target, never
      // produces a call; updateMission also expires those rows on pause.
      // Unsupported-retailer rows are failed and skipped (bounded) so they do
      // not hide a deliverable call queued behind them.
      let candidate: DeliveryCandidate | undefined;
      for (let skipped = 0; skipped < 20; skipped += 1) {
        candidate = this.db.get<DeliveryCandidate>(
          `SELECT nd.id, v.title, l.retailer_id, l.retailer_sku,
                  aj.canonical_url, aj.attribution_url, aj.action, aj.state,
                  si.unit_price_cents, aj.currency, aj.expires_at,
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
                  si.closed_reason AS incident_closed_reason,
                  (SELECT ae.reason_code FROM action_events ae
                   WHERE ae.job_id = aj.id ORDER BY ae.created_at, ae.id LIMIT 1) AS qualification_reason
           FROM notification_deliveries nd
           JOIN action_jobs aj ON aj.id = nd.job_id
           JOIN missions m ON m.id = aj.mission_id AND m.status = 'active'
           JOIN mission_targets mt ON mt.id = aj.mission_target_id AND mt.enabled = 1
           JOIN listings l ON l.id = aj.listing_id
           JOIN variants v ON v.id = l.variant_id
           LEFT JOIN signal_incidents si ON si.id = aj.incident_id
           LEFT JOIN offer_snapshots os ON os.id = aj.offer_snapshot_id
           LEFT JOIN offer_observations oo ON oo.id = os.source_observation_id
           LEFT JOIN source_connections sc ON sc.id = oo.source_connection_id
           WHERE nd.user_id = ? AND nd.state = 'pending' AND aj.expires_at > ?
           ORDER BY nd.created_at, nd.id LIMIT 1`,
          currentRequestScope().userId,
          timestamp
        );
        if (!candidate || SAFE_RETAILERS.has(candidate.retailer_id)) break;
        this.db.run(
          "UPDATE notification_deliveries SET state = 'failed', failure_code = 'unsupported_retailer', updated_at = ? WHERE id = ?",
          timestamp,
          candidate.id
        );
        candidate = undefined;
      }
      if (!candidate) return { notification: null, reason: "no_notifications", closedDeliveryIds };

      const capabilityToken = randomBytes(32).toString("base64url");
      const leaseExpiresAt = nowIso(now + DELIVERY_LEASE_MS);
      const updated = this.db.run(
        `UPDATE notification_deliveries SET state = 'leased', assigned_device_id = ?,
           attempts = attempts + 1, capability_hash = ?, lease_expires_at = ?,
           failure_code = '', updated_at = ? WHERE id = ? AND state = 'pending'`,
        normalizedDeviceId,
        capabilityHash(capabilityToken),
        leaseExpiresAt,
        timestamp,
        candidate.id
      );
      if (Number(updated.changes) !== 1) {
        return { notification: null, reason: "no_notifications", closedDeliveryIds };
      }
      return {
        reason: "leased",
        closedDeliveryIds,
        notification: {
          id: candidate.id,
          capabilityToken,
          title: candidate.incident_closed_reason === "test_alert"
            ? `Test alert · ${cleanText(candidate.title, 140) || "Yoink"}`.slice(0, 160)
            : cleanText(candidate.title, 160) || "Yoink opportunity",
          message: candidate.incident_closed_reason === "test_alert"
            ? "This is a Yoink test alert. If you can read this, calls reach this browser."
            : notificationMessage(candidate),
          retailerId: candidate.retailer_id,
          retailerSku: candidate.retailer_sku,
          canonicalUrl: candidate.canonical_url,
          attributionUrl: candidate.attribution_url,
          unitPriceCents: candidate.unit_price_cents === null ? null : Number(candidate.unit_price_cents),
          currency: candidate.currency,
          action: candidate.action,
          expiresAt: candidate.expires_at,
          leaseExpiresAt,
          purchaseHandoff: walmartPurchaseHandoff(candidate, now),
          alert: candidate.incident_closed_reason === "test_alert"
        }
      };
    });
  }

  recoverExpired(now = Date.now()): {
    expiredNotifications: number;
    requeuedLeases: number;
    failedLeases: number;
  } {
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      // An expiry with attempts = 0 is honest only when a device actually asked
      // for calls while the notification was pending. If no active device ever
      // polled since the delivery was created, the receipt is `no_device_poll`:
      // the companion never asked, and lengthening the window would not help.
      // When the companion's heartbeat reports that it did ask but its
      // notification requests were refused (HTTP >= 400) after the delivery
      // was created, the receipt is `device_poll_refused` instead: the fix is
      // the pairing or the server, not Chrome. Mirrored in
      // postgres-notification-recovery.ts.
      const expiredNotifications = Number(this.db.run(
        `UPDATE notification_deliveries SET state = 'expired', assigned_device_id = NULL,
           capability_hash = '', lease_expires_at = '',
           failure_code = CASE
             WHEN attempts = 0 AND NOT EXISTS (
               SELECT 1 FROM extension_devices ed
               WHERE ed.user_id = notification_deliveries.user_id AND ed.status = 'active'
                 AND ed.last_notification_poll_at <> ''
                 AND ed.last_notification_poll_at >= notification_deliveries.created_at
             ) THEN CASE
               WHEN EXISTS (
                 SELECT 1 FROM extension_devices ed
                 WHERE ed.user_id = notification_deliveries.user_id AND ed.status = 'active'
                   AND json_valid(ed.capabilities_json)
                   AND json_extract(ed.capabilities_json, '$.loopHealth.notifications.ok') = 0
                   AND CAST(json_extract(ed.capabilities_json, '$.loopHealth.notifications.status') AS INTEGER) >= 400
                   AND json_extract(ed.capabilities_json, '$.loopHealth.notifications.at') >= notification_deliveries.created_at
               ) THEN 'device_poll_refused'
               ELSE 'no_device_poll' END
             ELSE 'job_window_expired' END,
           updated_at = ?
         WHERE user_id = ? AND state IN ('pending', 'leased')
           AND EXISTS (
             SELECT 1 FROM action_jobs aj
             WHERE aj.id = notification_deliveries.job_id AND aj.expires_at <= ?
           )`,
        timestamp,
        currentRequestScope().userId,
        timestamp
      ).changes);
      const failedLeases = Number(this.db.run(
        `UPDATE notification_deliveries SET state = 'failed', assigned_device_id = NULL,
           capability_hash = '', lease_expires_at = '', failure_code = 'delivery_attempts_exhausted', updated_at = ?
         WHERE user_id = ? AND state = 'leased' AND attempts >= ?
           AND lease_expires_at <> '' AND lease_expires_at <= ?`,
        timestamp,
        currentRequestScope().userId,
        NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
        timestamp
      ).changes);
      const requeuedLeases = Number(this.db.run(
        `UPDATE notification_deliveries SET state = 'pending', assigned_device_id = NULL,
           capability_hash = '', lease_expires_at = '', failure_code = 'lease_expired_requeued', updated_at = ?
         WHERE user_id = ? AND state = 'leased' AND attempts < ?
           AND lease_expires_at <> '' AND lease_expires_at <= ?`,
        timestamp,
        currentRequestScope().userId,
        NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
        timestamp
      ).changes);
      return { expiredNotifications, requeuedLeases, failedLeases };
    });
  }

  acknowledge(
    deviceId: string,
    deliveryId: string,
    capabilityToken: string,
    outcome: "delivered" | "failed",
    failureCode = "",
    now = Date.now()
  ): Record<string, unknown> {
    if (!DELIVERY_ID_PATTERN.test(deliveryId) || !CAPABILITY_PATTERN.test(capabilityToken)) {
      throw new Error("The notification delivery capability is invalid.");
    }
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      const delivery = this.db.get<{
        state: string;
        assigned_device_id: string | null;
        capability_hash: string;
        attempts: number;
      }>(
        "SELECT state, assigned_device_id, capability_hash, attempts FROM notification_deliveries WHERE id = ? AND user_id = ?",
        deliveryId,
        currentRequestScope().userId
      );
      if (!delivery || delivery.state !== "leased" || delivery.assigned_device_id !== deviceId
        || delivery.capability_hash !== capabilityHash(capabilityToken)) {
        throw new Error("The notification delivery capability is invalid.");
      }
      const nextState = outcome === "delivered"
        ? "delivered"
        : Number(delivery.attempts) >= NOTIFICATION_DELIVERY_MAX_ATTEMPTS ? "failed" : "pending";
      this.db.run(
        `UPDATE notification_deliveries SET state = ?,
           assigned_device_id = CASE WHEN ? = 'pending' THEN NULL ELSE assigned_device_id END,
           capability_hash = '', lease_expires_at = '',
           delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
           failure_code = CASE WHEN ? = 'delivered' THEN '' ELSE ? END,
           updated_at = ? WHERE id = ?`,
        nextState,
        nextState,
        nextState,
        timestamp,
        nextState,
        cleanText(failureCode || "chrome_notification_failed", 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_") || "chrome_notification_failed",
        timestamp,
        deliveryId
      );
      return { id: deliveryId, state: nextState, deliveredAt: nextState === "delivered" ? timestamp : "" };
    });
  }

  recordInteraction(deviceId: string, deliveryId: string, interaction: "clicked" | "dismissed", now = Date.now()): Record<string, unknown> {
    if (!DELIVERY_ID_PATTERN.test(deliveryId)) throw new Error("The notification delivery ID is invalid.");
    const timestamp = nowIso(now);
    const result = this.db.run(
      `UPDATE notification_deliveries SET state = ?, interaction_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND assigned_device_id = ? AND state = 'delivered'`,
      interaction,
      timestamp,
      timestamp,
      deliveryId,
      currentRequestScope().userId,
      cleanText(deviceId, 120)
    );
    return { id: deliveryId, state: Number(result.changes) === 1 ? interaction : "unchanged" };
  }

  acknowledgeClosedDeliveries(deviceId: string, deliveryIds: string[], now = Date.now()): Record<string, unknown> {
    const normalizedDeviceId = cleanText(deviceId, 120);
    const ids = [...new Set(Array.isArray(deliveryIds) ? deliveryIds : [])]
      .map((value) => cleanText(value, 160))
      .filter((value) => DELIVERY_ID_PATTERN.test(value))
      .slice(0, 100);
    if (!normalizedDeviceId || ids.length === 0) return { acknowledged: 0 };
    const slots = ids.map(() => "?").join(", ");
    const result = this.db.run(
      `UPDATE notification_deliveries SET assigned_device_id = NULL, updated_at = ?
       WHERE tenant_id = ? AND user_id = ? AND assigned_device_id = ?
         AND state IN ('clicked', 'dismissed') AND id IN (${slots})`,
      nowIso(now),
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      normalizedDeviceId,
      ...ids
    );
    return { acknowledged: Number(result.changes) };
  }

  counts(): Record<string, number> {
    const row = this.db.get<Record<string, number>>(
      `SELECT COUNT(*) AS totalNotifications,
              SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pendingNotifications,
              SUM(CASE WHEN state = 'delivered' THEN 1 ELSE 0 END) AS deliveredNotifications,
              SUM(CASE WHEN state IN ('failed', 'expired') THEN 1 ELSE 0 END) AS failedNotifications
       FROM notification_deliveries WHERE user_id = ?`,
      currentRequestScope().userId
    ) ?? {};
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]));
  }

  listRecent(limit = 100, offset = 0, search = ""): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return this.db.all(
      `SELECT nd.id, nd.state, nd.attempts, nd.failure_code AS failureCode,
              nd.delivered_at AS deliveredAt, nd.interaction_at AS interactionAt,
              nd.created_at AS createdAt, v.title, l.retailer_id AS retailerId,
              l.retailer_sku AS retailerSku
       FROM notification_deliveries nd
       JOIN action_jobs aj ON aj.id = nd.job_id
       JOIN listings l ON l.id = aj.listing_id
       JOIN variants v ON v.id = l.variant_id
       WHERE nd.user_id = ? AND (? = ''
         OR nd.id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR nd.state LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(nd.failure_code, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_sku LIKE ? ESCAPE '\\' COLLATE NOCASE)
       ORDER BY nd.created_at DESC, nd.id DESC LIMIT ? OFFSET ?`,
      currentRequestScope().userId,
      query,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      safeLimit,
      safeOffset
    );
  }

  recentCount(search = ""): number {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM notification_deliveries nd
       JOIN action_jobs aj ON aj.id = nd.job_id
       JOIN listings l ON l.id = aj.listing_id
       JOIN variants v ON v.id = l.variant_id
       WHERE nd.user_id = ? AND (? = ''
         OR nd.id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR nd.state LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(nd.failure_code, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_sku LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
      currentRequestScope().userId,
      query,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern
    )?.count ?? 0);
  }
}
