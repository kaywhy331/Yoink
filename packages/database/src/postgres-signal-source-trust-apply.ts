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
  POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_CONTRACT_VERSION,
  buildPostgresSignalTargetQualificationApplyManifest,
  verifyPostgresSignalTargetQualificationApplyBoundary,
  type PostgresSignalTargetQualificationApplyManifest
} from "./postgres-signal-target-qualification-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_RECEIPT_TABLE =
  "yoink_signal_source_trust_apply_receipt";
export const POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION =
  "yoink_apply_signal_source_trust";
export const POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_CONFIRMATION =
  "CONFIGURE_SOURCE_TRUST_V1";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 2_048;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/;
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
  "outbox_events",
  "source_connections"
] as const);
const MUTATION_TABLES = Object.freeze([...PROTECTED_TENANT_TABLES] as const);

export type PostgresSignalSourceTrustOperation = "configure_source_trust";

export interface PostgresSignalSourceTrustApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  targetQualificationApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  sourceTrustRoleNamespace: string;
  targetQualificationApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalTargetQualificationApplyManifest;
  sourceTrustRole: {
    kind: "signal_source_trust_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  protectedTenantTableCount: 3;
  forcedRlsTableCount: 3;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  sourceScopeConsumed: true;
  databaseOwnedTimestamps: true;
  optimisticConcurrency: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  atomicSourceAuditOutbox: true;
  currentSourceOwnershipRevalidation: true;
  privateSourceOnly: true;
  trustedExactAutoCreateCoupling: true;
  sourceTrustWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: false;
  missionPolicyWriterParity: false;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalSourceTrustCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  targetQualificationApplyContractVersion: 1;
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
  databaseOwnedTimestamps: true;
  optimisticConcurrency: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  atomicSourceAuditOutbox: true;
  currentSourceOwnershipRevalidation: true;
  privateSourceOnly: true;
  trustedExactAutoCreateCoupling: true;
  sourceTrustWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: false;
  missionPolicyWriterParity: false;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  operationCount: 1;
  protectedTenantTableCount: 3;
  forcedRlsTableCount: 3;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalSourceTrustApplyResult {
  contractVersion: 1;
  operation: "configure_source_trust";
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  sourceMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  configuration: Record<string, unknown>;
  sourceTrustWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  runtimeAuthority: false;
}

export interface NodePostgresSignalSourceTrustApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalSourceTrustCapabilityProjection> | null = null;

export class PostgresSignalSourceTrustApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalSourceTrustApplyQualificationError";
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
    throw new PostgresSignalSourceTrustApplyQualificationError(
      "The PostgreSQL source-trust schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalSourceTrustApplyQualificationError(
      "The PostgreSQL source-trust role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_source_trust`;
  if (value.length > 63) {
    throw new PostgresSignalSourceTrustApplyQualificationError(
      "The PostgreSQL source-trust role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function predecessorNamespaces(manifest: PostgresSignalTargetQualificationApplyManifest): string[] {
  const action = manifest.predecessorManifest;
  const config = action.predecessorManifest;
  const writerLock = config.predecessorManifest;
  const strategy = writerLock.predecessorManifest;
  const mission = strategy.predecessorManifest;
  const predecessor = mission.predecessorManifest;
  return [
    predecessor.readRoleNamespace,
    predecessor.sessionRoleNamespace,
    predecessor.queueWriteRoleNamespace,
    predecessor.controlRoleNamespace,
    predecessor.notificationRecoveryRoleNamespace,
    predecessor.executionRecoveryRoleNamespace,
    predecessor.operationalRetentionRoleNamespace,
    predecessor.observerCandidateRoleNamespace,
    predecessor.alertDispatchRoleNamespace,
    predecessor.alertReconciliationRoleNamespace,
    predecessor.witnessRefreshRoleNamespace,
    predecessor.leaseRecoveryRoleNamespace,
    predecessor.catalogApplyRoleNamespace,
    predecessor.resolutionApplyRoleNamespace,
    predecessor.sourceReferenceRefreshRoleNamespace,
    predecessor.terminalDecisionApplyRoleNamespace,
    predecessor.offerIncidentApplyRoleNamespace,
    predecessor.postIncidentDecisionApplyRoleNamespace,
    mission.missionBindingApplyRoleNamespace,
    strategy.strategyEvaluationRoleNamespace,
    writerLock.writerLockRoleNamespace,
    config.constraintConfigRoleNamespace,
    action.actionSpendRoleNamespace,
    manifest.targetQualificationRoleNamespace
  ];
}

export function buildPostgresSignalSourceTrustApplyManifest(
  predecessorManifest = buildPostgresSignalTargetQualificationApplyManifest(),
  requestedRoleNamespace = "yoink_source_trust_qual"
): PostgresSignalSourceTrustApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const sourceTrustRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (predecessorNamespaces(predecessorManifest).includes(sourceTrustRoleNamespace)) {
    throw new PostgresSignalSourceTrustApplyQualificationError(
      "The PostgreSQL source-trust role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalSourceTrustApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    targetQualificationApplyContractVersion:
      POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    sourceTrustRoleNamespace,
    targetQualificationApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    sourceTrustRole: {
      kind: "signal_source_trust_apply_boundary",
      name: roleName(sourceTrustRoleNamespace),
      functionName: POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    protectedTenantTableCount: 3,
    forcedRlsTableCount: 3,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    sourceScopeConsumed: true,
    databaseOwnedTimestamps: true,
    optimisticConcurrency: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    atomicSourceAuditOutbox: true,
    currentSourceOwnershipRevalidation: true,
    privateSourceOnly: true,
    trustedExactAutoCreateCoupling: true,
    sourceTrustWriterParity: true,
    sourceWriterParity: false,
    retailerQualificationWriterParity: false,
    missionPolicyWriterParity: false,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function signalSourceTrustApplyFunctionSource(
  manifest = buildPostgresSignalSourceTrustApplyManifest()
): string {
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  source_connection_id_value TEXT;
  trust_level_value TEXT;
  auto_create_missions_value BOOLEAN;
  expected_updated_at_value TEXT;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  source_record RECORD;
  updated_timestamp TEXT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  affected_rows BIGINT;
  configuration_result JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'configure_source_trust'
    OR request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-trust request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-trust payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY[
      'autoCreateMissions', 'confirmation', 'expectedUpdatedAt',
      'sourceConnectionId', 'trustLevel'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 5
    OR pg_catalog.jsonb_typeof(request_payload->'sourceConnectionId') IS DISTINCT FROM 'string'
    OR request_payload->>'sourceConnectionId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'trustLevel') IS DISTINCT FROM 'string'
    OR request_payload->>'trustLevel' NOT IN ('informational', 'trusted_exact')
    OR pg_catalog.jsonb_typeof(request_payload->'autoCreateMissions') IS DISTINCT FROM 'boolean'
    OR pg_catalog.jsonb_typeof(request_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string'
    OR request_payload->>'expectedUpdatedAt'
      !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_CONFIRMATION}'
    OR (request_payload->>'trustLevel' = 'informational'
      AND (request_payload->>'autoCreateMissions')::boolean) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-trust payload shape is invalid';
  END IF;
  source_connection_id_value := request_payload->>'sourceConnectionId';
  trust_level_value := request_payload->>'trustLevel';
  auto_create_missions_value := (request_payload->>'autoCreateMissions')::boolean;
  expected_updated_at_value := request_payload->>'expectedUpdatedAt';

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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-trust shared writer-lock protocol failed';
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    request_payload::text, 'UTF8'
  )), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_source_trust_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_source_trust_outbox_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit
  WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
  WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal source-trust request graph is partial';
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
    IF replay_record.tenant_id <> resolved_tenant_id
      OR replay_record.user_id <> resolved_user_id
      OR replay_record.correlation_id <> source_connection_id_value
      OR replay_record.event_type <> 'source_trust_configured'
      OR replay_record.reason_code <> 'explicit_source_trust_v1_configuration'
      OR replay_record.message <> 'Source trust was explicitly configured with auto-mission authority bounded to trusted-exact sources.'
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR replay_record.audit_data->>'sourceConnectionId' <> source_connection_id_value
      OR pg_catalog.jsonb_typeof(replay_record.audit_data->'result') IS DISTINCT FROM 'object'
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'source_connection'
      OR replay_record.aggregate_id <> source_connection_id_value
      OR replay_record.outbox_event_type <> 'source_trust_configured'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> source_connection_id_value
      OR replay_record.outbox_payload->>'reasonCode' <> 'explicit_source_trust_v1_configuration'
      OR replay_record.outbox_payload->>'message' <> replay_record.message
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal source-trust replay graph changed';
    END IF;
    configuration_result := replay_record.audit_data->'result';
    IF configuration_result->>'sourceConnectionId' <> source_connection_id_value
      OR pg_catalog.jsonb_typeof(configuration_result->'source') IS DISTINCT FROM 'string'
      OR pg_catalog.octet_length(configuration_result->>'source') NOT BETWEEN 1 AND 120
      OR configuration_result->>'trustLevel' <> trust_level_value
      OR configuration_result->'autoCreateMissions'
        IS DISTINCT FROM request_payload->'autoCreateMissions'
      OR configuration_result->>'previousTrustLevel' NOT IN ('informational', 'trusted_exact')
      OR pg_catalog.jsonb_typeof(configuration_result->'previousAutoCreateMissions')
        IS DISTINCT FROM 'boolean'
      OR configuration_result->>'updatedAt'
        !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal source-trust replay result changed';
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
      'sourceMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE,
      'configuration', configuration_result,
      'sourceTrustWriterParity', TRUE,
      'sourceWriterParity', FALSE,
      'retailerQualificationWriterParity', FALSE,
      'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE,
      'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE,
      'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  SELECT connection.source, connection.trust_level,
         connection.auto_create_missions, connection.is_private,
         connection.updated_at
    INTO STRICT source_record
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = source_connection_id_value
    AND connection.tenant_id = resolved_tenant_id
    AND connection.user_id = resolved_user_id
  FOR UPDATE OF connection;
  IF source_record.is_private <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-trust source is not private';
  END IF;
  IF pg_catalog.octet_length(source_record.source) NOT BETWEEN 1 AND 120
    OR source_record.trust_level NOT IN ('informational', 'trusted_exact')
    OR source_record.auto_create_missions NOT IN (0, 1) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal source-trust current configuration is invalid';
  END IF;
  IF source_record.updated_at <> expected_updated_at_value THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal source-trust revision changed';
  END IF;

  updated_timestamp := pg_catalog.to_char(
    GREATEST(
      pg_catalog.statement_timestamp(),
      source_record.updated_at::timestamptz + INTERVAL '1 millisecond'
    ) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  UPDATE ${relation(manifest.schemaName, "source_connections")}
  SET trust_level = trust_level_value,
      auto_create_missions = CASE WHEN auto_create_missions_value THEN 1 ELSE 0 END,
      updated_at = updated_timestamp
  WHERE id = source_connection_id_value
    AND tenant_id = resolved_tenant_id
    AND user_id = resolved_user_id
    AND updated_at = expected_updated_at_value;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal source-trust mutation was ambiguous';
  END IF;

  configuration_result := pg_catalog.jsonb_build_object(
    'sourceConnectionId', source_connection_id_value,
    'source', source_record.source,
    'trustLevel', trust_level_value,
    'autoCreateMissions', auto_create_missions_value,
    'previousTrustLevel', source_record.trust_level,
    'previousAutoCreateMissions', source_record.auto_create_missions = 1,
    'updatedAt', updated_timestamp
  );
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'sourceConnectionId', source_connection_id_value,
    'result', configuration_result
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value,
    'correlationId', source_connection_id_value,
    'reasonCode', 'explicit_source_trust_v1_configuration',
    'message', 'Source trust was explicitly configured with auto-mission authority bounded to trusted-exact sources.',
    'data', audit_data_value
  );
  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, source_connection_id_value,
    'source_trust_configured', 'explicit_source_trust_v1_configuration',
    'Source trust was explicitly configured with auto-mission authority bounded to trusted-exact sources.',
    audit_data_value::text, updated_timestamp
  );
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'source_connection',
    source_connection_id_value, 'source_trust_configured',
    outbox_payload_value::text, updated_timestamp, ''
  );

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'outcome', 'applied',
    'mutationApplied', TRUE,
    'idempotentReplay', FALSE,
    'mutationStatementCount', 3,
    'mutationRowCount', 3,
    'sourceMutated', TRUE,
    'auditMutated', TRUE,
    'outboxMutated', TRUE,
    'configuration', configuration_result,
    'sourceTrustWriterParity', TRUE,
    'sourceWriterParity', FALSE,
    'retailerQualificationWriterParity', FALSE,
    'configurationWriterParity', FALSE,
    'reservationWriterParity', FALSE,
    'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE,
    'runtimeAuthority', FALSE
  )::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalSourceTrustApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_source_trust_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.sourceTrustRole.name,
    functionName: POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalSourceTrustApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_source_trust_apply_receipt",
    receiptTriggerName: "yoink_signal_source_trust_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.targetQualificationApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      targetQualificationApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      operationCount: 1,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      sourceScopeConsumed: true,
      optimisticConcurrency: true,
      atomicSourceAuditOutbox: true,
      currentSourceOwnershipRevalidation: true,
      privateSourceOnly: true,
      trustedExactAutoCreateCoupling: true,
      sourceTrustWriterParity: true,
      sourceWriterParity: false,
      retailerQualificationWriterParity: false,
      missionPolicyWriterParity: false,
      settingsWriterParity: false,
      configurationWriterParity: false,
      reservationWriterParity: false,
      writerLockProtocolParity: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalSourceTrustCapabilityProjection():
PostgresSignalSourceTrustCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalSourceTrustApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    targetQualificationApplyContractVersion: 1,
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
    databaseOwnedTimestamps: true,
    optimisticConcurrency: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    atomicSourceAuditOutbox: true,
    currentSourceOwnershipRevalidation: true,
    privateSourceOnly: true,
    trustedExactAutoCreateCoupling: true,
    sourceTrustWriterParity: true,
    sourceWriterParity: false,
    retailerQualificationWriterParity: false,
    missionPolicyWriterParity: false,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    operationCount: 1,
    protectedTenantTableCount: 3,
    forcedRlsTableCount: 3,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export type PostgresSignalSourceTrustApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalSourceTrustApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalSourceTrustApplyManifest()
): Promise<PostgresSignalSourceTrustApplyQualificationReceipt> {
  await verifyPostgresSignalTargetQualificationApplyBoundary(
    database,
    manifest.predecessorManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalSourceTrustApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalSourceTrustApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalSourceTrustApplyQualificationReceipt> {
  await verifyPostgresSignalTargetQualificationApplyBoundary(
    database,
    manifest.predecessorManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalSourceTrustApplyQualificationError(
      `The PostgreSQL source-trust ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalSourceTrustOperation,
  requestId: string
): PostgresSignalSourceTrustApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalSourceTrustApplyQualificationError(
      "The PostgreSQL source-trust result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const configuration = result.configuration;
  if (result.contractVersion !== 1 || result.operation !== operation
    || result.requestId !== requestId || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "already_applied"]).has(String(result.outcome))
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || !Number.isSafeInteger(result.mutationStatementCount)
    || !Number.isSafeInteger(result.mutationRowCount)
    || typeof result.sourceMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || !configuration || typeof configuration !== "object" || Array.isArray(configuration)
    || result.sourceTrustWriterParity !== true
    || result.sourceWriterParity !== false
    || result.retailerQualificationWriterParity !== false
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== false
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true || result.runtimeAuthority !== false) {
    throw new PostgresSignalSourceTrustApplyQualificationError(
      "The PostgreSQL source-trust result contract changed."
    );
  }
  return result as unknown as PostgresSignalSourceTrustApplyResult;
}

export class NodePostgresSignalSourceTrustApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalSourceTrustApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalSourceTrustApplyManifest(),
    options: NodePostgresSignalSourceTrustApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalSourceTrustApplyQualificationError(
        "The PostgreSQL source-trust connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_source_trust"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_source_trust");
  }

  async applySourceTrust(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalSourceTrustOperation,
    requestIdValue: string,
    requestPayload: Record<string, unknown>
  ): Promise<PostgresSignalSourceTrustApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalSourceTrustOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (operation !== "configure_source_trust" || !REQUEST_ID.test(requestId)
      || !payloadJson || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalSourceTrustApplyQualificationError(
        "The PostgreSQL source-trust apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.sourceTrustRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION)}(
           $1, $2, $3, $4, $5
         )`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalSourceTrustApplyQualificationError(
          "The PostgreSQL source-trust function returned an ambiguous result."
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
