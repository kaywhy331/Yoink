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

export const AUDIT_EVENT_FAMILIES = Object.freeze([
  "safety",
  "actions",
  "plans",
  "sources",
  "catalog",
  "access",
  "system"
] as const);

export const AUDIT_ACTOR_KINDS = Object.freeze([
  "maintainer",
  "user",
  "device",
  "service",
  "unknown"
] as const);

export type AuditEventFamily = typeof AUDIT_EVENT_FAMILIES[number];
export type AuditActorKind = typeof AUDIT_ACTOR_KINDS[number];

export interface AuditQueryFilters {
  search?: string;
  type?: AuditEventFamily | string;
  actor?: AuditActorKind | string;
  since?: string;
}

interface NormalizedAuditQueryFilters {
  search: string;
  type: AuditEventFamily | "";
  actor: AuditActorKind | "";
  since: string;
}

const AUDIT_FAMILY_INPUT_SQL = "lower(event_type || ' ' || reason_code)";
const AUDIT_EVENT_FAMILY_SQL = `CASE
  WHEN ${AUDIT_FAMILY_INPUT_SQL} LIKE '%guardrail%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%qualif%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%approval%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%authoriz%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%security%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%incident%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%pause%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%reject%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%block%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%denied%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%invalid%'
    THEN 'safety'
  WHEN ${AUDIT_FAMILY_INPUT_SQL} LIKE '%action%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%cart%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%checkout%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%order%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%purchase%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%spend%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%job%'
    THEN 'actions'
  WHEN ${AUDIT_FAMILY_INPUT_SQL} LIKE '%mission%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%strategy%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%intent%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%profile%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%target%'
    THEN 'plans'
  WHEN ${AUDIT_FAMILY_INPUT_SQL} LIKE '%source%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%signal%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%connector%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%drop_window%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%trackalacker%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%provider%'
    THEN 'sources'
  WHEN ${AUDIT_FAMILY_INPUT_SQL} LIKE '%catalog%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%listing%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%product%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%identity%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%observer%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%recipe%'
    THEN 'catalog'
  WHEN ${AUDIT_FAMILY_INPUT_SQL} LIKE '%user%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%role%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%pair%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%device%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%credential%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%permission%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%session%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%privacy%'
    OR ${AUDIT_FAMILY_INPUT_SQL} LIKE '%consent%'
    THEN 'access'
  ELSE 'system'
END`;

function includesAuditValue<T extends string>(values: readonly T[], value: string): value is T {
  return values.includes(value as T);
}

function normalizeFilters(filters: string | AuditQueryFilters = ""): NormalizedAuditQueryFilters {
  const source = typeof filters === "string" ? { search: filters } : filters;
  const type = cleanText(source.type, 40).toLocaleLowerCase("en-US");
  const actor = cleanText(source.actor, 40).toLocaleLowerCase("en-US");
  const rawSince = cleanText(source.since, 80);
  const sinceTime = Date.parse(rawSince);
  return {
    search: cleanText(source.search, 200),
    type: includesAuditValue(AUDIT_EVENT_FAMILIES, type) ? type : "",
    actor: includesAuditValue(AUDIT_ACTOR_KINDS, actor) ? actor : "",
    since: rawSince && Number.isFinite(sinceTime) ? new Date(sinceTime).toISOString() : ""
  };
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
    const scope = currentRequestScope();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO audit_events(
           id, tenant_id, user_id, correlation_id, event_type,
           reason_code, message, data_json, actor_kind, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        auditId,
        scope.tenantId,
        scope.userId,
        correlationId,
        eventType,
        reasonCode,
        message,
        JSON.stringify(data),
        scope.actorKind,
        createdAt
      );
      this.db.run(
        `INSERT INTO outbox_events(
           id, tenant_id, aggregate_type, aggregate_id, event_type,
           payload_json, created_at, delivered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '')`,
        outboxId,
        scope.tenantId,
        aggregateType,
        correlationId,
        eventType,
        JSON.stringify({ auditId, correlationId, reasonCode, message, data }),
        createdAt
      );
    });
    return { id: auditId, outboxId, correlationId, aggregateType, eventType, reasonCode, message, data, actorKind: scope.actorKind, createdAt };
  }

  count(filters: string | AuditQueryFilters = ""): number {
    const { search: query, type, actor, since } = normalizeFilters(filters);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const codePattern = `%${query.toLocaleLowerCase("en-US").replace(/\s+/g, "_").replace(/[\\%]/g, "\\$&")}%`;
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE user_id = ? AND (? = '' OR correlation_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR event_type LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR reason_code LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR message LIKE ? ESCAPE '\\' COLLATE NOCASE)
         AND (? = '' OR ${AUDIT_EVENT_FAMILY_SQL} = ?)
         AND (? = '' OR actor_kind = ?)
         AND (? = '' OR created_at >= ?)`,
      currentRequestScope().userId,
      query,
      pattern,
      codePattern,
      codePattern,
      pattern,
      type,
      type,
      actor,
      actor,
      since,
      since
    )?.count ?? 0);
  }

  list(limit = 100, offset = 0, filters: string | AuditQueryFilters = ""): Array<Record<string, unknown>> {
    const { search: query, type, actor, since } = normalizeFilters(filters);
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
      actorKind: AuditActorKind;
      eventFamily: AuditEventFamily;
      createdAt: string;
    }>(
      `SELECT id, correlation_id AS correlationId, event_type AS eventType,
              reason_code AS reasonCode, message, data_json AS dataJson,
              actor_kind AS actorKind, ${AUDIT_EVENT_FAMILY_SQL} AS eventFamily,
              created_at AS createdAt
       FROM audit_events
       WHERE user_id = ? AND (? = '' OR correlation_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR event_type LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR reason_code LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR message LIKE ? ESCAPE '\\' COLLATE NOCASE)
         AND (? = '' OR ${AUDIT_EVENT_FAMILY_SQL} = ?)
         AND (? = '' OR actor_kind = ?)
         AND (? = '' OR created_at >= ?)
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      currentRequestScope().userId,
      query,
      pattern,
      codePattern,
      codePattern,
      pattern,
      type,
      type,
      actor,
      actor,
      since,
      since,
      safeLimit,
      safeOffset
    ).map((row) => ({
      id: row.id,
      correlationId: row.correlationId,
      eventType: row.eventType,
      reasonCode: row.reasonCode,
      message: row.message,
      data: parsedData(row.dataJson),
      actorKind: row.actorKind,
      eventFamily: row.eventFamily,
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
