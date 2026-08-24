import { newId, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { sanitizeDiagnosticData } from "../../domain/src/redaction.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

export interface AuditRecordInput {
  correlationId: string;
  aggregateType?: string;
  eventType: string;
  reasonCode: string;
  message: string;
  data?: Record<string, unknown>;
}

function parsedData(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export class AuditRepository {
  constructor(private readonly db: YoinkDatabase) {}

  record(input: AuditRecordInput, now = Date.now()): Record<string, unknown> {
    const correlationId = cleanText(input.correlationId, 160) || "system";
    const aggregateType = cleanText(input.aggregateType || "domain", 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_") || "domain";
    const eventType = cleanText(input.eventType, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_") || "domain_event";
    const reasonCode = cleanText(input.reasonCode, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_") || "recorded";
    const message = cleanText(sanitizeDiagnosticData(input.message), 500) || "A domain event was recorded.";
    const data = sanitizeDiagnosticData(input.data ?? {}) as Record<string, unknown>;
    const auditId = newId("audit");
    const outboxId = newId("outbox");
    const createdAt = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO audit_events(
           id, tenant_id, user_id, correlation_id, event_type,
           reason_code, message, data_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        auditId,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        correlationId,
        eventType,
        reasonCode,
        message,
        JSON.stringify(data),
        createdAt
      );
      this.db.run(
        `INSERT INTO outbox_events(
           id, tenant_id, aggregate_type, aggregate_id, event_type,
           payload_json, created_at, delivered_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, '')`,
        outboxId,
        currentRequestScope().tenantId,
        aggregateType,
        correlationId,
        eventType,
        JSON.stringify({ auditId, correlationId, reasonCode, message, data }),
        createdAt
      );
    });
    return { id: auditId, outboxId, correlationId, aggregateType, eventType, reasonCode, message, data, createdAt };
  }

  count(search = ""): number {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const codePattern = `%${query.toLocaleLowerCase("en-US").replace(/\s+/g, "_").replace(/[\\%]/g, "\\$&")}%`;
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE user_id = ? AND (? = '' OR correlation_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR event_type LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR reason_code LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR message LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
      currentRequestScope().userId,
      query,
      pattern,
      codePattern,
      codePattern,
      pattern
    )?.count ?? 0);
  }

  list(limit = 100, offset = 0, search = ""): Array<Record<string, unknown>> {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const codePattern = `%${query.toLocaleLowerCase("en-US").replace(/\s+/g, "_").replace(/[\\%]/g, "\\$&")}%`;
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const safeOffset = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
    return this.db.all<{
      id: string;
      correlationId: string;
      eventType: string;
      reasonCode: string;
      message: string;
      dataJson: string;
      createdAt: string;
    }>(
      `SELECT id, correlation_id AS correlationId, event_type AS eventType,
              reason_code AS reasonCode, message, data_json AS dataJson,
              created_at AS createdAt
       FROM audit_events
       WHERE user_id = ? AND (? = '' OR correlation_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR event_type LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR reason_code LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR message LIKE ? ESCAPE '\\' COLLATE NOCASE)
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      currentRequestScope().userId,
      query,
      pattern,
      codePattern,
      codePattern,
      pattern,
      safeLimit,
      safeOffset
    ).map((row) => ({
      id: row.id,
      correlationId: row.correlationId,
      eventType: row.eventType,
      reasonCode: row.reasonCode,
      message: row.message,
      data: parsedData(row.dataJson),
      createdAt: row.createdAt
    }));
  }

  outboxCounts(): { outboxEvents: number; pendingOutboxEvents: number } {
    const row = this.db.get<{ total: number; pending: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN delivery_state = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM outbox_events WHERE tenant_id = ?`,
      currentRequestScope().tenantId
    );
    return { outboxEvents: Number(row?.total ?? 0), pendingOutboxEvents: Number(row?.pending ?? 0) };
  }
}
