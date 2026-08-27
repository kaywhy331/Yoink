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
  POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONTRACT_VERSION,
  buildPostgresSignalSourceStatusApplyManifest,
  verifyPostgresSignalSourceStatusApplyBoundary,
  type PostgresSignalSourceStatusApplyManifest
} from "./postgres-signal-source-status-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_RECEIPT_TABLE =
  "yoink_signal_source_sync_apply_receipt";
export const POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION =
  "yoink_apply_signal_source_sync";
export const POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION =
  "TRACKALACKER_SOURCE_SYNC_V1";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 4_096;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const REQUEST_ID = /^source_sync_[a-f0-9]{32}$/;
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
  "source_sync_run_items",
  "source_sync_runs"
] as const);
const MUTATION_TABLES = Object.freeze([
  "audit_events",
  "outbox_events",
  "source_sync_run_items",
  "source_sync_runs"
] as const);

export type PostgresSignalSourceSyncOperation =
  | "start_source_sync"
  | "update_source_sync"
  | "record_source_sync_item";

interface PostgresSignalSourceSyncBasePayload {
  deviceId: string;
  sourceConnectionId: string;
  syncId: string;
  confirmation: typeof POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION;
}

export interface PostgresSignalSourceSyncProgressPayload
extends PostgresSignalSourceSyncBasePayload {
  phase: "starting" | "discovering" | "importing" | "complete" | "error";
  page: number;
  pages: number;
  discovered: number;
  processed: number;
  imported: number;
  failed: number;
  message: string;
}

export interface PostgresSignalSourceSyncItemPayload
extends PostgresSignalSourceSyncBasePayload {
  externalProductId: string;
  candidatesAccepted: number;
  listingsMapped: number;
  listingsCreated: number;
}

export type PostgresSignalSourceSyncPayload =
  | PostgresSignalSourceSyncProgressPayload
  | PostgresSignalSourceSyncItemPayload;

type PostgresSignalSourceStatusPredecessor = Pick<
  PostgresSignalSourceStatusApplyManifest,
  "schemaName" | "fingerprint" | "sourceStatusRoleNamespace"
>;

export interface PostgresSignalSourceSyncApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  sourceStatusApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  sourceSyncRoleNamespace: string;
  sourceStatusApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalSourceStatusPredecessor;
  sourceSyncRole: {
    kind: "signal_source_sync_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 3;
  protectedTenantTableCount: 6;
  forcedRlsTableCount: 6;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  sourceScopeConsumed: true;
  deterministicRequestIdentity: true;
  immutableAuditedReplay: true;
  latestStateProgressReplay: true;
  latestStateItemReplay: true;
  monotonicProgressCounters: true;
  boundedActiveRunExclusion: true;
  staleRunInterruptionParity: true;
  terminalAuditParity: true;
  nonTerminalAuditSuppression: true;
  itemReceiptUpsertParity: true;
  databaseOwnedTimestamps: true;
  privacyBoundedMessages: true;
  atomicRunAuditOutbox: true;
  currentSourceOwnershipRevalidation: true;
  currentDeviceOwnershipRevalidation: true;
  currentRunOwnershipRevalidation: true;
  activeDeviceOnly: true;
  activeRunItemOnly: true;
  privateSourceOnly: true;
  trackalackerOnly: true;
  catalogImportExcluded: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
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

export interface PostgresSignalSourceSyncCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  sourceStatusApplyContractVersion: 1;
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
  latestStateProgressReplay: true;
  latestStateItemReplay: true;
  monotonicProgressCounters: true;
  boundedActiveRunExclusion: true;
  staleRunInterruptionParity: true;
  terminalAuditParity: true;
  nonTerminalAuditSuppression: true;
  itemReceiptUpsertParity: true;
  databaseOwnedTimestamps: true;
  privacyBoundedMessages: true;
  atomicRunAuditOutbox: true;
  currentSourceOwnershipRevalidation: true;
  currentDeviceOwnershipRevalidation: true;
  currentRunOwnershipRevalidation: true;
  activeDeviceOnly: true;
  activeRunItemOnly: true;
  privateSourceOnly: true;
  trackalackerOnly: true;
  catalogImportExcluded: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  operationCount: 3;
  protectedTenantTableCount: 6;
  forcedRlsTableCount: 6;
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

export interface PostgresSignalSourceSyncApplyResult {
  contractVersion: 1;
  operation: PostgresSignalSourceSyncOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "refreshed" | "already_current" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  runMutated: boolean;
  itemMutated: boolean;
  interruptedRunMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  run: Record<string, unknown> | null;
  item: Record<string, unknown> | null;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
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

export interface NodePostgresSignalSourceSyncApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalSourceSyncCapabilityProjection> | null = null;

export class PostgresSignalSourceSyncApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalSourceSyncApplyQualificationError";
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
    throw new PostgresSignalSourceSyncApplyQualificationError(
      "The PostgreSQL source-sync schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalSourceSyncApplyQualificationError(
      "The PostgreSQL source-sync role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_source_sync`;
  if (value.length > 63) {
    throw new PostgresSignalSourceSyncApplyQualificationError(
      "The PostgreSQL source-sync role name exceeds PostgreSQL's limit."
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

function progressPayload(
  payload: PostgresSignalSourceSyncPayload
): payload is PostgresSignalSourceSyncProgressPayload {
  return "phase" in payload;
}

export function buildPostgresSignalSourceSyncRequestId(
  principal: BackgroundWorkerPrincipal,
  operation: PostgresSignalSourceSyncOperation,
  payload: PostgresSignalSourceSyncPayload
): string {
  const common = [
    "postgres-signal-source-sync-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    String(operation ?? ""),
    String(payload?.deviceId ?? ""),
    String(payload?.sourceConnectionId ?? ""),
    String(payload?.syncId ?? "")
  ];
  const specific = progressPayload(payload) ? [
    String(payload.phase ?? ""),
    String(payload.page ?? ""),
    String(payload.pages ?? ""),
    String(payload.discovered ?? ""),
    String(payload.processed ?? ""),
    String(payload.imported ?? ""),
    String(payload.failed ?? ""),
    String(payload.message ?? "")
  ] : [
    String(payload.externalProductId ?? ""),
    String(payload.candidatesAccepted ?? ""),
    String(payload.listingsMapped ?? ""),
    String(payload.listingsCreated ?? "")
  ];
  const parts = [...common, ...specific, String(payload?.confirmation ?? "")];
  return `source_sync_${createHash("sha256").update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalSourceSyncApplyManifest(
  predecessorManifest = buildPostgresSignalSourceStatusApplyManifest(),
  requestedRoleNamespace = "yoink_source_sync_q"
): PostgresSignalSourceSyncApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const sourceSyncRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(sourceSyncRoleNamespace)) {
    throw new PostgresSignalSourceSyncApplyQualificationError(
      "The PostgreSQL source-sync role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalSourceSyncApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    sourceStatusApplyContractVersion:
      POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    sourceSyncRoleNamespace,
    sourceStatusApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    sourceSyncRole: {
      kind: "signal_source_sync_apply_boundary",
      name: roleName(sourceSyncRoleNamespace),
      functionName: POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 3,
    protectedTenantTableCount: 6,
    forcedRlsTableCount: 6,
    mutationTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    sourceScopeConsumed: true,
    deterministicRequestIdentity: true,
    immutableAuditedReplay: true,
    latestStateProgressReplay: true,
    latestStateItemReplay: true,
    monotonicProgressCounters: true,
    boundedActiveRunExclusion: true,
    staleRunInterruptionParity: true,
    terminalAuditParity: true,
    nonTerminalAuditSuppression: true,
    itemReceiptUpsertParity: true,
    databaseOwnedTimestamps: true,
    privacyBoundedMessages: true,
    atomicRunAuditOutbox: true,
    currentSourceOwnershipRevalidation: true,
    currentDeviceOwnershipRevalidation: true,
    currentRunOwnershipRevalidation: true,
    activeDeviceOnly: true,
    activeRunItemOnly: true,
    privateSourceOnly: true,
    trackalackerOnly: true,
    catalogImportExcluded: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
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

export function signalSourceSyncApplyFunctionSource(
  manifest = buildPostgresSignalSourceSyncApplyManifest()
): string {
  const progressRequestIdentityParts = stableHashInputSql([
    "'postgres-signal-source-sync-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "operation_name",
    "device_id_value",
    "source_connection_id_value",
    "sync_id_value",
    "phase_value",
    "page_value::text",
    "pages_value::text",
    "discovered_value::text",
    "processed_value::text",
    "imported_value::text",
    "failed_value::text",
    "message_value",
    `'${POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION}'::text`
  ]);
  const itemRequestIdentityParts = stableHashInputSql([
    "'postgres-signal-source-sync-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "operation_name",
    "device_id_value",
    "source_connection_id_value",
    "sync_id_value",
    "external_product_id_value",
    "candidates_accepted_value::text",
    "listings_mapped_value::text",
    "listings_created_value::text",
    `'${POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION}'::text`
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
  phase_value TEXT := '';
  page_value BIGINT := 0;
  pages_value BIGINT := 0;
  discovered_value BIGINT := 0;
  processed_value BIGINT := 0;
  imported_value BIGINT := 0;
  failed_value BIGINT := 0;
  message_value TEXT := '';
  external_product_id_value TEXT := '';
  candidates_accepted_value BIGINT := 0;
  listings_mapped_value BIGINT := 0;
  listings_created_value BIGINT := 0;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  device_record RECORD;
  source_record RECORD;
  run_record RECORD;
  run_found BOOLEAN;
  active_record RECORD;
  active_found BOOLEAN;
  item_record RECORD;
  item_found BOOLEAN;
  replay_record RECORD;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  expected_event_type TEXT;
  expected_reason_code TEXT;
  expected_message TEXT;
  mutation_timestamp TEXT;
  terminal_transition BOOLEAN := FALSE;
  interrupted_run_mutated BOOLEAN := FALSE;
  affected_rows BIGINT;
  run_result JSONB := NULL;
  item_result JSONB := NULL;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
  item_id_value TEXT;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name NOT IN (
      'start_source_sync', 'update_source_sync', 'record_source_sync_item'
    )
    OR request_id !~ '^source_sync_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-sync request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-sync payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(request_payload->'deviceId') IS DISTINCT FROM 'string'
    OR request_payload->>'deviceId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'sourceConnectionId') IS DISTINCT FROM 'string'
    OR request_payload->>'sourceConnectionId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'syncId') IS DISTINCT FROM 'string'
    OR request_payload->>'syncId' !~ '^tlsync_[A-Za-z0-9_-]{8,112}$'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-sync payload shape is invalid';
  END IF;

  device_id_value := request_payload->>'deviceId';
  source_connection_id_value := request_payload->>'sourceConnectionId';
  sync_id_value := request_payload->>'syncId';

  IF operation_name IN ('start_source_sync', 'update_source_sync') THEN
    IF request_payload - ARRAY[
        'confirmation', 'deviceId', 'discovered', 'failed', 'imported',
        'message', 'page', 'pages', 'phase', 'processed',
        'sourceConnectionId', 'syncId'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 12
      OR pg_catalog.jsonb_typeof(request_payload->'phase') IS DISTINCT FROM 'string'
      OR request_payload->>'phase' NOT IN (
        'starting', 'discovering', 'importing', 'complete', 'error'
      )
      OR pg_catalog.jsonb_typeof(request_payload->'message') IS DISTINCT FROM 'string'
      OR pg_catalog.octet_length(request_payload->>'message') > 300
      OR request_payload->>'message' <> pg_catalog.btrim(request_payload->>'message')
      OR request_payload->>'message' ~ '[[:cntrl:]]'
      OR request_payload->>'message' ~* '\\mBearer[[:space:]]+[A-Za-z0-9._~-]{20,}'
      OR request_payload->>'message' ~* '(fcm\\.googleapis\\.com|updates\\.push\\.services\\.mozilla\\.com)'
      OR request_payload->>'message' ~* '[?&](device_token|authorization|csrf|session|access_token|refresh_token)='
      OR EXISTS (
        SELECT 1 FROM pg_catalog.unnest(ARRAY[
          'page', 'pages', 'discovered', 'processed', 'imported', 'failed'
        ]) AS counters(counter_name)
        WHERE pg_catalog.jsonb_typeof(request_payload->counter_name) IS DISTINCT FROM 'number'
          OR request_payload->>counter_name !~ '^(0|[1-9][0-9]*)$'
          OR (request_payload->>counter_name)::numeric > 9007199254740991
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-sync progress payload is invalid';
    END IF;
    phase_value := request_payload->>'phase';
    page_value := (request_payload->>'page')::bigint;
    pages_value := (request_payload->>'pages')::bigint;
    discovered_value := (request_payload->>'discovered')::bigint;
    processed_value := (request_payload->>'processed')::bigint;
    imported_value := (request_payload->>'imported')::bigint;
    failed_value := (request_payload->>'failed')::bigint;
    message_value := request_payload->>'message';
    IF (pages_value > 0 AND page_value > pages_value)
      OR processed_value > discovered_value
      OR imported_value + failed_value > processed_value THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-sync progress counters are inconsistent';
    END IF;
    IF operation_name = 'start_source_sync'
      AND (phase_value <> 'starting' OR page_value <> 0 OR pages_value <> 0
        OR discovered_value <> 0 OR processed_value <> 0
        OR imported_value <> 0 OR failed_value <> 0) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-sync run must start with zero counters';
    END IF;
  ELSE
    IF request_payload - ARRAY[
        'candidatesAccepted', 'confirmation', 'deviceId', 'externalProductId',
        'listingsCreated', 'listingsMapped', 'sourceConnectionId', 'syncId'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 8
      OR pg_catalog.jsonb_typeof(request_payload->'externalProductId') IS DISTINCT FROM 'string'
      OR request_payload->>'externalProductId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
      OR EXISTS (
        SELECT 1 FROM pg_catalog.unnest(ARRAY[
          'candidatesAccepted', 'listingsMapped', 'listingsCreated'
        ]) AS counters(counter_name)
        WHERE pg_catalog.jsonb_typeof(request_payload->counter_name) IS DISTINCT FROM 'number'
          OR request_payload->>counter_name !~ '^(0|[1-9][0-9]*)$'
          OR (request_payload->>counter_name)::numeric > 9007199254740991
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-sync item payload is invalid';
    END IF;
    external_product_id_value := request_payload->>'externalProductId';
    candidates_accepted_value := (request_payload->>'candidatesAccepted')::bigint;
    listings_mapped_value := (request_payload->>'listingsMapped')::bigint;
    listings_created_value := (request_payload->>'listingsCreated')::bigint;
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

  IF operation_name = 'record_source_sync_item' THEN
    derived_request_id := 'source_sync_' || pg_catalog.substr(pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(${itemRequestIdentityParts}, 'UTF8')),
      'hex'
    ), 1, 32);
  ELSE
    derived_request_id := 'source_sync_' || pg_catalog.substr(pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(${progressRequestIdentityParts}, 'UTF8')),
      'hex'
    ), 1, 32);
  END IF;
  IF request_id <> derived_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-sync request identity is invalid';
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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-sync shared writer-lock protocol failed';
  END IF;

  SELECT device.id, device.status
    INTO device_record
  FROM ${relation(manifest.schemaName, "extension_devices")} AS device
  WHERE device.id = device_id_value
    AND device.tenant_id = resolved_tenant_id
    AND device.user_id = resolved_user_id
  FOR UPDATE OF device;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-sync device ownership is invalid';
  END IF;
  IF device_record.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-sync device is not active';
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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-sync source ownership is invalid';
  END IF;
  IF source_record.source <> 'trackalacker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-sync source is not TrackaLacker';
  END IF;
  IF source_record.is_private <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-sync source is not private';
  END IF;

  SELECT run.id, run.source_connection_id, run.device_id, run.phase,
         run.page, run.pages, run.discovered, run.processed, run.imported,
         run.failed, run.message, run.started_at, run.updated_at, run.completed_at
    INTO run_record
  FROM ${relation(manifest.schemaName, "source_sync_runs")} AS run
  WHERE run.id = sync_id_value
    AND run.tenant_id = resolved_tenant_id
    AND run.user_id = resolved_user_id
  FOR UPDATE OF run;
  run_found := FOUND;
  IF run_found AND (run_record.source_connection_id <> source_connection_id_value
      OR run_record.device_id IS DISTINCT FROM device_id_value) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-sync run ownership is invalid';
  END IF;
  IF operation_name <> 'start_source_sync' AND NOT run_found THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-sync run is unavailable for this Chrome device';
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    request_payload::text, 'UTF8'
  )), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_source_sync_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_source_sync_outbox_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);
  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit
  WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
  WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-sync request graph is partial';
  END IF;
  IF audit_count = 1 THEN
    IF operation_name = 'start_source_sync' THEN
      expected_event_type := 'source_sync_started';
      expected_reason_code := 'starting';
      expected_message := 'TrackaLacker followed-library sync started.';
    ELSIF operation_name = 'update_source_sync'
      AND phase_value IN ('complete', 'error') THEN
      expected_event_type := 'source_sync_finished';
      expected_reason_code := phase_value;
      expected_message := CASE WHEN phase_value = 'complete'
        THEN 'TrackaLacker followed-library sync completed.'
        ELSE 'TrackaLacker followed-library sync stopped with an error.' END;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-sync unexpected replay receipt';
    END IF;
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
    run_result := replay_record.audit_data->'result';
    IF replay_record.tenant_id <> resolved_tenant_id
      OR replay_record.user_id <> resolved_user_id
      OR replay_record.correlation_id <> sync_id_value
      OR replay_record.event_type <> expected_event_type
      OR replay_record.reason_code <> expected_reason_code
      OR replay_record.message <> expected_message
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR replay_record.audit_data->'request' IS DISTINCT FROM request_payload
      OR pg_catalog.jsonb_typeof(run_result) IS DISTINCT FROM 'object'
      OR run_result->>'id' <> sync_id_value
      OR run_result->>'deviceId' <> device_id_value
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'source_sync'
      OR replay_record.aggregate_id <> sync_id_value
      OR replay_record.outbox_event_type <> expected_event_type
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> sync_id_value
      OR replay_record.outbox_payload->>'reasonCode' <> expected_reason_code
      OR replay_record.outbox_payload->>'message' <> expected_message
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-sync replay graph changed';
    END IF;
    RETURN QUERY SELECT pg_catalog.jsonb_build_object(
      'contractVersion', 1, 'operation', operation_name,
      'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
      'outcome', 'already_applied', 'mutationApplied', FALSE,
      'idempotentReplay', TRUE, 'mutationStatementCount', 0,
      'mutationRowCount', 0, 'runMutated', FALSE, 'itemMutated', FALSE,
      'interruptedRunMutated', FALSE, 'auditMutated', FALSE,
      'outboxMutated', FALSE, 'run', run_result, 'item', NULL,
      'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
      'sourceWriterParity', FALSE, 'retailerQualificationWriterParity', TRUE,
      'missionPolicyWriterParity', TRUE, 'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE, 'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', FALSE,
      'actionAuthority', FALSE, 'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  IF operation_name = 'start_source_sync' THEN
    IF run_found THEN
      run_result := pg_catalog.jsonb_build_object(
        'id', run_record.id, 'deviceId', run_record.device_id,
        'phase', run_record.phase, 'page', run_record.page,
        'pages', run_record.pages, 'discovered', run_record.discovered,
        'processed', run_record.processed, 'imported', run_record.imported,
        'failed', run_record.failed, 'message', run_record.message,
        'startedAt', run_record.started_at, 'updatedAt', run_record.updated_at,
        'completedAt', run_record.completed_at
      );
      RETURN QUERY SELECT pg_catalog.jsonb_build_object(
        'contractVersion', 1, 'operation', operation_name,
        'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
        'outcome', 'already_current', 'mutationApplied', FALSE,
        'idempotentReplay', TRUE, 'mutationStatementCount', 0,
        'mutationRowCount', 0, 'runMutated', FALSE, 'itemMutated', FALSE,
        'interruptedRunMutated', FALSE, 'auditMutated', FALSE,
        'outboxMutated', FALSE, 'run', run_result, 'item', NULL,
        'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
        'sourceWriterParity', FALSE, 'retailerQualificationWriterParity', TRUE,
        'missionPolicyWriterParity', TRUE, 'configurationWriterParity', FALSE,
        'reservationWriterParity', FALSE, 'writerLockProtocolParity', FALSE,
        'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', FALSE,
        'actionAuthority', FALSE, 'runtimeAuthority', FALSE
      )::text;
      RETURN;
    END IF;

    SELECT run.id, run.updated_at
      INTO active_record
    FROM ${relation(manifest.schemaName, "source_sync_runs")} AS run
    WHERE run.tenant_id = resolved_tenant_id
      AND run.user_id = resolved_user_id
      AND run.device_id = device_id_value
      AND run.phase IN ('starting', 'discovering', 'importing')
    ORDER BY run.updated_at DESC LIMIT 1
    FOR UPDATE OF run;
    active_found := FOUND;
    IF active_found AND active_record.updated_at::timestamptz
      >= pg_catalog.statement_timestamp() - INTERVAL '30 minutes' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal source-sync run is already active for this Chrome device';
    END IF;
    mutation_timestamp := pg_catalog.to_char(
      GREATEST(
        pg_catalog.statement_timestamp(),
        CASE WHEN active_found THEN active_record.updated_at::timestamptz + INTERVAL '1 millisecond'
          ELSE '-infinity'::timestamptz END
      ) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    IF active_found THEN
      UPDATE ${relation(manifest.schemaName, "source_sync_runs")}
      SET phase = 'error',
          message = 'The previous sync was interrupted before completion.',
          completed_at = mutation_timestamp,
          updated_at = mutation_timestamp
      WHERE id = active_record.id
        AND tenant_id = resolved_tenant_id
        AND user_id = resolved_user_id
        AND updated_at = active_record.updated_at;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-sync interrupted run mutation was ambiguous';
      END IF;
      interrupted_run_mutated := TRUE;
    END IF;
    INSERT INTO ${relation(manifest.schemaName, "source_sync_runs")}(
      id, tenant_id, user_id, source_connection_id, device_id, phase,
      page, pages, discovered, processed, imported, failed, message,
      started_at, updated_at, completed_at
    ) VALUES (
      sync_id_value, resolved_tenant_id, resolved_user_id,
      source_connection_id_value, device_id_value, 'starting',
      0, 0, 0, 0, 0, 0, message_value,
      mutation_timestamp, mutation_timestamp, ''
    );
    run_result := pg_catalog.jsonb_build_object(
      'id', sync_id_value, 'deviceId', device_id_value, 'phase', 'starting',
      'page', 0, 'pages', 0, 'discovered', 0, 'processed', 0,
      'imported', 0, 'failed', 0, 'message', message_value,
      'startedAt', mutation_timestamp, 'updatedAt', mutation_timestamp,
      'completedAt', ''
    );
    expected_event_type := 'source_sync_started';
    expected_reason_code := 'starting';
    expected_message := 'TrackaLacker followed-library sync started.';
    audit_data_value := pg_catalog.jsonb_build_object(
      'contractVersion', 1, 'operation', operation_name,
      'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
      'request', request_payload, 'result', run_result
    );
    outbox_payload_value := pg_catalog.jsonb_build_object(
      'auditId', audit_id_value, 'correlationId', sync_id_value,
      'reasonCode', expected_reason_code, 'message', expected_message,
      'data', audit_data_value
    );
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type,
      reason_code, message, data_json, created_at
    ) VALUES (
      audit_id_value, resolved_tenant_id, resolved_user_id, sync_id_value,
      expected_event_type, expected_reason_code, expected_message,
      audit_data_value::text, mutation_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at
    ) VALUES (
      outbox_id_value, resolved_tenant_id, 'source_sync', sync_id_value,
      expected_event_type, outbox_payload_value::text, mutation_timestamp, ''
    );
    RETURN QUERY SELECT pg_catalog.jsonb_build_object(
      'contractVersion', 1, 'operation', operation_name,
      'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
      'outcome', 'applied', 'mutationApplied', TRUE,
      'idempotentReplay', FALSE,
      'mutationStatementCount', CASE WHEN interrupted_run_mutated THEN 4 ELSE 3 END,
      'mutationRowCount', CASE WHEN interrupted_run_mutated THEN 4 ELSE 3 END,
      'runMutated', TRUE, 'itemMutated', FALSE,
      'interruptedRunMutated', interrupted_run_mutated,
      'auditMutated', TRUE, 'outboxMutated', TRUE,
      'run', run_result, 'item', NULL,
      'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
      'sourceWriterParity', FALSE, 'retailerQualificationWriterParity', TRUE,
      'missionPolicyWriterParity', TRUE, 'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE, 'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', FALSE,
      'actionAuthority', FALSE, 'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  IF operation_name = 'update_source_sync' THEN
    IF run_record.phase NOT IN ('starting', 'discovering', 'importing', 'complete', 'error')
      OR run_record.page < 0 OR run_record.pages < 0
      OR run_record.discovered < 0 OR run_record.processed < 0
      OR run_record.imported < 0 OR run_record.failed < 0
      OR (run_record.pages > 0 AND run_record.page > run_record.pages)
      OR run_record.processed > run_record.discovered
      OR run_record.imported + run_record.failed > run_record.processed
      OR run_record.updated_at !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal source-sync current run is invalid';
    END IF;
    IF NOT (
      (run_record.phase = 'starting' AND phase_value IN ('starting', 'discovering', 'importing', 'complete', 'error'))
      OR (run_record.phase = 'discovering' AND phase_value IN ('discovering', 'importing', 'complete', 'error'))
      OR (run_record.phase = 'importing' AND phase_value IN ('importing', 'complete', 'error'))
      OR (run_record.phase = 'complete' AND phase_value = 'complete')
      OR (run_record.phase = 'error' AND phase_value = 'error')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal source-sync phase transition is invalid';
    END IF;
    IF page_value < run_record.page OR pages_value < run_record.pages
      OR discovered_value < run_record.discovered
      OR processed_value < run_record.processed
      OR imported_value < run_record.imported OR failed_value < run_record.failed THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-sync counters cannot move backwards';
    END IF;
    IF run_record.phase = phase_value AND run_record.page = page_value
      AND run_record.pages = pages_value AND run_record.discovered = discovered_value
      AND run_record.processed = processed_value AND run_record.imported = imported_value
      AND run_record.failed = failed_value AND run_record.message = message_value THEN
      run_result := pg_catalog.jsonb_build_object(
        'id', run_record.id, 'deviceId', run_record.device_id,
        'phase', run_record.phase, 'page', run_record.page,
        'pages', run_record.pages, 'discovered', run_record.discovered,
        'processed', run_record.processed, 'imported', run_record.imported,
        'failed', run_record.failed, 'message', run_record.message,
        'startedAt', run_record.started_at, 'updatedAt', run_record.updated_at,
        'completedAt', run_record.completed_at
      );
      RETURN QUERY SELECT pg_catalog.jsonb_build_object(
        'contractVersion', 1, 'operation', operation_name,
        'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
        'outcome', 'already_current', 'mutationApplied', FALSE,
        'idempotentReplay', TRUE, 'mutationStatementCount', 0,
        'mutationRowCount', 0, 'runMutated', FALSE, 'itemMutated', FALSE,
        'interruptedRunMutated', FALSE, 'auditMutated', FALSE,
        'outboxMutated', FALSE, 'run', run_result, 'item', NULL,
        'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
        'sourceWriterParity', FALSE, 'retailerQualificationWriterParity', TRUE,
        'missionPolicyWriterParity', TRUE, 'configurationWriterParity', FALSE,
        'reservationWriterParity', FALSE, 'writerLockProtocolParity', FALSE,
        'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', FALSE,
        'actionAuthority', FALSE, 'runtimeAuthority', FALSE
      )::text;
      RETURN;
    END IF;
    terminal_transition := phase_value IN ('complete', 'error')
      AND run_record.phase <> phase_value;
    mutation_timestamp := pg_catalog.to_char(
      GREATEST(
        pg_catalog.statement_timestamp(),
        run_record.updated_at::timestamptz + INTERVAL '1 millisecond'
      ) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    UPDATE ${relation(manifest.schemaName, "source_sync_runs")}
    SET phase = phase_value, page = page_value, pages = pages_value,
        discovered = discovered_value, processed = processed_value,
        imported = imported_value, failed = failed_value,
        message = message_value, updated_at = mutation_timestamp,
        completed_at = CASE WHEN phase_value IN ('complete', 'error')
          AND completed_at = '' THEN mutation_timestamp ELSE completed_at END
    WHERE id = sync_id_value
      AND tenant_id = resolved_tenant_id
      AND user_id = resolved_user_id
      AND updated_at = run_record.updated_at;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-sync run mutation was ambiguous';
    END IF;
    run_result := pg_catalog.jsonb_build_object(
      'id', sync_id_value, 'deviceId', device_id_value, 'phase', phase_value,
      'page', page_value, 'pages', pages_value, 'discovered', discovered_value,
      'processed', processed_value, 'imported', imported_value,
      'failed', failed_value, 'message', message_value,
      'startedAt', run_record.started_at, 'updatedAt', mutation_timestamp,
      'completedAt', CASE WHEN phase_value IN ('complete', 'error')
        AND run_record.completed_at = '' THEN mutation_timestamp
        ELSE run_record.completed_at END
    );
    IF terminal_transition THEN
      expected_event_type := 'source_sync_finished';
      expected_reason_code := phase_value;
      expected_message := CASE WHEN phase_value = 'complete'
        THEN 'TrackaLacker followed-library sync completed.'
        ELSE 'TrackaLacker followed-library sync stopped with an error.' END;
      audit_data_value := pg_catalog.jsonb_build_object(
        'contractVersion', 1, 'operation', operation_name,
        'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
        'request', request_payload, 'result', run_result
      );
      outbox_payload_value := pg_catalog.jsonb_build_object(
        'auditId', audit_id_value, 'correlationId', sync_id_value,
        'reasonCode', expected_reason_code, 'message', expected_message,
        'data', audit_data_value
      );
      INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
        id, tenant_id, user_id, correlation_id, event_type,
        reason_code, message, data_json, created_at
      ) VALUES (
        audit_id_value, resolved_tenant_id, resolved_user_id, sync_id_value,
        expected_event_type, expected_reason_code, expected_message,
        audit_data_value::text, mutation_timestamp
      );
      INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
        id, tenant_id, aggregate_type, aggregate_id, event_type,
        payload_json, created_at, delivered_at
      ) VALUES (
        outbox_id_value, resolved_tenant_id, 'source_sync', sync_id_value,
        expected_event_type, outbox_payload_value::text, mutation_timestamp, ''
      );
    END IF;
    RETURN QUERY SELECT pg_catalog.jsonb_build_object(
      'contractVersion', 1, 'operation', operation_name,
      'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
      'outcome', 'applied', 'mutationApplied', TRUE,
      'idempotentReplay', FALSE,
      'mutationStatementCount', CASE WHEN terminal_transition THEN 3 ELSE 1 END,
      'mutationRowCount', CASE WHEN terminal_transition THEN 3 ELSE 1 END,
      'runMutated', TRUE, 'itemMutated', FALSE,
      'interruptedRunMutated', FALSE, 'auditMutated', terminal_transition,
      'outboxMutated', terminal_transition, 'run', run_result, 'item', NULL,
      'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
      'sourceWriterParity', FALSE, 'retailerQualificationWriterParity', TRUE,
      'missionPolicyWriterParity', TRUE, 'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE, 'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', FALSE,
      'actionAuthority', FALSE, 'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  IF run_record.phase NOT IN ('starting', 'discovering', 'importing') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal source-sync run is not active for this Chrome device';
  END IF;
  SELECT item.id, item.outcome, item.candidates_accepted,
         item.listings_mapped, item.listings_created, item.error_code,
         item.created_at, item.updated_at
    INTO item_record
  FROM ${relation(manifest.schemaName, "source_sync_run_items")} AS item
  WHERE item.run_id = sync_id_value
    AND item.external_product_id = external_product_id_value
  FOR UPDATE OF item;
  item_found := FOUND;
  IF item_found AND item_record.outcome = 'imported'
    AND item_record.candidates_accepted = candidates_accepted_value
    AND item_record.listings_mapped = listings_mapped_value
    AND item_record.listings_created = listings_created_value
    AND item_record.error_code = '' THEN
    item_result := pg_catalog.jsonb_build_object(
      'runId', sync_id_value, 'externalProductId', external_product_id_value,
      'outcome', 'imported', 'candidatesAccepted', candidates_accepted_value,
      'listingsMapped', listings_mapped_value,
      'listingsCreated', listings_created_value,
      'updatedAt', item_record.updated_at
    );
    RETURN QUERY SELECT pg_catalog.jsonb_build_object(
      'contractVersion', 1, 'operation', operation_name,
      'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
      'outcome', 'already_current', 'mutationApplied', FALSE,
      'idempotentReplay', TRUE, 'mutationStatementCount', 0,
      'mutationRowCount', 0, 'runMutated', FALSE, 'itemMutated', FALSE,
      'interruptedRunMutated', FALSE, 'auditMutated', FALSE,
      'outboxMutated', FALSE, 'run', NULL, 'item', item_result,
      'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
      'sourceWriterParity', FALSE, 'retailerQualificationWriterParity', TRUE,
      'missionPolicyWriterParity', TRUE, 'configurationWriterParity', FALSE,
      'reservationWriterParity', FALSE, 'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', FALSE,
      'actionAuthority', FALSE, 'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;
  mutation_timestamp := pg_catalog.to_char(
    GREATEST(
      pg_catalog.statement_timestamp(),
      CASE WHEN item_found THEN item_record.updated_at::timestamptz + INTERVAL '1 millisecond'
        ELSE run_record.updated_at::timestamptz END
    ) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  IF item_found THEN
    UPDATE ${relation(manifest.schemaName, "source_sync_run_items")}
    SET outcome = 'imported', candidates_accepted = candidates_accepted_value,
        listings_mapped = listings_mapped_value,
        listings_created = listings_created_value, error_code = '',
        updated_at = mutation_timestamp
    WHERE id = item_record.id AND run_id = sync_id_value
      AND updated_at = item_record.updated_at;
  ELSE
    item_id_value := 'sync_item_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(
        'postgres_signal_source_sync_item_v1|' || resolved_tenant_id || '|' ||
        resolved_user_id || '|' || sync_id_value || '|' || external_product_id_value,
        'UTF8'
      )
    ), 'hex'), 1, 32);
    INSERT INTO ${relation(manifest.schemaName, "source_sync_run_items")}(
      id, run_id, external_product_id, outcome, candidates_accepted,
      listings_mapped, listings_created, error_code, created_at, updated_at
    ) VALUES (
      item_id_value, sync_id_value, external_product_id_value, 'imported',
      candidates_accepted_value, listings_mapped_value,
      listings_created_value, '', mutation_timestamp, mutation_timestamp
    );
  END IF;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-sync item mutation was ambiguous';
  END IF;
  item_result := pg_catalog.jsonb_build_object(
    'runId', sync_id_value, 'externalProductId', external_product_id_value,
    'outcome', 'imported', 'candidatesAccepted', candidates_accepted_value,
    'listingsMapped', listings_mapped_value,
    'listingsCreated', listings_created_value, 'updatedAt', mutation_timestamp
  );
  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'outcome', CASE WHEN item_found THEN 'refreshed' ELSE 'applied' END,
    'mutationApplied', TRUE, 'idempotentReplay', FALSE,
    'mutationStatementCount', 1, 'mutationRowCount', 1,
    'runMutated', FALSE, 'itemMutated', TRUE,
    'interruptedRunMutated', FALSE, 'auditMutated', FALSE,
    'outboxMutated', FALSE, 'run', NULL, 'item', item_result,
    'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
    'sourceWriterParity', FALSE, 'retailerQualificationWriterParity', TRUE,
    'missionPolicyWriterParity', TRUE, 'configurationWriterParity', FALSE,
    'reservationWriterParity', FALSE, 'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', FALSE,
    'actionAuthority', FALSE, 'runtimeAuthority', FALSE
  )::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalSourceSyncApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_source_sync_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.sourceSyncRole.name,
    functionName: POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalSourceSyncApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_source_sync_apply_receipt",
    receiptTriggerName: "yoink_signal_source_sync_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.sourceStatusApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      sourceStatusApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      operationCount: 3,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      sourceScopeConsumed: true,
      deterministicRequestIdentity: true,
      immutableAuditedReplay: true,
      latestStateProgressReplay: true,
      latestStateItemReplay: true,
      monotonicProgressCounters: true,
      boundedActiveRunExclusion: true,
      staleRunInterruptionParity: true,
      terminalAuditParity: true,
      nonTerminalAuditSuppression: true,
      itemReceiptUpsertParity: true,
      databaseOwnedTimestamps: true,
      privacyBoundedMessages: true,
      atomicRunAuditOutbox: true,
      currentSourceOwnershipRevalidation: true,
      currentDeviceOwnershipRevalidation: true,
      currentRunOwnershipRevalidation: true,
      activeDeviceOnly: true,
      activeRunItemOnly: true,
      privateSourceOnly: true,
      trackalackerOnly: true,
      catalogImportExcluded: true,
      sourceTrustWriterParity: true,
      sourceStatusWriterParity: true,
      sourceSyncWriterParity: true,
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

export function postgresSignalSourceSyncCapabilityProjection():
PostgresSignalSourceSyncCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalSourceSyncApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    sourceStatusApplyContractVersion: 1,
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
    latestStateProgressReplay: true,
    latestStateItemReplay: true,
    monotonicProgressCounters: true,
    boundedActiveRunExclusion: true,
    staleRunInterruptionParity: true,
    terminalAuditParity: true,
    nonTerminalAuditSuppression: true,
    itemReceiptUpsertParity: true,
    databaseOwnedTimestamps: true,
    privacyBoundedMessages: true,
    atomicRunAuditOutbox: true,
    currentSourceOwnershipRevalidation: true,
    currentDeviceOwnershipRevalidation: true,
    currentRunOwnershipRevalidation: true,
    activeDeviceOnly: true,
    activeRunItemOnly: true,
    privateSourceOnly: true,
    trackalackerOnly: true,
    catalogImportExcluded: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    operationCount: 3,
    protectedTenantTableCount: 6,
    forcedRlsTableCount: 6,
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

export type PostgresSignalSourceSyncApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalSourceSyncApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalSourceSyncApplyManifest()
): Promise<PostgresSignalSourceSyncApplyQualificationReceipt> {
  await verifyPostgresSignalSourceStatusApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalSourceStatusApplyManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalSourceSyncApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalSourceSyncApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalSourceSyncApplyQualificationReceipt> {
  await verifyPostgresSignalSourceStatusApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalSourceStatusApplyManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalSourceSyncApplyQualificationError(
      `The PostgreSQL source-sync ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalSourceSyncOperation,
  requestId: string
): PostgresSignalSourceSyncApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalSourceSyncApplyQualificationError(
      "The PostgreSQL source-sync result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const run = result.run;
  const item = result.item;
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
    || typeof result.runMutated !== "boolean"
    || typeof result.itemMutated !== "boolean"
    || typeof result.interruptedRunMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || (run !== null && (!run || typeof run !== "object" || Array.isArray(run)))
    || (item !== null && (!item || typeof item !== "object" || Array.isArray(item)))
    || (run === null && item === null)
    || (run !== null && item !== null)
    || result.sourceStatusWriterParity !== true
    || result.sourceSyncWriterParity !== true
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
    throw new PostgresSignalSourceSyncApplyQualificationError(
      "The PostgreSQL source-sync result contract changed."
    );
  }
  return result as unknown as PostgresSignalSourceSyncApplyResult;
}

export class NodePostgresSignalSourceSyncApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalSourceSyncApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalSourceSyncApplyManifest(),
    options: NodePostgresSignalSourceSyncApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalSourceSyncApplyQualificationError(
        "The PostgreSQL source-sync connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_source_sync"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async applySourceSync(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalSourceSyncOperation,
    requestIdValue: string,
    requestPayload: PostgresSignalSourceSyncPayload
  ): Promise<PostgresSignalSourceSyncApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalSourceSyncOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (!new Set<PostgresSignalSourceSyncOperation>([
      "start_source_sync", "update_source_sync", "record_source_sync_item"
    ]).has(operation)
      || !REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalSourceSyncRequestId(
        { tenantId, userId }, operation, requestPayload
      )
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalSourceSyncApplyQualificationError(
        "The PostgreSQL source-sync apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.sourceSyncRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalSourceSyncApplyQualificationError(
          "The PostgreSQL source-sync function returned an ambiguous result."
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
