import {
  ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION,
  OPERATOR_ALERT_ACKNOWLEDGEMENT_REASON_CODES,
  OPERATOR_ALERT_ROUTES,
  OPERATOR_ALERT_RESOLUTION_REASON_CODES,
  OPERATOR_ALERT_SEVERITIES,
  RESOLVE_OPERATOR_ALERT_CONFIRMATION,
  RETAILER_ADAPTER_DIAGNOSTIC_OPERATIONS,
  RETAILER_OBSERVER_VERSIONS,
  SAVE_OPERATOR_ALERT_RULE_CONFIRMATION,
  type OperatorAlertAcknowledgeInput,
  type OperatorAlertConnectorInput,
  type OperatorAlertEventFamily,
  type OperatorAlertResolveInput,
  type OperatorAlertRoute,
  type OperatorAlertRuleInput,
  type OperatorAlertSeverity,
  type RetailerAdapterDiagnosticOperation,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { sanitizeDiagnosticData } from "../../domain/src/redaction.js";
import type { AdapterRepairQueueItem } from "./adapter-diagnostic-repository.js";
import { AuditRepository } from "./audit-repository.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import {
  OperatorAlertConnectorRepository,
  type OperatorAlertConnector
} from "./operator-alert-connector-repository.js";
import { currentRequestScope } from "./request-scope.js";

const SEVERITIES = new Set<string>(OPERATOR_ALERT_SEVERITIES);
const ROUTES = new Set<string>(OPERATOR_ALERT_ROUTES);
const OPERATIONS = new Set<string>(RETAILER_ADAPTER_DIAGNOSTIC_OPERATIONS);
const RETAILERS = new Set<string>(Object.keys(RETAILER_OBSERVER_VERSIONS));
const ACKNOWLEDGEMENT_REASONS = new Set<string>(OPERATOR_ALERT_ACKNOWLEDGEMENT_REASON_CODES);
const RESOLUTION_REASONS = new Set<string>(OPERATOR_ALERT_RESOLUTION_REASON_CODES);

export class OperatorAlertError extends Error {
  constructor(
    readonly code: "operator_alert_input_invalid" | "operator_alert_not_found" | "operator_alert_state_conflict" | "operator_alert_confirmation_required",
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "OperatorAlertError";
  }
}

export interface OperatorAlertRule {
  id: string;
  eventFamily: OperatorAlertEventFamily;
  name: string;
  enabled: boolean;
  severity: OperatorAlertSeverity;
  minimumOccurrences: number;
  dedupeWindowSeconds: number;
  escalationAfterSeconds: number;
  retailerScope: SupportedRetailerId | "*";
  operationScope: RetailerAdapterDiagnosticOperation | "*";
  routes: OperatorAlertRoute[];
  privacyClassification: "operational_configuration";
  createdAt: string;
  updatedAt: string;
}

export interface OperatorAlertIncident {
  id: string;
  ruleId: string;
  ruleName: string;
  eventFamily: OperatorAlertEventFamily;
  severity: OperatorAlertSeverity;
  status: "open" | "acknowledged" | "resolved";
  privacyClassification: "operational_aggregate";
  sourceCohort: string;
  title: string;
  summary: string;
  retailerId: SupportedRetailerId;
  operation: RetailerAdapterDiagnosticOperation;
  failureStage: string;
  reasonCode: string;
  layoutFingerprint: string;
  occurrenceCount: number;
  affectedEntityCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  escalatedAt: string;
  acknowledgedAt: string;
  resolvedAt: string;
  resolutionCode: string;
  escalationDue: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RuleRow {
  id: string;
  eventFamily: OperatorAlertEventFamily;
  name: string;
  enabled: number;
  severity: OperatorAlertSeverity;
  minimumOccurrences: number;
  dedupeWindowSeconds: number;
  escalationAfterSeconds: number;
  retailerScope: SupportedRetailerId | "*";
  operationScope: RetailerAdapterDiagnosticOperation | "*";
  routesJson: string;
  privacyClassification: "operational_configuration";
  createdAt: string;
  updatedAt: string;
}

interface IncidentRow {
  id: string;
  tenantId: string;
  subjectUserId: string;
  ruleId: string;
  ruleName: string;
  eventFamily: OperatorAlertEventFamily;
  severity: OperatorAlertSeverity;
  status: "open" | "acknowledged" | "resolved";
  privacyClassification: "operational_aggregate";
  incidentKeyHash: string;
  title: string;
  summary: string;
  retailerId: SupportedRetailerId;
  operation: RetailerAdapterDiagnosticOperation;
  failureStage: string;
  reasonCode: string;
  layoutFingerprint: string;
  occurrenceCount: number;
  affectedEntityCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastFailureAt: string;
  lastRoutedAt: string;
  escalatedAt: string;
  acknowledgedAt: string;
  resolvedAt: string;
  resolutionCode: string;
  escalationAfterSeconds: number;
  createdAt: string;
  updatedAt: string;
}

interface NormalizedRule {
  eventFamily: OperatorAlertEventFamily;
  name: string;
  enabled: boolean;
  severity: OperatorAlertSeverity;
  minimumOccurrences: number;
  dedupeWindowSeconds: number;
  escalationAfterSeconds: number;
  retailerScope: SupportedRetailerId | "*";
  operationScope: RetailerAdapterDiagnosticOperation | "*";
  routes: OperatorAlertRoute[];
}

const RULE_SELECT = `
  SELECT id, event_family AS eventFamily, name, enabled, severity,
         minimum_occurrences AS minimumOccurrences,
         dedupe_window_seconds AS dedupeWindowSeconds,
         escalation_after_seconds AS escalationAfterSeconds,
         retailer_scope AS retailerScope, operation_scope AS operationScope,
         routes_json AS routesJson, privacy_classification AS privacyClassification,
         created_at AS createdAt, updated_at AS updatedAt
  FROM operator_alert_rules`;

const INCIDENT_SELECT = `
  SELECT i.id, i.tenant_id AS tenantId, i.subject_user_id AS subjectUserId, i.rule_id AS ruleId,
         r.name AS ruleName, i.event_family AS eventFamily, i.severity, i.status,
         i.privacy_classification AS privacyClassification,
         i.incident_key_hash AS incidentKeyHash, i.title, i.summary,
         i.retailer_id AS retailerId, i.operation,
         i.failure_stage AS failureStage, i.reason_code AS reasonCode,
         i.layout_fingerprint AS layoutFingerprint,
         i.occurrence_count AS occurrenceCount,
         i.affected_entity_count AS affectedEntityCount,
         i.first_seen_at AS firstSeenAt, i.last_seen_at AS lastSeenAt,
         i.last_failure_at AS lastFailureAt, i.last_routed_at AS lastRoutedAt,
         i.escalated_at AS escalatedAt, i.acknowledged_at AS acknowledgedAt,
         i.resolved_at AS resolvedAt, i.resolution_code AS resolutionCode,
         r.escalation_after_seconds AS escalationAfterSeconds,
         i.created_at AS createdAt, i.updated_at AS updatedAt
  FROM operator_alert_incidents i
  JOIN operator_alert_rules r ON r.id = i.rule_id`;

function parsedRoutes(value: string): OperatorAlertRoute[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((route): route is OperatorAlertRoute => typeof route === "string" && ROUTES.has(route))
      : [];
  } catch {
    return [];
  }
}

function ruleFromRow(row: RuleRow): OperatorAlertRule {
  return {
    id: row.id,
    eventFamily: row.eventFamily,
    name: row.name,
    enabled: row.enabled === 1,
    severity: row.severity,
    minimumOccurrences: row.minimumOccurrences,
    dedupeWindowSeconds: row.dedupeWindowSeconds,
    escalationAfterSeconds: row.escalationAfterSeconds,
    retailerScope: row.retailerScope,
    operationScope: row.operationScope,
    routes: parsedRoutes(row.routesJson),
    privacyClassification: row.privacyClassification,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function incidentFromRow(row: IncidentRow, now = Date.now()): OperatorAlertIncident {
  const escalationDue = row.status !== "resolved"
    && !row.escalatedAt
    && row.escalationAfterSeconds > 0
    && new Date(row.firstSeenAt).getTime() + row.escalationAfterSeconds * 1_000 <= now;
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    eventFamily: row.eventFamily,
    severity: row.severity,
    status: row.status,
    privacyClassification: row.privacyClassification,
    sourceCohort: stableHash("yoink_operator_alert_cohort_v1", row.tenantId, row.subjectUserId).slice(0, 12),
    title: row.title,
    summary: row.summary,
    retailerId: row.retailerId,
    operation: row.operation,
    failureStage: row.failureStage,
    reasonCode: row.reasonCode,
    layoutFingerprint: row.layoutFingerprint,
    occurrenceCount: row.occurrenceCount,
    affectedEntityCount: row.affectedEntityCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    escalatedAt: row.escalatedAt,
    acknowledgedAt: row.acknowledgedAt,
    resolvedAt: row.resolvedAt,
    resolutionCode: row.resolutionCode,
    escalationDue,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new OperatorAlertError("operator_alert_input_invalid", 400, `${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return number;
}

function normalizedDisposition(value: unknown, allowed: ReadonlySet<string>, label: string): string {
  const reason = cleanText(value, 80).toLocaleLowerCase("en-US");
  if (!allowed.has(reason)) {
    throw new OperatorAlertError("operator_alert_input_invalid", 400, `An allowlisted ${label} is required.`);
  }
  return reason;
}

function nextSeverity(severity: OperatorAlertSeverity): OperatorAlertSeverity {
  if (severity === "info") return "warning";
  if (severity === "warning") return "error";
  return "critical";
}

function displayRetailer(retailerId: SupportedRetailerId): string {
  const names: Record<SupportedRetailerId, string> = {
    target: "Target", walmart: "Walmart", amazon: "Amazon", bestbuy: "Best Buy",
    disney: "Disney Store", ravensburger: "Ravensburger", riot: "Riot Games Merch",
    booksamillion: "Books-A-Million", fanatics: "Fanatics", kohls: "Kohl's",
    macys: "Macy's", pbandai: "Premium Bandai", pokemoncenter: "Pokémon Center"
  };
  return names[retailerId];
}

export class OperatorAlertRepository {
  private readonly audit: AuditRepository;
  private readonly authorization: AuthorizationRepository;
  private readonly connectors: OperatorAlertConnectorRepository;

  constructor(private readonly db: YoinkDatabase, availableConnectorBindings: Readonly<Record<string, string>> = {}) {
    this.audit = new AuditRepository(db);
    this.authorization = new AuthorizationRepository(db);
    this.connectors = new OperatorAlertConnectorRepository(db, availableConnectorBindings);
  }

  private normalizeRule(input: OperatorAlertRuleInput): NormalizedRule {
    if (input?.confirmation !== SAVE_OPERATOR_ALERT_RULE_CONFIRMATION) {
      throw new OperatorAlertError("operator_alert_confirmation_required", 400, "Explicit operator alert rule confirmation is required.");
    }
    const name = cleanText(input.name, 120);
    if (name.length < 3) throw new OperatorAlertError("operator_alert_input_invalid", 400, "An operator alert rule name is required.");
    if (input.eventFamily !== "adapter_repair" || typeof input.enabled !== "boolean" || !SEVERITIES.has(input.severity)) {
      throw new OperatorAlertError("operator_alert_input_invalid", 400, "The operator alert family, enabled state, or severity is invalid.");
    }
    const minimumOccurrences = boundedInteger(input.minimumOccurrences, 1, 100, "Minimum occurrences");
    const dedupeWindowSeconds = boundedInteger(input.dedupeWindowSeconds, 60, 86_400, "Dedupe window");
    const escalationAfterSeconds = Number(input.escalationAfterSeconds);
    if (escalationAfterSeconds !== 0
      && (!Number.isInteger(escalationAfterSeconds) || escalationAfterSeconds < 300 || escalationAfterSeconds > 604_800)) {
      throw new OperatorAlertError("operator_alert_input_invalid", 400, "Escalation must be disabled or set from 300 through 604800 seconds.");
    }
    const retailerScope = input.retailerScope;
    const operationScope = input.operationScope;
    if (retailerScope !== "*" && !RETAILERS.has(retailerScope)) {
      throw new OperatorAlertError("operator_alert_input_invalid", 400, "The operator alert retailer scope is unsupported.");
    }
    if (operationScope !== "*" && !OPERATIONS.has(operationScope)) {
      throw new OperatorAlertError("operator_alert_input_invalid", 400, "The operator alert operation scope is unsupported.");
    }
    if (!Array.isArray(input.routes)) throw new OperatorAlertError("operator_alert_input_invalid", 400, "At least one operator alert route is required.");
    const routes = [...new Set(input.routes)];
    if (!routes.length || routes.some((route) => !ROUTES.has(route))) {
      throw new OperatorAlertError("operator_alert_input_invalid", 400, "Operator alert routes are invalid.");
    }
    return {
      eventFamily: "adapter_repair",
      name,
      enabled: input.enabled,
      severity: input.severity,
      minimumOccurrences,
      dedupeWindowSeconds,
      escalationAfterSeconds,
      retailerScope: retailerScope as SupportedRetailerId | "*",
      operationScope: operationScope as RetailerAdapterDiagnosticOperation | "*",
      routes: routes as OperatorAlertRoute[]
    };
  }

  private loadRules(enabledOnly = false): OperatorAlertRule[] {
    const scope = currentRequestScope();
    return this.db.all<RuleRow>(
      `${RULE_SELECT} WHERE tenant_id = ? AND (? = 0 OR enabled = 1) ORDER BY name, id`,
      scope.tenantId,
      enabledOnly ? 1 : 0
    ).map(ruleFromRow);
  }

  rules(): OperatorAlertRule[] {
    this.authorization.require("admin.read");
    return this.loadRules();
  }

  saveRule(input: OperatorAlertRuleInput, id = "", now = Date.now()): OperatorAlertRule {
    this.authorization.require("alert.manage");
    const scope = currentRequestScope();
    const normalized = this.normalizeRule(input);
    const timestamp = nowIso(now);
    const ruleId = id ? cleanText(id, 120) : newId("alert_rule");
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(ruleId)) {
      throw new OperatorAlertError("operator_alert_input_invalid", 400, "The operator alert rule ID is invalid.");
    }
    const existing = id ? this.db.get<RuleRow>(`${RULE_SELECT} WHERE tenant_id = ? AND id = ?`, scope.tenantId, ruleId) : undefined;
    if (id && !existing) throw new OperatorAlertError("operator_alert_not_found", 404, "The operator alert rule does not exist in this tenant.");
    const duplicate = this.db.get<{ id: string }>(
      "SELECT id FROM operator_alert_rules WHERE tenant_id = ? AND event_family = ? AND name = ? COLLATE NOCASE AND id != ?",
      scope.tenantId,
      normalized.eventFamily,
      normalized.name,
      ruleId
    );
    if (duplicate) throw new OperatorAlertError("operator_alert_state_conflict", 409, "An operator alert rule with this name already exists.");
    this.db.transaction(() => {
      if (existing) {
        this.db.run(
          `UPDATE operator_alert_rules SET name = ?, enabled = ?, severity = ?,
             minimum_occurrences = ?, dedupe_window_seconds = ?, escalation_after_seconds = ?,
             retailer_scope = ?, operation_scope = ?, routes_json = ?,
             updated_by_actor_id = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`,
          normalized.name,
          normalized.enabled ? 1 : 0,
          normalized.severity,
          normalized.minimumOccurrences,
          normalized.dedupeWindowSeconds,
          normalized.escalationAfterSeconds,
          normalized.retailerScope,
          normalized.operationScope,
          JSON.stringify(normalized.routes),
          scope.actorId,
          timestamp,
          scope.tenantId,
          ruleId
        );
      } else {
        this.db.run(
          `INSERT INTO operator_alert_rules(
             id, tenant_id, event_family, name, enabled, severity,
             minimum_occurrences, dedupe_window_seconds, escalation_after_seconds,
             retailer_scope, operation_scope, routes_json, privacy_classification,
             created_by_actor_id, updated_by_actor_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'operational_configuration', ?, ?, ?, ?)`,
          ruleId,
          scope.tenantId,
          normalized.eventFamily,
          normalized.name,
          normalized.enabled ? 1 : 0,
          normalized.severity,
          normalized.minimumOccurrences,
          normalized.dedupeWindowSeconds,
          normalized.escalationAfterSeconds,
          normalized.retailerScope,
          normalized.operationScope,
          JSON.stringify(normalized.routes),
          scope.actorId,
          scope.actorId,
          timestamp,
          timestamp
        );
      }
      this.audit.record({
        correlationId: ruleId,
        aggregateType: "operator_alert_rule",
        eventType: existing ? "operator_alert_rule_updated" : "operator_alert_rule_created",
        reasonCode: normalized.enabled ? "rule_enabled" : "rule_disabled",
        message: existing ? "An operator alert rule was updated." : "An operator alert rule was created.",
        data: {
          ruleId,
          eventFamily: normalized.eventFamily,
          enabled: normalized.enabled,
          severity: normalized.severity,
          retailerScope: normalized.retailerScope,
          operationScope: normalized.operationScope,
          routes: normalized.routes
        }
      }, now);
    });
    return ruleFromRow(this.db.get<RuleRow>(`${RULE_SELECT} WHERE tenant_id = ? AND id = ?`, scope.tenantId, ruleId) as RuleRow);
  }

  private activeIncident(ruleId: string, incidentKeyHash: string): IncidentRow | undefined {
    const scope = currentRequestScope();
    return this.db.get<IncidentRow>(
      `${INCIDENT_SELECT}
       WHERE i.tenant_id = ? AND i.subject_user_id = ? AND i.rule_id = ?
         AND i.incident_key_hash = ? AND i.status IN ('open', 'acknowledged')`,
      scope.tenantId,
      scope.userId,
      ruleId,
      incidentKeyHash
    );
  }

  private lifecycle(
    incident: IncidentRow,
    rule: OperatorAlertRule,
    eventType: "opened" | "repeated" | "escalated" | "acknowledged" | "resolved" | "auto_resolved",
    reasonCode: string,
    correlationId: string,
    metadata: Record<string, unknown>,
    now: number
  ): void {
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const storedCorrelationId = `alertcorr_${stableHash("yoink_operator_alert_correlation_v1", correlationId).slice(0, 48)}`;
    const eventId = newId("alert_event");
    const sanitized = sanitizeDiagnosticData(metadata) as Record<string, unknown>;
    const receipt = this.audit.record({
      correlationId: storedCorrelationId,
      aggregateType: "operator_alert_incident",
      eventType: `operator_alert_${eventType}`,
      reasonCode,
      message: `An operator alert was ${eventType.replaceAll("_", " ")}.`,
      data: {
        incidentId: incident.id,
        ruleId: rule.id,
        severity: incident.severity,
        eventFamily: incident.eventFamily,
        privacyClassification: "operational_aggregate",
        ...sanitized
      }
    }, now) as { outboxId: string };
    this.db.run(
      `INSERT INTO operator_alert_events(
         id, tenant_id, incident_id, rule_id, event_type, severity, reason_code,
         actor_kind, actor_id, correlation_id, privacy_classification, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'operational_aggregate', ?, ?)`,
      eventId,
      scope.tenantId,
      incident.id,
      rule.id,
      eventType,
      incident.severity,
      reasonCode,
      scope.actorKind,
      scope.actorId,
      storedCorrelationId,
      JSON.stringify(sanitized),
      timestamp
    );
    for (const route of rule.routes) {
      this.db.run(
        `INSERT INTO operator_alert_deliveries(
           id, tenant_id, incident_id, event_id, route_kind, delivery_state,
           outbox_event_id, privacy_classification, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'operational_aggregate', ?)`,
        newId("alert_delivery"),
        scope.tenantId,
        incident.id,
        eventId,
        route,
        route === "dashboard" ? "delivered" : "queued",
        route === "audit_outbox" ? receipt.outboxId : null,
        timestamp
      );
    }
    this.connectors.queue({
      id: eventId,
      incidentId: incident.id,
      eventType,
      severity: incident.severity,
      reasonCode,
      createdAt: timestamp
    }, {
      id: incident.id,
      retailerId: incident.retailerId,
      operation: incident.operation,
      failureStage: incident.failureStage,
      layoutFingerprint: incident.layoutFingerprint,
      occurrenceCount: incident.occurrenceCount,
      affectedEntityCount: incident.affectedEntityCount,
      firstSeenAt: incident.firstSeenAt,
      lastSeenAt: incident.lastSeenAt
    }, now);
  }

  saveConnector(input: OperatorAlertConnectorInput, id = "", now = Date.now()): OperatorAlertConnector {
    return this.connectors.save(input, id, now);
  }

  reconcileAdapterRepairs(queue: AdapterRepairQueueItem[], correlationId: string, now = Date.now()): {
    opened: number;
    updated: number;
    resolved: number;
    escalated: number;
    routed: number;
  } {
    const scope = currentRequestScope();
    const safeCorrelationId = cleanText(correlationId, 160) || newId("alert_reconcile");
    const result = { opened: 0, updated: 0, resolved: 0, escalated: 0, routed: 0 };
    const rules = this.loadRules(true);
    if (!rules.length || !Array.isArray(queue)) return result;
    this.db.transaction(() => {
      for (const item of queue) {
        const matchingRules = rules.filter((rule) => rule.eventFamily === "adapter_repair"
          && (rule.retailerScope === "*" || rule.retailerScope === item.retailerId)
          && (rule.operationScope === "*" || rule.operationScope === item.operation));
        for (const rule of matchingRules) {
          let openedThisPass = false;
          const incidentKeyHash = stableHash(
            "yoink_operator_alert_adapter_repair_v1",
            item.retailerId,
            item.operation,
            item.layoutFingerprint
          );
          let incident = this.activeIncident(rule.id, incidentKeyHash);
          if (item.status === "recovered") {
            if (!incident) continue;
            const timestamp = nowIso(now);
            this.db.run(
              `UPDATE operator_alert_incidents SET status = 'resolved', last_seen_at = ?,
                 resolved_by_actor_id = ?, resolved_at = ?, resolution_code = 'adapter_recovered', updated_at = ?
               WHERE id = ? AND tenant_id = ? AND status IN ('open', 'acknowledged')`,
              item.lastSeenAt,
              scope.actorId,
              timestamp,
              timestamp,
              incident.id,
              scope.tenantId
            );
            incident = this.db.get<IncidentRow>(`${INCIDENT_SELECT} WHERE i.id = ? AND i.tenant_id = ?`, incident.id, scope.tenantId) as IncidentRow;
            this.lifecycle(incident, rule, "auto_resolved", "adapter_recovered", safeCorrelationId, {
              retailerId: item.retailerId,
              operation: item.operation,
              layoutFingerprint: item.layoutFingerprint,
              occurrenceCount: item.occurrenceCount,
              affectedEntityCount: item.affectedSkuCount
            }, now);
            result.resolved += 1;
            result.routed += rule.routes.length;
            continue;
          }
          if (item.occurrenceCount < rule.minimumOccurrences) continue;
          if (!incident) {
            const previous = this.db.get<{ resolvedAt: string }>(
              `SELECT resolved_at AS resolvedAt FROM operator_alert_incidents
               WHERE tenant_id = ? AND subject_user_id = ? AND rule_id = ? AND incident_key_hash = ?
                 AND status = 'resolved' ORDER BY resolved_at DESC, id DESC LIMIT 1`,
              scope.tenantId,
              scope.userId,
              rule.id,
              incidentKeyHash
            );
            if (previous?.resolvedAt && item.lastFailureAt <= previous.resolvedAt) continue;
            const timestamp = nowIso(now);
            const id = newId("alert_incident");
            const title = `${displayRetailer(item.retailerId)} adapter repair required`;
            const summary = `${displayRetailer(item.retailerId)} ${item.operation.replaceAll("_", " ")} reported ${item.reasonCode.replaceAll("_", " ")} during ${item.failureStage.replaceAll("_", " ")} across ${item.affectedSkuCount} exact product${item.affectedSkuCount === 1 ? "" : "s"}.`;
            this.db.run(
              `INSERT INTO operator_alert_incidents(
                 id, tenant_id, subject_user_id, rule_id, event_family, incident_key_hash,
                 severity, status, privacy_classification, title, summary, retailer_id,
                 operation, failure_stage, reason_code, layout_fingerprint,
                 occurrence_count, affected_entity_count, first_seen_at, last_seen_at,
                 last_failure_at, last_routed_at, created_at, updated_at
               ) VALUES (?, ?, ?, ?, 'adapter_repair', ?, ?, 'open', 'operational_aggregate',
                         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              id,
              scope.tenantId,
              scope.userId,
              rule.id,
              incidentKeyHash,
              rule.severity,
              title,
              summary,
              item.retailerId,
              item.operation,
              item.failureStage,
              item.reasonCode,
              item.layoutFingerprint,
              item.occurrenceCount,
              Math.max(1, item.affectedSkuCount),
              item.firstSeenAt,
              item.lastSeenAt,
              item.lastFailureAt,
              timestamp,
              timestamp,
              timestamp
            );
            incident = this.db.get<IncidentRow>(`${INCIDENT_SELECT} WHERE i.id = ? AND i.tenant_id = ?`, id, scope.tenantId) as IncidentRow;
            this.lifecycle(incident, rule, "opened", item.reasonCode, safeCorrelationId, {
              retailerId: item.retailerId,
              operation: item.operation,
              layoutFingerprint: item.layoutFingerprint,
              failureStage: item.failureStage,
              occurrenceCount: item.occurrenceCount,
              affectedEntityCount: item.affectedSkuCount
            }, now);
            result.opened += 1;
            result.routed += rule.routes.length;
            openedThisPass = true;
          } else {
            const changed = item.lastSeenAt > incident.lastSeenAt
              || item.occurrenceCount > incident.occurrenceCount
              || item.affectedSkuCount > incident.affectedEntityCount;
            if (changed) {
              const summary = `${displayRetailer(item.retailerId)} ${item.operation.replaceAll("_", " ")} reported ${item.reasonCode.replaceAll("_", " ")} during ${item.failureStage.replaceAll("_", " ")} across ${item.affectedSkuCount} exact product${item.affectedSkuCount === 1 ? "" : "s"}.`;
              this.db.run(
                `UPDATE operator_alert_incidents SET summary = ?, failure_stage = ?, reason_code = ?,
                   occurrence_count = MAX(occurrence_count, ?), affected_entity_count = MAX(affected_entity_count, ?),
                   last_seen_at = MAX(last_seen_at, ?), last_failure_at = MAX(last_failure_at, ?), updated_at = ?
                 WHERE id = ? AND tenant_id = ?`,
                summary,
                item.failureStage,
                item.reasonCode,
                item.occurrenceCount,
                Math.max(1, item.affectedSkuCount),
                item.lastSeenAt,
                item.lastFailureAt,
                nowIso(now),
                incident.id,
                scope.tenantId
              );
              result.updated += 1;
              incident = this.db.get<IncidentRow>(`${INCIDENT_SELECT} WHERE i.id = ? AND i.tenant_id = ?`, incident.id, scope.tenantId) as IncidentRow;
            }
          }
          if (!incident) continue;
          const escalationDue = !incident.escalatedAt
            && rule.escalationAfterSeconds > 0
            && new Date(incident.firstSeenAt).getTime() + rule.escalationAfterSeconds * 1_000 <= now;
          if (escalationDue) {
            const timestamp = nowIso(now);
            this.db.run(
              `UPDATE operator_alert_incidents SET severity = ?, escalated_at = ?, last_routed_at = ?, updated_at = ?
               WHERE id = ? AND tenant_id = ? AND status IN ('open', 'acknowledged')`,
              nextSeverity(incident.severity),
              timestamp,
              timestamp,
              timestamp,
              incident.id,
              scope.tenantId
            );
            incident = this.db.get<IncidentRow>(`${INCIDENT_SELECT} WHERE i.id = ? AND i.tenant_id = ?`, incident.id, scope.tenantId) as IncidentRow;
            this.lifecycle(incident, rule, "escalated", "escalation_window_elapsed", safeCorrelationId, {
              retailerId: item.retailerId,
              operation: item.operation,
              layoutFingerprint: item.layoutFingerprint
            }, now);
            result.escalated += 1;
            result.routed += rule.routes.length;
          } else if (!openedThisPass) {
            const lastRouted = new Date(incident.lastRoutedAt).getTime();
            const rerouteDue = item.lastSeenAt > incident.lastRoutedAt
              && Number.isFinite(lastRouted)
              && lastRouted + rule.dedupeWindowSeconds * 1_000 <= now;
            if (rerouteDue) {
              const timestamp = nowIso(now);
              this.db.run(
                "UPDATE operator_alert_incidents SET last_routed_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
                timestamp,
                timestamp,
                incident.id,
                scope.tenantId
              );
              incident = this.db.get<IncidentRow>(`${INCIDENT_SELECT} WHERE i.id = ? AND i.tenant_id = ?`, incident.id, scope.tenantId) as IncidentRow;
              this.lifecycle(incident, rule, "repeated", item.reasonCode, safeCorrelationId, {
                retailerId: item.retailerId,
                operation: item.operation,
                layoutFingerprint: item.layoutFingerprint,
                occurrenceCount: item.occurrenceCount
              }, now);
              result.routed += rule.routes.length;
            }
          }
        }
      }
    });
    return result;
  }

  private requireIncident(id: string): IncidentRow {
    const scope = currentRequestScope();
    const incidentId = cleanText(id, 120);
    const incident = this.db.get<IncidentRow>(
      `${INCIDENT_SELECT} WHERE i.id = ? AND i.tenant_id = ?`,
      incidentId,
      scope.tenantId
    );
    if (!incident) throw new OperatorAlertError("operator_alert_not_found", 404, "The operator alert incident does not exist in this tenant.");
    return incident;
  }

  acknowledge(id: string, input: OperatorAlertAcknowledgeInput, correlationId: string, now = Date.now()): OperatorAlertIncident {
    this.authorization.require("alert.manage");
    if (input?.confirmation !== ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION) {
      throw new OperatorAlertError("operator_alert_confirmation_required", 400, "Explicit operator alert acknowledgement confirmation is required.");
    }
    let incident = this.requireIncident(id);
    const reasonCode = normalizedDisposition(input.reasonCode, ACKNOWLEDGEMENT_REASONS, "alert acknowledgement reason");
    const note = cleanText(input.note, 300);
    if (incident.status === "acknowledged") return incidentFromRow(incident, now);
    if (incident.status !== "open") throw new OperatorAlertError("operator_alert_state_conflict", 409, "Only an open operator alert can be acknowledged.");
    const rule = this.loadRules().find((item) => item.id === incident.ruleId) as OperatorAlertRule;
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE operator_alert_incidents SET status = 'acknowledged',
           acknowledged_by_actor_id = ?, acknowledged_at = ?, last_routed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status = 'open'`,
        scope.actorId,
        timestamp,
        timestamp,
        timestamp,
        incident.id,
        scope.tenantId
      );
      incident = this.requireIncident(incident.id);
      this.lifecycle(incident, rule, "acknowledged", reasonCode, cleanText(correlationId, 160) || incident.id, {
        noteRecorded: Boolean(note)
      }, now);
    });
    return incidentFromRow(incident, now);
  }

  resolve(id: string, input: OperatorAlertResolveInput, correlationId: string, now = Date.now()): OperatorAlertIncident {
    this.authorization.require("alert.manage");
    if (input?.confirmation !== RESOLVE_OPERATOR_ALERT_CONFIRMATION) {
      throw new OperatorAlertError("operator_alert_confirmation_required", 400, "Explicit operator alert resolution confirmation is required.");
    }
    let incident = this.requireIncident(id);
    const reasonCode = normalizedDisposition(input.reasonCode, RESOLUTION_REASONS, "alert resolution reason");
    const note = cleanText(input.note, 300);
    if (note.length < 3) throw new OperatorAlertError("operator_alert_input_invalid", 400, "An operator alert resolution note is required.");
    if (incident.status === "resolved" && incident.resolutionCode === reasonCode) return incidentFromRow(incident, now);
    if (incident.status === "resolved") throw new OperatorAlertError("operator_alert_state_conflict", 409, "The operator alert was already resolved with a different reason.");
    const rule = this.loadRules().find((item) => item.id === incident.ruleId) as OperatorAlertRule;
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE operator_alert_incidents SET status = 'resolved', resolved_by_actor_id = ?,
           resolved_at = ?, resolution_code = ?, last_routed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status IN ('open', 'acknowledged')`,
        scope.actorId,
        timestamp,
        reasonCode,
        timestamp,
        timestamp,
        incident.id,
        scope.tenantId
      );
      incident = this.requireIncident(incident.id);
      this.lifecycle(incident, rule, "resolved", reasonCode, cleanText(correlationId, 160) || incident.id, {
        noteRecorded: true
      }, now);
    });
    return incidentFromRow(incident, now);
  }

  incidents(status: "open" | "acknowledged" | "resolved" | "all" = "all", limit = 200, now = Date.now()): OperatorAlertIncident[] {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    const normalizedStatus = ["open", "acknowledged", "resolved"].includes(status) ? status : "all";
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)));
    return this.db.all<IncidentRow>(
      `${INCIDENT_SELECT} WHERE i.tenant_id = ? AND (? = 'all' OR i.status = ?)
       ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
                CASE i.severity WHEN 'critical' THEN 0 WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
                i.last_seen_at DESC, i.id DESC LIMIT ?`,
      scope.tenantId,
      normalizedStatus,
      normalizedStatus,
      safeLimit
    ).map((row) => incidentFromRow(row, now));
  }

  events(limit = 200): Array<Record<string, unknown>> {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)));
    return this.db.all<{
      id: string; incidentId: string; eventType: string; severity: string; reasonCode: string;
      actorKind: string; correlationId: string; privacyClassification: string; createdAt: string;
    }>(
      `SELECT e.id, e.incident_id AS incidentId, e.event_type AS eventType,
              e.severity, e.reason_code AS reasonCode, e.actor_kind AS actorKind,
              e.correlation_id AS correlationId,
              e.privacy_classification AS privacyClassification, e.created_at AS createdAt
       FROM operator_alert_events e
       WHERE e.tenant_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
      scope.tenantId,
      safeLimit
    );
  }

  deliveries(limit = 200): Array<Record<string, unknown>> {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)));
    return this.db.all<{
      id: string; incidentId: string; eventType: string; routeKind: string;
      deliveryState: string; privacyClassification: string; createdAt: string;
    }>(
      `SELECT d.id, d.incident_id AS incidentId, e.event_type AS eventType,
              d.route_kind AS routeKind,
              CASE WHEN d.route_kind = 'audit_outbox' THEN COALESCE(o.delivery_state, d.delivery_state)
                   ELSE d.delivery_state END AS deliveryState,
              d.privacy_classification AS privacyClassification, d.created_at AS createdAt
       FROM operator_alert_deliveries d
       JOIN operator_alert_events e ON e.id = d.event_id
       LEFT JOIN outbox_events o ON o.id = d.outbox_event_id
       WHERE d.tenant_id = ? ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
      scope.tenantId,
      safeLimit
    );
  }

  counts(): {
    operatorAlertRules: number;
    enabledOperatorAlertRules: number;
    openOperatorAlerts: number;
    acknowledgedOperatorAlerts: number;
    resolvedOperatorAlerts: number;
    criticalOperatorAlerts: number;
    operatorAlertDeliveries: number;
  } {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    const ruleCounts = this.db.get<{ total: number; enabled: number }>(
      "SELECT COUNT(*) AS total, SUM(enabled) AS enabled FROM operator_alert_rules WHERE tenant_id = ?",
      scope.tenantId
    );
    const incidentCounts = this.db.get<{ open: number; acknowledged: number; resolved: number; critical: number }>(
      `SELECT SUM(status = 'open') AS open, SUM(status = 'acknowledged') AS acknowledged,
              SUM(status = 'resolved') AS resolved,
              SUM(status IN ('open', 'acknowledged') AND severity = 'critical') AS critical
       FROM operator_alert_incidents WHERE tenant_id = ?`,
      scope.tenantId
    );
    const deliveries = Number(this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operator_alert_deliveries WHERE tenant_id = ?",
      scope.tenantId
    )?.count ?? 0);
    return {
      operatorAlertRules: Number(ruleCounts?.total ?? 0),
      enabledOperatorAlertRules: Number(ruleCounts?.enabled ?? 0),
      openOperatorAlerts: Number(incidentCounts?.open ?? 0),
      acknowledgedOperatorAlerts: Number(incidentCounts?.acknowledged ?? 0),
      resolvedOperatorAlerts: Number(incidentCounts?.resolved ?? 0),
      criticalOperatorAlerts: Number(incidentCounts?.critical ?? 0),
      operatorAlertDeliveries: deliveries
    };
  }

  connectorCounts(): ReturnType<OperatorAlertConnectorRepository["counts"]> {
    return this.connectors.counts();
  }

  snapshot(now = Date.now()): Record<string, unknown> {
    this.authorization.require("admin.read");
    return {
      privacyClassification: "operational_aggregate",
      rawBrowsingDataStored: false,
      separateFromProductNotifications: true,
      mutationAuthority: false,
      canManage: this.authorization.has("alert.manage"),
      counts: this.counts(),
      connectors: this.connectors.snapshot(),
      rules: this.rules(),
      incidents: this.incidents("all", 200, now),
      events: this.events(200),
      deliveries: this.deliveries(200)
    };
  }
}
