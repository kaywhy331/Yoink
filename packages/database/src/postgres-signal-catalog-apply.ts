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
  type PostgresQueryResult,
  type PostgresQuerySession
} from "./postgres-cutover.js";
import {
  POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
  POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION,
  buildPostgresHostedDeliveryLeaseRecoveryManifest,
  verifyPostgresHostedDeliveryLeaseRecoveryBoundary
} from "./postgres-hosted-delivery-lease-recovery.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_CATALOG_APPLY_RECEIPT_TABLE =
  "yoink_signal_catalog_apply_receipt";
export const POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION =
  "yoink_apply_trackalacker_signal_catalog";

const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const MAXIMUM_PLAN_AGE_SECONDS = 30;
const MAXIMUM_APPLY_PAYLOAD_BYTES = 1_024;
const SUPPORTED_EXACT_RETAILER_COUNT = 13;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_ID = /^inbox_[a-f0-9]{32}$/;
const GENERATED_ID = /^(?:family|variant|listing|listing_url|source_product|source_listing|source_alias)_[a-f0-9]{32}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text", "text", "text"
] as const);
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "inbox_messages",
  "source_listing_refs",
  "source_product_aliases",
  "source_product_refs"
] as const);
const SHARED_CATALOG_WRITE_TABLES = Object.freeze([
  "listing_urls",
  "listings",
  "product_families",
  "variants"
] as const);
const TENANT_REFERENCE_WRITE_TABLES = Object.freeze([
  "source_listing_refs",
  "source_product_aliases",
  "source_product_refs"
] as const);

export interface PostgresSignalCatalogApplyManifest {
  contractVersion: typeof POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  hostedDeliveryContractVersion: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION;
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
  hostedDeliveryManifestFingerprint: string;
  catalogApplyRole: {
    kind: "signal_shared_catalog_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    sharedCatalogWriteTableNames: string[];
    tenantReferenceWriteTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
  sharedCatalogWriteTableCount: 4;
  tenantReferenceWriteTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumPlanAgeSeconds: 30;
  supportedExactRetailerCount: 13;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  insertOnlyCatalogMutation: true;
  sharedCatalogCreateApplyRepositoryParity: true;
  sourceReferenceRefreshRepositoryParity: false;
  signalEvaluationGraphMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  mutationAuthority: true;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalCatalogApplyQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  hostedDeliveryManifestFingerprint: string;
  catalogApplyRoleName: string;
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
  sharedCatalogWriteTableCount: 4;
  tenantReferenceWriteTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  maximumPlanAgeSeconds: 30;
  supportedExactRetailerCount: 13;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  insertOnlyCatalogMutation: true;
  sharedCatalogCreateApplyRepositoryParity: true;
  sourceReferenceRefreshRepositoryParity: false;
  signalEvaluationGraphMutation: false;
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

export interface PostgresSignalCatalogApplyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
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
  insertOnlyCatalogMutation: true;
  sharedCatalogCreateApplyRepositoryParity: true;
  sourceReferenceRefreshRepositoryParity: false;
  signalEvaluationGraphMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  maximumPlanAgeSeconds: 30;
  supportedExactRetailerCount: 13;
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
  sharedCatalogWriteTableCount: 4;
  tenantReferenceWriteTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalCatalogPlan {
  contractVersion: 1;
  messageId: string;
  payloadHash: string;
  evaluatedAt: string;
  validUntil: string;
  identityFingerprint: string;
  existingVariantId: string;
  createFamily: boolean;
  createVariant: boolean;
  createListing: true;
  createCanonicalUrl: true;
  createSourceProductRef: boolean;
  createSourceListingRef: boolean;
  createSourceAlias: boolean;
  retailerExecutionSupported: boolean;
  rawSignalPayloadReturned: false;
  planFingerprint: string;
}

export interface PostgresSignalCatalogApplyResult {
  contractVersion: 1;
  messageId: string;
  planFingerprint: string;
  familyId: string;
  variantId: string;
  listingId: string;
  familyCreated: boolean;
  variantCreated: boolean;
  listingCreated: true;
  canonicalUrlCreated: true;
  sourceProductRefCreated: boolean;
  sourceListingRefCreated: boolean;
  sourceAliasCreated: boolean;
  sharedCatalogRowsCreated: number;
  tenantReferenceRowsCreated: number;
  mutationApplied: true;
  mutationAuthority: true;
  signalEvaluationGraphMutated: false;
  rawSignalPayloadReturned: false;
}

export interface NodePostgresSignalCatalogApplyDatabaseOptions {
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

interface RoleAuthorityRow extends Record<string, unknown> {
  rolcreaterole: boolean;
  rolsuper: boolean;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  hosted_delivery_contract_version: string | number | bigint;
  phase: string;
  role_manifest_fingerprint: string;
  hosted_delivery_manifest_fingerprint: string;
  catalog_apply_role_name: string;
  protected_tenant_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  shared_catalog_write_table_count: string | number | bigint;
  tenant_reference_write_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  maximum_plan_age_seconds: string | number | bigint;
  supported_exact_retailer_count: string | number | bigint;
  server_bound_principal_lookup: boolean;
  database_plan_revalidation: boolean;
  insert_only_catalog_mutation: boolean;
  shared_catalog_create_apply_repository_parity: boolean;
  source_reference_refresh_repository_parity: boolean;
  signal_evaluation_graph_mutation: boolean;
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
  sharedCatalogWriteTableCount: number;
  tenantReferenceWriteTableCount: number;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryCatalogFingerprint: string;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalCatalogApplyCapabilityProjection> | null = null;

export class PostgresSignalCatalogApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalCatalogApplyQualificationError";
  }
}

function safeSchema(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role namespace is invalid."
    );
  }
  return normalized;
}

function identifier(value: string): string {
  return `"${value}"`;
}

function relation(schema: string, object: string): string {
  return `${identifier(schema)}.${identifier(object)}`;
}

function roleName(namespace: string): string {
  const name = `${namespace}_signal_catalog`;
  if (Buffer.byteLength(name, "utf8") > 63) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role name exceeds 63 bytes."
    );
  }
  return name;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresSignalCatalogApplyQualificationError(
      `The PostgreSQL signal-catalog ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresSignalCatalogApplyQualificationError(
      `The PostgreSQL signal-catalog ${label} is out of range.`
    );
  }
  return parsed;
}

function exactBoolean<T extends boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) {
    throw new PostgresSignalCatalogApplyQualificationError(
      `The PostgreSQL signal-catalog ${label} is invalid.`
    );
  }
  return expected;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresSignalCatalogApplyQualificationError(
      `The PostgreSQL signal-catalog ${label} is invalid.`
    );
  }
  return normalized;
}

function exactText(value: unknown, label: string, maximum = 200): string {
  const normalized = String(value ?? "");
  if (normalized !== value || !normalized || Buffer.byteLength(normalized, "utf8") > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresSignalCatalogApplyQualificationError(
      `The PostgreSQL signal-catalog ${label} is invalid.`
    );
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maximum = 200): string {
  if (value === "") return "";
  return exactText(value, label, maximum);
}

function exactHash(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!SHA256.test(normalized)) {
    throw new PostgresSignalCatalogApplyQualificationError(
      `The PostgreSQL signal-catalog ${label} is invalid.`
    );
  }
  return normalized;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function stableHashInputSql(parts: string[]): string {
  return parts.map((part) =>
    `pg_catalog.octet_length(${part})::text || ':' || ${part} || '|'`
  ).join(" || ");
}

export function postgresSignalCatalogPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresSignalCatalogPlan
): string {
  return stableHash(
    "postgres_signal_catalog_apply_plan_v1",
    principal.tenantId,
    principal.userId,
    plan.contractVersion,
    plan.messageId,
    plan.payloadHash,
    plan.evaluatedAt,
    plan.validUntil,
    plan.identityFingerprint,
    plan.existingVariantId,
    plan.createFamily ? 1 : 0,
    plan.createVariant ? 1 : 0,
    plan.createListing ? 1 : 0,
    plan.createCanonicalUrl ? 1 : 0,
    plan.createSourceProductRef ? 1 : 0,
    plan.createSourceListingRef ? 1 : 0,
    plan.createSourceAlias ? 1 : 0,
    plan.retailerExecutionSupported ? 1 : 0,
    plan.rawSignalPayloadReturned ? 1 : 0
  );
}

export function signalCatalogApplyFunctionSource(
  manifest: PostgresSignalCatalogApplyManifest
): string {
  const identityParts = stableHashInputSql([
    "'postgres_signal_catalog_identity_v1'::text",
    "source_connection_id_value",
    "source_product_id_value",
    "source_listing_id_value",
    "retailer_id_value",
    "retailer_sku_value",
    "canonical_url_value",
    "title_value",
    "trackalacker_slug_value",
    "availability_value",
    "currency_value",
    "observed_at_value"
  ]);
  const planParts = stableHashInputSql([
    "'postgres_signal_catalog_apply_plan_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'1'::text",
    "message_record.id::text",
    "message_record.payload_hash::text",
    "evaluation_timestamp",
    "valid_until_timestamp",
    "identity_fingerprint_value",
    "existing_variant_id_value",
    "CASE WHEN create_family_value THEN '1' ELSE '0' END",
    "CASE WHEN create_variant_value THEN '1' ELSE '0' END",
    "'1'::text",
    "'1'::text",
    "CASE WHEN create_source_product_ref_value THEN '1' ELSE '0' END",
    "CASE WHEN create_source_listing_ref_value THEN '1' ELSE '0' END",
    "CASE WHEN create_source_alias_value THEN '1' ELSE '0' END",
    "CASE WHEN retailer_execution_supported_value = 1 THEN '1' ELSE '0' END",
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
  hosted_plan JSONB;
  hosted_plan_count BIGINT;
  message_record RECORD;
  payload_value JSONB;
  identity_value JSONB;
  offer_value JSONB;
  source_connection_id_value TEXT;
  source_product_id_value TEXT;
  source_listing_id_value TEXT;
  retailer_id_value TEXT;
  retailer_sku_value TEXT;
  canonical_url_value TEXT;
  title_value TEXT;
  trackalacker_slug_value TEXT;
  availability_value TEXT;
  currency_value TEXT;
  observed_at_value TEXT;
  retailer_execution_supported_value BIGINT;
  product_ref_count BIGINT;
  existing_variant_id_value TEXT := '';
  alias_count BIGINT;
  alias_variant_id_value TEXT := '';
  source_listing_ref_count BIGINT;
  listing_count BIGINT;
  create_family_value BOOLEAN;
  create_variant_value BOOLEAN;
  create_source_product_ref_value BOOLEAN;
  create_source_listing_ref_value BOOLEAN;
  create_source_alias_value BOOLEAN;
  identity_input TEXT;
  identity_fingerprint_value TEXT;
  plan_input TEXT;
  plan_fingerprint_value TEXT;
  plan_value JSONB;
  apply_payload JSONB;
  family_id_value TEXT := '';
  variant_id_value TEXT;
  listing_id_value TEXT;
  listing_url_id_value TEXT;
  source_product_ref_id_value TEXT;
  source_listing_ref_id_value TEXT := '';
  source_alias_id_value TEXT := '';
  shared_catalog_rows_created BIGINT;
  tenant_reference_rows_created BIGINT;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR target_message_id !~ '^inbox_[a-f0-9]{32}$'
    OR capability_token !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_name NOT IN ('plan', 'apply')
    OR pg_catalog.octet_length(apply_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog request is invalid';
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
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF evaluation_clock > pg_catalog.statement_timestamp()
      OR EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock))
        > ${MAXIMUM_PLAN_AGE_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog plan expired before apply';
    END IF;
  END IF;
  evaluation_timestamp := pg_catalog.to_char(
    evaluation_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  SELECT MIN(planned.result_json)::jsonb, COUNT(*)
    INTO hosted_plan, hosted_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION)}(
    expected_tenant_id, expected_user_id, target_message_id, capability_token
  ) AS planned;
  IF hosted_plan_count <> 1 OR hosted_plan IS NULL
    OR hosted_plan->>'messageId' <> target_message_id
    OR hosted_plan->>'outcome' <> 'unresolved'
    OR hosted_plan->>'sharedCatalogMutationRequired' <> 'true'
    OR hosted_plan->'resolution'->>'status' <> 'unresolved'
    OR hosted_plan->'resolution'->>'method' <> 'none'
    OR hosted_plan->'resolution'->'listing' IS DISTINCT FROM 'null'::jsonb
    OR hosted_plan->>'duplicateEventId' <> ''
    OR hosted_plan->>'validUntil' <= pg_catalog.to_char(
      pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog mutation is not required by the current resolution plan';
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
  IF NOT FOUND OR hosted_plan->>'payloadHash' <> message_record.payload_hash THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal-catalog inbox binding is unavailable';
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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal-catalog inbox capability expired';
  END IF;

  payload_value := message_record.payload_json::jsonb;
  identity_value := payload_value->'identity';
  offer_value := payload_value->'offer';
  source_connection_id_value := payload_value->>'sourceConnectionId';
  source_product_id_value := identity_value->>'sourceProductId';
  source_listing_id_value := identity_value->>'sourceListingId';
  retailer_id_value := identity_value->>'retailerId';
  retailer_sku_value := identity_value->>'retailerSku';
  canonical_url_value := identity_value->>'canonicalUrl';
  title_value := identity_value->>'title';
  trackalacker_slug_value := pg_catalog.lower(
    COALESCE(identity_value->'globalIdentifiers'->>'trackalacker_slug', '')
  );
  availability_value := offer_value->>'availability';
  currency_value := offer_value->>'currency';
  observed_at_value := payload_value->>'observedAt';
  IF source_product_id_value = '' OR pg_catalog.length(source_product_id_value) > 120
    OR source_product_id_value <> pg_catalog.btrim(source_product_id_value)
    OR source_product_id_value ~ '[[:cntrl:]]'
    OR (source_listing_id_value <> '' AND (
      pg_catalog.length(source_listing_id_value) > 120
      OR source_listing_id_value <> pg_catalog.btrim(source_listing_id_value)
      OR source_listing_id_value ~ '[[:cntrl:]]'
    ))
    OR retailer_id_value !~ '^[a-z0-9][a-z0-9_-]{0,59}$'
    OR retailer_sku_value !~ '^[A-Z0-9][A-Z0-9._-]{1,63}$'
    OR title_value = '' OR pg_catalog.length(title_value) > 300
    OR title_value <> pg_catalog.btrim(title_value) OR title_value ~ '[[:cntrl:]]'
    OR trackalacker_slug_value !~ '^(?:|[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?)$'
    OR availability_value NOT IN ('in_stock', 'preorder', 'out_of_stock', 'unknown')
    OR currency_value !~ '^[A-Z]{3}$'
    OR observed_at_value !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
    OR observed_at_value::timestamptz > pg_catalog.statement_timestamp() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog exact identity is invalid';
  END IF;

  SELECT retailer.execution_supported
    INTO retailer_execution_supported_value
  FROM ${relation(manifest.schemaName, "retailers")} AS retailer
  WHERE retailer.id = retailer_id_value;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog retailer is not registered';
  END IF;
  IF NOT (CASE retailer_id_value
    WHEN 'target' THEN canonical_url_value = 'https://www.target.com/p/-/A-' || retailer_sku_value
    WHEN 'walmart' THEN canonical_url_value = 'https://www.walmart.com/ip/' || retailer_sku_value
    WHEN 'amazon' THEN canonical_url_value = 'https://www.amazon.com/dp/' || retailer_sku_value
    WHEN 'bestbuy' THEN canonical_url_value = 'https://www.bestbuy.com/site/-/' || retailer_sku_value || '.p'
    WHEN 'riot' THEN canonical_url_value = 'https://merch.riotgames.com/en-us/product/' || pg_catalog.lower(retailer_sku_value) || '/'
    WHEN 'booksamillion' THEN canonical_url_value = 'https://www.booksamillion.com/p/-/' || retailer_sku_value
    WHEN 'pbandai' THEN canonical_url_value = 'https://p-bandai.com/us/item/' || retailer_sku_value
    WHEN 'pokemoncenter' THEN canonical_url_value = 'https://www.pokemoncenter.com/product/' || retailer_sku_value
      OR pg_catalog.left(canonical_url_value, pg_catalog.length(
        'https://www.pokemoncenter.com/product/' || retailer_sku_value || '/'
      )) = 'https://www.pokemoncenter.com/product/' || retailer_sku_value || '/'
    WHEN 'disney' THEN retailer_sku_value ~ '^\\d{10,20}$'
      AND pg_catalog.left(canonical_url_value, pg_catalog.length('https://www.disneystore.com/'))
        = 'https://www.disneystore.com/'
      AND pg_catalog.right(canonical_url_value, pg_catalog.length('-' || retailer_sku_value || '.html'))
        = '-' || retailer_sku_value || '.html'
    WHEN 'ravensburger' THEN retailer_sku_value ~ '^\\d{5,20}$'
      AND pg_catalog.left(canonical_url_value, pg_catalog.length('https://www.ravensburger.us/en-US/products/'))
        = 'https://www.ravensburger.us/en-US/products/'
      AND pg_catalog.rtrim(canonical_url_value, '/') LIKE '%-' || retailer_sku_value
    WHEN 'fanatics' THEN retailer_sku_value ~ '^\\d{6,20}$'
      AND pg_catalog.left(canonical_url_value, pg_catalog.length('https://www.fanatics.com/'))
        = 'https://www.fanatics.com/'
      AND pg_catalog.strpos(
        pg_catalog.replace(canonical_url_value, '%2B', '+'),
        '+p-' || retailer_sku_value
      ) > 0
    WHEN 'kohls' THEN retailer_sku_value ~ '^\\d{5,12}$'
      AND pg_catalog.left(canonical_url_value, pg_catalog.length(
        'https://www.kohls.com/product/prd-' || retailer_sku_value || '/'
      )) = 'https://www.kohls.com/product/prd-' || retailer_sku_value || '/'
    WHEN 'macys' THEN retailer_sku_value ~ '^\\d{5,20}$'
      AND pg_catalog.left(canonical_url_value, pg_catalog.length('https://www.macys.com/shop/product/'))
        = 'https://www.macys.com/shop/product/'
      AND pg_catalog.right(canonical_url_value, pg_catalog.length('?ID=' || retailer_sku_value))
        = '?ID=' || retailer_sku_value
    ELSE FALSE
  END) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog canonical retailer identity is invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_catalog_apply_v1:' || retailer_id_value || ':' || retailer_sku_value,
    0
  ));
  SELECT MIN(reference.variant_id), COUNT(*)
    INTO existing_variant_id_value, product_ref_count
  FROM ${relation(manifest.schemaName, "source_product_refs")} AS reference
  WHERE reference.source_connection_id = source_connection_id_value
    AND reference.external_product_id = source_product_id_value;
  existing_variant_id_value := COALESCE(existing_variant_id_value, '');
  IF product_ref_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog source product mapping is ambiguous';
  END IF;
  SELECT MIN(alias.variant_id), COUNT(*)
    INTO alias_variant_id_value, alias_count
  FROM ${relation(manifest.schemaName, "source_product_aliases")} AS alias
  WHERE alias.source_connection_id = source_connection_id_value
    AND alias.alias_kind = 'trackalacker_slug'
    AND alias.alias_value = trackalacker_slug_value
    AND trackalacker_slug_value <> '';
  alias_variant_id_value := COALESCE(alias_variant_id_value, '');
  IF alias_count > 1 OR (alias_count = 1 AND (
      existing_variant_id_value = '' OR alias_variant_id_value <> existing_variant_id_value
    )) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog source alias conflicts with the exact product';
  END IF;
  SELECT COUNT(*) INTO listing_count
  FROM ${relation(manifest.schemaName, "listings")} AS listing
  WHERE listing.retailer_id = retailer_id_value AND listing.retailer_sku = retailer_sku_value;
  IF listing_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal-catalog plan changed because the listing now exists';
  END IF;
  SELECT COUNT(*) INTO source_listing_ref_count
  FROM ${relation(manifest.schemaName, "source_listing_refs")} AS reference
  WHERE reference.source_connection_id = source_connection_id_value
    AND reference.external_listing_id = source_listing_id_value
    AND source_listing_id_value <> '';
  IF source_listing_ref_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal-catalog plan changed because the source listing now exists';
  END IF;

  create_family_value := product_ref_count = 0;
  create_variant_value := product_ref_count = 0;
  create_source_product_ref_value := product_ref_count = 0;
  create_source_listing_ref_value := source_listing_id_value <> '';
  create_source_alias_value := trackalacker_slug_value <> '' AND alias_count = 0;
  identity_input := ${identityParts};
  identity_fingerprint_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(identity_input, 'UTF8')), 'hex'
  );
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
    'identityFingerprint', identity_fingerprint_value,
    'existingVariantId', existing_variant_id_value,
    'createFamily', create_family_value,
    'createVariant', create_variant_value,
    'createListing', TRUE,
    'createCanonicalUrl', TRUE,
    'createSourceProductRef', create_source_product_ref_value,
    'createSourceListingRef', create_source_listing_ref_value,
    'createSourceAlias', create_source_alias_value,
    'retailerExecutionSupported', retailer_execution_supported_value = 1,
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal-catalog apply payload does not match its current plan';
  END IF;

  IF create_family_value THEN
    family_id_value := 'family_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    variant_id_value := 'variant_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO ${relation(manifest.schemaName, "product_families")}(
      id, title, brand, created_at, updated_at
    ) VALUES (family_id_value, title_value, '', evaluation_timestamp, evaluation_timestamp);
    INSERT INTO ${relation(manifest.schemaName, "variants")}(
      id, family_id, title, attributes_json, created_at, updated_at
    ) VALUES (variant_id_value, family_id_value, title_value, '{}', evaluation_timestamp, evaluation_timestamp);
  ELSE
    variant_id_value := existing_variant_id_value;
  END IF;
  listing_id_value := 'listing_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  listing_url_id_value := 'listing_url_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  INSERT INTO ${relation(manifest.schemaName, "listings")}(
    id, variant_id, retailer_id, retailer_sku, canonical_url, status,
    execution_supported, msrp_cents, currency, created_at, updated_at
  ) VALUES (
    listing_id_value, variant_id_value, retailer_id_value, retailer_sku_value,
    canonical_url_value, availability_value, retailer_execution_supported_value,
    NULL, currency_value, evaluation_timestamp, evaluation_timestamp
  );
  INSERT INTO ${relation(manifest.schemaName, "listing_urls")}(
    id, listing_id, kind, url, active, observed_at
  ) VALUES (listing_url_id_value, listing_id_value, 'canonical', canonical_url_value, 1, observed_at_value);
  IF create_source_product_ref_value THEN
    source_product_ref_id_value := 'source_product_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO ${relation(manifest.schemaName, "source_product_refs")}(
      id, source_connection_id, external_product_id, variant_id,
      source_url, source_title, observed_at
    ) VALUES (
      source_product_ref_id_value, source_connection_id_value, source_product_id_value,
      variant_id_value, '', title_value, observed_at_value
    );
  END IF;
  IF create_source_listing_ref_value THEN
    source_listing_ref_id_value := 'source_listing_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO ${relation(manifest.schemaName, "source_listing_refs")}(
      id, source_connection_id, external_listing_id, external_product_id,
      listing_id, source_url, observed_at
    ) VALUES (
      source_listing_ref_id_value, source_connection_id_value, source_listing_id_value,
      source_product_id_value, listing_id_value, '', observed_at_value
    );
  END IF;
  IF create_source_alias_value THEN
    source_alias_id_value := 'source_alias_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO ${relation(manifest.schemaName, "source_product_aliases")}(
      id, source_connection_id, alias_kind, alias_value, variant_id, observed_at
    ) VALUES (
      source_alias_id_value, source_connection_id_value, 'trackalacker_slug',
      trackalacker_slug_value, variant_id_value, observed_at_value
    );
  END IF;
  shared_catalog_rows_created := 2
    + CASE WHEN create_family_value THEN 2 ELSE 0 END;
  tenant_reference_rows_created :=
    CASE WHEN create_source_product_ref_value THEN 1 ELSE 0 END
    + CASE WHEN create_source_listing_ref_value THEN 1 ELSE 0 END
    + CASE WHEN create_source_alias_value THEN 1 ELSE 0 END;
  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_record.id,
    'planFingerprint', plan_fingerprint_value,
    'familyId', family_id_value,
    'variantId', variant_id_value,
    'listingId', listing_id_value,
    'familyCreated', create_family_value,
    'variantCreated', create_variant_value,
    'listingCreated', TRUE,
    'canonicalUrlCreated', TRUE,
    'sourceProductRefCreated', create_source_product_ref_value,
    'sourceListingRefCreated', create_source_listing_ref_value,
    'sourceAliasCreated', create_source_alias_value,
    'sharedCatalogRowsCreated', shared_catalog_rows_created,
    'tenantReferenceRowsCreated', tenant_reference_rows_created,
    'mutationApplied', TRUE,
    'mutationAuthority', TRUE,
    'signalEvaluationGraphMutated', FALSE,
    'rawSignalPayloadReturned', FALSE
  )::text;
END
`;
}

export function buildPostgresSignalCatalogApplyManifest(
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
  requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification"
): PostgresSignalCatalogApplyManifest {
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
    safeNamespace(requestedCatalogApplyRoleNamespace, "yoink_catalog_qualification")
  ] as const;
  const [schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace] = values;
  if (new Set(values.slice(1)).size !== values.length - 1) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role namespace must be independent."
    );
  }
  const previous = buildPostgresHostedDeliveryLeaseRecoveryManifest(
    schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace
  );
  const withoutFingerprint: Omit<PostgresSignalCatalogApplyManifest, "fingerprint"> = {
    contractVersion: POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    hostedDeliveryContractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
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
    hostedDeliveryManifestFingerprint: previous.fingerprint,
    catalogApplyRole: {
      kind: "signal_shared_catalog_apply_boundary",
      name: roleName(catalogApplyRoleNamespace),
      functionName: POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      sharedCatalogWriteTableNames: [...SHARED_CATALOG_WRITE_TABLES],
      tenantReferenceWriteTableNames: [...TENANT_REFERENCE_WRITE_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
    sharedCatalogWriteTableCount: 4,
    tenantReferenceWriteTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumPlanAgeSeconds: 30,
    supportedExactRetailerCount: 13,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    insertOnlyCatalogMutation: true,
    sharedCatalogCreateApplyRepositoryParity: true,
    sourceReferenceRefreshRepositoryParity: false,
    signalEvaluationGraphMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    mutationAuthority: true,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresSignalCatalogApplyCapabilityProjection():
PostgresSignalCatalogApplyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalCatalogApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
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
    insertOnlyCatalogMutation: true,
    sharedCatalogCreateApplyRepositoryParity: true,
    sourceReferenceRefreshRepositoryParity: false,
    signalEvaluationGraphMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    maximumPlanAgeSeconds: 30,
    supportedExactRetailerCount: 13,
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
    sharedCatalogWriteTableCount: 4,
    tenantReferenceWriteTableCount: 3,
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
  manifest: PostgresSignalCatalogApplyManifest
): Promise<BoundaryInspection> {
  const role = manifest.catalogApplyRole.name;
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [role]
  );
  const roleRow = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !roleRow || roleRow.rolsuper
    || roleRow.rolinherit || roleRow.rolcreaterole || roleRow.rolcreatedb
    || roleRow.rolcanlogin || roleRow.rolreplication || roleRow.rolbypassrls) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role is missing or unsafe."
    );
  }

  const memberships = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname = $1 OR member_role.rolname = $1`,
    [role]
  );
  const membershipCount = exactInteger(memberships.rows[0]?.count, "membership count");
  if (membershipCount !== 0) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role must not have an active membership."
    );
  }

  const directGrants = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM information_schema.role_table_grants
       WHERE table_schema = $1 AND grantee = $2
     ) + (
       SELECT COUNT(*) FROM information_schema.role_column_grants
       WHERE table_schema = $1 AND grantee = $2
     ) AS count`,
    [manifest.schemaName, role]
  );
  const directTableGrantCount = exactInteger(
    directGrants.rows[0]?.count,
    "direct table-grant count"
  );
  if (directTableGrantCount !== 0) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role must not have a direct table or column grant."
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
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role has an unauthorized effective table privilege."
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
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role has an invalid schema privilege."
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
    || routine.routineName !== POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role || routine.source !== signalCatalogApplyFunctionSource(manifest)) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog function boundary is incomplete."
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
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog function grant is not exact."
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
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role must not access application sequences."
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
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role must not own application objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog role must not depend on a direct table policy."
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
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog tenant table boundary is incomplete."
    );
  }
  const sharedTables = await session.query<{ tableName: string }>(
    `SELECT relation.relname AS "tableName"
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relkind IN ('r', 'p')
       AND relation.relname = ANY($2::text[]) ORDER BY relation.relname`,
    [manifest.schemaName, [...SHARED_CATALOG_WRITE_TABLES]]
  );
  if (sharedTables.rows.map((row) => row.tableName).join(",")
    !== [...SHARED_CATALOG_WRITE_TABLES].sort().join(",")) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog shared write table set is incomplete."
    );
  }
  const referenceTables = protectedTables.rows.filter((row) =>
    (TENANT_REFERENCE_WRITE_TABLES as readonly string[]).includes(row.tableName)
  );
  if (referenceTables.map((row) => row.tableName).join(",")
    !== [...TENANT_REFERENCE_WRITE_TABLES].sort().join(",")) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog tenant reference table set is incomplete."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "Signal-catalog qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTenantTableCount: protectedTables.rows.length,
    forcedRlsTableCount: protectedTables.rows.filter((row) => row.forced).length,
    sharedCatalogWriteTableCount: sharedTables.rows.length,
    tenantReferenceWriteTableCount: referenceTables.length,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryCatalogFingerprint: fingerprint({
      role: roleRow,
      routine,
      routineAcl: routineAcl.rows,
      protectedTables: protectedTables.rows,
      sharedTables: sharedTables.rows,
      referenceTables
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresSignalCatalogApplyManifest
): PostgresSignalCatalogApplyQualificationReceipt {
  if (row.phase !== "verified"
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.hosted_delivery_manifest_fingerprint !== manifest.hostedDeliveryManifestFingerprint
    || row.catalog_apply_role_name !== manifest.catalogApplyRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.server_bound_principal_lookup !== true
    || row.database_plan_revalidation !== true
    || row.insert_only_catalog_mutation !== true
    || row.shared_catalog_create_apply_repository_parity !== true
    || row.source_reference_refresh_repository_parity !== false
    || row.signal_evaluation_graph_mutation !== false
    || row.raw_signal_payload_returned !== false
    || row.signal_evaluation_apply_repository_parity !== false
    || row.hosted_delivery_handler_repository_parity !== false
    || row.mutation_authority !== true
    || row.direct_table_access !== false
    || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog receipt is incomplete or unsafe."
    );
  }
  const counts = [
    [row.contract_version, 1, "contract version"],
    [row.cutover_contract_version, 3, "cutover contract version"],
    [row.hosted_delivery_contract_version, 3, "hosted-delivery contract version"],
    [row.protected_tenant_table_count, 4, "protected table count"],
    [row.forced_rls_table_count, 4, "forced RLS table count"],
    [row.shared_catalog_write_table_count, 4, "shared catalog table count"],
    [row.tenant_reference_write_table_count, 3, "tenant reference table count"],
    [row.direct_table_grant_count, 0, "direct grant count"],
    [row.function_grant_count, 1, "function grant count"],
    [row.membership_count, 0, "membership count"],
    [row.active_principal_count, 0, "active principal count"],
    [row.maximum_plan_age_seconds, 30, "plan age"],
    [row.supported_exact_retailer_count, 13, "retailer count"]
  ] as const;
  for (const [value, expected, label] of counts) {
    if (exactInteger(value, label) !== expected) {
      throw new PostgresSignalCatalogApplyQualificationError(
        "The PostgreSQL signal-catalog receipt uses an unsupported contract."
      );
    }
  }
  return {
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    phase: "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: manifest.fingerprint,
    hostedDeliveryManifestFingerprint: manifest.hostedDeliveryManifestFingerprint,
    catalogApplyRoleName: manifest.catalogApplyRole.name,
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
    sharedCatalogWriteTableCount: 4,
    tenantReferenceWriteTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    maximumPlanAgeSeconds: 30,
    supportedExactRetailerCount: 13,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    insertOnlyCatalogMutation: true,
    sharedCatalogCreateApplyRepositoryParity: true,
    sourceReferenceRefreshRepositoryParity: false,
    signalEvaluationGraphMutation: false,
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
  manifest: PostgresSignalCatalogApplyManifest
): Promise<PostgresSignalCatalogApplyQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_CATALOG_APPLY_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresSignalCatalogApplyQualificationReceipt,
  manifest: PostgresSignalCatalogApplyManifest
): void {
  if (inspection.protectedTenantTableCount !== receipt.protectedTenantTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.sharedCatalogWriteTableCount !== receipt.sharedCatalogWriteTableCount
    || inspection.tenantReferenceWriteTableCount !== receipt.tenantReferenceWriteTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresSignalCatalogApplyBoundary(
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
  requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification"
): Promise<PostgresSignalCatalogApplyQualificationReceipt> {
  const manifest = buildPostgresSignalCatalogApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace
  );
  await verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresSignalCatalogApplyBoundary(
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
  now = Date.now()
): Promise<PostgresSignalCatalogApplyQualificationReceipt> {
  const manifest = buildPostgresSignalCatalogApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "Signal-catalog qualification requires the supported cutover role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "Signal-catalog qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace
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
        manifest.catalogApplyRole.name,
        manifest.schemaName,
        POSTGRES_SIGNAL_CATALOG_APPLY_RECEIPT_TABLE,
        [POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION, "yoink_guard_signal_catalog_apply_receipt"]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing object count") !== 0) {
      throw new PostgresSignalCatalogApplyQualificationError(
        "Signal-catalog qualification refuses an existing role, function, guard, or receipt."
      );
    }
    await session.query(
      `CREATE ROLE ${identifier(manifest.catalogApplyRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.catalogApplyRole.name)}`
    );
    for (const table of PROTECTED_TENANT_TABLES) {
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`);
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`);
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
         target_message_id TEXT, capability_token TEXT,
         evaluation_timestamp_input TEXT, apply_payload_json TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${signalCatalogApplyFunctionSource(manifest)}$yoink$`
    );
    const signature = `${relation(
      manifest.schemaName,
      POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION
    )}(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)`;
    await session.query(`REVOKE ALL PRIVILEGES ON FUNCTION ${signature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier(manifest.catalogApplyRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_SIGNAL_CATALOG_APPLY_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         hosted_delivery_contract_version BIGINT NOT NULL CHECK (hosted_delivery_contract_version = 3),
         phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
         role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         hosted_delivery_manifest_fingerprint TEXT NOT NULL CHECK (hosted_delivery_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         catalog_apply_role_name TEXT NOT NULL,
         protected_tenant_table_count BIGINT NOT NULL CHECK (protected_tenant_table_count = 4),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 4),
         shared_catalog_write_table_count BIGINT NOT NULL CHECK (shared_catalog_write_table_count = 4),
         tenant_reference_write_table_count BIGINT NOT NULL CHECK (tenant_reference_write_table_count = 3),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         maximum_plan_age_seconds BIGINT NOT NULL CHECK (maximum_plan_age_seconds = 30),
         supported_exact_retailer_count BIGINT NOT NULL CHECK (supported_exact_retailer_count = 13),
         server_bound_principal_lookup BOOLEAN NOT NULL CHECK (server_bound_principal_lookup = TRUE),
         database_plan_revalidation BOOLEAN NOT NULL CHECK (database_plan_revalidation = TRUE),
         insert_only_catalog_mutation BOOLEAN NOT NULL CHECK (insert_only_catalog_mutation = TRUE),
         shared_catalog_create_apply_repository_parity BOOLEAN NOT NULL CHECK (shared_catalog_create_apply_repository_parity = TRUE),
         source_reference_refresh_repository_parity BOOLEAN NOT NULL CHECK (source_reference_refresh_repository_parity = FALSE),
         signal_evaluation_graph_mutation BOOLEAN NOT NULL CHECK (signal_evaluation_graph_mutation = FALSE),
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
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_CATALOG_APPLY_RECEIPT_TABLE)} FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_SIGNAL_CATALOG_APPLY_RECEIPT_TABLE)}(
         singleton, contract_version, cutover_contract_version, hosted_delivery_contract_version,
         phase, role_manifest_fingerprint, hosted_delivery_manifest_fingerprint,
         catalog_apply_role_name, protected_tenant_table_count, forced_rls_table_count,
         shared_catalog_write_table_count, tenant_reference_write_table_count,
         direct_table_grant_count, function_grant_count, membership_count,
         active_principal_count, maximum_plan_age_seconds, supported_exact_retailer_count,
         server_bound_principal_lookup, database_plan_revalidation, insert_only_catalog_mutation,
         shared_catalog_create_apply_repository_parity, source_reference_refresh_repository_parity,
         signal_evaluation_graph_mutation, raw_signal_payload_returned,
         signal_evaluation_apply_repository_parity, hosted_delivery_handler_repository_parity,
         mutation_authority, direct_table_access, runtime_authority, production_ready,
         boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 3, 'loading', $1, $2, $3,
         4, 4, 4, 3, 0, 1, 0, 0, 30, 13,
         TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE,
         TRUE, FALSE, FALSE, FALSE, repeat('0', 64), $4, ''
       )`,
      [
        manifest.fingerprint,
        manifest.hostedDeliveryManifestFingerprint,
        manifest.catalogApplyRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_SIGNAL_CATALOG_APPLY_RECEIPT_TABLE)}
       SET phase = 'verified', boundary_catalog_fingerprint = $1, verified_at = $2
       WHERE singleton = TRUE AND phase = 'loading'`,
      [inspection.boundaryCatalogFingerprint, verifiedAt]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_signal_catalog_apply_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal-catalog receipt is immutable';
       END
       $guard$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_catalog_apply_receipt")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_signal_catalog_apply_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_CATALOG_APPLY_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_catalog_apply_receipt")}()`
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
    throw new PostgresSignalCatalogApplyQualificationError(
      `The PostgreSQL signal-catalog ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    throw new PostgresSignalCatalogApplyQualificationError(
      `The PostgreSQL signal-catalog ${label} has an unexpected shape.`
    );
  }
  return record;
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed as Record<string, unknown>;
  } catch {
    throw new PostgresSignalCatalogApplyQualificationError(
      `The PostgreSQL signal-catalog ${label} is not valid JSON.`
    );
  }
}

function parsePlan(
  value: Record<string, unknown>,
  principal: BackgroundWorkerPrincipal,
  messageId: string,
  now: number
): PostgresSignalCatalogPlan {
  const record = exactObject(value, "plan", [
    "contractVersion", "messageId", "payloadHash", "evaluatedAt", "validUntil",
    "identityFingerprint", "existingVariantId", "createFamily", "createVariant",
    "createListing", "createCanonicalUrl", "createSourceProductRef",
    "createSourceListingRef", "createSourceAlias", "retailerExecutionSupported",
    "rawSignalPayloadReturned", "planFingerprint"
  ]);
  if (exactInteger(record.contractVersion, "plan contract version") !== 1
    || record.messageId !== messageId) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog plan identity is invalid."
    );
  }
  const evaluatedAt = exactTimestamp(record.evaluatedAt, "evaluation timestamp");
  const validUntil = exactTimestamp(record.validUntil, "expiry timestamp");
  if (Math.abs(now - Date.parse(evaluatedAt)) > MAXIMUM_CLOCK_SKEW_MS
    || Date.parse(validUntil) <= now
    || Date.parse(validUntil) - Date.parse(evaluatedAt) > MAXIMUM_PLAN_AGE_SECONDS * 1_000) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog plan lifetime is invalid."
    );
  }
  const createFamily = exactBoolean(record.createFamily, record.createFamily === true, "family flag");
  const createVariant = exactBoolean(record.createVariant, record.createVariant === true, "variant flag");
  const createSourceProductRef = exactBoolean(
    record.createSourceProductRef,
    record.createSourceProductRef === true,
    "source product flag"
  );
  const existingVariantId = optionalText(record.existingVariantId, "existing variant ID");
  if (createFamily !== createVariant || createVariant !== createSourceProductRef
    || (createVariant && existingVariantId !== "")
    || (!createVariant && existingVariantId === "")) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog plan creation flags are inconsistent."
    );
  }
  const plan: PostgresSignalCatalogPlan = {
    contractVersion: 1,
    messageId,
    payloadHash: exactHash(record.payloadHash, "payload hash"),
    evaluatedAt,
    validUntil,
    identityFingerprint: exactHash(record.identityFingerprint, "identity hash"),
    existingVariantId,
    createFamily,
    createVariant,
    createListing: exactBoolean(record.createListing, true, "listing flag"),
    createCanonicalUrl: exactBoolean(record.createCanonicalUrl, true, "canonical URL flag"),
    createSourceProductRef,
    createSourceListingRef: exactBoolean(
      record.createSourceListingRef,
      record.createSourceListingRef === true,
      "source listing flag"
    ),
    createSourceAlias: exactBoolean(
      record.createSourceAlias,
      record.createSourceAlias === true,
      "source alias flag"
    ),
    retailerExecutionSupported: exactBoolean(
      record.retailerExecutionSupported,
      record.retailerExecutionSupported === true,
      "retailer execution flag"
    ),
    rawSignalPayloadReturned: exactBoolean(
      record.rawSignalPayloadReturned,
      false,
      "raw payload flag"
    ),
    planFingerprint: exactHash(record.planFingerprint, "plan fingerprint")
  };
  if (plan.planFingerprint !== postgresSignalCatalogPlanFingerprint(principal, plan)) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog plan fingerprint is invalid."
    );
  }
  return plan;
}

function parseResult(
  value: Record<string, unknown>,
  plan: PostgresSignalCatalogPlan
): PostgresSignalCatalogApplyResult {
  const record = exactObject(value, "apply result", [
    "contractVersion", "messageId", "planFingerprint", "familyId", "variantId",
    "listingId", "familyCreated", "variantCreated", "listingCreated",
    "canonicalUrlCreated", "sourceProductRefCreated", "sourceListingRefCreated",
    "sourceAliasCreated", "sharedCatalogRowsCreated", "tenantReferenceRowsCreated",
    "mutationApplied", "mutationAuthority", "signalEvaluationGraphMutated",
    "rawSignalPayloadReturned"
  ]);
  const familyCreated = exactBoolean(record.familyCreated, plan.createFamily, "family result flag");
  const variantCreated = exactBoolean(record.variantCreated, plan.createVariant, "variant result flag");
  const familyId = record.familyId === "" ? "" : exactText(record.familyId, "family ID");
  const variantId = exactText(record.variantId, "variant ID");
  const listingId = exactText(record.listingId, "listing ID");
  if ((familyCreated && (!GENERATED_ID.test(familyId) || !familyId.startsWith("family_")))
    || (!familyCreated && familyId !== "")
    || (variantCreated && (!GENERATED_ID.test(variantId) || !variantId.startsWith("variant_")))
    || (!variantCreated && variantId !== plan.existingVariantId)
    || !GENERATED_ID.test(listingId) || !listingId.startsWith("listing_")) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog apply identity is invalid."
    );
  }
  const sourceProductRefCreated = exactBoolean(
    record.sourceProductRefCreated,
    plan.createSourceProductRef,
    "source product result flag"
  );
  const sourceListingRefCreated = exactBoolean(
    record.sourceListingRefCreated,
    plan.createSourceListingRef,
    "source listing result flag"
  );
  const sourceAliasCreated = exactBoolean(
    record.sourceAliasCreated,
    plan.createSourceAlias,
    "source alias result flag"
  );
  const sharedCatalogRowsCreated = exactInteger(
    record.sharedCatalogRowsCreated,
    "shared catalog row count"
  );
  const tenantReferenceRowsCreated = exactInteger(
    record.tenantReferenceRowsCreated,
    "tenant reference row count"
  );
  const expectedShared = 2 + (familyCreated ? 2 : 0);
  const expectedReferences = Number(sourceProductRefCreated)
    + Number(sourceListingRefCreated) + Number(sourceAliasCreated);
  if (record.messageId !== plan.messageId || record.planFingerprint !== plan.planFingerprint
    || exactInteger(record.contractVersion, "result contract version") !== 1
    || sharedCatalogRowsCreated !== expectedShared
    || tenantReferenceRowsCreated !== expectedReferences) {
    throw new PostgresSignalCatalogApplyQualificationError(
      "The PostgreSQL signal-catalog apply aggregate is inconsistent."
    );
  }
  return {
    contractVersion: 1,
    messageId: plan.messageId,
    planFingerprint: plan.planFingerprint,
    familyId,
    variantId,
    listingId,
    familyCreated,
    variantCreated,
    listingCreated: exactBoolean(record.listingCreated, true, "listing result flag"),
    canonicalUrlCreated: exactBoolean(
      record.canonicalUrlCreated,
      true,
      "canonical URL result flag"
    ),
    sourceProductRefCreated,
    sourceListingRefCreated,
    sourceAliasCreated,
    sharedCatalogRowsCreated,
    tenantReferenceRowsCreated,
    mutationApplied: exactBoolean(record.mutationApplied, true, "mutation flag"),
    mutationAuthority: exactBoolean(record.mutationAuthority, true, "authority flag"),
    signalEvaluationGraphMutated: exactBoolean(
      record.signalEvaluationGraphMutated,
      false,
      "evaluation graph flag"
    ),
    rawSignalPayloadReturned: exactBoolean(
      record.rawSignalPayloadReturned,
      false,
      "raw payload result flag"
    )
  };
}

export class NodePostgresSignalCatalogApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalCatalogApplyManifest;

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
    options: NodePostgresSignalCatalogApplyDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresSignalCatalogApplyManifest(
      requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
      requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
      requestedCatalogApplyRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalCatalogApplyQualificationError(
        "The PostgreSQL signal-catalog connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_catalog_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async applyExactSignalCatalogCreate(
    principal: BackgroundWorkerPrincipal,
    messageIdValue: string,
    capabilityTokenValue: string,
    now = Date.now()
  ): Promise<PostgresSignalCatalogApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID");
    const userId = exactText(principal?.userId, "expected user ID");
    const messageId = String(messageIdValue ?? "");
    const capabilityToken = String(capabilityTokenValue ?? "");
    if (!MESSAGE_ID.test(messageId) || !CAPABILITY_TOKEN.test(capabilityToken)
      || !Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresSignalCatalogApplyQualificationError(
        "The PostgreSQL signal-catalog apply request is invalid."
      );
    }
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.catalogApplyRole.name)}`);
      const call = async (
        operation: "plan" | "apply",
        evaluatedAt: string,
        payload: Record<string, unknown>
      ): Promise<Record<string, unknown>> => {
        const result = await client.query<FunctionRow>(
          `SELECT result_json AS "resultJson"
           FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION)}(
             $1, $2, $3, $4, $5, $6, $7
           )`,
          [tenantId, userId, operation, messageId, capabilityToken, evaluatedAt, JSON.stringify(payload)]
        );
        if (result.rows.length !== 1 || !result.rows[0]) {
          throw new PostgresSignalCatalogApplyQualificationError(
            "The PostgreSQL signal-catalog function returned an ambiguous result."
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
