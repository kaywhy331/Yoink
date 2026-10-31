import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { randomBytes } from "node:crypto";
import type {
  UserActionConnectorInput,
  UserConnectorEvent,
  UserConnectorKind
} from "../../contracts/src/action-platform.js";
import { USER_CONNECTOR_CONTRACT_VERSION } from "../../contracts/src/action-platform.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const CONNECTOR_ID = /^user_connector_[a-f0-9]{32}$/;
const DELIVERY_ID = /^user_connector_delivery_[a-f0-9]{32}$/;
const ENDPOINT_REFERENCE = /^[A-Za-z][A-Za-z0-9_.:-]{2,119}$/;
const CAPABILITY = /^[A-Za-z0-9_-]{40,100}$/;
const EVENT_TYPES = new Set<UserConnectorEvent>(["notify", "carted", "needs_you", "missed", "test"]);
const KINDS = new Set<UserConnectorKind>(["discord", "telegram", "slack", "webhook"]);
const MAX_ATTEMPTS = 12;
const LEASE_MS = 60_000;

interface ConnectorRow {
  id: string;
  kind: UserConnectorKind;
  name: string;
  enabled: number;
  endpointReference: string;
  endpointBindingFingerprint: string;
  eventsJson: string;
  lastDeliveryAt: string;
  lastErrorCode: string;
  createdAt: string;
  updatedAt: string;
}

interface DeliveryRow {
  id: string;
  connectorId: string;
  connectorKind: UserConnectorKind;
  connectorName: string;
  endpointReference: string;
  endpointBindingFingerprint: string;
  eventType: UserConnectorEvent;
  actionJobId: string | null;
  payloadJson: string;
  state: "pending" | "leased" | "retry_wait" | "delivered" | "dead_letter" | "cancelled";
  attemptCount: number;
  leaseCapabilityHash: string;
  leaseExpiresAt: string;
  nextAttemptAt: string;
  lastErrorCode: string;
  deliveredAt: string;
  providerMessageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserActionConnector {
  id: string;
  kind: UserConnectorKind;
  name: string;
  enabled: boolean;
  endpointReference: string;
  runtimeBound: boolean;
  events: UserConnectorEvent[];
  lastDeliveryAt: string;
  lastErrorCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserActionConnectorDelivery {
  id: string;
  connectorId: string;
  connectorKind: UserConnectorKind;
  connectorName: string;
  eventType: UserConnectorEvent;
  actionJobId: string;
  state: DeliveryRow["state"];
  attemptCount: number;
  lastErrorCode: string;
  deliveredAt: string;
  providerMessageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserActionConnectorLease {
  id: string;
  connectorId: string;
  connectorKind: UserConnectorKind;
  endpointReference: string;
  eventType: UserConnectorEvent;
  actionJobId: string;
  payload: Record<string, unknown>;
  attempt: number;
  capabilityToken: string;
  leaseExpiresAt: string;
}

function safeId(value: unknown, pattern: RegExp, label: string): string {
  const normalized = cleanText(value, 120);
  if (!pattern.test(normalized)) throw new InputValidationError(`${label} is invalid.`);
  return normalized;
}

function safeErrorCode(value: unknown, fallback: string): string {
  return cleanText(value, 80).toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function parseEvents(value: string): UserConnectorEvent[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((event): event is UserConnectorEvent => EVENT_TYPES.has(event as UserConnectorEvent))
      : [];
  } catch {
    return [];
  }
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function capabilityHash(deliveryId: string, token: string): string {
  return stableHash("yoink_user_connector_capability_v1", deliveryId, token);
}

const CONNECTOR_SELECT = `SELECT id, kind, name, enabled,
  endpoint_reference AS endpointReference,
  endpoint_binding_fingerprint AS endpointBindingFingerprint,
  events_json AS eventsJson, last_delivery_at AS lastDeliveryAt,
  last_error_code AS lastErrorCode, created_at AS createdAt, updated_at AS updatedAt
  FROM user_action_connectors`;

const DELIVERY_SELECT = `SELECT delivery.id, delivery.connector_id AS connectorId,
  connector.kind AS connectorKind, connector.name AS connectorName,
  delivery.endpoint_reference AS endpointReference,
  delivery.endpoint_binding_fingerprint AS endpointBindingFingerprint,
  delivery.event_type AS eventType, delivery.action_job_id AS actionJobId,
  delivery.payload_json AS payloadJson, delivery.state,
  delivery.attempt_count AS attemptCount,
  delivery.lease_capability_hash AS leaseCapabilityHash,
  delivery.lease_expires_at AS leaseExpiresAt,
  delivery.next_attempt_at AS nextAttemptAt,
  delivery.last_error_code AS lastErrorCode,
  delivery.delivered_at AS deliveredAt, delivery.provider_message_id AS providerMessageId,
  delivery.created_at AS createdAt, delivery.updated_at AS updatedAt
  FROM user_action_connector_deliveries delivery
  JOIN user_action_connectors connector ON connector.id = delivery.connector_id`;

export class UserActionConnectorRepository {
  private readonly audit: AuditRepository;

  constructor(
    private readonly db: YoinkDatabase,
    private readonly availableBindings: Readonly<Record<string, string>> = {}
  ) {
    this.audit = new AuditRepository(db);
  }

  private binding(reference: string): string {
    const scope = currentRequestScope();
    if (reference.startsWith("yoinkbot_")) return this.db.get<{ fingerprint: string }>(
      `SELECT c.binding_fingerprint AS fingerprint FROM user_bot_credentials c
       LEFT JOIN bot_providers p ON p.id=c.provider_id AND p.tenant_id=c.tenant_id
       WHERE c.endpoint_reference=? AND c.tenant_id=? AND c.user_id=?
         AND (c.provider_id IS NULL OR (p.enabled=1 AND p.bot_identity=c.provider_identity))`, reference, scope.tenantId, scope.userId
    )?.fingerprint ?? this.availableBindings[reference] ?? "";
    return this.availableBindings[reference] ?? "";
  }

  list(): UserActionConnector[] {
    const scope = currentRequestScope();
    return this.db.all<ConnectorRow>(
      `${CONNECTOR_SELECT} WHERE tenant_id = ? AND user_id = ? ORDER BY name, id`,
      scope.tenantId, scope.userId
    ).map((row) => this.connector(row));
  }

  setEnabled(id: string, enabled: boolean, now = Date.now()): UserActionConnector {
    const row = this.requireConnectorRow(safeId(id, CONNECTOR_ID, "The notification destination"));
    const scope = currentRequestScope();
    return this.db.transaction(() => {
      // A preference never rebinds a destination. Providers may be temporarily
      // unavailable while the customer opts out; retain their original binding.
      this.db.run("UPDATE user_action_connectors SET enabled=?, updated_at=? WHERE id=? AND tenant_id=? AND user_id=?",
        enabled ? 1 : 0, nowIso(now), row.id, scope.tenantId, scope.userId);
      if (!enabled) this.db.run(`UPDATE user_action_connector_deliveries SET state='cancelled',
        last_error_code='notification_opted_out', updated_at=? WHERE connector_id=? AND tenant_id=? AND user_id=?
        AND state IN ('pending','retry_wait')`, nowIso(now), row.id, scope.tenantId, scope.userId);
      this.audit.record({correlationId: row.id, aggregateType: "user_action_connector", eventType: "user_connector_updated",
        reasonCode: "notification_preference_changed", message: "The customer changed their notification preference.",
        data: {connectorId: row.id, enabled}}, now);
      return this.connector(this.requireConnectorRow(row.id));
    });
  }

  save(input: UserActionConnectorInput, id = "", now = Date.now()): UserActionConnector {
    if (input?.contractVersion !== USER_CONNECTOR_CONTRACT_VERSION || !KINDS.has(input.kind)) {
      throw new InputValidationError("The user connector contract is invalid.");
    }
    const name = cleanText(input.name, 120);
    const endpointReference = cleanText(input.endpointReference, 120);
    if (name.length < 2 || !ENDPOINT_REFERENCE.test(endpointReference)) {
      throw new InputValidationError("A connector name and deployment-owned endpoint reference are required.");
    }
    if (!Array.isArray(input.events) || input.events.length < 1
      || input.events.some((event) => !EVENT_TYPES.has(event))) {
      throw new InputValidationError("Choose at least one supported connector event.");
    }
    const events = [...new Set(input.events)].sort();
    const connectorId = id ? safeId(id, CONNECTOR_ID, "The user connector") : newId("user_connector");
    const scope = currentRequestScope();
    const existing = id ? this.requireConnectorRow(connectorId) : null;
    const timestamp = nowIso(now);
    const bindingFingerprint = this.binding(endpointReference);
    this.db.run(
      `INSERT INTO user_action_connectors(
         id, tenant_id, user_id, kind, name, enabled, endpoint_reference,
         endpoint_binding_fingerprint, events_json, last_delivery_at,
         last_error_code, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, name = excluded.name, enabled = excluded.enabled,
         endpoint_reference = excluded.endpoint_reference,
         endpoint_binding_fingerprint = excluded.endpoint_binding_fingerprint,
         events_json = excluded.events_json, updated_at = excluded.updated_at`,
      connectorId, scope.tenantId, scope.userId, input.kind, name,
      input.enabled === false ? 0 : 1, endpointReference, bindingFingerprint,
      JSON.stringify(events), existing?.lastDeliveryAt ?? "", existing?.lastErrorCode ?? "",
      existing?.createdAt ?? timestamp, timestamp
    );
    // Opting out also retires queued updates; re-enabling must not replay them.
    this.db.run(`UPDATE user_action_connector_deliveries SET state='cancelled',
      last_error_code='notification_opted_out', updated_at=?
      WHERE connector_id=? AND state IN ('pending','retry_wait')
        AND (?=0 OR event_type NOT IN (SELECT value FROM json_each(?)))`,
      timestamp, connectorId, input.enabled === false ? 0 : 1, JSON.stringify(events));
    this.audit.record({
      correlationId: connectorId,
      aggregateType: "user_action_connector",
      eventType: existing ? "user_connector_updated" : "user_connector_created",
      reasonCode: "user_connector_saved",
      message: "A user action connector was saved with explicit event choices.",
      data: { connectorId, kind: input.kind, enabled: input.enabled !== false, events, runtimeBound: Boolean(bindingFingerprint) }
    }, now);
    return this.connector(this.requireConnectorRow(connectorId));
  }

  queueForJob(eventType: Exclude<UserConnectorEvent, "test">, actionJobId: string, now = Date.now()): number {
    if (!EVENT_TYPES.has(eventType)) throw new InputValidationError("The user connector event type is invalid.");
    const scope = currentRequestScope();
    const job = this.db.get<{
      id: string;
      state: string;
      retailerId: string;
      retailerSku: string;
      canonicalUrl: string;
      title: string;
      missionId: string;
    }>(
      `SELECT job.id, job.state, listing.retailer_id AS retailerId,
              listing.retailer_sku AS retailerSku, job.canonical_url AS canonicalUrl,
              variant.title, job.mission_id AS missionId
       FROM action_jobs job
       JOIN listings listing ON listing.id = job.listing_id
       JOIN variants variant ON variant.id = listing.variant_id
       WHERE job.id = ? AND job.tenant_id = ? AND job.user_id = ?`,
      cleanText(actionJobId, 120), scope.tenantId, scope.userId
    );
    if (!job) throw new InputValidationError("The action job does not exist.");
    const proof = this.db.get<{ evidence: string }>(`SELECT evidence_json AS evidence FROM action_events
      WHERE job_id=? AND state='confirmed' ORDER BY created_at DESC, id DESC LIMIT 1`, job.id);
    const evidence = parsePayload(proof?.evidence || "{}");
    // Cart acceptance is not checkout availability. Older companions cannot send a success alert.
    const checkedAt = Date.parse(String(evidence.checkoutVerifiedAt || ""));
    if (eventType === "carted" && (job.state !== "confirmed"
      || evidence.checkoutAvailability !== "available" || !Number.isFinite(checkedAt)
      || checkedAt < now - 30_000 || checkedAt > now + 5_000
      || evidence.retailerId !== job.retailerId || evidence.retailerSku !== job.retailerSku)) return 0;
    const payload = {
      quantity: evidence.quantity,
      unitPriceCents: evidence.unitPriceCents,
      checkoutVerifiedAt: evidence.checkoutVerifiedAt,
      checkoutAvailability: evidence.checkoutAvailability,
      test: evidence.test === true,
      contractVersion: USER_CONNECTOR_CONTRACT_VERSION,
      eventType,
      actionJobId: job.id,
      missionId: job.missionId,
      state: job.state,
      retailerId: job.retailerId,
      retailerSku: job.retailerSku,
      title: cleanText(job.title, 300),
      url: cleanText(job.canonicalUrl, 4_096),
      occurredAt: nowIso(now),
      checkoutManual: true
    };
    return this.queue(eventType, job.id, payload, now);
  }

  queueTest(connectorId: string, now = Date.now()): UserActionConnectorDelivery {
    return this.queueConnectionMessage(connectorId, false, now);
  }

  queueConnectionConfirmation(connectorId: string, now = Date.now()): UserActionConnectorDelivery {
    return this.queueConnectionMessage(connectorId, true, now);
  }

  private queueConnectionMessage(connectorId: string, confirmation: boolean, now: number): UserActionConnectorDelivery {
    const connector = this.requireConnectorRow(safeId(connectorId, CONNECTOR_ID, "The user connector"));
    const payload = {
      contractVersion: USER_CONNECTOR_CONTRACT_VERSION,
      eventType: "test",
      title: confirmation ? "YoinkBot connected" : "Yoink connector test",
      ...(confirmation ? { purpose: "connection_confirmation" } : {}),
      occurredAt: nowIso(now),
      checkoutManual: true
    };
    const created = this.queue("test", "", payload, now, connector.id);
    if (created !== 1) throw new InputValidationError("The connector test delivery could not be queued.");
    const delivery = this.db.get<DeliveryRow>(
      `${DELIVERY_SELECT}
       WHERE delivery.connector_id = ? AND delivery.event_type = 'test'
       ORDER BY delivery.created_at DESC LIMIT 1`,
      connector.id
    );
    if (!delivery) throw new InputValidationError("The connector test delivery could not be loaded.");
    return this.delivery(delivery);
  }

  remove(id: string, now = Date.now()): void {
    this.db.transaction(() => {
      const connector = this.requireConnectorRow(safeId(id, CONNECTOR_ID, "The user connector"));
      if (this.db.get(`SELECT id FROM user_action_connector_deliveries
        WHERE connector_id = ? AND state = 'leased' AND lease_expires_at > ?`, id, nowIso(now))) {
        throw new InputValidationError("An update is being delivered. Pause this destination and try removing it in a minute.");
      }
      this.db.run("DELETE FROM user_action_connectors WHERE id = ?", connector.id);
      this.audit.record({ correlationId: id, aggregateType: "user_action_connector",
        eventType: "user_connector_removed", reasonCode: "user_connector_removed",
        message: "A destination and its delivery history were removed.", data: { connectorId: id } }, now);
    });
  }

  retry(id: string, expectedUpdatedAt: string, expectedAttemptCount: number, now = Date.now()): UserActionConnectorDelivery {
    return this.db.transaction(() => {
      const row = this.requireDeliveryRow(safeId(id, DELIVERY_ID, "The user connector delivery"));
      if (row.state === "pending" || row.state === "leased") return this.delivery(row);
      if (row.state !== "dead_letter" || row.updatedAt !== expectedUpdatedAt || row.attemptCount !== expectedAttemptCount) {
        throw new InputValidationError("This delivery changed. Refresh its history before retrying.");
      }
      const connector = this.requireConnectorRow(row.connectorId);
      if (!connector.enabled || !parseEvents(connector.eventsJson).includes(row.eventType)) {
        throw new InputValidationError("Enable this destination and its event before retrying.");
      }
      if (!row.endpointBindingFingerprint || row.endpointReference !== connector.endpointReference
        || row.endpointBindingFingerprint !== connector.endpointBindingFingerprint
        || this.binding(row.endpointReference) !== row.endpointBindingFingerprint) {
        throw new InputValidationError("The original destination is unavailable or changed. Save the current delivery key and send a new test instead.");
      }
      this.db.run(`UPDATE user_action_connector_deliveries SET state = 'pending', next_attempt_at = '',
        lease_capability_hash = '', lease_expires_at = '', updated_at = ? WHERE id = ?`, nowIso(now), row.id);
      this.audit.record({ correlationId: id, aggregateType: "user_action_connector",
        eventType: "user_connector_delivery_retried", reasonCode: "user_requested_retry",
        message: "A failed update was queued for another delivery attempt.",
        data: { deliveryId: id, connectorId: row.connectorId, previousAttempts: row.attemptCount } }, now);
      return this.delivery(this.requireDeliveryRow(id));
    });
  }

  deliveryCount(connectorId = ""): number {
    const scope = currentRequestScope();
    return Number(this.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM user_action_connector_deliveries
      WHERE tenant_id = ? AND user_id = ? AND (? = '' OR connector_id = ?)`,
      scope.tenantId, scope.userId, connectorId, connectorId)?.count ?? 0);
  }

  listDeliveries(limit = 100, offset = 0, connectorId = ""): UserActionConnectorDelivery[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const scope = currentRequestScope();
    return this.db.all<DeliveryRow>(
      `${DELIVERY_SELECT}
       WHERE delivery.tenant_id = ? AND delivery.user_id = ? AND (? = '' OR delivery.connector_id = ?)
       ORDER BY delivery.created_at DESC, delivery.id DESC LIMIT ? OFFSET ?`,
      scope.tenantId, scope.userId, connectorId, connectorId, safeLimit, (Number.isSafeInteger(offset) && offset >= 0 ? offset : 0)
    ).map((row) => this.delivery(row));
  }

  findDelivery(id: string): UserActionConnectorDelivery | null {
    const scope = currentRequestScope();
    const row = this.db.get<DeliveryRow>(`${DELIVERY_SELECT}
      WHERE delivery.id=? AND delivery.tenant_id=? AND delivery.user_id=?`,
    safeId(id, DELIVERY_ID, "The notification"), scope.tenantId, scope.userId);
    return row ? this.delivery(row) : null;
  }

  leaseNext(now = Date.now()): UserActionConnectorLease | null {
    this.expireLeases(now);
    const current = currentRequestScope();
    this.db.run(`UPDATE user_action_connector_deliveries SET state='cancelled', last_error_code='notification_expired', updated_at=?
      WHERE tenant_id=? AND user_id=? AND state IN ('pending','retry_wait') AND
        ((expires_at<>'' AND expires_at<=?) OR (event_type='carted' AND (expires_at='' OR EXISTS
          (SELECT 1 FROM action_events e WHERE e.job_id=action_job_id AND
           e.reason_code IN ('user_reported_order','user_reported_missed_it','user_reported_checkout_correction')))))`,
      nowIso(now), current.tenantId, current.userId, nowIso(now));
    const scope = currentRequestScope();
    return this.db.transaction(() => {
      // A stale deployment binding must not head-of-line block healthy
      // deliveries behind it. Bound the scan and dead-letter each stale row
      // before continuing to the next eligible delivery in the same cycle.
      for (let skipped = 0; skipped < 100; skipped += 1) {
        const row = this.db.get<DeliveryRow>(
          `${DELIVERY_SELECT}
           WHERE delivery.tenant_id = ? AND delivery.user_id = ?
             AND connector.enabled = 1
             AND delivery.event_type IN (SELECT value FROM json_each(connector.events_json))
             AND delivery.state IN ('pending', 'retry_wait')
             AND NOT EXISTS (SELECT 1 FROM user_action_connector_deliveries busy WHERE busy.connector_id=delivery.connector_id AND busy.state='leased')
             AND (delivery.next_attempt_at = '' OR delivery.next_attempt_at <= ?)
           ORDER BY CASE WHEN delivery.event_type='carted' THEN 0 WHEN delivery.event_type='needs_you' THEN 1 ELSE 2 END, delivery.created_at, delivery.id LIMIT 1`,
          scope.tenantId, scope.userId, nowIso(now)
        );
        if (!row) return null;
        const currentBinding = this.binding(row.endpointReference);
        if (!row.endpointBindingFingerprint || currentBinding !== row.endpointBindingFingerprint) {
          this.db.run(
            `UPDATE user_action_connector_deliveries
             SET state = 'dead_letter', last_error_code = 'connector_binding_unavailable', updated_at = ?
             WHERE id = ?`,
            nowIso(now), row.id
          );
          this.db.run(
            `UPDATE user_action_connectors SET last_error_code = 'connector_binding_unavailable', updated_at = ?
             WHERE id = ?`,
            nowIso(now), row.connectorId
          );
          continue;
        }
        const capabilityToken = randomBytes(32).toString("base64url");
        const leaseExpiresAt = nowIso(now + LEASE_MS);
        this.db.run(
          `UPDATE user_action_connector_deliveries
           SET state = 'leased', attempt_count = attempt_count + 1,
               lease_capability_hash = ?, lease_expires_at = ?, next_attempt_at = '', updated_at = ?
           WHERE id = ?`,
          capabilityHash(row.id, capabilityToken), leaseExpiresAt, nowIso(now), row.id
        );
        return {
          id: row.id,
          connectorId: row.connectorId,
          connectorKind: row.connectorKind,
          endpointReference: row.endpointReference,
          eventType: row.eventType,
          actionJobId: row.actionJobId ?? "",
          payload: parsePayload(row.payloadJson),
          attempt: Number(row.attemptCount) + 1,
          capabilityToken,
          leaseExpiresAt
        };
      }
      return null;
    });
  }

  complete(deliveryId: string, capabilityToken: string, now = Date.now(), providerMessageId = ""): UserActionConnectorDelivery {
    const row = this.requireLease(deliveryId, capabilityToken, now);
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE user_action_connector_deliveries
         SET state = 'delivered', lease_capability_hash = '', lease_expires_at = '',
             last_error_code = '', delivered_at = ?, updated_at = ?, provider_message_id = ? WHERE id = ?`,
        timestamp, timestamp, cleanText(providerMessageId, 120), row.id
      );
      this.db.run(
        `UPDATE user_action_connectors
         SET last_delivery_at = ?, last_error_code = '', updated_at = ? WHERE id = ?`,
        timestamp, timestamp, row.connectorId
      );
    });
    return this.delivery(this.requireDeliveryRow(row.id));
  }

  fail(
    deliveryId: string,
    capabilityToken: string,
    reason: unknown,
    retryable: boolean,
    now = Date.now(),
    retryAfterMs = 0
  ): UserActionConnectorDelivery {
    const row = this.requireLease(deliveryId, capabilityToken, now);
    const errorCode = safeErrorCode(reason, "connector_delivery_failed");
    const attempts = Number(row.attemptCount);
    const retry = retryable && attempts < MAX_ATTEMPTS;
    const providerDelay = Number.isFinite(retryAfterMs) ? Math.max(0, Math.min(86_400, Math.ceil(retryAfterMs / 1_000))) : 0;
    const delaySeconds = Math.max(Math.min(60, 2 ** Math.max(0, attempts)), providerDelay);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE user_action_connector_deliveries SET state = ?,
           lease_capability_hash = '', lease_expires_at = '', next_attempt_at = ?,
           last_error_code = ?, updated_at = ? WHERE id = ?`,
        retry ? "retry_wait" : "dead_letter",
        retry ? nowIso(now + delaySeconds * 1_000) : "",
        errorCode, nowIso(now), row.id
      );
      this.db.run(
        `UPDATE user_action_connectors SET last_error_code = ?, updated_at = ? WHERE id = ?`,
        errorCode, nowIso(now), row.connectorId
      );
    });
    return this.delivery(this.requireDeliveryRow(row.id));
  }

  private queue(
    eventType: UserConnectorEvent,
    actionJobId: string,
    payload: Record<string, unknown>,
    now: number,
    exactConnectorId = ""
  ): number {
    const scope = currentRequestScope();
    const connectors = this.db.all<ConnectorRow>(
      `${CONNECTOR_SELECT}
       WHERE tenant_id = ? AND user_id = ? AND enabled = 1
         AND (? = '' OR id = ?)
       ORDER BY id`,
      scope.tenantId, scope.userId, exactConnectorId, exactConnectorId
    ).filter((connector) => parseEvents(connector.eventsJson).includes(eventType));
    const payloadJson = stableJson(payload);
    if (Buffer.byteLength(payloadJson, "utf8") > 4_000) throw new InputValidationError("The connector payload is too large.");
    let created = 0;
    for (const connector of connectors) {
      const idempotency = stableHash(
        "yoink_user_connector_delivery_v1",
        connector.id,
        eventType,
        actionJobId || String(payload.occurredAt ?? "")
      );
      const timestamp = nowIso(now);
      const result = this.db.run(
        `INSERT OR IGNORE INTO user_action_connector_deliveries(
           id, tenant_id, user_id, connector_id, endpoint_reference,
           endpoint_binding_fingerprint, action_job_id, event_type, payload_json,
           idempotency_key_hash, state, attempt_count, lease_capability_hash,
           lease_expires_at, next_attempt_at, last_error_code, delivered_at,
           created_at, updated_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', '', '', '', ?, ?, ?)`,
        newId("user_connector_delivery"), scope.tenantId, scope.userId, connector.id,
        connector.endpointReference, connector.endpointBindingFingerprint,
        actionJobId || null, eventType, payloadJson, idempotency, timestamp, timestamp,
        eventType === "carted" ? nowIso(Math.min(now, Date.parse(String(payload.checkoutVerifiedAt)) || now) + 60_000)
          : eventType === "needs_you" || eventType === "test" ? nowIso(now + 5 * 60_000) : ""
      );
      created += Number(result.changes ?? 0);
    }
    return created;
  }

  private connector(row: ConnectorRow): UserActionConnector {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      enabled: Number(row.enabled) === 1,
      endpointReference: row.endpointReference,
      runtimeBound: Boolean(row.endpointBindingFingerprint)
        && this.binding(row.endpointReference) === row.endpointBindingFingerprint,
      events: parseEvents(row.eventsJson),
      lastDeliveryAt: row.lastDeliveryAt,
      lastErrorCode: row.lastErrorCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private delivery(row: DeliveryRow): UserActionConnectorDelivery {
    return {
      id: row.id,
      connectorId: row.connectorId,
      connectorKind: row.connectorKind,
      connectorName: row.connectorName,
      eventType: row.eventType,
      actionJobId: row.actionJobId ?? "",
      state: row.state,
      attemptCount: Number(row.attemptCount),
      lastErrorCode: row.lastErrorCode,
      deliveredAt: row.deliveredAt,
      providerMessageId: row.providerMessageId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private requireConnectorRow(id: string): ConnectorRow {
    const scope = currentRequestScope();
    const row = this.db.get<ConnectorRow>(
      `${CONNECTOR_SELECT} WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      id, scope.tenantId, scope.userId
    );
    if (!row) throw new InputValidationError("The user action connector does not exist.");
    return row;
  }

  private requireDeliveryRow(id: string): DeliveryRow {
    const scope = currentRequestScope();
    const row = this.db.get<DeliveryRow>(
      `${DELIVERY_SELECT} WHERE delivery.id = ? AND delivery.tenant_id = ? AND delivery.user_id = ?`,
      id, scope.tenantId, scope.userId
    );
    if (!row) throw new InputValidationError("The user connector delivery does not exist.");
    return row;
  }

  private requireLease(id: string, token: string, now: number): DeliveryRow {
    const safeDeliveryId = safeId(id, DELIVERY_ID, "The user connector delivery");
    if (!CAPABILITY.test(token)) throw new InputValidationError("The user connector delivery capability is invalid.");
    const row = this.requireDeliveryRow(safeDeliveryId);
    if (row.state !== "leased" || row.leaseExpiresAt <= nowIso(now)
      || row.leaseCapabilityHash !== capabilityHash(row.id, token)) {
      throw new InputValidationError("The user connector delivery capability is invalid or expired.");
    }
    return row;
  }

  private expireLeases(now: number): void {
    const scope = currentRequestScope();
    this.db.run(
      `UPDATE user_action_connector_deliveries
       SET state = CASE WHEN attempt_count >= ? THEN 'dead_letter' ELSE 'retry_wait' END,
           lease_capability_hash = '', lease_expires_at = '', next_attempt_at = ?,
           last_error_code = 'lease_expired', updated_at = ?
       WHERE tenant_id = ? AND user_id = ? AND state = 'leased' AND lease_expires_at <= ?`,
      MAX_ATTEMPTS, nowIso(now + 2_000), nowIso(now), scope.tenantId, scope.userId, nowIso(now)
    );
  }
}
