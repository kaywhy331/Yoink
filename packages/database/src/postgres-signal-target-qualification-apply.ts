import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import {
  TARGET_ADD_ACTIVATION_CONFIRMATION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION
} from "../../contracts/src/index.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  logIdlePostgresClientErrors
} from "./postgres-cutover.js";
import {
  POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION,
  buildPostgresSignalActionSpendApplyManifest,
  verifyPostgresSignalActionSpendApplyBoundary,
  type PostgresSignalActionSpendApplyManifest
} from "./postgres-signal-action-spend-apply.js";
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

export const POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_RECEIPT_TABLE =
  "yoink_signal_target_qualification_apply_receipt";
export const POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION =
  "yoink_apply_signal_target_qualification";

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
  "action_events",
  "action_jobs",
  "app_settings",
  "audit_events",
  "extension_devices",
  "outbox_events",
  "retailer_adapter_qualifications",
  "retailer_adapter_trials",
  "retailer_shadow_observations"
] as const);
const MUTATION_TABLES = Object.freeze([
  "action_events",
  "action_jobs",
  "app_settings",
  "audit_events",
  "outbox_events",
  "retailer_adapter_qualifications"
] as const);

export type PostgresSignalTargetQualificationOperation = "activate_target_add";

export interface PostgresSignalTargetQualificationApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  actionSpendApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  targetQualificationRoleNamespace: string;
  actionSpendApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalActionSpendApplyManifest;
  targetQualificationRole: {
    kind: "signal_target_qualification_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  protectedTenantTableCount: 9;
  forcedRlsTableCount: 9;
  mutationTableCount: 6;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  retailerQualificationScopeConsumed: true;
  settingsScopeConsumed: true;
  databaseOwnedTimestamps: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  atomicQualificationSettingsPromotionAuditOutbox: true;
  currentEvidenceRevalidation: true;
  currentDeviceCapabilityRevalidation: true;
  targetQualificationSettingsWriterParity: true;
  targetJobPromotionParity: true;
  qualificationSettingsWriterParity: true;
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

export interface PostgresSignalTargetQualificationCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  actionSpendApplyContractVersion: 1;
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
  retailerQualificationScopeConsumed: true;
  settingsScopeConsumed: true;
  databaseOwnedTimestamps: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  atomicQualificationSettingsPromotionAuditOutbox: true;
  currentEvidenceRevalidation: true;
  currentDeviceCapabilityRevalidation: true;
  targetQualificationSettingsWriterParity: true;
  targetJobPromotionParity: true;
  qualificationSettingsWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: false;
  missionPolicyWriterParity: false;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  operationCount: 1;
  protectedTenantTableCount: 9;
  forcedRlsTableCount: 9;
  mutationTableCount: 6;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalTargetQualificationApplyResult {
  contractVersion: 1;
  operation: "activate_target_add";
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  qualificationMutated: boolean;
  settingsMutated: boolean;
  promotedJobCount: number;
  actionEventsMutated: number;
  auditMutated: boolean;
  outboxMutated: boolean;
  activation: Record<string, unknown>;
  qualificationSettingsWriterParity: true;
  retailerQualificationWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  runtimeAuthority: false;
}

export interface NodePostgresSignalTargetQualificationApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalTargetQualificationCapabilityProjection> | null = null;

export class PostgresSignalTargetQualificationApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalTargetQualificationApplyQualificationError";
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
    throw new PostgresSignalTargetQualificationApplyQualificationError(
      "The PostgreSQL Target qualification schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalTargetQualificationApplyQualificationError(
      "The PostgreSQL Target qualification role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_target_qualification`;
  if (value.length > 63) {
    throw new PostgresSignalTargetQualificationApplyQualificationError(
      "The PostgreSQL Target qualification role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function predecessorNamespaces(manifest: PostgresSignalActionSpendApplyManifest): string[] {
  const config = manifest.predecessorManifest;
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
    manifest.actionSpendRoleNamespace
  ];
}

export function buildPostgresSignalTargetQualificationApplyManifest(
  predecessorManifest = buildPostgresSignalActionSpendApplyManifest(),
  requestedRoleNamespace = "yoink_target_qualification_qual"
): PostgresSignalTargetQualificationApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const targetQualificationRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (predecessorNamespaces(predecessorManifest).includes(targetQualificationRoleNamespace)) {
    throw new PostgresSignalTargetQualificationApplyQualificationError(
      "The PostgreSQL Target qualification role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalTargetQualificationApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    actionSpendApplyContractVersion: POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    targetQualificationRoleNamespace,
    actionSpendApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    targetQualificationRole: {
      kind: "signal_target_qualification_apply_boundary",
      name: roleName(targetQualificationRoleNamespace),
      functionName: POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    protectedTenantTableCount: 9,
    forcedRlsTableCount: 9,
    mutationTableCount: 6,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    retailerQualificationScopeConsumed: true,
    settingsScopeConsumed: true,
    databaseOwnedTimestamps: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    atomicQualificationSettingsPromotionAuditOutbox: true,
    currentEvidenceRevalidation: true,
    currentDeviceCapabilityRevalidation: true,
    targetQualificationSettingsWriterParity: true,
    targetJobPromotionParity: true,
    qualificationSettingsWriterParity: true,
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

export function signalTargetQualificationApplyFunctionSource(
  manifest = buildPostgresSignalTargetQualificationApplyManifest()
): string {
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  evidence_hash_input TEXT;
  expected_settings_updated_at TEXT;
  evidence_cutoff TEXT;
  active_device_cutoff TEXT;
  observation_count_value BIGINT;
  distinct_sku_count_value BIGINT;
  first_party_actionable_count BIGINT;
  shipping_actionable_count BIGINT;
  rehearsal_count_value BIGINT;
  qualification_parts TEXT;
  computed_evidence_hash TEXT;
  device_record RECORD;
  device_capabilities JSONB;
  settings_record RECORD;
  qualification_updated_at_value TEXT;
  updated_timestamp TEXT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  replay_promotion_count BIGINT;
  job_record RECORD;
  action_event_id_value TEXT;
  promotions_result JSONB := '[]'::jsonb;
  promoted_job_count_value BIGINT := 0;
  action_events_mutated_value BIGINT := 0;
  mutation_statement_count_value BIGINT := 0;
  mutation_row_count_value BIGINT := 0;
  activation_result JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'activate_target_add'
    OR request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal Target qualification request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal Target qualification payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY[
      'adapterVersion', 'confirmation', 'evidenceHash', 'expectedSettingsUpdatedAt'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 4
    OR pg_catalog.jsonb_typeof(request_payload->'adapterVersion') IS DISTINCT FROM 'string'
    OR request_payload->>'adapterVersion' <> '${TARGET_ADD_ADAPTER_VERSION}'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${TARGET_ADD_ACTIVATION_CONFIRMATION}'
    OR pg_catalog.jsonb_typeof(request_payload->'evidenceHash') IS DISTINCT FROM 'string'
    OR request_payload->>'evidenceHash' !~ '^[a-f0-9]{64}$'
    OR pg_catalog.jsonb_typeof(request_payload->'expectedSettingsUpdatedAt') IS DISTINCT FROM 'string'
    OR request_payload->>'expectedSettingsUpdatedAt'
      !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal Target qualification payload shape is invalid';
  END IF;
  evidence_hash_input := request_payload->>'evidenceHash';
  expected_settings_updated_at := request_payload->>'expectedSettingsUpdatedAt';

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
    expected_tenant_id, expected_user_id, '', 'target', '', '01100'
  ) AS lock_result;
  IF writer_lock_result_count <> 1 OR writer_lock_result IS NULL
    OR writer_lock_result->>'contractVersion' <> '1'
    OR writer_lock_result->>'lockProtocolVersion' <> 'signal_action_constraints_v1'
    OR writer_lock_result->>'lockMask' <> '01100'
    OR writer_lock_result->>'scopeCount' <> '2'
    OR writer_lock_result->>'sourceConnectionId' <> ''
    OR writer_lock_result->>'retailerId' <> 'target'
    OR writer_lock_result->>'missionId' <> ''
    OR writer_lock_result->>'mutationApplied' <> 'false'
    OR writer_lock_result->>'mutationAuthority' <> 'false'
    OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal Target qualification shared writer-lock protocol failed';
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    request_payload::text, 'UTF8'
  )), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_target_qualification_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_target_qualification_outbox_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit
  WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
  WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal Target qualification request graph is partial';
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
      OR replay_record.correlation_id <> 'target'
      OR replay_record.event_type <> 'retailer_adapter_qualified'
      OR replay_record.reason_code <> 'explicit_target_add_v1_activation'
      OR replay_record.message <> 'Target add v4 was explicitly enabled for Target-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.'
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR pg_catalog.jsonb_typeof(replay_record.audit_data->'result') IS DISTINCT FROM 'object'
      OR replay_record.audit_data->'result'->>'evidenceHash' <> evidence_hash_input
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'retailer_qualification'
      OR replay_record.aggregate_id <> 'target'
      OR replay_record.outbox_event_type <> 'retailer_adapter_qualified'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> 'target'
      OR replay_record.outbox_payload->>'reasonCode' <> 'explicit_target_add_v1_activation'
      OR replay_record.outbox_payload->>'message' <> replay_record.message
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal Target qualification replay graph changed';
    END IF;
    activation_result := replay_record.audit_data->'result';
    IF pg_catalog.jsonb_typeof(activation_result->'promotions') IS DISTINCT FROM 'array'
      OR activation_result->>'promotedJobs' !~ '^(0|[1-9][0-9]{0,8})$' THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal Target qualification replay promotions changed';
    END IF;
    SELECT COUNT(*) INTO replay_promotion_count
    FROM pg_catalog.jsonb_array_elements(activation_result->'promotions') AS promotion(value)
    JOIN ${relation(manifest.schemaName, "action_events")} AS action_event
      ON action_event.id = promotion.value->>'actionEventId'
     AND action_event.job_id = promotion.value->>'jobId'
     AND action_event.state = 'awaiting_executor'
     AND action_event.reason_code = 'target_add_v1_activated'
     AND action_event.message = 'A fresh shadow job entered the guarded Target add-only executor after explicit activation.'
     AND action_event.evidence_json::jsonb = pg_catalog.jsonb_build_object(
       'adapterVersion', '${TARGET_ADD_ADAPTER_VERSION}'
     )
     AND action_event.created_at = replay_record.audit_created_at
    WHERE pg_catalog.jsonb_typeof(promotion.value) = 'object';
    IF replay_promotion_count <> (activation_result->>'promotedJobs')::bigint
      OR replay_promotion_count <> pg_catalog.jsonb_array_length(activation_result->'promotions') THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal Target qualification replay action events changed';
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
      'qualificationMutated', FALSE,
      'settingsMutated', FALSE,
      'promotedJobCount', activation_result->'promotedJobs',
      'actionEventsMutated', 0,
      'auditMutated', FALSE,
      'outboxMutated', FALSE,
      'activation', activation_result,
      'qualificationSettingsWriterParity', TRUE,
      'retailerQualificationWriterParity', FALSE,
      'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE,
      'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE,
      'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  SELECT settings.actions_paused, settings.pause_reason, settings.execution_mode,
         settings.updated_at
    INTO STRICT settings_record
  FROM ${relation(manifest.schemaName, "app_settings")} AS settings
  JOIN ${relation(manifest.schemaName, "users")} AS account ON account.id = settings.user_id
  WHERE settings.user_id = resolved_user_id AND account.tenant_id = resolved_tenant_id
  FOR UPDATE OF settings;
  IF settings_record.updated_at <> expected_settings_updated_at THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal Target qualification settings revision changed';
  END IF;

  LOCK TABLE ${relation(manifest.schemaName, "retailer_shadow_observations")} IN SHARE MODE;
  LOCK TABLE ${relation(manifest.schemaName, "retailer_adapter_trials")} IN SHARE MODE;
  evidence_cutoff := pg_catalog.to_char(
    (pg_catalog.statement_timestamp() - INTERVAL '30 days') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  active_device_cutoff := pg_catalog.to_char(
    (pg_catalog.statement_timestamp() - INTERVAL '5 minutes') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  SELECT COUNT(*), COUNT(DISTINCT observation.retailer_sku),
         COUNT(*) FILTER (
           WHERE observation.observation_state = 'actionable_candidate'
             AND observation.seller_type = 'first_party'
             AND observation.seller_name = 'Target'
         ),
         COUNT(*) FILTER (
           WHERE observation.observation_state = 'actionable_candidate'
             AND observation.fulfillment = 'shipping'
         )
    INTO observation_count_value, distinct_sku_count_value,
         first_party_actionable_count, shipping_actionable_count
  FROM ${relation(manifest.schemaName, "retailer_shadow_observations")} AS observation
  WHERE observation.tenant_id = resolved_tenant_id
    AND observation.user_id = resolved_user_id
    AND observation.retailer_id = 'target'
    AND observation.adapter_version = '${TARGET_OBSERVER_VERSION}'
    AND observation.observed_at >= evidence_cutoff;

  SELECT COUNT(*) INTO rehearsal_count_value
  FROM ${relation(manifest.schemaName, "retailer_adapter_trials")} AS trial
  WHERE trial.tenant_id = resolved_tenant_id
    AND trial.user_id = resolved_user_id
    AND trial.retailer_id = 'target'
    AND trial.adapter_version = '${TARGET_ADD_ADAPTER_VERSION}'
    AND trial.trial_kind = 'pre_click_rehearsal'
    AND trial.outcome = 'passed'
    AND trial.observed_at >= evidence_cutoff;

  IF first_party_actionable_count < 1 OR shipping_actionable_count < 1
    OR distinct_sku_count_value < 2 OR rehearsal_count_value < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal Target qualification evidence is incomplete';
  END IF;

  SELECT pg_catalog.string_agg(
           pg_catalog.octet_length(evidence.hash_value)::text || ':' ||
             evidence.hash_value || '|', '' ORDER BY evidence.hash_value
         ) INTO qualification_parts
  FROM (
    SELECT DISTINCT observation.evidence_hash AS hash_value
    FROM ${relation(manifest.schemaName, "retailer_shadow_observations")} AS observation
    WHERE observation.tenant_id = resolved_tenant_id
      AND observation.user_id = resolved_user_id
      AND observation.retailer_id = 'target'
      AND observation.adapter_version = '${TARGET_OBSERVER_VERSION}'
      AND observation.observed_at >= evidence_cutoff
    UNION ALL
    SELECT trial.evidence_hash AS hash_value
    FROM ${relation(manifest.schemaName, "retailer_adapter_trials")} AS trial
    WHERE trial.tenant_id = resolved_tenant_id
      AND trial.user_id = resolved_user_id
      AND trial.retailer_id = 'target'
      AND trial.adapter_version = '${TARGET_ADD_ADAPTER_VERSION}'
      AND trial.trial_kind = 'pre_click_rehearsal'
      AND trial.outcome = 'passed'
      AND trial.observed_at >= evidence_cutoff
  ) AS evidence;
  computed_evidence_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.octet_length('target-add-qualification-evidence-v1')::text ||
      ':target-add-qualification-evidence-v1|' ||
    pg_catalog.octet_length('${TARGET_ADD_ADAPTER_VERSION}')::text ||
      ':${TARGET_ADD_ADAPTER_VERSION}|' ||
    COALESCE(qualification_parts, ''),
    'UTF8'
  )), 'hex');
  IF computed_evidence_hash <> evidence_hash_input THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal Target qualification evidence changed';
  END IF;

  SELECT device.capabilities_json, device.last_seen_at
    INTO device_record
  FROM ${relation(manifest.schemaName, "extension_devices")} AS device
  WHERE device.tenant_id = resolved_tenant_id
    AND device.user_id = resolved_user_id
    AND device.status = 'active'
  ORDER BY device.last_seen_at DESC, device.id DESC
  LIMIT 1
  FOR SHARE OF device;
  IF NOT FOUND OR device_record.last_seen_at < active_device_cutoff THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal Target qualification requires a current Chrome companion';
  END IF;
  BEGIN
    device_capabilities := device_record.capabilities_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal Target qualification device capabilities are invalid';
  END;
  IF pg_catalog.jsonb_typeof(device_capabilities) IS DISTINCT FROM 'object'
    OR device_capabilities->'targetAddOnly' IS DISTINCT FROM 'true'::jsonb
    OR device_capabilities->>'targetAddAdapterVersion' <> '${TARGET_ADD_ADAPTER_VERSION}' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal Target qualification requires Target add v4 capability';
  END IF;

  SELECT qualification.updated_at
    INTO qualification_updated_at_value
  FROM ${relation(manifest.schemaName, "retailer_adapter_qualifications")} AS qualification
  WHERE qualification.tenant_id = resolved_tenant_id
    AND qualification.user_id = resolved_user_id
    AND qualification.retailer_id = 'target'
  FOR UPDATE OF qualification;
  updated_timestamp := pg_catalog.to_char(
    GREATEST(
      pg_catalog.statement_timestamp(),
      settings_record.updated_at::timestamptz + INTERVAL '1 millisecond',
      CASE WHEN qualification_updated_at_value IS NULL
        THEN '-infinity'::timestamptz
        ELSE qualification_updated_at_value::timestamptz + INTERVAL '1 millisecond' END
    ) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  INSERT INTO ${relation(manifest.schemaName, "retailer_adapter_qualifications")}(
    tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
    evidence_hash, qualified_at, updated_at
  ) VALUES (
    resolved_tenant_id, resolved_user_id, 'target', '${TARGET_ADD_ADAPTER_VERSION}',
    'add_to_cart', 'qualified', evidence_hash_input, updated_timestamp, updated_timestamp
  )
  ON CONFLICT(user_id, retailer_id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    adapter_version = EXCLUDED.adapter_version,
    highest_action = EXCLUDED.highest_action,
    status = EXCLUDED.status,
    evidence_hash = EXCLUDED.evidence_hash,
    qualified_at = EXCLUDED.qualified_at,
    updated_at = EXCLUDED.updated_at;
  mutation_statement_count_value := mutation_statement_count_value + 1;
  GET DIAGNOSTICS mutation_row_count_value = ROW_COUNT;
  IF mutation_row_count_value <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal Target qualification mutation was ambiguous';
  END IF;

  UPDATE ${relation(manifest.schemaName, "app_settings")}
  SET execution_mode = 'live', actions_paused = 0,
      pause_reason = '', updated_at = updated_timestamp
  WHERE user_id = resolved_user_id;
  mutation_statement_count_value := mutation_statement_count_value + 1;
  GET DIAGNOSTICS replay_promotion_count = ROW_COUNT;
  mutation_row_count_value := mutation_row_count_value + replay_promotion_count;
  IF replay_promotion_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal Target qualification settings mutation was ambiguous';
  END IF;

  FOR job_record IN
    SELECT job.id
    FROM ${relation(manifest.schemaName, "action_jobs")} AS job
    JOIN ${relation(manifest.schemaName, "listings")} AS listing ON listing.id = job.listing_id
    WHERE job.tenant_id = resolved_tenant_id
      AND job.user_id = resolved_user_id
      AND job.state = 'shadow_ready'
      AND job.expires_at > updated_timestamp
      AND listing.retailer_id = 'target'
      AND job.action = 'add_to_cart'
      AND job.quantity = 1
      AND job.seller_policy = 'first_party_only'
      AND job.fulfillment IN ('shipping', 'pickup')
    ORDER BY job.created_at, job.id
    FOR UPDATE OF job
  LOOP
    action_event_id_value := 'action_event_' || pg_catalog.substr(pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        'postgres_signal_target_qualification_action_event_v1|' || audit_id_value || '|' || job_record.id,
        'UTF8'
      )), 'hex'), 1, 32);
    UPDATE ${relation(manifest.schemaName, "action_jobs")}
    SET state = 'awaiting_executor', updated_at = updated_timestamp
    WHERE id = job_record.id AND tenant_id = resolved_tenant_id
      AND user_id = resolved_user_id AND state = 'shadow_ready';
    GET DIAGNOSTICS replay_promotion_count = ROW_COUNT;
    IF replay_promotion_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal Target qualification job promotion changed';
    END IF;
    mutation_statement_count_value := mutation_statement_count_value + 1;
    mutation_row_count_value := mutation_row_count_value + 1;
    INSERT INTO ${relation(manifest.schemaName, "action_events")}(
      id, job_id, state, reason_code, message, evidence_json, created_at
    ) VALUES (
      action_event_id_value, job_record.id, 'awaiting_executor', 'target_add_v1_activated',
      'A fresh shadow job entered the guarded Target add-only executor after explicit activation.',
      pg_catalog.jsonb_build_object('adapterVersion', '${TARGET_ADD_ADAPTER_VERSION}')::text,
      updated_timestamp
    );
    mutation_statement_count_value := mutation_statement_count_value + 1;
    mutation_row_count_value := mutation_row_count_value + 1;
    action_events_mutated_value := action_events_mutated_value + 1;
    promoted_job_count_value := promoted_job_count_value + 1;
    promotions_result := promotions_result || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('jobId', job_record.id, 'actionEventId', action_event_id_value)
    );
  END LOOP;

  activation_result := pg_catalog.jsonb_build_object(
    'retailerId', 'target',
    'adapterVersion', '${TARGET_ADD_ADAPTER_VERSION}',
    'observerVersion', '${TARGET_OBSERVER_VERSION}',
    'highestAction', 'add_to_cart',
    'sellerPolicy', 'first_party_only',
    'fulfillment', 'shipping',
    'quantity', 1,
    'evidenceHash', evidence_hash_input,
    'observationCount', observation_count_value,
    'distinctSkuCount', distinct_sku_count_value,
    'rehearsalCount', rehearsal_count_value,
    'qualifiedAt', updated_timestamp,
    'settingsUpdatedAt', updated_timestamp,
    'executionMode', 'live',
    'actionsPaused', FALSE,
    'promotedJobs', promoted_job_count_value,
    'promotions', promotions_result
  );
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'retailerId', 'target',
    'adapterVersion', '${TARGET_ADD_ADAPTER_VERSION}',
    'highestAction', 'add_to_cart',
    'sellerPolicy', 'first_party_only',
    'fulfillment', 'shipping',
    'quantity', 1,
    'evidenceHash', evidence_hash_input,
    'promotedJobs', promoted_job_count_value,
    'result', activation_result
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value,
    'correlationId', 'target',
    'reasonCode', 'explicit_target_add_v1_activation',
    'message', 'Target add v4 was explicitly enabled for Target-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.',
    'data', audit_data_value
  );
  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, 'target',
    'retailer_adapter_qualified', 'explicit_target_add_v1_activation',
    'Target add v4 was explicitly enabled for Target-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.',
    audit_data_value::text, updated_timestamp
  );
  mutation_statement_count_value := mutation_statement_count_value + 1;
  mutation_row_count_value := mutation_row_count_value + 1;
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'retailer_qualification', 'target',
    'retailer_adapter_qualified', outbox_payload_value::text, updated_timestamp, ''
  );
  mutation_statement_count_value := mutation_statement_count_value + 1;
  mutation_row_count_value := mutation_row_count_value + 1;

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'outcome', 'applied',
    'mutationApplied', TRUE,
    'idempotentReplay', FALSE,
    'mutationStatementCount', mutation_statement_count_value,
    'mutationRowCount', mutation_row_count_value,
    'qualificationMutated', TRUE,
    'settingsMutated', TRUE,
    'promotedJobCount', promoted_job_count_value,
    'actionEventsMutated', action_events_mutated_value,
    'auditMutated', TRUE,
    'outboxMutated', TRUE,
    'activation', activation_result,
    'qualificationSettingsWriterParity', TRUE,
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
  manifest: PostgresSignalTargetQualificationApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_target_qualification_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.targetQualificationRole.name,
    functionName: POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalTargetQualificationApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_target_qualification_apply_receipt",
    receiptTriggerName: "yoink_signal_target_qualification_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.actionSpendApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      actionSpendApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      operationCount: 1,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      retailerQualificationScopeConsumed: true,
      settingsScopeConsumed: true,
      currentEvidenceRevalidation: true,
      currentDeviceCapabilityRevalidation: true,
      targetQualificationSettingsWriterParity: true,
      targetJobPromotionParity: true,
      qualificationSettingsWriterParity: true,
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

export function postgresSignalTargetQualificationCapabilityProjection():
PostgresSignalTargetQualificationCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalTargetQualificationApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    actionSpendApplyContractVersion: 1,
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
    retailerQualificationScopeConsumed: true,
    settingsScopeConsumed: true,
    databaseOwnedTimestamps: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    atomicQualificationSettingsPromotionAuditOutbox: true,
    currentEvidenceRevalidation: true,
    currentDeviceCapabilityRevalidation: true,
    targetQualificationSettingsWriterParity: true,
    targetJobPromotionParity: true,
    qualificationSettingsWriterParity: true,
    sourceWriterParity: false,
    retailerQualificationWriterParity: false,
    missionPolicyWriterParity: false,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    operationCount: 1,
    protectedTenantTableCount: 9,
    forcedRlsTableCount: 9,
    mutationTableCount: 6,
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

export type PostgresSignalTargetQualificationApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalTargetQualificationApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalTargetQualificationApplyManifest()
): Promise<PostgresSignalTargetQualificationApplyQualificationReceipt> {
  await verifyPostgresSignalActionSpendApplyBoundary(database, manifest.predecessorManifest);
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalTargetQualificationApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalTargetQualificationApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalTargetQualificationApplyQualificationReceipt> {
  await verifyPostgresSignalActionSpendApplyBoundary(database, manifest.predecessorManifest);
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalTargetQualificationApplyQualificationError(
      `The PostgreSQL Target qualification ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalTargetQualificationOperation,
  requestId: string
): PostgresSignalTargetQualificationApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalTargetQualificationApplyQualificationError(
      "The PostgreSQL Target qualification result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const activation = result.activation;
  if (result.contractVersion !== 1 || result.operation !== operation
    || result.requestId !== requestId || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "already_applied"]).has(String(result.outcome))
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || !Number.isSafeInteger(result.mutationStatementCount)
    || !Number.isSafeInteger(result.mutationRowCount)
    || typeof result.qualificationMutated !== "boolean"
    || typeof result.settingsMutated !== "boolean"
    || !Number.isSafeInteger(result.promotedJobCount)
    || !Number.isSafeInteger(result.actionEventsMutated)
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || !activation || typeof activation !== "object" || Array.isArray(activation)
    || result.qualificationSettingsWriterParity !== true
    || result.retailerQualificationWriterParity !== false
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== false
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true || result.runtimeAuthority !== false) {
    throw new PostgresSignalTargetQualificationApplyQualificationError(
      "The PostgreSQL Target qualification result contract changed."
    );
  }
  return result as unknown as PostgresSignalTargetQualificationApplyResult;
}

export class NodePostgresSignalTargetQualificationApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalTargetQualificationApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalTargetQualificationApplyManifest(),
    options: NodePostgresSignalTargetQualificationApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalTargetQualificationApplyQualificationError(
        "The PostgreSQL Target qualification connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_target_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_target_qualification");
  }

  async applyTargetQualification(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalTargetQualificationOperation,
    requestIdValue: string,
    requestPayload: Record<string, unknown>
  ): Promise<PostgresSignalTargetQualificationApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalTargetQualificationOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (operation !== "activate_target_add" || !REQUEST_ID.test(requestId)
      || !payloadJson || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalTargetQualificationApplyQualificationError(
        "The PostgreSQL Target qualification apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.targetQualificationRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION)}(
           $1, $2, $3, $4, $5
         )`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalTargetQualificationApplyQualificationError(
          "The PostgreSQL Target qualification function returned an ambiguous result."
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
