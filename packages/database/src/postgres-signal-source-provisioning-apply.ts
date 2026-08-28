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
  POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONTRACT_VERSION,
  buildPostgresSignalCatalogImportApplyManifest,
  verifyPostgresSignalCatalogImportApplyBoundary,
  type PostgresSignalCatalogImportApplyManifest
} from "./postgres-signal-catalog-import-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";
import { ownedIdForUser } from "./request-scope.js";

export const POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_RECEIPT_TABLE =
  "yoink_signal_source_provisioning_apply_receipt";
export const POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION =
  "yoink_apply_signal_source_provisioning";
export const POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONFIRMATION =
  "SOURCE_CONNECTION_PROVISIONING_V1";
export const POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULTS_VERSION = 1;

/**
 * The exact bounded set of default source connections a hosted principal must
 * carry, mirroring `SOURCE_DEFAULTS` in `principal-repository.ts` (the SQLite
 * truth this boundary is provisioning parity with).
 */
export const POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULT_SOURCES = Object.freeze([
  Object.freeze({
    source: "trackalacker",
    name: "TrackaLacker",
    trustLevel: "trusted_exact",
    autoCreateMissions: 1
  }),
  Object.freeze({
    source: "browser",
    name: "Browser observations",
    trustLevel: "trusted_exact",
    autoCreateMissions: 1
  }),
  Object.freeze({
    source: "discord",
    name: "Discord",
    trustLevel: "informational",
    autoCreateMissions: 0
  })
] as const);

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 256;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const REQUEST_ID = /^source_provisioning_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONNECTION_ID = /^source_(?:trackalacker|browser|discord)_(?:[a-f0-9]{24}|local)$/;
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
const MUTATION_TABLES = Object.freeze([
  "audit_events",
  "outbox_events",
  "source_connections"
] as const);

/** The literal label `ownedIdForUser` mixes into its content-hash — must match `domain/src/ids.ts` exactly. */
const OWNED_ID_HASH_LABEL = "yoink_owned_id_v1";
const OWNED_ID_HASH_LABEL_BYTES = Buffer.byteLength(OWNED_ID_HASH_LABEL, "utf8");

export type PostgresSignalSourceProvisioningOperation = "provision_source_connections";
export type PostgresSignalSourceProvisioningDefaultSource = "trackalacker" | "browser" | "discord";

export interface PostgresSignalSourceProvisioningPayload {
  defaultsVersion: typeof POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULTS_VERSION;
  confirmation: typeof POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONFIRMATION;
}

type PostgresSignalCatalogImportPredecessor = Pick<
  PostgresSignalCatalogImportApplyManifest,
  "schemaName" | "fingerprint" | "catalogImportRoleNamespace"
>;

export interface PostgresSignalSourceProvisioningApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  catalogImportApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  sourceProvisioningRoleNamespace: string;
  catalogImportApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalCatalogImportPredecessor;
  sourceProvisioningRole: {
    kind: "signal_source_provisioning_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  defaultSourceConnections: typeof POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULT_SOURCES;
  defaultSourceConnectionCount: 3;
  trustedExactSourceCount: 2;
  informationalSourceCount: 1;
  protectedTenantTableCount: 3;
  forcedRlsTableCount: 3;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  sourceScopeConsumed: true;
  deterministicRequestIdentity: true;
  deterministicConnectionIdentity: true;
  sqliteOwnedIdParity: true;
  immutableAuditedReplay: true;
  zeroWriteWhenAlreadyProvisioned: true;
  existingIdentityConflictFailClosed: true;
  atomicProvisioningAuditOutbox: true;
  databaseOwnedTimestamps: true;
  privateSourceOnly: true;
  disconnectedInitialStatus: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: true;
  sourceWriterParity: true;
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

export interface PostgresSignalSourceProvisioningCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  catalogImportApplyContractVersion: 1;
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
  deterministicConnectionIdentity: true;
  sqliteOwnedIdParity: true;
  immutableAuditedReplay: true;
  zeroWriteWhenAlreadyProvisioned: true;
  existingIdentityConflictFailClosed: true;
  atomicProvisioningAuditOutbox: true;
  databaseOwnedTimestamps: true;
  privateSourceOnly: true;
  disconnectedInitialStatus: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: true;
  sourceWriterParity: true;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: true;
  writerLockProtocolParity: false;
  operationCount: 1;
  defaultSourceConnectionCount: 3;
  trustedExactSourceCount: 2;
  informationalSourceCount: 1;
  protectedTenantTableCount: 3;
  forcedRlsTableCount: 3;
  mutationTableCount: 3;
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

export interface PostgresSignalSourceProvisioningApplyResult {
  contractVersion: 1;
  operation: PostgresSignalSourceProvisioningOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "unchanged" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  connectionsCreated: number;
  createdSources: string[];
  trackalackerConnectionId: string;
  browserConnectionId: string;
  discordConnectionId: string;
  trackalackerCreated: boolean;
  browserCreated: boolean;
  discordCreated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: true;
  sourceWriterParity: true;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  configurationWriterParity: false;
  reservationWriterParity: true;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: false;
  actionAuthority: false;
  runtimeAuthority: false;
}

export interface NodePostgresSignalSourceProvisioningApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalSourceProvisioningCapabilityProjection> | null = null;

export class PostgresSignalSourceProvisioningApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalSourceProvisioningApplyQualificationError";
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
    throw new PostgresSignalSourceProvisioningApplyQualificationError(
      "The PostgreSQL source-provisioning schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalSourceProvisioningApplyQualificationError(
      "The PostgreSQL source-provisioning role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_source_provisioning`;
  if (value.length > 63) {
    throw new PostgresSignalSourceProvisioningApplyQualificationError(
      "The PostgreSQL source-provisioning role name exceeds PostgreSQL's limit."
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

/**
 * Predicts the deterministic `source_connections.id` a PostgreSQL-provisioned
 * default source connection carries for `userId`, by calling the exact same
 * `ownedIdForUser` helper the SQLite `PrincipalRepository` bootstrap uses.
 * This is the TypeScript-side source of truth the generated PL/pgSQL below
 * must reproduce bit-for-bit (see `ownedSourceConnectionIdSql`).
 */
export function expectedDefaultSourceConnectionId(
  userId: string,
  source: PostgresSignalSourceProvisioningDefaultSource
): string {
  return ownedIdForUser(`source_${source}`, userId, `source_${source}_local`);
}

/**
 * Builds the PL/pgSQL expression that reproduces `ownedIdForUser`'s hash
 * (`domain/src/ids.ts` `stableHash("yoink_owned_id_v1", userId, prefix)`,
 * hex-encoded and truncated to 24 characters) for one default source, using
 * `resolved_user_id` as the runtime-bound `userId`. `stableHash` appends a
 * trailing `|` after every part (including the last) — a different byte
 * layout than `stableHashInputSql` above, which is used only for the
 * client-facing request-identity hash and never reproduces `ownedIdForUser`.
 */
function ownedSourceConnectionIdSql(source: PostgresSignalSourceProvisioningDefaultSource): string {
  const prefix = `source_${source}`;
  const prefixBytes = Buffer.byteLength(prefix, "utf8");
  // Mirrors ownedIdForUser exactly, including its explicit local-user
  // exception: the imported local principal keeps its seeded
  // source_<source>_local identity rather than a hashed owned id.
  return (
    `CASE WHEN resolved_user_id = 'user_local' THEN '${prefix}_local' ELSE ` +
    `'${prefix}_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(` +
    `'${OWNED_ID_HASH_LABEL_BYTES}:${OWNED_ID_HASH_LABEL}|' || ` +
    `pg_catalog.octet_length(resolved_user_id)::text || ':' || resolved_user_id || '|' || ` +
    `'${prefixBytes}:${prefix}|', 'UTF8')), 'hex'), 1, 24) END`
  );
}

export function buildPostgresSignalSourceProvisioningRequestId(
  principal: BackgroundWorkerPrincipal,
  payload: PostgresSignalSourceProvisioningPayload
): string {
  const parts = [
    "postgres-signal-source-provisioning-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    String(payload?.defaultsVersion ?? ""),
    String(payload?.confirmation ?? "")
  ];
  return `source_provisioning_${createHash("sha256").update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalSourceProvisioningApplyManifest(
  predecessorManifest = buildPostgresSignalCatalogImportApplyManifest(),
  requestedRoleNamespace = "yoink_source_provisioning_q"
): PostgresSignalSourceProvisioningApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const sourceProvisioningRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(sourceProvisioningRoleNamespace)) {
    throw new PostgresSignalSourceProvisioningApplyQualificationError(
      "The PostgreSQL source-provisioning role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalSourceProvisioningApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    catalogImportApplyContractVersion: POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    sourceProvisioningRoleNamespace,
    catalogImportApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    sourceProvisioningRole: {
      kind: "signal_source_provisioning_apply_boundary",
      name: roleName(sourceProvisioningRoleNamespace),
      functionName: POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    defaultSourceConnections: POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULT_SOURCES,
    defaultSourceConnectionCount: 3,
    trustedExactSourceCount: 2,
    informationalSourceCount: 1,
    protectedTenantTableCount: 3,
    forcedRlsTableCount: 3,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    sourceScopeConsumed: true,
    deterministicRequestIdentity: true,
    deterministicConnectionIdentity: true,
    sqliteOwnedIdParity: true,
    immutableAuditedReplay: true,
    zeroWriteWhenAlreadyProvisioned: true,
    existingIdentityConflictFailClosed: true,
    atomicProvisioningAuditOutbox: true,
    databaseOwnedTimestamps: true,
    privateSourceOnly: true,
    disconnectedInitialStatus: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    catalogImportWriterParity: true,
    connectionProvisioningWriterParity: true,
    sourceWriterParity: true,
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

export function signalSourceProvisioningApplyFunctionSource(
  manifest = buildPostgresSignalSourceProvisioningApplyManifest()
): string {
  const requestIdentityParts = stableHashInputSql([
    "'postgres-signal-source-provisioning-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "defaults_version_value::text",
    `'${POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONFIRMATION}'::text`
  ]);
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  derived_request_id TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  defaults_version_value BIGINT;
  mutation_timestamp TEXT;
  trackalacker_id_value TEXT;
  browser_id_value TEXT;
  discord_id_value TEXT;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  anchor_affected_rows BIGINT;
  trackalacker_record RECORD;
  browser_record RECORD;
  discord_record RECORD;
  trackalacker_created_value BOOLEAN := FALSE;
  browser_created_value BOOLEAN := FALSE;
  discord_created_value BOOLEAN := FALSE;
  connections_created_value BIGINT := 0;
  created_sources_value JSONB;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  replay_result JSONB;
  result_value JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
  affected_rows BIGINT;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'provision_source_connections'
    OR request_id !~ '^source_provisioning_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-provisioning request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-provisioning payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY['confirmation', 'defaultsVersion']::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 2
    OR pg_catalog.jsonb_typeof(request_payload->'defaultsVersion') IS DISTINCT FROM 'number'
    OR request_payload->>'defaultsVersion' <> '${POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULTS_VERSION}'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-provisioning payload shape is invalid';
  END IF;
  defaults_version_value := (request_payload->>'defaultsVersion')::bigint;

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

  derived_request_id := 'source_provisioning_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${requestIdentityParts}, 'UTF8')),
    'hex'
  ), 1, 32);
  IF request_id <> derived_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal source-provisioning request identity is invalid';
  END IF;

  mutation_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  trackalacker_id_value := ${ownedSourceConnectionIdSql("trackalacker")};
  browser_id_value := ${ownedSourceConnectionIdSql("browser")};
  discord_id_value := ${ownedSourceConnectionIdSql("discord")};

  -- The shared writer-lock protocol's SOURCE-domain scope requires the
  -- connection it locks to already exist (it revalidates ownership). Because
  -- this boundary's job is to bring that very connection into existence on a
  -- principal's first call, a deterministic, conflict-safe anchor row for
  -- the primary (TrackaLacker) default is established immediately before
  -- the lock is taken. The anchor id is fully content-derived from
  -- resolved_user_id, so PostgreSQL's own unique-index insert semantics
  -- already serialize concurrent attempts on it; every other mutation in
  -- this function still happens strictly after the shared lock succeeds.
  INSERT INTO ${relation(manifest.schemaName, "source_connections")}(
    id, tenant_id, user_id, source, name, status, trust_level,
    auto_create_missions, is_private, last_event_at, created_at, updated_at
  ) VALUES (
    trackalacker_id_value, resolved_tenant_id, resolved_user_id, 'trackalacker',
    'TrackaLacker', 'disconnected', 'trusted_exact', 1, 1, '',
    mutation_timestamp, mutation_timestamp
  ) ON CONFLICT(id) DO NOTHING;
  GET DIAGNOSTICS anchor_affected_rows = ROW_COUNT;

  SELECT MIN(lock_result.result_json)::jsonb, COUNT(*)
    INTO writer_lock_result, writer_lock_result_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION)}(
    expected_tenant_id, expected_user_id, trackalacker_id_value, '', '', '10000'
  ) AS lock_result;
  IF writer_lock_result_count <> 1 OR writer_lock_result IS NULL
    OR writer_lock_result->>'contractVersion' <> '1'
    OR writer_lock_result->>'lockProtocolVersion' <> 'signal_action_constraints_v1'
    OR writer_lock_result->>'lockMask' <> '10000'
    OR writer_lock_result->>'scopeCount' <> '1'
    OR writer_lock_result->>'sourceConnectionId' <> trackalacker_id_value
    OR writer_lock_result->>'retailerId' <> ''
    OR writer_lock_result->>'missionId' <> ''
    OR writer_lock_result->>'mutationApplied' <> 'false'
    OR writer_lock_result->>'mutationAuthority' <> 'false'
    OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal source-provisioning shared writer-lock protocol failed';
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    request_payload::text, 'UTF8'
  )), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_source_provisioning_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_source_provisioning_outbox_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit
  WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
  WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-provisioning request graph is partial';
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
    replay_result := replay_record.audit_data->'result';
    IF replay_record.tenant_id <> resolved_tenant_id
      OR replay_record.user_id <> resolved_user_id
      OR replay_record.correlation_id <> resolved_user_id
      OR replay_record.event_type <> 'source_connections_provisioned'
      OR replay_record.reason_code <> 'source_connections_provisioned'
      OR replay_record.message <> 'Default source connections were provisioned.'
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR pg_catalog.jsonb_typeof(replay_result) IS DISTINCT FROM 'object'
      OR replay_result->>'outcome' <> 'applied'
      OR replay_result->>'trackalackerConnectionId' <> trackalacker_id_value
      OR replay_result->>'browserConnectionId' <> browser_id_value
      OR replay_result->>'discordConnectionId' <> discord_id_value
      OR replay_result->>'connectionProvisioningWriterParity' <> 'true'
      OR replay_result->>'sourceWriterParity' <> 'true'
      OR replay_result->>'runtimeAuthority' <> 'false'
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'source_connection_provisioning'
      OR replay_record.aggregate_id <> request_id
      OR replay_record.outbox_event_type <> 'source_connections_provisioned'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> resolved_user_id
      OR replay_record.outbox_payload->>'reasonCode' <> 'source_connections_provisioned'
      OR replay_record.outbox_payload->>'message' <> replay_record.message
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-provisioning replay graph changed';
    END IF;
    RETURN QUERY SELECT (replay_result || pg_catalog.jsonb_build_object(
      'outcome', 'already_applied',
      'mutationApplied', FALSE,
      'idempotentReplay', TRUE,
      'mutationStatementCount', 0,
      'mutationRowCount', 0,
      'connectionsCreated', 0,
      'createdSources', '[]'::jsonb,
      'trackalackerCreated', FALSE,
      'browserCreated', FALSE,
      'discordCreated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE
    ))::text;
    RETURN;
  END IF;

  SELECT connection.tenant_id, connection.user_id, connection.source, connection.name,
         connection.trust_level, connection.auto_create_missions, connection.is_private
    INTO trackalacker_record
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = trackalacker_id_value
  FOR UPDATE OF connection;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-provisioning trackalacker anchor is missing';
  END IF;
  IF trackalacker_record.tenant_id <> resolved_tenant_id
    OR trackalacker_record.user_id <> resolved_user_id
    OR trackalacker_record.source <> 'trackalacker'
    OR trackalacker_record.name <> 'TrackaLacker'
    OR trackalacker_record.trust_level <> 'trusted_exact'
    OR trackalacker_record.auto_create_missions <> 1
    OR trackalacker_record.is_private <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal source-provisioning trackalacker connection identity conflicts';
  END IF;
  trackalacker_created_value := anchor_affected_rows = 1;

  SELECT connection.tenant_id, connection.user_id, connection.source, connection.name,
         connection.trust_level, connection.auto_create_missions, connection.is_private
    INTO browser_record
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = browser_id_value
  FOR UPDATE OF connection;
  IF FOUND THEN
    IF browser_record.tenant_id <> resolved_tenant_id
      OR browser_record.user_id <> resolved_user_id
      OR browser_record.source <> 'browser'
      OR browser_record.name <> 'Browser observations'
      OR browser_record.trust_level <> 'trusted_exact'
      OR browser_record.auto_create_missions <> 1
      OR browser_record.is_private <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal source-provisioning browser connection identity conflicts';
    END IF;
  ELSE
    INSERT INTO ${relation(manifest.schemaName, "source_connections")}(
      id, tenant_id, user_id, source, name, status, trust_level,
      auto_create_missions, is_private, last_event_at, created_at, updated_at
    ) VALUES (
      browser_id_value, resolved_tenant_id, resolved_user_id, 'browser',
      'Browser observations', 'disconnected', 'trusted_exact', 1, 1, '',
      mutation_timestamp, mutation_timestamp
    );
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-provisioning browser connection mutation was ambiguous';
    END IF;
    browser_created_value := TRUE;
  END IF;

  SELECT connection.tenant_id, connection.user_id, connection.source, connection.name,
         connection.trust_level, connection.auto_create_missions, connection.is_private
    INTO discord_record
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = discord_id_value
  FOR UPDATE OF connection;
  IF FOUND THEN
    IF discord_record.tenant_id <> resolved_tenant_id
      OR discord_record.user_id <> resolved_user_id
      OR discord_record.source <> 'discord'
      OR discord_record.name <> 'Discord'
      OR discord_record.trust_level <> 'informational'
      OR discord_record.auto_create_missions <> 0
      OR discord_record.is_private <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal source-provisioning discord connection identity conflicts';
    END IF;
  ELSE
    INSERT INTO ${relation(manifest.schemaName, "source_connections")}(
      id, tenant_id, user_id, source, name, status, trust_level,
      auto_create_missions, is_private, last_event_at, created_at, updated_at
    ) VALUES (
      discord_id_value, resolved_tenant_id, resolved_user_id, 'discord',
      'Discord', 'disconnected', 'informational', 0, 1, '',
      mutation_timestamp, mutation_timestamp
    );
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source-provisioning discord connection mutation was ambiguous';
    END IF;
    discord_created_value := TRUE;
  END IF;

  connections_created_value :=
    (CASE WHEN trackalacker_created_value THEN 1 ELSE 0 END) +
    (CASE WHEN browser_created_value THEN 1 ELSE 0 END) +
    (CASE WHEN discord_created_value THEN 1 ELSE 0 END);
  created_sources_value := pg_catalog.to_jsonb(pg_catalog.array_remove(ARRAY[
    CASE WHEN trackalacker_created_value THEN 'trackalacker' END,
    CASE WHEN browser_created_value THEN 'browser' END,
    CASE WHEN discord_created_value THEN 'discord' END
  ], NULL));

  result_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'outcome', CASE WHEN connections_created_value > 0 THEN 'applied' ELSE 'unchanged' END,
    'mutationApplied', connections_created_value > 0,
    'idempotentReplay', FALSE,
    'mutationStatementCount', CASE WHEN connections_created_value > 0
      THEN connections_created_value + 2 ELSE 0 END,
    'mutationRowCount', CASE WHEN connections_created_value > 0
      THEN connections_created_value + 2 ELSE 0 END,
    'connectionsCreated', connections_created_value,
    'createdSources', created_sources_value,
    'trackalackerConnectionId', trackalacker_id_value,
    'browserConnectionId', browser_id_value,
    'discordConnectionId', discord_id_value,
    'trackalackerCreated', trackalacker_created_value,
    'browserCreated', browser_created_value,
    'discordCreated', discord_created_value,
    'auditMutated', connections_created_value > 0,
    'outboxMutated', connections_created_value > 0,
    'sourceStatusWriterParity', TRUE,
    'sourceSyncWriterParity', TRUE,
    'catalogImportWriterParity', TRUE,
    'connectionProvisioningWriterParity', TRUE,
    'sourceWriterParity', TRUE,
    'retailerQualificationWriterParity', TRUE,
    'missionPolicyWriterParity', TRUE,
    'configurationWriterParity', FALSE,
    'reservationWriterParity', TRUE,
    'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE,
    'sharedCatalogMutationAuthority', FALSE,
    'actionAuthority', FALSE,
    'runtimeAuthority', FALSE
  );

  IF connections_created_value > 0 THEN
    audit_data_value := pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'operation', operation_name,
      'requestId', request_id,
      'requestFingerprint', request_fingerprint_value,
      'result', result_value
    );
    outbox_payload_value := pg_catalog.jsonb_build_object(
      'auditId', audit_id_value,
      'correlationId', resolved_user_id,
      'reasonCode', 'source_connections_provisioned',
      'message', 'Default source connections were provisioned.',
      'data', audit_data_value
    );
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type,
      reason_code, message, data_json, created_at
    ) VALUES (
      audit_id_value, resolved_tenant_id, resolved_user_id, resolved_user_id,
      'source_connections_provisioned', 'source_connections_provisioned',
      'Default source connections were provisioned.', audit_data_value::text,
      mutation_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at
    ) VALUES (
      outbox_id_value, resolved_tenant_id, 'source_connection_provisioning', request_id,
      'source_connections_provisioned', outbox_payload_value::text,
      mutation_timestamp, ''
    );
  END IF;

  RETURN QUERY SELECT result_value::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalSourceProvisioningApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_source_provisioning_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.sourceProvisioningRole.name,
    functionName: POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalSourceProvisioningApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_source_provisioning_apply_receipt",
    receiptTriggerName: "yoink_signal_source_provisioning_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.catalogImportApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      catalogImportApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      operationCount: 1,
      defaultSourceConnections: POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULT_SOURCES,
      defaultSourceConnectionCount: 3,
      trustedExactSourceCount: 2,
      informationalSourceCount: 1,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      sourceScopeConsumed: true,
      deterministicRequestIdentity: true,
      deterministicConnectionIdentity: true,
      sqliteOwnedIdParity: true,
      immutableAuditedReplay: true,
      zeroWriteWhenAlreadyProvisioned: true,
      existingIdentityConflictFailClosed: true,
      atomicProvisioningAuditOutbox: true,
      databaseOwnedTimestamps: true,
      privateSourceOnly: true,
      disconnectedInitialStatus: true,
      sourceTrustWriterParity: true,
      sourceStatusWriterParity: true,
      sourceSyncWriterParity: true,
      catalogImportWriterParity: true,
      connectionProvisioningWriterParity: true,
      sourceWriterParity: true,
      retailerQualificationWriterParity: true,
      missionPolicyWriterParity: true,
      settingsWriterParity: false,
      configurationWriterParity: false,
      reservationWriterParity: true,
      writerLockProtocolParity: false,
      sharedCatalogMutationAuthority: false,
      actionAuthority: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalSourceProvisioningCapabilityProjection():
PostgresSignalSourceProvisioningCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalSourceProvisioningApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    catalogImportApplyContractVersion: 1,
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
    deterministicConnectionIdentity: true,
    sqliteOwnedIdParity: true,
    immutableAuditedReplay: true,
    zeroWriteWhenAlreadyProvisioned: true,
    existingIdentityConflictFailClosed: true,
    atomicProvisioningAuditOutbox: true,
    databaseOwnedTimestamps: true,
    privateSourceOnly: true,
    disconnectedInitialStatus: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    catalogImportWriterParity: true,
    connectionProvisioningWriterParity: true,
    sourceWriterParity: true,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: true,
    writerLockProtocolParity: false,
    operationCount: 1,
    defaultSourceConnectionCount: 3,
    trustedExactSourceCount: 2,
    informationalSourceCount: 1,
    protectedTenantTableCount: 3,
    forcedRlsTableCount: 3,
    mutationTableCount: 3,
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

export type PostgresSignalSourceProvisioningApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalSourceProvisioningApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalSourceProvisioningApplyManifest()
): Promise<PostgresSignalSourceProvisioningApplyQualificationReceipt> {
  await verifyPostgresSignalCatalogImportApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalCatalogImportApplyManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalSourceProvisioningApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalSourceProvisioningApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalSourceProvisioningApplyQualificationReceipt> {
  await verifyPostgresSignalCatalogImportApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalCatalogImportApplyManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalSourceProvisioningApplyQualificationError(
      `The PostgreSQL source-provisioning ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalSourceProvisioningOperation,
  requestId: string
): PostgresSignalSourceProvisioningApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalSourceProvisioningApplyQualificationError(
      "The PostgreSQL source-provisioning result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const outcome = String(result.outcome ?? "");
  const createdSources = result.createdSources;
  const safeCount = (entry: unknown, maximum: number): boolean =>
    Number.isSafeInteger(entry) && Number(entry) >= 0 && Number(entry) <= maximum;
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "unchanged", "already_applied"]).has(outcome)
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || (outcome === "applied"
      && (result.mutationApplied !== true || result.idempotentReplay !== false))
    || (outcome === "unchanged"
      && (result.mutationApplied !== false || result.idempotentReplay !== false))
    || (outcome === "already_applied"
      && (result.mutationApplied !== false || result.idempotentReplay !== true))
    || !safeCount(result.mutationStatementCount, 5)
    || !safeCount(result.mutationRowCount, 5)
    || !safeCount(result.connectionsCreated, 3)
    || (outcome === "applied"
      && (Number(result.connectionsCreated) < 1
        || result.mutationStatementCount !== Number(result.connectionsCreated) + 2
        || result.mutationRowCount !== Number(result.connectionsCreated) + 2))
    || (outcome !== "applied"
      && (result.connectionsCreated !== 0
        || result.mutationStatementCount !== 0
        || result.mutationRowCount !== 0))
    || !Array.isArray(createdSources)
    || createdSources.length !== result.connectionsCreated
    || !createdSources.every((entry) => (
      typeof entry === "string" && new Set(["trackalacker", "browser", "discord"]).has(entry)
    ))
    || !CONNECTION_ID.test(String(result.trackalackerConnectionId ?? ""))
    || !CONNECTION_ID.test(String(result.browserConnectionId ?? ""))
    || !CONNECTION_ID.test(String(result.discordConnectionId ?? ""))
    || typeof result.trackalackerCreated !== "boolean"
    || typeof result.browserCreated !== "boolean"
    || typeof result.discordCreated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || (outcome === "applied" && (result.auditMutated !== true || result.outboxMutated !== true))
    || (outcome !== "applied" && (result.auditMutated !== false || result.outboxMutated !== false))
    || result.sourceStatusWriterParity !== true
    || result.sourceSyncWriterParity !== true
    || result.catalogImportWriterParity !== true
    || result.connectionProvisioningWriterParity !== true
    || result.sourceWriterParity !== true
    || result.retailerQualificationWriterParity !== true
    || result.missionPolicyWriterParity !== true
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== true
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true
    || result.sharedCatalogMutationAuthority !== false
    || result.actionAuthority !== false
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalSourceProvisioningApplyQualificationError(
      "The PostgreSQL source-provisioning result contract changed."
    );
  }
  return result as unknown as PostgresSignalSourceProvisioningApplyResult;
}

export class NodePostgresSignalSourceProvisioningApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalSourceProvisioningApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalSourceProvisioningApplyManifest(),
    options: NodePostgresSignalSourceProvisioningApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalSourceProvisioningApplyQualificationError(
        "The PostgreSQL source-provisioning connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_source_provisioning"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async provisionSourceConnections(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalSourceProvisioningOperation,
    requestIdValue: string,
    requestPayload: PostgresSignalSourceProvisioningPayload
  ): Promise<PostgresSignalSourceProvisioningApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalSourceProvisioningOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (operation !== "provision_source_connections"
      || !REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalSourceProvisioningRequestId(
        { tenantId, userId },
        requestPayload
      )
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalSourceProvisioningApplyQualificationError(
        "The PostgreSQL source-provisioning apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.sourceProvisioningRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalSourceProvisioningApplyQualificationError(
          "The PostgreSQL source-provisioning function returned an ambiguous result."
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
