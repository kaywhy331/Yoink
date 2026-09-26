import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  logIdlePostgresClientErrors
} from "./postgres-cutover.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import {
  POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONTRACT_VERSION,
  buildPostgresSignalMissionPolicyApplyManifest,
  verifyPostgresSignalMissionPolicyApplyBoundary,
  type PostgresSignalMissionPolicyApplyManifest
} from "./postgres-signal-mission-policy-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_RECEIPT_TABLE =
  "yoink_signal_source_status_apply_receipt";
export const POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION =
  "yoink_apply_signal_source_status";
export const POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONFIRMATION =
  "RECORD_TRACKALACKER_STATUS_V1";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 4_096;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const REQUEST_ID = /^source_status_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
  request_id TEXT, request_payload_json TEXT
`;
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "audit_events",
  "extension_devices",
  "outbox_events",
  "source_connections",
  "source_device_states"
] as const);
const MUTATION_TABLES = Object.freeze([
  "audit_events",
  "outbox_events",
  "source_connections",
  "source_device_states"
] as const);

export type PostgresSignalSourceStatusOperation =
  "record_trackalacker_push_status";

export interface PostgresSignalSourceStatusPayload {
  deviceId: string;
  sourceConnectionId: string;
  state: "disabled" | "awaiting_page" | "subscribing" | "registering" | "ready" | "error";
  ready: boolean;
  subscriptionPresent: boolean;
  pendingSignals: number;
  lastHttpStatus: number;
  errorCode: string;
  lastRegistrationAt: string;
  lastNotificationAt: string;
  lastDeliveryAt: string;
  updatedAt: string;
  confirmation: typeof POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONFIRMATION;
}

export interface PostgresSignalSourceStatusApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  missionPolicyApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  sourceStatusRoleNamespace: string;
  missionPolicyApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalMissionPolicyApplyManifest;
  sourceStatusRole: {
    kind: "signal_source_status_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  protectedTenantTableCount: 5;
  forcedRlsTableCount: 5;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  sourceScopeConsumed: true;
  deterministicRequestIdentity: true;
  immutableMaterialReplay: true;
  latestStateReplayOnly: true;
  lifecycleAwareOutboxReplay: true;
  nonMaterialAuditSuppression: true;
  monotonicDeviceTimestamp: true;
  databaseOwnedEventTimestamps: true;
  clientObservedAtPreserved: true;
  atomicMaterialStatusAuditOutbox: true;
  currentSourceOwnershipRevalidation: true;
  currentDeviceOwnershipRevalidation: true;
  activeDeviceOnly: true;
  privateSourceOnly: true;
  trackalackerOnly: true;
  materialChangeAuditParity: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: false;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalSourceStatusCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  missionPolicyApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  deterministicManifestImplemented: true;
  atomicQualificationApplyImplemented: true;
  exactEffectivePrivilegeVerification: true;
  immutableBoundaryCatalogFingerprint: true;
  qualificationSuiteParity: true;
  noLogin: true;
  noInherit: true;
  noBypassRls: true;
  securityDefinerRoutineVerified: true;
  phase: "qualified_inactive";
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  sourceScopeConsumed: true;
  deterministicRequestIdentity: true;
  immutableMaterialReplay: true;
  latestStateReplayOnly: true;
  lifecycleAwareOutboxReplay: true;
  nonMaterialAuditSuppression: true;
  monotonicDeviceTimestamp: true;
  databaseOwnedEventTimestamps: true;
  clientObservedAtPreserved: true;
  atomicMaterialStatusAuditOutbox: true;
  currentSourceOwnershipRevalidation: true;
  currentDeviceOwnershipRevalidation: true;
  activeDeviceOnly: true;
  privateSourceOnly: true;
  trackalackerOnly: true;
  materialChangeAuditParity: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: false;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  operationCount: 1;
  protectedTenantTableCount: 5;
  forcedRlsTableCount: 5;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: false;
  actionAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalSourceStatusApplyResult {
  contractVersion: 1;
  operation: "record_trackalacker_push_status";
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "refreshed" | "already_current" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  stateMutated: boolean;
  connectionMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  status: Record<string, unknown>;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: false;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: false;
  actionAuthority: false;
  runtimeAuthority: false;
}

export interface NodePostgresSignalSourceStatusApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalSourceStatusCapabilityProjection> | null = null;

export class PostgresSignalSourceStatusApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalSourceStatusApplyQualificationError";
  }
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function relation(schema: string, name: string): string {
  return `${identifier(schema)}.${identifier(name)}`;
}

function safeSchema(value: string): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresSignalSourceStatusApplyQualificationError(
      "The PostgreSQL source-status schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalSourceStatusApplyQualificationError(
      "The PostgreSQL source-status role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_source_status`;
  if (value.length > 63) {
    throw new PostgresSignalSourceStatusApplyQualificationError(
      "The PostgreSQL source-status role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function collectRoleNamespaces(value: unknown, namespaces = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return namespaces;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("RoleNamespace") && typeof entry === "string") namespaces.add(entry);
    else if (entry && typeof entry === "object") collectRoleNamespaces(entry, namespaces);
  }
  return namespaces;
}

function stableHashInput(parts: string[]): string {
  return parts.map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`).join("|");
}

function stableHashInputSql(parts: string[]): string {
  return parts.map((part) => (
    `pg_catalog.octet_length(${part})::text || ':' || ${part}`
  )).join(" || '|' || ");
}

export function buildPostgresSignalSourceStatusRequestId(
  principal: BackgroundWorkerPrincipal,
  payload: PostgresSignalSourceStatusPayload
): string {
  const parts = [
    "postgres-signal-source-status-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    String(payload?.deviceId ?? ""),
    String(payload?.sourceConnectionId ?? ""),
    String(payload?.state ?? ""),
    payload?.ready === true ? "true" : "false",
    payload?.subscriptionPresent === true ? "true" : "false",
    String(payload?.pendingSignals ?? ""),
    String(payload?.lastHttpStatus ?? ""),
    String(payload?.errorCode ?? ""),
    String(payload?.lastRegistrationAt ?? ""),
    String(payload?.lastNotificationAt ?? ""),
    String(payload?.lastDeliveryAt ?? ""),
    String(payload?.updatedAt ?? ""),
    String(payload?.confirmation ?? "")
  ];
  return `source_status_${createHash("sha256").update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalSourceStatusApplyManifest(
  predecessorManifest = buildPostgresSignalMissionPolicyApplyManifest(),
  requestedRoleNamespace = "yoink_source_status_q"
): PostgresSignalSourceStatusApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const sourceStatusRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(sourceStatusRoleNamespace)) {
    throw new PostgresSignalSourceStatusApplyQualificationError(
      "The PostgreSQL source-status role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalSourceStatusApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    missionPolicyApplyContractVersion:
      POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    sourceStatusRoleNamespace,
    missionPolicyApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    sourceStatusRole: {
      kind: "signal_source_status_apply_boundary",
      name: roleName(sourceStatusRoleNamespace),
      functionName: POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    protectedTenantTableCount: 5,
    forcedRlsTableCount: 5,
    mutationTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    sourceScopeConsumed: true,
    deterministicRequestIdentity: true,
    immutableMaterialReplay: true,
    latestStateReplayOnly: true,
    lifecycleAwareOutboxReplay: true,
    nonMaterialAuditSuppression: true,
    monotonicDeviceTimestamp: true,
    databaseOwnedEventTimestamps: true,
    clientObservedAtPreserved: true,
    atomicMaterialStatusAuditOutbox: true,
    currentSourceOwnershipRevalidation: true,
    currentDeviceOwnershipRevalidation: true,
    activeDeviceOnly: true,
    privateSourceOnly: true,
    trackalackerOnly: true,
    materialChangeAuditParity: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: false,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function signalSourceStatusApplyFunctionSource(
  manifest = buildPostgresSignalSourceStatusApplyManifest()
): string {
  const requestIdentityParts = stableHashInputSql([
    "'postgres-signal-source-status-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "device_id_value",
    "source_connection_id_value",
    "state_value",
    "ready_value::text",
    "subscription_present_value::text",
    "pending_signals_value::text",
    "last_http_status_value::text",
    "error_code_value",
    "last_registration_at_value",
    "last_notification_at_value",
    "last_delivery_at_value",
    "updated_at_value",
    `'${POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONFIRMATION}'::text`
  ]);
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  derived_request_id TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  device_id_value TEXT;
  source_connection_id_value TEXT;
  state_value TEXT;
  ready_value BOOLEAN;
  subscription_present_value BOOLEAN;
  pending_signals_value INTEGER;
  last_http_status_value INTEGER;
  error_code_value TEXT;
  last_registration_at_value TEXT;
  last_notification_at_value TEXT;
  last_delivery_at_value TEXT;
  updated_at_value TEXT;
  updated_at_timestamp TIMESTAMPTZ;
  desired_connection_status TEXT;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  device_record RECORD;
  source_record RECORD;
  previous_record RECORD;
  previous_found BOOLEAN;
  material_change BOOLEAN;
  connection_updated_timestamp TEXT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  affected_rows BIGINT;
  status_result JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
  reason_code_value TEXT;
  message_value TEXT;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'record_trackalacker_push_status'
    OR request_id !~ '^source_status_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-status request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-status payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY[
      'confirmation', 'deviceId', 'errorCode', 'lastDeliveryAt',
      'lastHttpStatus', 'lastNotificationAt', 'lastRegistrationAt',
      'pendingSignals', 'ready', 'sourceConnectionId', 'state',
      'subscriptionPresent', 'updatedAt'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 13
    OR pg_catalog.jsonb_typeof(request_payload->'deviceId') IS DISTINCT FROM 'string'
    OR request_payload->>'deviceId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'sourceConnectionId') IS DISTINCT FROM 'string'
    OR request_payload->>'sourceConnectionId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'state') IS DISTINCT FROM 'string'
    OR request_payload->>'state' NOT IN (
      'disabled', 'awaiting_page', 'subscribing', 'registering', 'ready', 'error'
    )
    OR pg_catalog.jsonb_typeof(request_payload->'ready') IS DISTINCT FROM 'boolean'
    OR pg_catalog.jsonb_typeof(request_payload->'subscriptionPresent') IS DISTINCT FROM 'boolean'
    OR pg_catalog.jsonb_typeof(request_payload->'pendingSignals') IS DISTINCT FROM 'number'
    OR request_payload->>'pendingSignals' !~ '^(0|[1-9][0-9]*)$'
    OR (request_payload->>'pendingSignals')::numeric > 50
    OR pg_catalog.jsonb_typeof(request_payload->'lastHttpStatus') IS DISTINCT FROM 'number'
    OR request_payload->>'lastHttpStatus' !~ '^(0|[1-9][0-9]*)$'
    OR (request_payload->>'lastHttpStatus')::numeric > 599
    OR pg_catalog.jsonb_typeof(request_payload->'errorCode') IS DISTINCT FROM 'string'
    OR request_payload->>'errorCode' NOT IN (
      '', 'push_api_unavailable', 'push_subscription_read_failed',
      'subscription_key_mismatch', 'push_subscribe_failed',
      'push_silent_migration_failed', 'silent_push_unavailable',
      'missing_subscription', 'incomplete_subscription',
      'subscription_fingerprint_failed', 'page_bridge_failed', 'network_error',
      'http_error', 'signal_delivery_rejected', 'signal_delivery_http',
      'local_app_unreachable'
    )
    OR pg_catalog.jsonb_typeof(request_payload->'lastRegistrationAt') IS DISTINCT FROM 'string'
    OR request_payload->>'lastRegistrationAt' !~ '^(|\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)$'
    OR pg_catalog.jsonb_typeof(request_payload->'lastNotificationAt') IS DISTINCT FROM 'string'
    OR request_payload->>'lastNotificationAt' !~ '^(|\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)$'
    OR pg_catalog.jsonb_typeof(request_payload->'lastDeliveryAt') IS DISTINCT FROM 'string'
    OR request_payload->>'lastDeliveryAt' !~ '^(|\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)$'
    OR pg_catalog.jsonb_typeof(request_payload->'updatedAt') IS DISTINCT FROM 'string'
    OR request_payload->>'updatedAt' !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONFIRMATION}'
    OR ((request_payload->>'ready')::boolean
      AND request_payload->>'state' <> 'ready') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-status payload shape is invalid';
  END IF;

  device_id_value := request_payload->>'deviceId';
  source_connection_id_value := request_payload->>'sourceConnectionId';
  state_value := request_payload->>'state';
  ready_value := (request_payload->>'ready')::boolean;
  subscription_present_value := (request_payload->>'subscriptionPresent')::boolean;
  pending_signals_value := (request_payload->>'pendingSignals')::integer;
  last_http_status_value := (request_payload->>'lastHttpStatus')::integer;
  error_code_value := request_payload->>'errorCode';
  last_registration_at_value := request_payload->>'lastRegistrationAt';
  last_notification_at_value := request_payload->>'lastNotificationAt';
  last_delivery_at_value := request_payload->>'lastDeliveryAt';
  updated_at_value := request_payload->>'updatedAt';
  desired_connection_status := CASE
    WHEN ready_value THEN 'connected'
    WHEN state_value = 'error' THEN 'error'
    ELSE 'connecting'
  END;

  BEGIN
    updated_at_timestamp := updated_at_value::timestamptz;
    IF pg_catalog.to_char(updated_at_timestamp AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> updated_at_value
      OR (last_registration_at_value <> '' AND pg_catalog.to_char(
        last_registration_at_value::timestamptz AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> last_registration_at_value)
      OR (last_notification_at_value <> '' AND pg_catalog.to_char(
        last_notification_at_value::timestamptz AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> last_notification_at_value)
      OR (last_delivery_at_value <> '' AND pg_catalog.to_char(
        last_delivery_at_value::timestamptz AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> last_delivery_at_value) THEN
      RAISE EXCEPTION 'timestamp mismatch';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-status timestamp is invalid';
  END;

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

  derived_request_id := 'source_status_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${requestIdentityParts}, 'UTF8')),
    'hex'
  ), 1, 32);
  IF request_id <> derived_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-status request identity is invalid';
  END IF;

  SELECT MIN(lock_result.result_json)::jsonb, COUNT(*)
    INTO writer_lock_result, writer_lock_result_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION)}(
    expected_tenant_id, expected_user_id, source_connection_id_value, '', '', '10000'
  ) AS lock_result;
  IF writer_lock_result_count <> 1 OR writer_lock_result IS NULL
    OR writer_lock_result->>'contractVersion' <> '1'
    OR writer_lock_result->>'lockProtocolVersion' <> 'signal_action_constraints_v1'
    OR writer_lock_result->>'lockMask' <> '10000'
    OR writer_lock_result->>'scopeCount' <> '1'
    OR writer_lock_result->>'sourceConnectionId' <> source_connection_id_value
    OR writer_lock_result->>'retailerId' <> ''
    OR writer_lock_result->>'missionId' <> ''
    OR writer_lock_result->>'mutationApplied' <> 'false'
    OR writer_lock_result->>'mutationAuthority' <> 'false'
    OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-status shared writer-lock protocol failed';
  END IF;

  SELECT device.id, device.status
    INTO device_record
  FROM ${relation(manifest.schemaName, "extension_devices")} AS device
  WHERE device.id = device_id_value
    AND device.tenant_id = resolved_tenant_id
    AND device.user_id = resolved_user_id
  FOR UPDATE OF device;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-status device ownership is invalid';
  END IF;
  IF device_record.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-status device is not active';
  END IF;

  SELECT connection.source, connection.status, connection.is_private,
         connection.updated_at
    INTO source_record
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = source_connection_id_value
    AND connection.tenant_id = resolved_tenant_id
    AND connection.user_id = resolved_user_id
  FOR UPDATE OF connection;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-status source ownership is invalid';
  END IF;
  IF source_record.source <> 'trackalacker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-status source is not TrackaLacker';
  END IF;
  IF source_record.is_private <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-status source is not private';
  END IF;
  IF source_record.status NOT IN ('disconnected', 'connecting', 'connected', 'error')
    OR source_record.updated_at !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal source-status current source is invalid';
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    request_payload::text, 'UTF8'
  )), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_source_status_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_source_status_outbox_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit
  WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
  WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal source-status request graph is partial';
  END IF;
  IF audit_count = 1 THEN
    SELECT audit.tenant_id, audit.user_id, audit.correlation_id,
           audit.event_type, audit.reason_code, audit.message,
           audit.data_json::jsonb AS audit_data, audit.created_at AS audit_created_at,
           outbox.tenant_id AS outbox_tenant_id, outbox.aggregate_type,
           outbox.aggregate_id, outbox.event_type AS outbox_event_type,
           outbox.payload_json::jsonb AS outbox_payload,
           outbox.created_at AS outbox_created_at
      INTO STRICT replay_record
    FROM ${relation(manifest.schemaName, "audit_events")} AS audit
    JOIN ${relation(manifest.schemaName, "outbox_events")} AS outbox
      ON outbox.id = outbox_id_value
    WHERE audit.id = audit_id_value;
    status_result := replay_record.audit_data->'result';
    reason_code_value := CASE WHEN ready_value THEN 'ready' ELSE state_value END;
    message_value := CASE WHEN ready_value
      THEN 'TrackaLacker push bridge is ready.'
      ELSE 'TrackaLacker push bridge status changed.' END;
    IF replay_record.tenant_id <> resolved_tenant_id
      OR replay_record.user_id <> resolved_user_id
      OR replay_record.correlation_id <> device_id_value
      OR replay_record.event_type <> 'source_connection_status'
      OR replay_record.reason_code <> reason_code_value
      OR replay_record.message <> message_value
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR replay_record.audit_data->>'deviceId' <> device_id_value
      OR replay_record.audit_data->>'sourceConnectionId' <> source_connection_id_value
      OR replay_record.audit_data->>'state' <> state_value
      OR replay_record.audit_data->>'pendingSignals' <> pending_signals_value::text
      OR replay_record.audit_data->>'lastHttpStatus' <> last_http_status_value::text
      OR replay_record.audit_data->>'errorCode' <> error_code_value
      OR pg_catalog.jsonb_typeof(status_result) IS DISTINCT FROM 'object'
      OR status_result->>'deviceId' <> device_id_value
      OR status_result->>'sourceConnectionId' <> source_connection_id_value
      OR status_result->>'state' <> state_value
      OR status_result->'ready' IS DISTINCT FROM request_payload->'ready'
      OR status_result->'subscriptionPresent'
        IS DISTINCT FROM request_payload->'subscriptionPresent'
      OR status_result->>'pendingSignals' <> pending_signals_value::text
      OR status_result->>'lastHttpStatus' <> last_http_status_value::text
      OR status_result->>'errorCode' <> error_code_value
      OR status_result->>'lastRegistrationAt' <> last_registration_at_value
      OR status_result->>'lastNotificationAt' <> last_notification_at_value
      OR status_result->>'lastDeliveryAt' <> last_delivery_at_value
      OR status_result->>'updatedAt' <> updated_at_value
      OR status_result->>'connectionStatus' <> desired_connection_status
      OR status_result->>'connectionUpdatedAt' <> replay_record.audit_created_at
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'source_connection'
      OR replay_record.aggregate_id <> device_id_value
      OR replay_record.outbox_event_type <> 'source_connection_status'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> device_id_value
      OR replay_record.outbox_payload->>'reasonCode' <> reason_code_value
      OR replay_record.outbox_payload->>'message' <> message_value
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal source-status replay graph changed';
    END IF;
    RETURN QUERY SELECT pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'operation', operation_name,
      'requestId', request_id,
      'requestFingerprint', request_fingerprint_value,
      'outcome', 'already_applied',
      'mutationApplied', FALSE,
      'idempotentReplay', TRUE,
      'mutationStatementCount', 0,
      'mutationRowCount', 0,
      'stateMutated', FALSE,
      'connectionMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE,
      'status', status_result,
      'sourceStatusWriterParity', TRUE,
      'sourceSyncWriterParity', FALSE,
      'sourceWriterParity', FALSE,
      'retailerQualificationWriterParity', TRUE,
      'missionPolicyWriterParity', TRUE,
      'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE,
      'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE,
      'sharedCatalogMutationAuthority', FALSE,
      'actionAuthority', FALSE,
      'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  SELECT state, ready, subscription_present, pending_signals, last_http_status,
         error_code, last_registration_at, last_notification_at,
         last_delivery_at, updated_at
    INTO previous_record
  FROM ${relation(manifest.schemaName, "source_device_states")} AS device_state
  WHERE device_state.device_id = device_id_value
    AND device_state.source_connection_id = source_connection_id_value
  FOR UPDATE OF device_state;
  previous_found := FOUND;

  IF previous_found AND updated_at_timestamp < previous_record.updated_at::timestamptz THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal source-status update is stale';
  END IF;
  IF previous_found AND updated_at_timestamp = previous_record.updated_at::timestamptz THEN
    IF previous_record.state <> state_value
      OR (previous_record.ready = 1) <> ready_value
      OR (previous_record.subscription_present = 1) <> subscription_present_value
      OR previous_record.pending_signals <> pending_signals_value
      OR previous_record.last_http_status <> last_http_status_value
      OR previous_record.error_code <> error_code_value
      OR previous_record.last_registration_at <> last_registration_at_value
      OR previous_record.last_notification_at <> last_notification_at_value
      OR previous_record.last_delivery_at <> last_delivery_at_value
      OR source_record.status <> desired_connection_status THEN
      RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal source-status timestamp collision changed state';
    END IF;
    status_result := pg_catalog.jsonb_build_object(
      'deviceId', device_id_value,
      'sourceConnectionId', source_connection_id_value,
      'state', state_value,
      'ready', ready_value,
      'subscriptionPresent', subscription_present_value,
      'pendingSignals', pending_signals_value,
      'lastHttpStatus', last_http_status_value,
      'errorCode', error_code_value,
      'lastRegistrationAt', last_registration_at_value,
      'lastNotificationAt', last_notification_at_value,
      'lastDeliveryAt', last_delivery_at_value,
      'updatedAt', updated_at_value,
      'connectionStatus', desired_connection_status,
      'connectionUpdatedAt', source_record.updated_at
    );
    RETURN QUERY SELECT pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'operation', operation_name,
      'requestId', request_id,
      'requestFingerprint', request_fingerprint_value,
      'outcome', 'already_current',
      'mutationApplied', FALSE,
      'idempotentReplay', TRUE,
      'mutationStatementCount', 0,
      'mutationRowCount', 0,
      'stateMutated', FALSE,
      'connectionMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE,
      'status', status_result,
      'sourceStatusWriterParity', TRUE,
      'sourceSyncWriterParity', FALSE,
      'sourceWriterParity', FALSE,
      'retailerQualificationWriterParity', TRUE,
      'missionPolicyWriterParity', TRUE,
      'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE,
      'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE,
      'sharedCatalogMutationAuthority', FALSE,
      'actionAuthority', FALSE,
      'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  material_change := NOT previous_found
    OR previous_record.state <> state_value
    OR (previous_record.ready = 1) <> ready_value
    OR (previous_record.subscription_present = 1) <> subscription_present_value
    OR previous_record.pending_signals <> pending_signals_value
    OR previous_record.last_http_status <> last_http_status_value
    OR previous_record.error_code <> error_code_value
    OR previous_record.last_registration_at <> last_registration_at_value
    OR previous_record.last_notification_at <> last_notification_at_value
    OR previous_record.last_delivery_at <> last_delivery_at_value;

  connection_updated_timestamp := pg_catalog.to_char(
    GREATEST(
      pg_catalog.statement_timestamp(),
      source_record.updated_at::timestamptz + INTERVAL '1 millisecond'
    ) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  INSERT INTO ${relation(manifest.schemaName, "source_device_states")}(
    device_id, source_connection_id, state, ready, subscription_present,
    pending_signals, last_http_status, error_code, last_registration_at,
    last_notification_at, last_delivery_at, updated_at
  ) VALUES (
    device_id_value, source_connection_id_value, state_value,
    CASE WHEN ready_value THEN 1 ELSE 0 END,
    CASE WHEN subscription_present_value THEN 1 ELSE 0 END,
    pending_signals_value, last_http_status_value, error_code_value,
    last_registration_at_value, last_notification_at_value,
    last_delivery_at_value, updated_at_value
  ) ON CONFLICT(device_id, source_connection_id) DO UPDATE SET
    state = EXCLUDED.state,
    ready = EXCLUDED.ready,
    subscription_present = EXCLUDED.subscription_present,
    pending_signals = EXCLUDED.pending_signals,
    last_http_status = EXCLUDED.last_http_status,
    error_code = EXCLUDED.error_code,
    last_registration_at = EXCLUDED.last_registration_at,
    last_notification_at = EXCLUDED.last_notification_at,
    last_delivery_at = EXCLUDED.last_delivery_at,
    updated_at = EXCLUDED.updated_at;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal source-status device-state mutation was ambiguous';
  END IF;

  UPDATE ${relation(manifest.schemaName, "source_connections")}
  SET status = desired_connection_status,
      updated_at = connection_updated_timestamp
  WHERE id = source_connection_id_value
    AND tenant_id = resolved_tenant_id
    AND user_id = resolved_user_id
    AND updated_at = source_record.updated_at;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal source-status connection mutation was ambiguous';
  END IF;

  status_result := pg_catalog.jsonb_build_object(
    'deviceId', device_id_value,
    'sourceConnectionId', source_connection_id_value,
    'state', state_value,
    'ready', ready_value,
    'subscriptionPresent', subscription_present_value,
    'pendingSignals', pending_signals_value,
    'lastHttpStatus', last_http_status_value,
    'errorCode', error_code_value,
    'lastRegistrationAt', last_registration_at_value,
    'lastNotificationAt', last_notification_at_value,
    'lastDeliveryAt', last_delivery_at_value,
    'updatedAt', updated_at_value,
    'connectionStatus', desired_connection_status,
    'connectionUpdatedAt', connection_updated_timestamp
  );

  IF material_change THEN
    reason_code_value := CASE WHEN ready_value THEN 'ready' ELSE state_value END;
    message_value := CASE WHEN ready_value
      THEN 'TrackaLacker push bridge is ready.'
      ELSE 'TrackaLacker push bridge status changed.' END;
    audit_data_value := pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'operation', operation_name,
      'requestId', request_id,
      'requestFingerprint', request_fingerprint_value,
      'deviceId', device_id_value,
      'sourceConnectionId', source_connection_id_value,
      'state', state_value,
      'pendingSignals', pending_signals_value,
      'lastHttpStatus', last_http_status_value,
      'errorCode', error_code_value,
      'result', status_result
    );
    outbox_payload_value := pg_catalog.jsonb_build_object(
      'auditId', audit_id_value,
      'correlationId', device_id_value,
      'reasonCode', reason_code_value,
      'message', message_value,
      'data', audit_data_value
    );
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type,
      reason_code, message, data_json, created_at
    ) VALUES (
      audit_id_value, resolved_tenant_id, resolved_user_id, device_id_value,
      'source_connection_status', reason_code_value, message_value,
      audit_data_value::text, connection_updated_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at
    ) VALUES (
      outbox_id_value, resolved_tenant_id, 'source_connection', device_id_value,
      'source_connection_status', outbox_payload_value::text,
      connection_updated_timestamp, ''
    );
  END IF;

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'outcome', CASE WHEN material_change THEN 'applied' ELSE 'refreshed' END,
    'mutationApplied', TRUE,
    'idempotentReplay', FALSE,
    'mutationStatementCount', CASE WHEN material_change THEN 4 ELSE 2 END,
    'mutationRowCount', CASE WHEN material_change THEN 4 ELSE 2 END,
    'stateMutated', TRUE,
    'connectionMutated', TRUE,
    'auditMutated', material_change,
    'outboxMutated', material_change,
    'status', status_result,
    'sourceStatusWriterParity', TRUE,
    'sourceSyncWriterParity', FALSE,
    'sourceWriterParity', FALSE,
    'retailerQualificationWriterParity', TRUE,
    'missionPolicyWriterParity', TRUE,
    'configurationWriterParity', FALSE,
    'reservationWriterParity', FALSE,
    'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE,
    'sharedCatalogMutationAuthority', FALSE,
    'actionAuthority', FALSE,
    'runtimeAuthority', FALSE
  )::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalSourceStatusApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_source_status_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.sourceStatusRole.name,
    functionName: POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalSourceStatusApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_source_status_apply_receipt",
    receiptTriggerName: "yoink_signal_source_status_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.missionPolicyApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      missionPolicyApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      operationCount: 1,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      sourceScopeConsumed: true,
      deterministicRequestIdentity: true,
      immutableMaterialReplay: true,
      latestStateReplayOnly: true,
      lifecycleAwareOutboxReplay: true,
      nonMaterialAuditSuppression: true,
      monotonicDeviceTimestamp: true,
      databaseOwnedEventTimestamps: true,
      clientObservedAtPreserved: true,
      atomicMaterialStatusAuditOutbox: true,
      currentSourceOwnershipRevalidation: true,
      currentDeviceOwnershipRevalidation: true,
      activeDeviceOnly: true,
      privateSourceOnly: true,
      trackalackerOnly: true,
      materialChangeAuditParity: true,
      sourceTrustWriterParity: true,
      sourceStatusWriterParity: true,
      sourceSyncWriterParity: false,
      sourceWriterParity: false,
      retailerQualificationWriterParity: true,
      missionPolicyWriterParity: true,
      settingsWriterParity: false,
      configurationWriterParity: false,
      reservationWriterParity: false,
      writerLockProtocolParity: false,
      sharedCatalogMutationAuthority: false,
      actionAuthority: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalSourceStatusCapabilityProjection():
PostgresSignalSourceStatusCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalSourceStatusApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    missionPolicyApplyContractVersion: 1,
    writerLockProtocolContractVersion: 1,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactEffectivePrivilegeVerification: true,
    immutableBoundaryCatalogFingerprint: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    securityDefinerRoutineVerified: true,
    phase: "qualified_inactive",
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    sourceScopeConsumed: true,
    deterministicRequestIdentity: true,
    immutableMaterialReplay: true,
    latestStateReplayOnly: true,
    lifecycleAwareOutboxReplay: true,
    nonMaterialAuditSuppression: true,
    monotonicDeviceTimestamp: true,
    databaseOwnedEventTimestamps: true,
    clientObservedAtPreserved: true,
    atomicMaterialStatusAuditOutbox: true,
    currentSourceOwnershipRevalidation: true,
    currentDeviceOwnershipRevalidation: true,
    activeDeviceOnly: true,
    privateSourceOnly: true,
    trackalackerOnly: true,
    materialChangeAuditParity: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: false,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    operationCount: 1,
    protectedTenantTableCount: 5,
    forcedRlsTableCount: 5,
    mutationTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    sharedCatalogMutationAuthority: false,
    actionAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export type PostgresSignalSourceStatusApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalSourceStatusApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalSourceStatusApplyManifest()
): Promise<PostgresSignalSourceStatusApplyQualificationReceipt> {
  await verifyPostgresSignalMissionPolicyApplyBoundary(
    database,
    manifest.predecessorManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalSourceStatusApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalSourceStatusApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalSourceStatusApplyQualificationReceipt> {
  await verifyPostgresSignalMissionPolicyApplyBoundary(
    database,
    manifest.predecessorManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalSourceStatusApplyQualificationError(
      `The PostgreSQL source-status ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalSourceStatusOperation,
  requestId: string
): PostgresSignalSourceStatusApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalSourceStatusApplyQualificationError(
      "The PostgreSQL source-status result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const status = result.status;
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "refreshed", "already_current", "already_applied"])
      .has(String(result.outcome))
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || !Number.isSafeInteger(result.mutationStatementCount)
    || !Number.isSafeInteger(result.mutationRowCount)
    || typeof result.stateMutated !== "boolean"
    || typeof result.connectionMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || !status || typeof status !== "object" || Array.isArray(status)
    || result.sourceStatusWriterParity !== true
    || result.sourceSyncWriterParity !== false
    || result.sourceWriterParity !== false
    || result.retailerQualificationWriterParity !== true
    || result.missionPolicyWriterParity !== true
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== false
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true
    || result.sharedCatalogMutationAuthority !== false
    || result.actionAuthority !== false
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalSourceStatusApplyQualificationError(
      "The PostgreSQL source-status result contract changed."
    );
  }
  return result as unknown as PostgresSignalSourceStatusApplyResult;
}

export class NodePostgresSignalSourceStatusApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalSourceStatusApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalSourceStatusApplyManifest(),
    options: NodePostgresSignalSourceStatusApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalSourceStatusApplyQualificationError(
        "The PostgreSQL source-status connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_source_status"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_source_status");
  }

  async applySourceStatus(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalSourceStatusOperation,
    requestIdValue: string,
    requestPayload: PostgresSignalSourceStatusPayload
  ): Promise<PostgresSignalSourceStatusApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalSourceStatusOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (operation !== "record_trackalacker_push_status"
      || !REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalSourceStatusRequestId(
        { tenantId, userId },
        requestPayload
      )
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalSourceStatusApplyQualificationError(
        "The PostgreSQL source-status apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.sourceStatusRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalSourceStatusApplyQualificationError(
          "The PostgreSQL source-status function returned an ambiguous result."
        );
      }
      const parsed = parseFunctionResult(result.rows[0].resultJson, operation, requestId);
      await client.query("COMMIT");
      return parsed;
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
