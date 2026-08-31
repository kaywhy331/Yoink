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
const EVENT_TYPES = new Set<UserConnectorEvent>(["carted", "needs_you", "missed", "test"]);
const KINDS = new Set<UserConnectorKind>(["discord", "slack", "webhook"]);
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
  if (!pattern.test(normalized)) throw new Error(`${label} is invalid.`);
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
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
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
  delivery.delivered_at AS deliveredAt,
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

  list(): UserActionConnector[] {
    const scope = currentRequestScope();
    return this.db.all<ConnectorRow>(
      `${CONNECTOR_SELECT} WHERE tenant_id = ? AND user_id = ? ORDER BY name, id`,
      scope.tenantId, scope.userId
    ).map((row) => this.connector(row));
  }

  save(input: UserActionConnectorInput, id = "", now = Date.now()): UserActionConnector {
    if (input?.contractVersion !== USER_CONNECTOR_CONTRACT_VERSION || !KINDS.has(input.kind)) {
      throw new Error("The user connector contract is invalid.");
    }
    const name = cleanText(input.name, 120);
    const endpointReference = cleanText(input.endpointReference, 120);
    if (name.length < 2 || !ENDPOINT_REFERENCE.test(endpointReference)) {
      throw new Error("A connector name and deployment-owned endpoint reference are required.");
    }
    if (!Array.isArray(input.events) || input.events.length < 1
      || input.events.some((event) => !EVENT_TYPES.has(event))) {
      throw new Error("Choose at least one supported connector event.");
    }
    const events = [...new Set(input.events)].sort();
    const connectorId = id ? safeId(id, CONNECTOR_ID, "The user connector") : newId("user_connector");
    const scope = currentRequestScope();
    const existing = id ? this.requireConnectorRow(connectorId) : null;
    const timestamp = nowIso(now);
    const bindingFingerprint = this.availableBindings[endpointReference] ?? "";
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
    if (!EVENT_TYPES.has(eventType)) throw new Error("The user connector event type is invalid.");
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
    if (!job) throw new Error("The action job does not exist.");
    const payload = {
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
    const connector = this.requireConnectorRow(safeId(connectorId, CONNECTOR_ID, "The user connector"));
    const payload = {
      contractVersion: USER_CONNECTOR_CONTRACT_VERSION,
      eventType: "test",
      title: "Yoink connector test",
      occurredAt: nowIso(now),
      checkoutManual: true
    };
    const created = this.queue("test", "", payload, now, connector.id);
    if (created !== 1) throw new Error("The connector test delivery could not be queued.");
    const delivery = this.db.get<DeliveryRow>(
      `${DELIVERY_SELECT}
       WHERE delivery.connector_id = ? AND delivery.event_type = 'test'
       ORDER BY delivery.created_at DESC LIMIT 1`,
      connector.id
    );
    if (!delivery) throw new Error("The connector test delivery could not be loaded.");
    return this.delivery(delivery);
  }

  listDeliveries(limit = 100): UserActionConnectorDelivery[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const scope = currentRequestScope();
    return this.db.all<DeliveryRow>(
      `${DELIVERY_SELECT}
       WHERE delivery.tenant_id = ? AND delivery.user_id = ?
       ORDER BY delivery.created_at DESC, delivery.id DESC LIMIT ?`,
      scope.tenantId, scope.userId, safeLimit
    ).map((row) => this.delivery(row));
  }

  leaseNext(now = Date.now()): UserActionConnectorLease | null {
    this.expireLeases(now);
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
             AND delivery.state IN ('pending', 'retry_wait')
             AND (delivery.next_attempt_at = '' OR delivery.next_attempt_at <= ?)
           ORDER BY delivery.created_at, delivery.id LIMIT 1`,
          scope.tenantId, scope.userId, nowIso(now)
        );
        if (!row) return null;
        const currentBinding = this.availableBindings[row.endpointReference] ?? "";
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

  complete(deliveryId: string, capabilityToken: string, now = Date.now()): UserActionConnectorDelivery {
    const row = this.requireLease(deliveryId, capabilityToken, now);
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE user_action_connector_deliveries
         SET state = 'delivered', lease_capability_hash = '', lease_expires_at = '',
             last_error_code = '', delivered_at = ?, updated_at = ? WHERE id = ?`,
        timestamp, timestamp, row.id
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
    now = Date.now()
  ): UserActionConnectorDelivery {
    const row = this.requireLease(deliveryId, capabilityToken, now);
    const errorCode = safeErrorCode(reason, "connector_delivery_failed");
    const attempts = Number(row.attemptCount);
    const retry = retryable && attempts < MAX_ATTEMPTS;
    const delaySeconds = Math.min(3_600, 30 * (2 ** Math.max(0, attempts - 1)));
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
    if (Buffer.byteLength(payloadJson, "utf8") > 4_000) throw new Error("The connector payload is too large.");
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
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', '', '', '', ?, ?)`,
        newId("user_connector_delivery"), scope.tenantId, scope.userId, connector.id,
        connector.endpointReference, connector.endpointBindingFingerprint,
        actionJobId || null, eventType, payloadJson, idempotency, timestamp, timestamp
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
        && this.availableBindings[row.endpointReference] === row.endpointBindingFingerprint,
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
    if (!row) throw new Error("The user action connector does not exist.");
    return row;
  }

  private requireDeliveryRow(id: string): DeliveryRow {
    const scope = currentRequestScope();
    const row = this.db.get<DeliveryRow>(
      `${DELIVERY_SELECT} WHERE delivery.id = ? AND delivery.tenant_id = ? AND delivery.user_id = ?`,
      id, scope.tenantId, scope.userId
    );
    if (!row) throw new Error("The user connector delivery does not exist.");
    return row;
  }

  private requireLease(id: string, token: string, now: number): DeliveryRow {
    const safeDeliveryId = safeId(id, DELIVERY_ID, "The user connector delivery");
    if (!CAPABILITY.test(token)) throw new Error("The user connector delivery capability is invalid.");
    const row = this.requireDeliveryRow(safeDeliveryId);
    if (row.state !== "leased" || row.leaseExpiresAt <= nowIso(now)
      || row.leaseCapabilityHash !== capabilityHash(row.id, token)) {
      throw new Error("The user connector delivery capability is invalid or expired.");
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
      MAX_ATTEMPTS, nowIso(now + 30_000), nowIso(now), scope.tenantId, scope.userId, nowIso(now)
    );
  }
}
