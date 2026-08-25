import { randomBytes } from "node:crypto";
import { cleanText } from "../../domain/src/normalize.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { type YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const DELIVERY_LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9_-]{3,160}$/;
const SAFE_RETAILERS = new Set([
  "target", "walmart", "amazon", "bestbuy", "disney", "ravensburger", "riot",
  "booksamillion", "fanatics", "kohls", "macys", "pbandai", "pokemoncenter"
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
}

export type NotificationLeaseResult =
  | { notification: NotificationLease; reason: "leased" }
  | { notification: null; reason: "no_notifications" | "device_unavailable" };

interface DeliveryCandidate {
  id: string;
  title: string;
  retailer_id: string;
  retailer_sku: string;
  canonical_url: string;
  attribution_url: string;
  action: string;
  unit_price_cents: number | null;
  currency: string;
  expires_at: string;
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
    pokemoncenter: "Pokémon Center"
  };
  const retailer = names[candidate.retailer_id]
    || `${candidate.retailer_id.slice(0, 1).toUpperCase()}${candidate.retailer_id.slice(1)}`;
  const price = Number.isSafeInteger(candidate.unit_price_cents) && Number(candidate.unit_price_cents) > 0
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: candidate.currency }).format(Number(candidate.unit_price_cents) / 100)
    : "price unavailable";
  return `${retailer} · ${price} · ${candidate.action.replaceAll("_", " ")}`.slice(0, 240);
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
      if (!device) return { notification: null, reason: "device_unavailable" };
      let capabilities: Record<string, unknown> = {};
      try { capabilities = JSON.parse(device.capabilities_json) as Record<string, unknown>; } catch { capabilities = {}; }
      if (capabilities.notifications !== true) return { notification: null, reason: "device_unavailable" };

      const timestamp = nowIso(now);
      this.recoverExpired(now);

      const candidate = this.db.get<DeliveryCandidate>(
        `SELECT nd.id, v.title, l.retailer_id, l.retailer_sku,
                aj.canonical_url, aj.attribution_url, aj.action,
                si.unit_price_cents, aj.currency, aj.expires_at
         FROM notification_deliveries nd
         JOIN action_jobs aj ON aj.id = nd.job_id
         JOIN listings l ON l.id = aj.listing_id
         JOIN variants v ON v.id = l.variant_id
         LEFT JOIN signal_incidents si ON si.id = aj.incident_id
         WHERE nd.user_id = ? AND nd.state = 'pending' AND aj.expires_at > ?
         ORDER BY nd.created_at, nd.id LIMIT 1`,
        currentRequestScope().userId,
        timestamp
      );
      if (!candidate) return { notification: null, reason: "no_notifications" };
      if (!SAFE_RETAILERS.has(candidate.retailer_id)) {
        this.db.run(
          "UPDATE notification_deliveries SET state = 'failed', failure_code = 'unsupported_retailer', updated_at = ? WHERE id = ?",
          timestamp,
          candidate.id
        );
        return { notification: null, reason: "no_notifications" };
      }

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
      if (Number(updated.changes) !== 1) return { notification: null, reason: "no_notifications" };
      return {
        reason: "leased",
        notification: {
          id: candidate.id,
          capabilityToken,
          title: cleanText(candidate.title, 160) || "Yoink opportunity",
          message: notificationMessage(candidate),
          retailerId: candidate.retailer_id,
          retailerSku: candidate.retailer_sku,
          canonicalUrl: candidate.canonical_url,
          attributionUrl: candidate.attribution_url,
          unitPriceCents: candidate.unit_price_cents === null ? null : Number(candidate.unit_price_cents),
          currency: candidate.currency,
          action: candidate.action,
          expiresAt: candidate.expires_at,
          leaseExpiresAt
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
      const expiredNotifications = Number(this.db.run(
        `UPDATE notification_deliveries SET state = 'expired', assigned_device_id = NULL,
           capability_hash = '', lease_expires_at = '', failure_code = 'job_window_expired', updated_at = ?
         WHERE user_id = ? AND state IN ('pending', 'leased')
           AND job_id IN (SELECT id FROM action_jobs WHERE expires_at <= ?)`,
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
        MAX_ATTEMPTS,
        timestamp
      ).changes);
      const requeuedLeases = Number(this.db.run(
        `UPDATE notification_deliveries SET state = 'pending', assigned_device_id = NULL,
           capability_hash = '', lease_expires_at = '', failure_code = 'lease_expired_requeued', updated_at = ?
         WHERE user_id = ? AND state = 'leased' AND attempts < ?
           AND lease_expires_at <> '' AND lease_expires_at <= ?`,
        timestamp,
        currentRequestScope().userId,
        MAX_ATTEMPTS,
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
        : Number(delivery.attempts) >= MAX_ATTEMPTS ? "failed" : "pending";
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

  listRecent(limit = 100): Array<Record<string, unknown>> {
    return this.db.all(
      `SELECT nd.id, nd.state, nd.attempts, nd.failure_code AS failureCode,
              nd.delivered_at AS deliveredAt, nd.interaction_at AS interactionAt,
              nd.created_at AS createdAt, v.title, l.retailer_id AS retailerId,
              l.retailer_sku AS retailerSku
       FROM notification_deliveries nd
       JOIN action_jobs aj ON aj.id = nd.job_id
       JOIN listings l ON l.id = aj.listing_id
       JOIN variants v ON v.id = l.variant_id
       WHERE nd.user_id = ? ORDER BY nd.created_at DESC LIMIT ?`,
      currentRequestScope().userId,
      Math.max(1, Math.min(1_000, Math.floor(limit)))
    );
  }
}
