import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  OPERATOR_ALERT_CONNECTOR_REPLAY_REASON_CODES,
  OPERATOR_ALERT_CONNECTOR_KINDS,
  OPERATOR_ALERT_SEVERITIES,
  RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION,
  SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION,
  type OperatorAlertConnectorInput,
  type OperatorAlertConnectorKind,
  type OperatorAlertConnectorReplayInput,
  type OperatorAlertSeverity
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const CONNECTOR_KINDS = new Set<string>(OPERATOR_ALERT_CONNECTOR_KINDS);
const REPLAY_REASONS = new Set<string>(OPERATOR_ALERT_CONNECTOR_REPLAY_REASON_CODES);
const SEVERITIES = new Set<string>(OPERATOR_ALERT_SEVERITIES);
const ENDPOINT_REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{2,119}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const MAXIMUM_ATTEMPTS = 12;
const MAXIMUM_MANUAL_REPLAYS = 3;
const MAXIMUM_PAYLOAD_BYTES = 4_000;
const HEALTH_WINDOW_SECONDS = 86_400;
const DELIVERY_SLO_SECONDS = 300;
const CRITICAL_DELIVERY_AGE_SECONDS = 900;

export type OperatorAlertConnectorDeliveryEventType =
  | "queued"
  | "leased"
  | "delivered"
  | "retry_scheduled"
  | "dead_lettered"
  | "cancelled";

export interface OperatorAlertConnector {
  id: string;
  name: string;
  enabled: boolean;
  kind: OperatorAlertConnectorKind;
  endpointReference: string;
  minimumSeverity: OperatorAlertSeverity;
  runtimeBound: boolean;
  privacyClassification: "operational_configuration";
  createdAt: string;
  updatedAt: string;
}

export interface OperatorAlertConnectorPayload {
  contractVersion: 1;
  eventId: string;
  incidentId: string;
  eventType: string;
  severity: OperatorAlertSeverity;
  reasonCode: string;
  retailerId: string;
  operation: string;
  failureStage: string;
  layoutFingerprint: string;
  occurrenceCount: number;
  affectedEntityCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  emittedAt: string;
  privacyClassification: "operational_aggregate";
}

export interface OperatorAlertConnectorLease {
  id: string;
  connectorId: string;
  endpointReference: string;
  eventId: string;
  payload: OperatorAlertConnectorPayload;
  attempt: number;
  capabilityToken: string;
  leaseExpiresAt: string;
}

export interface OperatorAlertConnectorDispatchReceipt {
  id: string;
  connectorId: string;
  connectorName: string;
  eventId: string;
  eventType: string;
  deliveryState: "pending" | "leased" | "retry_wait" | "delivered" | "dead_letter" | "cancelled";
  attemptCount: number;
  lastErrorCode: string;
  lastHttpStatus: number;
  endpointReference: string;
  manualReplayCount: number;
  maximumManualReplays: number;
  replayEligible: boolean;
  replayIneligibilityReason:
    | ""
    | "delivery_not_dead_lettered"
    | "connector_disabled"
    | "connector_configuration_changed"
    | "connector_unbound"
    | "manual_replay_limit_reached";
  privacyClassification: "operational_aggregate";
  createdAt: string;
  updatedAt: string;
  deliveredAt: string;
}

export interface OperatorAlertConnectorHealth {
  connectorId: string;
  connectorName: string;
  enabled: boolean;
  runtimeBound: boolean;
  status: "disabled" | "unbound" | "idle" | "healthy" | "degraded" | "critical";
  activeDeliveries: number;
  unresolvedDeadLetters: number;
  deliveredInWindow: number;
  deadLetteredInWindow: number;
  retryEventsInWindow: number;
  deliverySuccessRatePercent: number | null;
  oldestActiveAt: string;
  oldestActiveAgeSeconds: number;
  lastDeliveredAt: string;
  lastDeadLetterAt: string;
  windowStartedAt: string;
  windowSeconds: number;
  deliverySloSeconds: number;
  privacyClassification: "operational_aggregate";
}

interface ConnectorRow {
  id: string;
  name: string;
  enabled: number;
  kind: OperatorAlertConnectorKind;
  endpointReference: string;
  endpointBindingFingerprint: string;
  minimumSeverity: OperatorAlertSeverity;
  privacyClassification: "operational_configuration";
  createdAt: string;
  updatedAt: string;
}

interface DeliveryRow {
  id: string;
  connectorId: string;
  endpointReference: string;
  endpointBindingFingerprint: string;
  eventId: string;
  payloadJson: string;
  payloadHash: string;
  state: OperatorAlertConnectorDispatchReceipt["deliveryState"];
  attemptCount: number;
  leaseCapabilityHash: string;
  leaseExpiresAt: string;
}

interface DeliveryReceiptRow {
  id: string;
  connectorId: string;
  connectorName: string;
  connectorEnabled: number;
  connectorEndpointReference: string;
  connectorBindingFingerprint: string;
  eventId: string;
  eventType: string;
  deliveryState: OperatorAlertConnectorDispatchReceipt["deliveryState"];
  attemptCount: number;
  lastErrorCode: string;
  lastHttpStatus: number;
  endpointReference: string;
  endpointBindingFingerprint: string;
  manualReplayCount: number;
  privacyClassification: "operational_aggregate";
  createdAt: string;
  updatedAt: string;
  deliveredAt: string;
}

interface ConnectorHealthAggregateRow {
  connectorId: string;
  activeDeliveries: number;
  unresolvedDeadLetters: number;
  oldestActiveAt: string;
}

interface ConnectorEventAggregateRow {
  connectorId: string;
  deliveredInWindow: number;
  deadLetteredInWindow: number;
  retryEventsInWindow: number;
  lastDeliveredAt: string;
  lastDeadLetterAt: string;
}

interface QueueAlertEvent {
  id: string;
  incidentId: string;
  eventType: string;
  severity: OperatorAlertSeverity;
  reasonCode: string;
  createdAt: string;
}

interface QueueAlertIncident {
  id: string;
  retailerId: string;
  operation: string;
  failureStage: string;
  layoutFingerprint: string;
  occurrenceCount: number;
  affectedEntityCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export class OperatorAlertConnectorError extends Error {
  constructor(
    readonly code:
      | "operator_alert_connector_input_invalid"
      | "operator_alert_connector_not_found"
      | "operator_alert_connector_state_conflict"
      | "operator_alert_connector_confirmation_required"
      | "operator_alert_connector_capability_invalid",
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "OperatorAlertConnectorError";
  }
}

const CONNECTOR_SELECT = `
  SELECT id, name, enabled, kind, endpoint_reference AS endpointReference,
         endpoint_binding_fingerprint AS endpointBindingFingerprint,
         minimum_severity AS minimumSeverity,
         privacy_classification AS privacyClassification,
         created_at AS createdAt, updated_at AS updatedAt
  FROM operator_alert_connectors`;

const DELIVERY_RECEIPT_SELECT = `
  SELECT d.id, d.connector_id AS connectorId, c.name AS connectorName,
         c.enabled AS connectorEnabled,
         c.endpoint_reference AS connectorEndpointReference,
         c.endpoint_binding_fingerprint AS connectorBindingFingerprint,
         d.event_id AS eventId, e.event_type AS eventType,
         d.state AS deliveryState, d.attempt_count AS attemptCount,
         d.last_error_code AS lastErrorCode, d.last_http_status AS lastHttpStatus,
         d.endpoint_reference AS endpointReference,
         d.endpoint_binding_fingerprint AS endpointBindingFingerprint,
         (SELECT COUNT(*) FROM operator_alert_connector_delivery_events replay_event
          WHERE replay_event.delivery_id = d.id
            AND replay_event.reason_code = 'operator_manual_replay') AS manualReplayCount,
         d.privacy_classification AS privacyClassification,
         d.created_at AS createdAt, d.updated_at AS updatedAt,
         d.delivered_at AS deliveredAt
  FROM operator_alert_connector_deliveries d
  JOIN operator_alert_connectors c ON c.id = d.connector_id
  JOIN operator_alert_events e ON e.id = d.event_id`;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function identifier(value: unknown, label: string): string {
  const normalized = cleanText(value, 120);
  if (!ID_PATTERN.test(normalized)) {
    throw new OperatorAlertConnectorError("operator_alert_connector_input_invalid", 400, `The ${label} is invalid.`);
  }
  return normalized;
}

function severityRank(severity: OperatorAlertSeverity): number {
  return OPERATOR_ALERT_SEVERITIES.indexOf(severity);
}

function connectorFromRow(row: ConnectorRow, availableBindings: Readonly<Record<string, string>>): OperatorAlertConnector {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    kind: row.kind,
    endpointReference: row.endpointReference,
    minimumSeverity: row.minimumSeverity,
    runtimeBound: Boolean(row.endpointBindingFingerprint)
      && availableBindings[row.endpointReference] === row.endpointBindingFingerprint,
    privacyClassification: row.privacyClassification,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function replayIneligibilityReason(
  row: DeliveryReceiptRow,
  availableBindings: Readonly<Record<string, string>>
): OperatorAlertConnectorDispatchReceipt["replayIneligibilityReason"] {
  if (row.deliveryState !== "dead_letter") return "delivery_not_dead_lettered";
  if (row.connectorEnabled !== 1) return "connector_disabled";
  if (row.connectorEndpointReference !== row.endpointReference
    || row.connectorBindingFingerprint !== row.endpointBindingFingerprint) {
    return "connector_configuration_changed";
  }
  if (!row.endpointBindingFingerprint
    || availableBindings[row.endpointReference] !== row.endpointBindingFingerprint) {
    return "connector_unbound";
  }
  if (Number(row.manualReplayCount) >= MAXIMUM_MANUAL_REPLAYS) return "manual_replay_limit_reached";
  return "";
}

function receiptFromRow(
  row: DeliveryReceiptRow,
  availableBindings: Readonly<Record<string, string>>
): OperatorAlertConnectorDispatchReceipt {
  const ineligibilityReason = replayIneligibilityReason(row, availableBindings);
  return {
    id: row.id,
    connectorId: row.connectorId,
    connectorName: row.connectorName,
    eventId: row.eventId,
    eventType: row.eventType,
    deliveryState: row.deliveryState,
    attemptCount: Number(row.attemptCount),
    lastErrorCode: row.lastErrorCode,
    lastHttpStatus: Number(row.lastHttpStatus),
    endpointReference: row.endpointReference,
    manualReplayCount: Number(row.manualReplayCount),
    maximumManualReplays: MAXIMUM_MANUAL_REPLAYS,
    replayEligible: ineligibilityReason === "",
    replayIneligibilityReason: ineligibilityReason,
    privacyClassification: row.privacyClassification,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deliveredAt: row.deliveredAt
  };
}

function capabilityHash(deliveryId: string, token: string): string {
  return stableHash("yoink_operator_alert_connector_capability_v1", deliveryId, token);
}

function safeErrorCode(value: unknown, fallback: string): string {
  return cleanText(value, 80).toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_:-]/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function safeHttpStatus(value: unknown): number {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}

function allowedWorker(): void {
  if (!["service", "maintainer"].includes(currentRequestScope().actorKind)) {
    throw new OperatorAlertConnectorError("operator_alert_connector_state_conflict", 409, "A trusted alert connector worker scope is required.");
  }
}

export class OperatorAlertConnectorRepository {
  private readonly audit: AuditRepository;
  private readonly authorization: AuthorizationRepository;
  private readonly availableBindings: Readonly<Record<string, string>>;

  constructor(private readonly db: YoinkDatabase, availableBindings: Readonly<Record<string, string>> = {}) {
    this.audit = new AuditRepository(db);
    this.authorization = new AuthorizationRepository(db);
    this.availableBindings = { ...availableBindings };
  }

  list(): OperatorAlertConnector[] {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    return this.db.all<ConnectorRow>(
      `${CONNECTOR_SELECT} WHERE tenant_id = ? ORDER BY name, id`,
      scope.tenantId
    ).map((row) => connectorFromRow(row, this.availableBindings));
  }

  save(input: OperatorAlertConnectorInput, id = "", now = Date.now()): OperatorAlertConnector {
    this.authorization.require("alert.manage");
    if (input?.confirmation !== SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION) {
      throw new OperatorAlertConnectorError(
        "operator_alert_connector_confirmation_required",
        400,
        "Explicit operator alert connector confirmation is required."
      );
    }
    const scope = currentRequestScope();
    const name = cleanText(input.name, 120);
    if (name.length < 3 || typeof input.enabled !== "boolean" || !CONNECTOR_KINDS.has(input.kind)
      || !SEVERITIES.has(input.minimumSeverity)) {
      throw new OperatorAlertConnectorError("operator_alert_connector_input_invalid", 400, "The connector name, enabled state, kind, or minimum severity is invalid.");
    }
    const endpointReference = cleanText(input.endpointReference, 120);
    if (!ENDPOINT_REFERENCE_PATTERN.test(endpointReference)) {
      throw new OperatorAlertConnectorError("operator_alert_connector_input_invalid", 400, "A bounded deployment-owned endpoint reference is required.");
    }
    const endpointBindingFingerprint = this.availableBindings[endpointReference] ?? "";
    const connectorId = id ? identifier(id, "operator alert connector ID") : newId("alert_connector");
    const existing = id
      ? this.db.get<ConnectorRow>(`${CONNECTOR_SELECT} WHERE tenant_id = ? AND id = ?`, scope.tenantId, connectorId)
      : undefined;
    if (id && !existing) {
      throw new OperatorAlertConnectorError("operator_alert_connector_not_found", 404, "The operator alert connector does not exist in this tenant.");
    }
    const duplicate = this.db.get<{ id: string }>(
      "SELECT id FROM operator_alert_connectors WHERE tenant_id = ? AND name = ? COLLATE NOCASE AND id != ?",
      scope.tenantId,
      name,
      connectorId
    );
    if (duplicate) {
      throw new OperatorAlertConnectorError("operator_alert_connector_state_conflict", 409, "An operator alert connector with this name already exists.");
    }
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      if (existing) {
        const destinationChanged = existing.endpointReference !== endpointReference
          || existing.endpointBindingFingerprint !== endpointBindingFingerprint
          || existing.kind !== input.kind
          || existing.minimumSeverity !== input.minimumSeverity;
        if (!input.enabled || destinationChanged) this.cancelOutstanding(connectorId, "connector_configuration_changed", now);
        this.db.run(
          `UPDATE operator_alert_connectors SET name = ?, enabled = ?, kind = ?, endpoint_reference = ?,
             endpoint_binding_fingerprint = ?, minimum_severity = ?, updated_by_actor_id = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`,
          name,
          input.enabled ? 1 : 0,
          input.kind,
          endpointReference,
          endpointBindingFingerprint,
          input.minimumSeverity,
          scope.actorId,
          timestamp,
          scope.tenantId,
          connectorId
        );
      } else {
        this.db.run(
          `INSERT INTO operator_alert_connectors(
             id, tenant_id, name, enabled, kind, endpoint_reference, endpoint_binding_fingerprint, minimum_severity,
             privacy_classification, created_by_actor_id, updated_by_actor_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'operational_configuration', ?, ?, ?, ?)`,
          connectorId,
          scope.tenantId,
          name,
          input.enabled ? 1 : 0,
          input.kind,
          endpointReference,
          endpointBindingFingerprint,
          input.minimumSeverity,
          scope.actorId,
          scope.actorId,
          timestamp,
          timestamp
        );
      }
      this.audit.record({
        correlationId: connectorId,
        aggregateType: "operator_alert_connector",
        eventType: existing ? "operator_alert_connector_updated" : "operator_alert_connector_created",
        reasonCode: input.enabled ? "connector_enabled" : "connector_disabled",
        message: existing ? "An operator alert connector was updated." : "An operator alert connector was created.",
        data: {
          connectorId,
          kind: input.kind,
          enabled: input.enabled,
          endpointReferenceHash: stableHash("yoink_operator_alert_endpoint_reference_v1", endpointReference),
          minimumSeverity: input.minimumSeverity,
          runtimeBound: Boolean(endpointBindingFingerprint),
          rawEndpointStored: false,
          signingSecretStored: false
        }
      }, now);
    });
    return connectorFromRow(
      this.db.get<ConnectorRow>(`${CONNECTOR_SELECT} WHERE tenant_id = ? AND id = ?`, scope.tenantId, connectorId) as ConnectorRow,
      this.availableBindings
    );
  }

  queue(event: QueueAlertEvent, incident: QueueAlertIncident, now = Date.now()): number {
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const connectors = this.db.all<ConnectorRow>(
      `${CONNECTOR_SELECT} WHERE tenant_id = ? AND enabled = 1 ORDER BY id`,
      scope.tenantId
    ).filter((connector) => severityRank(event.severity) >= severityRank(connector.minimumSeverity));
    let queued = 0;
    for (const connector of connectors) {
      const payload: OperatorAlertConnectorPayload = {
        contractVersion: 1,
        eventId: event.id,
        incidentId: event.incidentId,
        eventType: event.eventType,
        severity: event.severity,
        reasonCode: cleanText(event.reasonCode, 80),
        retailerId: cleanText(incident.retailerId, 40),
        operation: cleanText(incident.operation, 40),
        failureStage: cleanText(incident.failureStage, 80),
        layoutFingerprint: /^[a-f0-9]{64}$/.test(incident.layoutFingerprint) ? incident.layoutFingerprint : "",
        occurrenceCount: Math.max(1, Math.floor(Number(incident.occurrenceCount) || 1)),
        affectedEntityCount: Math.max(1, Math.floor(Number(incident.affectedEntityCount) || 1)),
        firstSeenAt: incident.firstSeenAt,
        lastSeenAt: incident.lastSeenAt,
        emittedAt: event.createdAt || timestamp,
        privacyClassification: "operational_aggregate"
      };
      const payloadJson = stableJson(payload);
      if (Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_PAYLOAD_BYTES) {
        throw new OperatorAlertConnectorError("operator_alert_connector_state_conflict", 409, "The bounded operator alert connector payload is too large.");
      }
      const deliveryId = newId("alert_connector_delivery");
      const inserted = this.db.run(
        `INSERT OR IGNORE INTO operator_alert_connector_deliveries(
           id, tenant_id, connector_id, incident_id, event_id, endpoint_reference, endpoint_binding_fingerprint,
           payload_json, payload_hash, idempotency_key_hash, state,
           privacy_classification, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'operational_aggregate', ?, ?)`,
        deliveryId,
        scope.tenantId,
        connector.id,
        incident.id,
        event.id,
        connector.endpointReference,
        connector.endpointBindingFingerprint,
        payloadJson,
        stableHash("yoink_operator_alert_connector_payload_v1", payloadJson),
        stableHash("yoink_operator_alert_connector_idempotency_v1", scope.tenantId, connector.id, event.id),
        timestamp,
        timestamp
      );
      if (Number(inserted.changes) !== 1) continue;
      this.recordEvent(deliveryId, "queued", 0, "alert_event_routed", 0, now);
      queued += 1;
    }
    return queued;
  }

  expireExhaustedLeases(
    availableBindings: Readonly<Record<string, string>>,
    now = Date.now()
  ): number {
    allowedWorker();
    const bindings = Object.entries(availableBindings)
      .filter(([reference, fingerprint]) => ENDPOINT_REFERENCE_PATTERN.test(reference) && /^[a-f0-9]{64}$/.test(fingerprint))
      .slice(0, 20);
    if (!bindings.length) return 0;
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const bindingPredicate = bindings.map(() => "(d.endpoint_reference = ? AND d.endpoint_binding_fingerprint = ?)").join(" OR ");
    const bindingParameters = bindings.flatMap(([reference, fingerprint]) => [reference, fingerprint]);
    return this.db.transaction(() => {
      const exhausted = this.db.all<{ id: string; attemptCount: number }>(
        `SELECT d.id, d.attempt_count AS attemptCount
         FROM operator_alert_connector_deliveries d
         JOIN operator_alert_connectors c ON c.id = d.connector_id
         WHERE d.tenant_id = ? AND c.enabled = 1 AND (${bindingPredicate})
           AND d.state = 'leased' AND d.attempt_count >= ? AND d.lease_expires_at <= ?
         ORDER BY d.created_at, d.id LIMIT 20`,
        scope.tenantId,
        ...bindingParameters,
        MAXIMUM_ATTEMPTS,
        timestamp
      );
      let recovered = 0;
      for (const delivery of exhausted) {
        const updated = this.db.run(
          `UPDATE operator_alert_connector_deliveries SET state = 'dead_letter',
             lease_capability_hash = '', lease_expires_at = '', next_attempt_at = '',
             last_error_code = 'lease_attempts_exhausted', last_http_status = 0, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND state = 'leased'
             AND attempt_count >= ? AND lease_expires_at <= ?`,
          timestamp,
          delivery.id,
          scope.tenantId,
          MAXIMUM_ATTEMPTS,
          timestamp
        );
        if (Number(updated.changes) !== 1) continue;
        this.recordEvent(
          delivery.id,
          "dead_lettered",
          Number(delivery.attemptCount),
          "lease_attempts_exhausted",
          0,
          now
        );
        recovered += 1;
      }
      return recovered;
    });
  }

  leaseNext(availableBindings: Readonly<Record<string, string>>, leaseSeconds = 60, now = Date.now()): OperatorAlertConnectorLease | null {
    allowedWorker();
    const bindings = Object.entries(availableBindings)
      .filter(([reference, fingerprint]) => ENDPOINT_REFERENCE_PATTERN.test(reference) && /^[a-f0-9]{64}$/.test(fingerprint))
      .slice(0, 20);
    if (!bindings.length) return null;
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const safeLeaseSeconds = Math.max(15, Math.min(300, Math.floor(Number(leaseSeconds) || 60)));
    const leaseExpiresAt = nowIso(now + safeLeaseSeconds * 1_000);
    const bindingPredicate = bindings.map(() => "(d.endpoint_reference = ? AND d.endpoint_binding_fingerprint = ?)").join(" OR ");
    const bindingParameters = bindings.flatMap(([reference, fingerprint]) => [reference, fingerprint]);
    return this.db.transaction(() => {
      const candidate = this.db.get<DeliveryRow>(
        `SELECT d.id, d.connector_id AS connectorId, d.endpoint_reference AS endpointReference,
                d.endpoint_binding_fingerprint AS endpointBindingFingerprint,
                d.event_id AS eventId, d.payload_json AS payloadJson, d.payload_hash AS payloadHash,
                d.state, d.attempt_count AS attemptCount,
                d.lease_capability_hash AS leaseCapabilityHash, d.lease_expires_at AS leaseExpiresAt
         FROM operator_alert_connector_deliveries d
         JOIN operator_alert_connectors c ON c.id = d.connector_id
         WHERE d.tenant_id = ? AND c.enabled = 1 AND (${bindingPredicate})
           AND d.attempt_count < ?
           AND ((d.state IN ('pending', 'retry_wait') AND (d.next_attempt_at = '' OR d.next_attempt_at <= ?))
             OR (d.state = 'leased' AND d.lease_expires_at <= ?))
         ORDER BY d.created_at, d.id LIMIT 1`,
        scope.tenantId,
        ...bindingParameters,
        MAXIMUM_ATTEMPTS,
        timestamp,
        timestamp
      );
      if (!candidate) return null;
      if (stableHash("yoink_operator_alert_connector_payload_v1", candidate.payloadJson) !== candidate.payloadHash) {
        throw new OperatorAlertConnectorError("operator_alert_connector_state_conflict", 409, "The operator alert connector payload fingerprint is invalid.");
      }
      const capabilityToken = randomBytes(32).toString("base64url");
      const attempt = Number(candidate.attemptCount) + 1;
      const updated = this.db.run(
        `UPDATE operator_alert_connector_deliveries SET state = 'leased', attempt_count = ?,
           lease_capability_hash = ?, lease_expires_at = ?, next_attempt_at = '',
           last_error_code = '', last_http_status = 0, updated_at = ?
         WHERE id = ? AND tenant_id = ?
           AND ((state IN ('pending', 'retry_wait') AND (next_attempt_at = '' OR next_attempt_at <= ?))
             OR (state = 'leased' AND lease_expires_at <= ?))`,
        attempt,
        capabilityHash(candidate.id, capabilityToken),
        leaseExpiresAt,
        timestamp,
        candidate.id,
        scope.tenantId,
        timestamp,
        timestamp
      );
      if (Number(updated.changes) !== 1) return null;
      if (candidate.state === "leased") {
        this.recordEvent(candidate.id, "retry_scheduled", Number(candidate.attemptCount), "lease_expired", 0, now);
      }
      this.recordEvent(candidate.id, "leased", attempt, "worker_lease", 0, now);
      return {
        id: candidate.id,
        connectorId: candidate.connectorId,
        endpointReference: candidate.endpointReference,
        eventId: candidate.eventId,
        payload: JSON.parse(candidate.payloadJson) as OperatorAlertConnectorPayload,
        attempt,
        capabilityToken,
        leaseExpiresAt
      };
    });
  }

  complete(id: string, capabilityToken: string, reasonCode: string, httpStatus: number, now = Date.now()): boolean {
    allowedWorker();
    const deliveryId = identifier(id, "operator alert connector delivery ID");
    const delivery = this.assertCapability(deliveryId, capabilityToken, now);
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const status = safeHttpStatus(httpStatus);
    if (status < 200 || status > 299) {
      throw new OperatorAlertConnectorError(
        "operator_alert_connector_state_conflict",
        409,
        "Only an accepted HTTP response can complete an operator alert connector delivery."
      );
    }
    return this.db.transaction(() => {
      const result = this.db.run(
        `UPDATE operator_alert_connector_deliveries SET state = 'delivered',
           lease_capability_hash = '', lease_expires_at = '', next_attempt_at = '',
           last_error_code = '', last_http_status = ?, delivered_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND state = 'leased'`,
        status,
        timestamp,
        timestamp,
        deliveryId,
        scope.tenantId
      );
      if (Number(result.changes) !== 1) return false;
      this.recordEvent(deliveryId, "delivered", delivery.attemptCount, safeErrorCode(reasonCode, "webhook_accepted"), status, now);
      return true;
    });
  }

  fail(
    id: string,
    capabilityToken: string,
    reasonCode: string,
    httpStatus: number,
    retryAfterSeconds: number,
    permanent: boolean,
    now = Date.now()
  ): "retry" | "dead_letter" {
    allowedWorker();
    const deliveryId = identifier(id, "operator alert connector delivery ID");
    const delivery = this.assertCapability(deliveryId, capabilityToken, now);
    const scope = currentRequestScope();
    const deadLetter = permanent || delivery.attemptCount >= MAXIMUM_ATTEMPTS;
    const timestamp = nowIso(now);
    const retrySeconds = Math.max(1, Math.min(86_400, Math.floor(Number(retryAfterSeconds) || 30)));
    const nextAttemptAt = deadLetter ? "" : nowIso(now + retrySeconds * 1_000);
    const error = safeErrorCode(reasonCode, "webhook_delivery_failed");
    this.db.transaction(() => {
      this.db.run(
        `UPDATE operator_alert_connector_deliveries SET state = ?,
           lease_capability_hash = '', lease_expires_at = '', next_attempt_at = ?,
           last_error_code = ?, last_http_status = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND state = 'leased'`,
        deadLetter ? "dead_letter" : "retry_wait",
        nextAttemptAt,
        error,
        safeHttpStatus(httpStatus),
        timestamp,
        deliveryId,
        scope.tenantId
      );
      this.recordEvent(
        deliveryId,
        deadLetter ? "dead_lettered" : "retry_scheduled",
        delivery.attemptCount,
        error,
        safeHttpStatus(httpStatus),
        now
      );
    });
    return deadLetter ? "dead_letter" : "retry";
  }

  replayDeadLetter(
    id: string,
    input: OperatorAlertConnectorReplayInput,
    correlationId: string,
    now = Date.now()
  ): OperatorAlertConnectorDispatchReceipt {
    this.authorization.require("alert.manage");
    if (input?.confirmation !== RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION) {
      throw new OperatorAlertConnectorError(
        "operator_alert_connector_confirmation_required",
        400,
        "Explicit operator alert connector replay confirmation is required."
      );
    }
    const inputKeys = Object.keys(input as unknown as Record<string, unknown>).sort();
    if (inputKeys.join(",") !== "confirmation,reasonCode" || !REPLAY_REASONS.has(input.reasonCode)) {
      throw new OperatorAlertConnectorError(
        "operator_alert_connector_input_invalid",
        400,
        "A supported operator alert connector replay reason is required."
      );
    }
    const deliveryId = identifier(id, "operator alert connector delivery ID");
    const scope = currentRequestScope();
    const row = this.db.get<DeliveryReceiptRow>(
      `${DELIVERY_RECEIPT_SELECT} WHERE d.tenant_id = ? AND d.id = ?`,
      scope.tenantId,
      deliveryId
    );
    if (!row) {
      throw new OperatorAlertConnectorError(
        "operator_alert_connector_not_found",
        404,
        "The operator alert connector delivery does not exist in this tenant."
      );
    }
    if (replayIneligibilityReason(row, this.availableBindings) !== "") {
      throw new OperatorAlertConnectorError(
        "operator_alert_connector_state_conflict",
        409,
        "The operator alert connector delivery is not currently eligible for replay."
      );
    }
    const timestamp = nowIso(now);
    const safeCorrelationId = cleanText(correlationId, 120) || newId("alert_connector_replay");
    this.db.transaction(() => {
      const updated = this.db.run(
        `UPDATE operator_alert_connector_deliveries SET state = 'pending', attempt_count = 0,
           lease_capability_hash = '', lease_expires_at = '', next_attempt_at = '',
           last_error_code = '', last_http_status = 0, delivered_at = '', updated_at = ?
         WHERE id = ? AND tenant_id = ? AND state = 'dead_letter'`,
        timestamp,
        deliveryId,
        scope.tenantId
      );
      if (Number(updated.changes) !== 1) {
        throw new OperatorAlertConnectorError(
          "operator_alert_connector_state_conflict",
          409,
          "The operator alert connector delivery changed before replay could be scheduled."
        );
      }
      this.recordEvent(deliveryId, "retry_scheduled", Number(row.attemptCount), "operator_manual_replay", 0, now);
      this.audit.record({
        correlationId: safeCorrelationId,
        aggregateType: "operator_alert_connector_delivery",
        eventType: "operator_alert_connector_delivery_replayed",
        reasonCode: input.reasonCode,
        message: "A dead-letter operator alert connector delivery was scheduled for bounded replay.",
        data: {
          deliveryId,
          connectorId: row.connectorId,
          eventId: row.eventId,
          replayNumber: Number(row.manualReplayCount) + 1,
          maximumManualReplays: MAXIMUM_MANUAL_REPLAYS,
          deliveryIdentityReused: true,
          payloadChanged: false,
          endpointRetargeted: false,
          mutationAuthority: false
        }
      }, now);
    });
    const replayed = this.db.get<DeliveryReceiptRow>(
      `${DELIVERY_RECEIPT_SELECT} WHERE d.tenant_id = ? AND d.id = ?`,
      scope.tenantId,
      deliveryId
    );
    if (!replayed) {
      throw new OperatorAlertConnectorError(
        "operator_alert_connector_state_conflict",
        409,
        "The replayed operator alert connector delivery could not be read."
      );
    }
    return receiptFromRow(replayed, this.availableBindings);
  }

  receipts(limit = 200): OperatorAlertConnectorDispatchReceipt[] {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)));
    return this.db.all<DeliveryReceiptRow>(
      `${DELIVERY_RECEIPT_SELECT}
       WHERE d.tenant_id = ? ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
      scope.tenantId,
      safeLimit
    ).map((row) => receiptFromRow(row, this.availableBindings));
  }

  health(now = Date.now()): OperatorAlertConnectorHealth[] {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    const windowStartedAt = nowIso(now - HEALTH_WINDOW_SECONDS * 1_000);
    const connectors = this.db.all<ConnectorRow>(
      `${CONNECTOR_SELECT} WHERE tenant_id = ? ORDER BY name, id`,
      scope.tenantId
    );
    const deliveryRows = this.db.all<ConnectorHealthAggregateRow>(
      `SELECT connector_id AS connectorId,
              COALESCE(SUM(state IN ('pending', 'leased', 'retry_wait')), 0) AS activeDeliveries,
              COALESCE(SUM(state = 'dead_letter'), 0) AS unresolvedDeadLetters,
              COALESCE(MIN(CASE WHEN state IN ('pending', 'leased', 'retry_wait') THEN created_at END), '') AS oldestActiveAt
       FROM operator_alert_connector_deliveries
       WHERE tenant_id = ? GROUP BY connector_id`,
      scope.tenantId
    );
    const eventRows = this.db.all<ConnectorEventAggregateRow>(
      `SELECT d.connector_id AS connectorId,
              COALESCE(SUM(event.event_type = 'delivered'), 0) AS deliveredInWindow,
              COALESCE(SUM(event.event_type = 'dead_lettered'), 0) AS deadLetteredInWindow,
              COALESCE(SUM(event.event_type = 'retry_scheduled'
                AND event.reason_code <> 'operator_manual_replay'), 0) AS retryEventsInWindow,
              COALESCE(MAX(CASE WHEN event.event_type = 'delivered' THEN event.created_at END), '') AS lastDeliveredAt,
              COALESCE(MAX(CASE WHEN event.event_type = 'dead_lettered' THEN event.created_at END), '') AS lastDeadLetterAt
       FROM operator_alert_connector_delivery_events event
       JOIN operator_alert_connector_deliveries d ON d.id = event.delivery_id
       WHERE event.tenant_id = ? AND event.created_at >= ?
       GROUP BY d.connector_id`,
      scope.tenantId,
      windowStartedAt
    );
    const deliveriesByConnector = new Map(deliveryRows.map((row) => [row.connectorId, row]));
    const eventsByConnector = new Map(eventRows.map((row) => [row.connectorId, row]));
    return connectors.map((row) => {
      const connector = connectorFromRow(row, this.availableBindings);
      const aggregate = deliveriesByConnector.get(row.id);
      const eventAggregate = eventsByConnector.get(row.id);
      const activeDeliveries = Number(aggregate?.activeDeliveries ?? 0);
      const unresolvedDeadLetters = Number(aggregate?.unresolvedDeadLetters ?? 0);
      const deliveredInWindow = Number(eventAggregate?.deliveredInWindow ?? 0);
      const deadLetteredInWindow = Number(eventAggregate?.deadLetteredInWindow ?? 0);
      const retryEventsInWindow = Number(eventAggregate?.retryEventsInWindow ?? 0);
      const oldestActiveAt = aggregate?.oldestActiveAt ?? "";
      const oldestActiveMs = Date.parse(oldestActiveAt);
      const oldestActiveAgeSeconds = Number.isFinite(oldestActiveMs)
        ? Math.max(0, Math.floor((now - oldestActiveMs) / 1_000))
        : 0;
      const outcomes = deliveredInWindow + deadLetteredInWindow;
      const deliverySuccessRatePercent = outcomes
        ? Math.round((deliveredInWindow / outcomes) * 10_000) / 100
        : null;
      let status: OperatorAlertConnectorHealth["status"];
      if (!connector.enabled) status = "disabled";
      else if (!connector.runtimeBound) status = "unbound";
      else if (unresolvedDeadLetters > 0 || oldestActiveAgeSeconds > CRITICAL_DELIVERY_AGE_SECONDS) status = "critical";
      else if (deadLetteredInWindow > 0 || retryEventsInWindow > 0
        || oldestActiveAgeSeconds > DELIVERY_SLO_SECONDS) status = "degraded";
      else if (activeDeliveries > 0 || deliveredInWindow > 0) status = "healthy";
      else status = "idle";
      return {
        connectorId: row.id,
        connectorName: row.name,
        enabled: connector.enabled,
        runtimeBound: connector.runtimeBound,
        status,
        activeDeliveries,
        unresolvedDeadLetters,
        deliveredInWindow,
        deadLetteredInWindow,
        retryEventsInWindow,
        deliverySuccessRatePercent,
        oldestActiveAt,
        oldestActiveAgeSeconds,
        lastDeliveredAt: eventAggregate?.lastDeliveredAt ?? "",
        lastDeadLetterAt: eventAggregate?.lastDeadLetterAt ?? "",
        windowStartedAt,
        windowSeconds: HEALTH_WINDOW_SECONDS,
        deliverySloSeconds: DELIVERY_SLO_SECONDS,
        privacyClassification: "operational_aggregate" as const
      };
    });
  }

  counts(now = Date.now()): {
    operatorAlertConnectors: number;
    enabledOperatorAlertConnectors: number;
    boundOperatorAlertConnectors: number;
    idleOperatorAlertConnectors: number;
    healthyOperatorAlertConnectors: number;
    degradedOperatorAlertConnectors: number;
    criticalOperatorAlertConnectors: number;
    unboundOperatorAlertConnectors: number;
    pendingOperatorAlertConnectorDeliveries: number;
    deliveredOperatorAlertConnectorDeliveries: number;
    deadLetterOperatorAlertConnectorDeliveries: number;
  } {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    const connectors = this.db.all<{ endpointReference: string; endpointBindingFingerprint: string; enabled: number }>(
      `SELECT endpoint_reference AS endpointReference,
              endpoint_binding_fingerprint AS endpointBindingFingerprint, enabled
       FROM operator_alert_connectors WHERE tenant_id = ?`,
      scope.tenantId
    );
    const deliveries = this.db.get<{ pending: number; delivered: number; deadLetter: number }>(
      `SELECT SUM(state IN ('pending', 'leased', 'retry_wait')) AS pending,
              SUM(state = 'delivered') AS delivered,
              SUM(state = 'dead_letter') AS deadLetter
       FROM operator_alert_connector_deliveries WHERE tenant_id = ?`,
      scope.tenantId
    );
    const health = this.health(now);
    return {
      operatorAlertConnectors: connectors.length,
      enabledOperatorAlertConnectors: connectors.filter((item) => item.enabled === 1).length,
      boundOperatorAlertConnectors: connectors.filter((item) => item.enabled === 1
        && Boolean(item.endpointBindingFingerprint)
        && this.availableBindings[item.endpointReference] === item.endpointBindingFingerprint).length,
      idleOperatorAlertConnectors: health.filter((item) => item.status === "idle").length,
      healthyOperatorAlertConnectors: health.filter((item) => item.status === "healthy").length,
      degradedOperatorAlertConnectors: health.filter((item) => item.status === "degraded").length,
      criticalOperatorAlertConnectors: health.filter((item) => item.status === "critical").length,
      unboundOperatorAlertConnectors: health.filter((item) => item.status === "unbound").length,
      pendingOperatorAlertConnectorDeliveries: Number(deliveries?.pending ?? 0),
      deliveredOperatorAlertConnectorDeliveries: Number(deliveries?.delivered ?? 0),
      deadLetterOperatorAlertConnectorDeliveries: Number(deliveries?.deadLetter ?? 0)
    };
  }

  snapshot(now = Date.now()): Record<string, unknown> {
    return {
      destinationsDeploymentOwned: true,
      rawEndpointsStored: false,
      signingSecretsStored: false,
      mutationAuthority: false,
      governedManualReplay: true,
      replayRetainsDeliveryIdentity: true,
      maximumManualReplays: MAXIMUM_MANUAL_REPLAYS,
      deliverySloSeconds: DELIVERY_SLO_SECONDS,
      healthWindowSeconds: HEALTH_WINDOW_SECONDS,
      registryReferences: Object.keys(this.availableBindings).sort(),
      counts: this.counts(now),
      connectors: this.list(),
      health: this.health(now),
      deliveries: this.receipts(200)
    };
  }

  private cancelOutstanding(connectorId: string, reasonCode: string, now: number): void {
    const scope = currentRequestScope();
    const outstanding = this.db.all<{ id: string; attemptCount: number }>(
      `SELECT id, attempt_count AS attemptCount FROM operator_alert_connector_deliveries
       WHERE tenant_id = ? AND connector_id = ? AND state IN ('pending', 'leased', 'retry_wait')
       ORDER BY created_at, id`,
      scope.tenantId,
      connectorId
    );
    for (const delivery of outstanding) {
      this.db.run(
        `UPDATE operator_alert_connector_deliveries SET state = 'cancelled',
           lease_capability_hash = '', lease_expires_at = '', next_attempt_at = '',
           last_error_code = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND state IN ('pending', 'leased', 'retry_wait')`,
        safeErrorCode(reasonCode, "connector_cancelled"),
        nowIso(now),
        delivery.id,
        scope.tenantId
      );
      this.recordEvent(delivery.id, "cancelled", Number(delivery.attemptCount), safeErrorCode(reasonCode, "connector_cancelled"), 0, now);
    }
  }

  private assertCapability(deliveryId: string, capabilityToken: string, now: number): { attemptCount: number } {
    const scope = currentRequestScope();
    const token = String(capabilityToken ?? "");
    const row = this.db.get<{ attemptCount: number; leaseCapabilityHash: string; leaseExpiresAt: string }>(
      `SELECT attempt_count AS attemptCount, lease_capability_hash AS leaseCapabilityHash,
              lease_expires_at AS leaseExpiresAt
       FROM operator_alert_connector_deliveries
       WHERE id = ? AND tenant_id = ? AND state = 'leased'`,
      deliveryId,
      scope.tenantId
    );
    const actual = row?.leaseCapabilityHash ?? "";
    const expected = capabilityHash(deliveryId, token);
    const valid = actual.length === expected.length
      && actual.length > 0
      && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
      && new Date(row?.leaseExpiresAt ?? "").getTime() > now;
    if (!valid) {
      throw new OperatorAlertConnectorError(
        "operator_alert_connector_capability_invalid",
        409,
        "The operator alert connector delivery capability is invalid or expired."
      );
    }
    return { attemptCount: Number(row?.attemptCount ?? 0) };
  }

  private recordEvent(
    deliveryId: string,
    eventType: OperatorAlertConnectorDeliveryEventType,
    attempt: number,
    reasonCode: string,
    httpStatus: number,
    now: number
  ): void {
    const scope = currentRequestScope();
    const sequence = Number(this.db.get<{ sequence: number }>(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM operator_alert_connector_delivery_events WHERE delivery_id = ?",
      deliveryId
    )?.sequence ?? 1);
    this.db.run(
      `INSERT INTO operator_alert_connector_delivery_events(
         id, tenant_id, delivery_id, sequence, event_type, attempt, reason_code,
         http_status, privacy_classification, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'operational_aggregate', ?)`,
      newId("alert_connector_event"),
      scope.tenantId,
      deliveryId,
      sequence,
      eventType,
      attempt,
      safeErrorCode(reasonCode, "connector_event"),
      safeHttpStatus(httpStatus),
      nowIso(now)
    );
  }
}
