import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { BACKGROUND_TASK_KINDS } from "../../domain/src/background-task.js";
import { newId, stableHash } from "../../domain/src/ids.js";
import type {
  OperatorAlertReconciliationRepositoryPort,
  OperatorAlertReconciliationResult
} from "../../engine/src/operator-alert-reconciliation.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  inspectPostgresCutoverPreflight,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  type PostgresQueryResult,
  type PostgresQuerySession
} from "./postgres-cutover.js";
import {
  POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION,
  buildPostgresOperatorAlertConnectorDispatchManifest,
  verifyPostgresOperatorAlertConnectorDispatchBoundary
} from "./postgres-operator-alert-connector-dispatch.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION = 1;
export const POSTGRES_OPERATOR_ALERT_RECONCILIATION_RECEIPT_TABLE =
  "yoink_operator_alert_reconciliation_receipt";
export const POSTGRES_OPERATOR_ALERT_RECONCILIATION_FUNCTION =
  "yoink_reconcile_operator_alerts";
export const POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_DIAGNOSTICS = 2_000;
export const POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_GROUPS = 50;
export const POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_ACTIONS = 50;
export const POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_RULES = 50;
export const POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_CONNECTORS = 20;

const MAXIMUM_APPLY_PAYLOAD_BYTES = 1_000_000;
const MAXIMUM_CONNECTOR_PAYLOAD_BYTES = 4_000;
const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const APPLY_TIMESTAMP_SKEW_SECONDS = 30;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze(Array.from({ length: 7 }, () => "text"));
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TABLES = Object.freeze([
  "audit_events",
  "operator_alert_connector_deliveries",
  "operator_alert_connector_delivery_events",
  "operator_alert_connectors",
  "operator_alert_deliveries",
  "operator_alert_events",
  "operator_alert_incidents",
  "operator_alert_rules",
  "outbox_events",
  "retailer_adapter_diagnostics"
] as const);
const QUALIFIED_HANDLER_TASK_KINDS = Object.freeze([
  "notification_recovery",
  "execution_recovery",
  "operational_telemetry_retention",
  "observer_recipe_candidate_evaluation",
  "adapter_alert_reconciliation"
] as const);

export interface PostgresOperatorAlertReconciliationManifest {
  contractVersion: typeof POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  alertDispatchContractVersion: typeof POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION;
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  notificationRecoveryRoleNamespace: string;
  executionRecoveryRoleNamespace: string;
  operationalRetentionRoleNamespace: string;
  observerCandidateRoleNamespace: string;
  alertDispatchRoleNamespace: string;
  alertReconciliationRoleNamespace: string;
  alertDispatchManifestFingerprint: string;
  alertReconciliationRole: {
    kind: "operator_alert_diagnostic_reconciliation_boundary";
    name: string;
    functionName: typeof POSTGRES_OPERATOR_ALERT_RECONCILIATION_FUNCTION;
    functionArgumentTypes: string[];
    protectedTableNames: string[];
    forcedRlsTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTableCount: 10;
  forcedRlsTableCount: 10;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  qualifiedHandlerTaskKinds: [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention",
    "observer_recipe_candidate_evaluation",
    "adapter_alert_reconciliation"
  ];
  qualifiedHandlerTaskKindCount: 5;
  totalHandlerTaskKindCount: number;
  maximumDiagnostics: 2_000;
  maximumGroups: 50;
  maximumActions: 50;
  maximumRules: 50;
  maximumConnectors: 20;
  maximumConnectorPayloadBytes: 4_000;
  serverDerivedRepairGroups: true;
  databaseEvidenceRevalidation: true;
  twoPhasePlanApply: true;
  databaseServerClock: true;
  applicationGeneratedOpaqueIds: true;
  sanitizedAggregateOnly: true;
  endpointReferencesOnly: true;
  rawUrlsAccessible: false;
  connectorSecretsAccessible: false;
  alertDispatchRepositoryParity: true;
  alertReconciliationRepositoryParity: true;
  fullHandlerRepositoryParity: true;
  mutationAuthority: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresOperatorAlertReconciliationQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  alertDispatchContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  alertDispatchManifestFingerprint: string;
  alertReconciliationRoleName: string;
  protectedTableCount: 10;
  forcedRlsTableCount: 10;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  qualifiedHandlerTaskKindCount: 5;
  totalHandlerTaskKindCount: number;
  maximumDiagnostics: 2_000;
  maximumGroups: 50;
  maximumActions: 50;
  maximumRules: 50;
  maximumConnectors: 20;
  maximumConnectorPayloadBytes: 4_000;
  serverDerivedRepairGroups: true;
  databaseEvidenceRevalidation: true;
  twoPhasePlanApply: true;
  databaseServerClock: true;
  applicationGeneratedOpaqueIds: true;
  sanitizedAggregateOnly: true;
  endpointReferencesOnly: true;
  rawUrlsAccessible: false;
  connectorSecretsAccessible: false;
  alertDispatchRepositoryParity: true;
  alertReconciliationRepositoryParity: true;
  fullHandlerRepositoryParity: true;
  mutationAuthority: false;
  directTableAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  boundaryCatalogFingerprint: string;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresOperatorAlertReconciliationCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  alertDispatchContractVersion: 1;
  deterministicManifestImplemented: true;
  atomicQualificationApplyImplemented: true;
  exactEffectivePrivilegeVerification: true;
  immutableBoundaryCatalogFingerprint: true;
  qualificationSuiteParity: true;
  noLogin: true;
  noInherit: true;
  noBypassRls: true;
  securityDefinerRoutineVerified: true;
  serverBoundPrincipalLookup: true;
  serverDerivedRepairGroups: true;
  databaseEvidenceRevalidation: true;
  twoPhasePlanApply: true;
  databaseServerClock: true;
  applicationGeneratedOpaqueIds: true;
  sanitizedAggregateOnly: true;
  endpointReferencesOnly: true;
  rawUrlsAccessible: false;
  connectorSecretsAccessible: false;
  readCommittedTransactionAdapter: true;
  alertDispatchRepositoryParity: true;
  alertReconciliationRepositoryParity: true;
  fullHandlerRepositoryParity: true;
  handlerTaskKindCount: 5;
  totalHandlerTaskKindCount: number;
  maximumDiagnostics: 2_000;
  maximumGroups: 50;
  maximumActions: 50;
  maximumRules: 50;
  maximumConnectors: 20;
  maximumConnectorPayloadBytes: 4_000;
  protectedTableCount: 10;
  forcedRlsTableCount: 10;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface NodePostgresOperatorAlertReconciliationDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface RoleRow extends Record<string, unknown> {
  rolname: string;
  rolsuper: boolean;
  rolinherit: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
}

interface RoutineRow extends Record<string, unknown> {
  oid: string;
  routineName: string;
  argumentTypes: string;
  resultType: string;
  volatility: string;
  securityDefiner: boolean;
  strict: boolean;
  leakproof: boolean;
  configuration: string[] | null;
  ownerName: string;
  source: string;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  alert_dispatch_contract_version: string | number | bigint;
  phase: string;
  role_manifest_fingerprint: string;
  alert_dispatch_manifest_fingerprint: string;
  alert_reconciliation_role_name: string;
  protected_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  qualified_handler_task_kind_count: string | number | bigint;
  total_handler_task_kind_count: string | number | bigint;
  maximum_diagnostics: string | number | bigint;
  maximum_groups: string | number | bigint;
  maximum_actions: string | number | bigint;
  maximum_rules: string | number | bigint;
  maximum_connectors: string | number | bigint;
  maximum_connector_payload_bytes: string | number | bigint;
  server_derived_repair_groups: boolean;
  database_evidence_revalidation: boolean;
  two_phase_plan_apply: boolean;
  database_server_clock: boolean;
  application_generated_opaque_ids: boolean;
  sanitized_aggregate_only: boolean;
  endpoint_references_only: boolean;
  raw_urls_accessible: boolean;
  connector_secrets_accessible: boolean;
  alert_dispatch_repository_parity: boolean;
  alert_reconciliation_repository_parity: boolean;
  full_handler_repository_parity: boolean;
  mutation_authority: boolean;
  direct_table_access: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  boundary_catalog_fingerprint: string;
  applied_at: string;
  verified_at: string;
}

interface BoundaryInspection {
  protectedTableCount: number;
  forcedRlsTableCount: number;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryCatalogFingerprint: string;
}

export class PostgresOperatorAlertReconciliationQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresOperatorAlertReconciliationQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation schema is invalid."
    );
  }
  return normalized;
}

function roleNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_alert_reconcile`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role name exceeds 63 bytes."
    );
  }
  return value;
}

function identifier(value: string): string {
  return `"${value}"`;
}

function relation(schema: string, object: string): string {
  return `${identifier(schema)}.${identifier(object)}`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      `The PostgreSQL operator-alert reconciliation ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      `The PostgreSQL operator-alert reconciliation ${label} is out of range.`
    );
  }
  return parsed;
}

function exactBoolean<const Expected extends boolean>(
  value: unknown,
  expected: Expected,
  label: string
): Expected {
  if (value !== expected) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      `The PostgreSQL operator-alert reconciliation ${label} is invalid.`
    );
  }
  return expected;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      `The PostgreSQL operator-alert reconciliation ${label} is invalid.`
    );
  }
  return normalized;
}

function runtimeVersion(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!SEMVER.test(normalized)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation runtime version is invalid."
    );
  }
  return normalized;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlStableHash(expressions: string[]): string {
  const body = expressions.map((expression) =>
    `pg_catalog.octet_length((${expression})::text)::text || ':' || (${expression})::text || '|'`
  ).join(" || ");
  return `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(${body}, 'UTF8')), 'hex')`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  ).join(",")}}`;
}

let cachedCapabilityProjection: Readonly<PostgresOperatorAlertReconciliationCapabilityProjection> | null = null;

export function buildPostgresOperatorAlertReconciliationManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification",
  requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification",
  requestedAlertReconciliationRoleNamespace = "yoink_reconcile_qualification"
): PostgresOperatorAlertReconciliationManifest {
  const schema = schemaName(requestedSchema);
  const namespaces = [
    roleNamespace(requestedReadRoleNamespace, "yoink_qualification"),
    roleNamespace(requestedSessionRoleNamespace, "yoink_session_qualification"),
    roleNamespace(requestedQueueWriteRoleNamespace, "yoink_queue_write_qualification"),
    roleNamespace(requestedControlRoleNamespace, "yoink_control_qualification"),
    roleNamespace(requestedNotificationRecoveryRoleNamespace, "yoink_notify_qualification"),
    roleNamespace(requestedExecutionRecoveryRoleNamespace, "yoink_execute_qualification"),
    roleNamespace(requestedOperationalRetentionRoleNamespace, "yoink_retention_qualification"),
    roleNamespace(requestedObserverCandidateRoleNamespace, "yoink_candidate_qualification"),
    roleNamespace(requestedAlertDispatchRoleNamespace, "yoink_dispatch_qualification"),
    roleNamespace(requestedAlertReconciliationRoleNamespace, "yoink_reconcile_qualification")
  ] as const;
  if (new Set(namespaces).size !== namespaces.length) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "Every PostgreSQL qualification role namespace must be distinct."
    );
  }
  const [readNamespace, sessionNamespace, queueNamespace, controlNamespace,
    notificationNamespace, executionNamespace, retentionNamespace,
    candidateNamespace, dispatchNamespace, reconciliationNamespace] = namespaces;
  const dispatchManifest = buildPostgresOperatorAlertConnectorDispatchManifest(
    schema, readNamespace, sessionNamespace, queueNamespace, controlNamespace,
    notificationNamespace, executionNamespace, retentionNamespace,
    candidateNamespace, dispatchNamespace
  );
  const withoutFingerprint: Omit<PostgresOperatorAlertReconciliationManifest, "fingerprint"> = {
    contractVersion: POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    alertDispatchContractVersion: POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION,
    schemaName: schema,
    readRoleNamespace: readNamespace,
    sessionRoleNamespace: sessionNamespace,
    queueWriteRoleNamespace: queueNamespace,
    controlRoleNamespace: controlNamespace,
    notificationRecoveryRoleNamespace: notificationNamespace,
    executionRecoveryRoleNamespace: executionNamespace,
    operationalRetentionRoleNamespace: retentionNamespace,
    observerCandidateRoleNamespace: candidateNamespace,
    alertDispatchRoleNamespace: dispatchNamespace,
    alertReconciliationRoleNamespace: reconciliationNamespace,
    alertDispatchManifestFingerprint: dispatchManifest.fingerprint,
    alertReconciliationRole: {
      kind: "operator_alert_diagnostic_reconciliation_boundary",
      name: roleName(reconciliationNamespace),
      functionName: POSTGRES_OPERATOR_ALERT_RECONCILIATION_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTableNames: [...PROTECTED_TABLES],
      forcedRlsTableNames: [...PROTECTED_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTableCount: 10,
    forcedRlsTableCount: 10,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    qualifiedHandlerTaskKinds: [...QUALIFIED_HANDLER_TASK_KINDS],
    qualifiedHandlerTaskKindCount: 5,
    totalHandlerTaskKindCount: BACKGROUND_TASK_KINDS.length,
    maximumDiagnostics: POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_DIAGNOSTICS,
    maximumGroups: POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_GROUPS,
    maximumActions: POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_ACTIONS,
    maximumRules: POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_RULES,
    maximumConnectors: POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_CONNECTORS,
    maximumConnectorPayloadBytes: MAXIMUM_CONNECTOR_PAYLOAD_BYTES,
    serverDerivedRepairGroups: true,
    databaseEvidenceRevalidation: true,
    twoPhasePlanApply: true,
    databaseServerClock: true,
    applicationGeneratedOpaqueIds: true,
    sanitizedAggregateOnly: true,
    endpointReferencesOnly: true,
    rawUrlsAccessible: false,
    connectorSecretsAccessible: false,
    alertDispatchRepositoryParity: true,
    alertReconciliationRepositoryParity: true,
    fullHandlerRepositoryParity: true,
    mutationAuthority: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresOperatorAlertReconciliationCapabilityProjection():
PostgresOperatorAlertReconciliationCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresOperatorAlertReconciliationManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    alertDispatchContractVersion: 1,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactEffectivePrivilegeVerification: true,
    immutableBoundaryCatalogFingerprint: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    securityDefinerRoutineVerified: true,
    serverBoundPrincipalLookup: true,
    serverDerivedRepairGroups: true,
    databaseEvidenceRevalidation: true,
    twoPhasePlanApply: true,
    databaseServerClock: true,
    applicationGeneratedOpaqueIds: true,
    sanitizedAggregateOnly: true,
    endpointReferencesOnly: true,
    rawUrlsAccessible: false,
    connectorSecretsAccessible: false,
    readCommittedTransactionAdapter: true,
    alertDispatchRepositoryParity: true,
    alertReconciliationRepositoryParity: true,
    fullHandlerRepositoryParity: true,
    handlerTaskKindCount: 5,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    maximumDiagnostics: 2_000,
    maximumGroups: 50,
    maximumActions: 50,
    maximumRules: 50,
    maximumConnectors: 20,
    maximumConnectorPayloadBytes: 4_000,
    protectedTableCount: 10,
    forcedRlsTableCount: 10,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export function operatorAlertReconciliationFunctionSource(
  manifest: PostgresOperatorAlertReconciliationManifest
): string {
  const incidentKeyHash = sqlStableHash([
    sqlLiteral("yoink_operator_alert_adapter_repair_v1"),
    "selected.retailer_id",
    "selected.operation",
    "selected.layout_fingerprint"
  ]);
  const payloadHash = sqlStableHash([
    sqlLiteral("yoink_operator_alert_connector_payload_v1"),
    "proposed_connector->>'payloadJson'"
  ]);
  const idempotencyHash = sqlStableHash([
    sqlLiteral("yoink_operator_alert_connector_idempotency_v1"),
    "resolved_tenant_id",
    "proposed_connector->>'connectorId'",
    "proposed_event->>'eventId'"
  ]);
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  evaluation_clock TIMESTAMPTZ;
  evaluation_timestamp TEXT;
  enabled_rule_count BIGINT;
  enabled_connector_count BIGINT;
  evidence_plan JSONB;
  action_payload JSONB;
  planned_action JSONB;
  proposed_action JSONB;
  planned_event JSONB;
  proposed_event JSONB;
  planned_connector JSONB;
  proposed_connector JSONB;
  proposed_count BIGINT;
  proposed_key_count BIGINT;
  affected_rows BIGINT;
  event_sequence BIGINT;
  event_metadata JSONB;
  audit_data JSONB;
  audit_message TEXT;
  expected_payload JSONB;
  opened_count BIGINT := 0;
  updated_count BIGINT := 0;
  resolved_count BIGINT := 0;
  escalated_count BIGINT := 0;
  routed_count BIGINT := 0;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected operator-alert reconciliation principal is invalid';
  END IF;
  IF runtime_version !~ '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation runtime version is invalid';
  END IF;
  IF operation_name NOT IN ('plan', 'apply') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation operation is invalid';
  END IF;
  IF correlation_id !~ '^alertcorr_[a-f0-9]{48}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation correlation is invalid';
  END IF;
  IF pg_catalog.octet_length(action_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation payload exceeds its bound';
  END IF;
  SELECT MIN(principal.tenant_id), MIN(principal.user_id), COUNT(*)
    INTO resolved_tenant_id, resolved_user_id, resolved_principal_count
  FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)} AS principal
  WHERE principal.principal_role = session_user::text AND principal.active = TRUE;
  IF resolved_principal_count <> 1 OR resolved_tenant_id IS NULL OR resolved_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal is not active';
  END IF;
  IF resolved_tenant_id <> expected_tenant_id OR resolved_user_id <> expected_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal does not match the expected authenticated principal';
  END IF;
  IF operation_name = 'plan' THEN
    IF evaluation_timestamp_input <> '' OR action_payload_json::jsonb <> '[]'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF pg_catalog.abs(EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock)))
         > ${APPLY_TIMESTAMP_SKEW_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation plan expired before apply';
    END IF;
  END IF;
  evaluation_timestamp := pg_catalog.to_char(
    evaluation_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yoink_operator_alert_reconciliation_v1:' || resolved_tenant_id || ':' || resolved_user_id,
      0
    )
  );

  SELECT COUNT(*) INTO enabled_rule_count
  FROM ${relation(manifest.schemaName, "operator_alert_rules")} AS rule
  WHERE rule.tenant_id = resolved_tenant_id AND rule.enabled = 1
    AND rule.event_family = 'adapter_repair';
  IF enabled_rule_count > ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_RULES} THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'operator-alert reconciliation rule count exceeds its bound';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ${relation(manifest.schemaName, "operator_alert_rules")} AS rule
    WHERE rule.tenant_id = resolved_tenant_id AND rule.enabled = 1
      AND (pg_catalog.jsonb_typeof(rule.routes_json::jsonb) <> 'array'
        OR pg_catalog.jsonb_array_length(rule.routes_json::jsonb) NOT BETWEEN 1 AND 2
        OR EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements_text(rule.routes_json::jsonb) AS route(value)
          WHERE route.value NOT IN ('dashboard', 'audit_outbox')
        )
        OR (SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements_text(rule.routes_json::jsonb))
          <> (SELECT COUNT(DISTINCT value) FROM pg_catalog.jsonb_array_elements_text(rule.routes_json::jsonb))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation route configuration is invalid';
  END IF;
  SELECT COUNT(*) INTO enabled_connector_count
  FROM ${relation(manifest.schemaName, "operator_alert_connectors")} AS connector
  WHERE connector.tenant_id = resolved_tenant_id AND connector.enabled = 1;
  IF enabled_connector_count > ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_CONNECTORS} THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'operator-alert reconciliation connector count exceeds its bound';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT diagnostic.layout_fingerprint, diagnostic.received_at
      FROM ${relation(manifest.schemaName, "retailer_adapter_diagnostics")} AS diagnostic
      WHERE diagnostic.tenant_id = resolved_tenant_id AND diagnostic.user_id = resolved_user_id
      ORDER BY diagnostic.received_at DESC, diagnostic.id DESC
      LIMIT ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_DIAGNOSTICS}
    ) AS recent_validation
    WHERE recent_validation.layout_fingerprint !~ '^[a-f0-9]{64}$'
      OR recent_validation.received_at !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation diagnostic evidence is invalid';
  END IF;

  WITH recent AS MATERIALIZED (
    SELECT diagnostic.id, diagnostic.device_id, diagnostic.retailer_id,
           diagnostic.retailer_sku, diagnostic.adapter_version,
           diagnostic.operation, diagnostic.outcome, diagnostic.failure_stage,
           diagnostic.reason_code, diagnostic.attempt_count, diagnostic.dom_changed,
           diagnostic.layout_fingerprint, diagnostic.received_at
    FROM ${relation(manifest.schemaName, "retailer_adapter_diagnostics")} AS diagnostic
    WHERE diagnostic.tenant_id = resolved_tenant_id
      AND diagnostic.user_id = resolved_user_id
    ORDER BY diagnostic.received_at DESC, diagnostic.id DESC
    LIMIT ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_DIAGNOSTICS}
  ), group_aggregates AS (
    SELECT retailer_id, operation, layout_fingerprint,
           COUNT(*) FILTER (WHERE outcome IN ('failed', 'recovered')) AS repair_count,
           COUNT(DISTINCT retailer_sku) FILTER (WHERE outcome IN ('failed', 'recovered')) AS affected_sku_count,
           MAX(attempt_count) FILTER (WHERE outcome IN ('failed', 'recovered')) AS maximum_attempt_count,
           pg_catalog.bool_or(dom_changed = 1) FILTER (WHERE outcome IN ('failed', 'recovered')) AS dom_changed_seen,
           MIN(received_at) FILTER (WHERE outcome IN ('failed', 'recovered')) AS first_seen_at,
           MAX(received_at) FILTER (WHERE outcome = 'failed') AS last_failure_at,
           MAX(received_at) FILTER (WHERE outcome IN ('passed', 'recovered')) AS last_recovery_at,
           pg_catalog.bool_and(
             failure_stage = 'runner' AND reason_code IN (
               'observer_bundle_injection_failed', 'observer_execution_failed',
               'observer_top_frame_missing', 'observer_runtime_unavailable',
               'observer_collection_failed', 'observer_contract_invalid'
             )
           ) FILTER (WHERE outcome IN ('failed', 'recovered')) AS runtime_failure_group
    FROM recent
    GROUP BY retailer_id, operation, layout_fingerprint
    HAVING COUNT(*) FILTER (WHERE outcome IN ('failed', 'recovered')) > 0
  ), latest_rows AS (
    SELECT DISTINCT ON (retailer_id, operation, layout_fingerprint)
           retailer_id, operation, layout_fingerprint, adapter_version,
           retailer_sku, failure_stage, reason_code, received_at
    FROM recent
    ORDER BY retailer_id, operation, layout_fingerprint, received_at DESC, id DESC
  ), latest_repairs AS (
    SELECT DISTINCT ON (retailer_id, operation, layout_fingerprint)
           retailer_id, operation, layout_fingerprint, retailer_sku,
           failure_stage, reason_code, received_at
    FROM recent
    WHERE outcome IN ('failed', 'recovered')
    ORDER BY retailer_id, operation, layout_fingerprint, received_at DESC, id DESC
  ), latest_failures AS (
    SELECT DISTINCT ON (retailer_id, operation, layout_fingerprint, retailer_sku)
           retailer_id, operation, layout_fingerprint, retailer_sku,
           adapter_version, received_at
    FROM recent
    WHERE outcome = 'failed'
    ORDER BY retailer_id, operation, layout_fingerprint, retailer_sku,
             received_at DESC, id DESC
  ), group_recovery_state AS (
    SELECT aggregate.retailer_id, aggregate.operation, aggregate.layout_fingerprint,
           aggregate.repair_count, aggregate.affected_sku_count,
           aggregate.maximum_attempt_count, aggregate.dom_changed_seen,
           aggregate.first_seen_at, aggregate.last_failure_at,
           aggregate.last_recovery_at, aggregate.runtime_failure_group,
           pg_catalog.bool_or(NOT EXISTS (
             SELECT 1 FROM recent AS recovery
             WHERE recovery.retailer_id = failure.retailer_id
               AND recovery.operation = 'observe'
               AND recovery.retailer_sku = failure.retailer_sku
               AND recovery.received_at > failure.received_at
               AND recovery.outcome IN ('passed', 'recovered')
           )) FILTER (WHERE failure.retailer_sku IS NOT NULL) AS runtime_sku_still_open,
           MAX((
             SELECT MAX(recovery.received_at) FROM recent AS recovery
             WHERE recovery.retailer_id = failure.retailer_id
               AND recovery.operation = 'observe'
               AND recovery.retailer_sku = failure.retailer_sku
               AND recovery.received_at > failure.received_at
               AND recovery.outcome IN ('passed', 'recovered')
           )) AS external_recovery_at,
           pg_catalog.bool_and(EXISTS (
             SELECT 1 FROM recent AS replacement
             WHERE replacement.retailer_id = failure.retailer_id
               AND replacement.operation = failure.operation
               AND replacement.retailer_sku = failure.retailer_sku
               AND replacement.received_at > failure.received_at
               AND replacement.outcome <> 'failed'
               AND replacement.adapter_version ~ '^(.*)-v[0-9]+$'
               AND failure.adapter_version ~ '^(.*)-v[0-9]+$'
               AND pg_catalog.substring(replacement.adapter_version, '^(.*)-v[0-9]+$')
                 = pg_catalog.substring(failure.adapter_version, '^(.*)-v[0-9]+$')
               AND pg_catalog.substring(replacement.adapter_version, '-v([0-9]+)$')::BIGINT
                 > pg_catalog.substring(failure.adapter_version, '-v([0-9]+)$')::BIGINT
           )) FILTER (WHERE failure.retailer_sku IS NOT NULL) AS fully_superseded,
           MAX((
             SELECT MAX(replacement.received_at) FROM recent AS replacement
             WHERE replacement.retailer_id = failure.retailer_id
               AND replacement.operation = failure.operation
               AND replacement.retailer_sku = failure.retailer_sku
               AND replacement.received_at > failure.received_at
               AND replacement.outcome <> 'failed'
               AND replacement.adapter_version ~ '^(.*)-v[0-9]+$'
               AND failure.adapter_version ~ '^(.*)-v[0-9]+$'
               AND pg_catalog.substring(replacement.adapter_version, '^(.*)-v[0-9]+$')
                 = pg_catalog.substring(failure.adapter_version, '^(.*)-v[0-9]+$')
               AND pg_catalog.substring(replacement.adapter_version, '-v([0-9]+)$')::BIGINT
                 > pg_catalog.substring(failure.adapter_version, '-v([0-9]+)$')::BIGINT
           )) AS superseding_recovery_at
    FROM group_aggregates AS aggregate
    LEFT JOIN latest_failures AS failure USING (retailer_id, operation, layout_fingerprint)
    GROUP BY aggregate.retailer_id, aggregate.operation, aggregate.layout_fingerprint,
             aggregate.repair_count, aggregate.affected_sku_count,
             aggregate.maximum_attempt_count, aggregate.dom_changed_seen,
             aggregate.first_seen_at, aggregate.last_failure_at,
             aggregate.last_recovery_at, aggregate.runtime_failure_group
  ), repair_groups AS (
    SELECT state.retailer_id, state.operation, state.layout_fingerprint,
           CASE
             WHEN state.runtime_failure_group AND state.operation = 'observe'
               THEN CASE WHEN COALESCE(state.runtime_sku_still_open, FALSE) THEN 'open' ELSE 'recovered' END
             WHEN state.last_failure_at IS NOT NULL
               AND (state.last_recovery_at IS NULL OR state.last_failure_at > state.last_recovery_at)
               AND NOT COALESCE(state.fully_superseded, FALSE) THEN 'open'
             ELSE 'recovered'
           END AS repair_status,
           latest.adapter_version AS latest_adapter_version,
           repair.retailer_sku AS latest_retailer_sku,
           repair.failure_stage, repair.reason_code,
           state.repair_count, state.affected_sku_count,
           state.maximum_attempt_count, state.dom_changed_seen,
           state.first_seen_at, state.last_failure_at,
           COALESCE(state.superseding_recovery_at, state.external_recovery_at,
                    state.last_recovery_at, '') AS last_recovery_at,
           GREATEST(
             latest.received_at,
             COALESCE(state.superseding_recovery_at, ''),
             COALESCE(state.external_recovery_at, ''),
             COALESCE(state.last_recovery_at, '')
           ) AS last_seen_at
    FROM group_recovery_state AS state
    JOIN latest_rows AS latest USING (retailer_id, operation, layout_fingerprint)
    JOIN latest_repairs AS repair USING (retailer_id, operation, layout_fingerprint)
  ), selected_groups AS (
    SELECT * FROM repair_groups
    ORDER BY CASE WHEN repair_status = 'open' THEN 1 ELSE 0 END DESC,
             last_seen_at DESC, retailer_id, operation, layout_fingerprint
    LIMIT ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_GROUPS}
  ), matched_pairs AS (
    SELECT selected.*, rule.id AS rule_id, rule.name AS rule_name,
           rule.severity AS rule_severity,
           rule.minimum_occurrences, rule.dedupe_window_seconds,
           rule.escalation_after_seconds, rule.routes_json::jsonb AS routes,
           ${incidentKeyHash} AS incident_key_hash
    FROM selected_groups AS selected
    JOIN ${relation(manifest.schemaName, "operator_alert_rules")} AS rule
      ON rule.tenant_id = resolved_tenant_id AND rule.enabled = 1
      AND rule.event_family = 'adapter_repair'
      AND (rule.retailer_scope = '*' OR rule.retailer_scope = selected.retailer_id)
      AND (rule.operation_scope = '*' OR rule.operation_scope = selected.operation)
  ), pair_incidents AS (
    SELECT pair.*,
           incident.id AS active_incident_id, incident.severity AS active_severity,
           incident.title AS active_title, incident.summary AS active_summary,
           incident.failure_stage AS active_failure_stage,
           incident.reason_code AS active_reason_code,
           incident.occurrence_count AS active_occurrence_count,
           incident.affected_entity_count AS active_affected_entity_count,
           incident.first_seen_at AS active_first_seen_at,
           incident.last_seen_at AS active_last_seen_at,
           incident.last_failure_at AS active_last_failure_at,
           incident.last_routed_at AS active_last_routed_at,
           incident.escalated_at AS active_escalated_at,
           previous.resolved_at AS previous_resolved_at
    FROM matched_pairs AS pair
    LEFT JOIN LATERAL (
      SELECT active.*
      FROM ${relation(manifest.schemaName, "operator_alert_incidents")} AS active
      WHERE active.tenant_id = resolved_tenant_id
        AND active.subject_user_id = resolved_user_id
        AND active.rule_id = pair.rule_id
        AND active.incident_key_hash = pair.incident_key_hash
        AND active.status IN ('open', 'acknowledged')
      ORDER BY active.updated_at DESC, active.id DESC LIMIT 1
    ) AS incident ON TRUE
    LEFT JOIN LATERAL (
      SELECT resolved.resolved_at
      FROM ${relation(manifest.schemaName, "operator_alert_incidents")} AS resolved
      WHERE resolved.tenant_id = resolved_tenant_id
        AND resolved.subject_user_id = resolved_user_id
        AND resolved.rule_id = pair.rule_id
        AND resolved.incident_key_hash = pair.incident_key_hash
        AND resolved.status = 'resolved'
      ORDER BY resolved.resolved_at DESC, resolved.id DESC LIMIT 1
    ) AS previous ON TRUE
  ), decisions AS (
    SELECT pair.*,
           (pair.active_incident_id IS NOT NULL AND pair.repair_status = 'open'
             AND (pair.last_seen_at > pair.active_last_seen_at
               OR pair.repair_count > pair.active_occurrence_count
               OR pair.affected_sku_count > pair.active_affected_entity_count)) AS content_changed,
           (pair.repair_status = 'open' AND pair.escalation_after_seconds > 0
             AND COALESCE(pair.active_escalated_at, '') = ''
             AND CASE
               WHEN COALESCE(pair.active_first_seen_at, pair.first_seen_at)
                    ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
               THEN COALESCE(pair.active_first_seen_at, pair.first_seen_at)::timestamptz
                    + pg_catalog.make_interval(secs => pair.escalation_after_seconds)
                    <= evaluation_clock
               ELSE FALSE END) AS escalation_due,
           (pair.active_incident_id IS NOT NULL AND pair.repair_status = 'open'
             AND pair.last_seen_at > COALESCE(pair.active_last_routed_at, '')
             AND CASE
               WHEN pair.active_last_routed_at
                    ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
               THEN pair.active_last_routed_at::timestamptz
                    + pg_catalog.make_interval(secs => pair.dedupe_window_seconds)
                    <= evaluation_clock
               ELSE FALSE END) AS reroute_due
    FROM pair_incidents AS pair
  ), actionable AS (
    SELECT decision.*,
           CASE
             WHEN repair_status = 'recovered' THEN 'resolve'
             WHEN active_incident_id IS NULL THEN 'open'
             ELSE 'update'
           END AS mutation,
           CASE
             WHEN active_incident_id IS NULL AND repair_status = 'open'
               THEN ARRAY['opened']::text[] || CASE WHEN escalation_due
                    THEN ARRAY['escalated']::text[] ELSE ARRAY[]::text[] END
             WHEN repair_status = 'recovered' THEN ARRAY['auto_resolved']::text[]
             WHEN escalation_due THEN ARRAY['escalated']::text[]
             WHEN reroute_due THEN ARRAY['repeated']::text[]
             ELSE ARRAY[]::text[]
           END AS event_types,
           CASE
             WHEN escalation_due THEN CASE COALESCE(active_severity, rule_severity)
               WHEN 'info' THEN 'warning' WHEN 'warning' THEN 'error' ELSE 'critical' END
             ELSE COALESCE(active_severity, rule_severity)
           END AS final_severity,
           CASE WHEN active_incident_id IS NULL
             THEN CASE retailer_id
               WHEN 'target' THEN 'Target' WHEN 'walmart' THEN 'Walmart'
               WHEN 'amazon' THEN 'Amazon' WHEN 'bestbuy' THEN 'Best Buy'
               WHEN 'disney' THEN 'Disney Store' WHEN 'ravensburger' THEN 'Ravensburger'
               WHEN 'riot' THEN 'Riot Games Merch' WHEN 'booksamillion' THEN 'Books-A-Million'
               WHEN 'fanatics' THEN 'Fanatics' WHEN 'kohls' THEN 'Kohl''s'
               WHEN 'macys' THEN 'Macy''s' WHEN 'pbandai' THEN 'Premium Bandai'
               WHEN 'pokemoncenter' THEN 'Pokémon Center' ELSE retailer_id END
               || ' adapter repair required'
             ELSE active_title END AS final_title,
           CASE WHEN active_incident_id IS NULL OR content_changed
             THEN (CASE retailer_id
               WHEN 'target' THEN 'Target' WHEN 'walmart' THEN 'Walmart'
               WHEN 'amazon' THEN 'Amazon' WHEN 'bestbuy' THEN 'Best Buy'
               WHEN 'disney' THEN 'Disney Store' WHEN 'ravensburger' THEN 'Ravensburger'
               WHEN 'riot' THEN 'Riot Games Merch' WHEN 'booksamillion' THEN 'Books-A-Million'
               WHEN 'fanatics' THEN 'Fanatics' WHEN 'kohls' THEN 'Kohl''s'
               WHEN 'macys' THEN 'Macy''s' WHEN 'pbandai' THEN 'Premium Bandai'
               WHEN 'pokemoncenter' THEN 'Pokémon Center' ELSE retailer_id END)
               || ' ' || pg_catalog.replace(operation, '_', ' ')
               || ' reported ' || pg_catalog.replace(reason_code, '_', ' ')
               || ' during ' || pg_catalog.replace(failure_stage, '_', ' ')
               || ' across ' || affected_sku_count::text || ' exact product'
               || CASE WHEN affected_sku_count = 1 THEN '' ELSE 's' END || '.'
             ELSE active_summary END AS final_summary,
           CASE WHEN repair_status = 'recovered' THEN active_failure_stage ELSE failure_stage END AS final_failure_stage,
           CASE WHEN repair_status = 'recovered' THEN active_reason_code ELSE reason_code END AS final_reason_code,
           CASE WHEN repair_status = 'recovered' THEN active_occurrence_count
             ELSE GREATEST(COALESCE(active_occurrence_count, 1), repair_count) END AS final_occurrence_count,
           CASE WHEN repair_status = 'recovered' THEN active_affected_entity_count
             ELSE GREATEST(COALESCE(active_affected_entity_count, 1), affected_sku_count, 1) END AS final_affected_entity_count,
           COALESCE(active_first_seen_at, first_seen_at) AS final_first_seen_at,
           CASE WHEN repair_status = 'recovered' THEN last_seen_at
                ELSE GREATEST(COALESCE(active_last_seen_at, ''), last_seen_at) END AS final_last_seen_at,
           GREATEST(COALESCE(active_last_failure_at, ''), COALESCE(last_failure_at, '')) AS final_last_failure_at
    FROM decisions AS decision
    WHERE (repair_status = 'recovered' AND active_incident_id IS NOT NULL)
       OR (repair_status = 'open' AND repair_count >= minimum_occurrences
         AND ((active_incident_id IS NULL
             AND (previous_resolved_at IS NULL OR last_failure_at > previous_resolved_at))
           OR (active_incident_id IS NOT NULL AND (content_changed OR escalation_due OR reroute_due))))
  ), selected_actions AS (
    SELECT * FROM actionable
    ORDER BY last_seen_at DESC, rule_id, retailer_id, operation, layout_fingerprint
    LIMIT ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_ACTIONS}
  )
  SELECT pg_catalog.jsonb_build_object(
    'evaluationTimestamp', evaluation_timestamp,
    'repairGroupsEvaluated', (SELECT COUNT(*) FROM repair_groups),
    'actionablePairs', (SELECT COUNT(*) FROM actionable),
    'actionsDeferred', GREATEST(0, (SELECT COUNT(*) FROM actionable)
      - ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_ACTIONS}),
    'maximumDiagnostics', ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_DIAGNOSTICS},
    'maximumGroups', ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_GROUPS},
    'maximumActions', ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_ACTIONS},
    'selectedActions', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'actionKey', action.rule_id || ':' || action.incident_key_hash,
        'mutation', action.mutation,
        'contentChanged', action.content_changed,
        'incidentId', COALESCE(action.active_incident_id, ''),
        'incidentKeyHash', action.incident_key_hash,
        'ruleId', action.rule_id,
        'routes', action.routes,
        'severity', action.final_severity,
        'title', action.final_title,
        'summary', action.final_summary,
        'retailerId', action.retailer_id,
        'operation', action.operation,
        'failureStage', action.final_failure_stage,
        'reasonCode', action.final_reason_code,
        'layoutFingerprint', action.layout_fingerprint,
        'occurrenceCount', action.final_occurrence_count,
        'affectedEntityCount', action.final_affected_entity_count,
        'sourceOccurrenceCount', action.repair_count,
        'sourceAffectedEntityCount', action.affected_sku_count,
        'firstSeenAt', action.final_first_seen_at,
        'lastSeenAt', action.final_last_seen_at,
        'lastFailureAt', action.final_last_failure_at,
        'escalationDue', action.escalation_due,
        'events', COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'eventType', event.event_type,
            'severity', event.event_severity,
            'reasonCode', event.event_reason_code,
            'connectors', COALESCE((
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'connectorId', connector.id,
                'endpointReference', connector.endpoint_reference,
                'endpointBindingFingerprint', connector.endpoint_binding_fingerprint
              ) ORDER BY connector.id)
              FROM ${relation(manifest.schemaName, "operator_alert_connectors")} AS connector
              WHERE connector.tenant_id = resolved_tenant_id AND connector.enabled = 1
                AND (CASE event.event_severity
                  WHEN 'info' THEN 0 WHEN 'warning' THEN 1 WHEN 'error' THEN 2 ELSE 3 END)
                  >= (CASE connector.minimum_severity
                    WHEN 'info' THEN 0 WHEN 'warning' THEN 1 WHEN 'error' THEN 2 ELSE 3 END)
            ), '[]'::jsonb)
          ) ORDER BY event.ordinality)
          FROM (
            SELECT item.event_type, item.ordinality,
                   CASE
                     WHEN item.event_type = 'opened' THEN action.rule_severity
                     WHEN item.event_type = 'escalated' THEN action.final_severity
                     ELSE COALESCE(action.active_severity, action.final_severity)
                   END AS event_severity,
                   CASE item.event_type
                     WHEN 'auto_resolved' THEN 'adapter_recovered'
                     WHEN 'escalated' THEN 'escalation_window_elapsed'
                     ELSE action.reason_code
                   END AS event_reason_code
            FROM pg_catalog.unnest(action.event_types) WITH ORDINALITY AS item(event_type, ordinality)
          ) AS event
        ), '[]'::jsonb)
      ) ORDER BY action.last_seen_at DESC, action.rule_id,
                 action.retailer_id, action.operation, action.layout_fingerprint)
      FROM selected_actions AS action
    ), '[]'::jsonb)
  ) INTO evidence_plan;

  IF operation_name = 'plan' THEN
    RETURN QUERY SELECT evidence_plan::text;
    RETURN;
  END IF;

  action_payload := action_payload_json::jsonb;
  IF pg_catalog.jsonb_typeof(action_payload) <> 'array'
    OR pg_catalog.jsonb_array_length(action_payload)
      <> pg_catalog.jsonb_array_length(evidence_plan->'selectedActions')
    OR pg_catalog.jsonb_array_length(action_payload)
      > ${POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_ACTIONS} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation apply set does not match its evidence plan';
  END IF;

  FOR planned_action IN
    SELECT value FROM pg_catalog.jsonb_array_elements(evidence_plan->'selectedActions') AS item(value)
  LOOP
    SELECT COUNT(*), MIN(item.value::text)::jsonb
      INTO proposed_count, proposed_action
    FROM pg_catalog.jsonb_array_elements(action_payload) AS item(value)
    WHERE item.value->>'actionKey' = planned_action->>'actionKey';
    IF proposed_count <> 1 OR proposed_action IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation apply action is missing or duplicated';
    END IF;
    SELECT COUNT(*) INTO proposed_key_count FROM pg_catalog.jsonb_object_keys(proposed_action);
    IF proposed_key_count <> 3
      OR NOT proposed_action ?& ARRAY['actionKey', 'incidentId', 'events']::text[]
      OR proposed_action->>'actionKey' <> planned_action->>'actionKey'
      OR pg_catalog.jsonb_typeof(proposed_action->'events') <> 'array'
      OR pg_catalog.jsonb_array_length(proposed_action->'events')
        <> pg_catalog.jsonb_array_length(planned_action->'events')
      OR proposed_action->>'incidentId' !~ '^alert_incident_[a-f0-9]{32}$'
      OR (planned_action->>'incidentId' <> ''
        AND proposed_action->>'incidentId' <> planned_action->>'incidentId') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation apply action failed plan revalidation';
    END IF;

    IF planned_action->>'mutation' = 'open' THEN
      INSERT INTO ${relation(manifest.schemaName, "operator_alert_incidents")}(
        id, tenant_id, subject_user_id, rule_id, event_family, incident_key_hash,
        severity, status, privacy_classification, title, summary, retailer_id,
        operation, failure_stage, reason_code, layout_fingerprint,
        occurrence_count, affected_entity_count, first_seen_at, last_seen_at,
        last_failure_at, last_routed_at, escalated_at, created_at, updated_at
      ) VALUES (
        proposed_action->>'incidentId', resolved_tenant_id, resolved_user_id,
        planned_action->>'ruleId', 'adapter_repair', planned_action->>'incidentKeyHash',
        planned_action->>'severity', 'open', 'operational_aggregate',
        planned_action->>'title', planned_action->>'summary', planned_action->>'retailerId',
        planned_action->>'operation', planned_action->>'failureStage',
        planned_action->>'reasonCode', planned_action->>'layoutFingerprint',
        (planned_action->>'occurrenceCount')::BIGINT,
        (planned_action->>'affectedEntityCount')::BIGINT,
        planned_action->>'firstSeenAt', planned_action->>'lastSeenAt',
        planned_action->>'lastFailureAt', evaluation_timestamp,
        CASE WHEN (planned_action->>'escalationDue')::BOOLEAN
          THEN evaluation_timestamp ELSE '' END,
        evaluation_timestamp, evaluation_timestamp
      );
      opened_count := opened_count + 1;
    ELSIF planned_action->>'mutation' = 'resolve' THEN
      UPDATE ${relation(manifest.schemaName, "operator_alert_incidents")}
      SET status = 'resolved', last_seen_at = planned_action->>'lastSeenAt',
          resolved_by_actor_id = session_user::text,
          resolved_at = evaluation_timestamp, resolution_code = 'adapter_recovered',
          updated_at = evaluation_timestamp
      WHERE id = proposed_action->>'incidentId'
        AND tenant_id = resolved_tenant_id AND subject_user_id = resolved_user_id
        AND status IN ('open', 'acknowledged');
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'operator-alert reconciliation incident resolution changed after planning';
      END IF;
      resolved_count := resolved_count + 1;
    ELSIF planned_action->>'mutation' = 'update' THEN
      UPDATE ${relation(manifest.schemaName, "operator_alert_incidents")}
      SET summary = planned_action->>'summary',
          failure_stage = planned_action->>'failureStage',
          reason_code = planned_action->>'reasonCode',
          occurrence_count = GREATEST(occurrence_count, (planned_action->>'occurrenceCount')::BIGINT),
          affected_entity_count = GREATEST(affected_entity_count, (planned_action->>'affectedEntityCount')::BIGINT),
          last_seen_at = GREATEST(last_seen_at, planned_action->>'lastSeenAt'),
          last_failure_at = GREATEST(last_failure_at, planned_action->>'lastFailureAt'),
          severity = planned_action->>'severity',
          escalated_at = CASE WHEN (planned_action->>'escalationDue')::BOOLEAN
            THEN evaluation_timestamp ELSE escalated_at END,
          last_routed_at = CASE WHEN pg_catalog.jsonb_array_length(planned_action->'events') > 0
            THEN evaluation_timestamp ELSE last_routed_at END,
          updated_at = evaluation_timestamp
      WHERE id = proposed_action->>'incidentId'
        AND tenant_id = resolved_tenant_id AND subject_user_id = resolved_user_id
        AND status IN ('open', 'acknowledged');
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'operator-alert reconciliation incident update changed after planning';
      END IF;
      IF (planned_action->>'contentChanged')::BOOLEAN THEN
        updated_count := updated_count + 1;
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation mutation is invalid';
    END IF;

    event_sequence := 0;
    FOR planned_event IN
      SELECT value FROM pg_catalog.jsonb_array_elements(planned_action->'events') AS item(value)
    LOOP
      event_sequence := event_sequence + 1;
      proposed_event := proposed_action->'events'->((event_sequence - 1)::INTEGER);
      IF proposed_event IS NULL OR pg_catalog.jsonb_typeof(proposed_event) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation event payload is missing';
      END IF;
      SELECT COUNT(*) INTO proposed_key_count FROM pg_catalog.jsonb_object_keys(proposed_event);
      IF proposed_key_count <> 7
        OR NOT proposed_event ?& ARRAY[
          'eventType', 'eventId', 'auditId', 'outboxId',
          'routeDeliveries', 'connectorDeliveries', 'eventOrdinal'
        ]::text[]
        OR proposed_event->>'eventType' <> planned_event->>'eventType'
        OR (proposed_event->>'eventOrdinal')::BIGINT <> event_sequence
        OR proposed_event->>'eventId' !~ '^alert_event_[a-f0-9]{32}$'
        OR proposed_event->>'auditId' !~ '^audit_[a-f0-9]{32}$'
        OR proposed_event->>'outboxId' !~ '^outbox_[a-f0-9]{32}$'
        OR pg_catalog.jsonb_typeof(proposed_event->'routeDeliveries') <> 'array'
        OR pg_catalog.jsonb_array_length(proposed_event->'routeDeliveries')
          <> pg_catalog.jsonb_array_length(planned_action->'routes')
        OR pg_catalog.jsonb_typeof(proposed_event->'connectorDeliveries') <> 'array'
        OR pg_catalog.jsonb_array_length(proposed_event->'connectorDeliveries')
          <> pg_catalog.jsonb_array_length(planned_event->'connectors') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation event payload failed revalidation';
      END IF;

      IF planned_event->>'eventType' = 'opened' THEN
        event_metadata := pg_catalog.jsonb_build_object(
          'retailerId', planned_action->>'retailerId',
          'operation', planned_action->>'operation',
          'layoutFingerprint', planned_action->>'layoutFingerprint',
          'failureStage', planned_action->>'failureStage',
          'occurrenceCount', (planned_action->>'sourceOccurrenceCount')::BIGINT,
          'affectedEntityCount', (planned_action->>'sourceAffectedEntityCount')::BIGINT
        );
      ELSIF planned_event->>'eventType' = 'auto_resolved' THEN
        event_metadata := pg_catalog.jsonb_build_object(
          'retailerId', planned_action->>'retailerId',
          'operation', planned_action->>'operation',
          'layoutFingerprint', planned_action->>'layoutFingerprint',
          'occurrenceCount', (planned_action->>'sourceOccurrenceCount')::BIGINT,
          'affectedEntityCount', (planned_action->>'sourceAffectedEntityCount')::BIGINT
        );
      ELSIF planned_event->>'eventType' = 'repeated' THEN
        event_metadata := pg_catalog.jsonb_build_object(
          'retailerId', planned_action->>'retailerId',
          'operation', planned_action->>'operation',
          'layoutFingerprint', planned_action->>'layoutFingerprint',
          'occurrenceCount', (planned_action->>'sourceOccurrenceCount')::BIGINT
        );
      ELSE
        event_metadata := pg_catalog.jsonb_build_object(
          'retailerId', planned_action->>'retailerId',
          'operation', planned_action->>'operation',
          'layoutFingerprint', planned_action->>'layoutFingerprint'
        );
      END IF;
      audit_data := pg_catalog.jsonb_build_object(
        'incidentId', proposed_action->>'incidentId',
        'ruleId', planned_action->>'ruleId',
        'severity', planned_event->>'severity',
        'eventFamily', 'adapter_repair',
        'privacyClassification', 'operational_aggregate'
      ) || event_metadata;
      audit_message := 'An operator alert was '
        || pg_catalog.replace(planned_event->>'eventType', '_', ' ') || '.';

      INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
        id, tenant_id, user_id, correlation_id, event_type,
        reason_code, message, data_json, created_at
      ) VALUES (
        proposed_event->>'auditId', resolved_tenant_id, resolved_user_id,
        correlation_id, 'operator_alert_' || (planned_event->>'eventType'),
        planned_event->>'reasonCode', audit_message, audit_data::text,
        evaluation_timestamp
      );
      INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
        id, tenant_id, aggregate_type, aggregate_id, event_type,
        payload_json, created_at, delivered_at
      ) VALUES (
        proposed_event->>'outboxId', resolved_tenant_id,
        'operator_alert_incident', correlation_id,
        'operator_alert_' || (planned_event->>'eventType'),
        pg_catalog.jsonb_build_object(
          'auditId', proposed_event->>'auditId',
          'correlationId', correlation_id,
          'reasonCode', planned_event->>'reasonCode',
          'message', audit_message,
          'data', audit_data
        )::text, evaluation_timestamp, ''
      );
      INSERT INTO ${relation(manifest.schemaName, "operator_alert_events")}(
        id, tenant_id, incident_id, rule_id, event_type, severity, reason_code,
        actor_kind, actor_id, correlation_id, privacy_classification,
        metadata_json, created_at
      ) VALUES (
        proposed_event->>'eventId', resolved_tenant_id,
        proposed_action->>'incidentId', planned_action->>'ruleId',
        planned_event->>'eventType', planned_event->>'severity',
        planned_event->>'reasonCode', 'service', session_user::text,
        correlation_id, 'operational_aggregate', event_metadata::text,
        evaluation_timestamp
      );

      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(proposed_event->'routeDeliveries') AS proposed(value)
        WHERE proposed.value->>'route' NOT IN (
          SELECT value FROM pg_catalog.jsonb_array_elements_text(planned_action->'routes')
        ) OR proposed.value->>'id' !~ '^alert_delivery_[a-f0-9]{32}$'
      ) OR (
        SELECT COUNT(DISTINCT value->>'route')
        FROM pg_catalog.jsonb_array_elements(proposed_event->'routeDeliveries') AS proposed(value)
      ) <> pg_catalog.jsonb_array_length(planned_action->'routes') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation route delivery payload is invalid';
      END IF;
      INSERT INTO ${relation(manifest.schemaName, "operator_alert_deliveries")}(
        id, tenant_id, incident_id, event_id, route_kind, delivery_state,
        outbox_event_id, privacy_classification, created_at
      )
      SELECT proposed.value->>'id', resolved_tenant_id,
             proposed_action->>'incidentId', proposed_event->>'eventId',
             proposed.value->>'route',
             CASE WHEN proposed.value->>'route' = 'dashboard' THEN 'delivered' ELSE 'queued' END,
             CASE WHEN proposed.value->>'route' = 'audit_outbox'
               THEN proposed_event->>'outboxId' ELSE NULL END,
             'operational_aggregate', evaluation_timestamp
      FROM pg_catalog.jsonb_array_elements(proposed_event->'routeDeliveries') AS proposed(value);

      FOR planned_connector IN
        SELECT value FROM pg_catalog.jsonb_array_elements(planned_event->'connectors') AS item(value)
      LOOP
        SELECT COUNT(*), MIN(item.value::text)::jsonb
          INTO proposed_count, proposed_connector
        FROM pg_catalog.jsonb_array_elements(proposed_event->'connectorDeliveries') AS item(value)
        WHERE item.value->>'connectorId' = planned_connector->>'connectorId';
        IF proposed_count <> 1 OR proposed_connector IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation connector delivery is missing or duplicated';
        END IF;
        SELECT COUNT(*) INTO proposed_key_count FROM pg_catalog.jsonb_object_keys(proposed_connector);
        IF proposed_key_count <> 7
          OR NOT proposed_connector ?& ARRAY[
            'connectorId', 'deliveryId', 'deliveryEventId', 'payloadJson',
            'payloadHash', 'idempotencyKeyHash', 'endpointReference'
          ]::text[]
          OR proposed_connector->>'connectorId' <> planned_connector->>'connectorId'
          OR proposed_connector->>'endpointReference' <> planned_connector->>'endpointReference'
          OR proposed_connector->>'deliveryId' !~ '^alert_connector_delivery_[a-f0-9]{32}$'
          OR proposed_connector->>'deliveryEventId' !~ '^alert_connector_delivery_event_[a-f0-9]{32}$'
          OR proposed_connector->>'payloadHash' !~ '^[a-f0-9]{64}$'
          OR proposed_connector->>'idempotencyKeyHash' !~ '^[a-f0-9]{64}$'
          OR pg_catalog.octet_length(proposed_connector->>'payloadJson')
            > ${MAXIMUM_CONNECTOR_PAYLOAD_BYTES} THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation connector delivery payload is invalid';
        END IF;
        expected_payload := pg_catalog.jsonb_build_object(
          'contractVersion', 1,
          'eventId', proposed_event->>'eventId',
          'incidentId', proposed_action->>'incidentId',
          'eventType', planned_event->>'eventType',
          'severity', planned_event->>'severity',
          'reasonCode', planned_event->>'reasonCode',
          'retailerId', planned_action->>'retailerId',
          'operation', planned_action->>'operation',
          'failureStage', planned_action->>'failureStage',
          'layoutFingerprint', planned_action->>'layoutFingerprint',
          'occurrenceCount', (planned_action->>'occurrenceCount')::BIGINT,
          'affectedEntityCount', (planned_action->>'affectedEntityCount')::BIGINT,
          'firstSeenAt', planned_action->>'firstSeenAt',
          'lastSeenAt', planned_action->>'lastSeenAt',
          'emittedAt', evaluation_timestamp,
          'privacyClassification', 'operational_aggregate'
        );
        IF (proposed_connector->>'payloadJson')::jsonb <> expected_payload
          OR proposed_connector->>'payloadHash' <> ${payloadHash}
          OR proposed_connector->>'idempotencyKeyHash' <> ${idempotencyHash} THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation connector delivery hash is invalid';
        END IF;
        INSERT INTO ${relation(manifest.schemaName, "operator_alert_connector_deliveries")}(
          id, tenant_id, connector_id, incident_id, event_id, endpoint_reference,
          endpoint_binding_fingerprint, payload_json, payload_hash,
          idempotency_key_hash, state, privacy_classification, created_at, updated_at
        ) VALUES (
          proposed_connector->>'deliveryId', resolved_tenant_id,
          proposed_connector->>'connectorId', proposed_action->>'incidentId',
          proposed_event->>'eventId', planned_connector->>'endpointReference',
          planned_connector->>'endpointBindingFingerprint',
          proposed_connector->>'payloadJson', proposed_connector->>'payloadHash',
          proposed_connector->>'idempotencyKeyHash', 'pending',
          'operational_aggregate', evaluation_timestamp, evaluation_timestamp
        );
        INSERT INTO ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")}(
          id, tenant_id, delivery_id, sequence, event_type, attempt,
          reason_code, http_status, privacy_classification, created_at
        ) VALUES (
          proposed_connector->>'deliveryEventId', resolved_tenant_id,
          proposed_connector->>'deliveryId', 1, 'queued', 0,
          'alert_event_routed', 0, 'operational_aggregate', evaluation_timestamp
        );
      END LOOP;
      IF (
        SELECT COUNT(DISTINCT value->>'connectorId')
        FROM pg_catalog.jsonb_array_elements(proposed_event->'connectorDeliveries') AS proposed(value)
      ) <> pg_catalog.jsonb_array_length(planned_event->'connectors') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert reconciliation connector delivery set is invalid';
      END IF;

      routed_count := routed_count + pg_catalog.jsonb_array_length(planned_action->'routes');
      IF planned_event->>'eventType' = 'escalated' THEN
        escalated_count := escalated_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'opened', opened_count,
    'updated', updated_count,
    'resolved', resolved_count,
    'escalated', escalated_count,
    'routed', routed_count
  )::text;
END`;
}

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresOperatorAlertReconciliationManifest
): Promise<BoundaryInspection> {
  const role = manifest.alertReconciliationRole.name;
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [role]
  );
  const roleRow = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !roleRow || roleRow.rolsuper || roleRow.rolinherit
    || roleRow.rolcreaterole || roleRow.rolcreatedb || roleRow.rolcanlogin
    || roleRow.rolreplication || roleRow.rolbypassrls) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role has an unsafe attribute."
    );
  }
  const membershipResult = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname = $1 OR member_role.rolname = $1`,
    [role]
  );
  const membershipCount = exactInteger(membershipResult.rows[0]?.count, "membership count");
  if (membershipCount !== 0) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role must remain unassigned."
    );
  }
  const directResult = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM information_schema.role_table_grants
       WHERE table_schema = $1 AND grantee = $2
     ) + (
       SELECT COUNT(*) FROM information_schema.role_column_grants
       WHERE table_schema = $1 AND grantee = $2
     ) AS count`,
    [manifest.schemaName, role]
  );
  const directTableGrantCount = exactInteger(directResult.rows[0]?.count, "direct grant count");
  if (directTableGrantCount !== 0) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role has direct table authority."
    );
  }
  const effectiveTables = await session.query<{
    maySelect: boolean;
    mayInsert: boolean;
    mayUpdate: boolean;
    mayDelete: boolean;
    mayEscalate: boolean;
  }>(
    `SELECT has_table_privilege($2, relation.oid, 'SELECT') AS "maySelect",
            has_table_privilege($2, relation.oid, 'INSERT') AS "mayInsert",
            has_table_privilege($2, relation.oid, 'UPDATE') AS "mayUpdate",
            has_table_privilege($2, relation.oid, 'DELETE') AS "mayDelete",
            (has_table_privilege($2, relation.oid, 'TRUNCATE')
              OR has_table_privilege($2, relation.oid, 'REFERENCES')
              OR has_table_privilege($2, relation.oid, 'TRIGGER')) AS "mayEscalate"
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')`,
    [manifest.schemaName, role]
  );
  if (effectiveTables.rows.some((row) => row.maySelect || row.mayInsert
    || row.mayUpdate || row.mayDelete || row.mayEscalate)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role has an effective table privilege."
    );
  }
  const effectiveColumns = await session.query<{
    maySelect: boolean;
    mayInsert: boolean;
    mayUpdate: boolean;
    mayReference: boolean;
  }>(
    `SELECT has_column_privilege($2, relation.oid, attribute.attname, 'SELECT') AS "maySelect",
            has_column_privilege($2, relation.oid, attribute.attname, 'INSERT') AS "mayInsert",
            has_column_privilege($2, relation.oid, attribute.attname, 'UPDATE') AS "mayUpdate",
            has_column_privilege($2, relation.oid, attribute.attname, 'REFERENCES') AS "mayReference"
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
     WHERE namespace.nspname = $1 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND attribute.attnum > 0 AND NOT attribute.attisdropped`,
    [manifest.schemaName, role]
  );
  if (effectiveColumns.rows.some((row) => row.maySelect || row.mayInsert
    || row.mayUpdate || row.mayReference)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role has an effective column privilege."
    );
  }
  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation schema privilege is invalid."
    );
  }
  const routines = await session.query<RoutineRow>(
    `SELECT routine.oid::text AS oid, routine.proname AS "routineName",
            pg_catalog.oidvectortypes(routine.proargtypes) AS "argumentTypes",
            pg_catalog.pg_get_function_result(routine.oid) AS "resultType",
            routine.provolatile::text AS volatility,
            routine.prosecdef AS "securityDefiner", routine.proisstrict AS strict,
            routine.proleakproof AS leakproof, routine.proconfig AS configuration,
            owner_role.rolname AS "ownerName", routine.prosrc AS source
     FROM pg_catalog.pg_proc routine
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
     JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = routine.proowner
     WHERE namespace.nspname = $1 AND has_function_privilege($2, routine.oid, 'EXECUTE')
     ORDER BY routine.proname, pg_catalog.oidvectortypes(routine.proargtypes)`,
    [manifest.schemaName, role]
  );
  const routine = routines.rows[0];
  if (routines.rows.length !== 1 || !routine
    || routine.routineName !== manifest.alertReconciliationRole.functionName
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE || routine.volatility !== "v"
    || !routine.securityDefiner || !routine.strict || routine.leakproof
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role
    || routine.source !== operatorAlertReconciliationFunctionSource(manifest)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation function boundary is incomplete."
    );
  }
  const routineAcl = await session.query<{
    grantee: string;
    privilegeType: string;
    grantable: boolean;
  }>(
    `SELECT COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee,
            access.privilege_type AS "privilegeType", access.is_grantable AS grantable
     FROM pg_catalog.pg_proc routine
     CROSS JOIN LATERAL pg_catalog.aclexplode(
       COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
     ) AS access
     LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = access.grantee
     WHERE routine.oid = $1::oid ORDER BY grantee`,
    [routine.oid]
  );
  if (routineAcl.rows.length !== 2
    || !routineAcl.rows.some((row) => row.grantee === role
      && row.privilegeType === "EXECUTE" && !row.grantable)
    || !routineAcl.rows.some((row) => row.grantee === routine.ownerName
      && row.privilegeType === "EXECUTE" && !row.grantable)
    || routineAcl.rows.some((row) => row.grantee === "PUBLIC")) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation function grant is not exact."
    );
  }
  const accessibleSequences = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_class sequence
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = sequence.relnamespace
     WHERE namespace.nspname = $1 AND sequence.relkind = 'S'
       AND (has_sequence_privilege($2, sequence.oid, 'USAGE')
         OR has_sequence_privilege($2, sequence.oid, 'SELECT')
         OR has_sequence_privilege($2, sequence.oid, 'UPDATE'))`,
    [manifest.schemaName, role]
  );
  if (exactInteger(accessibleSequences.rows[0]?.count, "accessible sequence count") !== 0) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role can access an application-schema sequence."
    );
  }
  const rls = await session.query<{ tableName: string; enabled: boolean; forced: boolean }>(
    `SELECT relation.relname AS "tableName", relation.relrowsecurity AS enabled,
            relation.relforcerowsecurity AS forced
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relname = ANY($2::text[])
     ORDER BY relation.relname`,
    [manifest.schemaName, [...PROTECTED_TABLES]]
  );
  if (rls.rows.length !== PROTECTED_TABLES.length
    || rls.rows.some((row) => !row.enabled || !row.forced)
    || rls.rows.map((row) => row.tableName).join(",") !== [...PROTECTED_TABLES].join(",")) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation protected tables are not forced-RLS exact."
    );
  }
  const owned = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM pg_catalog.pg_class object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace
       JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = object.relowner
       WHERE namespace.nspname = $1 AND owner_role.rolname = $2
     ) + (
       SELECT COUNT(*) FROM pg_catalog.pg_proc routine
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
       JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = routine.proowner
       WHERE namespace.nspname = $1 AND owner_role.rolname = $2
     ) + (
       SELECT COUNT(*) FROM pg_catalog.pg_namespace namespace
       JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = namespace.nspowner
       WHERE namespace.nspname = $1 AND owner_role.rolname = $2
     ) AS count`,
    [manifest.schemaName, role]
  );
  if (exactInteger(owned.rows[0]?.count, "owned object count") !== 0) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role must not own schema objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation role depends on a direct table policy."
    );
  }
  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "Operator-alert reconciliation qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTableCount: rls.rows.length,
    forcedRlsTableCount: rls.rows.length,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryCatalogFingerprint: fingerprint({
      role: roleRow,
      routine,
      routineAcl: routineAcl.rows,
      rls: rls.rows
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresOperatorAlertReconciliationManifest
): PostgresOperatorAlertReconciliationQualificationReceipt {
  const receipt: PostgresOperatorAlertReconciliationQualificationReceipt = {
    contractVersion: exactInteger(row.contract_version, "receipt contract version") as 1,
    cutoverContractVersion: exactInteger(row.cutover_contract_version, "cutover contract version") as 3,
    alertDispatchContractVersion: exactInteger(
      row.alert_dispatch_contract_version,
      "alert-dispatch contract version"
    ) as 1,
    phase: row.phase as "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: row.role_manifest_fingerprint,
    alertDispatchManifestFingerprint: row.alert_dispatch_manifest_fingerprint,
    alertReconciliationRoleName: row.alert_reconciliation_role_name,
    protectedTableCount: exactInteger(row.protected_table_count, "protected-table count") as 10,
    forcedRlsTableCount: exactInteger(row.forced_rls_table_count, "forced-RLS count") as 10,
    directTableGrantCount: exactInteger(row.direct_table_grant_count, "direct-grant count") as 0,
    functionGrantCount: exactInteger(row.function_grant_count, "function-grant count") as 1,
    membershipCount: exactInteger(row.membership_count, "membership count") as 0,
    activePrincipalCount: exactInteger(row.active_principal_count, "active-principal count") as 0,
    qualifiedHandlerTaskKindCount: exactInteger(
      row.qualified_handler_task_kind_count,
      "qualified-handler count"
    ) as 5,
    totalHandlerTaskKindCount: exactInteger(row.total_handler_task_kind_count, "total-handler count"),
    maximumDiagnostics: exactInteger(row.maximum_diagnostics, "maximum diagnostic count") as 2_000,
    maximumGroups: exactInteger(row.maximum_groups, "maximum group count") as 50,
    maximumActions: exactInteger(row.maximum_actions, "maximum action count") as 50,
    maximumRules: exactInteger(row.maximum_rules, "maximum rule count") as 50,
    maximumConnectors: exactInteger(row.maximum_connectors, "maximum connector count") as 20,
    maximumConnectorPayloadBytes: exactInteger(
      row.maximum_connector_payload_bytes,
      "maximum connector payload size"
    ) as 4_000,
    serverDerivedRepairGroups: exactBoolean(row.server_derived_repair_groups, true, "server-derived-group flag"),
    databaseEvidenceRevalidation: exactBoolean(row.database_evidence_revalidation, true, "evidence-revalidation flag"),
    twoPhasePlanApply: exactBoolean(row.two_phase_plan_apply, true, "two-phase flag"),
    databaseServerClock: exactBoolean(row.database_server_clock, true, "database-clock flag"),
    applicationGeneratedOpaqueIds: exactBoolean(row.application_generated_opaque_ids, true, "opaque-ID flag"),
    sanitizedAggregateOnly: exactBoolean(row.sanitized_aggregate_only, true, "sanitized-aggregate flag"),
    endpointReferencesOnly: exactBoolean(row.endpoint_references_only, true, "endpoint-reference flag"),
    rawUrlsAccessible: exactBoolean(row.raw_urls_accessible, false, "raw-URL flag"),
    connectorSecretsAccessible: exactBoolean(row.connector_secrets_accessible, false, "connector-secret flag"),
    alertDispatchRepositoryParity: exactBoolean(row.alert_dispatch_repository_parity, true, "dispatch-parity flag"),
    alertReconciliationRepositoryParity: exactBoolean(row.alert_reconciliation_repository_parity, true, "reconciliation-parity flag"),
    fullHandlerRepositoryParity: exactBoolean(row.full_handler_repository_parity, true, "full-handler flag"),
    mutationAuthority: exactBoolean(row.mutation_authority, false, "mutation-authority flag"),
    directTableAccess: exactBoolean(row.direct_table_access, false, "direct-table flag"),
    runtimeAuthority: exactBoolean(row.runtime_authority, false, "runtime-authority flag"),
    productionReady: exactBoolean(row.production_ready, false, "production-ready flag"),
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    appliedAt: row.applied_at,
    verifiedAt: row.verified_at
  };
  if (receipt.phase !== "verified"
    || receipt.contractVersion !== POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION
    || receipt.cutoverContractVersion !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || receipt.alertDispatchContractVersion !== POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION
    || receipt.roleManifestFingerprint !== manifest.fingerprint
    || receipt.alertDispatchManifestFingerprint !== manifest.alertDispatchManifestFingerprint
    || receipt.alertReconciliationRoleName !== manifest.alertReconciliationRole.name
    || receipt.protectedTableCount !== 10 || receipt.forcedRlsTableCount !== 10
    || receipt.directTableGrantCount !== 0 || receipt.functionGrantCount !== 1
    || receipt.membershipCount !== 0 || receipt.activePrincipalCount !== 0
    || receipt.qualifiedHandlerTaskKindCount !== 5
    || receipt.totalHandlerTaskKindCount !== manifest.totalHandlerTaskKindCount
    || receipt.maximumDiagnostics !== 2_000 || receipt.maximumGroups !== 50
    || receipt.maximumActions !== 50 || receipt.maximumRules !== 50
    || receipt.maximumConnectors !== 20 || receipt.maximumConnectorPayloadBytes !== 4_000
    || !receipt.serverDerivedRepairGroups || !receipt.databaseEvidenceRevalidation
    || !receipt.twoPhasePlanApply || !receipt.databaseServerClock
    || !receipt.applicationGeneratedOpaqueIds || !receipt.sanitizedAggregateOnly
    || !receipt.endpointReferencesOnly || receipt.rawUrlsAccessible
    || receipt.connectorSecretsAccessible || !receipt.alertDispatchRepositoryParity
    || !receipt.alertReconciliationRepositoryParity || !receipt.fullHandlerRepositoryParity
    || receipt.mutationAuthority || receipt.directTableAccess
    || receipt.runtimeAuthority || receipt.productionReady
    || !SHA256.test(receipt.boundaryCatalogFingerprint)
    || !TIMESTAMP.test(receipt.appliedAt) || !TIMESTAMP.test(receipt.verifiedAt)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation receipt is inconsistent."
    );
  }
  return receipt;
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresOperatorAlertReconciliationManifest
): Promise<PostgresOperatorAlertReconciliationQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_OPERATOR_ALERT_RECONCILIATION_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresOperatorAlertReconciliationQualificationReceipt,
  manifest: PostgresOperatorAlertReconciliationManifest
): void {
  if (inspection.protectedTableCount !== receipt.protectedTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation boundary no longer matches its receipt."
    );
  }
}

export async function verifyPostgresOperatorAlertReconciliationBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification",
  requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification",
  requestedAlertReconciliationRoleNamespace = "yoink_reconcile_qualification"
): Promise<PostgresOperatorAlertReconciliationQualificationReceipt> {
  const manifest = buildPostgresOperatorAlertReconciliationManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace
  );
  await verifyPostgresOperatorAlertConnectorDispatchBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace,
    manifest.sessionRoleNamespace, manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace, manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace, manifest.operationalRetentionRoleNamespace,
    manifest.observerCandidateRoleNamespace, manifest.alertDispatchRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresOperatorAlertReconciliationBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification",
  requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification",
  requestedAlertReconciliationRoleNamespace = "yoink_reconcile_qualification",
  now = Date.now()
): Promise<PostgresOperatorAlertReconciliationQualificationReceipt> {
  const manifest = buildPostgresOperatorAlertReconciliationManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "Operator-alert reconciliation qualification requires the supported BYPASSRLS control role."
    );
  }
  const authority = await database.query<{ rolcreaterole: boolean; rolsuper: boolean }>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "Operator-alert reconciliation qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresOperatorAlertConnectorDispatchBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace,
    manifest.sessionRoleNamespace, manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace, manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace, manifest.operationalRetentionRoleNamespace,
    manifest.observerCandidateRoleNamespace, manifest.alertDispatchRoleNamespace
  );
  const existing = await database.query<{
    roleExists: boolean;
    receiptExists: boolean;
    functionExists: boolean;
    guardExists: boolean;
  }>(
    `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS "roleExists",
            pg_catalog.to_regclass($2) IS NOT NULL AS "receiptExists",
            pg_catalog.to_regprocedure($3) IS NOT NULL AS "functionExists",
            pg_catalog.to_regprocedure($4) IS NOT NULL AS "guardExists"`,
    [
      manifest.alertReconciliationRole.name,
      `${manifest.schemaName}.${POSTGRES_OPERATOR_ALERT_RECONCILIATION_RECEIPT_TABLE}`,
      `${manifest.schemaName}.${POSTGRES_OPERATOR_ALERT_RECONCILIATION_FUNCTION}(${FUNCTION_ARGUMENT_TYPES.join(",")})`,
      `${manifest.schemaName}.yoink_guard_operator_alert_reconciliation_receipt()`
    ]
  );
  if (existing.rows[0]?.roleExists || existing.rows[0]?.receiptExists
    || existing.rows[0]?.functionExists || existing.rows[0]?.guardExists) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "Operator-alert reconciliation qualification refuses to reuse a role, function, guard, or receipt."
    );
  }
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The operator-alert reconciliation qualification timestamp is invalid."
    );
  }
  const timestamp = new Date(now).toISOString();
  if (!TIMESTAMP.test(timestamp)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The operator-alert reconciliation qualification timestamp is invalid."
    );
  }
  await database.transaction(async (session) => {
    await session.query(
      `CREATE ROLE ${identifier(manifest.alertReconciliationRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.alertReconciliationRole.name)}`
    );
    for (const table of PROTECTED_TABLES) {
      await session.query(
        `ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`
      );
      await session.query(
        `ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`
      );
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, manifest.alertReconciliationRole.functionName)}(
         expected_tenant_id text, expected_user_id text, runtime_version text,
         operation_name text, evaluation_timestamp_input text,
         correlation_id text, action_payload_json text
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${operatorAlertReconciliationFunctionSource(manifest)}$yoink$`
    );
    const functionSignature = `${relation(
      manifest.schemaName,
      manifest.alertReconciliationRole.functionName
    )}(${FUNCTION_ARGUMENT_TYPES.join(", ")})`;
    await session.query(`REVOKE ALL ON FUNCTION ${functionSignature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${functionSignature}
       TO ${identifier(manifest.alertReconciliationRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_OPERATOR_ALERT_RECONCILIATION_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         alert_dispatch_contract_version BIGINT NOT NULL CHECK (alert_dispatch_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase = 'verified'),
         role_manifest_fingerprint TEXT NOT NULL,
         alert_dispatch_manifest_fingerprint TEXT NOT NULL,
         alert_reconciliation_role_name TEXT NOT NULL,
         protected_table_count BIGINT NOT NULL CHECK (protected_table_count = 10),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 10),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         qualified_handler_task_kind_count BIGINT NOT NULL CHECK (qualified_handler_task_kind_count = 5),
         total_handler_task_kind_count BIGINT NOT NULL,
         maximum_diagnostics BIGINT NOT NULL CHECK (maximum_diagnostics = 2000),
         maximum_groups BIGINT NOT NULL CHECK (maximum_groups = 50),
         maximum_actions BIGINT NOT NULL CHECK (maximum_actions = 50),
         maximum_rules BIGINT NOT NULL CHECK (maximum_rules = 50),
         maximum_connectors BIGINT NOT NULL CHECK (maximum_connectors = 20),
         maximum_connector_payload_bytes BIGINT NOT NULL CHECK (maximum_connector_payload_bytes = 4000),
         server_derived_repair_groups BOOLEAN NOT NULL CHECK (server_derived_repair_groups = TRUE),
         database_evidence_revalidation BOOLEAN NOT NULL CHECK (database_evidence_revalidation = TRUE),
         two_phase_plan_apply BOOLEAN NOT NULL CHECK (two_phase_plan_apply = TRUE),
         database_server_clock BOOLEAN NOT NULL CHECK (database_server_clock = TRUE),
         application_generated_opaque_ids BOOLEAN NOT NULL CHECK (application_generated_opaque_ids = TRUE),
         sanitized_aggregate_only BOOLEAN NOT NULL CHECK (sanitized_aggregate_only = TRUE),
         endpoint_references_only BOOLEAN NOT NULL CHECK (endpoint_references_only = TRUE),
         raw_urls_accessible BOOLEAN NOT NULL CHECK (raw_urls_accessible = FALSE),
         connector_secrets_accessible BOOLEAN NOT NULL CHECK (connector_secrets_accessible = FALSE),
         alert_dispatch_repository_parity BOOLEAN NOT NULL CHECK (alert_dispatch_repository_parity = TRUE),
         alert_reconciliation_repository_parity BOOLEAN NOT NULL CHECK (alert_reconciliation_repository_parity = TRUE),
         full_handler_repository_parity BOOLEAN NOT NULL CHECK (full_handler_repository_parity = TRUE),
         mutation_authority BOOLEAN NOT NULL CHECK (mutation_authority = FALSE),
         direct_table_access BOOLEAN NOT NULL CHECK (direct_table_access = FALSE),
         runtime_authority BOOLEAN NOT NULL CHECK (runtime_authority = FALSE),
         production_ready BOOLEAN NOT NULL CHECK (production_ready = FALSE),
         boundary_catalog_fingerprint TEXT NOT NULL,
         applied_at TEXT NOT NULL, verified_at TEXT NOT NULL
       )`
    );
    await session.query(
      `REVOKE ALL ON TABLE ${relation(
        manifest.schemaName,
        POSTGRES_OPERATOR_ALERT_RECONCILIATION_RECEIPT_TABLE
      )} FROM PUBLIC`
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_operator_alert_reconciliation_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'operator-alert reconciliation receipt is immutable'; END
       $guard$`
    );
    await session.query(
      `REVOKE ALL ON FUNCTION ${relation(
        manifest.schemaName,
        "yoink_guard_operator_alert_reconciliation_receipt"
      )}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_operator_alert_reconciliation_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(
        manifest.schemaName,
        POSTGRES_OPERATOR_ALERT_RECONCILIATION_RECEIPT_TABLE
      )}
       FOR EACH ROW EXECUTE FUNCTION ${relation(
        manifest.schemaName,
        "yoink_guard_operator_alert_reconciliation_receipt"
      )}()`
    );
    const inspection = await inspectBoundary(session, manifest);
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_OPERATOR_ALERT_RECONCILIATION_RECEIPT_TABLE)}(
         singleton, contract_version, cutover_contract_version,
         alert_dispatch_contract_version, phase, role_manifest_fingerprint,
         alert_dispatch_manifest_fingerprint, alert_reconciliation_role_name,
         protected_table_count, forced_rls_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         qualified_handler_task_kind_count, total_handler_task_kind_count,
         maximum_diagnostics, maximum_groups, maximum_actions, maximum_rules,
         maximum_connectors, maximum_connector_payload_bytes,
         server_derived_repair_groups, database_evidence_revalidation,
         two_phase_plan_apply, database_server_clock, application_generated_opaque_ids,
         sanitized_aggregate_only, endpoint_references_only, raw_urls_accessible,
         connector_secrets_accessible, alert_dispatch_repository_parity,
         alert_reconciliation_repository_parity, full_handler_repository_parity,
         mutation_authority, direct_table_access, runtime_authority,
         production_ready, boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 1, 'verified', $1, $2, $3,
         10, 10, 0, 1, 0, 0, 5, $4,
         2000, 50, 50, 50, 20, 4000,
         TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE,
         TRUE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, $5, $6, $6
       )`,
      [
        manifest.fingerprint,
        manifest.alertDispatchManifestFingerprint,
        manifest.alertReconciliationRole.name,
        manifest.totalHandlerTaskKindCount,
        inspection.boundaryCatalogFingerprint,
        timestamp
      ]
    );
  });
  return verifyPostgresOperatorAlertReconciliationBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace,
    manifest.sessionRoleNamespace, manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace, manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace, manifest.operationalRetentionRoleNamespace,
    manifest.observerCandidateRoleNamespace, manifest.alertDispatchRoleNamespace,
    manifest.alertReconciliationRoleNamespace
  );
}

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      `The PostgreSQL operator-alert reconciliation ${label} is invalid.`
    );
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      `The PostgreSQL operator-alert reconciliation ${label} fields are invalid.`
    );
  }
}

function functionJson(value: unknown, label: string): Record<string, unknown> {
  try {
    return jsonRecord(JSON.parse(String(value ?? "")), label);
  } catch (error) {
    if (error instanceof PostgresOperatorAlertReconciliationQualificationError) throw error;
    throw new PostgresOperatorAlertReconciliationQualificationError(
      `The PostgreSQL operator-alert reconciliation ${label} is malformed.`
    );
  }
}

interface PlannedConnector {
  connectorId: string;
  endpointReference: string;
  endpointBindingFingerprint: string;
}

interface PlannedEvent {
  eventType: "opened" | "repeated" | "escalated" | "auto_resolved";
  severity: "info" | "warning" | "error" | "critical";
  reasonCode: string;
  connectors: PlannedConnector[];
}

interface PlannedAction {
  actionKey: string;
  mutation: "open" | "resolve" | "update";
  contentChanged: boolean;
  incidentId: string;
  incidentKeyHash: string;
  ruleId: string;
  routes: Array<"dashboard" | "audit_outbox">;
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  summary: string;
  retailerId: string;
  operation: "observe" | "rehearse_add" | "live_add";
  failureStage: string;
  reasonCode: string;
  layoutFingerprint: string;
  occurrenceCount: number;
  affectedEntityCount: number;
  sourceOccurrenceCount: number;
  sourceAffectedEntityCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastFailureAt: string;
  escalationDue: boolean;
  events: PlannedEvent[];
}

interface ReconciliationPlan {
  evaluationTimestamp: string;
  repairGroupsEvaluated: number;
  actionablePairs: number;
  actionsDeferred: number;
  maximumDiagnostics: 2_000;
  maximumGroups: 50;
  maximumActions: 50;
  selectedActions: PlannedAction[];
}

const SUPPORTED_RETAILERS = new Set([
  "target", "walmart", "amazon", "bestbuy", "disney", "ravensburger",
  "riot", "booksamillion", "fanatics", "kohls", "macys", "pbandai",
  "pokemoncenter"
]);

function boundedText(value: unknown, maximumBytes: number, label: string): string {
  const text = String(value ?? "");
  if (!text || Buffer.byteLength(text, "utf8") > maximumBytes
    || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      `The PostgreSQL operator-alert reconciliation ${label} is invalid.`
    );
  }
  return text;
}

function plannedConnector(value: unknown): PlannedConnector {
  const connector = jsonRecord(value, "planned connector");
  exactKeys(connector, [
    "connectorId", "endpointReference", "endpointBindingFingerprint"
  ], "planned connector");
  const connectorId = String(connector.connectorId ?? "");
  const endpointReference = String(connector.endpointReference ?? "");
  const endpointBindingFingerprint = String(connector.endpointBindingFingerprint ?? "");
  if (!ID_PATTERN.test(connectorId)
    || !/^[A-Za-z][A-Za-z0-9_.:-]{2,119}$/.test(endpointReference)
    || endpointReference.includes("://")
    || (endpointBindingFingerprint !== "" && !SHA256.test(endpointBindingFingerprint))) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation planned connector is unsafe."
    );
  }
  return { connectorId, endpointReference, endpointBindingFingerprint };
}

function plannedEvent(value: unknown): PlannedEvent {
  const event = jsonRecord(value, "planned event");
  exactKeys(event, ["eventType", "severity", "reasonCode", "connectors"], "planned event");
  const eventType = String(event.eventType ?? "");
  const severity = String(event.severity ?? "");
  const reasonCode = boundedText(event.reasonCode, 80, "planned event reason");
  if (!["opened", "repeated", "escalated", "auto_resolved"].includes(eventType)
    || !["info", "warning", "error", "critical"].includes(severity)
    || !Array.isArray(event.connectors)
    || event.connectors.length > POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_CONNECTORS) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation planned event is invalid."
    );
  }
  const connectors = event.connectors.map(plannedConnector);
  if (new Set(connectors.map((connector) => connector.connectorId)).size !== connectors.length) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation planned connectors are duplicated."
    );
  }
  return {
    eventType: eventType as PlannedEvent["eventType"],
    severity: severity as PlannedEvent["severity"],
    reasonCode,
    connectors
  };
}

function plannedAction(value: unknown): PlannedAction {
  const action = jsonRecord(value, "planned action");
  exactKeys(action, [
    "actionKey", "mutation", "contentChanged", "incidentId", "incidentKeyHash",
    "ruleId", "routes", "severity", "title", "summary", "retailerId",
    "operation", "failureStage", "reasonCode", "layoutFingerprint",
    "occurrenceCount", "affectedEntityCount", "sourceOccurrenceCount",
    "sourceAffectedEntityCount", "firstSeenAt", "lastSeenAt", "lastFailureAt",
    "escalationDue", "events"
  ], "planned action");
  const mutation = String(action.mutation ?? "");
  const incidentId = String(action.incidentId ?? "");
  const incidentKeyHash = String(action.incidentKeyHash ?? "");
  const ruleId = String(action.ruleId ?? "");
  const actionKey = String(action.actionKey ?? "");
  const retailerId = String(action.retailerId ?? "");
  const operation = String(action.operation ?? "");
  const severity = String(action.severity ?? "");
  const layoutFingerprint = String(action.layoutFingerprint ?? "");
  const occurrenceCount = exactInteger(action.occurrenceCount, "planned occurrence count");
  const affectedEntityCount = exactInteger(action.affectedEntityCount, "planned entity count");
  const sourceOccurrenceCount = exactInteger(action.sourceOccurrenceCount, "source occurrence count");
  const sourceAffectedEntityCount = exactInteger(action.sourceAffectedEntityCount, "source entity count");
  if (!["open", "resolve", "update"].includes(mutation)
    || typeof action.contentChanged !== "boolean" || typeof action.escalationDue !== "boolean"
    || !ID_PATTERN.test(ruleId) || !SHA256.test(incidentKeyHash)
    || actionKey !== `${ruleId}:${incidentKeyHash}`
    || (mutation === "open" ? incidentId !== "" : !/^alert_incident_[a-f0-9]{32}$/.test(incidentId))
    || !SUPPORTED_RETAILERS.has(retailerId)
    || !["observe", "rehearse_add", "live_add"].includes(operation)
    || !["info", "warning", "error", "critical"].includes(severity)
    || !SHA256.test(layoutFingerprint)
    || occurrenceCount < 1 || affectedEntityCount < 1
    || sourceOccurrenceCount < 1 || sourceAffectedEntityCount < 1
    || !Array.isArray(action.routes) || action.routes.length < 1 || action.routes.length > 2
    || action.routes.some((route) => route !== "dashboard" && route !== "audit_outbox")
    || new Set(action.routes).size !== action.routes.length
    || !Array.isArray(action.events) || action.events.length > 2) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation planned action is invalid."
    );
  }
  const events = action.events.map(plannedEvent);
  if (mutation === "resolve" && (events.length !== 1 || events[0]?.eventType !== "auto_resolved")
    || mutation === "open" && events[0]?.eventType !== "opened"
    || mutation === "update" && events.some((event) => event.eventType === "opened"
      || event.eventType === "auto_resolved")) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation planned lifecycle is inconsistent."
    );
  }
  const firstSeenAt = String(action.firstSeenAt ?? "");
  const lastSeenAt = String(action.lastSeenAt ?? "");
  const lastFailureAt = String(action.lastFailureAt ?? "");
  if (!TIMESTAMP.test(firstSeenAt) || !TIMESTAMP.test(lastSeenAt)
    || !TIMESTAMP.test(lastFailureAt)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation planned timestamps are invalid."
    );
  }
  return {
    actionKey,
    mutation: mutation as PlannedAction["mutation"],
    contentChanged: action.contentChanged,
    incidentId,
    incidentKeyHash,
    ruleId,
    routes: action.routes as PlannedAction["routes"],
    severity: severity as PlannedAction["severity"],
    title: boundedText(action.title, 300, "planned title"),
    summary: boundedText(action.summary, 800, "planned summary"),
    retailerId,
    operation: operation as PlannedAction["operation"],
    failureStage: boundedText(action.failureStage, 80, "planned failure stage"),
    reasonCode: boundedText(action.reasonCode, 80, "planned reason code"),
    layoutFingerprint,
    occurrenceCount,
    affectedEntityCount,
    sourceOccurrenceCount,
    sourceAffectedEntityCount,
    firstSeenAt,
    lastSeenAt,
    lastFailureAt,
    escalationDue: action.escalationDue,
    events
  };
}

function reconciliationPlan(value: Record<string, unknown>): ReconciliationPlan {
  exactKeys(value, [
    "evaluationTimestamp", "repairGroupsEvaluated", "actionablePairs",
    "actionsDeferred", "maximumDiagnostics", "maximumGroups",
    "maximumActions", "selectedActions"
  ], "evidence plan");
  const evaluationTimestamp = String(value.evaluationTimestamp ?? "");
  const repairGroupsEvaluated = exactInteger(value.repairGroupsEvaluated, "repair-group count");
  const actionablePairs = exactInteger(value.actionablePairs, "actionable-pair count");
  const actionsDeferred = exactInteger(value.actionsDeferred, "deferred-action count");
  if (!TIMESTAMP.test(evaluationTimestamp)
    || value.maximumDiagnostics !== POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_DIAGNOSTICS
    || value.maximumGroups !== POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_GROUPS
    || value.maximumActions !== POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_ACTIONS
    || repairGroupsEvaluated > POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_DIAGNOSTICS
    || !Array.isArray(value.selectedActions)
    || value.selectedActions.length > POSTGRES_OPERATOR_ALERT_RECONCILIATION_MAXIMUM_ACTIONS
    || actionablePairs !== value.selectedActions.length + actionsDeferred) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation evidence plan is inconsistent."
    );
  }
  const selectedActions = value.selectedActions.map(plannedAction);
  if (new Set(selectedActions.map((action) => action.actionKey)).size !== selectedActions.length) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation plan contains duplicate actions."
    );
  }
  return {
    evaluationTimestamp,
    repairGroupsEvaluated,
    actionablePairs,
    actionsDeferred,
    maximumDiagnostics: 2_000,
    maximumGroups: 50,
    maximumActions: 50,
    selectedActions
  };
}

function preparedActions(
  plan: ReconciliationPlan,
  tenantId: string
): Array<Record<string, unknown>> {
  return plan.selectedActions.map((action) => {
    const incidentId = action.incidentId || newId("alert_incident");
    return {
      actionKey: action.actionKey,
      incidentId,
      events: action.events.map((event, index) => {
        const eventId = newId("alert_event");
        const auditId = newId("audit");
        const outboxId = newId("outbox");
        return {
          eventType: event.eventType,
          eventId,
          auditId,
          outboxId,
          routeDeliveries: action.routes.map((route) => ({
            route,
            id: newId("alert_delivery")
          })),
          connectorDeliveries: event.connectors.map((connector) => {
            const payload = {
              contractVersion: 1,
              eventId,
              incidentId,
              eventType: event.eventType,
              severity: event.severity,
              reasonCode: event.reasonCode,
              retailerId: action.retailerId,
              operation: action.operation,
              failureStage: action.failureStage,
              layoutFingerprint: action.layoutFingerprint,
              occurrenceCount: action.occurrenceCount,
              affectedEntityCount: action.affectedEntityCount,
              firstSeenAt: action.firstSeenAt,
              lastSeenAt: action.lastSeenAt,
              emittedAt: plan.evaluationTimestamp,
              privacyClassification: "operational_aggregate"
            };
            const payloadJson = stableJson(payload);
            if (Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_CONNECTOR_PAYLOAD_BYTES) {
              throw new PostgresOperatorAlertReconciliationQualificationError(
                "The PostgreSQL operator-alert reconciliation connector payload exceeds its bound."
              );
            }
            return {
              connectorId: connector.connectorId,
              deliveryId: newId("alert_connector_delivery"),
              deliveryEventId: newId("alert_connector_delivery_event"),
              payloadJson,
              payloadHash: stableHash("yoink_operator_alert_connector_payload_v1", payloadJson),
              idempotencyKeyHash: stableHash(
                "yoink_operator_alert_connector_idempotency_v1",
                tenantId,
                connector.connectorId,
                eventId
              ),
              endpointReference: connector.endpointReference
            };
          }),
          eventOrdinal: index + 1
        };
      })
    };
  });
}

function resultFromRecord(
  value: Record<string, unknown>,
  plan: ReconciliationPlan
): OperatorAlertReconciliationResult {
  exactKeys(value, ["opened", "updated", "resolved", "escalated", "routed"], "result");
  const result = {
    opened: exactInteger(value.opened, "opened count"),
    updated: exactInteger(value.updated, "updated count"),
    resolved: exactInteger(value.resolved, "resolved count"),
    escalated: exactInteger(value.escalated, "escalated count"),
    routed: exactInteger(value.routed, "routed count")
  };
  const expected = {
    opened: plan.selectedActions.filter((action) => action.mutation === "open").length,
    updated: plan.selectedActions.filter((action) =>
      action.mutation === "update" && action.contentChanged).length,
    resolved: plan.selectedActions.filter((action) => action.mutation === "resolve").length,
    escalated: plan.selectedActions.reduce((count, action) =>
      count + action.events.filter((event) => event.eventType === "escalated").length, 0),
    routed: plan.selectedActions.reduce((count, action) =>
      count + action.routes.length * action.events.length, 0)
  };
  if (canonicalPortabilityJson(result) !== canonicalPortabilityJson(expected)) {
    throw new PostgresOperatorAlertReconciliationQualificationError(
      "The PostgreSQL operator-alert reconciliation result does not match its evidence plan."
    );
  }
  return result;
}

class AlertReconciliationSession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresOperatorAlertReconciliationDatabase
implements OperatorAlertReconciliationRepositoryPort {
  private readonly pool: Pool;
  readonly manifest: PostgresOperatorAlertReconciliationManifest;
  private readonly tenantId: string;
  private readonly userId: string;
  private readonly version: string;

  constructor(
    config: PostgresCutoverConnectionConfig,
    principal: BackgroundWorkerPrincipal,
    requestedRuntimeVersion: string,
    requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
    requestedReadRoleNamespace = "yoink_qualification",
    requestedSessionRoleNamespace = "yoink_session_qualification",
    requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
    requestedControlRoleNamespace = "yoink_control_qualification",
    requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
    requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
    requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
    requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification",
    requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification",
    requestedAlertReconciliationRoleNamespace = "yoink_reconcile_qualification",
    options: NodePostgresOperatorAlertReconciliationDatabaseOptions = {}
  ) {
    this.tenantId = principalId(principal?.tenantId, "tenant ID");
    this.userId = principalId(principal?.userId, "user ID");
    this.version = runtimeVersion(requestedRuntimeVersion);
    this.manifest = buildPostgresOperatorAlertReconciliationManifest(
      requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (maxConnections !== 1 && maxConnections !== 2) {
      throw new PostgresOperatorAlertReconciliationQualificationError(
        "The PostgreSQL operator-alert reconciliation connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_alert_reconciliation_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  private assertNow(now: number): void {
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresOperatorAlertReconciliationQualificationError(
        "The PostgreSQL operator-alert reconciliation timestamp differs from the process clock."
      );
    }
  }

  private async call(
    session: PostgresQuerySession,
    operation: "plan" | "apply",
    evaluationTimestamp: string,
    correlationId: string,
    payload: Array<Record<string, unknown>>
  ): Promise<Record<string, unknown>> {
    const result = await session.query<{ resultJson: string }>(
      `SELECT result_json AS "resultJson"
       FROM ${relation(this.manifest.schemaName, this.manifest.alertReconciliationRole.functionName)}(
         $1, $2, $3, $4, $5, $6, $7
       )`,
      [
        this.tenantId,
        this.userId,
        this.version,
        operation,
        evaluationTimestamp,
        correlationId,
        JSON.stringify(payload)
      ]
    );
    if (result.rows.length !== 1 || !result.rows[0]) {
      throw new PostgresOperatorAlertReconciliationQualificationError(
        "The PostgreSQL operator-alert reconciliation function returned an ambiguous result."
      );
    }
    return functionJson(result.rows[0].resultJson, `${operation} result`);
  }

  async reconcile(
    principal: BackgroundWorkerPrincipal,
    requestedRuntimeVersion: string,
    now = Date.now()
  ): Promise<OperatorAlertReconciliationResult> {
    this.assertNow(now);
    if (principalId(principal?.tenantId, "tenant ID") !== this.tenantId
      || principalId(principal?.userId, "user ID") !== this.userId) {
      throw new PostgresOperatorAlertReconciliationQualificationError(
        "The PostgreSQL operator-alert reconciliation principal changed after construction."
      );
    }
    if (runtimeVersion(requestedRuntimeVersion) !== this.version) {
      throw new PostgresOperatorAlertReconciliationQualificationError(
        "The PostgreSQL operator-alert reconciliation runtime version changed after construction."
      );
    }
    const correlationId = `alertcorr_${stableHash(
      "yoink_operator_alert_correlation_v1",
      `background_alert_reconciliation_${new Date(now).toISOString().replace(/[^0-9]/g, "").slice(0, 17)}`
    ).slice(0, 48)}`;
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.alertReconciliationRole.name)}`);
      const session = new AlertReconciliationSession(client);
      const plan = reconciliationPlan(await this.call(
        session,
        "plan",
        "",
        correlationId,
        []
      ));
      const prepared = preparedActions(plan, this.tenantId);
      const result = resultFromRecord(await this.call(
        session,
        "apply",
        plan.evaluationTimestamp,
        correlationId,
        prepared
      ), plan);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyed = true;
        client.release(true);
      }
      throw error;
    } finally {
      if (!destroyed) client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
