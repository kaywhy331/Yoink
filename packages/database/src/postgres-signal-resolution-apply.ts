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
  buildPostgresSignalCatalogApplyManifest,
  verifyPostgresSignalCatalogApplyBoundary
} from "./postgres-signal-catalog-apply.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_RESOLUTION_APPLY_RECEIPT_TABLE =
  "yoink_signal_resolution_apply_receipt";
export const POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION =
  "yoink_apply_trackalacker_signal_resolution";

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
  "source_connections"
] as const);
const MUTATION_TABLES = Object.freeze([
  "resolution_decisions",
  "signal_events",
  "source_connections"
] as const);

export interface PostgresSignalResolutionApplyManifest {
  contractVersion: typeof POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  hostedDeliveryContractVersion: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION;
  catalogApplyContractVersion: typeof POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION;
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
  catalogApplyManifestFingerprint: string;
  resolutionApplyRole: {
    kind: "signal_event_resolution_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  transportDuplicateRepositoryParity: true;
  signalEventInsertRepositoryParity: true;
  sourceConnectionHeartbeatRepositoryParity: true;
  resolutionDecisionInsertRepositoryParity: true;
  sharedCatalogMutationFailClosed: true;
  sourceReferenceRefreshRepositoryParity: false;
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

export interface PostgresSignalResolutionApplyQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  catalogApplyManifestFingerprint: string;
  resolutionApplyRoleName: string;
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  transportDuplicateRepositoryParity: true;
  signalEventInsertRepositoryParity: true;
  sourceConnectionHeartbeatRepositoryParity: true;
  resolutionDecisionInsertRepositoryParity: true;
  sharedCatalogMutationFailClosed: true;
  sourceReferenceRefreshRepositoryParity: false;
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

export interface PostgresSignalResolutionApplyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
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
  transportDuplicateRepositoryParity: true;
  signalEventInsertRepositoryParity: true;
  sourceConnectionHeartbeatRepositoryParity: true;
  resolutionDecisionInsertRepositoryParity: true;
  sharedCatalogMutationFailClosed: true;
  sourceReferenceRefreshRepositoryParity: false;
  downstreamSignalGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  maximumPlanAgeSeconds: 30;
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
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

export interface PostgresSignalResolutionApplyPlan {
  contractVersion: 1;
  messageId: string;
  payloadHash: string;
  evaluatedAt: string;
  validUntil: string;
  sourceConnectionId: string;
  signalId: string;
  externalEventId: string;
  transportHash: string;
  outcome: "duplicate" | "matched" | "ambiguous" | "unresolved";
  duplicateEventId: string;
  resolutionStatus: "" | "matched" | "ambiguous" | "unresolved";
  resolutionMethod: string;
  resolutionReason: string;
  listingId: string;
  variantId: string;
  eventWillCreate: boolean;
  resolutionWillCreate: boolean;
  sourceHeartbeatWillUpdate: boolean;
  sharedCatalogMutationRequired: false;
  rawSignalPayloadReturned: false;
  planFingerprint: string;
}

export interface PostgresSignalResolutionApplyResult {
  contractVersion: 1;
  messageId: string;
  planFingerprint: string;
  eventId: string;
  resolutionDecisionId: string;
  duplicate: boolean;
  signalEventCreated: boolean;
  resolutionDecisionCreated: boolean;
  sourceConnectionHeartbeatUpdated: boolean;
  mutationStatementCount: number;
  mutationApplied: boolean;
  mutationAuthority: true;
  transportDuplicateRepositoryParity: true;
  downstreamSignalGraphMutated: false;
  inboxLifecycleMutated: false;
  rawSignalPayloadReturned: false;
}

export interface NodePostgresSignalResolutionApplyDatabaseOptions {
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
  phase: string;
  role_manifest_fingerprint: string;
  catalog_apply_manifest_fingerprint: string;
  resolution_apply_role_name: string;
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
  transport_duplicate_repository_parity: boolean;
  signal_event_insert_repository_parity: boolean;
  source_connection_heartbeat_repository_parity: boolean;
  resolution_decision_insert_repository_parity: boolean;
  shared_catalog_mutation_fail_closed: boolean;
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

let cachedCapabilityProjection: Readonly<PostgresSignalResolutionApplyCapabilityProjection> | null = null;

export class PostgresSignalResolutionApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalResolutionApplyQualificationError";
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string, fallback: string): string {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  return `${namespace}_signal_resolution_apply`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} is out of range.`
    );
  }
  return parsed;
}

function exactText(value: unknown, label: string, maximum = 300, allowEmpty = false): string {
  const normalized = String(value ?? "");
  if (normalized.length > maximum || (!allowEmpty && normalized.length === 0)
    || normalized.trim() !== normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} is invalid.`
    );
  }
  return normalized;
}

function exactHash(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!SHA256.test(normalized)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} is invalid.`
    );
  }
  return normalized;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) {
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} is invalid.`
    );
  }
  return normalized;
}

function exactBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) {
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} is invalid.`
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

export function postgresSignalResolutionApplyPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresSignalResolutionApplyPlan
): string {
  return stableHash(
    "postgres_signal_resolution_apply_plan_v1",
    principal.tenantId,
    principal.userId,
    plan.contractVersion,
    plan.messageId,
    plan.payloadHash,
    plan.evaluatedAt,
    plan.validUntil,
    plan.sourceConnectionId,
    plan.signalId,
    plan.externalEventId,
    plan.transportHash,
    plan.outcome,
    plan.duplicateEventId,
    plan.resolutionStatus,
    plan.resolutionMethod,
    plan.resolutionReason,
    plan.listingId,
    plan.variantId,
    plan.eventWillCreate ? 1 : 0,
    plan.resolutionWillCreate ? 1 : 0,
    plan.sourceHeartbeatWillUpdate ? 1 : 0,
    plan.sharedCatalogMutationRequired ? 1 : 0,
    plan.rawSignalPayloadReturned ? 1 : 0
  );
}

export function signalResolutionApplyFunctionSource(
  manifest: PostgresSignalResolutionApplyManifest
): string {
  const planParts = stableHashInputSql([
    "'postgres_signal_resolution_apply_plan_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'1'::text",
    "message_record.id::text",
    "message_record.payload_hash::text",
    "evaluation_timestamp",
    "valid_until_timestamp",
    "source_connection_id_value",
    "signal_id_value",
    "external_event_id_value",
    "transport_hash_value",
    "outcome_value",
    "duplicate_event_id_value",
    "resolution_status_value",
    "resolution_method_value",
    "resolution_reason_value",
    "listing_id_value",
    "variant_id_value",
    "CASE WHEN event_will_create_value THEN '1' ELSE '0' END",
    "CASE WHEN resolution_will_create_value THEN '1' ELSE '0' END",
    "CASE WHEN source_heartbeat_will_update_value THEN '1' ELSE '0' END",
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
  payload_value JSONB;
  identity_value JSONB;
  offer_value JSONB;
  evidence_value JSONB;
  source_connection_id_value TEXT;
  signal_id_value TEXT;
  external_event_id_value TEXT;
  transport_hash_value TEXT;
  outcome_value TEXT;
  duplicate_event_id_value TEXT := '';
  resolution_status_value TEXT := '';
  resolution_method_value TEXT := '';
  resolution_reason_value TEXT := '';
  listing_id_value TEXT := '';
  variant_id_value TEXT := '';
  event_will_create_value BOOLEAN;
  resolution_will_create_value BOOLEAN;
  source_heartbeat_will_update_value BOOLEAN;
  plan_input TEXT;
  plan_fingerprint_value TEXT;
  plan_value JSONB;
  apply_payload JSONB;
  event_id_value TEXT := '';
  resolution_id_value TEXT := '';
  affected_count BIGINT;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR target_message_id !~ '^inbox_[a-f0-9]{32}$'
    OR capability_token !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_name NOT IN ('plan', 'apply')
    OR pg_catalog.octet_length(apply_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution apply request is invalid';
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
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF evaluation_clock > pg_catalog.statement_timestamp()
      OR EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock))
        > ${MAXIMUM_PLAN_AGE_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution plan expired before apply';
    END IF;
  END IF;
  evaluation_timestamp := pg_catalog.to_char(
    evaluation_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  -- The first call authenticates the one-use lease capability before this
  -- boundary takes a row or advisory lock. The second call, below, is the
  -- authoritative resolution revalidation after serialization.
  SELECT MIN(planned.result_json)::jsonb, COUNT(*)
    INTO initial_hosted_plan, initial_hosted_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION)}(
    expected_tenant_id, expected_user_id, target_message_id, capability_token
  ) AS planned;
  IF initial_hosted_plan_count <> 1 OR initial_hosted_plan IS NULL
    OR initial_hosted_plan->>'messageId' <> target_message_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal-resolution capability validation failed';
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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal-resolution inbox binding is unavailable';
  END IF;

  payload_value := message_record.payload_json::jsonb;
  source_connection_id_value := payload_value->>'sourceConnectionId';
  signal_id_value := payload_value->>'signalId';
  external_event_id_value := payload_value->>'externalEventId';
  transport_hash_value := initial_hosted_plan->'signal'->>'transportHash';
  IF source_connection_id_value = '' OR signal_id_value = '' OR external_event_id_value = ''
    OR transport_hash_value !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution normalized identity is invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_resolution_apply_v1:' || source_connection_id_value || ':' || transport_hash_value,
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
    OR hosted_plan->>'outcome' NOT IN ('duplicate', 'matched', 'ambiguous', 'unresolved')
    OR hosted_plan->>'validUntil' <= pg_catalog.to_char(
      pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal-resolution plan changed during serialization';
  END IF;
  IF hosted_plan->>'sharedCatalogMutationRequired' = 'true' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal-resolution apply requires the separately qualified catalog-create boundary first';
  END IF;
  IF hosted_plan->>'sharedCatalogMutationRequired' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution shared-catalog state is invalid';
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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal-resolution inbox capability expired';
  END IF;

  outcome_value := hosted_plan->>'outcome';
  duplicate_event_id_value := COALESCE(hosted_plan->>'duplicateEventId', '');
  IF outcome_value = 'duplicate' THEN
    IF duplicate_event_id_value = '' OR hosted_plan->'resolution' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution duplicate plan is inconsistent';
    END IF;
  ELSE
    IF duplicate_event_id_value <> ''
      OR pg_catalog.jsonb_typeof(hosted_plan->'resolution') <> 'object'
      OR hosted_plan->'resolution'->>'status' <> outcome_value THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution current plan is inconsistent';
    END IF;
    resolution_status_value := hosted_plan->'resolution'->>'status';
    resolution_method_value := hosted_plan->'resolution'->>'method';
    resolution_reason_value := hosted_plan->'resolution'->>'reason';
    IF outcome_value = 'matched' THEN
      listing_id_value := COALESCE(hosted_plan->'resolution'->'listing'->>'id', '');
      variant_id_value := COALESCE(hosted_plan->'resolution'->'listing'->>'variantId', '');
      IF listing_id_value = '' OR variant_id_value = '' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution matched listing is unavailable';
      END IF;
    ELSIF hosted_plan->'resolution'->'listing' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution unmatched listing is invalid';
    END IF;
  END IF;

  event_will_create_value := outcome_value <> 'duplicate';
  resolution_will_create_value := outcome_value <> 'duplicate';
  source_heartbeat_will_update_value := outcome_value <> 'duplicate';
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
    'sourceConnectionId', source_connection_id_value,
    'signalId', signal_id_value,
    'externalEventId', external_event_id_value,
    'transportHash', transport_hash_value,
    'outcome', outcome_value,
    'duplicateEventId', duplicate_event_id_value,
    'resolutionStatus', resolution_status_value,
    'resolutionMethod', resolution_method_value,
    'resolutionReason', resolution_reason_value,
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'eventWillCreate', event_will_create_value,
    'resolutionWillCreate', resolution_will_create_value,
    'sourceHeartbeatWillUpdate', source_heartbeat_will_update_value,
    'sharedCatalogMutationRequired', FALSE,
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-resolution apply payload does not match its current plan';
  END IF;

  IF outcome_value = 'duplicate' THEN
    RETURN QUERY SELECT pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'messageId', message_record.id,
      'planFingerprint', plan_fingerprint_value,
      'eventId', duplicate_event_id_value,
      'resolutionDecisionId', '',
      'duplicate', TRUE,
      'signalEventCreated', FALSE,
      'resolutionDecisionCreated', FALSE,
      'sourceConnectionHeartbeatUpdated', FALSE,
      'mutationStatementCount', 0,
      'mutationApplied', FALSE,
      'mutationAuthority', TRUE,
      'transportDuplicateRepositoryParity', TRUE,
      'downstreamSignalGraphMutated', FALSE,
      'inboxLifecycleMutated', FALSE,
      'rawSignalPayloadReturned', FALSE
    )::text;
    RETURN;
  END IF;

  identity_value := payload_value->'identity';
  offer_value := payload_value->'offer';
  evidence_value := payload_value->'evidence';
  event_id_value := 'signal_event_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  resolution_id_value := 'resolution_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  INSERT INTO ${relation(manifest.schemaName, "signal_events")}(
    id, tenant_id, user_id, source_connection_id, signal_id,
    external_event_id, transport_hash, schema_version, source, event_type,
    test, observed_at, received_at, identity_json, offer_json,
    evidence_json, parser_version, resolution_status, created_at
  ) VALUES (
    event_id_value, resolved_tenant_id, resolved_user_id, source_connection_id_value,
    signal_id_value, external_event_id_value, transport_hash_value,
    (payload_value->>'schemaVersion')::bigint, 'trackalacker', payload_value->>'eventType',
    CASE WHEN (payload_value->>'test')::boolean THEN 1 ELSE 0 END,
    payload_value->>'observedAt', payload_value->>'receivedAt', identity_value::text,
    offer_value::text, evidence_value::text, payload_value->>'parserVersion',
    resolution_status_value, evaluation_timestamp
  );

  UPDATE ${relation(manifest.schemaName, "source_connections")}
  SET status = 'connected', last_event_at = payload_value->>'receivedAt',
      updated_at = evaluation_timestamp
  WHERE id = source_connection_id_value
    AND tenant_id = resolved_tenant_id AND user_id = resolved_user_id
    AND source = 'trackalacker';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal-resolution source heartbeat target is unavailable';
  END IF;

  INSERT INTO ${relation(manifest.schemaName, "resolution_decisions")}(
    id, event_id, status, method, variant_id, listing_id,
    reason, resolver_version, created_at
  ) VALUES (
    resolution_id_value, event_id_value, resolution_status_value,
    resolution_method_value, NULLIF(variant_id_value, ''), NULLIF(listing_id_value, ''),
    resolution_reason_value, 'resolver-v1', evaluation_timestamp
  );

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_record.id,
    'planFingerprint', plan_fingerprint_value,
    'eventId', event_id_value,
    'resolutionDecisionId', resolution_id_value,
    'duplicate', FALSE,
    'signalEventCreated', TRUE,
    'resolutionDecisionCreated', TRUE,
    'sourceConnectionHeartbeatUpdated', TRUE,
    'mutationStatementCount', 3,
    'mutationApplied', TRUE,
    'mutationAuthority', TRUE,
    'transportDuplicateRepositoryParity', TRUE,
    'downstreamSignalGraphMutated', FALSE,
    'inboxLifecycleMutated', FALSE,
    'rawSignalPayloadReturned', FALSE
  )::text;
END
`;
}

export function buildPostgresSignalResolutionApplyManifest(
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
  requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification"
): PostgresSignalResolutionApplyManifest {
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
    safeNamespace(requestedResolutionApplyRoleNamespace, "yoink_resolution_qualification")
  ] as const;
  const [schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace, resolutionApplyRoleNamespace] = values;
  if (new Set(values.slice(1)).size !== values.length - 1) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role namespace must be independent."
    );
  }
  const previous = buildPostgresSignalCatalogApplyManifest(
    schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace
  );
  const withoutFingerprint: Omit<PostgresSignalResolutionApplyManifest, "fingerprint"> = {
    contractVersion: POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    hostedDeliveryContractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
    catalogApplyContractVersion: POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
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
    catalogApplyManifestFingerprint: previous.fingerprint,
    resolutionApplyRole: {
      kind: "signal_event_resolution_apply_boundary",
      name: roleName(resolutionApplyRoleNamespace),
      functionName: POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    transportDuplicateRepositoryParity: true,
    signalEventInsertRepositoryParity: true,
    sourceConnectionHeartbeatRepositoryParity: true,
    resolutionDecisionInsertRepositoryParity: true,
    sharedCatalogMutationFailClosed: true,
    sourceReferenceRefreshRepositoryParity: false,
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

export function postgresSignalResolutionApplyCapabilityProjection():
PostgresSignalResolutionApplyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalResolutionApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    catalogApplyContractVersion: 1,
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
    transportDuplicateRepositoryParity: true,
    signalEventInsertRepositoryParity: true,
    sourceConnectionHeartbeatRepositoryParity: true,
    resolutionDecisionInsertRepositoryParity: true,
    sharedCatalogMutationFailClosed: true,
    sourceReferenceRefreshRepositoryParity: false,
    downstreamSignalGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    maximumPlanAgeSeconds: 30,
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
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
  manifest: PostgresSignalResolutionApplyManifest
): Promise<BoundaryInspection> {
  const role = manifest.resolutionApplyRole.name;
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role attributes are unsafe."
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role must have no membership."
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role has a direct table or column grant."
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role has an unauthorized effective table privilege."
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role has an invalid schema privilege."
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
    || routine.routineName !== POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role || routine.source !== signalResolutionApplyFunctionSource(manifest)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution function boundary is incomplete."
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution function grant is not exact."
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution protected table set is incomplete."
    );
  }
  const mutationTables = protectedTables.rows.filter((row) =>
    (MUTATION_TABLES as readonly string[]).includes(row.tableName)
  );
  if (mutationTables.map((row) => row.tableName).join(",")
    !== [...MUTATION_TABLES].sort().join(",")) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution mutation table set is incomplete."
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role must not access application sequences."
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role must not own application objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution role must not depend on a direct table policy."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  if (exactInteger(principals.rows[0]?.count, "active principal count") !== 0) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "Signal-resolution qualification cannot activate a runtime principal."
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
  manifest: PostgresSignalResolutionApplyManifest
): PostgresSignalResolutionApplyQualificationReceipt {
  if (row.phase !== "verified"
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.catalog_apply_manifest_fingerprint !== manifest.catalogApplyManifestFingerprint
    || row.resolution_apply_role_name !== manifest.resolutionApplyRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.server_bound_principal_lookup !== true
    || row.database_plan_revalidation !== true
    || row.transport_duplicate_repository_parity !== true
    || row.signal_event_insert_repository_parity !== true
    || row.source_connection_heartbeat_repository_parity !== true
    || row.resolution_decision_insert_repository_parity !== true
    || row.shared_catalog_mutation_fail_closed !== true
    || row.source_reference_refresh_repository_parity !== false
    || row.downstream_signal_graph_mutation !== false
    || row.inbox_lifecycle_mutation !== false
    || row.raw_signal_payload_returned !== false
    || row.signal_evaluation_apply_repository_parity !== false
    || row.hosted_delivery_handler_repository_parity !== false
    || row.mutation_authority !== true
    || row.direct_table_access !== false
    || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution receipt is incomplete or unsafe."
    );
  }
  const counts = [
    [row.contract_version, 1, "contract version"],
    [row.cutover_contract_version, 3, "cutover contract version"],
    [row.hosted_delivery_contract_version, 3, "hosted-delivery contract version"],
    [row.catalog_apply_contract_version, 1, "catalog-apply contract version"],
    [row.protected_tenant_table_count, 4, "protected table count"],
    [row.forced_rls_table_count, 4, "forced RLS table count"],
    [row.mutation_table_count, 3, "mutation table count"],
    [row.direct_table_grant_count, 0, "direct grant count"],
    [row.function_grant_count, 1, "function grant count"],
    [row.membership_count, 0, "membership count"],
    [row.active_principal_count, 0, "active principal count"],
    [row.maximum_plan_age_seconds, 30, "plan age"]
  ] as const;
  for (const [value, expected, label] of counts) {
    if (exactInteger(value, label) !== expected) {
      throw new PostgresSignalResolutionApplyQualificationError(
        "The PostgreSQL signal-resolution receipt uses an unsupported contract."
      );
    }
  }
  return {
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    catalogApplyContractVersion: 1,
    phase: "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: manifest.fingerprint,
    catalogApplyManifestFingerprint: manifest.catalogApplyManifestFingerprint,
    resolutionApplyRoleName: manifest.resolutionApplyRole.name,
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    transportDuplicateRepositoryParity: true,
    signalEventInsertRepositoryParity: true,
    sourceConnectionHeartbeatRepositoryParity: true,
    resolutionDecisionInsertRepositoryParity: true,
    sharedCatalogMutationFailClosed: true,
    sourceReferenceRefreshRepositoryParity: false,
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
  manifest: PostgresSignalResolutionApplyManifest
): Promise<PostgresSignalResolutionApplyQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresSignalResolutionApplyQualificationReceipt,
  manifest: PostgresSignalResolutionApplyManifest
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
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresSignalResolutionApplyBoundary(
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
  requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification"
): Promise<PostgresSignalResolutionApplyQualificationReceipt> {
  const manifest = buildPostgresSignalResolutionApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace
  );
  await verifyPostgresSignalCatalogApplyBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresSignalResolutionApplyBoundary(
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
  now = Date.now()
): Promise<PostgresSignalResolutionApplyQualificationReceipt> {
  if (!Number.isSafeInteger(now)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution qualification timestamp is invalid."
    );
  }
  const manifest = buildPostgresSignalResolutionApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "Signal-resolution qualification requires the supported cutover role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "Signal-resolution qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresSignalCatalogApplyBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace
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
        manifest.resolutionApplyRole.name,
        manifest.schemaName,
        POSTGRES_SIGNAL_RESOLUTION_APPLY_RECEIPT_TABLE,
        [POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION, "yoink_guard_signal_resolution_apply_receipt"]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing object count") !== 0) {
      throw new PostgresSignalResolutionApplyQualificationError(
        "Signal-resolution qualification refuses an existing role, function, guard, or receipt."
      );
    }
    await session.query(
      `CREATE ROLE ${identifier(manifest.resolutionApplyRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.resolutionApplyRole.name)}`
    );
    for (const table of PROTECTED_TENANT_TABLES) {
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`);
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`);
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
         target_message_id TEXT, capability_token TEXT,
         evaluation_timestamp_input TEXT, apply_payload_json TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${signalResolutionApplyFunctionSource(manifest)}$yoink$`
    );
    const signature = `${relation(
      manifest.schemaName,
      POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION
    )}(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)`;
    await session.query(`REVOKE ALL PRIVILEGES ON FUNCTION ${signature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier(manifest.resolutionApplyRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         hosted_delivery_contract_version BIGINT NOT NULL CHECK (hosted_delivery_contract_version = 3),
         catalog_apply_contract_version BIGINT NOT NULL CHECK (catalog_apply_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
         role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         catalog_apply_manifest_fingerprint TEXT NOT NULL CHECK (catalog_apply_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         resolution_apply_role_name TEXT NOT NULL,
         protected_tenant_table_count BIGINT NOT NULL CHECK (protected_tenant_table_count = 4),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 4),
         mutation_table_count BIGINT NOT NULL CHECK (mutation_table_count = 3),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         maximum_plan_age_seconds BIGINT NOT NULL CHECK (maximum_plan_age_seconds = 30),
         server_bound_principal_lookup BOOLEAN NOT NULL CHECK (server_bound_principal_lookup = TRUE),
         database_plan_revalidation BOOLEAN NOT NULL CHECK (database_plan_revalidation = TRUE),
         transport_duplicate_repository_parity BOOLEAN NOT NULL CHECK (transport_duplicate_repository_parity = TRUE),
         signal_event_insert_repository_parity BOOLEAN NOT NULL CHECK (signal_event_insert_repository_parity = TRUE),
         source_connection_heartbeat_repository_parity BOOLEAN NOT NULL CHECK (source_connection_heartbeat_repository_parity = TRUE),
         resolution_decision_insert_repository_parity BOOLEAN NOT NULL CHECK (resolution_decision_insert_repository_parity = TRUE),
         shared_catalog_mutation_fail_closed BOOLEAN NOT NULL CHECK (shared_catalog_mutation_fail_closed = TRUE),
         source_reference_refresh_repository_parity BOOLEAN NOT NULL CHECK (source_reference_refresh_repository_parity = FALSE),
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
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_RECEIPT_TABLE)} FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_RECEIPT_TABLE)}(
         singleton, contract_version, cutover_contract_version,
         hosted_delivery_contract_version, catalog_apply_contract_version,
         phase, role_manifest_fingerprint, catalog_apply_manifest_fingerprint,
         resolution_apply_role_name, protected_tenant_table_count,
         forced_rls_table_count, mutation_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         maximum_plan_age_seconds, server_bound_principal_lookup,
         database_plan_revalidation, transport_duplicate_repository_parity,
         signal_event_insert_repository_parity,
         source_connection_heartbeat_repository_parity,
         resolution_decision_insert_repository_parity,
         shared_catalog_mutation_fail_closed,
         source_reference_refresh_repository_parity,
         downstream_signal_graph_mutation, inbox_lifecycle_mutation,
         raw_signal_payload_returned, signal_evaluation_apply_repository_parity,
         hosted_delivery_handler_repository_parity, mutation_authority,
         direct_table_access, runtime_authority, production_ready,
         boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 3, 1, 'loading', $1, $2, $3,
         4, 4, 3, 0, 1, 0, 0, 30,
         TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE,
         FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
         TRUE, FALSE, FALSE, FALSE, repeat('0', 64), $4, ''
       )`,
      [
        manifest.fingerprint,
        manifest.catalogApplyManifestFingerprint,
        manifest.resolutionApplyRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_RECEIPT_TABLE)}
       SET phase = 'verified', boundary_catalog_fingerprint = $1, verified_at = $2
       WHERE singleton = TRUE AND phase = 'loading'`,
      [inspection.boundaryCatalogFingerprint, verifiedAt]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_signal_resolution_apply_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal-resolution receipt is immutable';
       END
       $guard$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_resolution_apply_receipt")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_signal_resolution_apply_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_resolution_apply_receipt")}()`
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
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} has an unexpected shape.`
    );
  }
  return record;
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? "")) as unknown;
  } catch {
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} is not valid JSON.`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      `The PostgreSQL signal-resolution ${label} is invalid.`
    );
  }
  return parsed as Record<string, unknown>;
}

function parsePlan(
  value: Record<string, unknown>,
  principal: BackgroundWorkerPrincipal,
  messageId: string,
  now: number
): PostgresSignalResolutionApplyPlan {
  const record = exactObject(value, "plan", [
    "contractVersion", "messageId", "payloadHash", "evaluatedAt", "validUntil",
    "sourceConnectionId", "signalId", "externalEventId", "transportHash",
    "outcome", "duplicateEventId", "resolutionStatus", "resolutionMethod",
    "resolutionReason", "listingId", "variantId", "eventWillCreate",
    "resolutionWillCreate", "sourceHeartbeatWillUpdate",
    "sharedCatalogMutationRequired", "rawSignalPayloadReturned", "planFingerprint"
  ]);
  if (exactInteger(record.contractVersion, "plan contract version") !== 1
    || record.messageId !== messageId) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution plan identity is invalid."
    );
  }
  const evaluatedAt = exactTimestamp(record.evaluatedAt, "evaluation timestamp");
  const validUntil = exactTimestamp(record.validUntil, "expiry timestamp");
  if (Math.abs(now - Date.parse(evaluatedAt)) > MAXIMUM_CLOCK_SKEW_MS
    || Date.parse(validUntil) <= Date.now()
    || Date.parse(validUntil) <= Date.parse(evaluatedAt)
    || Date.parse(validUntil) - Date.parse(evaluatedAt) > MAXIMUM_PLAN_AGE_SECONDS * 1_000) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution plan lifetime is invalid."
    );
  }
  const outcome = exactText(record.outcome, "outcome", 20) as PostgresSignalResolutionApplyPlan["outcome"];
  if (!(new Set(["duplicate", "matched", "ambiguous", "unresolved"])).has(outcome)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution plan outcome is invalid."
    );
  }
  const duplicate = outcome === "duplicate";
  const resolutionStatus = exactText(
    record.resolutionStatus,
    "resolution status",
    20,
    duplicate
  ) as PostgresSignalResolutionApplyPlan["resolutionStatus"];
  const resolutionMethod = exactText(record.resolutionMethod, "resolution method", 80, duplicate);
  const resolutionReason = exactText(record.resolutionReason, "resolution reason", 300, duplicate);
  const duplicateEventId = exactText(record.duplicateEventId, "duplicate event ID", 200, !duplicate);
  const listingId = exactText(record.listingId, "listing ID", 200, outcome !== "matched");
  const variantId = exactText(record.variantId, "variant ID", 200, outcome !== "matched");
  if ((duplicate && (!duplicateEventId || resolutionStatus !== ""
      || resolutionMethod !== "" || resolutionReason !== "" || listingId !== "" || variantId !== ""))
    || (!duplicate && (duplicateEventId !== "" || resolutionStatus !== outcome))
    || (outcome === "matched" && (!listingId || !variantId))
    || ((outcome === "ambiguous" || outcome === "unresolved") && (listingId !== "" || variantId !== ""))) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution plan is internally inconsistent."
    );
  }
  const plan: PostgresSignalResolutionApplyPlan = {
    contractVersion: 1,
    messageId,
    payloadHash: exactHash(record.payloadHash, "payload hash"),
    evaluatedAt,
    validUntil,
    sourceConnectionId: exactText(record.sourceConnectionId, "source connection ID", 120),
    signalId: exactText(record.signalId, "signal ID", 180),
    externalEventId: exactText(record.externalEventId, "external event ID", 180),
    transportHash: exactHash(record.transportHash, "transport hash"),
    outcome,
    duplicateEventId,
    resolutionStatus,
    resolutionMethod,
    resolutionReason,
    listingId,
    variantId,
    eventWillCreate: exactBoolean(record.eventWillCreate, !duplicate, "event-create flag"),
    resolutionWillCreate: exactBoolean(
      record.resolutionWillCreate,
      !duplicate,
      "resolution-create flag"
    ),
    sourceHeartbeatWillUpdate: exactBoolean(
      record.sourceHeartbeatWillUpdate,
      !duplicate,
      "source-heartbeat flag"
    ),
    sharedCatalogMutationRequired: exactBoolean(
      record.sharedCatalogMutationRequired,
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
  if (plan.planFingerprint !== postgresSignalResolutionApplyPlanFingerprint(principal, plan)) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution plan fingerprint is invalid."
    );
  }
  return plan;
}

function parseResult(
  value: Record<string, unknown>,
  plan: PostgresSignalResolutionApplyPlan
): PostgresSignalResolutionApplyResult {
  const record = exactObject(value, "apply result", [
    "contractVersion", "messageId", "planFingerprint", "eventId",
    "resolutionDecisionId", "duplicate", "signalEventCreated",
    "resolutionDecisionCreated", "sourceConnectionHeartbeatUpdated",
    "mutationStatementCount", "mutationApplied", "mutationAuthority",
    "transportDuplicateRepositoryParity", "downstreamSignalGraphMutated",
    "inboxLifecycleMutated", "rawSignalPayloadReturned"
  ]);
  const duplicate = plan.outcome === "duplicate";
  const eventId = exactText(record.eventId, "event ID", 200);
  const resolutionDecisionId = exactText(
    record.resolutionDecisionId,
    "resolution decision ID",
    200,
    duplicate
  );
  if (record.messageId !== plan.messageId || record.planFingerprint !== plan.planFingerprint
    || exactInteger(record.contractVersion, "result contract version") !== 1
    || (!duplicate && !EVENT_ID.test(eventId))
    || (duplicate && (eventId !== plan.duplicateEventId || resolutionDecisionId !== ""))
    || (!duplicate && !RESOLUTION_ID.test(resolutionDecisionId))) {
    throw new PostgresSignalResolutionApplyQualificationError(
      "The PostgreSQL signal-resolution apply identity is inconsistent."
    );
  }
  return {
    contractVersion: 1,
    messageId: plan.messageId,
    planFingerprint: plan.planFingerprint,
    eventId,
    resolutionDecisionId,
    duplicate: exactBoolean(record.duplicate, duplicate, "duplicate flag"),
    signalEventCreated: exactBoolean(
      record.signalEventCreated,
      !duplicate,
      "event-created flag"
    ),
    resolutionDecisionCreated: exactBoolean(
      record.resolutionDecisionCreated,
      !duplicate,
      "resolution-created flag"
    ),
    sourceConnectionHeartbeatUpdated: exactBoolean(
      record.sourceConnectionHeartbeatUpdated,
      !duplicate,
      "heartbeat-updated flag"
    ),
    mutationStatementCount: (() => {
      const count = exactInteger(record.mutationStatementCount, "mutation statement count");
      if (count !== (duplicate ? 0 : 3)) {
        throw new PostgresSignalResolutionApplyQualificationError(
          "The PostgreSQL signal-resolution mutation count is inconsistent."
        );
      }
      return count;
    })(),
    mutationApplied: exactBoolean(record.mutationApplied, !duplicate, "mutation flag"),
    mutationAuthority: exactBoolean(record.mutationAuthority, true, "authority flag") as true,
    transportDuplicateRepositoryParity: exactBoolean(
      record.transportDuplicateRepositoryParity,
      true,
      "transport duplicate parity flag"
    ) as true,
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

export class NodePostgresSignalResolutionApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalResolutionApplyManifest;

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
    options: NodePostgresSignalResolutionApplyDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresSignalResolutionApplyManifest(
      requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
      requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
      requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalResolutionApplyQualificationError(
        "The PostgreSQL signal-resolution connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_resolution_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async applySignalEventResolution(
    principal: BackgroundWorkerPrincipal,
    messageIdValue: string,
    capabilityTokenValue: string,
    now = Date.now()
  ): Promise<PostgresSignalResolutionApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const messageId = String(messageIdValue ?? "");
    const capabilityToken = String(capabilityTokenValue ?? "");
    if (!MESSAGE_ID.test(messageId) || !CAPABILITY_TOKEN.test(capabilityToken)
      || !Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresSignalResolutionApplyQualificationError(
        "The PostgreSQL signal-resolution apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.resolutionApplyRole.name)}`);
      const call = async (
        operation: "plan" | "apply",
        evaluatedAt: string,
        payload: Record<string, unknown>
      ): Promise<Record<string, unknown>> => {
        const result = await client.query<FunctionRow>(
          `SELECT result_json AS "resultJson"
           FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION)}(
             $1, $2, $3, $4, $5, $6, $7
           )`,
          [tenantId, userId, operation, messageId, capabilityToken, evaluatedAt, JSON.stringify(payload)]
        );
        if (result.rows.length !== 1 || !result.rows[0]) {
          throw new PostgresSignalResolutionApplyQualificationError(
            "The PostgreSQL signal-resolution function returned an ambiguous result."
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
