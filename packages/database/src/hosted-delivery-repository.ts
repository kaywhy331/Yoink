import { randomBytes, timingSafeEqual } from "node:crypto";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { sanitizeDiagnosticData } from "../../domain/src/redaction.js";
import { AuditRepository } from "./audit-repository.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const MAX_DELIVERY_ATTEMPTS = 20;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/;

export interface HostedInboxInput {
  source: string;
  messageKey: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface HostedInboxReceipt {
  id: string;
  disposition: "accepted" | "deduped";
  state: "accepted" | "processing" | "processed" | "failed" | "dead_letter";
  payloadHash: string;
  receivedAt: string;
}

export interface HostedInboxLease {
  id: string;
  source: string;
  messageKey: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempt: number;
  leaseExpiresAt: string;
  capabilityToken: string;
}

export interface HostedOutboxLease {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempt: number;
  createdAt: string;
  leaseExpiresAt: string;
  capabilityToken: string;
}

export interface HostedInboxEventCounts {
  eventType: string;
  accepted: number;
  processing: number;
  failed: number;
  processed: number;
  deadLetter: number;
  total: number;
}

export interface HostedInboxDeadLetter {
  id: string;
  eventType: string;
  attempt: number;
  lastErrorCode: string;
  receivedAt: string;
  updatedAt: string;
  privacyClassification: "operational_aggregate";
}

export class HostedDeliveryError extends Error {
  constructor(
    readonly code: "hosted_inbox_not_found" | "hosted_inbox_state_conflict",
    readonly status: 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "HostedDeliveryError";
  }
}

function deliveryIdentifier(value: unknown, label: string): string {
  const normalized = cleanText(value, 160);
  if (!IDENTIFIER_PATTERN.test(normalized)) throw new Error(`A valid ${label} is required.`);
  return normalized;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function normalizedPayload(payload: unknown): { value: Record<string, unknown>; json: string; hash: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("A delivery payload object is required.");
  const value = sanitizeDiagnosticData(payload) as Record<string, unknown>;
  const json = stableJson(value);
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("The sanitized delivery payload is too large.");
  return { value, json, hash: stableHash("hosted_delivery_payload_v1", json) };
}

function parsedPayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function capabilityHash(messageId: string, token: string): string {
  return stableHash("hosted_delivery_capability_v1", messageId, token);
}

function allowedWorker(authorization: AuthorizationRepository): void {
  const scope = currentRequestScope();
  if (scope.actorKind === "service") {
    authorization.require("internal.delivery");
    return;
  }
  if (scope.actorKind !== "maintainer") {
    throw new Error("A trusted delivery worker scope is required.");
  }
}

function allowedIngress(authorization: AuthorizationRepository): void {
  const scope = currentRequestScope();
  if (scope.actorKind === "service") {
    authorization.require("internal.delivery");
    return;
  }
  if (!["device", "maintainer"].includes(scope.actorKind)) {
    throw new Error("A trusted delivery ingress scope is required.");
  }
}

function safeSeconds(value: number, fallback: number, minimum: number, maximum: number): number {
  const numeric = Math.floor(Number(value));
  return Number.isSafeInteger(numeric) && numeric >= minimum && numeric <= maximum ? numeric : fallback;
}

export class HostedDeliveryRepository {
  private readonly audit: AuditRepository;
  private readonly authorization: AuthorizationRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
    this.authorization = new AuthorizationRepository(db);
  }

  acceptInbox(input: HostedInboxInput, now = Date.now()): HostedInboxReceipt {
    allowedIngress(this.authorization);
    const scope = currentRequestScope();
    const source = deliveryIdentifier(input.source, "inbox source").toLocaleLowerCase("en-US");
    const messageKey = deliveryIdentifier(input.messageKey, "idempotency message key");
    const eventType = deliveryIdentifier(input.eventType, "event type").toLocaleLowerCase("en-US");
    const payload = normalizedPayload(input.payload);
    const existing = this.db.get<{
      id: string;
      eventType: string;
      payloadHash: string;
      state: HostedInboxReceipt["state"];
      receivedAt: string;
      deliveryAttempts: number;
    }>(
      `SELECT id, event_type AS eventType, payload_hash AS payloadHash, state,
              received_at AS receivedAt, delivery_attempts AS deliveryAttempts
       FROM inbox_messages
       WHERE tenant_id = ? AND user_id = ? AND source = ? AND message_key = ?`,
      scope.tenantId,
      scope.userId,
      source,
      messageKey
    );
    if (existing) {
      if (existing.payloadHash !== payload.hash || existing.eventType !== eventType) {
        throw new Error("The inbox idempotency key was already used for different content.");
      }
      this.recordReceipt("inbox", existing.id, "deduped", existing.deliveryAttempts, "same_payload", now);
      return {
        id: existing.id,
        disposition: "deduped",
        state: existing.state,
        payloadHash: existing.payloadHash,
        receivedAt: existing.receivedAt
      };
    }

    const id = newId("inbox");
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO inbox_messages(
           id, tenant_id, user_id, source, message_key, event_type, payload_hash,
           payload_json, state, received_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`,
        id,
        scope.tenantId,
        scope.userId,
        source,
        messageKey,
        eventType,
        payload.hash,
        payload.json,
        timestamp,
        timestamp
      );
      this.recordReceipt("inbox", id, "accepted", 0, "new_message", now);
    });
    return { id, disposition: "accepted", state: "accepted", payloadHash: payload.hash, receivedAt: timestamp };
  }

  leaseInbox(leaseSeconds = 60, now = Date.now()): HostedInboxLease | null {
    return this.leaseInboxMatching("", leaseSeconds, now);
  }

  leaseInboxByEventType(eventType: string, leaseSeconds = 60, now = Date.now()): HostedInboxLease | null {
    const safeEventType = deliveryIdentifier(eventType, "inbox event type").toLocaleLowerCase("en-US");
    return this.leaseInboxMatching(safeEventType, leaseSeconds, now);
  }

  private leaseInboxMatching(eventType: string, leaseSeconds: number, now: number): HostedInboxLease | null {
    allowedWorker(this.authorization);
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const leaseExpiresAt = nowIso(now + safeSeconds(leaseSeconds, 60, 15, 300) * 1_000);
    return this.db.transaction(() => {
      const candidate = this.db.get<{
        id: string;
        source: string;
        messageKey: string;
        eventType: string;
        payloadJson: string;
        deliveryAttempts: number;
      }>(
        `SELECT id, source, message_key AS messageKey, event_type AS eventType,
                payload_json AS payloadJson, delivery_attempts AS deliveryAttempts
         FROM inbox_messages
         WHERE tenant_id = ? AND user_id = ? AND delivery_attempts < ?
           AND (? = '' OR event_type = ?)
           AND (
             (state IN ('accepted', 'failed') AND (next_attempt_at = '' OR next_attempt_at <= ?)
               AND (lease_capability_hash = '' OR lease_expires_at <= ?))
             OR (state = 'processing' AND lease_expires_at <= ?)
           )
         ORDER BY received_at, id LIMIT 1`,
        scope.tenantId,
        scope.userId,
        MAX_DELIVERY_ATTEMPTS,
        eventType,
        eventType,
        timestamp,
        timestamp,
        timestamp
      );
      if (!candidate) return null;
      const capabilityToken = randomBytes(32).toString("base64url");
      const attempt = candidate.deliveryAttempts + 1;
      const updated = this.db.run(
        `UPDATE inbox_messages
         SET state = 'processing', delivery_attempts = ?, lease_capability_hash = ?,
             lease_expires_at = ?, next_attempt_at = '', last_error_code = '', updated_at = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ?
           AND (lease_capability_hash = '' OR lease_expires_at <= ?)`,
        attempt,
        capabilityHash(candidate.id, capabilityToken),
        leaseExpiresAt,
        timestamp,
        candidate.id,
        scope.tenantId,
        scope.userId,
        timestamp
      );
      if (Number(updated.changes) !== 1) return null;
      this.recordReceipt("inbox", candidate.id, "leased", attempt, "worker_lease", now);
      return {
        id: candidate.id,
        source: candidate.source,
        messageKey: candidate.messageKey,
        eventType: candidate.eventType,
        payload: parsedPayload(candidate.payloadJson),
        attempt,
        leaseExpiresAt,
        capabilityToken
      };
    });
  }

  completeInbox(id: string, capabilityToken: string, now = Date.now()): boolean {
    allowedWorker(this.authorization);
    const cleanId = deliveryIdentifier(id, "inbox message ID");
    this.assertInboxCapability(cleanId, capabilityToken, now);
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      const result = this.db.run(
        `UPDATE inbox_messages
         SET state = 'processed', lease_capability_hash = '', lease_expires_at = '',
             next_attempt_at = '', last_error_code = '', processed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ? AND state = 'processing'`,
        timestamp,
        timestamp,
        cleanId,
        scope.tenantId,
        scope.userId
      );
      if (Number(result.changes) !== 1) return false;
      const attempt = this.inboxAttempt(cleanId);
      this.recordReceipt("inbox", cleanId, "processed", attempt, "worker_ack", now);
      return true;
    });
  }

  retryInbox(id: string, capabilityToken: string, reasonCode: string, retryAfterSeconds = 30, now = Date.now()): "retry" | "dead_letter" {
    allowedWorker(this.authorization);
    const cleanId = deliveryIdentifier(id, "inbox message ID");
    this.assertInboxCapability(cleanId, capabilityToken, now);
    const scope = currentRequestScope();
    const attempt = this.inboxAttempt(cleanId);
    const deadLetter = attempt >= MAX_DELIVERY_ATTEMPTS;
    const state = deadLetter ? "dead_letter" : "failed";
    const reason = cleanText(reasonCode, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_:-]/g, "_") || "delivery_failed";
    const timestamp = nowIso(now);
    const nextAttemptAt = deadLetter ? "" : nowIso(now + safeSeconds(retryAfterSeconds, 30, 1, 86_400) * 1_000);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE inbox_messages
         SET state = ?, lease_capability_hash = '', lease_expires_at = '',
             next_attempt_at = ?, last_error_code = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ? AND state = 'processing'`,
        state,
        nextAttemptAt,
        reason,
        timestamp,
        cleanId,
        scope.tenantId,
        scope.userId
      );
      this.recordReceipt("inbox", cleanId, deadLetter ? "dead_letter" : "retry", attempt, reason, now);
    });
    return deadLetter ? "dead_letter" : "retry";
  }

  leaseOutbox(leaseSeconds = 60, now = Date.now()): HostedOutboxLease | null {
    allowedWorker(this.authorization);
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const leaseExpiresAt = nowIso(now + safeSeconds(leaseSeconds, 60, 15, 300) * 1_000);
    return this.db.transaction(() => {
      const candidate = this.db.get<{
        id: string;
        aggregateType: string;
        aggregateId: string;
        eventType: string;
        payloadJson: string;
        deliveryAttempts: number;
        createdAt: string;
      }>(
        `SELECT id, aggregate_type AS aggregateType, aggregate_id AS aggregateId,
                event_type AS eventType, payload_json AS payloadJson,
                delivery_attempts AS deliveryAttempts, created_at AS createdAt
         FROM outbox_events
         WHERE tenant_id = ? AND delivery_state = 'pending' AND delivered_at = '' AND delivery_attempts < ?
           AND (next_attempt_at = '' OR next_attempt_at <= ?)
           AND (lease_capability_hash = '' OR lease_expires_at <= ?)
         ORDER BY created_at, id LIMIT 1`,
        scope.tenantId,
        MAX_DELIVERY_ATTEMPTS,
        timestamp,
        timestamp
      );
      if (!candidate) return null;
      const capabilityToken = randomBytes(32).toString("base64url");
      const attempt = candidate.deliveryAttempts + 1;
      const updated = this.db.run(
        `UPDATE outbox_events
         SET delivery_attempts = ?, lease_capability_hash = ?, lease_expires_at = ?,
             next_attempt_at = '', last_error_code = '', updated_at = ?
         WHERE id = ? AND tenant_id = ? AND delivery_state = 'pending' AND delivered_at = ''
           AND (lease_capability_hash = '' OR lease_expires_at <= ?)`,
        attempt,
        capabilityHash(candidate.id, capabilityToken),
        leaseExpiresAt,
        timestamp,
        candidate.id,
        scope.tenantId,
        timestamp
      );
      if (Number(updated.changes) !== 1) return null;
      this.recordReceipt("outbox", candidate.id, "leased", attempt, "worker_lease", now);
      return {
        id: candidate.id,
        aggregateType: candidate.aggregateType,
        aggregateId: candidate.aggregateId,
        eventType: candidate.eventType,
        payload: parsedPayload(candidate.payloadJson),
        attempt,
        createdAt: candidate.createdAt,
        leaseExpiresAt,
        capabilityToken
      };
    });
  }

  completeOutbox(id: string, capabilityToken: string, now = Date.now()): boolean {
    allowedWorker(this.authorization);
    const cleanId = deliveryIdentifier(id, "outbox event ID");
    this.assertOutboxCapability(cleanId, capabilityToken, now);
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      const result = this.db.run(
        `UPDATE outbox_events
         SET delivery_state = 'delivered', delivered_at = ?, lease_capability_hash = '', lease_expires_at = '',
             next_attempt_at = '', last_error_code = '', updated_at = ?
         WHERE id = ? AND tenant_id = ? AND delivery_state = 'pending' AND delivered_at = ''`,
        timestamp,
        timestamp,
        cleanId,
        scope.tenantId
      );
      if (Number(result.changes) !== 1) return false;
      const attempt = this.outboxAttempt(cleanId);
      this.recordReceipt("outbox", cleanId, "delivered", attempt, "worker_ack", now);
      return true;
    });
  }

  retryOutbox(id: string, capabilityToken: string, reasonCode: string, retryAfterSeconds = 30, now = Date.now()): "retry" | "dead_letter" {
    allowedWorker(this.authorization);
    const cleanId = deliveryIdentifier(id, "outbox event ID");
    this.assertOutboxCapability(cleanId, capabilityToken, now);
    const scope = currentRequestScope();
    const attempt = this.outboxAttempt(cleanId);
    const deadLetter = attempt >= MAX_DELIVERY_ATTEMPTS;
    const reason = cleanText(reasonCode, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_:-]/g, "_") || "delivery_failed";
    const timestamp = nowIso(now);
    const nextAttemptAt = deadLetter ? "9999-12-31T23:59:59.999Z" : nowIso(now + safeSeconds(retryAfterSeconds, 30, 1, 86_400) * 1_000);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE outbox_events
         SET delivery_state = ?, lease_capability_hash = '', lease_expires_at = '', next_attempt_at = ?,
             last_error_code = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND delivery_state = 'pending' AND delivered_at = ''`,
        deadLetter ? "dead_letter" : "pending",
        nextAttemptAt,
        reason,
        timestamp,
        cleanId,
        scope.tenantId
      );
      this.recordReceipt("outbox", cleanId, deadLetter ? "dead_letter" : "retry", attempt, reason, now);
    });
    return deadLetter ? "dead_letter" : "retry";
  }

  recoverExpiredLeases(now = Date.now()): {
    inboxRequeued: number;
    inboxDeadLettered: number;
    outboxRequeued: number;
    outboxDeadLettered: number;
  } {
    allowedWorker(this.authorization);
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      const result = { inboxRequeued: 0, inboxDeadLettered: 0, outboxRequeued: 0, outboxDeadLettered: 0 };
      const inbox = this.db.all<{ id: string; attempt: number }>(
        `SELECT id, delivery_attempts AS attempt FROM inbox_messages
         WHERE tenant_id = ? AND user_id = ? AND state = 'processing'
           AND lease_capability_hash <> '' AND lease_expires_at <> '' AND lease_expires_at <= ?
         ORDER BY lease_expires_at, id`,
        scope.tenantId,
        scope.userId,
        timestamp
      );
      for (const message of inbox) {
        const deadLetter = Number(message.attempt) >= MAX_DELIVERY_ATTEMPTS;
        this.db.run(
          `UPDATE inbox_messages SET state = ?, lease_capability_hash = '', lease_expires_at = '',
             next_attempt_at = ?, last_error_code = 'lease_expired', updated_at = ?
           WHERE id = ? AND tenant_id = ? AND user_id = ? AND state = 'processing'`,
          deadLetter ? "dead_letter" : "failed",
          deadLetter ? "" : timestamp,
          timestamp,
          message.id,
          scope.tenantId,
          scope.userId
        );
        this.recordReceipt("inbox", message.id, deadLetter ? "dead_letter" : "retry", Number(message.attempt), "lease_expired", now);
        if (deadLetter) result.inboxDeadLettered += 1;
        else result.inboxRequeued += 1;
      }
      const outbox = this.db.all<{ id: string; attempt: number }>(
        `SELECT id, delivery_attempts AS attempt FROM outbox_events
         WHERE tenant_id = ? AND delivery_state = 'pending' AND delivered_at = ''
           AND lease_capability_hash <> '' AND lease_expires_at <> '' AND lease_expires_at <= ?
         ORDER BY lease_expires_at, id`,
        scope.tenantId,
        timestamp
      );
      for (const message of outbox) {
        const deadLetter = Number(message.attempt) >= MAX_DELIVERY_ATTEMPTS;
        this.db.run(
          `UPDATE outbox_events SET delivery_state = ?, lease_capability_hash = '', lease_expires_at = '',
             next_attempt_at = ?, last_error_code = 'lease_expired', updated_at = ?
           WHERE id = ? AND tenant_id = ? AND delivery_state = 'pending' AND delivered_at = ''`,
          deadLetter ? "dead_letter" : "pending",
          deadLetter ? "" : timestamp,
          timestamp,
          message.id,
          scope.tenantId
        );
        this.recordReceipt("outbox", message.id, deadLetter ? "dead_letter" : "retry", Number(message.attempt), "lease_expired", now);
        if (deadLetter) result.outboxDeadLettered += 1;
        else result.outboxRequeued += 1;
      }
      return result;
    });
  }

  counts(): { inboxPending: number; inboxProcessed: number; outboxPending: number; outboxDelivered: number } {
    const scope = currentRequestScope();
    const inbox = this.db.get<{ pending: number; processed: number }>(
      `SELECT SUM(CASE WHEN state != 'processed' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN state = 'processed' THEN 1 ELSE 0 END) AS processed
       FROM inbox_messages WHERE tenant_id = ? AND user_id = ?`,
      scope.tenantId,
      scope.userId
    );
    const outbox = this.db.get<{ pending: number; delivered: number }>(
      `SELECT SUM(CASE WHEN delivery_state = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN delivery_state = 'delivered' THEN 1 ELSE 0 END) AS delivered
       FROM outbox_events WHERE tenant_id = ?`,
      scope.tenantId
    );
    return {
      inboxPending: Number(inbox?.pending ?? 0),
      inboxProcessed: Number(inbox?.processed ?? 0),
      outboxPending: Number(outbox?.pending ?? 0),
      outboxDelivered: Number(outbox?.delivered ?? 0)
    };
  }

  inboxEventCounts(eventType: string): HostedInboxEventCounts {
    const scope = currentRequestScope();
    const safeEventType = deliveryIdentifier(eventType, "inbox event type").toLocaleLowerCase("en-US");
    const counts = this.db.get<{
      accepted: number;
      processing: number;
      failed: number;
      processed: number;
      deadLetter: number;
      total: number;
    }>(
      `SELECT
         SUM(CASE WHEN state = 'accepted' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN state = 'processing' THEN 1 ELSE 0 END) AS processing,
         SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN state = 'processed' THEN 1 ELSE 0 END) AS processed,
         SUM(CASE WHEN state = 'dead_letter' THEN 1 ELSE 0 END) AS deadLetter,
         COUNT(*) AS total
       FROM inbox_messages
       WHERE tenant_id = ? AND user_id = ? AND event_type = ?`,
      scope.tenantId,
      scope.userId,
      safeEventType
    );
    return {
      eventType: safeEventType,
      accepted: Number(counts?.accepted ?? 0),
      processing: Number(counts?.processing ?? 0),
      failed: Number(counts?.failed ?? 0),
      processed: Number(counts?.processed ?? 0),
      deadLetter: Number(counts?.deadLetter ?? 0),
      total: Number(counts?.total ?? 0)
    };
  }

  listInboxDeadLettersByEventType(eventType: string, limit = 50): HostedInboxDeadLetter[] {
    const scope = currentRequestScope();
    const safeEventType = deliveryIdentifier(eventType, "inbox event type").toLocaleLowerCase("en-US");
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
    return this.db.all<{
      id: string;
      eventType: string;
      attempt: number;
      lastErrorCode: string;
      receivedAt: string;
      updatedAt: string;
    }>(
      `SELECT id, event_type AS eventType, delivery_attempts AS attempt,
              last_error_code AS lastErrorCode, received_at AS receivedAt,
              updated_at AS updatedAt
       FROM inbox_messages
       WHERE tenant_id = ? AND user_id = ? AND event_type = ? AND state = 'dead_letter'
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      scope.tenantId,
      scope.userId,
      safeEventType,
      safeLimit
    ).map((row) => ({
      ...row,
      attempt: Number(row.attempt),
      privacyClassification: "operational_aggregate" as const
    }));
  }

  retryDeadLetterInbox(id: string, eventType: string, correlationId: string, now = Date.now()): HostedInboxDeadLetter {
    this.authorization.require("worker.manage");
    const scope = currentRequestScope();
    const cleanId = deliveryIdentifier(id, "inbox message ID");
    const safeEventType = deliveryIdentifier(eventType, "inbox event type").toLocaleLowerCase("en-US");
    const existing = this.db.get<{ state: string }>(
      `SELECT state FROM inbox_messages
       WHERE id = ? AND tenant_id = ? AND user_id = ? AND event_type = ?`,
      cleanId,
      scope.tenantId,
      scope.userId,
      safeEventType
    );
    if (!existing) {
      throw new HostedDeliveryError("hosted_inbox_not_found", 404, "The signal inbox message does not exist.");
    }
    if (existing.state !== "dead_letter") {
      throw new HostedDeliveryError("hosted_inbox_state_conflict", 409, "Only a dead-lettered signal inbox message can be retried.");
    }
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      const updated = this.db.run(
        `UPDATE inbox_messages
         SET state = 'accepted', delivery_attempts = 0, lease_capability_hash = '',
             lease_expires_at = '', next_attempt_at = '', last_error_code = '',
             processed_at = '', updated_at = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ? AND event_type = ? AND state = 'dead_letter'`,
        timestamp,
        cleanId,
        scope.tenantId,
        scope.userId,
        safeEventType
      );
      if (Number(updated.changes) !== 1) {
        throw new HostedDeliveryError("hosted_inbox_state_conflict", 409, "The signal inbox message changed before it could be retried.");
      }
      this.recordReceipt("inbox", cleanId, "retry", 0, "operator_retry", now);
      this.audit.record({
        correlationId,
        aggregateType: "hosted_inbox",
        eventType: "signal_inbox_retried",
        reasonCode: "operator_retry",
        message: "A dead-lettered signal message was reset for bounded worker evaluation.",
        data: { inboxMessageId: cleanId, eventType: safeEventType }
      }, now);
    });
    return {
      id: cleanId,
      eventType: safeEventType,
      attempt: 0,
      lastErrorCode: "",
      receivedAt: this.db.get<{ receivedAt: string }>(
        "SELECT received_at AS receivedAt FROM inbox_messages WHERE id = ?",
        cleanId
      )?.receivedAt ?? "",
      updatedAt: timestamp,
      privacyClassification: "operational_aggregate"
    };
  }

  private assertInboxCapability(id: string, token: string, now: number): void {
    const scope = currentRequestScope();
    const row = this.db.get<{ capabilityHash: string; leaseExpiresAt: string; state: string }>(
      `SELECT lease_capability_hash AS capabilityHash, lease_expires_at AS leaseExpiresAt, state
       FROM inbox_messages WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      id,
      scope.tenantId,
      scope.userId
    );
    this.assertCapability(row?.capabilityHash ?? "", row?.leaseExpiresAt ?? "", row?.state === "processing", id, token, now);
  }

  private assertOutboxCapability(id: string, token: string, now: number): void {
    const scope = currentRequestScope();
    const row = this.db.get<{ capabilityHash: string; leaseExpiresAt: string; pending: number }>(
      `SELECT lease_capability_hash AS capabilityHash, lease_expires_at AS leaseExpiresAt,
              CASE WHEN delivery_state = 'pending' AND delivered_at = '' THEN 1 ELSE 0 END AS pending
       FROM outbox_events WHERE id = ? AND tenant_id = ?`,
      id,
      scope.tenantId
    );
    this.assertCapability(row?.capabilityHash ?? "", row?.leaseExpiresAt ?? "", row?.pending === 1, id, token, now);
  }

  private assertCapability(storedHash: string, expiresAt: string, active: boolean, id: string, token: string, now: number): void {
    const cleanToken = cleanText(token, 100);
    const supplied = capabilityHash(id, cleanToken);
    const stored = Buffer.from(storedHash, "hex");
    const candidate = Buffer.from(supplied, "hex");
    if (!active || !/^[A-Za-z0-9_-]{43}$/.test(cleanToken) || stored.length !== candidate.length
      || !timingSafeEqual(stored, candidate) || !expiresAt || expiresAt < nowIso(now)) {
      throw new Error("The delivery lease capability is invalid or expired.");
    }
  }

  private inboxAttempt(id: string): number {
    return Number(this.db.get<{ attempt: number }>(
      "SELECT delivery_attempts AS attempt FROM inbox_messages WHERE id = ?",
      id
    )?.attempt ?? 0);
  }

  private outboxAttempt(id: string): number {
    return Number(this.db.get<{ attempt: number }>(
      "SELECT delivery_attempts AS attempt FROM outbox_events WHERE id = ?",
      id
    )?.attempt ?? 0);
  }

  private recordReceipt(
    direction: "inbox" | "outbox",
    messageId: string,
    disposition: "accepted" | "deduped" | "leased" | "processed" | "delivered" | "retry" | "dead_letter",
    attempt: number,
    reasonCode: string,
    now: number
  ): void {
    const scope = currentRequestScope();
    const id = newId("delivery_receipt");
    const timestamp = nowIso(now);
    const reason = cleanText(reasonCode, 80);
    this.db.run(
      `INSERT INTO hosted_delivery_receipts(
         id, tenant_id, user_id, direction, message_id, disposition,
         attempt, reason_code, receipt_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      scope.tenantId,
      scope.userId,
      direction,
      messageId,
      disposition,
      attempt,
      reason,
      stableHash("hosted_delivery_receipt_v1", scope.tenantId, scope.userId, direction, messageId, disposition, attempt, reason, timestamp),
      timestamp
    );
  }
}
