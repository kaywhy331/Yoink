import { cleanText } from "../../domain/src/normalize.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import {
  buildDeliveryHealth,
  DEFAULT_CART_FRESHNESS_SECONDS,
  NOTIFY_JOB_LIFETIME_SECONDS,
  PLAN_CLOSED_DELIVERY_FAILURE_CODES,
  normalizeAccessibleRetailers,
  normalizeCompanionLoopHealth,
  sourceFreshness,
  type DeliveryDeviceInput,
  type DeliveryHealth,
  type DeliveryTestAlertReceipt
} from "../../domain/src/delivery-health.js";
import { AuditRepository } from "./audit-repository.js";
import { type YoinkDatabase } from "./database.js";
import { NotificationRepository } from "./notification-repository.js";
import { currentRequestScope } from "./request-scope.js";

const NOTIFICATION_WINDOW_DAYS = 7;

/**
 * Test alerts are real jobs and deliveries (the receipt proves the channel),
 * but they are not calls: keep them out of the call counts, streak and
 * "last job" so a test ping never hides a real delivery outage. Their
 * incident carries closed_reason `test_alert` and no observed price.
 */
const NOT_TEST_ALERT_JOB = `NOT EXISTS (
  SELECT 1 FROM signal_incidents test_incident
  WHERE test_incident.id = aj.incident_id AND test_incident.closed_reason = 'test_alert')`;
const NOT_TEST_ALERT_DELIVERY = `NOT EXISTS (
  SELECT 1 FROM action_jobs test_job JOIN signal_incidents test_incident ON test_incident.id = test_job.incident_id
  WHERE test_job.id = nd.job_id AND test_incident.closed_reason = 'test_alert')`;

/**
 * Calls the shopper's own plan change closed (pause, satisfied, archive,
 * delete, a listing turned off) are not delivery outcomes: keep them out of
 * the counts, the undelivered streak and the dominant failure so delivery
 * health never blames Chrome for them.
 */
const PLAN_CLOSED_CODES_SQL = PLAN_CLOSED_DELIVERY_FAILURE_CODES.map((code) => `'${code}'`).join(", ");
const NOT_PLAN_CLOSED_DELIVERY = `failure_code NOT IN (${PLAN_CLOSED_CODES_SQL})`;

export const DELIVERY_TEST_ALERT_EVENT_TYPE = "delivery_test_alert_requested";

export interface DeliveryHealthContext {
  devices: Array<Record<string, unknown>>;
  connectors: Array<Record<string, unknown>>;
  now?: number;
}

export interface TestAlertTarget {
  missionId: string;
  missionTargetId: string;
  listingId: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  title: string;
  unitPriceCents: number | null;
}

export class TestAlertError extends Error {
  constructor(readonly code: "test_alert_needs_plan" | "test_alert_needs_device", readonly status: 409, message: string) {
    super(message);
    this.name = "TestAlertError";
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The one server-computed delivery-health object every surface renders. It
 * reads receipts (timestamps that exist because something happened) and never
 * a stored "ready" bit. See packages/domain/src/delivery-health.ts.
 */
export class DeliveryHealthRepository {
  private readonly notifications: NotificationRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.notifications = new NotificationRepository(db);
    this.audit = new AuditRepository(db);
  }

  snapshot(context: DeliveryHealthContext): DeliveryHealth {
    const now = context.now ?? Date.now();
    const scope = currentRequestScope();
    // Signal receipts use the server-side created_at, never the payload's
    // received_at, so a sender clock cannot age or freshen a source (CORE-07).
    const receipts = this.db.get<{
      lastSignalAt: string | null;
      lastJobAt: string | null;
      lastJobLeaseAt: string | null;
      lastNotificationLeaseAt: string | null;
      lastDeliveredAt: string | null;
      lastCartReadyAt: string | null;
      pendingNotifications: number;
      activePlans: number;
    }>(
      `SELECT
         (SELECT MAX(se.created_at) FROM signal_events se WHERE se.user_id = ? AND se.test = 0) AS lastSignalAt,
         (SELECT MAX(aj.created_at) FROM action_jobs aj WHERE aj.user_id = ? AND ${NOT_TEST_ALERT_JOB}) AS lastJobAt,
         (SELECT MAX(aj.leased_at) FROM action_jobs aj WHERE aj.user_id = ? AND aj.leased_at <> '') AS lastJobLeaseAt,
         (SELECT MAX(nd.updated_at) FROM notification_deliveries nd WHERE nd.user_id = ? AND nd.attempts > 0) AS lastNotificationLeaseAt,
         (SELECT MAX(nd.delivered_at) FROM notification_deliveries nd WHERE nd.user_id = ? AND nd.delivered_at <> '') AS lastDeliveredAt,
         (SELECT MAX(ae.created_at) FROM action_events ae JOIN action_jobs aj ON aj.id = ae.job_id
           WHERE aj.user_id = ? AND aj.action = 'add_to_cart' AND ae.state = 'confirmed') AS lastCartReadyAt,
         (SELECT COUNT(*) FROM notification_deliveries nd WHERE nd.user_id = ? AND nd.state = 'pending') AS pendingNotifications,
         (SELECT COUNT(*) FROM missions m WHERE m.user_id = ? AND m.status = 'active') AS activePlans`,
      scope.userId, scope.userId, scope.userId, scope.userId, scope.userId, scope.userId, scope.userId, scope.userId
    );
    const windowStart = nowIso(now - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60_000);
    const counts = this.db.get<{ created: number; delivered: number; expired: number; failed: number; pending: number }>(
      `SELECT COUNT(*) AS created,
              SUM(CASE WHEN state IN ('delivered', 'clicked', 'dismissed') THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN state = 'expired' THEN 1 ELSE 0 END) AS expired,
              SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN state IN ('pending', 'leased') THEN 1 ELSE 0 END) AS pending
       FROM notification_deliveries nd WHERE user_id = ? AND created_at >= ? AND ${NOT_TEST_ALERT_DELIVERY}
         AND nd.${NOT_PLAN_CLOSED_DELIVERY}`,
      scope.userId,
      windowStart
    );
    const recent = this.db.all<{ state: string }>(
      `SELECT state FROM notification_deliveries nd WHERE user_id = ? AND ${NOT_TEST_ALERT_DELIVERY}
         AND nd.${NOT_PLAN_CLOSED_DELIVERY}
       ORDER BY created_at DESC, id DESC LIMIT 10`,
      scope.userId
    );
    let consecutiveUndelivered = 0;
    for (const row of recent) {
      if (row.state === "expired" || row.state === "failed") consecutiveUndelivered += 1;
      else break;
    }
    const dominant = this.db.get<{ failureCode: string; count: number }>(
      `SELECT failure_code AS failureCode, COUNT(*) AS count FROM notification_deliveries
       WHERE user_id = ? AND state IN ('expired', 'failed') AND failure_code <> '' AND ${NOT_PLAN_CLOSED_DELIVERY}
         AND created_at >= COALESCE((SELECT MAX(created_at) FROM notification_deliveries
                                     WHERE user_id = ? AND state IN ('expired', 'failed') AND ${NOT_PLAN_CLOSED_DELIVERY}
                                       AND created_at >= ?), '')
       GROUP BY failure_code ORDER BY count DESC, failure_code LIMIT 1`,
      scope.userId,
      scope.userId,
      windowStart
    ) ?? this.db.get<{ failureCode: string; count: number }>(
      `SELECT failure_code AS failureCode, COUNT(*) AS count FROM notification_deliveries
       WHERE user_id = ? AND state IN ('expired', 'failed') AND failure_code <> '' AND ${NOT_PLAN_CLOSED_DELIVERY}
       GROUP BY failure_code ORDER BY count DESC, failure_code LIMIT 1`,
      scope.userId
    );
    const devices: DeliveryDeviceInput[] = context.devices
      .filter((device) => text(device.status) === "active")
      .map((device) => ({
        id: text(device.id),
        name: text(device.name) || "Chrome",
        online: device.online === true,
        lastSeenAt: text(device.lastSeenAt),
        lastNotificationPollAt: text(device.lastNotificationPollAt),
        lastJobPollAt: text(device.lastJobPollAt),
        notificationsCapable: (device.capabilities as Record<string, unknown> | undefined)?.notifications === true,
        platform: text(device.platform),
        loopHealth: normalizeCompanionLoopHealth(device.loopHealth),
        accessibleRetailers: normalizeAccessibleRetailers(device.accessibleRetailers)
      }));
    const connectors = {
      total: context.connectors.length,
      enabled: context.connectors.filter((connector) => connector.enabled === true).length,
      bound: context.connectors.filter((connector) => connector.enabled === true && connector.runtimeBound === true).length
    };
    return buildDeliveryHealth({
      now,
      lastSignalAt: receipts?.lastSignalAt ?? "",
      lastJobAt: receipts?.lastJobAt ?? "",
      lastLeaseAt: [receipts?.lastJobLeaseAt ?? "", receipts?.lastNotificationLeaseAt ?? ""].sort().at(-1) ?? "",
      lastDeliveredAt: receipts?.lastDeliveredAt ?? "",
      lastCartReadyAt: receipts?.lastCartReadyAt ?? "",
      notifications: {
        windowDays: NOTIFICATION_WINDOW_DAYS,
        created: Number(counts?.created ?? 0),
        delivered: Number(counts?.delivered ?? 0),
        expired: Number(counts?.expired ?? 0),
        failed: Number(counts?.failed ?? 0),
        pending: Number(counts?.pending ?? 0)
      },
      pendingNotifications: Number(receipts?.pendingNotifications ?? 0),
      consecutiveUndelivered,
      dominantFailureCode: dominant?.failureCode ?? "",
      devices,
      connectors,
      activePlans: Number(receipts?.activePlans ?? 0),
      cartFreshnessSeconds: DEFAULT_CART_FRESHNESS_SECONDS,
      notifyLifetimeSeconds: NOTIFY_JOB_LIFETIME_SECONDS,
      testAlert: this.latestTestAlert()
    });
  }

  latestTestAlert(): DeliveryTestAlertReceipt | null {
    const scope = currentRequestScope();
    const row = this.db.get<{
      requestedAt: string;
      jobId: string;
      deliveryId: string;
      state: string | null;
      attempts: number | null;
      deliveredAt: string | null;
      failureCode: string | null;
      title: string | null;
    }>(
      `SELECT ae.created_at AS requestedAt,
              json_extract(ae.data_json, '$.jobId') AS jobId,
              json_extract(ae.data_json, '$.deliveryId') AS deliveryId,
              nd.state, nd.attempts, nd.delivered_at AS deliveredAt, nd.failure_code AS failureCode,
              v.title
       FROM audit_events ae
       LEFT JOIN notification_deliveries nd ON nd.id = json_extract(ae.data_json, '$.deliveryId')
       LEFT JOIN action_jobs aj ON aj.id = nd.job_id
       LEFT JOIN listings l ON l.id = aj.listing_id
       LEFT JOIN variants v ON v.id = l.variant_id
       WHERE ae.user_id = ? AND ae.event_type = ?
       ORDER BY ae.created_at DESC, ae.id DESC LIMIT 1`,
      scope.userId,
      DELIVERY_TEST_ALERT_EVENT_TYPE
    );
    if (!row) return null;
    return {
      requestedAt: row.requestedAt,
      jobId: cleanText(row.jobId, 160),
      deliveryId: cleanText(row.deliveryId, 160),
      state: row.state ?? "missing",
      attempts: Number(row.attempts ?? 0),
      deliveredAt: row.deliveredAt ?? "",
      failureCode: row.failureCode ?? "",
      title: row.title ?? ""
    };
  }

  /** The listing a test alert can use: the most recently updated active plan target. */
  testAlertTarget(): TestAlertTarget | null {
    const row = this.db.get<{
      missionId: string;
      missionTargetId: string;
      listingId: string;
      retailerId: string;
      retailerSku: string;
      canonicalUrl: string;
      title: string;
      unitPriceCents: number | null;
    }>(
      `SELECT m.id AS missionId, mt.id AS missionTargetId, l.id AS listingId,
              l.retailer_id AS retailerId, l.retailer_sku AS retailerSku, l.canonical_url AS canonicalUrl,
              v.title, COALESCE(mt.max_unit_price_cents, v.msrp_cents) AS unitPriceCents
       FROM missions m
       JOIN mission_targets mt ON mt.mission_id = m.id AND mt.enabled = 1
       JOIN listings l ON l.id = mt.listing_id
       JOIN variants v ON v.id = l.variant_id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY m.updated_at DESC, m.id DESC LIMIT 1`,
      currentRequestScope().userId
    );
    if (!row) return null;
    return {
      ...row,
      unitPriceCents: Number.isSafeInteger(Number(row.unitPriceCents)) && Number(row.unitPriceCents) > 0 ? Number(row.unitPriceCents) : null
    };
  }

  /**
   * Send a test alert: a real notify-only job and pending delivery for one of
   * the shopper's own plan listings, with no store signal and no catalog
   * effect. The incident is created already closed with reason `test_alert`
   * so it never corroborates a stock claim. Chrome leases and shows it exactly
   * like a real call, which is the point: the receipt proves the channel.
   */
  createTestAlert(context: { devices: Array<Record<string, unknown>> }, now = Date.now()): {
    jobId: string;
    deliveryId: string;
    title: string;
    expiresAt: string;
  } {
    const scope = currentRequestScope();
    const target = this.testAlertTarget();
    if (!target) {
      throw new TestAlertError("test_alert_needs_plan", 409, "Save a plan for at least one product first; a test alert uses one of your plan listings.");
    }
    const pairedActive = context.devices.some((device) => text(device.status) === "active");
    if (!pairedActive) {
      throw new TestAlertError("test_alert_needs_device", 409, "Pair the Chrome companion first; a test alert can only be shown as a Chrome notification.");
    }
    const timestamp = nowIso(now);
    const expiresAt = nowIso(now + NOTIFY_JOB_LIFETIME_SECONDS * 1_000);
    const incidentId = newId("incident");
    const jobId = newId("action_job");
    return this.db.transaction(() => {
      this.db.run(
        `INSERT INTO signal_incidents(
           id, tenant_id, user_id, listing_id, event_type, semantic_key, status,
           unit_price_cents, currency, seller_name, seller_type, offer_fingerprint,
           first_observed_at, last_observed_at, occurrence_count, closed_reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'in_stock', ?, 'closed', NULL, 'USD', '', 'unknown', '', ?, ?, 1, 'test_alert', ?, ?)`,
        incidentId,
        scope.tenantId,
        scope.userId,
        target.listingId,
        `test_alert:${jobId}`,
        timestamp,
        timestamp,
        timestamp,
        timestamp
      );
      this.db.run(
        `INSERT INTO action_jobs(
           id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
           strategy_id, strategy_revision, decision_source, state, action, quantity,
           max_unit_price_cents, max_order_total_cents, currency, seller_policy,
           fulfillment, expected_seller, listing_id, canonical_url, attribution_url,
           attribution_provider, attribution_metadata_json, affiliate_mode,
           offer_fingerprint, idempotency_key, capability_nonce_hash, expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'purchase_intent', 'notify_only', 'notify', 1,
                   NULL, NULL, 'USD', 'first_party_only', 'shipping', '', ?, ?, '',
                   'canonical', '{}', 'prefer_fallback', '', ?, ?, ?, ?, ?)`,
        jobId,
        scope.tenantId,
        scope.userId,
        target.missionId,
        target.missionTargetId,
        incidentId,
        target.listingId,
        target.canonicalUrl,
        stableHash("delivery_test_alert", scope.userId, jobId),
        stableHash("delivery_test_alert_nonce", scope.userId, jobId, timestamp),
        expiresAt,
        timestamp,
        timestamp
      );
      this.db.run(
        `INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at)
         VALUES (?, ?, 'notify_only', 'delivery_test_alert', ?, '{}', ?)`,
        newId("action_event"),
        jobId,
        "Test alert requested from Settings. No store signal was received and no stock claim was recorded.",
        timestamp
      );
      this.notifications.ensureForJob(jobId, now);
      const delivery = this.db.get<{ id: string }>(
        "SELECT id FROM notification_deliveries WHERE job_id = ? AND user_id = ?",
        jobId,
        scope.userId
      );
      const deliveryId = delivery?.id ?? "";
      this.audit.record({
        correlationId: jobId,
        aggregateType: "notification",
        eventType: DELIVERY_TEST_ALERT_EVENT_TYPE,
        reasonCode: "test_alert_requested",
        message: "A test alert was queued for the paired Chrome companion.",
        data: { jobId, deliveryId, listingId: target.listingId, retailerId: target.retailerId, expiresAt }
      }, now);
      return { jobId, deliveryId, title: target.title, expiresAt };
    });
  }

  /**
   * Decorate `control.listSources()` rows with a server-computed freshness
   * object and an honest derived status (browser from device presence,
   * TrackaLacker from its last push/delivery/registration age).
   */
  decorateSources(
    sources: Array<Record<string, unknown>>,
    context: { devices: Array<Record<string, unknown>>; trackalacker: Record<string, unknown> | null; now?: number }
  ): Array<Record<string, unknown>> {
    const now = context.now ?? Date.now();
    const scope = currentRequestScope();
    const lastSignals = new Map(this.db.all<{ sourceConnectionId: string; lastSignalAt: string }>(
      // Server-side created_at: the payload's received_at is sender-supplied (CORE-07).
      `SELECT source_connection_id AS sourceConnectionId, MAX(created_at) AS lastSignalAt
       FROM signal_events WHERE user_id = ? AND test = 0 GROUP BY source_connection_id`,
      scope.userId
    ).map((row) => [row.sourceConnectionId, row.lastSignalAt]));
    const lastSyncs = new Map(this.db.all<{ sourceConnectionId: string; lastSyncAt: string }>(
      `SELECT source_connection_id AS sourceConnectionId, MAX(COALESCE(NULLIF(completed_at, ''), updated_at)) AS lastSyncAt
       FROM source_sync_runs WHERE user_id = ? GROUP BY source_connection_id`,
      scope.userId
    ).map((row) => [row.sourceConnectionId, row.lastSyncAt]));
    const activePlans = Number(this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM missions WHERE user_id = ? AND status = 'active'",
      scope.userId
    )?.count ?? 0);
    const activeDevices = context.devices.filter((device) => text(device.status) === "active");
    const onlineDevice = activeDevices.find((device) => device.online === true) ?? activeDevices[0] ?? null;
    const pushDevices = Array.isArray(context.trackalacker?.devices) ? context.trackalacker!.devices as Array<Record<string, unknown>> : [];
    const push = pushDevices.find((device) => device.ready === true) ?? pushDevices[0] ?? null;
    return sources.map((source) => {
      const id = text(source.id);
      const freshness = sourceFreshness({
        source: text(source.source),
        status: text(source.status),
        lastEventAt: text(source.lastEventAt),
        lastSignalAt: lastSignals.get(id) ?? "",
        lastSyncAt: lastSyncs.get(id) ?? text(source.lastEventAt),
        activePlans,
        now,
        trackalacker: push
          ? {
            ready: push.ready === true,
            state: text(push.state),
            errorCode: text(push.errorCode),
            lastHttpStatus: Number(push.lastHttpStatus ?? 0),
            lastRegistrationAt: text(push.lastRegistrationAt),
            lastNotificationAt: text(push.lastNotificationAt),
            lastDeliveryAt: text(push.lastDeliveryAt),
            deviceName: text(push.deviceName)
          }
          : null,
        device: onlineDevice
          ? { online: onlineDevice.online === true, lastSeenAt: text(onlineDevice.lastSeenAt), name: text(onlineDevice.name) }
          : null
      });
      return {
        ...source,
        storedStatus: source.status,
        status: freshness.status,
        lastSignalAt: freshness.lastSignalAt,
        lastSyncAt: freshness.lastSyncAt,
        freshness
      };
    });
  }
}
