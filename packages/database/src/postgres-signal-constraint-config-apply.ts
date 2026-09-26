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
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION,
  buildPostgresSignalWriterLockProtocolManifest,
  verifyPostgresSignalWriterLockProtocolBoundary,
  type PostgresSignalWriterLockProtocolManifest
} from "./postgres-signal-writer-lock-protocol.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_RECEIPT_TABLE =
  "yoink_signal_constraint_config_apply_receipt";
export const POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION =
  "yoink_apply_signal_constraint_configuration";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 4_096;
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
  "app_settings",
  "audit_events",
  "outbox_events",
  "user_spend_policies"
] as const);
const MUTATION_TABLES = Object.freeze([...PROTECTED_TENANT_TABLES] as const);

export type PostgresSignalConstraintConfigOperation =
  | "set_actions_paused"
  | "update_guardrail_settings"
  | "update_spend_policy";

export interface PostgresSignalConstraintConfigApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  constraintConfigRoleNamespace: string;
  writerLockProtocolManifestFingerprint: string;
  predecessorManifest: PostgresSignalWriterLockProtocolManifest;
  constraintConfigRole: {
    kind: "signal_constraint_config_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 3;
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  settingsScopeConsumed: true;
  spendScopeConsumed: true;
  databaseOwnedTimestamps: true;
  optimisticConcurrency: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  atomicAuditOutbox: true;
  settingsPauseWriterParity: true;
  guardrailSettingsWriterParity: true;
  spendPolicyWriterParity: true;
  qualificationSettingsWriterParity: false;
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

export interface PostgresSignalConstraintConfigCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
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
  settingsScopeConsumed: true;
  spendScopeConsumed: true;
  databaseOwnedTimestamps: true;
  optimisticConcurrency: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  atomicAuditOutbox: true;
  settingsPauseWriterParity: true;
  guardrailSettingsWriterParity: true;
  spendPolicyWriterParity: true;
  qualificationSettingsWriterParity: false;
  sourceWriterParity: false;
  retailerQualificationWriterParity: false;
  missionPolicyWriterParity: false;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  operationCount: 3;
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalConstraintConfigApplyResult {
  contractVersion: 1;
  operation: PostgresSignalConstraintConfigOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "unchanged" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  settingsMutated: boolean;
  spendPolicyMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  configuration: Record<string, unknown>;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  runtimeAuthority: false;
}

export interface NodePostgresSignalConstraintConfigApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalConstraintConfigCapabilityProjection> | null = null;

export class PostgresSignalConstraintConfigApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalConstraintConfigApplyQualificationError";
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
    throw new PostgresSignalConstraintConfigApplyQualificationError(
      "The PostgreSQL signal constraint-configuration schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalConstraintConfigApplyQualificationError(
      "The PostgreSQL signal constraint-configuration role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_constraint_config`;
  if (value.length > 63) {
    throw new PostgresSignalConstraintConfigApplyQualificationError(
      "The PostgreSQL signal constraint-configuration role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function predecessorNamespaces(manifest: PostgresSignalWriterLockProtocolManifest): string[] {
  const strategy = manifest.predecessorManifest;
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
    manifest.writerLockRoleNamespace
  ];
}

export function buildPostgresSignalConstraintConfigApplyManifest(
  predecessorManifest = buildPostgresSignalWriterLockProtocolManifest(),
  requestedRoleNamespace = "yoink_constraint_config_qual"
): PostgresSignalConstraintConfigApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const constraintConfigRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (predecessorNamespaces(predecessorManifest).includes(constraintConfigRoleNamespace)) {
    throw new PostgresSignalConstraintConfigApplyQualificationError(
      "The PostgreSQL signal constraint-configuration role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalConstraintConfigApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    constraintConfigRoleNamespace,
    writerLockProtocolManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    constraintConfigRole: {
      kind: "signal_constraint_config_apply_boundary",
      name: roleName(constraintConfigRoleNamespace),
      functionName: POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 3,
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
    mutationTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    settingsScopeConsumed: true,
    spendScopeConsumed: true,
    databaseOwnedTimestamps: true,
    optimisticConcurrency: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    atomicAuditOutbox: true,
    settingsPauseWriterParity: true,
    guardrailSettingsWriterParity: true,
    spendPolicyWriterParity: true,
    qualificationSettingsWriterParity: false,
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

export function signalConstraintConfigApplyFunctionSource(
  manifest = buildPostgresSignalConstraintConfigApplyManifest()
): string {
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  lock_mask_value TEXT;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  event_type_value TEXT;
  reason_code_value TEXT;
  message_value TEXT;
  aggregate_type_value TEXT;
  expected_updated_at_value TEXT;
  paused_value BOOLEAN;
  pause_reason_value TEXT;
  execution_mode_value TEXT;
  dedupe_window_seconds_value BIGINT;
  affiliate_mode_value TEXT;
  tax_bps_value BIGINT;
  target_allowance_value BIGINT;
  walmart_allowance_value BIGINT;
  amazon_allowance_value BIGINT;
  bestbuy_allowance_value BIGINT;
  allowances_json_value TEXT;
  expected_revision_value BIGINT;
  per_order_cap_value BIGINT;
  daily_cap_value BIGINT;
  monthly_cap_value BIGINT;
  updated_timestamp TEXT;
  settings_record RECORD;
  spend_record RECORD;
  replay_record RECORD;
  configuration_result JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
  mutation_statement_count_value BIGINT := 0;
  mutation_row_count_value BIGINT := 0;
  settings_mutated_value BOOLEAN := FALSE;
  spend_policy_mutated_value BOOLEAN := FALSE;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name NOT IN (
      'set_actions_paused', 'update_guardrail_settings', 'update_spend_policy'
    )
    OR request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal constraint-configuration request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal constraint-configuration payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal constraint-configuration payload shape is invalid';
  END IF;

  IF operation_name = 'set_actions_paused' THEN
    IF request_payload - ARRAY['expectedUpdatedAt', 'paused', 'reason']::text[]
        IS DISTINCT FROM '{}'::jsonb
      OR pg_catalog.jsonb_typeof(request_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string'
      OR request_payload->>'expectedUpdatedAt' !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
      OR pg_catalog.jsonb_typeof(request_payload->'paused') IS DISTINCT FROM 'boolean'
      OR pg_catalog.jsonb_typeof(request_payload->'reason') IS DISTINCT FROM 'string'
      OR pg_catalog.octet_length(request_payload->>'reason') > 240 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action-pause payload is invalid';
    END IF;
    expected_updated_at_value := request_payload->>'expectedUpdatedAt';
    paused_value := (request_payload->>'paused')::boolean;
    pause_reason_value := request_payload->>'reason';
    lock_mask_value := '00100';
    event_type_value := 'actions_pause_changed';
    reason_code_value := CASE WHEN paused_value THEN 'actions_paused' ELSE 'actions_resumed' END;
    message_value := CASE WHEN paused_value
      THEN 'Retailer actions were globally paused.'
      ELSE 'Qualified retailer actions were globally resumed.' END;
    aggregate_type_value := 'user_settings';
  ELSIF operation_name = 'update_guardrail_settings' THEN
    IF request_payload - ARRAY[
        'expectedUpdatedAt', 'dedupeWindowSeconds', 'affiliateMode', 'taxBps',
        'storeAllowancesCents'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
      OR pg_catalog.jsonb_typeof(request_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string'
      OR request_payload->>'expectedUpdatedAt' !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
      OR pg_catalog.jsonb_typeof(request_payload->'dedupeWindowSeconds') IS DISTINCT FROM 'number'
      OR request_payload->>'dedupeWindowSeconds' !~ '^[0-9]{1,4}$'
      OR (request_payload->>'dedupeWindowSeconds')::bigint NOT BETWEEN 30 AND 3600
      OR pg_catalog.jsonb_typeof(request_payload->'affiliateMode') IS DISTINCT FROM 'string'
      OR request_payload->>'affiliateMode' NOT IN ('prefer_fallback', 'require', 'disabled')
      OR pg_catalog.jsonb_typeof(request_payload->'taxBps') IS DISTINCT FROM 'number'
      OR request_payload->>'taxBps' !~ '^[0-9]{1,5}$'
      OR (request_payload->>'taxBps')::bigint NOT BETWEEN 0 AND 10000
      OR pg_catalog.jsonb_typeof(request_payload->'storeAllowancesCents') IS DISTINCT FROM 'object'
      OR NOT ((request_payload->'storeAllowancesCents') ?& ARRAY['target', 'walmart', 'amazon', 'bestbuy'])
      OR (request_payload->'storeAllowancesCents') - ARRAY[
        'target', 'walmart', 'amazon', 'bestbuy', 'pokemoncenter', 'aninebing', 'americaneagle', 'asus', 'athleta', 'audioadvice', 'bananarepublic', 'bananarepublicfactory'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_each(request_payload->'storeAllowancesCents') AS allowance(key, value)
        WHERE pg_catalog.jsonb_typeof(allowance.value) IS DISTINCT FROM 'number'
          OR allowance.value #>> '{}' !~ '^(0|[1-9][0-9]{0,8})$'
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal guardrail-settings payload is invalid';
    END IF;
    expected_updated_at_value := request_payload->>'expectedUpdatedAt';
    dedupe_window_seconds_value := (request_payload->>'dedupeWindowSeconds')::bigint;
    affiliate_mode_value := request_payload->>'affiliateMode';
    tax_bps_value := (request_payload->>'taxBps')::bigint;
    target_allowance_value := (request_payload->'storeAllowancesCents'->>'target')::bigint;
    walmart_allowance_value := (request_payload->'storeAllowancesCents'->>'walmart')::bigint;
    amazon_allowance_value := (request_payload->'storeAllowancesCents'->>'amazon')::bigint;
    bestbuy_allowance_value := (request_payload->'storeAllowancesCents'->>'bestbuy')::bigint;
    allowances_json_value := '{"target":' || target_allowance_value::text ||
      ',"walmart":' || walmart_allowance_value::text ||
      ',"amazon":' || amazon_allowance_value::text ||
      ',"bestbuy":' || bestbuy_allowance_value::text ||
      CASE WHEN request_payload->'storeAllowancesCents' ? 'pokemoncenter'
        THEN ',"pokemoncenter":' || (request_payload->'storeAllowancesCents'->>'pokemoncenter')::bigint::text
        ELSE '' END ||
      CASE WHEN request_payload->'storeAllowancesCents' ? 'asus'
        THEN ',"asus":' || (request_payload->'storeAllowancesCents'->>'asus')::bigint::text
        ELSE '' END ||
      CASE WHEN request_payload->'storeAllowancesCents' ? 'audioadvice'
        THEN ',"audioadvice":' || (request_payload->'storeAllowancesCents'->>'audioadvice')::bigint::text
        ELSE '' END ||
      CASE WHEN request_payload->'storeAllowancesCents' ? 'bananarepublic'
        THEN ',"bananarepublic":' || (request_payload->'storeAllowancesCents'->>'bananarepublic')::bigint::text
        ELSE '' END ||
      CASE WHEN request_payload->'storeAllowancesCents' ? 'bananarepublicfactory'
        THEN ',"bananarepublicfactory":' || (request_payload->'storeAllowancesCents'->>'bananarepublicfactory')::bigint::text
        ELSE '' END ||
      CASE WHEN request_payload->'storeAllowancesCents' ? 'athleta'
        THEN ',"athleta":' || (request_payload->'storeAllowancesCents'->>'athleta')::bigint::text
        ELSE '' END ||
      CASE WHEN request_payload->'storeAllowancesCents' ? 'americaneagle'
        THEN ',"americaneagle":' || (request_payload->'storeAllowancesCents'->>'americaneagle')::bigint::text
        ELSE '' END ||
      CASE WHEN request_payload->'storeAllowancesCents' ? 'aninebing'
        THEN ',"aninebing":' || (request_payload->'storeAllowancesCents'->>'aninebing')::bigint::text
        ELSE '' END || '}';
    lock_mask_value := '00100';
    event_type_value := 'guardrail_settings_updated';
    reason_code_value := 'saved';
    message_value := 'Signal deduplication, affiliate fallback, tax reserve, and store allowances were updated.';
    aggregate_type_value := 'user_settings';
  ELSE
    IF request_payload - ARRAY[
        'expectedRevision', 'perOrderCapCents', 'dailyCapCents', 'monthlyCapCents'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 4
      OR pg_catalog.jsonb_typeof(request_payload->'expectedRevision') IS DISTINCT FROM 'number'
      OR request_payload->>'expectedRevision' !~ '^[1-9][0-9]{0,8}$'
      OR EXISTS (
        SELECT 1 FROM (VALUES
          (request_payload->'perOrderCapCents'),
          (request_payload->'dailyCapCents'),
          (request_payload->'monthlyCapCents')
        ) AS cap(value)
        WHERE pg_catalog.jsonb_typeof(cap.value) NOT IN ('number', 'null')
          OR (pg_catalog.jsonb_typeof(cap.value) = 'number'
            AND cap.value #>> '{}' !~ '^[1-9][0-9]{0,9}$')
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal spend-policy payload is invalid';
    END IF;
    expected_revision_value := (request_payload->>'expectedRevision')::bigint;
    per_order_cap_value := CASE WHEN pg_catalog.jsonb_typeof(request_payload->'perOrderCapCents') = 'null'
      THEN NULL ELSE (request_payload->>'perOrderCapCents')::bigint END;
    daily_cap_value := CASE WHEN pg_catalog.jsonb_typeof(request_payload->'dailyCapCents') = 'null'
      THEN NULL ELSE (request_payload->>'dailyCapCents')::bigint END;
    monthly_cap_value := CASE WHEN pg_catalog.jsonb_typeof(request_payload->'monthlyCapCents') = 'null'
      THEN NULL ELSE (request_payload->>'monthlyCapCents')::bigint END;
    IF (per_order_cap_value IS NOT NULL AND per_order_cap_value > 1000000000)
      OR (daily_cap_value IS NOT NULL AND daily_cap_value > 1000000000)
      OR (monthly_cap_value IS NOT NULL AND monthly_cap_value > 1000000000)
      OR (per_order_cap_value IS NOT NULL AND daily_cap_value IS NOT NULL
        AND per_order_cap_value > daily_cap_value)
      OR (daily_cap_value IS NOT NULL AND monthly_cap_value IS NOT NULL
        AND daily_cap_value > monthly_cap_value) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal spend-policy caps are invalid';
    END IF;
    lock_mask_value := '00001';
    event_type_value := 'spend_policy_revised';
    reason_code_value := 'user_preferences';
    message_value := 'Periodic spending limits were revised.';
    aggregate_type_value := 'spend_policy';
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

  SELECT MIN(lock_result.result_json)::jsonb, COUNT(*)
    INTO writer_lock_result, writer_lock_result_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION)}(
    expected_tenant_id, expected_user_id, '', '', '', lock_mask_value
  ) AS lock_result;
  IF writer_lock_result_count <> 1 OR writer_lock_result IS NULL
    OR writer_lock_result->>'contractVersion' <> '1'
    OR writer_lock_result->>'lockProtocolVersion' <> 'signal_action_constraints_v1'
    OR writer_lock_result->>'lockMask' <> lock_mask_value
    OR writer_lock_result->>'scopeCount' <> '1'
    OR writer_lock_result->>'sourceConnectionId' <> ''
    OR writer_lock_result->>'retailerId' <> ''
    OR writer_lock_result->>'missionId' <> ''
    OR writer_lock_result->>'mutationApplied' <> 'false'
    OR writer_lock_result->>'mutationAuthority' <> 'false'
    OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal constraint-configuration shared writer-lock protocol failed';
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    request_payload::text, 'UTF8'
  )), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_constraint_config_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_constraint_config_outbox_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit
  WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
  WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal constraint-configuration request graph is partial';
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
      OR replay_record.correlation_id <> resolved_user_id
      OR replay_record.event_type <> event_type_value
      OR replay_record.reason_code <> reason_code_value
      OR replay_record.message <> message_value
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR pg_catalog.jsonb_typeof(replay_record.audit_data->'result') IS DISTINCT FROM 'object'
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> aggregate_type_value
      OR replay_record.aggregate_id <> resolved_user_id
      OR replay_record.outbox_event_type <> event_type_value
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> resolved_user_id
      OR replay_record.outbox_payload->>'reasonCode' <> reason_code_value
      OR replay_record.outbox_payload->>'message' <> message_value
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal constraint-configuration replay graph changed';
    END IF;
    configuration_result := replay_record.audit_data->'result';
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
      'settingsMutated', FALSE,
      'spendPolicyMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE,
      'configuration', configuration_result,
      'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE,
      'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE,
      'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  IF operation_name IN ('set_actions_paused', 'update_guardrail_settings') THEN
    SELECT settings.actions_paused, settings.pause_reason, settings.execution_mode,
           settings.dedupe_window_seconds, settings.affiliate_mode, settings.tax_bps,
           settings.store_allowances_json, settings.updated_at
      INTO STRICT settings_record
    FROM ${relation(manifest.schemaName, "app_settings")} AS settings
    JOIN ${relation(manifest.schemaName, "users")} AS account ON account.id = settings.user_id
    WHERE settings.user_id = resolved_user_id AND account.tenant_id = resolved_tenant_id
    FOR UPDATE OF settings;
    IF settings_record.updated_at <> expected_updated_at_value THEN
      RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal constraint-configuration settings revision changed';
    END IF;
    updated_timestamp := pg_catalog.to_char(
      GREATEST(
        pg_catalog.statement_timestamp(),
        settings_record.updated_at::timestamptz + INTERVAL '1 millisecond'
      ) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    IF operation_name = 'set_actions_paused' THEN
      UPDATE ${relation(manifest.schemaName, "app_settings")}
      SET actions_paused = CASE WHEN paused_value THEN 1 ELSE 0 END,
          pause_reason = pause_reason_value,
          updated_at = updated_timestamp
      WHERE user_id = resolved_user_id;
    ELSE
      UPDATE ${relation(manifest.schemaName, "app_settings")}
      SET dedupe_window_seconds = dedupe_window_seconds_value,
          affiliate_mode = affiliate_mode_value,
          tax_bps = tax_bps_value,
          store_allowances_json = allowances_json_value,
          updated_at = updated_timestamp
      WHERE user_id = resolved_user_id;
    END IF;
    GET DIAGNOSTICS mutation_row_count_value = ROW_COUNT;
    IF mutation_row_count_value <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal constraint-configuration settings update was ambiguous';
    END IF;
    mutation_statement_count_value := 1;
    settings_mutated_value := TRUE;
    SELECT settings.actions_paused, settings.pause_reason, settings.execution_mode,
           settings.dedupe_window_seconds, settings.affiliate_mode, settings.tax_bps,
           settings.store_allowances_json, settings.updated_at
      INTO STRICT settings_record
    FROM ${relation(manifest.schemaName, "app_settings")} AS settings
    WHERE settings.user_id = resolved_user_id;
    configuration_result := pg_catalog.jsonb_build_object(
      'actionsPaused', settings_record.actions_paused = 1,
      'pauseReason', settings_record.pause_reason,
      'executionMode', settings_record.execution_mode,
      'dedupeWindowSeconds', settings_record.dedupe_window_seconds,
      'affiliateMode', settings_record.affiliate_mode,
      'taxBps', settings_record.tax_bps,
      'storeAllowancesCents', settings_record.store_allowances_json::jsonb,
      'updatedAt', settings_record.updated_at
    );
  ELSE
    SELECT policy.revision, policy.currency, policy.per_order_cap_cents,
           policy.daily_cap_cents, policy.monthly_cap_cents,
           policy.order_submission_enabled, policy.created_at, policy.updated_at
      INTO STRICT spend_record
    FROM ${relation(manifest.schemaName, "user_spend_policies")} AS policy
    JOIN ${relation(manifest.schemaName, "users")} AS account ON account.id = policy.user_id
    WHERE policy.user_id = resolved_user_id AND policy.tenant_id = resolved_tenant_id
      AND account.tenant_id = resolved_tenant_id
    FOR UPDATE OF policy;
    IF spend_record.revision <> expected_revision_value THEN
      RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal constraint-configuration spend-policy revision changed';
    END IF;
    IF spend_record.per_order_cap_cents IS NOT DISTINCT FROM per_order_cap_value
      AND spend_record.daily_cap_cents IS NOT DISTINCT FROM daily_cap_value
      AND spend_record.monthly_cap_cents IS NOT DISTINCT FROM monthly_cap_value THEN
      configuration_result := pg_catalog.jsonb_build_object(
        'revision', spend_record.revision,
        'currency', spend_record.currency,
        'perOrderCapCents', spend_record.per_order_cap_cents,
        'dailyCapCents', spend_record.daily_cap_cents,
        'monthlyCapCents', spend_record.monthly_cap_cents,
        'orderSubmissionEnabled', spend_record.order_submission_enabled = 1,
        'createdAt', spend_record.created_at,
        'updatedAt', spend_record.updated_at
      );
      RETURN QUERY SELECT pg_catalog.jsonb_build_object(
        'contractVersion', 1,
        'operation', operation_name,
        'requestId', request_id,
        'requestFingerprint', request_fingerprint_value,
        'outcome', 'unchanged',
        'mutationApplied', FALSE,
        'idempotentReplay', FALSE,
        'mutationStatementCount', 0,
        'mutationRowCount', 0,
        'settingsMutated', FALSE,
        'spendPolicyMutated', FALSE,
        'auditMutated', FALSE,
        'outboxMutated', FALSE,
        'configuration', configuration_result,
        'configurationWriterParity', FALSE,
        'reservationWriterParity', FALSE,
        'writerLockProtocolParity', FALSE,
        'mutationAuthority', TRUE,
        'runtimeAuthority', FALSE
      )::text;
      RETURN;
    END IF;
    updated_timestamp := pg_catalog.to_char(
      GREATEST(
        pg_catalog.statement_timestamp(),
        spend_record.updated_at::timestamptz + INTERVAL '1 millisecond'
      ) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    UPDATE ${relation(manifest.schemaName, "user_spend_policies")}
    SET revision = revision + 1,
        per_order_cap_cents = per_order_cap_value,
        daily_cap_cents = daily_cap_value,
        monthly_cap_cents = monthly_cap_value,
        updated_at = updated_timestamp
    WHERE user_id = resolved_user_id AND tenant_id = resolved_tenant_id
      AND revision = expected_revision_value;
    GET DIAGNOSTICS mutation_row_count_value = ROW_COUNT;
    IF mutation_row_count_value <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal constraint-configuration spend-policy update was ambiguous';
    END IF;
    mutation_statement_count_value := 1;
    spend_policy_mutated_value := TRUE;
    SELECT policy.revision, policy.currency, policy.per_order_cap_cents,
           policy.daily_cap_cents, policy.monthly_cap_cents,
           policy.order_submission_enabled, policy.created_at, policy.updated_at
      INTO STRICT spend_record
    FROM ${relation(manifest.schemaName, "user_spend_policies")} AS policy
    WHERE policy.user_id = resolved_user_id AND policy.tenant_id = resolved_tenant_id;
    configuration_result := pg_catalog.jsonb_build_object(
      'revision', spend_record.revision,
      'currency', spend_record.currency,
      'perOrderCapCents', spend_record.per_order_cap_cents,
      'dailyCapCents', spend_record.daily_cap_cents,
      'monthlyCapCents', spend_record.monthly_cap_cents,
      'orderSubmissionEnabled', spend_record.order_submission_enabled = 1,
      'createdAt', spend_record.created_at,
      'updatedAt', spend_record.updated_at
    );
  END IF;

  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'result', configuration_result
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value,
    'correlationId', resolved_user_id,
    'reasonCode', reason_code_value,
    'message', message_value,
    'data', audit_data_value
  );
  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, resolved_user_id,
    event_type_value, reason_code_value, message_value, audit_data_value::text,
    updated_timestamp
  );
  mutation_statement_count_value := mutation_statement_count_value + 1;
  mutation_row_count_value := mutation_row_count_value + 1;
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, aggregate_type_value, resolved_user_id,
    event_type_value, outbox_payload_value::text, updated_timestamp, ''
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
    'settingsMutated', settings_mutated_value,
    'spendPolicyMutated', spend_policy_mutated_value,
    'auditMutated', TRUE,
    'outboxMutated', TRUE,
    'configuration', configuration_result,
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
  manifest: PostgresSignalConstraintConfigApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_constraint_config_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.constraintConfigRole.name,
    functionName: POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalConstraintConfigApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_constraint_config_apply_receipt",
    receiptTriggerName: "yoink_signal_constraint_config_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.writerLockProtocolManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      writerLockProtocolContractVersion: 1,
      operationCount: 3,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      settingsPauseWriterParity: true,
      guardrailSettingsWriterParity: true,
      spendPolicyWriterParity: true,
      qualificationSettingsWriterParity: false,
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

export function postgresSignalConstraintConfigCapabilityProjection():
PostgresSignalConstraintConfigCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalConstraintConfigApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
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
    settingsScopeConsumed: true,
    spendScopeConsumed: true,
    databaseOwnedTimestamps: true,
    optimisticConcurrency: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    atomicAuditOutbox: true,
    settingsPauseWriterParity: true,
    guardrailSettingsWriterParity: true,
    spendPolicyWriterParity: true,
    qualificationSettingsWriterParity: false,
    sourceWriterParity: false,
    retailerQualificationWriterParity: false,
    missionPolicyWriterParity: false,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    operationCount: 3,
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
    mutationTableCount: 4,
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

export type PostgresSignalConstraintConfigApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalConstraintConfigApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalConstraintConfigApplyManifest()
): Promise<PostgresSignalConstraintConfigApplyQualificationReceipt> {
  await verifyPostgresSignalWriterLockProtocolBoundary(database, manifest.predecessorManifest);
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalConstraintConfigApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalConstraintConfigApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalConstraintConfigApplyQualificationReceipt> {
  await verifyPostgresSignalWriterLockProtocolBoundary(database, manifest.predecessorManifest);
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalConstraintConfigApplyQualificationError(
      `The PostgreSQL signal constraint-configuration ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalConstraintConfigOperation,
  requestId: string
): PostgresSignalConstraintConfigApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalConstraintConfigApplyQualificationError(
      "The PostgreSQL signal constraint-configuration result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const configuration = result.configuration;
  if (result.contractVersion !== 1 || result.operation !== operation
    || result.requestId !== requestId || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "unchanged", "already_applied"]).has(String(result.outcome))
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || !Number.isSafeInteger(result.mutationStatementCount)
    || !Number.isSafeInteger(result.mutationRowCount)
    || typeof result.settingsMutated !== "boolean"
    || typeof result.spendPolicyMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || !configuration || typeof configuration !== "object" || Array.isArray(configuration)
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== false
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true || result.runtimeAuthority !== false) {
    throw new PostgresSignalConstraintConfigApplyQualificationError(
      "The PostgreSQL signal constraint-configuration result contract changed."
    );
  }
  return result as unknown as PostgresSignalConstraintConfigApplyResult;
}

export class NodePostgresSignalConstraintConfigApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalConstraintConfigApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalConstraintConfigApplyManifest(),
    options: NodePostgresSignalConstraintConfigApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalConstraintConfigApplyQualificationError(
        "The PostgreSQL signal constraint-configuration connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_constraint_config_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_constraint_config_qualification");
  }

  async applyConstraintConfiguration(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalConstraintConfigOperation,
    requestIdValue: string,
    requestPayload: Record<string, unknown>
  ): Promise<PostgresSignalConstraintConfigApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalConstraintConfigOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (!new Set<PostgresSignalConstraintConfigOperation>([
      "set_actions_paused", "update_guardrail_settings", "update_spend_policy"
    ]).has(operation) || !REQUEST_ID.test(requestId)
      || !payloadJson || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalConstraintConfigApplyQualificationError(
        "The PostgreSQL signal constraint-configuration apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.constraintConfigRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION)}(
           $1, $2, $3, $4, $5
         )`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalConstraintConfigApplyQualificationError(
          "The PostgreSQL signal constraint-configuration function returned an ambiguous result."
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
