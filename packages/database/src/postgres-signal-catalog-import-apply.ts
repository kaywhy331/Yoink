import { ADD_LANE_IDS } from "../../contracts/src/index.js";
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
  POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONTRACT_VERSION,
  buildPostgresSignalReservationLifecycleApplyManifest,
  verifyPostgresSignalReservationLifecycleApplyBoundary,
  type PostgresSignalReservationLifecycleApplyManifest
} from "./postgres-signal-reservation-lifecycle-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_RECEIPT_TABLE =
  "yoink_signal_catalog_import_apply_receipt";
export const POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION =
  "yoink_apply_signal_catalog_import";
export const POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONFIRMATION =
  "TRACKALACKER_CATALOG_IMPORT_V1";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 524_288;
const MAXIMUM_LISTINGS_PER_ITEM = 250;
const SUPPORTED_EXECUTION_RETAILER_COUNT = ADD_LANE_IDS.length;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const REQUEST_ID = /^catalog_import_[a-f0-9]{32}$/;
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
  "mission_targets",
  "missions",
  "offer_observations",
  "outbox_events",
  "source_connections",
  "source_listing_candidates",
  "source_listing_refs",
  "source_product_aliases",
  "source_product_refs",
  "source_sync_run_items",
  "source_sync_runs",
  "source_variant_retailer_refs"
] as const);
const MUTATION_TABLES = Object.freeze([
  "audit_events",
  "mission_targets",
  "offer_observations",
  "outbox_events",
  "source_connections",
  "source_listing_candidates",
  "source_listing_refs",
  "source_product_aliases",
  "source_product_refs",
  "source_sync_run_items",
  "source_variant_retailer_refs"
] as const);
const PROTECTED_SHARED_CATALOG_TABLES = Object.freeze([
  "listing_urls",
  "listings",
  "product_families",
  "retailers",
  "variants"
] as const);
const SHARED_CATALOG_MUTATION_TABLES = Object.freeze([
  "listing_urls",
  "listings",
  "product_families",
  "variants"
] as const);

export type PostgresSignalCatalogImportOperation =
  "import_trackalacker_catalog_item";

export interface PostgresSignalCatalogImportListingPayload {
  sourceListingId: string;
  storeName: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  sourceListingUrl: string;
  outboundUrl: string;
  availability: "in_stock" | "preorder" | "out_of_stock" | "unknown";
  unitPriceCents: number | null;
}

export interface PostgresSignalCatalogImportPayload {
  deviceId: string;
  sourceConnectionId: string;
  syncId: string;
  sourceProductId: string;
  sourceProductSlug: string;
  sourceProductUrl: string;
  title: string;
  msrpCents: number | null;
  observedAt: string;
  listings: PostgresSignalCatalogImportListingPayload[];
  confirmation: typeof POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONFIRMATION;
}

type PostgresSignalReservationLifecyclePredecessor = Pick<
  PostgresSignalReservationLifecycleApplyManifest,
  "schemaName" | "fingerprint" | "reservationLifecycleRoleNamespace"
>;

export interface PostgresSignalCatalogImportApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  reservationLifecycleApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  catalogImportRoleNamespace: string;
  reservationLifecycleApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalReservationLifecyclePredecessor;
  catalogImportRole: {
    kind: "signal_catalog_import_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    protectedSharedCatalogTableNames: string[];
    sharedCatalogMutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  maximumListingsPerItem: 250;
  supportedExecutionRetailerCount: typeof SUPPORTED_EXECUTION_RETAILER_COUNT;
  protectedTenantTableCount: 14;
  forcedRlsTableCount: 14;
  tenantMutationTableCount: 11;
  protectedSharedCatalogTableCount: 5;
  sharedCatalogMutationTableCount: 4;
  totalMutationTableCount: 15;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  sourceScopeConsumed: true;
  deterministicRequestIdentity: true;
  immutableAuditedReplay: true;
  boundedCatalogPayload: true;
  completeSetIdentityConsensus: true;
  crossTenantCatalogSerialization: true;
  sourceProductConflictFailClosed: true;
  sourceAliasConflictFailClosed: true;
  sourceListingConflictFailClosed: true;
  sourceCandidateConflictFailClosed: true;
  registeredRetailerRevalidation: true;
  canonicalRetailerUrlRevalidation: true;
  serverDerivedExecutionSupport: true;
  monotonicSourceObservation: true;
  candidateUpsertParity: true;
  listingUpsertParity: true;
  sourceReferenceUpsertParity: true;
  preferredRetailerRouteParity: true;
  idempotentOfferObservation: true;
  existingMissionTargetAttachmentParity: true;
  optionalSyncItemCompositionParity: true;
  atomicCatalogSyncAuditOutbox: true;
  databaseOwnedTimestamps: true;
  privacyBoundedReceipts: true;
  currentSourceOwnershipRevalidation: true;
  currentDeviceOwnershipRevalidation: true;
  currentRunOwnershipRevalidation: true;
  activeDeviceOnly: true;
  activeRunItemOnly: true;
  privateSourceOnly: true;
  trackalackerOnly: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: false;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: true;
  writerLockProtocolParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalCatalogImportCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  reservationLifecycleApplyContractVersion: 1;
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
  immutableAuditedReplay: true;
  boundedCatalogPayload: true;
  completeSetIdentityConsensus: true;
  crossTenantCatalogSerialization: true;
  sourceProductConflictFailClosed: true;
  sourceAliasConflictFailClosed: true;
  sourceListingConflictFailClosed: true;
  sourceCandidateConflictFailClosed: true;
  registeredRetailerRevalidation: true;
  canonicalRetailerUrlRevalidation: true;
  serverDerivedExecutionSupport: true;
  monotonicSourceObservation: true;
  candidateUpsertParity: true;
  listingUpsertParity: true;
  sourceReferenceUpsertParity: true;
  preferredRetailerRouteParity: true;
  idempotentOfferObservation: true;
  existingMissionTargetAttachmentParity: true;
  optionalSyncItemCompositionParity: true;
  atomicCatalogSyncAuditOutbox: true;
  databaseOwnedTimestamps: true;
  privacyBoundedReceipts: true;
  currentSourceOwnershipRevalidation: true;
  currentDeviceOwnershipRevalidation: true;
  currentRunOwnershipRevalidation: true;
  activeDeviceOnly: true;
  activeRunItemOnly: true;
  privateSourceOnly: true;
  trackalackerOnly: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: false;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: true;
  writerLockProtocolParity: false;
  operationCount: 1;
  maximumListingsPerItem: 250;
  supportedExecutionRetailerCount: typeof SUPPORTED_EXECUTION_RETAILER_COUNT;
  protectedTenantTableCount: 14;
  forcedRlsTableCount: 14;
  tenantMutationTableCount: 11;
  protectedSharedCatalogTableCount: 5;
  sharedCatalogMutationTableCount: 4;
  totalMutationTableCount: 15;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: true;
  actionAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalCatalogImportApplyResult {
  contractVersion: 1;
  operation: PostgresSignalCatalogImportOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  familyCreated: boolean;
  variantCreated: boolean;
  variantId: string;
  candidatesAccepted: number;
  listingsMapped: number;
  listingsCreated: number;
  offerObservationsCreated: number;
  missionTargetsCreated: number;
  preferredRoutesUpdated: number;
  sourceProductRefMutated: boolean;
  sourceAliasMutated: boolean;
  syncItemMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  syncReceipt: Record<string, unknown> | null;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: false;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  configurationWriterParity: false;
  reservationWriterParity: true;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: true;
  actionAuthority: false;
  runtimeAuthority: false;
}

export interface NodePostgresSignalCatalogImportApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalCatalogImportCapabilityProjection> | null = null;

export class PostgresSignalCatalogImportApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalCatalogImportApplyQualificationError";
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
    throw new PostgresSignalCatalogImportApplyQualificationError(
      "The PostgreSQL catalog-import schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalCatalogImportApplyQualificationError(
      "The PostgreSQL catalog-import role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_catalog_import`;
  if (value.length > 63) {
    throw new PostgresSignalCatalogImportApplyQualificationError(
      "The PostgreSQL catalog-import role name exceeds PostgreSQL's limit."
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
    `pg_catalog.octet_length((${part}))::text || ':' || (${part})`
  )).join(" || '|' || ");
}

function centsIdentity(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function catalogListingIdentity(
  listing: PostgresSignalCatalogImportListingPayload
): string {
  return stableHashInput([
    String(listing?.sourceListingId ?? ""),
    String(listing?.storeName ?? ""),
    String(listing?.retailerId ?? ""),
    String(listing?.retailerSku ?? ""),
    String(listing?.canonicalUrl ?? ""),
    String(listing?.sourceListingUrl ?? ""),
    String(listing?.outboundUrl ?? ""),
    String(listing?.availability ?? ""),
    centsIdentity(listing?.unitPriceCents)
  ]);
}

function catalogListingsIdentity(
  listings: PostgresSignalCatalogImportListingPayload[]
): string {
  return (Array.isArray(listings) ? listings : []).map(catalogListingIdentity).join("\n");
}

export function buildPostgresSignalCatalogImportRequestId(
  principal: BackgroundWorkerPrincipal,
  operation: PostgresSignalCatalogImportOperation,
  payload: PostgresSignalCatalogImportPayload
): string {
  const parts = [
    "postgres-signal-catalog-import-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    String(operation ?? ""),
    String(payload?.deviceId ?? ""),
    String(payload?.sourceConnectionId ?? ""),
    String(payload?.syncId ?? ""),
    String(payload?.sourceProductId ?? ""),
    String(payload?.sourceProductSlug ?? ""),
    String(payload?.sourceProductUrl ?? ""),
    String(payload?.title ?? ""),
    centsIdentity(payload?.msrpCents),
    String(payload?.observedAt ?? ""),
    String(Array.isArray(payload?.listings) ? payload.listings.length : ""),
    catalogListingsIdentity(payload?.listings),
    String(payload?.confirmation ?? "")
  ];
  return `catalog_import_${createHash("sha256").update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalCatalogImportApplyManifest(
  predecessorManifest = buildPostgresSignalReservationLifecycleApplyManifest(),
  requestedRoleNamespace = "yoink_catalog_import_q"
): PostgresSignalCatalogImportApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const catalogImportRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(catalogImportRoleNamespace)) {
    throw new PostgresSignalCatalogImportApplyQualificationError(
      "The PostgreSQL catalog-import role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalCatalogImportApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    reservationLifecycleApplyContractVersion:
      POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    catalogImportRoleNamespace,
    reservationLifecycleApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    catalogImportRole: {
      kind: "signal_catalog_import_apply_boundary",
      name: roleName(catalogImportRoleNamespace),
      functionName: POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      protectedSharedCatalogTableNames: [...PROTECTED_SHARED_CATALOG_TABLES],
      sharedCatalogMutationTableNames: [...SHARED_CATALOG_MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    maximumListingsPerItem: MAXIMUM_LISTINGS_PER_ITEM,
    supportedExecutionRetailerCount: SUPPORTED_EXECUTION_RETAILER_COUNT,
    protectedTenantTableCount: PROTECTED_TENANT_TABLES.length,
    forcedRlsTableCount: PROTECTED_TENANT_TABLES.length,
    tenantMutationTableCount: MUTATION_TABLES.length,
    protectedSharedCatalogTableCount: PROTECTED_SHARED_CATALOG_TABLES.length,
    sharedCatalogMutationTableCount: SHARED_CATALOG_MUTATION_TABLES.length,
    totalMutationTableCount:
      (MUTATION_TABLES.length + SHARED_CATALOG_MUTATION_TABLES.length) as 15,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    sourceScopeConsumed: true,
    deterministicRequestIdentity: true,
    immutableAuditedReplay: true,
    boundedCatalogPayload: true,
    completeSetIdentityConsensus: true,
    crossTenantCatalogSerialization: true,
    sourceProductConflictFailClosed: true,
    sourceAliasConflictFailClosed: true,
    sourceListingConflictFailClosed: true,
    sourceCandidateConflictFailClosed: true,
    registeredRetailerRevalidation: true,
    canonicalRetailerUrlRevalidation: true,
    serverDerivedExecutionSupport: true,
    monotonicSourceObservation: true,
    candidateUpsertParity: true,
    listingUpsertParity: true,
    sourceReferenceUpsertParity: true,
    preferredRetailerRouteParity: true,
    idempotentOfferObservation: true,
    existingMissionTargetAttachmentParity: true,
    optionalSyncItemCompositionParity: true,
    atomicCatalogSyncAuditOutbox: true,
    databaseOwnedTimestamps: true,
    privacyBoundedReceipts: true,
    currentSourceOwnershipRevalidation: true,
    currentDeviceOwnershipRevalidation: true,
    currentRunOwnershipRevalidation: true,
    activeDeviceOnly: true,
    activeRunItemOnly: true,
    privateSourceOnly: true,
    trackalackerOnly: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    catalogImportWriterParity: true,
    connectionProvisioningWriterParity: false,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: true,
    writerLockProtocolParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function signalCatalogImportApplyFunctionSource(
  manifest = buildPostgresSignalCatalogImportApplyManifest()
): string {
  const listingIdentityParts = stableHashInputSql([
    "candidate.value->>'sourceListingId'",
    "candidate.value->>'storeName'",
    "candidate.value->>'retailerId'",
    "candidate.value->>'retailerSku'",
    "candidate.value->>'canonicalUrl'",
    "candidate.value->>'sourceListingUrl'",
    "candidate.value->>'outboundUrl'",
    "candidate.value->>'availability'",
    "COALESCE(candidate.value->>'unitPriceCents', '')"
  ]);
  const requestIdentityParts = stableHashInputSql([
    "'postgres-signal-catalog-import-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "operation_name",
    "device_id_value",
    "source_connection_id_value",
    "sync_id_value",
    "source_product_id_value",
    "source_product_slug_value",
    "source_product_url_value",
    "title_value",
    "COALESCE(msrp_cents_value::text, '')",
    "observed_at_value",
    "listing_count::text",
    "listings_identity_value",
    `'${POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONFIRMATION}'::text`
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
  sync_id_value TEXT;
  source_product_id_value TEXT;
  source_product_slug_value TEXT;
  source_product_url_value TEXT;
  title_value TEXT;
  msrp_cents_text_value TEXT;
  msrp_cents_value BIGINT;
  observed_at_value TEXT;
  listings_value JSONB;
  listing_count BIGINT;
  listings_identity_value TEXT;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  device_record RECORD;
  source_record RECORD;
  sync_run_record RECORD;
  sync_run_found BOOLEAN := FALSE;
  sync_run_phase_value TEXT := '';
  product_ref_record RECORD;
  product_ref_found BOOLEAN := FALSE;
  product_ref_variant_id_value TEXT := '';
  alias_record RECORD;
  alias_found BOOLEAN := FALSE;
  alias_variant_id_value TEXT := '';
  identity_variant_id_value TEXT := '';
  identity_variant_count BIGINT := 0;
  family_id_value TEXT := '';
  variant_id_value TEXT := '';
  family_created_value BOOLEAN := FALSE;
  variant_created_value BOOLEAN := FALSE;
  listing_record RECORD;
  preferred_record RECORD;
  existing_listing_record RECORD;
  existing_candidate_record RECORD;
  existing_source_listing_record RECORD;
  existing_mission_record RECORD;
  existing_preferred_record RECORD;
  source_listing_id_value TEXT;
  store_name_value TEXT;
  retailer_id_value TEXT;
  retailer_sku_value TEXT;
  canonical_url_value TEXT;
  source_listing_url_value TEXT;
  outbound_url_value TEXT;
  availability_value TEXT;
  unit_price_cents_value BIGINT;
  retailer_execution_supported_value BIGINT;
  mapped_listing BOOLEAN;
  listing_id_value TEXT;
  candidate_id_value TEXT;
  listing_url_id_value TEXT;
  source_listing_ref_id_value TEXT;
  mission_target_id_value TEXT;
  observation_id_value TEXT;
  source_product_ref_id_value TEXT;
  source_alias_id_value TEXT;
  sync_item_id_value TEXT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  mutation_timestamp TEXT;
  candidates_accepted_value BIGINT := 0;
  listings_mapped_value BIGINT := 0;
  listings_created_value BIGINT := 0;
  offer_observations_created_value BIGINT := 0;
  mission_targets_created_value BIGINT := 0;
  preferred_routes_updated_value BIGINT := 0;
  mutation_statement_count BIGINT := 0;
  mutation_row_count BIGINT := 0;
  affected_rows BIGINT := 0;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  replay_result JSONB;
  result_value JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
  sync_receipt_value JSONB := 'null'::jsonb;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR operation_name <> 'import_trackalacker_catalog_item'
    OR request_id !~ '^catalog_import_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import payload is invalid';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) <> 'object'
    OR request_payload - ARRAY[
      'confirmation', 'deviceId', 'listings', 'msrpCents', 'observedAt',
      'sourceConnectionId', 'sourceProductId', 'sourceProductSlug',
      'sourceProductUrl', 'syncId', 'title'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request_payload->'deviceId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request_payload->'sourceConnectionId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request_payload->'syncId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request_payload->'sourceProductId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request_payload->'sourceProductSlug') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request_payload->'sourceProductUrl') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request_payload->'title') IS DISTINCT FROM 'string'
    OR COALESCE(pg_catalog.jsonb_typeof(request_payload->'msrpCents'), '') NOT IN ('number', 'null')
    OR pg_catalog.jsonb_typeof(request_payload->'observedAt') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request_payload->'listings') IS DISTINCT FROM 'array'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import payload shape is invalid';
  END IF;

  device_id_value := request_payload->>'deviceId';
  source_connection_id_value := request_payload->>'sourceConnectionId';
  sync_id_value := request_payload->>'syncId';
  source_product_id_value := request_payload->>'sourceProductId';
  source_product_slug_value := request_payload->>'sourceProductSlug';
  source_product_url_value := request_payload->>'sourceProductUrl';
  title_value := request_payload->>'title';
  observed_at_value := request_payload->>'observedAt';
  listings_value := request_payload->'listings';
  listing_count := pg_catalog.jsonb_array_length(listings_value);
  msrp_cents_text_value := COALESCE(request_payload->>'msrpCents', '');
  IF pg_catalog.jsonb_typeof(request_payload->'msrpCents') = 'number'
    AND (msrp_cents_text_value !~ '^[1-9][0-9]*$'
      OR msrp_cents_text_value::numeric > 100000000) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import product price is invalid';
  END IF;
  msrp_cents_value := CASE WHEN pg_catalog.jsonb_typeof(request_payload->'msrpCents') = 'null'
    THEN NULL ELSE msrp_cents_text_value::bigint END;

  IF device_id_value !~ '^[A-Za-z0-9_-]{3,120}$'
    OR source_connection_id_value !~ '^[A-Za-z0-9_-]{3,120}$'
    OR (sync_id_value <> '' AND sync_id_value !~ '^tlsync_[A-Za-z0-9_-]{8,112}$')
    OR source_product_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
    OR source_product_slug_value !~ '^(?:|[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?)$'
    OR source_product_url_value !~ '^https://(?:www\\.)?trackalacker\\.com/[^#]*$'
    OR pg_catalog.length(source_product_url_value) > 4096
    OR title_value = '' OR pg_catalog.length(title_value) > 300
    OR title_value <> pg_catalog.btrim(title_value) OR title_value ~ '[[:cntrl:]]'
    OR (msrp_cents_value IS NOT NULL AND (msrp_cents_value <= 0 OR msrp_cents_value > 100000000))
    OR observed_at_value !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
    OR listing_count > ${MAXIMUM_LISTINGS_PER_ITEM} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import product identity is invalid';
  END IF;
  BEGIN
    IF pg_catalog.to_char(observed_at_value::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> observed_at_value
      OR observed_at_value::timestamptz > pg_catalog.statement_timestamp() + INTERVAL '5 minutes' THEN
      RAISE EXCEPTION 'timestamp mismatch';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import observation timestamp is invalid';
  END;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(listings_value) WITH ORDINALITY AS candidate(value, ordinality)
    WHERE pg_catalog.jsonb_typeof(candidate.value) <> 'object'
      OR candidate.value - ARRAY[
        'availability', 'canonicalUrl', 'outboundUrl', 'retailerId',
        'retailerSku', 'sourceListingId', 'sourceListingUrl', 'storeName',
        'unitPriceCents'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
      OR pg_catalog.jsonb_typeof(candidate.value->'sourceListingId') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(candidate.value->'storeName') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(candidate.value->'retailerId') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(candidate.value->'retailerSku') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(candidate.value->'canonicalUrl') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(candidate.value->'sourceListingUrl') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(candidate.value->'outboundUrl') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(candidate.value->'availability') IS DISTINCT FROM 'string'
      OR COALESCE(pg_catalog.jsonb_typeof(candidate.value->'unitPriceCents'), '') NOT IN ('number', 'null')
      OR candidate.value->>'sourceListingId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
      OR candidate.value->>'storeName' = ''
      OR pg_catalog.length(candidate.value->>'storeName') > 120
      OR candidate.value->>'storeName' <> pg_catalog.btrim(candidate.value->>'storeName')
      OR candidate.value->>'storeName' ~ '[[:cntrl:]]'
      OR candidate.value->>'retailerId' !~ '^(?:|[a-z0-9][a-z0-9_-]{0,59})$'
      OR candidate.value->>'retailerSku' !~ '^(?:|[A-Z0-9][A-Z0-9._-]{1,63})$'
      OR pg_catalog.length(candidate.value->>'canonicalUrl') > 4096
      OR candidate.value->>'sourceListingUrl' !~ '^https://(?:www\\.)?trackalacker\\.com/[^#]*$'
      OR pg_catalog.length(candidate.value->>'sourceListingUrl') > 4096
      OR (candidate.value->>'outboundUrl' <> '' AND (
        candidate.value->>'outboundUrl' !~ '^https://[^/?#@]+(?:/[^#]*)?$'
        OR pg_catalog.length(candidate.value->>'outboundUrl') > 4096
      ))
      OR candidate.value->>'availability' NOT IN ('in_stock', 'preorder', 'out_of_stock', 'unknown')
      OR (pg_catalog.jsonb_typeof(candidate.value->'unitPriceCents') = 'number' AND (
        candidate.value->>'unitPriceCents' !~ '^[1-9][0-9]*$'
        OR (candidate.value->>'unitPriceCents')::numeric > 100000000
      ))
      OR (candidate.value->>'retailerId' = '' AND (
        candidate.value->>'retailerSku' <> '' OR candidate.value->>'canonicalUrl' <> ''
      ))
      OR (candidate.value->>'canonicalUrl' <> '' AND (
        candidate.value->>'retailerId' = '' OR candidate.value->>'retailerSku' = ''
      ))
  ) OR (
    SELECT COUNT(DISTINCT candidate.value->>'sourceListingId')
    FROM pg_catalog.jsonb_array_elements(listings_value) AS candidate(value)
  ) <> listing_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import listing set is invalid';
  END IF;

  FOR listing_record IN
    SELECT candidate.value, candidate.ordinality
    FROM pg_catalog.jsonb_array_elements(listings_value) WITH ORDINALITY AS candidate(value, ordinality)
    ORDER BY candidate.ordinality
  LOOP
    retailer_id_value := listing_record.value->>'retailerId';
    retailer_sku_value := listing_record.value->>'retailerSku';
    canonical_url_value := listing_record.value->>'canonicalUrl';
    mapped_listing := retailer_id_value <> '' AND retailer_sku_value <> '' AND canonical_url_value <> '';
    IF mapped_listing THEN
      SELECT retailer.execution_supported
        INTO retailer_execution_supported_value
      FROM ${relation(manifest.schemaName, "retailers")} AS retailer
      WHERE retailer.id = retailer_id_value;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import retailer is not registered';
      END IF;
      IF NOT (CASE retailer_id_value
        WHEN 'target' THEN canonical_url_value = 'https://www.target.com/p/-/A-' || retailer_sku_value
        WHEN 'walmart' THEN canonical_url_value = 'https://www.walmart.com/ip/' || retailer_sku_value
        WHEN 'amazon' THEN canonical_url_value = 'https://www.amazon.com/dp/' || retailer_sku_value
        WHEN 'bestbuy' THEN canonical_url_value = 'https://www.bestbuy.com/site/-/' || retailer_sku_value || '.p'
        WHEN 'riot' THEN canonical_url_value = 'https://merch.riotgames.com/en-us/product/' || pg_catalog.lower(retailer_sku_value) || '/'
        WHEN 'booksamillion' THEN canonical_url_value = 'https://www.booksamillion.com/p/-/' || retailer_sku_value
        WHEN 'pbandai' THEN canonical_url_value = 'https://p-bandai.com/us/item/' || retailer_sku_value
        WHEN 'asus' THEN retailer_sku_value ~ '^[A-Z0-9]{8}-[A-Z0-9]{6}$'
          AND canonical_url_value ~ ('^https://eshop[.]asus[.]com/us/' || lower(retailer_sku_value) || '-[a-z0-9-]+[.]html$')
        WHEN 'audioadvice' THEN retailer_sku_value ~ '^[0-9]{10,20}$'
      AND canonical_url_value ~ ('^https://www[.]audioadvice[.]com/products/[a-z0-9-]+/?[?]variant=' || retailer_sku_value || '$')
    WHEN 'bananarepublic' THEN retailer_sku_value ~ '^[0-9]{9}0000$'
      AND canonical_url_value ~ ('^https://bananarepublic[.]gap[.]com/browse/product[.]do[?]pid=' || retailer_sku_value || '$')
    WHEN 'bananarepublicfactory' THEN retailer_sku_value ~ '^[0-9]{10}0000$'
      AND canonical_url_value ~ ('^https://bananarepublicfactory[.]gapfactory[.]com/browse/product[.]do[?]pid=' || retailer_sku_value || '$')
    WHEN 'athleta' THEN retailer_sku_value ~ '^[0-9]{9}0000$'
          AND canonical_url_value ~ ('^https://athleta[.]gap[.]com/browse/product[.]do[?]pid=' || retailer_sku_value || '$')
        WHEN 'americaneagle' THEN retailer_sku_value ~ '^\\d{10}$'
          AND canonical_url_value ~ ('^https://www[.]ae[.]com/us/en/p/([a-z0-9-]+/)*[0-9]{4}_[0-9]{4}_[0-9]{3}/?[?]sku=' || retailer_sku_value || '$')
        WHEN 'aninebing' THEN retailer_sku_value ~ '^\\d{10,20}$'
          AND canonical_url_value ~ ('^https://www[.]aninebing[.]com/products/[a-z0-9-]+/?[?]variant=' || retailer_sku_value || '$')
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
          AND pg_catalog.strpos(pg_catalog.replace(canonical_url_value, '%2B', '+'),
            '+p-' || retailer_sku_value) > 0
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
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import canonical retailer identity is invalid';
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(pg_catalog.string_agg(${listingIdentityParts}, E'\\n' ORDER BY candidate.ordinality), '')
    INTO listings_identity_value
  FROM pg_catalog.jsonb_array_elements(listings_value) WITH ORDINALITY AS candidate(value, ordinality);

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
  derived_request_id := 'catalog_import_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${requestIdentityParts}, 'UTF8')), 'hex'
  ), 1, 32);
  IF request_id <> derived_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import request identity is invalid';
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
    OR writer_lock_result->'lockScopeOrder' IS DISTINCT FROM
      pg_catalog.jsonb_build_array('source', 'retailer_qualification', 'settings', 'mission_policy', 'spend')
    OR writer_lock_result->>'mutationApplied' <> 'false'
    OR writer_lock_result->>'mutationAuthority' <> 'false'
    OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal catalog-import shared writer-lock protocol failed';
  END IF;

  SELECT device.id, device.status
    INTO device_record
  FROM ${relation(manifest.schemaName, "extension_devices")} AS device
  WHERE device.id = device_id_value
    AND device.tenant_id = resolved_tenant_id
    AND device.user_id = resolved_user_id
  FOR UPDATE OF device;
  IF NOT FOUND OR device_record.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal catalog-import device is unavailable';
  END IF;
  SELECT connection.id, connection.source, connection.is_private,
         connection.last_event_at, connection.updated_at
    INTO source_record
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = source_connection_id_value
    AND connection.tenant_id = resolved_tenant_id
    AND connection.user_id = resolved_user_id
  FOR UPDATE OF connection;
  IF NOT FOUND OR source_record.source <> 'trackalacker' OR source_record.is_private <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal catalog-import source is unavailable';
  END IF;

  IF sync_id_value <> '' THEN
    SELECT run.id, run.source_connection_id, run.device_id, run.phase,
           run.updated_at, run.completed_at
      INTO sync_run_record
    FROM ${relation(manifest.schemaName, "source_sync_runs")} AS run
    WHERE run.id = sync_id_value
      AND run.tenant_id = resolved_tenant_id
      AND run.user_id = resolved_user_id
    FOR UPDATE OF run;
    sync_run_found := FOUND;
    IF NOT sync_run_found OR sync_run_record.source_connection_id <> source_connection_id_value
      OR sync_run_record.device_id IS DISTINCT FROM device_id_value THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal catalog-import sync run ownership is invalid';
    END IF;
    sync_run_phase_value := sync_run_record.phase;
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(request_payload::text, 'UTF8')
  ), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_catalog_import_request_v1|' ||
      resolved_tenant_id || '|' || resolved_user_id || '|' || request_id, 'UTF8')
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_catalog_import_outbox_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);
  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal catalog-import request graph is partial';
  END IF;
  IF audit_count = 1 THEN
    SELECT audit.event_type, audit.reason_code, audit.message,
           audit.data_json::jsonb AS audit_data,
           outbox.aggregate_type, outbox.aggregate_id,
           outbox.event_type AS outbox_event_type,
           outbox.payload_json::jsonb AS outbox_payload
      INTO replay_record
    FROM ${relation(manifest.schemaName, "audit_events")} AS audit
    JOIN ${relation(manifest.schemaName, "outbox_events")} AS outbox
      ON outbox.id = outbox_id_value
    WHERE audit.id = audit_id_value;
    replay_result := replay_record.audit_data->'result';
    IF replay_record.event_type <> 'trackalacker_catalog_item_imported'
      OR replay_record.reason_code <> 'catalog_item_imported'
      OR replay_record.message <> 'A bounded TrackaLacker catalog item was imported.'
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR replay_result IS NULL OR replay_result->>'requestId' <> request_id
      OR replay_result->>'requestFingerprint' <> request_fingerprint_value
      OR replay_result->>'outcome' <> 'applied'
      OR replay_result->>'catalogImportWriterParity' <> 'true'
      OR replay_result->>'connectionProvisioningWriterParity' <> 'false'
      OR replay_result->>'sourceWriterParity' <> 'false'
      OR replay_result->>'runtimeAuthority' <> 'false'
      OR replay_record.aggregate_type <> 'source_catalog_import'
      OR replay_record.aggregate_id <> request_id
      OR replay_record.outbox_event_type <> 'trackalacker_catalog_item_imported'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'requestFingerprint' <> request_fingerprint_value THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal catalog-import replay receipt is inconsistent';
    END IF;
    RETURN QUERY SELECT (replay_result || pg_catalog.jsonb_build_object(
      'outcome', 'already_applied', 'mutationApplied', FALSE,
      'idempotentReplay', TRUE, 'mutationStatementCount', 0,
      'mutationRowCount', 0, 'sourceProductRefMutated', FALSE,
      'sourceAliasMutated', FALSE, 'syncItemMutated', FALSE,
      'auditMutated', FALSE, 'outboxMutated', FALSE
    ))::text;
    RETURN;
  END IF;

  IF sync_id_value <> '' AND sync_run_phase_value NOT IN ('starting', 'discovering', 'importing') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal catalog-import sync run is not active';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_catalog_import_source_v1:' || source_connection_id_value || ':' ||
      source_product_id_value || ':' || source_product_slug_value, 0
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_catalog_apply_v1:' || identity.retailer_id || ':' || identity.retailer_sku, 0
  ))
  FROM (
    SELECT DISTINCT candidate.value->>'retailerId' AS retailer_id,
                    candidate.value->>'retailerSku' AS retailer_sku
    FROM pg_catalog.jsonb_array_elements(listings_value) AS candidate(value)
    WHERE candidate.value->>'retailerId' <> ''
      AND candidate.value->>'retailerSku' <> ''
      AND candidate.value->>'canonicalUrl' <> ''
    ORDER BY retailer_id, retailer_sku
  ) AS identity;

  SELECT reference.variant_id, reference.observed_at
    INTO product_ref_record
  FROM ${relation(manifest.schemaName, "source_product_refs")} AS reference
  WHERE reference.source_connection_id = source_connection_id_value
    AND reference.external_product_id = source_product_id_value
  FOR UPDATE OF reference;
  product_ref_found := FOUND;
  IF product_ref_found THEN
    product_ref_variant_id_value := product_ref_record.variant_id;
    IF product_ref_record.observed_at > observed_at_value THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import source product observation is stale';
    END IF;
  END IF;
  IF source_product_slug_value <> '' THEN
    SELECT alias.variant_id, alias.observed_at
      INTO alias_record
    FROM ${relation(manifest.schemaName, "source_product_aliases")} AS alias
    WHERE alias.source_connection_id = source_connection_id_value
      AND alias.alias_kind = 'trackalacker_slug'
      AND alias.alias_value = source_product_slug_value
    FOR UPDATE OF alias;
    alias_found := FOUND;
    IF alias_found THEN
      alias_variant_id_value := alias_record.variant_id;
      IF alias_record.observed_at > observed_at_value THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import source alias observation is stale';
      END IF;
    END IF;
  END IF;

  SELECT COUNT(DISTINCT identity.variant_id), MIN(identity.variant_id)
    INTO identity_variant_count, identity_variant_id_value
  FROM (
    SELECT product_ref_variant_id_value AS variant_id
    WHERE product_ref_variant_id_value <> ''
    UNION
    SELECT alias_variant_id_value AS variant_id
    WHERE alias_variant_id_value <> ''
    UNION
    SELECT shared_listing.variant_id
    FROM pg_catalog.jsonb_array_elements(listings_value) AS candidate(value)
    JOIN ${relation(manifest.schemaName, "listings")} AS shared_listing
      ON shared_listing.retailer_id = candidate.value->>'retailerId'
     AND shared_listing.retailer_sku = candidate.value->>'retailerSku'
    WHERE candidate.value->>'retailerId' <> ''
      AND candidate.value->>'retailerSku' <> ''
      AND candidate.value->>'canonicalUrl' <> ''
    UNION
    SELECT source_candidate.variant_id
    FROM pg_catalog.jsonb_array_elements(listings_value) AS candidate(value)
    JOIN ${relation(manifest.schemaName, "source_listing_candidates")} AS source_candidate
      ON source_candidate.source_connection_id = source_connection_id_value
     AND source_candidate.external_listing_id = candidate.value->>'sourceListingId'
    UNION
    SELECT shared_listing.variant_id
    FROM pg_catalog.jsonb_array_elements(listings_value) AS candidate(value)
    JOIN ${relation(manifest.schemaName, "source_listing_refs")} AS source_reference
      ON source_reference.source_connection_id = source_connection_id_value
     AND source_reference.external_listing_id = candidate.value->>'sourceListingId'
    JOIN ${relation(manifest.schemaName, "listings")} AS shared_listing
      ON shared_listing.id = source_reference.listing_id
  ) AS identity;
  identity_variant_id_value := COALESCE(identity_variant_id_value, '');
  IF identity_variant_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal catalog-import exact identities resolve to different variants';
  END IF;
  mutation_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  IF identity_variant_count = 0 THEN
    family_id_value := 'family_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to('postgres_catalog_import_family_v1|' || request_id, 'UTF8')
    ), 'hex'), 1, 32);
    variant_id_value := 'variant_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to('postgres_catalog_import_variant_v1|' || request_id, 'UTF8')
    ), 'hex'), 1, 32);
    INSERT INTO ${relation(manifest.schemaName, "product_families")}(
      id, title, brand, created_at, updated_at
    ) VALUES (family_id_value, title_value, '', mutation_timestamp, mutation_timestamp);
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    mutation_statement_count := mutation_statement_count + 1;
    mutation_row_count := mutation_row_count + affected_rows;
    INSERT INTO ${relation(manifest.schemaName, "variants")}(
      id, family_id, title, attributes_json, created_at, updated_at
    ) VALUES (variant_id_value, family_id_value, title_value, '{}', mutation_timestamp, mutation_timestamp);
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    mutation_statement_count := mutation_statement_count + 1;
    mutation_row_count := mutation_row_count + affected_rows;
    family_created_value := TRUE;
    variant_created_value := TRUE;
  ELSE
    variant_id_value := identity_variant_id_value;
  END IF;

  source_product_ref_id_value := 'source_product_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to('postgres_catalog_import_product_ref_v1|' ||
      source_connection_id_value || '|' || source_product_id_value, 'UTF8')
  ), 'hex'), 1, 32);
  INSERT INTO ${relation(manifest.schemaName, "source_product_refs")}(
    id, source_connection_id, external_product_id, variant_id,
    source_url, source_title, observed_at
  ) VALUES (
    source_product_ref_id_value, source_connection_id_value, source_product_id_value,
    variant_id_value, source_product_url_value, title_value, observed_at_value
  ) ON CONFLICT(source_connection_id, external_product_id) DO UPDATE SET
    source_url = excluded.source_url, source_title = excluded.source_title,
    observed_at = excluded.observed_at
  WHERE ${relation(manifest.schemaName, "source_product_refs")}.variant_id = excluded.variant_id;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal catalog-import source product conflicts with another variant';
  END IF;
  mutation_statement_count := mutation_statement_count + 1;
  mutation_row_count := mutation_row_count + affected_rows;

  IF source_product_slug_value <> '' THEN
    source_alias_id_value := 'source_alias_' || pg_catalog.substr(pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to('postgres_catalog_import_alias_v1|' ||
        source_connection_id_value || '|' || source_product_slug_value, 'UTF8')
    ), 'hex'), 1, 32);
    INSERT INTO ${relation(manifest.schemaName, "source_product_aliases")}(
      id, source_connection_id, alias_kind, alias_value, variant_id, observed_at
    ) VALUES (
      source_alias_id_value, source_connection_id_value, 'trackalacker_slug',
      source_product_slug_value, variant_id_value, observed_at_value
    ) ON CONFLICT(source_connection_id, alias_kind, alias_value) DO UPDATE SET
      observed_at = excluded.observed_at
    WHERE ${relation(manifest.schemaName, "source_product_aliases")}.variant_id = excluded.variant_id;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal catalog-import source alias conflicts with another variant';
    END IF;
    mutation_statement_count := mutation_statement_count + 1;
    mutation_row_count := mutation_row_count + affected_rows;
  END IF;

  FOR listing_record IN
    SELECT candidate.value, candidate.ordinality
    FROM pg_catalog.jsonb_array_elements(listings_value) WITH ORDINALITY AS candidate(value, ordinality)
    ORDER BY candidate.ordinality
  LOOP
    source_listing_id_value := listing_record.value->>'sourceListingId';
    store_name_value := listing_record.value->>'storeName';
    retailer_id_value := listing_record.value->>'retailerId';
    retailer_sku_value := listing_record.value->>'retailerSku';
    canonical_url_value := listing_record.value->>'canonicalUrl';
    source_listing_url_value := listing_record.value->>'sourceListingUrl';
    outbound_url_value := listing_record.value->>'outboundUrl';
    availability_value := listing_record.value->>'availability';
    unit_price_cents_value := CASE
      WHEN pg_catalog.jsonb_typeof(listing_record.value->'unitPriceCents') = 'null'
      THEN NULL ELSE (listing_record.value->>'unitPriceCents')::bigint END;
    mapped_listing := retailer_id_value <> '' AND retailer_sku_value <> '' AND canonical_url_value <> '';

    SELECT candidate.id, candidate.variant_id, candidate.observed_at
      INTO existing_candidate_record
    FROM ${relation(manifest.schemaName, "source_listing_candidates")} AS candidate
    WHERE candidate.source_connection_id = source_connection_id_value
      AND candidate.external_listing_id = source_listing_id_value
    FOR UPDATE OF candidate;
    IF FOUND AND (existing_candidate_record.variant_id <> variant_id_value
      OR existing_candidate_record.observed_at > observed_at_value) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal catalog-import source candidate conflicts with the exact product';
    END IF;
    candidate_id_value := 'source_candidate_' || pg_catalog.substr(pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to('postgres_catalog_import_candidate_v1|' ||
        source_connection_id_value || '|' || source_listing_id_value, 'UTF8')
    ), 'hex'), 1, 32);
    INSERT INTO ${relation(manifest.schemaName, "source_listing_candidates")}(
      id, source_connection_id, external_product_id, external_listing_id, variant_id,
      store_name, retailer_id, retailer_sku, source_url, outbound_url,
      availability, unit_price_cents, observed_at, updated_at
    ) VALUES (
      candidate_id_value, source_connection_id_value, source_product_id_value,
      source_listing_id_value, variant_id_value, store_name_value, retailer_id_value,
      retailer_sku_value, source_listing_url_value, outbound_url_value,
      availability_value, unit_price_cents_value, observed_at_value, mutation_timestamp
    ) ON CONFLICT(source_connection_id, external_listing_id) DO UPDATE SET
      external_product_id = excluded.external_product_id,
      store_name = excluded.store_name, retailer_id = excluded.retailer_id,
      retailer_sku = excluded.retailer_sku, source_url = excluded.source_url,
      outbound_url = excluded.outbound_url, availability = excluded.availability,
      unit_price_cents = excluded.unit_price_cents,
      observed_at = excluded.observed_at, updated_at = excluded.updated_at
    WHERE ${relation(manifest.schemaName, "source_listing_candidates")}.variant_id = excluded.variant_id;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal catalog-import source candidate mutation is ambiguous';
    END IF;
    mutation_statement_count := mutation_statement_count + 1;
    mutation_row_count := mutation_row_count + affected_rows;
    candidates_accepted_value := candidates_accepted_value + 1;

    IF mapped_listing THEN
      SELECT shared_listing.id, shared_listing.variant_id
        INTO existing_listing_record
      FROM ${relation(manifest.schemaName, "listings")} AS shared_listing
      WHERE shared_listing.retailer_id = retailer_id_value
        AND shared_listing.retailer_sku = retailer_sku_value
      FOR UPDATE OF shared_listing;
      IF FOUND THEN
        IF existing_listing_record.variant_id <> variant_id_value THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal catalog-import retailer listing conflicts with another variant';
        END IF;
        listing_id_value := existing_listing_record.id;
      ELSE
        listing_id_value := 'listing_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to('postgres_catalog_listing_v1|' || retailer_id_value || '|' || retailer_sku_value, 'UTF8')
        ), 'hex'), 1, 32);
        listings_created_value := listings_created_value + 1;
      END IF;
      SELECT retailer.execution_supported
        INTO retailer_execution_supported_value
      FROM ${relation(manifest.schemaName, "retailers")} AS retailer
      WHERE retailer.id = retailer_id_value;
      INSERT INTO ${relation(manifest.schemaName, "listings")}(
        id, variant_id, retailer_id, retailer_sku, canonical_url, status,
        execution_supported, msrp_cents, currency, created_at, updated_at
      ) VALUES (
        listing_id_value, variant_id_value, retailer_id_value, retailer_sku_value,
        canonical_url_value, availability_value,
        CASE WHEN retailer_execution_supported_value = 1
          AND retailer_id_value IN ('target', 'walmart', 'amazon', 'bestbuy', 'pokemoncenter', 'aninebing', 'americaneagle', 'asus', 'athleta', 'audioadvice', 'bananarepublic', 'bananarepublicfactory') THEN 1 ELSE 0 END,
        msrp_cents_value, 'USD', mutation_timestamp, mutation_timestamp
      ) ON CONFLICT(retailer_id, retailer_sku) DO UPDATE SET
        canonical_url = excluded.canonical_url, status = excluded.status,
        execution_supported = excluded.execution_supported,
        msrp_cents = COALESCE(excluded.msrp_cents,
          ${relation(manifest.schemaName, "listings")}.msrp_cents),
        currency = excluded.currency, updated_at = excluded.updated_at
      WHERE ${relation(manifest.schemaName, "listings")}.variant_id = excluded.variant_id;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal catalog-import retailer listing mutation is ambiguous';
      END IF;
      mutation_statement_count := mutation_statement_count + 1;
      mutation_row_count := mutation_row_count + affected_rows;
      listings_mapped_value := listings_mapped_value + 1;

      listing_url_id_value := 'listing_url_' || pg_catalog.substr(pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to('postgres_catalog_listing_url_v1|' ||
          listing_id_value || '|canonical|' || canonical_url_value, 'UTF8')
      ), 'hex'), 1, 32);
      INSERT INTO ${relation(manifest.schemaName, "listing_urls")}(
        id, listing_id, kind, url, active, observed_at
      ) VALUES (listing_url_id_value, listing_id_value, 'canonical', canonical_url_value, 1, observed_at_value)
      ON CONFLICT(listing_id, kind, url) DO NOTHING;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      mutation_statement_count := mutation_statement_count + 1;
      mutation_row_count := mutation_row_count + affected_rows;

      listing_url_id_value := 'listing_url_' || pg_catalog.substr(pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to('postgres_catalog_listing_url_v1|' ||
          listing_id_value || '|source_listing|' || source_listing_url_value, 'UTF8')
      ), 'hex'), 1, 32);
      INSERT INTO ${relation(manifest.schemaName, "listing_urls")}(
        id, listing_id, kind, url, active, observed_at
      ) VALUES (listing_url_id_value, listing_id_value, 'source_listing', source_listing_url_value, 1, observed_at_value)
      ON CONFLICT(listing_id, kind, url) DO NOTHING;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      mutation_statement_count := mutation_statement_count + 1;
      mutation_row_count := mutation_row_count + affected_rows;

      SELECT reference.id, reference.listing_id, reference.observed_at
        INTO existing_source_listing_record
      FROM ${relation(manifest.schemaName, "source_listing_refs")} AS reference
      WHERE reference.source_connection_id = source_connection_id_value
        AND reference.external_listing_id = source_listing_id_value
      FOR UPDATE OF reference;
      IF FOUND AND (existing_source_listing_record.listing_id <> listing_id_value
        OR existing_source_listing_record.observed_at > observed_at_value) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal catalog-import source listing conflicts with another exact listing';
      END IF;
      source_listing_ref_id_value := 'source_listing_' || pg_catalog.substr(pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to('postgres_catalog_source_listing_v1|' ||
          source_connection_id_value || '|' || source_listing_id_value, 'UTF8')
      ), 'hex'), 1, 32);
      INSERT INTO ${relation(manifest.schemaName, "source_listing_refs")}(
        id, source_connection_id, external_listing_id, external_product_id,
        listing_id, source_url, observed_at
      ) VALUES (
        source_listing_ref_id_value, source_connection_id_value, source_listing_id_value,
        source_product_id_value, listing_id_value, source_listing_url_value, observed_at_value
      ) ON CONFLICT(source_connection_id, external_listing_id) DO UPDATE SET
        external_product_id = excluded.external_product_id,
        source_url = excluded.source_url, observed_at = excluded.observed_at
      WHERE ${relation(manifest.schemaName, "source_listing_refs")}.listing_id = excluded.listing_id;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal catalog-import source listing mutation is ambiguous';
      END IF;
      mutation_statement_count := mutation_statement_count + 1;
      mutation_row_count := mutation_row_count + affected_rows;

      SELECT mission.id INTO existing_mission_record
      FROM ${relation(manifest.schemaName, "missions")} AS mission
      WHERE mission.tenant_id = resolved_tenant_id
        AND mission.user_id = resolved_user_id
        AND mission.variant_id = variant_id_value
      FOR UPDATE OF mission;
      IF FOUND THEN
        mission_target_id_value := 'mission_target_' || pg_catalog.substr(pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to('postgres_catalog_mission_target_v1|' ||
            existing_mission_record.id || '|' || listing_id_value, 'UTF8')
        ), 'hex'), 1, 32);
        INSERT INTO ${relation(manifest.schemaName, "mission_targets")}(
          id, mission_id, listing_id, enabled, max_unit_price_cents,
          currency, seller_policy, fulfillment, created_at, updated_at
        ) VALUES (
          mission_target_id_value, existing_mission_record.id, listing_id_value,
          0, NULL, 'USD', 'inherit', 'inherit', mutation_timestamp, mutation_timestamp
        ) ON CONFLICT(mission_id, listing_id) DO NOTHING;
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        mutation_statement_count := mutation_statement_count + 1;
        mutation_row_count := mutation_row_count + affected_rows;
        mission_targets_created_value := mission_targets_created_value + affected_rows;
      END IF;

      observation_id_value := 'offer_observation_' || pg_catalog.substr(pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to('postgres_catalog_observation_v1|' ||
          source_connection_id_value || '|' || source_listing_id_value || '|' ||
          observed_at_value || '|' || availability_value || '|' ||
          COALESCE(unit_price_cents_value::text, ''), 'UTF8')
      ), 'hex'), 1, 32);
      INSERT INTO ${relation(manifest.schemaName, "offer_observations")}(
        id, listing_id, source_connection_id, availability, unit_price_cents,
        currency, observed_at, created_at
      ) VALUES (
        observation_id_value, listing_id_value, source_connection_id_value,
        availability_value, unit_price_cents_value, 'USD', observed_at_value, mutation_timestamp
      ) ON CONFLICT(id) DO NOTHING;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      mutation_statement_count := mutation_statement_count + 1;
      mutation_row_count := mutation_row_count + affected_rows;
      offer_observations_created_value := offer_observations_created_value + affected_rows;
    END IF;
  END LOOP;

  FOR preferred_record IN
    SELECT DISTINCT ON (candidate.value->>'retailerId')
      candidate.value->>'retailerId' AS retailer_id,
      candidate.value->>'retailerSku' AS retailer_sku
    FROM pg_catalog.jsonb_array_elements(listings_value) WITH ORDINALITY AS candidate(value, ordinality)
    WHERE candidate.value->>'retailerId' <> ''
      AND candidate.value->>'retailerSku' <> ''
      AND candidate.value->>'canonicalUrl' <> ''
    ORDER BY candidate.value->>'retailerId',
      (CASE WHEN candidate.value->>'availability' IN ('in_stock', 'preorder') THEN 100
        WHEN candidate.value->>'availability' = 'out_of_stock' THEN 10 ELSE 0 END
       + CASE WHEN pg_catalog.jsonb_typeof(candidate.value->'unitPriceCents') = 'number' THEN 20 ELSE 0 END
       + GREATEST(0, 48 - candidate.ordinality)) DESC,
      candidate.ordinality ASC
  LOOP
    SELECT shared_listing.id INTO listing_id_value
    FROM ${relation(manifest.schemaName, "listings")} AS shared_listing
    WHERE shared_listing.retailer_id = preferred_record.retailer_id
      AND shared_listing.retailer_sku = preferred_record.retailer_sku;
    SELECT reference.observed_at INTO existing_preferred_record
    FROM ${relation(manifest.schemaName, "source_variant_retailer_refs")} AS reference
    WHERE reference.source_connection_id = source_connection_id_value
      AND reference.variant_id = variant_id_value
      AND reference.retailer_id = preferred_record.retailer_id
    FOR UPDATE OF reference;
    IF FOUND AND existing_preferred_record.observed_at > observed_at_value THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal catalog-import preferred route observation is stale';
    END IF;
    INSERT INTO ${relation(manifest.schemaName, "source_variant_retailer_refs")}(
      source_connection_id, variant_id, retailer_id, listing_id, observed_at
    ) VALUES (
      source_connection_id_value, variant_id_value, preferred_record.retailer_id,
      listing_id_value, observed_at_value
    ) ON CONFLICT(source_connection_id, variant_id, retailer_id) DO UPDATE SET
      listing_id = excluded.listing_id, observed_at = excluded.observed_at;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    mutation_statement_count := mutation_statement_count + 1;
    mutation_row_count := mutation_row_count + affected_rows;
    preferred_routes_updated_value := preferred_routes_updated_value + affected_rows;
  END LOOP;

  UPDATE ${relation(manifest.schemaName, "source_connections")}
  SET status = 'connected',
      last_event_at = CASE WHEN last_event_at = '' OR last_event_at < observed_at_value
        THEN observed_at_value ELSE last_event_at END,
      updated_at = mutation_timestamp
  WHERE id = source_connection_id_value
    AND tenant_id = resolved_tenant_id AND user_id = resolved_user_id;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal catalog-import source mutation is ambiguous';
  END IF;
  mutation_statement_count := mutation_statement_count + 1;
  mutation_row_count := mutation_row_count + affected_rows;

  IF sync_id_value <> '' THEN
    SELECT item.id INTO sync_item_id_value
    FROM ${relation(manifest.schemaName, "source_sync_run_items")} AS item
    WHERE item.run_id = sync_id_value AND item.external_product_id = source_product_id_value
    FOR UPDATE OF item;
    IF NOT FOUND THEN
      sync_item_id_value := 'sync_item_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to('postgres_catalog_sync_item_v1|' || sync_id_value || '|' ||
          source_product_id_value, 'UTF8')
      ), 'hex'), 1, 32);
    END IF;
    INSERT INTO ${relation(manifest.schemaName, "source_sync_run_items")}(
      id, run_id, external_product_id, outcome, candidates_accepted,
      listings_mapped, listings_created, error_code, created_at, updated_at
    ) VALUES (
      sync_item_id_value, sync_id_value, source_product_id_value, 'imported',
      candidates_accepted_value, listings_mapped_value, listings_created_value,
      '', mutation_timestamp, mutation_timestamp
    ) ON CONFLICT(run_id, external_product_id) DO UPDATE SET
      outcome = 'imported', candidates_accepted = excluded.candidates_accepted,
      listings_mapped = excluded.listings_mapped,
      listings_created = excluded.listings_created, error_code = '',
      updated_at = excluded.updated_at;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    mutation_statement_count := mutation_statement_count + 1;
    mutation_row_count := mutation_row_count + affected_rows;
    sync_receipt_value := pg_catalog.jsonb_build_object(
      'runId', sync_id_value, 'externalProductId', source_product_id_value,
      'outcome', 'imported', 'candidatesAccepted', candidates_accepted_value,
      'listingsMapped', listings_mapped_value, 'listingsCreated', listings_created_value,
      'updatedAt', mutation_timestamp
    );
  END IF;

  result_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'outcome', 'applied', 'mutationApplied', TRUE, 'idempotentReplay', FALSE,
    'mutationStatementCount', mutation_statement_count + 2,
    'mutationRowCount', mutation_row_count + 2,
    'familyCreated', family_created_value, 'variantCreated', variant_created_value,
    'variantId', variant_id_value, 'candidatesAccepted', candidates_accepted_value,
    'listingsMapped', listings_mapped_value, 'listingsCreated', listings_created_value,
    'offerObservationsCreated', offer_observations_created_value,
    'missionTargetsCreated', mission_targets_created_value,
    'preferredRoutesUpdated', preferred_routes_updated_value,
    'sourceProductRefMutated', TRUE,
    'sourceAliasMutated', source_product_slug_value <> '',
    'syncItemMutated', sync_id_value <> '',
    'auditMutated', TRUE, 'outboxMutated', TRUE,
    'syncReceipt', sync_receipt_value,
    'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
    'catalogImportWriterParity', TRUE,
    'connectionProvisioningWriterParity', FALSE,
    'sourceWriterParity', FALSE, 'retailerQualificationWriterParity', TRUE,
    'missionPolicyWriterParity', TRUE, 'configurationWriterParity', FALSE,
    'reservationWriterParity', TRUE, 'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', TRUE,
    'actionAuthority', FALSE, 'runtimeAuthority', FALSE
  );
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'result', result_value
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value, 'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'sourceProductId', source_product_id_value,
    'variantId', variant_id_value,
    'candidatesAccepted', candidates_accepted_value,
    'listingsMapped', listings_mapped_value,
    'listingsCreated', listings_created_value
  );
  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, source_product_id_value,
    'trackalacker_catalog_item_imported', 'catalog_item_imported',
    'A bounded TrackaLacker catalog item was imported.', audit_data_value::text,
    mutation_timestamp
  );
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'source_catalog_import', request_id,
    'trackalacker_catalog_item_imported', outbox_payload_value::text,
    mutation_timestamp, ''
  );
  RETURN QUERY SELECT result_value::text;
END
`;
}

export function signalCatalogImportApplyBoundarySpec(
  manifest: PostgresSignalCatalogImportApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_catalog_import_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.catalogImportRole.name,
    functionName: POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalCatalogImportApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_catalog_import_apply_receipt",
    receiptTriggerName: "yoink_signal_catalog_import_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.reservationLifecycleApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      reservationLifecycleApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      operationCount: 1,
      maximumListingsPerItem: MAXIMUM_LISTINGS_PER_ITEM,
      supportedExecutionRetailerCount: SUPPORTED_EXECUTION_RETAILER_COUNT,
      protectedSharedCatalogTableNames: [...PROTECTED_SHARED_CATALOG_TABLES],
      sharedCatalogMutationTableNames: [...SHARED_CATALOG_MUTATION_TABLES],
      protectedSharedCatalogTableCount: PROTECTED_SHARED_CATALOG_TABLES.length,
      sharedCatalogMutationTableCount: SHARED_CATALOG_MUTATION_TABLES.length,
      totalMutationTableCount: MUTATION_TABLES.length + SHARED_CATALOG_MUTATION_TABLES.length,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      sourceScopeConsumed: true,
      deterministicRequestIdentity: true,
      immutableAuditedReplay: true,
      boundedCatalogPayload: true,
      completeSetIdentityConsensus: true,
      crossTenantCatalogSerialization: true,
      sourceProductConflictFailClosed: true,
      sourceAliasConflictFailClosed: true,
      sourceListingConflictFailClosed: true,
      sourceCandidateConflictFailClosed: true,
      registeredRetailerRevalidation: true,
      canonicalRetailerUrlRevalidation: true,
      serverDerivedExecutionSupport: true,
      monotonicSourceObservation: true,
      candidateUpsertParity: true,
      listingUpsertParity: true,
      sourceReferenceUpsertParity: true,
      preferredRetailerRouteParity: true,
      idempotentOfferObservation: true,
      existingMissionTargetAttachmentParity: true,
      optionalSyncItemCompositionParity: true,
      atomicCatalogSyncAuditOutbox: true,
      databaseOwnedTimestamps: true,
      privacyBoundedReceipts: true,
      currentSourceOwnershipRevalidation: true,
      currentDeviceOwnershipRevalidation: true,
      currentRunOwnershipRevalidation: true,
      activeDeviceOnly: true,
      activeRunItemOnly: true,
      privateSourceOnly: true,
      trackalackerOnly: true,
      sourceTrustWriterParity: true,
      sourceStatusWriterParity: true,
      sourceSyncWriterParity: true,
      catalogImportWriterParity: true,
      connectionProvisioningWriterParity: false,
      sourceWriterParity: false,
      retailerQualificationWriterParity: true,
      missionPolicyWriterParity: true,
      settingsWriterParity: false,
      configurationWriterParity: false,
      reservationWriterParity: true,
      writerLockProtocolParity: false,
      sharedCatalogMutationAuthority: true,
      actionAuthority: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalCatalogImportCapabilityProjection():
PostgresSignalCatalogImportCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalCatalogImportApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    reservationLifecycleApplyContractVersion: 1,
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
    immutableAuditedReplay: true,
    boundedCatalogPayload: true,
    completeSetIdentityConsensus: true,
    crossTenantCatalogSerialization: true,
    sourceProductConflictFailClosed: true,
    sourceAliasConflictFailClosed: true,
    sourceListingConflictFailClosed: true,
    sourceCandidateConflictFailClosed: true,
    registeredRetailerRevalidation: true,
    canonicalRetailerUrlRevalidation: true,
    serverDerivedExecutionSupport: true,
    monotonicSourceObservation: true,
    candidateUpsertParity: true,
    listingUpsertParity: true,
    sourceReferenceUpsertParity: true,
    preferredRetailerRouteParity: true,
    idempotentOfferObservation: true,
    existingMissionTargetAttachmentParity: true,
    optionalSyncItemCompositionParity: true,
    atomicCatalogSyncAuditOutbox: true,
    databaseOwnedTimestamps: true,
    privacyBoundedReceipts: true,
    currentSourceOwnershipRevalidation: true,
    currentDeviceOwnershipRevalidation: true,
    currentRunOwnershipRevalidation: true,
    activeDeviceOnly: true,
    activeRunItemOnly: true,
    privateSourceOnly: true,
    trackalackerOnly: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    catalogImportWriterParity: true,
    connectionProvisioningWriterParity: false,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: true,
    writerLockProtocolParity: false,
    operationCount: 1,
    maximumListingsPerItem: MAXIMUM_LISTINGS_PER_ITEM,
    supportedExecutionRetailerCount: SUPPORTED_EXECUTION_RETAILER_COUNT,
    protectedTenantTableCount: PROTECTED_TENANT_TABLES.length as 14,
    forcedRlsTableCount: PROTECTED_TENANT_TABLES.length as 14,
    tenantMutationTableCount: MUTATION_TABLES.length as 11,
    protectedSharedCatalogTableCount: PROTECTED_SHARED_CATALOG_TABLES.length as 5,
    sharedCatalogMutationTableCount: SHARED_CATALOG_MUTATION_TABLES.length as 4,
    totalMutationTableCount: (MUTATION_TABLES.length + SHARED_CATALOG_MUTATION_TABLES.length) as 15,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    sharedCatalogMutationAuthority: true,
    actionAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export type PostgresSignalCatalogImportApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalCatalogImportApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalCatalogImportApplyManifest()
): Promise<PostgresSignalCatalogImportApplyQualificationReceipt> {
  await verifyPostgresSignalReservationLifecycleApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalReservationLifecycleApplyManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(
    database, signalCatalogImportApplyBoundarySpec(manifest)
  );
}

export async function applyPostgresSignalCatalogImportApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalCatalogImportApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalCatalogImportApplyQualificationReceipt> {
  await verifyPostgresSignalReservationLifecycleApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalReservationLifecycleApplyManifest
  );
  return applyPostgresQualifiedFunctionBoundary(
    database, signalCatalogImportApplyBoundarySpec(manifest), now
  );
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalCatalogImportApplyQualificationError(
      `The PostgreSQL catalog-import ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalCatalogImportOperation,
  requestId: string
): PostgresSignalCatalogImportApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalCatalogImportApplyQualificationError(
      "The PostgreSQL catalog-import result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const outcome = String(result.outcome ?? "");
  const syncReceipt = result.syncReceipt;
  const safeCount = (entry: unknown): boolean =>
    Number.isSafeInteger(entry) && Number(entry) >= 0;
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "already_applied"]).has(outcome)
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || (outcome === "applied"
      && (result.mutationApplied !== true || result.idempotentReplay !== false))
    || (outcome === "already_applied"
      && (result.mutationApplied !== false || result.idempotentReplay !== true))
    || !safeCount(result.mutationStatementCount)
    || !safeCount(result.mutationRowCount)
    || typeof result.familyCreated !== "boolean"
    || typeof result.variantCreated !== "boolean"
    || !String(result.variantId ?? "").trim()
    || Buffer.byteLength(String(result.variantId ?? ""), "utf8") > 200
    || !safeCount(result.candidatesAccepted)
    || !safeCount(result.listingsMapped)
    || !safeCount(result.listingsCreated)
    || !safeCount(result.offerObservationsCreated)
    || !safeCount(result.missionTargetsCreated)
    || !safeCount(result.preferredRoutesUpdated)
    || typeof result.sourceProductRefMutated !== "boolean"
    || typeof result.sourceAliasMutated !== "boolean"
    || typeof result.syncItemMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || (syncReceipt !== null
      && (!syncReceipt || typeof syncReceipt !== "object" || Array.isArray(syncReceipt)))
    || (result.syncItemMutated === true && syncReceipt === null)
    || (result.syncItemMutated === false && syncReceipt !== null && outcome === "applied")
    || (outcome === "already_applied"
      && (result.sourceProductRefMutated !== false
        || result.sourceAliasMutated !== false
        || result.syncItemMutated !== false
        || result.auditMutated !== false
        || result.outboxMutated !== false
        || result.mutationStatementCount !== 0
        || result.mutationRowCount !== 0))
    || result.sourceStatusWriterParity !== true
    || result.sourceSyncWriterParity !== true
    || result.catalogImportWriterParity !== true
    || result.connectionProvisioningWriterParity !== false
    || result.sourceWriterParity !== false
    || result.retailerQualificationWriterParity !== true
    || result.missionPolicyWriterParity !== true
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== true
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true
    || result.sharedCatalogMutationAuthority !== true
    || result.actionAuthority !== false
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalCatalogImportApplyQualificationError(
      "The PostgreSQL catalog-import result contract changed."
    );
  }
  return result as unknown as PostgresSignalCatalogImportApplyResult;
}

export class NodePostgresSignalCatalogImportApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalCatalogImportApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalCatalogImportApplyManifest(),
    options: NodePostgresSignalCatalogImportApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalCatalogImportApplyQualificationError(
        "The PostgreSQL catalog-import connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_catalog_import"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_catalog_import");
  }

  async applyCatalogImport(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalCatalogImportOperation,
    requestIdValue: string,
    requestPayload: PostgresSignalCatalogImportPayload
  ): Promise<PostgresSignalCatalogImportApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalCatalogImportOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (!new Set<PostgresSignalCatalogImportOperation>([
      "import_trackalacker_catalog_item"
    ]).has(operation)
      || !REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalCatalogImportRequestId(
        { tenantId, userId }, operation, requestPayload
      )
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalCatalogImportApplyQualificationError(
        "The PostgreSQL catalog-import apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.catalogImportRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalCatalogImportApplyQualificationError(
          "The PostgreSQL catalog-import function returned an ambiguous result."
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
