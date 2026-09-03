import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import {
  AMAZON_ADD_ACTIVATION_CONFIRMATION,
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  BESTBUY_ADD_ACTIVATION_CONFIRMATION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  WALMART_ADD_ACTIVATION_CONFIRMATION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION
} from "../../contracts/src/index.js";
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
  POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_CONTRACT_VERSION,
  buildPostgresSignalSourceTrustApplyManifest,
  verifyPostgresSignalSourceTrustApplyBoundary,
  type PostgresSignalSourceTrustApplyManifest
} from "./postgres-signal-source-trust-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_RECEIPT_TABLE =
  "yoink_signal_retailer_qualification_apply_receipt";
export const POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION =
  "yoink_apply_signal_retailer_qualification";

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
const TENANT_MUTATION_TABLES = Object.freeze([
  "action_events",
  "action_jobs",
  "audit_events",
  "outbox_events",
  "retailer_adapter_qualifications"
] as const);
const PROTECTED_SHARED_CATALOG_TABLES = Object.freeze([
  "listings",
  "retailers"
] as const);

export type PostgresSignalRetailerQualificationOperation =
  | "activate_walmart_add"
  | "activate_amazon_add"
  | "activate_bestbuy_add";

export interface PostgresSignalRetailerQualificationApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  sourceTrustApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  retailerQualificationRoleNamespace: string;
  sourceTrustApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalSourceTrustApplyManifest;
  retailerQualificationRole: {
    kind: "signal_retailer_qualification_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    tenantMutationTableNames: string[];
    protectedSharedCatalogTableNames: string[];
    sharedCatalogMutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 3;
  supportedRetailerCount: 3;
  protectedTenantTableCount: 9;
  forcedRlsTableCount: 9;
  tenantMutationTableCount: 5;
  protectedSharedCatalogTableCount: 2;
  sharedCatalogMutationTableCount: 2;
  totalMutationTableCount: 7;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  retailerQualificationScopeConsumed: true;
  settingsScopeConsumed: true;
  globalRetailerSerialization: true;
  exactPackagedRetailerAllowlist: true;
  monotonicSharedCatalogPromotion: true;
  databaseOwnedTimestamps: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  atomicQualificationCatalogPromotionAuditOutbox: true;
  currentEvidenceRevalidation: true;
  currentDeviceCapabilityRevalidation: true;
  currentSettingsRevalidation: true;
  nonTargetQualificationWriterParity: true;
  nonTargetJobPromotionParity: true;
  sharedCatalogExecutionWriterParity: true;
  qualificationSettingsWriterParity: true;
  sourceTrustWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: false;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalRetailerQualificationCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  sourceTrustApplyContractVersion: 1;
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
  globalRetailerSerialization: true;
  exactPackagedRetailerAllowlist: true;
  monotonicSharedCatalogPromotion: true;
  databaseOwnedTimestamps: true;
  deterministicRequestIdentity: true;
  immutableRequestReplay: true;
  lifecycleAwareOutboxReplay: true;
  atomicQualificationCatalogPromotionAuditOutbox: true;
  currentEvidenceRevalidation: true;
  currentDeviceCapabilityRevalidation: true;
  currentSettingsRevalidation: true;
  nonTargetQualificationWriterParity: true;
  nonTargetJobPromotionParity: true;
  sharedCatalogExecutionWriterParity: true;
  qualificationSettingsWriterParity: true;
  sourceTrustWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: false;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  operationCount: 3;
  supportedRetailerCount: 3;
  protectedTenantTableCount: 9;
  forcedRlsTableCount: 9;
  tenantMutationTableCount: 5;
  protectedSharedCatalogTableCount: 2;
  sharedCatalogMutationTableCount: 2;
  totalMutationTableCount: 7;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: true;
  retailerMutationAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalRetailerQualificationApplyResult {
  contractVersion: 1;
  operation: PostgresSignalRetailerQualificationOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  qualificationMutated: boolean;
  settingsMutated: false;
  sharedRetailerMutated: boolean;
  sharedListingsMutated: number;
  sharedCatalogMutated: boolean;
  promotedJobCount: number;
  actionEventsMutated: number;
  auditMutated: boolean;
  outboxMutated: boolean;
  activation: Record<string, unknown>;
  nonTargetQualificationWriterParity: true;
  sharedCatalogExecutionWriterParity: true;
  qualificationSettingsWriterParity: true;
  sourceTrustWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: true;
  retailerMutationAuthority: false;
  runtimeAuthority: false;
}

export interface NodePostgresSignalRetailerQualificationApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalRetailerQualificationCapabilityProjection> | null = null;

export class PostgresSignalRetailerQualificationApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalRetailerQualificationApplyQualificationError";
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
    throw new PostgresSignalRetailerQualificationApplyQualificationError(
      "The PostgreSQL retailer-qualification schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalRetailerQualificationApplyQualificationError(
      "The PostgreSQL retailer-qualification role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_retailer_qualification`;
  if (value.length > 63) {
    throw new PostgresSignalRetailerQualificationApplyQualificationError(
      "The PostgreSQL retailer-qualification role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function predecessorNamespaces(manifest: PostgresSignalSourceTrustApplyManifest): string[] {
  const target = manifest.predecessorManifest;
  const action = target.predecessorManifest;
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
    target.targetQualificationRoleNamespace,
    manifest.sourceTrustRoleNamespace
  ];
}

export function buildPostgresSignalRetailerQualificationApplyManifest(
  predecessorManifest = buildPostgresSignalSourceTrustApplyManifest(),
  requestedRoleNamespace = "yoink_retailer_qual"
): PostgresSignalRetailerQualificationApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const retailerQualificationRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (predecessorNamespaces(predecessorManifest).includes(retailerQualificationRoleNamespace)) {
    throw new PostgresSignalRetailerQualificationApplyQualificationError(
      "The PostgreSQL retailer-qualification role namespace must be independent."
    );
  }
  const withoutFingerprint:
  Omit<PostgresSignalRetailerQualificationApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    sourceTrustApplyContractVersion: POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    retailerQualificationRoleNamespace,
    sourceTrustApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    retailerQualificationRole: {
      kind: "signal_retailer_qualification_apply_boundary",
      name: roleName(retailerQualificationRoleNamespace),
      functionName: POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      tenantMutationTableNames: [...TENANT_MUTATION_TABLES],
      protectedSharedCatalogTableNames: [...PROTECTED_SHARED_CATALOG_TABLES],
      sharedCatalogMutationTableNames: [...PROTECTED_SHARED_CATALOG_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 3,
    supportedRetailerCount: 3,
    protectedTenantTableCount: 9,
    forcedRlsTableCount: 9,
    tenantMutationTableCount: 5,
    protectedSharedCatalogTableCount: 2,
    sharedCatalogMutationTableCount: 2,
    totalMutationTableCount: 7,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    retailerQualificationScopeConsumed: true,
    settingsScopeConsumed: true,
    globalRetailerSerialization: true,
    exactPackagedRetailerAllowlist: true,
    monotonicSharedCatalogPromotion: true,
    databaseOwnedTimestamps: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    atomicQualificationCatalogPromotionAuditOutbox: true,
    currentEvidenceRevalidation: true,
    currentDeviceCapabilityRevalidation: true,
    currentSettingsRevalidation: true,
    nonTargetQualificationWriterParity: true,
    nonTargetJobPromotionParity: true,
    sharedCatalogExecutionWriterParity: true,
    qualificationSettingsWriterParity: true,
    sourceTrustWriterParity: true,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
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

export function signalRetailerQualificationApplyFunctionSource(
  manifest = buildPostgresSignalRetailerQualificationApplyManifest()
): string {
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  retailer_id_value TEXT;
  display_name_value TEXT;
  domain_value TEXT;
  observer_version_value TEXT;
  adapter_version_value TEXT;
  activation_confirmation_value TEXT;
  first_party_seller_value TEXT;
  capability_flag_value TEXT;
  capability_version_flag_value TEXT;
  evidence_namespace_value TEXT;
  action_reason_code_value TEXT;
  action_message_value TEXT;
  audit_reason_code_value TEXT;
  audit_message_value TEXT;
  evidence_hash_input TEXT;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  evidence_cutoff TEXT;
  active_device_cutoff TEXT;
  observation_count_value BIGINT;
  distinct_sku_count_value BIGINT;
  first_party_actionable_count BIGINT;
  shipping_actionable_count BIGINT;
  offer_route_ready_count BIGINT;
  rehearsal_count_value BIGINT;
  qualification_parts TEXT;
  computed_evidence_hash TEXT;
  device_record RECORD;
  device_capabilities JSONB;
  settings_record RECORD;
  retailer_record RECORD;
  qualification_updated_at_value TEXT;
  updated_timestamp TEXT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  replay_promotion_count BIGINT;
  affected_rows BIGINT;
  shared_retailer_mutated_value BOOLEAN := FALSE;
  shared_listings_mutated_value BIGINT := 0;
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
    OR operation_name NOT IN (
      'activate_walmart_add', 'activate_amazon_add', 'activate_bestbuy_add'
    )
    OR request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'signal retailer-qualification request is invalid';
  END IF;

  IF operation_name = 'activate_walmart_add' THEN
    retailer_id_value := 'walmart';
    display_name_value := 'Walmart';
    domain_value := 'walmart.com';
    observer_version_value := '${WALMART_OBSERVER_VERSION}';
    adapter_version_value := '${WALMART_ADD_ADAPTER_VERSION}';
    activation_confirmation_value := '${WALMART_ADD_ACTIVATION_CONFIRMATION}';
    first_party_seller_value := 'Walmart';
    capability_flag_value := 'walmartAddOnly';
    capability_version_flag_value := 'walmartAddAdapterVersion';
    evidence_namespace_value := 'walmart-add-qualification-evidence-v1';
    action_reason_code_value := 'walmart_add_v1_activated';
    action_message_value :=
      'A fresh shadow job entered the guarded Walmart add-only executor after explicit activation.';
    audit_reason_code_value := 'explicit_walmart_add_v1_activation';
    audit_message_value :=
      'Walmart add v5 was explicitly enabled for Walmart-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.';
  ELSIF operation_name = 'activate_amazon_add' THEN
    retailer_id_value := 'amazon';
    display_name_value := 'Amazon';
    domain_value := 'amazon.com';
    observer_version_value := '${AMAZON_OBSERVER_VERSION}';
    adapter_version_value := '${AMAZON_ADD_ADAPTER_VERSION}';
    activation_confirmation_value := '${AMAZON_ADD_ACTIVATION_CONFIRMATION}';
    first_party_seller_value := 'Amazon.com';
    capability_flag_value := 'amazonAddOnly';
    capability_version_flag_value := 'amazonAddAdapterVersion';
    evidence_namespace_value := 'amazon-add-qualification-evidence-v1';
    action_reason_code_value := 'amazon_add_v1_activated';
    action_message_value :=
      'A fresh shadow job entered the guarded Amazon add-only executor after explicit activation.';
    audit_reason_code_value := 'explicit_amazon_add_v1_activation';
    audit_message_value :=
      'Amazon add v7 was explicitly enabled for Amazon.com-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.';
  ELSE
    retailer_id_value := 'bestbuy';
    display_name_value := 'Best Buy';
    domain_value := 'bestbuy.com';
    observer_version_value := '${BESTBUY_OBSERVER_VERSION}';
    adapter_version_value := '${BESTBUY_ADD_ADAPTER_VERSION}';
    activation_confirmation_value := '${BESTBUY_ADD_ACTIVATION_CONFIRMATION}';
    first_party_seller_value := 'Best Buy';
    capability_flag_value := 'bestBuyAddOnly';
    capability_version_flag_value := 'bestBuyAddAdapterVersion';
    evidence_namespace_value := 'bestbuy-add-qualification-evidence-v1';
    action_reason_code_value := 'bestbuy_add_v1_activated';
    action_message_value :=
      'A fresh shadow job entered the guarded Best Buy add-only executor after explicit activation.';
    audit_reason_code_value := 'explicit_bestbuy_add_v1_activation';
    audit_message_value :=
      'Best Buy add v5 was explicitly enabled for Best Buy-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.';
  END IF;

  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'signal retailer-qualification payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY[
      'adapterVersion', 'confirmation', 'evidenceHash'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 3
    OR pg_catalog.jsonb_typeof(request_payload->'adapterVersion') IS DISTINCT FROM 'string'
    OR request_payload->>'adapterVersion' <> adapter_version_value
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> activation_confirmation_value
    OR pg_catalog.jsonb_typeof(request_payload->'evidenceHash') IS DISTINCT FROM 'string'
    OR request_payload->>'evidenceHash' !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'signal retailer-qualification payload shape is invalid';
  END IF;
  evidence_hash_input := request_payload->>'evidenceHash';

  SELECT MIN(principal.tenant_id), MIN(principal.user_id), COUNT(*)
    INTO resolved_tenant_id, resolved_user_id, resolved_principal_count
  FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)} AS principal
  WHERE principal.principal_role = session_user::text AND principal.active = TRUE;
  IF resolved_principal_count <> 1 OR resolved_tenant_id IS NULL OR resolved_user_id IS NULL THEN
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
    expected_tenant_id, expected_user_id, '', retailer_id_value, '', '01100'
  ) AS lock_result;
  IF writer_lock_result_count <> 1 OR writer_lock_result IS NULL
    OR writer_lock_result->>'contractVersion' <> '1'
    OR writer_lock_result->>'lockProtocolVersion' <> 'signal_action_constraints_v1'
    OR writer_lock_result->>'lockMask' <> '01100'
    OR writer_lock_result->>'scopeCount' <> '2'
    OR writer_lock_result->>'sourceConnectionId' <> ''
    OR writer_lock_result->>'retailerId' <> retailer_id_value
    OR writer_lock_result->>'missionId' <> ''
    OR writer_lock_result->>'mutationApplied' <> 'false'
    OR writer_lock_result->>'mutationAuthority' <> 'false'
    OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'signal retailer-qualification shared writer-lock protocol failed';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_shared_retailer_execution_v1:' || retailer_id_value, 0
  ));

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    request_payload::text, 'UTF8'
  )), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_retailer_qualification_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_retailer_qualification_outbox_v1|' || audit_id_value, 'UTF8'
    )
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit
  WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
  WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'signal retailer-qualification request graph is partial';
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
      OR replay_record.correlation_id <> retailer_id_value
      OR replay_record.event_type <> 'retailer_adapter_qualified'
      OR replay_record.reason_code <> audit_reason_code_value
      OR replay_record.message <> audit_message_value
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR pg_catalog.jsonb_typeof(replay_record.audit_data->'result') IS DISTINCT FROM 'object'
      OR replay_record.audit_data->'result'->>'retailerId' <> retailer_id_value
      OR replay_record.audit_data->'result'->>'adapterVersion' <> adapter_version_value
      OR replay_record.audit_data->'result'->>'evidenceHash' <> evidence_hash_input
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'retailer_qualification'
      OR replay_record.aggregate_id <> retailer_id_value
      OR replay_record.outbox_event_type <> 'retailer_adapter_qualified'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> retailer_id_value
      OR replay_record.outbox_payload->>'reasonCode' <> audit_reason_code_value
      OR replay_record.outbox_payload->>'message' <> replay_record.message
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = '40001',
        MESSAGE = 'signal retailer-qualification replay graph changed';
    END IF;
    activation_result := replay_record.audit_data->'result';
    IF pg_catalog.jsonb_typeof(activation_result->'promotions') IS DISTINCT FROM 'array'
      OR activation_result->>'promotedJobs' !~ '^(0|[1-9][0-9]{0,8})$'
      OR activation_result->>'sharedListingsMutated' !~ '^(0|[1-9][0-9]{0,12})$'
      OR activation_result->>'sharedRetailerMutated' NOT IN ('true', 'false') THEN
      RAISE EXCEPTION USING ERRCODE = '40001',
        MESSAGE = 'signal retailer-qualification replay result changed';
    END IF;
    SELECT COUNT(*) INTO replay_promotion_count
    FROM pg_catalog.jsonb_array_elements(activation_result->'promotions') AS promotion(value)
    JOIN ${relation(manifest.schemaName, "action_events")} AS action_event
      ON action_event.id = promotion.value->>'actionEventId'
     AND action_event.job_id = promotion.value->>'jobId'
     AND action_event.state = 'awaiting_executor'
     AND action_event.reason_code = action_reason_code_value
     AND action_event.message = action_message_value
     AND action_event.evidence_json::jsonb = pg_catalog.jsonb_build_object(
       'adapterVersion', adapter_version_value
     )
     AND action_event.created_at = replay_record.audit_created_at
    WHERE pg_catalog.jsonb_typeof(promotion.value) = 'object';
    IF replay_promotion_count <> (activation_result->>'promotedJobs')::bigint
      OR replay_promotion_count <> pg_catalog.jsonb_array_length(
        activation_result->'promotions'
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001',
        MESSAGE = 'signal retailer-qualification replay action events changed';
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
      'sharedRetailerMutated', FALSE,
      'sharedListingsMutated', 0,
      'sharedCatalogMutated', FALSE,
      'promotedJobCount', activation_result->'promotedJobs',
      'actionEventsMutated', 0,
      'auditMutated', FALSE,
      'outboxMutated', FALSE,
      'activation', activation_result,
      'nonTargetQualificationWriterParity', TRUE,
      'sharedCatalogExecutionWriterParity', TRUE,
      'qualificationSettingsWriterParity', TRUE,
      'sourceTrustWriterParity', TRUE,
      'sourceWriterParity', FALSE,
      'retailerQualificationWriterParity', TRUE,
      'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE,
      'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE,
      'sharedCatalogMutationAuthority', TRUE,
      'retailerMutationAuthority', FALSE,
      'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  SELECT settings.actions_paused, settings.execution_mode, settings.updated_at
    INTO STRICT settings_record
  FROM ${relation(manifest.schemaName, "app_settings")} AS settings
  JOIN ${relation(manifest.schemaName, "users")} AS account
    ON account.id = settings.user_id
  WHERE settings.user_id = resolved_user_id
    AND account.tenant_id = resolved_tenant_id
  FOR SHARE OF settings;

  SELECT retailer.display_name, retailer.domains_json,
         retailer.execution_supported, retailer.updated_at
    INTO STRICT retailer_record
  FROM ${relation(manifest.schemaName, "retailers")} AS retailer
  WHERE retailer.id = retailer_id_value
  FOR UPDATE OF retailer;
  IF retailer_record.display_name <> display_name_value
    OR retailer_record.domains_json::jsonb IS DISTINCT FROM
      pg_catalog.jsonb_build_array(domain_value)
    OR retailer_record.execution_supported NOT IN (0, 1) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal retailer-qualification shared retailer identity changed';
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
             AND observation.seller_name = first_party_seller_value
         ),
         COUNT(*) FILTER (
           WHERE observation.observation_state = 'actionable_candidate'
             AND observation.fulfillment = 'shipping'
         ),
         COUNT(*) FILTER (
           WHERE observation.observation_state = 'actionable_candidate'
             AND observation.purchase_route_ready = 1
         )
    INTO observation_count_value, distinct_sku_count_value,
         first_party_actionable_count, shipping_actionable_count,
         offer_route_ready_count
  FROM ${relation(manifest.schemaName, "retailer_shadow_observations")} AS observation
  WHERE observation.tenant_id = resolved_tenant_id
    AND observation.user_id = resolved_user_id
    AND observation.retailer_id = retailer_id_value
    AND observation.adapter_version = observer_version_value
    AND observation.observed_at >= evidence_cutoff;

  SELECT COUNT(*) INTO rehearsal_count_value
  FROM ${relation(manifest.schemaName, "retailer_adapter_trials")} AS trial
  WHERE trial.tenant_id = resolved_tenant_id
    AND trial.user_id = resolved_user_id
    AND trial.retailer_id = retailer_id_value
    AND trial.adapter_version = adapter_version_value
    AND trial.trial_kind = 'pre_click_rehearsal'
    AND trial.outcome = 'passed'
    AND trial.observed_at >= evidence_cutoff;

  IF first_party_actionable_count < 1 OR shipping_actionable_count < 1
    OR distinct_sku_count_value < 2 OR rehearsal_count_value < 1
    OR (retailer_id_value = 'amazon' AND offer_route_ready_count < 1) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal retailer-qualification evidence is incomplete';
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
      AND observation.retailer_id = retailer_id_value
      AND observation.adapter_version = observer_version_value
      AND observation.observed_at >= evidence_cutoff
    UNION ALL
    SELECT trial.evidence_hash AS hash_value
    FROM ${relation(manifest.schemaName, "retailer_adapter_trials")} AS trial
    WHERE trial.tenant_id = resolved_tenant_id
      AND trial.user_id = resolved_user_id
      AND trial.retailer_id = retailer_id_value
      AND trial.adapter_version = adapter_version_value
      AND trial.trial_kind = 'pre_click_rehearsal'
      AND trial.outcome = 'passed'
      AND trial.observed_at >= evidence_cutoff
  ) AS evidence;
  computed_evidence_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.octet_length(evidence_namespace_value)::text || ':' ||
      evidence_namespace_value || '|' ||
    pg_catalog.octet_length(adapter_version_value)::text || ':' ||
      adapter_version_value || '|' ||
    COALESCE(qualification_parts, ''),
    'UTF8'
  )), 'hex');
  IF computed_evidence_hash <> evidence_hash_input THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'signal retailer-qualification evidence changed';
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
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal retailer-qualification requires a current Chrome companion';
  END IF;
  BEGIN
    device_capabilities := device_record.capabilities_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal retailer-qualification device capabilities are invalid';
  END;
  IF pg_catalog.jsonb_typeof(device_capabilities) IS DISTINCT FROM 'object'
    OR device_capabilities->capability_flag_value IS DISTINCT FROM 'true'::jsonb
    OR device_capabilities->>capability_version_flag_value <> adapter_version_value THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'signal retailer-qualification requires the exact packaged add capability';
  END IF;

  SELECT qualification.updated_at
    INTO qualification_updated_at_value
  FROM ${relation(manifest.schemaName, "retailer_adapter_qualifications")} AS qualification
  WHERE qualification.tenant_id = resolved_tenant_id
    AND qualification.user_id = resolved_user_id
    AND qualification.retailer_id = retailer_id_value
  FOR UPDATE OF qualification;
  updated_timestamp := pg_catalog.to_char(
    GREATEST(
      pg_catalog.statement_timestamp(),
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
    resolved_tenant_id, resolved_user_id, retailer_id_value, adapter_version_value,
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
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'signal retailer-qualification mutation was ambiguous';
  END IF;
  mutation_row_count_value := mutation_row_count_value + affected_rows;

  UPDATE ${relation(manifest.schemaName, "retailers")}
  SET execution_supported = 1,
      updated_at = pg_catalog.to_char(
        GREATEST(
          updated_timestamp::timestamptz,
          updated_at::timestamptz + INTERVAL '1 millisecond'
        ) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
  WHERE id = retailer_id_value AND execution_supported = 0;
  mutation_statement_count_value := mutation_statement_count_value + 1;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'signal retailer-qualification shared retailer mutation was ambiguous';
  END IF;
  shared_retailer_mutated_value := affected_rows = 1;
  mutation_row_count_value := mutation_row_count_value + affected_rows;

  UPDATE ${relation(manifest.schemaName, "listings")}
  SET execution_supported = 1,
      updated_at = pg_catalog.to_char(
        GREATEST(
          updated_timestamp::timestamptz,
          updated_at::timestamptz + INTERVAL '1 millisecond'
        ) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
  WHERE retailer_id = retailer_id_value AND execution_supported = 0;
  mutation_statement_count_value := mutation_statement_count_value + 1;
  GET DIAGNOSTICS shared_listings_mutated_value = ROW_COUNT;
  mutation_row_count_value :=
    mutation_row_count_value + shared_listings_mutated_value;

  IF settings_record.execution_mode = 'live' AND settings_record.actions_paused = 0 THEN
    FOR job_record IN
      SELECT job.id
      FROM ${relation(manifest.schemaName, "action_jobs")} AS job
      JOIN ${relation(manifest.schemaName, "listings")} AS listing
        ON listing.id = job.listing_id
      WHERE job.tenant_id = resolved_tenant_id
        AND job.user_id = resolved_user_id
        AND job.state = 'shadow_ready'
        AND job.expires_at > updated_timestamp
        AND listing.retailer_id = retailer_id_value
        AND listing.execution_supported = 1
        AND job.action = 'add_to_cart'
        AND job.quantity = 1
        AND job.seller_policy = 'first_party_only'
        AND job.fulfillment IN ('shipping', 'pickup')
      ORDER BY job.created_at, job.id
      FOR UPDATE OF job
    LOOP
      action_event_id_value := 'action_event_' || pg_catalog.substr(pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(
          'postgres_signal_retailer_qualification_action_event_v1|' ||
          audit_id_value || '|' || job_record.id,
          'UTF8'
        )), 'hex'), 1, 32);
      UPDATE ${relation(manifest.schemaName, "action_jobs")}
      SET state = 'awaiting_executor', updated_at = updated_timestamp
      WHERE id = job_record.id
        AND tenant_id = resolved_tenant_id
        AND user_id = resolved_user_id
        AND state = 'shadow_ready';
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '40001',
          MESSAGE = 'signal retailer-qualification job promotion changed';
      END IF;
      mutation_statement_count_value := mutation_statement_count_value + 1;
      mutation_row_count_value := mutation_row_count_value + 1;
      INSERT INTO ${relation(manifest.schemaName, "action_events")}(
        id, job_id, state, reason_code, message, evidence_json, created_at
      ) VALUES (
        action_event_id_value, job_record.id, 'awaiting_executor',
        action_reason_code_value, action_message_value,
        pg_catalog.jsonb_build_object(
          'adapterVersion', adapter_version_value
        )::text,
        updated_timestamp
      );
      mutation_statement_count_value := mutation_statement_count_value + 1;
      mutation_row_count_value := mutation_row_count_value + 1;
      action_events_mutated_value := action_events_mutated_value + 1;
      promoted_job_count_value := promoted_job_count_value + 1;
      promotions_result := promotions_result || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'jobId', job_record.id,
          'actionEventId', action_event_id_value
        )
      );
    END LOOP;
  END IF;

  activation_result := pg_catalog.jsonb_build_object(
    'retailerId', retailer_id_value,
    'adapterVersion', adapter_version_value,
    'observerVersion', observer_version_value,
    'highestAction', 'add_to_cart',
    'sellerPolicy', 'first_party_only',
    'fulfillment', 'shipping',
    'quantity', 1,
    'evidenceHash', evidence_hash_input,
    'observationCount', observation_count_value,
    'distinctSkuCount', distinct_sku_count_value,
    'firstPartyActionableCount', first_party_actionable_count,
    'shippingActionableCount', shipping_actionable_count,
    'offerRouteReadyCount', offer_route_ready_count,
    'rehearsalCount', rehearsal_count_value,
    'qualifiedAt', updated_timestamp,
    'settingsUpdatedAt', settings_record.updated_at,
    'executionMode', settings_record.execution_mode,
    'actionsPaused', settings_record.actions_paused = 1,
    'sharedRetailerMutated', shared_retailer_mutated_value,
    'sharedListingsMutated', shared_listings_mutated_value,
    'sharedCatalogMutated',
      shared_retailer_mutated_value OR shared_listings_mutated_value > 0,
    'retailerExecutionSupported', TRUE,
    'promotedJobs', promoted_job_count_value,
    'promotions', promotions_result
  );
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'retailerId', retailer_id_value,
    'adapterVersion', adapter_version_value,
    'highestAction', 'add_to_cart',
    'sellerPolicy', 'first_party_only',
    'fulfillment', 'shipping',
    'quantity', 1,
    'evidenceHash', evidence_hash_input,
    'promotedJobs', promoted_job_count_value,
    'sharedRetailerMutated', shared_retailer_mutated_value,
    'sharedListingsMutated', shared_listings_mutated_value,
    'result', activation_result
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value,
    'correlationId', retailer_id_value,
    'reasonCode', audit_reason_code_value,
    'message', audit_message_value,
    'data', audit_data_value
  );
  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, retailer_id_value,
    'retailer_adapter_qualified', audit_reason_code_value,
    audit_message_value, audit_data_value::text, updated_timestamp
  );
  mutation_statement_count_value := mutation_statement_count_value + 1;
  mutation_row_count_value := mutation_row_count_value + 1;
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'retailer_qualification',
    retailer_id_value, 'retailer_adapter_qualified',
    outbox_payload_value::text, updated_timestamp, ''
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
    'settingsMutated', FALSE,
    'sharedRetailerMutated', shared_retailer_mutated_value,
    'sharedListingsMutated', shared_listings_mutated_value,
    'sharedCatalogMutated',
      shared_retailer_mutated_value OR shared_listings_mutated_value > 0,
    'promotedJobCount', promoted_job_count_value,
    'actionEventsMutated', action_events_mutated_value,
    'auditMutated', TRUE,
    'outboxMutated', TRUE,
    'activation', activation_result,
    'nonTargetQualificationWriterParity', TRUE,
    'sharedCatalogExecutionWriterParity', TRUE,
    'qualificationSettingsWriterParity', TRUE,
    'sourceTrustWriterParity', TRUE,
    'sourceWriterParity', FALSE,
    'retailerQualificationWriterParity', TRUE,
    'configurationWriterParity', FALSE,
    'reservationWriterParity', FALSE,
    'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE,
    'sharedCatalogMutationAuthority', TRUE,
    'retailerMutationAuthority', FALSE,
    'runtimeAuthority', FALSE
  )::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalRetailerQualificationApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_retailer_qualification_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.retailerQualificationRole.name,
    functionName: POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalRetailerQualificationApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_retailer_qualification_apply_receipt",
    receiptTriggerName: "yoink_signal_retailer_qualification_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.sourceTrustApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...TENANT_MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      sourceTrustApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      operationCount: 3,
      supportedRetailerIds: ["amazon", "bestbuy", "walmart"],
      protectedSharedCatalogTableNames: [...PROTECTED_SHARED_CATALOG_TABLES],
      sharedCatalogMutationTableNames: [...PROTECTED_SHARED_CATALOG_TABLES],
      sharedCatalogMutationTableCount: 2,
      totalMutationTableCount: 7,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      retailerQualificationScopeConsumed: true,
      settingsScopeConsumed: true,
      globalRetailerSerialization: true,
      exactPackagedRetailerAllowlist: true,
      monotonicSharedCatalogPromotion: true,
      currentEvidenceRevalidation: true,
      currentDeviceCapabilityRevalidation: true,
      currentSettingsRevalidation: true,
      nonTargetQualificationWriterParity: true,
      nonTargetJobPromotionParity: true,
      sharedCatalogExecutionWriterParity: true,
      qualificationSettingsWriterParity: true,
      sourceTrustWriterParity: true,
      sourceWriterParity: false,
      retailerQualificationWriterParity: true,
      missionPolicyWriterParity: false,
      settingsWriterParity: false,
      configurationWriterParity: false,
      reservationWriterParity: false,
      writerLockProtocolParity: false,
      sharedCatalogMutationAuthority: true,
      retailerMutationAuthority: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalRetailerQualificationCapabilityProjection():
PostgresSignalRetailerQualificationCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalRetailerQualificationApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    sourceTrustApplyContractVersion: 1,
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
    globalRetailerSerialization: true,
    exactPackagedRetailerAllowlist: true,
    monotonicSharedCatalogPromotion: true,
    databaseOwnedTimestamps: true,
    deterministicRequestIdentity: true,
    immutableRequestReplay: true,
    lifecycleAwareOutboxReplay: true,
    atomicQualificationCatalogPromotionAuditOutbox: true,
    currentEvidenceRevalidation: true,
    currentDeviceCapabilityRevalidation: true,
    currentSettingsRevalidation: true,
    nonTargetQualificationWriterParity: true,
    nonTargetJobPromotionParity: true,
    sharedCatalogExecutionWriterParity: true,
    qualificationSettingsWriterParity: true,
    sourceTrustWriterParity: true,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: false,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    operationCount: 3,
    supportedRetailerCount: 3,
    protectedTenantTableCount: 9,
    forcedRlsTableCount: 9,
    tenantMutationTableCount: 5,
    protectedSharedCatalogTableCount: 2,
    sharedCatalogMutationTableCount: 2,
    totalMutationTableCount: 7,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    sharedCatalogMutationAuthority: true,
    retailerMutationAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export type PostgresSignalRetailerQualificationApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalRetailerQualificationApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalRetailerQualificationApplyManifest()
): Promise<PostgresSignalRetailerQualificationApplyQualificationReceipt> {
  await verifyPostgresSignalSourceTrustApplyBoundary(
    database,
    manifest.predecessorManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalRetailerQualificationApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalRetailerQualificationApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalRetailerQualificationApplyQualificationReceipt> {
  await verifyPostgresSignalSourceTrustApplyBoundary(
    database,
    manifest.predecessorManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalRetailerQualificationApplyQualificationError(
      `The PostgreSQL retailer-qualification ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalRetailerQualificationOperation,
  requestId: string
): PostgresSignalRetailerQualificationApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalRetailerQualificationApplyQualificationError(
      "The PostgreSQL retailer-qualification result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const activation = result.activation;
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "already_applied"]).has(String(result.outcome))
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || !Number.isSafeInteger(result.mutationStatementCount)
    || !Number.isSafeInteger(result.mutationRowCount)
    || typeof result.qualificationMutated !== "boolean"
    || result.settingsMutated !== false
    || typeof result.sharedRetailerMutated !== "boolean"
    || !Number.isSafeInteger(result.sharedListingsMutated)
    || typeof result.sharedCatalogMutated !== "boolean"
    || !Number.isSafeInteger(result.promotedJobCount)
    || !Number.isSafeInteger(result.actionEventsMutated)
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || !activation || typeof activation !== "object" || Array.isArray(activation)
    || result.nonTargetQualificationWriterParity !== true
    || result.sharedCatalogExecutionWriterParity !== true
    || result.qualificationSettingsWriterParity !== true
    || result.sourceTrustWriterParity !== true
    || result.sourceWriterParity !== false
    || result.retailerQualificationWriterParity !== true
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== false
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true
    || result.sharedCatalogMutationAuthority !== true
    || result.retailerMutationAuthority !== false
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalRetailerQualificationApplyQualificationError(
      "The PostgreSQL retailer-qualification result contract changed."
    );
  }
  return result as unknown as PostgresSignalRetailerQualificationApplyResult;
}

export class NodePostgresSignalRetailerQualificationApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalRetailerQualificationApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalRetailerQualificationApplyManifest(),
    options: NodePostgresSignalRetailerQualificationApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalRetailerQualificationApplyQualificationError(
        "The PostgreSQL retailer-qualification connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_retailer_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async applyRetailerQualification(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalRetailerQualificationOperation,
    requestIdValue: string,
    requestPayload: Record<string, unknown>
  ): Promise<PostgresSignalRetailerQualificationApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation =
      String(operationValue ?? "") as PostgresSignalRetailerQualificationOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (!new Set<PostgresSignalRetailerQualificationOperation>([
      "activate_walmart_add",
      "activate_amazon_add",
      "activate_bestbuy_add"
    ]).has(operation)
      || !REQUEST_ID.test(requestId)
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalRetailerQualificationApplyQualificationError(
        "The PostgreSQL retailer-qualification apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(
        `SET LOCAL ROLE ${identifier(this.manifest.retailerQualificationRole.name)}`
      );
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalRetailerQualificationApplyQualificationError(
          "The PostgreSQL retailer-qualification function returned an ambiguous result."
        );
      }
      const parsed = parseFunctionResult(
        result.rows[0].resultJson,
        operation,
        requestId
      );
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
