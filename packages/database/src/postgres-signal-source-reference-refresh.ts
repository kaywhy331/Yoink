import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { SIGNAL_INGRESS_EVENT_TYPE } from "../../contracts/src/signal-ingress.js";
import { nowIso, stableHash } from "../../domain/src/ids.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  inspectPostgresCutoverPreflight,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  type PostgresQuerySession
} from "./postgres-cutover.js";
import {
  POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
  POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION
} from "./postgres-hosted-delivery-lease-recovery.js";
import {
  POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
} from "./postgres-signal-catalog-apply.js";
import {
  POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION,
  buildPostgresSignalResolutionApplyManifest,
  verifyPostgresSignalResolutionApplyBoundary
} from "./postgres-signal-resolution-apply.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_RECEIPT_TABLE =
  "yoink_signal_source_reference_refresh_receipt";
export const POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION =
  "yoink_refresh_trackalacker_signal_source_references";

const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const MAXIMUM_PLAN_AGE_SECONDS = 30;
const MAXIMUM_APPLY_PAYLOAD_BYTES = 512;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_ID = /^inbox_[a-f0-9]{32}$/;
const EVENT_ID = /^signal_event_[a-f0-9]{32}$/;
const RESOLUTION_ID = /^resolution_[a-f0-9]{32}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text", "text", "text"
] as const);
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "inbox_messages",
  "resolution_decisions",
  "signal_events",
  "source_connections",
  "source_listing_refs",
  "source_product_aliases",
  "source_product_refs"
] as const);
const MUTATION_TABLES = Object.freeze([
  "source_listing_refs",
  "source_product_aliases",
  "source_product_refs"
] as const);

type ReferenceAction = "none" | "insert" | "update";
type RefreshOutcome =
  | "refresh"
  | "already_current"
  | "no_reference_identity"
  | "not_matched"
  | "test_signal";

export interface PostgresSignalSourceReferenceRefreshManifest {
  contractVersion: typeof POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  hostedDeliveryContractVersion: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION;
  catalogApplyContractVersion: typeof POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION;
  resolutionApplyContractVersion: typeof POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION;
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
  witnessRefreshRoleNamespace: string;
  leaseRecoveryRoleNamespace: string;
  catalogApplyRoleNamespace: string;
  resolutionApplyRoleNamespace: string;
  sourceReferenceRefreshRoleNamespace: string;
  resolutionApplyManifestFingerprint: string;
  sourceReferenceRefreshRole: {
    kind: "signal_source_reference_refresh_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTenantTableCount: 7;
  forcedRlsTableCount: 7;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  committedResolutionBinding: true;
  matchedResolutionRequired: true;
  testSignalMutation: false;
  conflictingReferenceFailClosed: true;
  idempotentReplay: true;
  sourceProductReferenceRepositoryParity: true;
  sourceListingReferenceRepositoryParity: true;
  sourceProductAliasRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceRefreshRepositoryParity: true;
  downstreamSignalGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  mutationAuthority: true;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalSourceReferenceRefreshQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  resolutionApplyContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  resolutionApplyManifestFingerprint: string;
  sourceReferenceRefreshRoleName: string;
  protectedTenantTableCount: 7;
  forcedRlsTableCount: 7;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  committedResolutionBinding: true;
  matchedResolutionRequired: true;
  testSignalMutation: false;
  conflictingReferenceFailClosed: true;
  idempotentReplay: true;
  sourceProductReferenceRepositoryParity: true;
  sourceListingReferenceRepositoryParity: true;
  sourceProductAliasRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceRefreshRepositoryParity: true;
  downstreamSignalGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  mutationAuthority: true;
  directTableAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  boundaryCatalogFingerprint: string;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresSignalSourceReferenceRefreshCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  resolutionApplyContractVersion: 1;
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
  databasePlanRevalidation: true;
  twoPhasePlanApply: true;
  readCommittedTransactionAdapter: true;
  committedResolutionBinding: true;
  matchedResolutionRequired: true;
  testSignalMutation: false;
  conflictingReferenceFailClosed: true;
  idempotentReplay: true;
  sourceProductReferenceRepositoryParity: true;
  sourceListingReferenceRepositoryParity: true;
  sourceProductAliasRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceRefreshRepositoryParity: true;
  downstreamSignalGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  maximumPlanAgeSeconds: 30;
  protectedTenantTableCount: 7;
  forcedRlsTableCount: 7;
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

export interface PostgresSignalSourceReferenceRefreshPlan {
  contractVersion: 1;
  messageId: string;
  payloadHash: string;
  evaluatedAt: string;
  validUntil: string;
  eventId: string;
  resolutionDecisionId: string;
  resolutionStatus: "matched" | "ambiguous" | "unresolved";
  listingId: string;
  variantId: string;
  referenceIdentityHash: string;
  outcome: RefreshOutcome;
  sourceProductAction: ReferenceAction;
  sourceListingAction: ReferenceAction;
  sourceAliasAction: ReferenceAction;
  mutationStatementCount: number;
  sourceReferenceRefreshWillApply: boolean;
  sharedCatalogMutation: false;
  rawSignalPayloadReturned: false;
  planFingerprint: string;
}

export interface PostgresSignalSourceReferenceRefreshResult {
  contractVersion: 1;
  messageId: string;
  planFingerprint: string;
  eventId: string;
  resolutionDecisionId: string;
  outcome: RefreshOutcome;
  sourceProductAction: ReferenceAction;
  sourceListingAction: ReferenceAction;
  sourceAliasAction: ReferenceAction;
  mutationStatementCount: number;
  sourceReferenceRefreshApplied: boolean;
  mutationAuthority: true;
  idempotentReplay: true;
  sharedCatalogMutated: false;
  downstreamSignalGraphMutated: false;
  inboxLifecycleMutated: false;
  rawSignalPayloadReturned: false;
}

export interface NodePostgresSignalSourceReferenceRefreshDatabaseOptions {
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

interface RoutineAclRow extends Record<string, unknown> {
  grantee: string;
  privilegeType: string;
  grantable: boolean;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  hosted_delivery_contract_version: string | number | bigint;
  catalog_apply_contract_version: string | number | bigint;
  resolution_apply_contract_version: string | number | bigint;
  phase: string;
  role_manifest_fingerprint: string;
  resolution_apply_manifest_fingerprint: string;
  source_reference_refresh_role_name: string;
  protected_tenant_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  mutation_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  maximum_plan_age_seconds: string | number | bigint;
  server_bound_principal_lookup: boolean;
  database_plan_revalidation: boolean;
  committed_resolution_binding: boolean;
  matched_resolution_required: boolean;
  test_signal_mutation: boolean;
  conflicting_reference_fail_closed: boolean;
  idempotent_replay: boolean;
  source_product_reference_repository_parity: boolean;
  source_listing_reference_repository_parity: boolean;
  source_product_alias_repository_parity: boolean;
  shared_catalog_mutation: boolean;
  source_reference_refresh_repository_parity: boolean;
  downstream_signal_graph_mutation: boolean;
  inbox_lifecycle_mutation: boolean;
  raw_signal_payload_returned: boolean;
  signal_evaluation_apply_repository_parity: boolean;
  hosted_delivery_handler_repository_parity: boolean;
  mutation_authority: boolean;
  direct_table_access: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  boundary_catalog_fingerprint: string;
  applied_at: string;
  verified_at: string;
}

interface BoundaryInspection {
  protectedTenantTableCount: number;
  forcedRlsTableCount: number;
  mutationTableCount: number;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryCatalogFingerprint: string;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

interface RoleAuthorityRow extends Record<string, unknown> {
  rolcreaterole: boolean;
  rolsuper: boolean;
}

let cachedCapabilityProjection: Readonly<PostgresSignalSourceReferenceRefreshCapabilityProjection> | null = null;

export class PostgresSignalSourceReferenceRefreshQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalSourceReferenceRefreshQualificationError";
  }
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function relation(schemaName: string, objectName: string): string {
  return `${identifier(schemaName)}.${identifier(objectName)}`;
}

function safeSchema(value: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SAFE_SCHEMA.test(normalized)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string, fallback: string): string {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  return `${namespace}_signal_source_reference_refresh`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is out of range.`
    );
  }
  return parsed;
}

function exactText(value: unknown, label: string, maximum = 300, allowEmpty = false): string {
  const normalized = String(value ?? "");
  if (normalized.length > maximum || (!allowEmpty && normalized.length === 0)
    || normalized.trim() !== normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is invalid.`
    );
  }
  return normalized;
}

function exactHash(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!SHA256.test(normalized)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is invalid.`
    );
  }
  return normalized;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is invalid.`
    );
  }
  return normalized;
}

function exactBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is invalid.`
    );
  }
  return expected;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function stableHashInputSql(parts: string[]): string {
  return parts.map((part) =>
    `pg_catalog.octet_length(${part})::text || ':' || ${part} || '|'`
  ).join(" || ");
}

export function postgresSignalSourceReferenceRefreshPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresSignalSourceReferenceRefreshPlan
): string {
  return stableHash(
    "postgres_signal_source_reference_refresh_plan_v1",
    principal.tenantId,
    principal.userId,
    plan.contractVersion,
    plan.messageId,
    plan.payloadHash,
    plan.evaluatedAt,
    plan.validUntil,
    plan.eventId,
    plan.resolutionDecisionId,
    plan.resolutionStatus,
    plan.listingId,
    plan.variantId,
    plan.referenceIdentityHash,
    plan.outcome,
    plan.sourceProductAction,
    plan.sourceListingAction,
    plan.sourceAliasAction,
    plan.mutationStatementCount,
    plan.sourceReferenceRefreshWillApply ? 1 : 0,
    plan.sharedCatalogMutation ? 1 : 0,
    plan.rawSignalPayloadReturned ? 1 : 0
  );
}

export function signalSourceReferenceRefreshFunctionSource(
  manifest: PostgresSignalSourceReferenceRefreshManifest
): string {
  const planParts = stableHashInputSql([
    "'postgres_signal_source_reference_refresh_plan_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'1'::text",
    "message_record.id::text",
    "message_record.payload_hash::text",
    "evaluation_timestamp",
    "valid_until_timestamp",
    "event_record.id::text",
    "resolution_record.id::text",
    "resolution_status_value",
    "listing_id_value",
    "variant_id_value",
    "reference_identity_hash_value",
    "outcome_value",
    "source_product_action_value",
    "source_listing_action_value",
    "source_alias_action_value",
    "mutation_statement_count::text",
    "CASE WHEN mutation_statement_count > 0 THEN '1' ELSE '0' END",
    "'0'::text",
    "'0'::text"
  ]);
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  evaluation_clock TIMESTAMPTZ;
  evaluation_timestamp TEXT;
  valid_until_timestamp TEXT;
  initial_hosted_plan JSONB;
  initial_hosted_plan_count BIGINT;
  hosted_plan JSONB;
  hosted_plan_count BIGINT;
  message_record RECORD;
  event_record RECORD;
  resolution_record RECORD;
  listing_variant_id TEXT := '';
  payload_value JSONB;
  identity_value JSONB;
  source_connection_id_value TEXT;
  signal_id_value TEXT;
  external_event_id_value TEXT;
  transport_hash_value TEXT;
  source_product_id_value TEXT := '';
  source_listing_id_value TEXT := '';
  source_alias_kind_value TEXT := '';
  source_alias_value TEXT := '';
  source_title_value TEXT := '';
  reference_identity_input TEXT;
  reference_identity_hash_value TEXT;
  resolution_status_value TEXT;
  listing_id_value TEXT := '';
  variant_id_value TEXT := '';
  outcome_value TEXT;
  source_product_action_value TEXT := 'none';
  source_listing_action_value TEXT := 'none';
  source_alias_action_value TEXT := 'none';
  mutation_statement_count BIGINT := 0;
  product_ref_count BIGINT := 0;
  product_ref_id_value TEXT := '';
  product_ref_variant_id TEXT := '';
  product_ref_source_title TEXT := '';
  product_ref_observed_at TEXT := '';
  listing_ref_count BIGINT := 0;
  listing_ref_id_value TEXT := '';
  listing_ref_listing_id TEXT := '';
  listing_ref_external_product_id TEXT := '';
  listing_ref_observed_at TEXT := '';
  alias_ref_count BIGINT := 0;
  alias_ref_id_value TEXT := '';
  alias_ref_variant_id TEXT := '';
  alias_ref_observed_at TEXT := '';
  plan_input TEXT;
  plan_fingerprint_value TEXT;
  plan_value JSONB;
  apply_payload JSONB;
  affected_count BIGINT;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR target_message_id !~ '^inbox_[a-f0-9]{32}$'
    OR capability_token !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_name NOT IN ('plan', 'apply')
    OR pg_catalog.octet_length(apply_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-reference refresh request is invalid';
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
    IF evaluation_timestamp_input <> '' OR apply_payload_json::jsonb <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-reference plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-reference evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF evaluation_clock > pg_catalog.statement_timestamp()
      OR EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock))
        > ${MAXIMUM_PLAN_AGE_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-reference plan expired before apply';
    END IF;
  END IF;
  evaluation_timestamp := pg_catalog.to_char(
    evaluation_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  SELECT MIN(planned.result_json)::jsonb, COUNT(*)
    INTO initial_hosted_plan, initial_hosted_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION)}(
    expected_tenant_id, expected_user_id, target_message_id, capability_token
  ) AS planned;
  IF initial_hosted_plan_count <> 1 OR initial_hosted_plan IS NULL
    OR initial_hosted_plan->>'messageId' <> target_message_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-reference capability validation failed';
  END IF;

  SELECT message.id, message.payload_json, message.payload_hash, message.lease_expires_at
    INTO message_record
  FROM ${relation(manifest.schemaName, "inbox_messages")} AS message
  WHERE message.id = target_message_id
    AND message.tenant_id = resolved_tenant_id
    AND message.user_id = resolved_user_id
    AND message.event_type = '${SIGNAL_INGRESS_EVENT_TYPE}'
    AND message.state = 'processing'
  FOR UPDATE;
  IF NOT FOUND OR initial_hosted_plan->>'payloadHash' <> message_record.payload_hash THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-reference inbox binding is unavailable';
  END IF;

  payload_value := message_record.payload_json::jsonb;
  source_connection_id_value := payload_value->>'sourceConnectionId';
  signal_id_value := payload_value->>'signalId';
  external_event_id_value := payload_value->>'externalEventId';
  transport_hash_value := initial_hosted_plan->'signal'->>'transportHash';
  IF source_connection_id_value = '' OR signal_id_value = '' OR external_event_id_value = ''
    OR transport_hash_value !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-reference normalized identity is invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_source_reference_refresh_event_v1:' || source_connection_id_value || ':' || transport_hash_value,
    0
  ));

  SELECT MIN(planned.result_json)::jsonb, COUNT(*)
    INTO hosted_plan, hosted_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION)}(
    expected_tenant_id, expected_user_id, target_message_id, capability_token
  ) AS planned;
  IF hosted_plan_count <> 1 OR hosted_plan IS NULL
    OR hosted_plan->>'messageId' <> target_message_id
    OR hosted_plan->>'payloadHash' <> message_record.payload_hash
    OR hosted_plan->'signal'->>'signalId' <> signal_id_value
    OR hosted_plan->'signal'->>'externalEventId' <> external_event_id_value
    OR hosted_plan->'signal'->>'transportHash' <> transport_hash_value
    OR hosted_plan->>'validUntil' <= pg_catalog.to_char(
      pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-reference plan changed during serialization';
  END IF;
  IF hosted_plan->>'sharedCatalogMutationRequired' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-reference refresh cannot mutate shared catalog state';
  END IF;
  IF hosted_plan->>'outcome' <> 'duplicate'
    OR COALESCE(hosted_plan->>'duplicateEventId', '') !~ '^signal_event_[a-f0-9]{32}$'
    OR hosted_plan->'resolution' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal event and resolution must commit before source-reference refresh';
  END IF;

  valid_until_timestamp := pg_catalog.to_char(
    LEAST(
      evaluation_clock + INTERVAL '${MAXIMUM_PLAN_AGE_SECONDS} seconds',
      message_record.lease_expires_at::timestamptz
    ) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  IF valid_until_timestamp <= pg_catalog.to_char(
      pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-reference inbox capability expired';
  END IF;

  SELECT event.id, event.source_connection_id, event.signal_id,
         event.external_event_id, event.transport_hash, event.test,
         event.observed_at, event.identity_json, event.resolution_status
    INTO event_record
  FROM ${relation(manifest.schemaName, "signal_events")} AS event
  WHERE event.id = hosted_plan->>'duplicateEventId'
    AND event.tenant_id = resolved_tenant_id
    AND event.user_id = resolved_user_id
    AND event.source_connection_id = source_connection_id_value
    AND event.signal_id = signal_id_value
    AND event.external_event_id = external_event_id_value
    AND event.transport_hash = transport_hash_value
    AND event.source = 'trackalacker'
  FOR SHARE;
  IF NOT FOUND OR event_record.identity_json::jsonb IS DISTINCT FROM payload_value->'identity' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'committed signal event does not match the leased payload';
  END IF;

  SELECT decision.id, decision.status, decision.variant_id, decision.listing_id
    INTO resolution_record
  FROM ${relation(manifest.schemaName, "resolution_decisions")} AS decision
  WHERE decision.event_id = event_record.id
  FOR SHARE;
  IF NOT FOUND OR resolution_record.id !~ '^resolution_[a-f0-9]{32}$'
    OR resolution_record.status <> event_record.resolution_status
    OR resolution_record.status NOT IN ('matched', 'ambiguous', 'unresolved') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'committed resolution decision is unavailable or inconsistent';
  END IF;

  resolution_status_value := resolution_record.status;
  IF resolution_status_value = 'matched' THEN
    listing_id_value := COALESCE(resolution_record.listing_id, '');
    variant_id_value := COALESCE(resolution_record.variant_id, '');
    IF listing_id_value = '' OR variant_id_value = '' THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'matched resolution has no exact catalog target';
    END IF;
    SELECT listing.variant_id INTO listing_variant_id
    FROM ${relation(manifest.schemaName, "listings")} AS listing
    WHERE listing.id = listing_id_value;
    IF NOT FOUND OR listing_variant_id <> variant_id_value THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'matched resolution catalog target changed';
    END IF;
  ELSIF resolution_record.listing_id IS NOT NULL OR resolution_record.variant_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'unmatched resolution unexpectedly names catalog state';
  END IF;

  identity_value := payload_value->'identity';
  IF pg_catalog.jsonb_typeof(identity_value) <> 'object'
    OR pg_catalog.jsonb_typeof(identity_value->'globalIdentifiers') <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-reference identity shape is invalid';
  END IF;
  source_product_id_value := COALESCE(identity_value->>'sourceProductId', '');
  source_listing_id_value := COALESCE(identity_value->>'sourceListingId', '');
  source_title_value := COALESCE(identity_value->>'title', '');
  source_alias_value := pg_catalog.lower(
    COALESCE(identity_value->'globalIdentifiers'->>'trackalacker_slug', '')
  );
  IF source_alias_value <> '' THEN
    source_alias_kind_value := 'trackalacker_slug';
  END IF;
  IF pg_catalog.length(source_product_id_value) > 120
    OR source_product_id_value <> pg_catalog.btrim(source_product_id_value)
    OR source_product_id_value ~ '[[:cntrl:]]'
    OR pg_catalog.length(source_listing_id_value) > 120
    OR source_listing_id_value <> pg_catalog.btrim(source_listing_id_value)
    OR source_listing_id_value ~ '[[:cntrl:]]'
    OR pg_catalog.length(source_alias_value) > 100
    OR source_alias_value <> pg_catalog.btrim(source_alias_value)
    OR source_alias_value ~ '[[:cntrl:]]'
    OR pg_catalog.length(source_title_value) > 300
    OR source_title_value <> pg_catalog.btrim(source_title_value)
    OR source_title_value ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-reference identity values are invalid';
  END IF;

  reference_identity_input :=
    pg_catalog.octet_length(source_product_id_value)::text || ':' || source_product_id_value || '|' ||
    pg_catalog.octet_length(source_listing_id_value)::text || ':' || source_listing_id_value || '|' ||
    pg_catalog.octet_length(source_alias_kind_value)::text || ':' || source_alias_kind_value || '|' ||
    pg_catalog.octet_length(source_alias_value)::text || ':' || source_alias_value || '|';
  reference_identity_hash_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(reference_identity_input, 'UTF8')), 'hex'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_source_reference_refresh_identity_v1:' ||
      source_connection_id_value || ':' || reference_identity_hash_value,
    0
  ));

  IF event_record.test <> 0 THEN
    outcome_value := 'test_signal';
  ELSIF resolution_status_value <> 'matched' THEN
    outcome_value := 'not_matched';
  ELSIF source_product_id_value = '' AND source_listing_id_value = ''
    AND source_alias_value = '' THEN
    outcome_value := 'no_reference_identity';
  ELSE
    IF source_product_id_value <> '' THEN
      SELECT COUNT(*), COALESCE(MIN(reference.id), ''),
             COALESCE(MIN(reference.variant_id), ''),
             COALESCE(MIN(reference.source_title), ''),
             COALESCE(MIN(reference.observed_at), '')
        INTO product_ref_count, product_ref_id_value, product_ref_variant_id,
             product_ref_source_title, product_ref_observed_at
      FROM ${relation(manifest.schemaName, "source_product_refs")} AS reference
      WHERE reference.source_connection_id = source_connection_id_value
        AND reference.external_product_id = source_product_id_value;
      IF product_ref_count > 1
        OR (product_ref_count = 1 AND product_ref_variant_id <> variant_id_value) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'source product reference conflicts with the committed variant';
      END IF;
      IF product_ref_count = 0 THEN
        source_product_action_value := 'insert';
      ELSIF product_ref_observed_at::timestamptz < event_record.observed_at::timestamptz
        OR (
          product_ref_observed_at::timestamptz = event_record.observed_at::timestamptz
          AND source_title_value <> ''
          AND product_ref_source_title <> source_title_value
        ) THEN
        source_product_action_value := 'update';
      END IF;
    END IF;

    IF source_listing_id_value <> '' THEN
      SELECT COUNT(*), COALESCE(MIN(reference.id), ''),
             COALESCE(MIN(reference.listing_id), ''),
             COALESCE(MIN(reference.external_product_id), ''),
             COALESCE(MIN(reference.observed_at), '')
        INTO listing_ref_count, listing_ref_id_value, listing_ref_listing_id,
             listing_ref_external_product_id, listing_ref_observed_at
      FROM ${relation(manifest.schemaName, "source_listing_refs")} AS reference
      WHERE reference.source_connection_id = source_connection_id_value
        AND reference.external_listing_id = source_listing_id_value;
      IF listing_ref_count > 1
        OR (listing_ref_count = 1 AND listing_ref_listing_id <> listing_id_value) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'source listing reference conflicts with the committed listing';
      END IF;
      IF listing_ref_count = 0 THEN
        source_listing_action_value := 'insert';
      ELSIF listing_ref_observed_at::timestamptz < event_record.observed_at::timestamptz
        OR (
          listing_ref_observed_at::timestamptz = event_record.observed_at::timestamptz
          AND source_product_id_value <> ''
          AND listing_ref_external_product_id <> source_product_id_value
        ) THEN
        source_listing_action_value := 'update';
      END IF;
    END IF;

    IF source_alias_value <> '' THEN
      SELECT COUNT(*), COALESCE(MIN(alias.id), ''),
             COALESCE(MIN(alias.variant_id), ''),
             COALESCE(MIN(alias.observed_at), '')
        INTO alias_ref_count, alias_ref_id_value, alias_ref_variant_id,
             alias_ref_observed_at
      FROM ${relation(manifest.schemaName, "source_product_aliases")} AS alias
      WHERE alias.source_connection_id = source_connection_id_value
        AND alias.alias_kind = source_alias_kind_value
        AND alias.alias_value = source_alias_value;
      IF alias_ref_count > 1
        OR (alias_ref_count = 1 AND alias_ref_variant_id <> variant_id_value) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'source product alias conflicts with the committed variant';
      END IF;
      IF alias_ref_count = 0 THEN
        source_alias_action_value := 'insert';
      ELSIF alias_ref_observed_at::timestamptz < event_record.observed_at::timestamptz THEN
        source_alias_action_value := 'update';
      END IF;
    END IF;

    mutation_statement_count :=
      CASE WHEN source_product_action_value <> 'none' THEN 1 ELSE 0 END
      + CASE WHEN source_listing_action_value <> 'none' THEN 1 ELSE 0 END
      + CASE WHEN source_alias_action_value <> 'none' THEN 1 ELSE 0 END;
    outcome_value := CASE
      WHEN mutation_statement_count > 0 THEN 'refresh'
      ELSE 'already_current'
    END;
  END IF;

  plan_input := ${planParts};
  plan_fingerprint_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(plan_input, 'UTF8')), 'hex'
  );
  plan_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_record.id,
    'payloadHash', message_record.payload_hash,
    'evaluatedAt', evaluation_timestamp,
    'validUntil', valid_until_timestamp,
    'eventId', event_record.id,
    'resolutionDecisionId', resolution_record.id,
    'resolutionStatus', resolution_status_value,
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'referenceIdentityHash', reference_identity_hash_value,
    'outcome', outcome_value,
    'sourceProductAction', source_product_action_value,
    'sourceListingAction', source_listing_action_value,
    'sourceAliasAction', source_alias_action_value,
    'mutationStatementCount', mutation_statement_count,
    'sourceReferenceRefreshWillApply', mutation_statement_count > 0,
    'sharedCatalogMutation', FALSE,
    'rawSignalPayloadReturned', FALSE,
    'planFingerprint', plan_fingerprint_value
  );
  IF operation_name = 'plan' THEN
    RETURN QUERY SELECT plan_value::text;
    RETURN;
  END IF;

  apply_payload := apply_payload_json::jsonb;
  IF pg_catalog.jsonb_typeof(apply_payload) <> 'object'
    OR apply_payload - ARRAY['planFingerprint']::text[] IS DISTINCT FROM '{}'::jsonb
    OR pg_catalog.jsonb_typeof(apply_payload->'planFingerprint') IS DISTINCT FROM 'string'
    OR apply_payload->>'planFingerprint' <> plan_fingerprint_value THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-reference apply payload does not match its current plan';
  END IF;

  IF source_product_action_value = 'insert' THEN
    INSERT INTO ${relation(manifest.schemaName, "source_product_refs")}(
      id, source_connection_id, external_product_id, variant_id,
      source_url, source_title, observed_at
    ) VALUES (
      'source_product_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      source_connection_id_value, source_product_id_value, variant_id_value,
      '', source_title_value, event_record.observed_at
    );
  ELSIF source_product_action_value = 'update' THEN
    UPDATE ${relation(manifest.schemaName, "source_product_refs")}
    SET source_title = CASE
          WHEN source_title_value <> '' THEN source_title_value
          ELSE source_title
        END,
        observed_at = event_record.observed_at
    WHERE id = product_ref_id_value
      AND source_connection_id = source_connection_id_value
      AND variant_id = variant_id_value;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    IF affected_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'source product reference changed before apply';
    END IF;
  END IF;

  IF source_listing_action_value = 'insert' THEN
    INSERT INTO ${relation(manifest.schemaName, "source_listing_refs")}(
      id, source_connection_id, external_listing_id, external_product_id,
      listing_id, source_url, observed_at
    ) VALUES (
      'source_listing_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      source_connection_id_value, source_listing_id_value, source_product_id_value,
      listing_id_value, '', event_record.observed_at
    );
  ELSIF source_listing_action_value = 'update' THEN
    UPDATE ${relation(manifest.schemaName, "source_listing_refs")}
    SET external_product_id = CASE
          WHEN source_product_id_value <> '' THEN source_product_id_value
          ELSE external_product_id
        END,
        observed_at = event_record.observed_at
    WHERE id = listing_ref_id_value
      AND source_connection_id = source_connection_id_value
      AND listing_id = listing_id_value;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    IF affected_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'source listing reference changed before apply';
    END IF;
  END IF;

  IF source_alias_action_value = 'insert' THEN
    INSERT INTO ${relation(manifest.schemaName, "source_product_aliases")}(
      id, source_connection_id, alias_kind, alias_value, variant_id, observed_at
    ) VALUES (
      'source_alias_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      source_connection_id_value, source_alias_kind_value, source_alias_value,
      variant_id_value, event_record.observed_at
    );
  ELSIF source_alias_action_value = 'update' THEN
    UPDATE ${relation(manifest.schemaName, "source_product_aliases")}
    SET observed_at = event_record.observed_at
    WHERE id = alias_ref_id_value
      AND source_connection_id = source_connection_id_value
      AND variant_id = variant_id_value;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    IF affected_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'source product alias changed before apply';
    END IF;
  END IF;

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_record.id,
    'planFingerprint', plan_fingerprint_value,
    'eventId', event_record.id,
    'resolutionDecisionId', resolution_record.id,
    'outcome', outcome_value,
    'sourceProductAction', source_product_action_value,
    'sourceListingAction', source_listing_action_value,
    'sourceAliasAction', source_alias_action_value,
    'mutationStatementCount', mutation_statement_count,
    'sourceReferenceRefreshApplied', mutation_statement_count > 0,
    'mutationAuthority', TRUE,
    'idempotentReplay', TRUE,
    'sharedCatalogMutated', FALSE,
    'downstreamSignalGraphMutated', FALSE,
    'inboxLifecycleMutated', FALSE,
    'rawSignalPayloadReturned', FALSE
  )::text;
END
`;
}

export function buildPostgresSignalSourceReferenceRefreshManifest(
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
  requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification",
  requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification",
  requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification",
  requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification",
  requestedSourceReferenceRefreshRoleNamespace = "yoink_ref_qualification"
): PostgresSignalSourceReferenceRefreshManifest {
  const values = [
    safeSchema(requestedSchema),
    safeNamespace(requestedReadRoleNamespace, "yoink_qualification"),
    safeNamespace(requestedSessionRoleNamespace, "yoink_session_qualification"),
    safeNamespace(requestedQueueWriteRoleNamespace, "yoink_queue_write_qualification"),
    safeNamespace(requestedControlRoleNamespace, "yoink_control_qualification"),
    safeNamespace(requestedNotificationRecoveryRoleNamespace, "yoink_notify_qualification"),
    safeNamespace(requestedExecutionRecoveryRoleNamespace, "yoink_execute_qualification"),
    safeNamespace(requestedOperationalRetentionRoleNamespace, "yoink_retention_qualification"),
    safeNamespace(requestedObserverCandidateRoleNamespace, "yoink_candidate_qualification"),
    safeNamespace(requestedAlertDispatchRoleNamespace, "yoink_dispatch_qualification"),
    safeNamespace(requestedAlertReconciliationRoleNamespace, "yoink_reconcile_qualification"),
    safeNamespace(requestedWitnessRefreshRoleNamespace, "yoink_witness_qualification"),
    safeNamespace(requestedLeaseRecoveryRoleNamespace, "yoink_delivery_qualification"),
    safeNamespace(requestedCatalogApplyRoleNamespace, "yoink_catalog_qualification"),
    safeNamespace(requestedResolutionApplyRoleNamespace, "yoink_resolution_qualification"),
    safeNamespace(requestedSourceReferenceRefreshRoleNamespace, "yoink_ref_qualification")
  ] as const;
  const [schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace, resolutionApplyRoleNamespace,
    sourceReferenceRefreshRoleNamespace] = values;
  if (new Set(values.slice(1)).size !== values.length - 1) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role namespace must be independent."
    );
  }
  const previous = buildPostgresSignalResolutionApplyManifest(
    schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace, resolutionApplyRoleNamespace
  );
  const withoutFingerprint: Omit<PostgresSignalSourceReferenceRefreshManifest, "fingerprint"> = {
    contractVersion: POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    hostedDeliveryContractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
    catalogApplyContractVersion: POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
    resolutionApplyContractVersion: POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION,
    schemaName,
    readRoleNamespace,
    sessionRoleNamespace,
    queueWriteRoleNamespace,
    controlRoleNamespace,
    notificationRecoveryRoleNamespace,
    executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace,
    observerCandidateRoleNamespace,
    alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace,
    witnessRefreshRoleNamespace,
    leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace,
    resolutionApplyRoleNamespace,
    sourceReferenceRefreshRoleNamespace,
    resolutionApplyManifestFingerprint: previous.fingerprint,
    sourceReferenceRefreshRole: {
      kind: "signal_source_reference_refresh_boundary",
      name: roleName(sourceReferenceRefreshRoleNamespace),
      functionName: POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTenantTableCount: 7,
    forcedRlsTableCount: 7,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    committedResolutionBinding: true,
    matchedResolutionRequired: true,
    testSignalMutation: false,
    conflictingReferenceFailClosed: true,
    idempotentReplay: true,
    sourceProductReferenceRepositoryParity: true,
    sourceListingReferenceRepositoryParity: true,
    sourceProductAliasRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceRefreshRepositoryParity: true,
    downstreamSignalGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    mutationAuthority: true,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresSignalSourceReferenceRefreshCapabilityProjection():
PostgresSignalSourceReferenceRefreshCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalSourceReferenceRefreshManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    catalogApplyContractVersion: 1,
    resolutionApplyContractVersion: 1,
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
    databasePlanRevalidation: true,
    twoPhasePlanApply: true,
    readCommittedTransactionAdapter: true,
    committedResolutionBinding: true,
    matchedResolutionRequired: true,
    testSignalMutation: false,
    conflictingReferenceFailClosed: true,
    idempotentReplay: true,
    sourceProductReferenceRepositoryParity: true,
    sourceListingReferenceRepositoryParity: true,
    sourceProductAliasRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceRefreshRepositoryParity: true,
    downstreamSignalGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    maximumPlanAgeSeconds: 30,
    protectedTenantTableCount: 7,
    forcedRlsTableCount: 7,
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

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresSignalSourceReferenceRefreshManifest
): Promise<BoundaryInspection> {
  const role = manifest.sourceReferenceRefreshRole.name;
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [role]
  );
  const roleRow = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !roleRow || roleRow.rolname !== role
    || roleRow.rolsuper || roleRow.rolinherit || roleRow.rolcreaterole
    || roleRow.rolcreatedb || roleRow.rolcanlogin || roleRow.rolreplication
    || roleRow.rolbypassrls) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role attributes are unsafe."
    );
  }

  const memberships = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
     WHERE member_role.rolname = $1 OR granted_role.rolname = $1`,
    [role]
  );
  if (exactInteger(memberships.rows[0]?.count, "membership count") !== 0) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role must have no membership."
    );
  }

  const directGrants = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM information_schema.role_table_grants
       WHERE grantee = $1 AND table_schema = $2
     ) + (
       SELECT COUNT(*) FROM information_schema.role_column_grants
       WHERE grantee = $1 AND table_schema = $2
     ) AS count`,
    [role, manifest.schemaName]
  );
  if (exactInteger(directGrants.rows[0]?.count, "direct grant count") !== 0) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role has a direct table or column grant."
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
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role has an unauthorized effective table privilege."
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
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role has an invalid schema privilege."
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
    || routine.routineName !== POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role || routine.source !== signalSourceReferenceRefreshFunctionSource(manifest)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference function boundary is incomplete."
    );
  }
  const routineAcl = await session.query<RoutineAclRow>(
    `SELECT COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee,
            access.privilege_type AS "privilegeType",
            access.is_grantable AS grantable
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
      && row.privilegeType === "EXECUTE" && row.grantable === false)
    || !routineAcl.rows.some((row) => row.grantee === routine.ownerName
      && row.privilegeType === "EXECUTE" && row.grantable === false)
    || routineAcl.rows.some((row) => row.grantee === "PUBLIC")) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference function grant is not exact."
    );
  }

  const protectedTables = await session.query<{
    tableName: string;
    enabled: boolean;
    forced: boolean;
  }>(
    `SELECT relation.relname AS "tableName", relation.relrowsecurity AS enabled,
            relation.relforcerowsecurity AS forced
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relname = ANY($2::text[])
     ORDER BY relation.relname`,
    [manifest.schemaName, [...PROTECTED_TENANT_TABLES]]
  );
  if (protectedTables.rows.length !== PROTECTED_TENANT_TABLES.length
    || protectedTables.rows.some((row) => !row.enabled || !row.forced)
    || protectedTables.rows.map((row) => row.tableName).join(",")
      !== [...PROTECTED_TENANT_TABLES].sort().join(",")) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference protected table set is incomplete."
    );
  }
  const mutationTables = protectedTables.rows.filter((row) =>
    (MUTATION_TABLES as readonly string[]).includes(row.tableName)
  );
  if (mutationTables.map((row) => row.tableName).join(",")
    !== [...MUTATION_TABLES].sort().join(",")) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference mutation table set is incomplete."
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
  if (exactInteger(accessibleSequences.rows[0]?.count, "sequence count") !== 0) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role must not access application sequences."
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
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role must not own application objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference role must not depend on a direct table policy."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  if (exactInteger(principals.rows[0]?.count, "active principal count") !== 0) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "Signal-source-reference qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTenantTableCount: protectedTables.rows.length,
    forcedRlsTableCount: protectedTables.rows.filter((row) => row.forced).length,
    mutationTableCount: mutationTables.length,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryCatalogFingerprint: fingerprint({
      role: roleRow,
      routine,
      routineAcl: routineAcl.rows,
      protectedTables: protectedTables.rows,
      mutationTables
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresSignalSourceReferenceRefreshManifest
): PostgresSignalSourceReferenceRefreshQualificationReceipt {
  if (row.phase !== "verified"
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.resolution_apply_manifest_fingerprint !== manifest.resolutionApplyManifestFingerprint
    || row.source_reference_refresh_role_name !== manifest.sourceReferenceRefreshRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.server_bound_principal_lookup !== true
    || row.database_plan_revalidation !== true
    || row.committed_resolution_binding !== true
    || row.matched_resolution_required !== true
    || row.test_signal_mutation !== false
    || row.conflicting_reference_fail_closed !== true
    || row.idempotent_replay !== true
    || row.source_product_reference_repository_parity !== true
    || row.source_listing_reference_repository_parity !== true
    || row.source_product_alias_repository_parity !== true
    || row.shared_catalog_mutation !== false
    || row.source_reference_refresh_repository_parity !== true
    || row.downstream_signal_graph_mutation !== false
    || row.inbox_lifecycle_mutation !== false
    || row.raw_signal_payload_returned !== false
    || row.signal_evaluation_apply_repository_parity !== false
    || row.hosted_delivery_handler_repository_parity !== false
    || row.mutation_authority !== true
    || row.direct_table_access !== false
    || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference receipt is incomplete or unsafe."
    );
  }
  const counts = [
    [row.contract_version, 1, "contract version"],
    [row.cutover_contract_version, 3, "cutover contract version"],
    [row.hosted_delivery_contract_version, 3, "hosted-delivery contract version"],
    [row.catalog_apply_contract_version, 1, "catalog-apply contract version"],
    [row.resolution_apply_contract_version, 1, "resolution-apply contract version"],
    [row.protected_tenant_table_count, 7, "protected table count"],
    [row.forced_rls_table_count, 7, "forced RLS table count"],
    [row.mutation_table_count, 3, "mutation table count"],
    [row.direct_table_grant_count, 0, "direct grant count"],
    [row.function_grant_count, 1, "function grant count"],
    [row.membership_count, 0, "membership count"],
    [row.active_principal_count, 0, "active principal count"],
    [row.maximum_plan_age_seconds, 30, "plan age"]
  ] as const;
  for (const [value, expected, label] of counts) {
    if (exactInteger(value, label) !== expected) {
      throw new PostgresSignalSourceReferenceRefreshQualificationError(
        "The PostgreSQL signal-source-reference receipt uses an unsupported contract."
      );
    }
  }
  return {
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    catalogApplyContractVersion: 1,
    resolutionApplyContractVersion: 1,
    phase: "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: manifest.fingerprint,
    resolutionApplyManifestFingerprint: manifest.resolutionApplyManifestFingerprint,
    sourceReferenceRefreshRoleName: manifest.sourceReferenceRefreshRole.name,
    protectedTenantTableCount: 7,
    forcedRlsTableCount: 7,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    committedResolutionBinding: true,
    matchedResolutionRequired: true,
    testSignalMutation: false,
    conflictingReferenceFailClosed: true,
    idempotentReplay: true,
    sourceProductReferenceRepositoryParity: true,
    sourceListingReferenceRepositoryParity: true,
    sourceProductAliasRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceRefreshRepositoryParity: true,
    downstreamSignalGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    mutationAuthority: true,
    directTableAccess: false,
    runtimeAuthority: false,
    productionReady: false,
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    appliedAt: exactTimestamp(row.applied_at, "application timestamp"),
    verifiedAt: exactTimestamp(row.verified_at, "verification timestamp")
  };
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresSignalSourceReferenceRefreshManifest
): Promise<PostgresSignalSourceReferenceRefreshQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresSignalSourceReferenceRefreshQualificationReceipt,
  manifest: PostgresSignalSourceReferenceRefreshManifest
): void {
  if (inspection.protectedTenantTableCount !== receipt.protectedTenantTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.mutationTableCount !== receipt.mutationTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresSignalSourceReferenceRefreshBoundary(
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
  requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification",
  requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification",
  requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification",
  requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification",
  requestedSourceReferenceRefreshRoleNamespace = "yoink_ref_qualification"
): Promise<PostgresSignalSourceReferenceRefreshQualificationReceipt> {
  const manifest = buildPostgresSignalSourceReferenceRefreshManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
    requestedSourceReferenceRefreshRoleNamespace
  );
  await verifyPostgresSignalResolutionApplyBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace, manifest.resolutionApplyRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresSignalSourceReferenceRefreshBoundary(
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
  requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification",
  requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification",
  requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification",
  requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification",
  requestedSourceReferenceRefreshRoleNamespace = "yoink_ref_qualification",
  now = Date.now()
): Promise<PostgresSignalSourceReferenceRefreshQualificationReceipt> {
  if (!Number.isSafeInteger(now)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference qualification timestamp is invalid."
    );
  }
  const manifest = buildPostgresSignalSourceReferenceRefreshManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
    requestedSourceReferenceRefreshRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "Signal-source-reference qualification requires the supported cutover role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "Signal-source-reference qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresSignalResolutionApplyBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace, manifest.resolutionApplyRoleNamespace
  );
  const appliedAt = nowIso(now);
  return database.transaction(async (session) => {
    const existing = await session.query<{ count: string | number | bigint }>(
      `SELECT (
         SELECT COUNT(*) FROM pg_catalog.pg_roles WHERE rolname = $1
       ) + (
         SELECT COUNT(*) FROM pg_catalog.pg_class object
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace
         WHERE namespace.nspname = $2 AND object.relname = $3
       ) + (
         SELECT COUNT(*) FROM pg_catalog.pg_proc routine
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
         WHERE namespace.nspname = $2 AND routine.proname = ANY($4::text[])
       ) AS count`,
      [
        manifest.sourceReferenceRefreshRole.name,
        manifest.schemaName,
        POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_RECEIPT_TABLE,
        [POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION, "yoink_guard_signal_source_reference_refresh_receipt"]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing object count") !== 0) {
      throw new PostgresSignalSourceReferenceRefreshQualificationError(
        "Signal-source-reference qualification refuses an existing role, function, guard, or receipt."
      );
    }
    await session.query(
      `CREATE ROLE ${identifier(manifest.sourceReferenceRefreshRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.sourceReferenceRefreshRole.name)}`
    );
    for (const table of PROTECTED_TENANT_TABLES) {
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`);
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`);
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
         target_message_id TEXT, capability_token TEXT,
         evaluation_timestamp_input TEXT, apply_payload_json TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${signalSourceReferenceRefreshFunctionSource(manifest)}$yoink$`
    );
    const signature = `${relation(
      manifest.schemaName,
      POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION
    )}(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)`;
    await session.query(`REVOKE ALL PRIVILEGES ON FUNCTION ${signature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier(manifest.sourceReferenceRefreshRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         hosted_delivery_contract_version BIGINT NOT NULL CHECK (hosted_delivery_contract_version = 3),
         catalog_apply_contract_version BIGINT NOT NULL CHECK (catalog_apply_contract_version = 1),
         resolution_apply_contract_version BIGINT NOT NULL CHECK (resolution_apply_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
         role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         resolution_apply_manifest_fingerprint TEXT NOT NULL CHECK (resolution_apply_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         source_reference_refresh_role_name TEXT NOT NULL,
         protected_tenant_table_count BIGINT NOT NULL CHECK (protected_tenant_table_count = 7),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 7),
         mutation_table_count BIGINT NOT NULL CHECK (mutation_table_count = 3),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         maximum_plan_age_seconds BIGINT NOT NULL CHECK (maximum_plan_age_seconds = 30),
         server_bound_principal_lookup BOOLEAN NOT NULL CHECK (server_bound_principal_lookup = TRUE),
         database_plan_revalidation BOOLEAN NOT NULL CHECK (database_plan_revalidation = TRUE),
         committed_resolution_binding BOOLEAN NOT NULL CHECK (committed_resolution_binding = TRUE),
         matched_resolution_required BOOLEAN NOT NULL CHECK (matched_resolution_required = TRUE),
         test_signal_mutation BOOLEAN NOT NULL CHECK (test_signal_mutation = FALSE),
         conflicting_reference_fail_closed BOOLEAN NOT NULL CHECK (conflicting_reference_fail_closed = TRUE),
         idempotent_replay BOOLEAN NOT NULL CHECK (idempotent_replay = TRUE),
         source_product_reference_repository_parity BOOLEAN NOT NULL CHECK (source_product_reference_repository_parity = TRUE),
         source_listing_reference_repository_parity BOOLEAN NOT NULL CHECK (source_listing_reference_repository_parity = TRUE),
         source_product_alias_repository_parity BOOLEAN NOT NULL CHECK (source_product_alias_repository_parity = TRUE),
         shared_catalog_mutation BOOLEAN NOT NULL CHECK (shared_catalog_mutation = FALSE),
         source_reference_refresh_repository_parity BOOLEAN NOT NULL CHECK (source_reference_refresh_repository_parity = TRUE),
         downstream_signal_graph_mutation BOOLEAN NOT NULL CHECK (downstream_signal_graph_mutation = FALSE),
         inbox_lifecycle_mutation BOOLEAN NOT NULL CHECK (inbox_lifecycle_mutation = FALSE),
         raw_signal_payload_returned BOOLEAN NOT NULL CHECK (raw_signal_payload_returned = FALSE),
         signal_evaluation_apply_repository_parity BOOLEAN NOT NULL CHECK (signal_evaluation_apply_repository_parity = FALSE),
         hosted_delivery_handler_repository_parity BOOLEAN NOT NULL CHECK (hosted_delivery_handler_repository_parity = FALSE),
         mutation_authority BOOLEAN NOT NULL CHECK (mutation_authority = TRUE),
         direct_table_access BOOLEAN NOT NULL CHECK (direct_table_access = FALSE),
         runtime_authority BOOLEAN NOT NULL CHECK (runtime_authority = FALSE),
         production_ready BOOLEAN NOT NULL CHECK (production_ready = FALSE),
         boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
         applied_at TEXT NOT NULL,
         verified_at TEXT NOT NULL
       )`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON TABLE
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_RECEIPT_TABLE)} FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_RECEIPT_TABLE)}(
         singleton, contract_version, cutover_contract_version,
         hosted_delivery_contract_version, catalog_apply_contract_version,
         resolution_apply_contract_version, phase, role_manifest_fingerprint,
         resolution_apply_manifest_fingerprint,
         source_reference_refresh_role_name, protected_tenant_table_count,
         forced_rls_table_count, mutation_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         maximum_plan_age_seconds, server_bound_principal_lookup,
         database_plan_revalidation, committed_resolution_binding,
         matched_resolution_required, test_signal_mutation,
         conflicting_reference_fail_closed, idempotent_replay,
         source_product_reference_repository_parity,
         source_listing_reference_repository_parity,
         source_product_alias_repository_parity, shared_catalog_mutation,
         source_reference_refresh_repository_parity,
         downstream_signal_graph_mutation, inbox_lifecycle_mutation,
         raw_signal_payload_returned, signal_evaluation_apply_repository_parity,
         hosted_delivery_handler_repository_parity, mutation_authority,
         direct_table_access, runtime_authority, production_ready,
         boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 3, 1, 1, 'loading', $1, $2, $3,
         7, 7, 3, 0, 1, 0, 0, 30,
         TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, TRUE,
         TRUE, TRUE, TRUE, FALSE, TRUE,
         FALSE, FALSE, FALSE, FALSE, FALSE,
         TRUE, FALSE, FALSE, FALSE, repeat('0', 64), $4, ''
       )`,
      [
        manifest.fingerprint,
        manifest.resolutionApplyManifestFingerprint,
        manifest.sourceReferenceRefreshRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_RECEIPT_TABLE)}
       SET phase = 'verified', boundary_catalog_fingerprint = $1, verified_at = $2
       WHERE singleton = TRUE AND phase = 'loading'`,
      [inspection.boundaryCatalogFingerprint, verifiedAt]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_signal_source_reference_refresh_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal-source-reference receipt is immutable';
       END
       $guard$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_source_reference_refresh_receipt")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_signal_source_reference_refresh_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_source_reference_refresh_receipt")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

function exactObject(
  value: unknown,
  label: string,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} has an unexpected shape.`
    );
  }
  return record;
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? "")) as unknown;
  } catch {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is not valid JSON.`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is invalid.`
    );
  }
  return parsed as Record<string, unknown>;
}

function referenceAction(value: unknown, label: string): ReferenceAction {
  const action = exactText(value, label, 10) as ReferenceAction;
  if (!new Set<ReferenceAction>(["none", "insert", "update"]).has(action)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      `The PostgreSQL signal-source-reference ${label} is invalid.`
    );
  }
  return action;
}

function parsePlan(
  value: Record<string, unknown>,
  principal: BackgroundWorkerPrincipal,
  messageId: string,
  now: number
): PostgresSignalSourceReferenceRefreshPlan {
  const record = exactObject(value, "plan", [
    "contractVersion", "messageId", "payloadHash", "evaluatedAt", "validUntil",
    "eventId", "resolutionDecisionId", "resolutionStatus", "listingId",
    "variantId", "referenceIdentityHash", "outcome", "sourceProductAction",
    "sourceListingAction", "sourceAliasAction", "mutationStatementCount",
    "sourceReferenceRefreshWillApply", "sharedCatalogMutation",
    "rawSignalPayloadReturned", "planFingerprint"
  ]);
  if (exactInteger(record.contractVersion, "plan contract version") !== 1
    || record.messageId !== messageId) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference plan identity is invalid."
    );
  }
  const evaluatedAt = exactTimestamp(record.evaluatedAt, "evaluation timestamp");
  const validUntil = exactTimestamp(record.validUntil, "expiry timestamp");
  if (Math.abs(now - Date.parse(evaluatedAt)) > MAXIMUM_CLOCK_SKEW_MS
    || Date.parse(validUntil) <= Date.now()
    || Date.parse(validUntil) <= Date.parse(evaluatedAt)
    || Date.parse(validUntil) - Date.parse(evaluatedAt) > MAXIMUM_PLAN_AGE_SECONDS * 1_000) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference plan lifetime is invalid."
    );
  }
  const resolutionStatus = exactText(
    record.resolutionStatus,
    "resolution status",
    20
  ) as PostgresSignalSourceReferenceRefreshPlan["resolutionStatus"];
  if (!new Set(["matched", "ambiguous", "unresolved"]).has(resolutionStatus)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference resolution status is invalid."
    );
  }
  const listingId = exactText(record.listingId, "listing ID", 200, resolutionStatus !== "matched");
  const variantId = exactText(record.variantId, "variant ID", 200, resolutionStatus !== "matched");
  if ((resolutionStatus === "matched" && (!listingId || !variantId))
    || (resolutionStatus !== "matched" && (listingId !== "" || variantId !== ""))) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference catalog binding is inconsistent."
    );
  }
  const outcome = exactText(record.outcome, "outcome", 30) as RefreshOutcome;
  if (!new Set<RefreshOutcome>([
    "refresh", "already_current", "no_reference_identity", "not_matched", "test_signal"
  ]).has(outcome)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference plan outcome is invalid."
    );
  }
  const sourceProductAction = referenceAction(record.sourceProductAction, "source-product action");
  const sourceListingAction = referenceAction(record.sourceListingAction, "source-listing action");
  const sourceAliasAction = referenceAction(record.sourceAliasAction, "source-alias action");
  const mutationStatementCount = exactInteger(
    record.mutationStatementCount,
    "mutation statement count"
  );
  const calculatedMutationCount = [
    sourceProductAction, sourceListingAction, sourceAliasAction
  ].filter((action) => action !== "none").length;
  const willApply = outcome === "refresh";
  if (mutationStatementCount !== calculatedMutationCount
    || mutationStatementCount > 3
    || willApply !== (mutationStatementCount > 0)
    || (!willApply && calculatedMutationCount !== 0)
    || (outcome === "not_matched" && resolutionStatus === "matched")
    || (["refresh", "already_current", "no_reference_identity"].includes(outcome)
      && resolutionStatus !== "matched")) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference mutation plan is inconsistent."
    );
  }
  const plan: PostgresSignalSourceReferenceRefreshPlan = {
    contractVersion: 1,
    messageId,
    payloadHash: exactHash(record.payloadHash, "payload hash"),
    evaluatedAt,
    validUntil,
    eventId: exactText(record.eventId, "event ID", 200),
    resolutionDecisionId: exactText(record.resolutionDecisionId, "resolution decision ID", 200),
    resolutionStatus,
    listingId,
    variantId,
    referenceIdentityHash: exactHash(record.referenceIdentityHash, "reference identity hash"),
    outcome,
    sourceProductAction,
    sourceListingAction,
    sourceAliasAction,
    mutationStatementCount,
    sourceReferenceRefreshWillApply: exactBoolean(
      record.sourceReferenceRefreshWillApply,
      willApply,
      "refresh flag"
    ),
    sharedCatalogMutation: exactBoolean(
      record.sharedCatalogMutation,
      false,
      "shared-catalog flag"
    ) as false,
    rawSignalPayloadReturned: exactBoolean(
      record.rawSignalPayloadReturned,
      false,
      "raw payload flag"
    ) as false,
    planFingerprint: exactHash(record.planFingerprint, "plan fingerprint")
  };
  if (!EVENT_ID.test(plan.eventId) || !RESOLUTION_ID.test(plan.resolutionDecisionId)
    || plan.planFingerprint !== postgresSignalSourceReferenceRefreshPlanFingerprint(principal, plan)) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference plan fingerprint or committed identity is invalid."
    );
  }
  return plan;
}

function parseResult(
  value: Record<string, unknown>,
  plan: PostgresSignalSourceReferenceRefreshPlan
): PostgresSignalSourceReferenceRefreshResult {
  const record = exactObject(value, "apply result", [
    "contractVersion", "messageId", "planFingerprint", "eventId",
    "resolutionDecisionId", "outcome", "sourceProductAction",
    "sourceListingAction", "sourceAliasAction", "mutationStatementCount",
    "sourceReferenceRefreshApplied", "mutationAuthority", "idempotentReplay",
    "sharedCatalogMutated", "downstreamSignalGraphMutated",
    "inboxLifecycleMutated", "rawSignalPayloadReturned"
  ]);
  if (record.messageId !== plan.messageId || record.planFingerprint !== plan.planFingerprint
    || record.eventId !== plan.eventId
    || record.resolutionDecisionId !== plan.resolutionDecisionId
    || record.outcome !== plan.outcome
    || record.sourceProductAction !== plan.sourceProductAction
    || record.sourceListingAction !== plan.sourceListingAction
    || record.sourceAliasAction !== plan.sourceAliasAction
    || exactInteger(record.contractVersion, "result contract version") !== 1
    || exactInteger(record.mutationStatementCount, "result mutation statement count")
      !== plan.mutationStatementCount) {
    throw new PostgresSignalSourceReferenceRefreshQualificationError(
      "The PostgreSQL signal-source-reference apply result changed from its sealed plan."
    );
  }
  return {
    contractVersion: 1,
    messageId: plan.messageId,
    planFingerprint: plan.planFingerprint,
    eventId: plan.eventId,
    resolutionDecisionId: plan.resolutionDecisionId,
    outcome: plan.outcome,
    sourceProductAction: plan.sourceProductAction,
    sourceListingAction: plan.sourceListingAction,
    sourceAliasAction: plan.sourceAliasAction,
    mutationStatementCount: plan.mutationStatementCount,
    sourceReferenceRefreshApplied: exactBoolean(
      record.sourceReferenceRefreshApplied,
      plan.sourceReferenceRefreshWillApply,
      "refresh-applied flag"
    ),
    mutationAuthority: exactBoolean(record.mutationAuthority, true, "authority flag") as true,
    idempotentReplay: exactBoolean(record.idempotentReplay, true, "idempotent flag") as true,
    sharedCatalogMutated: exactBoolean(
      record.sharedCatalogMutated,
      false,
      "shared-catalog mutation flag"
    ) as false,
    downstreamSignalGraphMutated: exactBoolean(
      record.downstreamSignalGraphMutated,
      false,
      "downstream graph flag"
    ) as false,
    inboxLifecycleMutated: exactBoolean(
      record.inboxLifecycleMutated,
      false,
      "inbox lifecycle flag"
    ) as false,
    rawSignalPayloadReturned: exactBoolean(
      record.rawSignalPayloadReturned,
      false,
      "raw payload result flag"
    ) as false
  };
}

export class NodePostgresSignalSourceReferenceRefreshDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalSourceReferenceRefreshManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
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
    requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification",
    requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification",
    requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification",
    requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification",
    requestedSourceReferenceRefreshRoleNamespace = "yoink_ref_qualification",
    options: NodePostgresSignalSourceReferenceRefreshDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresSignalSourceReferenceRefreshManifest(
      requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
      requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
      requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
      requestedSourceReferenceRefreshRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalSourceReferenceRefreshQualificationError(
        "The PostgreSQL signal-source-reference connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_source_reference_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async refreshSignalSourceReferences(
    principal: BackgroundWorkerPrincipal,
    messageIdValue: string,
    capabilityTokenValue: string,
    now = Date.now()
  ): Promise<PostgresSignalSourceReferenceRefreshResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const messageId = String(messageIdValue ?? "");
    const capabilityToken = String(capabilityTokenValue ?? "");
    if (!MESSAGE_ID.test(messageId) || !CAPABILITY_TOKEN.test(capabilityToken)
      || !Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresSignalSourceReferenceRefreshQualificationError(
        "The PostgreSQL signal-source-reference apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.sourceReferenceRefreshRole.name)}`);
      const call = async (
        operation: "plan" | "apply",
        evaluatedAt: string,
        payload: Record<string, unknown>
      ): Promise<Record<string, unknown>> => {
        const result = await client.query<FunctionRow>(
          `SELECT result_json AS "resultJson"
           FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION)}(
             $1, $2, $3, $4, $5, $6, $7
           )`,
          [tenantId, userId, operation, messageId, capabilityToken, evaluatedAt, JSON.stringify(payload)]
        );
        if (result.rows.length !== 1 || !result.rows[0]) {
          throw new PostgresSignalSourceReferenceRefreshQualificationError(
            "The PostgreSQL signal-source-reference function returned an ambiguous result."
          );
        }
        return parseFunctionJson(result.rows[0].resultJson, `${operation} result`);
      };
      const plan = parsePlan(
        await call("plan", "", {}),
        { tenantId, userId },
        messageId,
        now
      );
      const applied = parseResult(
        await call("apply", plan.evaluatedAt, { planFingerprint: plan.planFingerprint }),
        plan
      );
      await client.query("COMMIT");
      return applied;
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
