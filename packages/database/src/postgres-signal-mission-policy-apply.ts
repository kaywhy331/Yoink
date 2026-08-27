import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase
} from "./postgres-cutover.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import {
  POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_CONTRACT_VERSION,
  buildPostgresSignalRetailerQualificationApplyManifest,
  verifyPostgresSignalRetailerQualificationApplyBoundary,
  type PostgresSignalRetailerQualificationApplyManifest
} from "./postgres-signal-retailer-qualification-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_MISSION_POLICY_APPLY_RECEIPT_TABLE =
  "yoink_signal_mission_policy_apply_receipt";
export const POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION =
  "yoink_apply_signal_mission_policy";
export const POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONFIRMATION =
  "REVISE_MISSION_POLICY_V1";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 4_096;
const MAXIMUM_MISSION_TARGETS = 10_000;
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
  "mission_intent_revisions",
  "mission_targets",
  "missions",
  "outbox_events"
] as const);
const MUTATION_TABLES = Object.freeze([
  "audit_events",
  "mission_intent_revisions",
  "outbox_events"
] as const);
const PROTECTED_SHARED_CATALOG_TABLES = Object.freeze(["listings"] as const);

export type PostgresSignalMissionPolicyOperation = "revise_mission_policy";

export interface PostgresSignalMissionPolicyApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  retailerQualificationApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  missionPolicyRoleNamespace: string;
  retailerQualificationApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalRetailerQualificationApplyManifest;
  missionPolicyRole: {
    kind: "signal_mission_policy_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    protectedSharedCatalogTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  protectedTenantTableCount: 6;
  forcedRlsTableCount: 6;
  mutationTableCount: 3;
  protectedSharedCatalogTableCount: 1;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumMissionTargets: 10_000;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  settingsScopeConsumed: true;
  missionPolicyScopeConsumed: true;
  databaseOwnedTimestamps: true;
  optimisticConcurrency: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  zeroWriteUnchangedPolicy: true;
  appendOnlyPolicyRevision: true;
  atomicPolicyAuditOutbox: true;
  currentMissionOwnershipRevalidation: true;
  currentTargetSnapshotRevalidation: true;
  currentSettingsRevalidation: true;
  policyHashV2Parity: true;
  directPurchaseSafetyParity: true;
  sourceTrustWriterParity: true;
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

export interface PostgresSignalMissionPolicyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  retailerQualificationApplyContractVersion: 1;
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
  missionPolicyScopeConsumed: true;
  databaseOwnedTimestamps: true;
  optimisticConcurrency: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  zeroWriteUnchangedPolicy: true;
  appendOnlyPolicyRevision: true;
  atomicPolicyAuditOutbox: true;
  currentMissionOwnershipRevalidation: true;
  currentTargetSnapshotRevalidation: true;
  currentSettingsRevalidation: true;
  policyHashV2Parity: true;
  directPurchaseSafetyParity: true;
  sourceTrustWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  operationCount: 1;
  protectedTenantTableCount: 6;
  forcedRlsTableCount: 6;
  mutationTableCount: 3;
  protectedSharedCatalogTableCount: 1;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumMissionTargets: 10_000;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: false;
  actionAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalMissionPolicyApplyResult {
  contractVersion: 1;
  operation: "revise_mission_policy";
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "unchanged" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  policyMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  policy: Record<string, unknown>;
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

export interface NodePostgresSignalMissionPolicyApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalMissionPolicyCapabilityProjection> | null = null;

export class PostgresSignalMissionPolicyApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalMissionPolicyApplyQualificationError";
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
    throw new PostgresSignalMissionPolicyApplyQualificationError(
      "The PostgreSQL mission-policy schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalMissionPolicyApplyQualificationError(
      "The PostgreSQL mission-policy role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_mission_policy`;
  if (value.length > 63) {
    throw new PostgresSignalMissionPolicyApplyQualificationError(
      "The PostgreSQL mission-policy role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function stableHashInputSql(parts: string[]): string {
  return parts.map((part) =>
    `pg_catalog.octet_length(${part})::text || ':' || ${part} || '|'`
  ).join(" || ");
}

function predecessorNamespaces(manifest: PostgresSignalRetailerQualificationApplyManifest): string[] {
  const namespaces = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.endsWith("RoleNamespace") && typeof child === "string") {
        namespaces.add(child);
      } else if (key === "predecessorManifest") {
        visit(child);
      }
    }
  };
  visit(manifest);
  return [...namespaces];
}

export function buildPostgresSignalMissionPolicyApplyManifest(
  predecessorManifest = buildPostgresSignalRetailerQualificationApplyManifest(),
  requestedRoleNamespace = "yoink_mission_policy_qual"
): PostgresSignalMissionPolicyApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const missionPolicyRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (predecessorNamespaces(predecessorManifest).includes(missionPolicyRoleNamespace)) {
    throw new PostgresSignalMissionPolicyApplyQualificationError(
      "The PostgreSQL mission-policy role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalMissionPolicyApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    retailerQualificationApplyContractVersion:
      POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    missionPolicyRoleNamespace,
    retailerQualificationApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    missionPolicyRole: {
      kind: "signal_mission_policy_apply_boundary",
      name: roleName(missionPolicyRoleNamespace),
      functionName: POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      protectedSharedCatalogTableNames: [...PROTECTED_SHARED_CATALOG_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    protectedTenantTableCount: 6,
    forcedRlsTableCount: 6,
    mutationTableCount: 3,
    protectedSharedCatalogTableCount: 1,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumMissionTargets: MAXIMUM_MISSION_TARGETS,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    settingsScopeConsumed: true,
    missionPolicyScopeConsumed: true,
    databaseOwnedTimestamps: true,
    optimisticConcurrency: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    zeroWriteUnchangedPolicy: true,
    appendOnlyPolicyRevision: true,
    atomicPolicyAuditOutbox: true,
    currentMissionOwnershipRevalidation: true,
    currentTargetSnapshotRevalidation: true,
    currentSettingsRevalidation: true,
    policyHashV2Parity: true,
    directPurchaseSafetyParity: true,
    sourceTrustWriterParity: true,
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

export function signalMissionPolicyApplyFunctionSource(
  manifest = buildPostgresSignalMissionPolicyApplyManifest()
): string {
  const policyHashParts = stableHashInputSql([
    "'intent-policy-v2'::text",
    "mission_id_value",
    "mission_record.target_quantity::text",
    "'USD'::text",
    "COALESCE(max_all_in_cents_value::text, '')",
    "action_ceiling_value",
    "decision_mode_value",
    "max_signal_age_seconds_value::text",
    "substitution_policy_value",
    "expires_at_value",
    "cooldown_seconds_value::text",
    "target_policy_json_value"
  ]);
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  mission_id_value TEXT;
  expected_revision_value BIGINT;
  expected_policy_hash_value TEXT;
  max_all_in_cents_value BIGINT;
  action_ceiling_value TEXT;
  decision_mode_value TEXT;
  max_signal_age_seconds_value BIGINT;
  substitution_policy_value TEXT;
  expires_at_value TEXT;
  cooldown_seconds_value BIGINT;
  change_reason_value TEXT;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  mission_record RECORD;
  current_policy_record RECORD;
  settings_record RECORD;
  settings_allowances JSONB;
  target_count BIGINT;
  invalid_target_count BIGINT;
  enabled_target_count BIGINT;
  unsafe_direct_target_count BIGINT;
  required_all_in_cents BIGINT;
  target_policy_json_value TEXT;
  policy_hash_value TEXT;
  next_revision_value BIGINT;
  created_timestamp TEXT;
  revision_id_value TEXT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  stored_policy_result JSONB;
  policy_result JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
  affected_rows BIGINT;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'revise_mission_policy'
    OR request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'signal mission-policy request is invalid';
  END IF;

  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'signal mission-policy payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY[
      'missionId', 'expectedRevision', 'expectedPolicyHash',
      'maxAllInCents', 'actionCeiling', 'decisionMode',
      'maxSignalAgeSeconds', 'substitutionPolicy', 'expiresAt',
      'cooldownSeconds', 'changeReason', 'confirmation'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 12
    OR pg_catalog.jsonb_typeof(request_payload->'missionId') IS DISTINCT FROM 'string'
    OR request_payload->>'missionId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'expectedRevision') IS DISTINCT FROM 'number'
    OR request_payload->>'expectedRevision' !~ '^[1-9][0-9]{0,8}$'
    OR pg_catalog.jsonb_typeof(request_payload->'expectedPolicyHash') IS DISTINCT FROM 'string'
    OR request_payload->>'expectedPolicyHash' !~ '^[a-f0-9]{64}$'
    OR pg_catalog.jsonb_typeof(request_payload->'maxAllInCents') NOT IN ('null', 'number')
    OR (pg_catalog.jsonb_typeof(request_payload->'maxAllInCents') = 'number'
      AND request_payload->>'maxAllInCents' !~ '^[1-9][0-9]{0,8}$')
    OR pg_catalog.jsonb_typeof(request_payload->'actionCeiling') IS DISTINCT FROM 'string'
    OR request_payload->>'actionCeiling' NOT IN (
      'notify', 'add_to_cart', 'prepare_checkout', 'submit_order'
    )
    OR pg_catalog.jsonb_typeof(request_payload->'decisionMode') IS DISTINCT FROM 'string'
    OR request_payload->>'decisionMode' NOT IN ('strategy', 'purchase_intent')
    OR pg_catalog.jsonb_typeof(request_payload->'maxSignalAgeSeconds') IS DISTINCT FROM 'number'
    OR request_payload->>'maxSignalAgeSeconds' !~ '^[1-9][0-9]{1,3}$'
    OR pg_catalog.jsonb_typeof(request_payload->'substitutionPolicy') IS DISTINCT FROM 'string'
    OR request_payload->>'substitutionPolicy' NOT IN ('exact_only', 'verified_equivalent')
    OR pg_catalog.jsonb_typeof(request_payload->'expiresAt') IS DISTINCT FROM 'string'
    OR pg_catalog.octet_length(request_payload->>'expiresAt') > 40
    OR pg_catalog.jsonb_typeof(request_payload->'cooldownSeconds') IS DISTINCT FROM 'number'
    OR request_payload->>'cooldownSeconds' !~ '^(0|[1-9][0-9]{0,7})$'
    OR pg_catalog.jsonb_typeof(request_payload->'changeReason') IS DISTINCT FROM 'string'
    OR pg_catalog.octet_length(request_payload->>'changeReason') > 300
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'signal mission-policy payload shape is invalid';
  END IF;

  mission_id_value := request_payload->>'missionId';
  expected_revision_value := (request_payload->>'expectedRevision')::bigint;
  expected_policy_hash_value := request_payload->>'expectedPolicyHash';
  IF pg_catalog.jsonb_typeof(request_payload->'maxAllInCents') = 'null' THEN
    max_all_in_cents_value := NULL;
  ELSE
    max_all_in_cents_value := (request_payload->>'maxAllInCents')::bigint;
    IF max_all_in_cents_value > 100000000 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'signal mission-policy all-in cap is invalid';
    END IF;
  END IF;
  action_ceiling_value := request_payload->>'actionCeiling';
  decision_mode_value := request_payload->>'decisionMode';
  max_signal_age_seconds_value := (request_payload->>'maxSignalAgeSeconds')::bigint;
  substitution_policy_value := request_payload->>'substitutionPolicy';
  expires_at_value := request_payload->>'expiresAt';
  cooldown_seconds_value := (request_payload->>'cooldownSeconds')::bigint;
  change_reason_value := request_payload->>'changeReason';
  IF max_signal_age_seconds_value NOT BETWEEN 10 AND 3600
    OR cooldown_seconds_value NOT BETWEEN 0 AND 2592000
    OR (decision_mode_value = 'purchase_intent'
      AND action_ceiling_value NOT IN ('notify', 'add_to_cart')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'signal mission-policy bounds are invalid';
  END IF;
  IF expires_at_value <> '' THEN
    IF expires_at_value !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'signal mission-policy expiry is invalid';
    END IF;
    BEGIN
      IF expires_at_value::timestamptz <= pg_catalog.statement_timestamp()
        OR expires_at_value::timestamptz >
          pg_catalog.statement_timestamp() + INTERVAL '366 days' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'signal mission-policy expiry is outside the allowed window';
      END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'signal mission-policy expiry is invalid';
    END;
  END IF;

  SELECT MIN(principal.tenant_id), MIN(principal.user_id), COUNT(*)
    INTO resolved_tenant_id, resolved_user_id, resolved_principal_count
  FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)} AS principal
  WHERE principal.principal_role = session_user::text AND principal.active = TRUE;
  IF resolved_principal_count <> 1 OR resolved_tenant_id IS NULL
    OR resolved_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'tenant session principal is not active';
  END IF;
  IF resolved_tenant_id <> expected_tenant_id OR resolved_user_id <> expected_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'tenant session principal does not match the expected authenticated principal';
  END IF;

  SELECT MIN(lock_result.result_json)::jsonb, COUNT(*)
    INTO writer_lock_result, writer_lock_result_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION)}(
    expected_tenant_id, expected_user_id, '', '', mission_id_value, '00110'
  ) AS lock_result;
  IF writer_lock_result_count <> 1 OR writer_lock_result IS NULL
    OR writer_lock_result->>'contractVersion' <> '1'
    OR writer_lock_result->>'lockProtocolVersion' <> 'signal_action_constraints_v1'
    OR writer_lock_result->>'lockMask' <> '00110'
    OR writer_lock_result->>'scopeCount' <> '2'
    OR writer_lock_result->>'sourceConnectionId' <> ''
    OR writer_lock_result->>'retailerId' <> ''
    OR writer_lock_result->>'missionId' <> mission_id_value
    OR writer_lock_result->>'mutationApplied' <> 'false'
    OR writer_lock_result->>'mutationAuthority' <> 'false'
    OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'signal mission-policy shared writer-lock protocol failed';
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(request_payload::text, 'UTF8')
  ), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_mission_policy_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_mission_policy_outbox_v1|' || audit_id_value, 'UTF8'
    )
  ), 'hex'), 1, 32);
  revision_id_value := 'intent_revision_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      'postgres_signal_mission_policy_revision_v1|' || audit_id_value, 'UTF8'
    )), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit
  WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
  WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'signal mission-policy request graph is partial';
  END IF;
  IF audit_count = 1 THEN
    SELECT audit.tenant_id, audit.user_id, audit.correlation_id,
           audit.event_type, audit.reason_code, audit.message,
           audit.data_json::jsonb AS audit_data,
           audit.created_at AS audit_created_at,
           outbox.tenant_id AS outbox_tenant_id,
           outbox.aggregate_type, outbox.aggregate_id,
           outbox.event_type AS outbox_event_type,
           outbox.payload_json::jsonb AS outbox_payload,
           outbox.created_at AS outbox_created_at
      INTO STRICT replay_record
    FROM ${relation(manifest.schemaName, "audit_events")} AS audit
    JOIN ${relation(manifest.schemaName, "outbox_events")} AS outbox
      ON outbox.id = outbox_id_value
    WHERE audit.id = audit_id_value;
    IF replay_record.tenant_id <> resolved_tenant_id
      OR replay_record.user_id <> resolved_user_id
      OR replay_record.correlation_id <> mission_id_value
      OR replay_record.event_type <> 'purchase_intent_policy_revised'
      OR replay_record.reason_code <> 'preferences_updated'
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR pg_catalog.jsonb_typeof(replay_record.audit_data->'result') IS DISTINCT FROM 'object'
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'purchase_intent'
      OR replay_record.aggregate_id <> mission_id_value
      OR replay_record.outbox_event_type <> 'purchase_intent_policy_revised'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> mission_id_value
      OR replay_record.outbox_payload->>'reasonCode' <> 'preferences_updated'
      OR replay_record.outbox_payload->>'message' <> replay_record.message
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = '40001',
        MESSAGE = 'signal mission-policy replay graph changed';
    END IF;
    policy_result := replay_record.audit_data->'result';
    SELECT pg_catalog.jsonb_build_object(
      'id', policy.id,
      'missionId', policy.mission_id,
      'revision', policy.revision,
      'quantity', policy.quantity,
      'currency', policy.currency,
      'maxAllInCents', policy.max_all_in_cents,
      'actionCeiling', policy.action_ceiling,
      'decisionMode', policy.decision_mode,
      'maxSignalAgeSeconds', policy.max_signal_age_seconds,
      'substitutionPolicy', policy.substitution_policy,
      'expiresAt', policy.expires_at,
      'cooldownSeconds', policy.cooldown_seconds,
      'targets', policy.target_policy_json::jsonb,
      'policyHash', policy.policy_hash,
      'changeReason', policy.change_reason,
      'createdByActorId', policy.created_by_actor_id,
      'createdAt', policy.created_at
    ) INTO stored_policy_result
    FROM ${relation(manifest.schemaName, "mission_intent_revisions")} AS policy
    WHERE policy.id = policy_result->>'id'
      AND policy.tenant_id = resolved_tenant_id
      AND policy.user_id = resolved_user_id
      AND policy.mission_id = mission_id_value;
    IF stored_policy_result IS DISTINCT FROM policy_result THEN
      RAISE EXCEPTION USING ERRCODE = '40001',
        MESSAGE = 'signal mission-policy replay revision changed';
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
      'policyMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE,
      'policy', policy_result,
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

  SELECT mission.id, mission.variant_id, mission.target_quantity
    INTO STRICT mission_record
  FROM ${relation(manifest.schemaName, "missions")} AS mission
  WHERE mission.id = mission_id_value
    AND mission.tenant_id = resolved_tenant_id
    AND mission.user_id = resolved_user_id
  FOR UPDATE OF mission;
  IF mission_record.target_quantity NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal mission-policy mission quantity is invalid';
  END IF;

  SELECT policy.* INTO current_policy_record
  FROM ${relation(manifest.schemaName, "mission_intent_revisions")} AS policy
  WHERE policy.tenant_id = resolved_tenant_id
    AND policy.user_id = resolved_user_id
    AND policy.mission_id = mission_id_value
  ORDER BY policy.revision DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal mission-policy current revision is unavailable';
  END IF;
  IF current_policy_record.revision <> expected_revision_value
    OR current_policy_record.policy_hash <> expected_policy_hash_value THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'signal mission-policy revision changed';
  END IF;

  LOCK TABLE ${relation(manifest.schemaName, "mission_targets")} IN SHARE MODE;
  LOCK TABLE ${relation(manifest.schemaName, "listings")} IN SHARE MODE;
  SELECT COUNT(*), COUNT(*) FILTER (
      WHERE listing.variant_id <> mission_record.variant_id
        OR target.currency <> 'USD'
        OR listing.currency <> 'USD'
    )
    INTO target_count, invalid_target_count
  FROM ${relation(manifest.schemaName, "mission_targets")} AS target
  JOIN ${relation(manifest.schemaName, "listings")} AS listing
    ON listing.id = target.listing_id
  WHERE target.mission_id = mission_id_value;
  IF target_count < 1 OR target_count > ${MAXIMUM_MISSION_TARGETS}
    OR invalid_target_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal mission-policy exact target graph is invalid';
  END IF;

  SELECT COALESCE(
    '[' || pg_catalog.string_agg(
      '{"targetId":' || pg_catalog.to_json(target.id)::text ||
      ',"listingId":' || pg_catalog.to_json(target.listing_id)::text ||
      ',"retailerId":' || pg_catalog.to_json(listing.retailer_id)::text ||
      ',"enabled":' || pg_catalog.to_json(target.enabled = 1)::text ||
      ',"maxUnitPriceCents":' || COALESCE(
        pg_catalog.to_json(target.max_unit_price_cents)::text, 'null'
      ) ||
      ',"sellerPolicy":' || pg_catalog.to_json(target.seller_policy)::text ||
      ',"fulfillment":' || pg_catalog.to_json(target.fulfillment)::text || '}',
      ',' ORDER BY target.id
    ) || ']',
    '[]'
  ) INTO target_policy_json_value
  FROM ${relation(manifest.schemaName, "mission_targets")} AS target
  JOIN ${relation(manifest.schemaName, "listings")} AS listing
    ON listing.id = target.listing_id
  WHERE target.mission_id = mission_id_value;

  SELECT settings.tax_bps, settings.store_allowances_json
    INTO STRICT settings_record
  FROM ${relation(manifest.schemaName, "app_settings")} AS settings
  WHERE settings.user_id = resolved_user_id
  FOR SHARE OF settings;
  BEGIN
    settings_allowances := settings_record.store_allowances_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal mission-policy store allowances are invalid';
  END;
  IF settings_record.tax_bps NOT BETWEEN 0 AND 10000
    OR pg_catalog.jsonb_typeof(settings_allowances) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal mission-policy current settings are invalid';
  END IF;

  IF decision_mode_value = 'purchase_intent'
    AND action_ceiling_value = 'add_to_cart' THEN
    SELECT COUNT(*), COUNT(*) FILTER (
        WHERE listing.execution_supported <> 1
          OR target.max_unit_price_cents IS NULL
          OR target.seller_policy <> 'first_party_only'
          OR target.fulfillment <> 'shipping'
      )
      INTO enabled_target_count, unsafe_direct_target_count
    FROM ${relation(manifest.schemaName, "mission_targets")} AS target
    JOIN ${relation(manifest.schemaName, "listings")} AS listing
      ON listing.id = target.listing_id
    WHERE target.mission_id = mission_id_value AND target.enabled = 1;
    IF enabled_target_count < 1 OR unsafe_direct_target_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'signal mission-policy direct purchase target is unsafe';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM ${relation(manifest.schemaName, "mission_targets")} AS target
      JOIN ${relation(manifest.schemaName, "listings")} AS listing
        ON listing.id = target.listing_id
      WHERE target.mission_id = mission_id_value AND target.enabled = 1
        AND settings_allowances ? listing.retailer_id
        AND (
          pg_catalog.jsonb_typeof(settings_allowances->listing.retailer_id)
            IS DISTINCT FROM 'number'
          OR settings_allowances->>listing.retailer_id !~ '^(0|[1-9][0-9]{0,8})$'
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'signal mission-policy retailer allowance is invalid';
    END IF;
    SELECT MAX(
      (
        target.max_unit_price_cents::bigint * mission_record.target_quantity::bigint *
          (10000::bigint + settings_record.tax_bps::bigint) + 9999::bigint
      ) / 10000::bigint +
      COALESCE((settings_allowances->>listing.retailer_id)::bigint, 0)
    ) INTO required_all_in_cents
    FROM ${relation(manifest.schemaName, "mission_targets")} AS target
    JOIN ${relation(manifest.schemaName, "listings")} AS listing
      ON listing.id = target.listing_id
    WHERE target.mission_id = mission_id_value AND target.enabled = 1;
    IF max_all_in_cents_value IS NULL
      OR max_all_in_cents_value < required_all_in_cents THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'signal mission-policy all-in bound is too low';
    END IF;
  END IF;

  policy_hash_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(${policyHashParts}, 'UTF8')
  ), 'hex');
  SELECT pg_catalog.jsonb_build_object(
    'id', current_policy_record.id,
    'missionId', current_policy_record.mission_id,
    'revision', current_policy_record.revision,
    'quantity', current_policy_record.quantity,
    'currency', current_policy_record.currency,
    'maxAllInCents', current_policy_record.max_all_in_cents,
    'actionCeiling', current_policy_record.action_ceiling,
    'decisionMode', current_policy_record.decision_mode,
    'maxSignalAgeSeconds', current_policy_record.max_signal_age_seconds,
    'substitutionPolicy', current_policy_record.substitution_policy,
    'expiresAt', current_policy_record.expires_at,
    'cooldownSeconds', current_policy_record.cooldown_seconds,
    'targets', current_policy_record.target_policy_json::jsonb,
    'policyHash', current_policy_record.policy_hash,
    'changeReason', current_policy_record.change_reason,
    'createdByActorId', current_policy_record.created_by_actor_id,
    'createdAt', current_policy_record.created_at
  ) INTO stored_policy_result;
  IF current_policy_record.policy_hash = policy_hash_value THEN
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
      'policyMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE,
      'policy', stored_policy_result,
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

  next_revision_value := current_policy_record.revision + 1;
  IF next_revision_value > 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE = '54000',
      MESSAGE = 'signal mission-policy revision limit is exhausted';
  END IF;
  created_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  IF change_reason_value = '' THEN
    change_reason_value := 'Purchase preferences updated.';
  END IF;
  INSERT INTO ${relation(manifest.schemaName, "mission_intent_revisions")}(
    id, tenant_id, user_id, mission_id, revision, quantity, currency,
    max_all_in_cents, action_ceiling, substitution_policy, expires_at,
    cooldown_seconds, target_policy_json, policy_hash, change_reason,
    decision_mode, max_signal_age_seconds, created_by_actor_id, created_at
  ) VALUES (
    revision_id_value, resolved_tenant_id, resolved_user_id, mission_id_value,
    next_revision_value, mission_record.target_quantity, 'USD',
    max_all_in_cents_value, action_ceiling_value, substitution_policy_value,
    expires_at_value, cooldown_seconds_value, target_policy_json_value,
    policy_hash_value, change_reason_value, decision_mode_value,
    max_signal_age_seconds_value, session_user::text, created_timestamp
  );
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'signal mission-policy revision insert was ambiguous';
  END IF;

  policy_result := pg_catalog.jsonb_build_object(
    'id', revision_id_value,
    'missionId', mission_id_value,
    'revision', next_revision_value,
    'quantity', mission_record.target_quantity,
    'currency', 'USD',
    'maxAllInCents', max_all_in_cents_value,
    'actionCeiling', action_ceiling_value,
    'decisionMode', decision_mode_value,
    'maxSignalAgeSeconds', max_signal_age_seconds_value,
    'substitutionPolicy', substitution_policy_value,
    'expiresAt', expires_at_value,
    'cooldownSeconds', cooldown_seconds_value,
    'targets', target_policy_json_value::jsonb,
    'policyHash', policy_hash_value,
    'changeReason', change_reason_value,
    'createdByActorId', session_user::text,
    'createdAt', created_timestamp
  );
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'missionId', mission_id_value,
    'revision', next_revision_value,
    'actionCeiling', action_ceiling_value,
    'decisionMode', decision_mode_value,
    'maxSignalAgeSeconds', max_signal_age_seconds_value,
    'substitutionPolicy', substitution_policy_value,
    'targetCount', target_count,
    'result', policy_result
  );
  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, mission_id_value,
    'purchase_intent_policy_revised', 'preferences_updated',
    'Purchase intent policy revision ' || next_revision_value::text ||
      ' was recorded append-only.',
    audit_data_value::text, created_timestamp
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value,
    'correlationId', mission_id_value,
    'reasonCode', 'preferences_updated',
    'message', 'Purchase intent policy revision ' || next_revision_value::text ||
      ' was recorded append-only.',
    'data', audit_data_value
  );
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'purchase_intent', mission_id_value,
    'purchase_intent_policy_revised', outbox_payload_value::text,
    created_timestamp, ''
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
    'policyMutated', TRUE,
    'auditMutated', TRUE,
    'outboxMutated', TRUE,
    'policy', policy_result,
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
  manifest: PostgresSignalMissionPolicyApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_mission_policy_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.missionPolicyRole.name,
    functionName: POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalMissionPolicyApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_MISSION_POLICY_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_mission_policy_apply_receipt",
    receiptTriggerName: "yoink_signal_mission_policy_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.retailerQualificationApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      retailerQualificationApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      operationCount: 1,
      protectedSharedCatalogTableNames: [...PROTECTED_SHARED_CATALOG_TABLES],
      maximumMissionTargets: MAXIMUM_MISSION_TARGETS,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      settingsScopeConsumed: true,
      missionPolicyScopeConsumed: true,
      databaseOwnedTimestamps: true,
      optimisticConcurrency: true,
      deterministicRequestIdentity: true,
      immutableRequestReplay: true,
      lifecycleAwareOutboxReplay: true,
      zeroWriteUnchangedPolicy: true,
      appendOnlyPolicyRevision: true,
      atomicPolicyAuditOutbox: true,
      currentMissionOwnershipRevalidation: true,
      currentTargetSnapshotRevalidation: true,
      currentSettingsRevalidation: true,
      policyHashV2Parity: true,
      directPurchaseSafetyParity: true,
      sourceTrustWriterParity: true,
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

export function postgresSignalMissionPolicyCapabilityProjection():
PostgresSignalMissionPolicyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalMissionPolicyApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    retailerQualificationApplyContractVersion: 1,
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
    missionPolicyScopeConsumed: true,
    databaseOwnedTimestamps: true,
    optimisticConcurrency: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    zeroWriteUnchangedPolicy: true,
    appendOnlyPolicyRevision: true,
    atomicPolicyAuditOutbox: true,
    currentMissionOwnershipRevalidation: true,
    currentTargetSnapshotRevalidation: true,
    currentSettingsRevalidation: true,
    policyHashV2Parity: true,
    directPurchaseSafetyParity: true,
    sourceTrustWriterParity: true,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    operationCount: 1,
    protectedTenantTableCount: 6,
    forcedRlsTableCount: 6,
    mutationTableCount: 3,
    protectedSharedCatalogTableCount: 1,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumMissionTargets: MAXIMUM_MISSION_TARGETS,
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

export type PostgresSignalMissionPolicyApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalMissionPolicyApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalMissionPolicyApplyManifest()
): Promise<PostgresSignalMissionPolicyApplyQualificationReceipt> {
  await verifyPostgresSignalRetailerQualificationApplyBoundary(
    database,
    manifest.predecessorManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalMissionPolicyApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalMissionPolicyApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalMissionPolicyApplyQualificationReceipt> {
  await verifyPostgresSignalRetailerQualificationApplyBoundary(
    database,
    manifest.predecessorManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalMissionPolicyApplyQualificationError(
      `The PostgreSQL mission-policy ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalMissionPolicyOperation,
  requestId: string
): PostgresSignalMissionPolicyApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalMissionPolicyApplyQualificationError(
      "The PostgreSQL mission-policy result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const policy = result.policy;
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "unchanged", "already_applied"]).has(String(result.outcome))
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || !Number.isSafeInteger(result.mutationStatementCount)
    || !Number.isSafeInteger(result.mutationRowCount)
    || typeof result.policyMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || !policy || typeof policy !== "object" || Array.isArray(policy)
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
    throw new PostgresSignalMissionPolicyApplyQualificationError(
      "The PostgreSQL mission-policy result contract changed."
    );
  }
  return result as unknown as PostgresSignalMissionPolicyApplyResult;
}

export class NodePostgresSignalMissionPolicyApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalMissionPolicyApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalMissionPolicyApplyManifest(),
    options: NodePostgresSignalMissionPolicyApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalMissionPolicyApplyQualificationError(
        "The PostgreSQL mission-policy connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_mission_policy"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async applyMissionPolicy(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalMissionPolicyOperation,
    requestIdValue: string,
    requestPayload: Record<string, unknown>
  ): Promise<PostgresSignalMissionPolicyApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalMissionPolicyOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (operation !== "revise_mission_policy"
      || !REQUEST_ID.test(requestId)
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalMissionPolicyApplyQualificationError(
        "The PostgreSQL mission-policy apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.missionPolicyRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalMissionPolicyApplyQualificationError(
          "The PostgreSQL mission-policy function returned an ambiguous result."
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
