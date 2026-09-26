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
  POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONTRACT_VERSION,
  buildPostgresSignalSourceSyncApplyManifest,
  verifyPostgresSignalSourceSyncApplyBoundary,
  type PostgresSignalSourceSyncApplyManifest
} from "./postgres-signal-source-sync-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_RECEIPT_TABLE =
  "yoink_signal_reservation_lifecycle_apply_receipt";
export const POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION =
  "yoink_apply_signal_reservation_lifecycle";
export const POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION =
  "APPLY_SPEND_RESERVATION_LIFECYCLE_V1";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 2_048;
const MAXIMUM_COMMITTED_AMOUNT_CENTS = 1_000_000_000;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const REQUEST_ID = /^reservation_lifecycle_[a-f0-9]{32}$/;
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
  "audit_events",
  "outbox_events",
  "spend_ledger_entries",
  "spend_reservations"
] as const);
const MUTATION_TABLES = Object.freeze([
  "audit_events",
  "outbox_events",
  "spend_ledger_entries",
  "spend_reservations"
] as const);

export type PostgresSignalReservationLifecycleOperation =
  | "release_spend_reservation"
  | "commit_spend_reservation";

interface PostgresSignalReservationLifecycleBasePayload {
  actionJobId: string;
  reservationId: string;
  confirmation: typeof POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION;
}

export interface PostgresSignalReservationReleasePayload
extends PostgresSignalReservationLifecycleBasePayload {
  releaseReason:
    | "offer_rejected"
    | "expired"
    | "cancelled"
    | "add_to_cart_confirmed_without_order"
    | "prepare_checkout_confirmed_without_order"
    | "reservation_expired";
}

export interface PostgresSignalReservationCommitPayload
extends PostgresSignalReservationLifecycleBasePayload {
  actualAmountCents: number;
}

export type PostgresSignalReservationLifecyclePayload =
  | PostgresSignalReservationReleasePayload
  | PostgresSignalReservationCommitPayload;

type PostgresSignalSourceSyncPredecessor = Pick<
  PostgresSignalSourceSyncApplyManifest,
  "schemaName" | "fingerprint" | "sourceSyncRoleNamespace"
>;

export interface PostgresSignalReservationLifecycleApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  sourceSyncApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  schemaName: string;
  reservationLifecycleRoleNamespace: string;
  sourceSyncApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalSourceSyncPredecessor;
  reservationLifecycleRole: {
    kind: "signal_reservation_lifecycle_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 2;
  protectedTenantTableCount: 6;
  forcedRlsTableCount: 6;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  spendScopeConsumed: true;
  deterministicRequestIdentity: true;
  immutableLifecycleReplay: true;
  lifecycleAwareOutboxReplay: true;
  currentActionReservationGraphRevalidation: true;
  terminalReleaseStateRevalidation: true;
  serverClockExpiryRelease: true;
  possibleMutationExpiryReleaseBlocked: true;
  verifiedSubmitOrderCommit: true;
  unambiguousVerifiedTotal: true;
  reservationCreationPredecessorParity: true;
  reservationReleaseParity: true;
  reservationCommitParity: true;
  appendOnlyLedgerParity: true;
  atomicReservationLedgerAuditOutbox: true;
  databaseOwnedTimestamps: true;
  missionFulfillmentMutation: false;
  checkoutMutation: false;
  orderSubmissionMutation: false;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  configurationWriterParity: false;
  reservationWriterParity: true;
  writerLockProtocolParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalReservationLifecycleCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  sourceSyncApplyContractVersion: 1;
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
  spendScopeConsumed: true;
  deterministicRequestIdentity: true;
  immutableLifecycleReplay: true;
  lifecycleAwareOutboxReplay: true;
  currentActionReservationGraphRevalidation: true;
  terminalReleaseStateRevalidation: true;
  serverClockExpiryRelease: true;
  possibleMutationExpiryReleaseBlocked: true;
  verifiedSubmitOrderCommit: true;
  unambiguousVerifiedTotal: true;
  reservationCreationPredecessorParity: true;
  reservationReleaseParity: true;
  reservationCommitParity: true;
  appendOnlyLedgerParity: true;
  atomicReservationLedgerAuditOutbox: true;
  databaseOwnedTimestamps: true;
  missionFulfillmentMutation: false;
  checkoutMutation: false;
  orderSubmissionMutation: false;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  configurationWriterParity: false;
  reservationWriterParity: true;
  writerLockProtocolParity: false;
  operationCount: 2;
  protectedTenantTableCount: 6;
  forcedRlsTableCount: 6;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  spendMutationAuthority: true;
  actionAuthority: false;
  checkoutAuthority: false;
  orderSubmissionAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalReservationLifecycleApplyResult {
  contractVersion: 1;
  operation: PostgresSignalReservationLifecycleOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "already_current" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  reservationMutated: boolean;
  ledgerMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  reservation: Record<string, unknown>;
  ledger: Record<string, unknown> | null;
  sourceSyncWriterParity: true;
  sourceWriterParity: false;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  configurationWriterParity: false;
  reservationWriterParity: true;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  spendMutationAuthority: true;
  actionAuthority: false;
  checkoutAuthority: false;
  orderSubmissionAuthority: false;
  runtimeAuthority: false;
}

export interface NodePostgresSignalReservationLifecycleApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalReservationLifecycleCapabilityProjection> | null = null;

export class PostgresSignalReservationLifecycleApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalReservationLifecycleApplyQualificationError";
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
    throw new PostgresSignalReservationLifecycleApplyQualificationError(
      "The PostgreSQL reservation-lifecycle schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalReservationLifecycleApplyQualificationError(
      "The PostgreSQL reservation-lifecycle role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_reservation_lifecycle`;
  if (value.length > 63) {
    throw new PostgresSignalReservationLifecycleApplyQualificationError(
      "The PostgreSQL reservation-lifecycle role name exceeds PostgreSQL's limit."
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

function releasePayload(
  payload: PostgresSignalReservationLifecyclePayload
): payload is PostgresSignalReservationReleasePayload {
  return "releaseReason" in payload;
}

export function buildPostgresSignalReservationLifecycleRequestId(
  principal: BackgroundWorkerPrincipal,
  operation: PostgresSignalReservationLifecycleOperation,
  payload: PostgresSignalReservationLifecyclePayload
): string {
  const parts = [
    "postgres-signal-reservation-lifecycle-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    String(operation ?? ""),
    String(payload?.actionJobId ?? ""),
    String(payload?.reservationId ?? ""),
    releasePayload(payload)
      ? String(payload.releaseReason ?? "")
      : String(payload.actualAmountCents ?? ""),
    String(payload?.confirmation ?? "")
  ];
  return `reservation_lifecycle_${createHash("sha256")
    .update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalReservationLifecycleApplyManifest(
  predecessorManifest = buildPostgresSignalSourceSyncApplyManifest(),
  requestedRoleNamespace = "yoink_reservation_lifecycle_q"
): PostgresSignalReservationLifecycleApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const reservationLifecycleRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(reservationLifecycleRoleNamespace)) {
    throw new PostgresSignalReservationLifecycleApplyQualificationError(
      "The PostgreSQL reservation-lifecycle role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<
    PostgresSignalReservationLifecycleApplyManifest,
    "fingerprint"
  > = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    sourceSyncApplyContractVersion: POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    schemaName,
    reservationLifecycleRoleNamespace,
    sourceSyncApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    reservationLifecycleRole: {
      kind: "signal_reservation_lifecycle_apply_boundary",
      name: roleName(reservationLifecycleRoleNamespace),
      functionName: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 2,
    protectedTenantTableCount: 6,
    forcedRlsTableCount: 6,
    mutationTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    spendScopeConsumed: true,
    deterministicRequestIdentity: true,
    immutableLifecycleReplay: true,
    lifecycleAwareOutboxReplay: true,
    currentActionReservationGraphRevalidation: true,
    terminalReleaseStateRevalidation: true,
    serverClockExpiryRelease: true,
    possibleMutationExpiryReleaseBlocked: true,
    verifiedSubmitOrderCommit: true,
    unambiguousVerifiedTotal: true,
    reservationCreationPredecessorParity: true,
    reservationReleaseParity: true,
    reservationCommitParity: true,
    appendOnlyLedgerParity: true,
    atomicReservationLedgerAuditOutbox: true,
    databaseOwnedTimestamps: true,
    missionFulfillmentMutation: false,
    checkoutMutation: false,
    orderSubmissionMutation: false,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    configurationWriterParity: false,
    reservationWriterParity: true,
    writerLockProtocolParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

function commonResultSql(outcome: string, mutated: boolean): string {
  return `pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'outcome', '${outcome}', 'mutationApplied', ${mutated ? "TRUE" : "FALSE"},
    'idempotentReplay', ${mutated ? "FALSE" : "TRUE"},
    'mutationStatementCount', ${mutated ? "4" : "0"},
    'mutationRowCount', ${mutated ? "4" : "0"},
    'reservationMutated', ${mutated ? "TRUE" : "FALSE"},
    'ledgerMutated', ${mutated ? "TRUE" : "FALSE"},
    'auditMutated', ${mutated ? "TRUE" : "FALSE"},
    'outboxMutated', ${mutated ? "TRUE" : "FALSE"},
    'reservation', reservation_result, 'ledger', ledger_result,
    'sourceSyncWriterParity', TRUE, 'sourceWriterParity', FALSE,
    'retailerQualificationWriterParity', TRUE,
    'missionPolicyWriterParity', TRUE, 'configurationWriterParity', FALSE,
    'reservationWriterParity', TRUE, 'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE, 'spendMutationAuthority', TRUE,
    'actionAuthority', FALSE, 'checkoutAuthority', FALSE,
    'orderSubmissionAuthority', FALSE, 'runtimeAuthority', FALSE
  )`;
}

export function signalReservationLifecycleApplyFunctionSource(
  manifest = buildPostgresSignalReservationLifecycleApplyManifest()
): string {
  const releaseRequestIdentityParts = stableHashInputSql([
    "'postgres-signal-reservation-lifecycle-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "operation_name",
    "action_job_id_value",
    "reservation_id_value",
    "release_reason_value",
    `'${POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION}'::text`
  ]);
  const commitRequestIdentityParts = stableHashInputSql([
    "'postgres-signal-reservation-lifecycle-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "operation_name",
    "action_job_id_value",
    "reservation_id_value",
    "actual_amount_cents_value::text",
    `'${POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION}'::text`
  ]);
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  derived_request_id TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  action_job_id_value TEXT;
  reservation_id_value TEXT;
  release_reason_value TEXT := '';
  actual_amount_cents_value BIGINT := 0;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  graph_record RECORD;
  confirmed_event_record RECORD;
  confirmed_total_value BIGINT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  ledger_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  ledger_count BIGINT;
  replay_record RECORD;
  expected_event_type TEXT;
  expected_reason_code TEXT;
  expected_message TEXT;
  mutation_timestamp TEXT;
  affected_rows BIGINT;
  reservation_result JSONB;
  ledger_result JSONB := NULL;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name NOT IN (
      'release_spend_reservation', 'commit_spend_reservation'
    )
    OR request_id !~ '^reservation_lifecycle_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal reservation-lifecycle request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal reservation-lifecycle payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(request_payload->'actionJobId') IS DISTINCT FROM 'string'
    OR request_payload->>'actionJobId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'reservationId') IS DISTINCT FROM 'string'
    OR request_payload->>'reservationId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <>
      '${POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal reservation-lifecycle payload shape is invalid';
  END IF;
  action_job_id_value := request_payload->>'actionJobId';
  reservation_id_value := request_payload->>'reservationId';

  IF operation_name = 'release_spend_reservation' THEN
    IF request_payload - ARRAY[
        'actionJobId', 'confirmation', 'releaseReason', 'reservationId'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 4
      OR pg_catalog.jsonb_typeof(request_payload->'releaseReason') IS DISTINCT FROM 'string'
      OR request_payload->>'releaseReason' NOT IN (
        'offer_rejected', 'expired', 'cancelled',
        'add_to_cart_confirmed_without_order',
        'prepare_checkout_confirmed_without_order', 'reservation_expired'
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal reservation release payload is invalid';
    END IF;
    release_reason_value := request_payload->>'releaseReason';
    expected_event_type := 'spend_reservation_released';
    expected_reason_code := release_reason_value;
    expected_message := 'The action reservation was released without recording a purchase.';
  ELSE
    IF request_payload - ARRAY[
        'actionJobId', 'actualAmountCents', 'confirmation', 'reservationId'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 4
      OR pg_catalog.jsonb_typeof(request_payload->'actualAmountCents') IS DISTINCT FROM 'number'
      OR request_payload->>'actualAmountCents' !~ '^[1-9][0-9]*$'
      OR (request_payload->>'actualAmountCents')::numeric > ${MAXIMUM_COMMITTED_AMOUNT_CENTS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal reservation commit payload is invalid';
    END IF;
    actual_amount_cents_value := (request_payload->>'actualAmountCents')::bigint;
    expected_event_type := 'spend_committed';
    expected_reason_code := 'verified_order_committed';
    expected_message := 'A verified submit-order total was committed to the append-only spend ledger.';
  END IF;

  SELECT MIN(principal.tenant_id), MIN(principal.user_id), COUNT(*)
    INTO resolved_tenant_id, resolved_user_id, resolved_principal_count
  FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)} AS principal
  WHERE principal.principal_role = session_user::text AND principal.active = TRUE;
  IF resolved_principal_count <> 1 OR resolved_tenant_id IS NULL
    OR resolved_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal is not active';
  END IF;
  IF resolved_tenant_id <> expected_tenant_id OR resolved_user_id <> expected_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal does not match the expected authenticated principal';
  END IF;

  IF operation_name = 'release_spend_reservation' THEN
    derived_request_id := 'reservation_lifecycle_' || pg_catalog.substr(
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        ${releaseRequestIdentityParts}, 'UTF8'
      )), 'hex'), 1, 32
    );
  ELSE
    derived_request_id := 'reservation_lifecycle_' || pg_catalog.substr(
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        ${commitRequestIdentityParts}, 'UTF8'
      )), 'hex'), 1, 32
    );
  END IF;
  IF request_id <> derived_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal reservation-lifecycle request identity is invalid';
  END IF;

  SELECT MIN(lock_result.result_json)::jsonb, COUNT(*)
    INTO writer_lock_result, writer_lock_result_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION)}(
    expected_tenant_id, expected_user_id, '', '', '', '00001'
  ) AS lock_result;
  IF writer_lock_result_count <> 1 OR writer_lock_result IS NULL
    OR writer_lock_result->>'contractVersion' <> '1'
    OR writer_lock_result->>'lockProtocolVersion' <> 'signal_action_constraints_v1'
    OR writer_lock_result->>'lockMask' <> '00001'
    OR writer_lock_result->>'scopeCount' <> '1'
    OR writer_lock_result->'lockScopeOrder' IS DISTINCT FROM
      pg_catalog.jsonb_build_array(
        'source', 'retailer_qualification', 'settings', 'mission_policy', 'spend'
      )
    OR writer_lock_result->>'sourceConnectionId' <> ''
    OR writer_lock_result->>'retailerId' <> ''
    OR writer_lock_result->>'missionId' <> ''
    OR writer_lock_result->>'mutationApplied' <> 'false'
    OR writer_lock_result->>'mutationAuthority' <> 'false'
    OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal reservation-lifecycle shared writer-lock protocol failed';
  END IF;

  SELECT job.id AS job_id, job.mission_id AS job_mission_id,
         job.intent_revision_id AS job_intent_revision_id,
         job.exact_offer_key_id AS job_exact_offer_key_id,
         job.offer_snapshot_id AS job_offer_snapshot_id,
         job.spend_reservation_id AS job_reservation_id,
         job.action AS job_action, job.quantity AS job_quantity,
         job.currency AS job_currency, job.state AS job_state,
         reservation.id AS reservation_id,
         reservation.mission_id AS reservation_mission_id,
         reservation.intent_revision_id AS reservation_intent_revision_id,
         reservation.exact_offer_key_id AS reservation_exact_offer_key_id,
         reservation.offer_snapshot_id AS reservation_offer_snapshot_id,
         reservation.action_job_id AS reservation_action_job_id,
         reservation.action AS reservation_action,
         reservation.quantity AS reservation_quantity,
         reservation.reserved_amount_cents,
         reservation.committed_amount_cents,
         reservation.currency AS reservation_currency,
         reservation.status AS reservation_status,
         reservation.release_reason, reservation.expires_at,
         reservation.created_at AS reservation_created_at,
         reservation.updated_at AS reservation_updated_at
    INTO graph_record
  FROM ${relation(manifest.schemaName, "action_jobs")} AS job
  JOIN ${relation(manifest.schemaName, "spend_reservations")} AS reservation
    ON reservation.id = reservation_id_value
  WHERE job.id = action_job_id_value
    AND job.tenant_id = resolved_tenant_id AND job.user_id = resolved_user_id
    AND reservation.tenant_id = resolved_tenant_id
    AND reservation.user_id = resolved_user_id
    AND reservation.action_job_id = job.id
  FOR UPDATE OF job, reservation;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal reservation-lifecycle action/reservation ownership is invalid';
  END IF;
  IF graph_record.job_reservation_id IS DISTINCT FROM graph_record.reservation_id
    OR graph_record.job_mission_id IS DISTINCT FROM graph_record.reservation_mission_id
    OR graph_record.job_intent_revision_id IS DISTINCT FROM graph_record.reservation_intent_revision_id
    OR graph_record.job_exact_offer_key_id IS DISTINCT FROM graph_record.reservation_exact_offer_key_id
    OR graph_record.job_offer_snapshot_id IS DISTINCT FROM graph_record.reservation_offer_snapshot_id
    OR graph_record.job_id IS DISTINCT FROM graph_record.reservation_action_job_id
    OR graph_record.job_action IS DISTINCT FROM graph_record.reservation_action
    OR graph_record.job_quantity IS DISTINCT FROM graph_record.reservation_quantity
    OR graph_record.job_currency IS DISTINCT FROM graph_record.reservation_currency THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal reservation-lifecycle action/reservation graph changed';
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(request_payload::text, 'UTF8')
  ), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_reservation_lifecycle_request_v1|' || resolved_tenant_id ||
      '|' || resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_reservation_lifecycle_outbox_v1|' || audit_id_value, 'UTF8'
    )
  ), 'hex'), 1, 32);
  ledger_id_value := 'spend_ledger_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_reservation_lifecycle_ledger_v1|' || audit_id_value, 'UTF8'
    )
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} WHERE id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} WHERE id = outbox_id_value;
  SELECT COUNT(*) INTO ledger_count
  FROM ${relation(manifest.schemaName, "spend_ledger_entries")} WHERE id = ledger_id_value;
  IF audit_count <> outbox_count OR audit_count <> ledger_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal reservation-lifecycle request graph is partial';
  END IF;

  IF audit_count = 1 THEN
    SELECT audit.tenant_id, audit.user_id, audit.correlation_id,
           audit.event_type, audit.reason_code, audit.message,
           audit.data_json::jsonb AS audit_data,
           audit.created_at AS audit_created_at,
           outbox.tenant_id AS outbox_tenant_id, outbox.aggregate_type,
           outbox.aggregate_id, outbox.event_type AS outbox_event_type,
           outbox.payload_json::jsonb AS outbox_payload,
           outbox.created_at AS outbox_created_at,
           ledger.tenant_id AS ledger_tenant_id,
           ledger.user_id AS ledger_user_id,
           ledger.reservation_id AS ledger_reservation_id,
           ledger.action_job_id AS ledger_action_job_id,
           ledger.entry_type,
           ledger.reserved_delta_cents AS ledger_reserved_delta_cents,
           ledger.spent_delta_cents,
           ledger.quantity_delta AS ledger_quantity_delta,
           ledger.currency AS ledger_currency, ledger.reason_code AS ledger_reason_code,
           ledger.correlation_id AS ledger_correlation_id,
           ledger.metadata_json::jsonb AS ledger_metadata,
           ledger.created_at AS ledger_created_at
      INTO STRICT replay_record
    FROM ${relation(manifest.schemaName, "audit_events")} AS audit
    JOIN ${relation(manifest.schemaName, "outbox_events")} AS outbox
      ON outbox.id = outbox_id_value
    JOIN ${relation(manifest.schemaName, "spend_ledger_entries")} AS ledger
      ON ledger.id = ledger_id_value
    WHERE audit.id = audit_id_value;
    reservation_result := replay_record.audit_data->'result'->'reservation';
    ledger_result := replay_record.audit_data->'result'->'ledger';
    IF replay_record.tenant_id <> resolved_tenant_id
      OR replay_record.user_id <> resolved_user_id
      OR replay_record.correlation_id <> action_job_id_value
      OR replay_record.event_type <> expected_event_type
      OR replay_record.reason_code <> expected_reason_code
      OR replay_record.message <> expected_message
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR replay_record.audit_data->'request' IS DISTINCT FROM request_payload
      OR pg_catalog.jsonb_typeof(reservation_result) IS DISTINCT FROM 'object'
      OR pg_catalog.jsonb_typeof(ledger_result) IS DISTINCT FROM 'object'
      OR reservation_result->>'id' <> reservation_id_value
      OR reservation_result->>'actionJobId' <> action_job_id_value
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'spend_reservation'
      OR replay_record.aggregate_id <> reservation_id_value
      OR replay_record.outbox_event_type <> expected_event_type
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> action_job_id_value
      OR replay_record.outbox_payload->>'reasonCode' <> expected_reason_code
      OR replay_record.outbox_payload->>'message' <> expected_message
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at
      OR replay_record.audit_created_at <> replay_record.ledger_created_at
      OR replay_record.ledger_tenant_id <> resolved_tenant_id
      OR replay_record.ledger_user_id <> resolved_user_id
      OR replay_record.ledger_reservation_id <> reservation_id_value
      OR replay_record.ledger_action_job_id <> action_job_id_value
      OR replay_record.ledger_reserved_delta_cents <> -graph_record.reserved_amount_cents
      OR replay_record.ledger_quantity_delta <> -graph_record.reservation_quantity
      OR replay_record.ledger_currency <> graph_record.reservation_currency
      OR replay_record.ledger_reason_code <> expected_reason_code
      OR replay_record.ledger_correlation_id <> action_job_id_value
      OR replay_record.ledger_metadata IS DISTINCT FROM '{}'::jsonb
      OR (operation_name = 'release_spend_reservation' AND (
        replay_record.entry_type <> 'released'
        OR replay_record.spent_delta_cents <> 0
        OR graph_record.reservation_status <> 'released'
        OR graph_record.release_reason <> release_reason_value
      ))
      OR (operation_name = 'commit_spend_reservation' AND (
        replay_record.entry_type <> 'committed'
        OR replay_record.spent_delta_cents <> actual_amount_cents_value
        OR graph_record.reservation_status <> 'committed'
        OR graph_record.committed_amount_cents <> actual_amount_cents_value
      )) THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal reservation-lifecycle replay graph changed';
    END IF;
    RETURN QUERY SELECT ${commonResultSql("already_applied", false)}::text;
    RETURN;
  END IF;

  reservation_result := pg_catalog.jsonb_build_object(
    'id', graph_record.reservation_id,
    'actionJobId', graph_record.reservation_action_job_id,
    'missionId', graph_record.reservation_mission_id,
    'intentRevisionId', graph_record.reservation_intent_revision_id,
    'exactOfferKeyId', graph_record.reservation_exact_offer_key_id,
    'offerSnapshotId', graph_record.reservation_offer_snapshot_id,
    'action', graph_record.reservation_action,
    'quantity', graph_record.reservation_quantity,
    'reservedAmountCents', graph_record.reserved_amount_cents,
    'committedAmountCents', graph_record.committed_amount_cents,
    'currency', graph_record.reservation_currency,
    'status', graph_record.reservation_status,
    'releaseReason', graph_record.release_reason,
    'expiresAt', graph_record.expires_at,
    'createdAt', graph_record.reservation_created_at,
    'updatedAt', graph_record.reservation_updated_at
  );

  IF operation_name = 'release_spend_reservation' THEN
    IF graph_record.reservation_status = 'released' THEN
      IF graph_record.release_reason <> release_reason_value THEN
        RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal reservation release reason conflicts with the terminal reservation';
      END IF;
      RETURN QUERY SELECT ${commonResultSql("already_current", false)}::text;
      RETURN;
    END IF;
    IF graph_record.reservation_status <> 'active' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal reservation is not releasable';
    END IF;
    IF (release_reason_value = 'reservation_expired' AND (
        graph_record.expires_at::timestamptz > pg_catalog.statement_timestamp()
        OR graph_record.job_state IN (
          'adding', 'cart_verified', 'checkout_review', 'submit_authorized',
          'submitting', 'confirmed', 'manual_review', 'submission_uncertain'
        )))
      OR (release_reason_value = 'offer_rejected'
        AND graph_record.job_state <> 'offer_rejected')
      OR (release_reason_value = 'expired' AND graph_record.job_state <> 'expired')
      OR (release_reason_value = 'cancelled' AND graph_record.job_state <> 'cancelled')
      OR (release_reason_value = 'add_to_cart_confirmed_without_order'
        AND (graph_record.job_state <> 'confirmed'
          OR graph_record.job_action <> 'add_to_cart'))
      OR (release_reason_value = 'prepare_checkout_confirmed_without_order'
        AND (graph_record.job_state <> 'confirmed'
          OR graph_record.job_action <> 'prepare_checkout')) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal reservation release is not bound to the current terminal action state';
    END IF;
  ELSE
    IF graph_record.reservation_status = 'committed' THEN
      IF graph_record.committed_amount_cents <> actual_amount_cents_value THEN
        RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal reservation committed total conflicts with the terminal reservation';
      END IF;
      RETURN QUERY SELECT ${commonResultSql("already_current", false)}::text;
      RETURN;
    END IF;
    IF graph_record.reservation_status <> 'active'
      OR graph_record.job_action <> 'submit_order'
      OR graph_record.reservation_action <> 'submit_order'
      OR graph_record.job_state <> 'confirmed'
      OR actual_amount_cents_value > graph_record.reserved_amount_cents THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal reservation commit is not bound to an active verified submit-order result';
    END IF;
    SELECT event.evidence_json::jsonb AS evidence
      INTO confirmed_event_record
    FROM ${relation(manifest.schemaName, "action_events")} AS event
    WHERE event.job_id = action_job_id_value AND event.state = 'confirmed'
    ORDER BY event.created_at DESC, event.id DESC LIMIT 1;
    IF NOT FOUND OR pg_catalog.jsonb_typeof(confirmed_event_record.evidence)
        IS DISTINCT FROM 'object'
      OR (confirmed_event_record.evidence ? 'allInTotalCents'
        AND pg_catalog.jsonb_typeof(confirmed_event_record.evidence->'allInTotalCents')
          IS DISTINCT FROM 'number')
      OR (confirmed_event_record.evidence ? 'orderTotalCents'
        AND pg_catalog.jsonb_typeof(confirmed_event_record.evidence->'orderTotalCents')
          IS DISTINCT FROM 'number')
      OR (NOT confirmed_event_record.evidence ? 'allInTotalCents'
        AND NOT confirmed_event_record.evidence ? 'orderTotalCents') THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal reservation commit lacks a verified numeric total';
    END IF;
    IF confirmed_event_record.evidence ? 'allInTotalCents' THEN
      IF confirmed_event_record.evidence->>'allInTotalCents' !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal reservation commit verified total is invalid';
      END IF;
      confirmed_total_value := (confirmed_event_record.evidence->>'allInTotalCents')::bigint;
    ELSE
      IF confirmed_event_record.evidence->>'orderTotalCents' !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal reservation commit verified total is invalid';
      END IF;
      confirmed_total_value := (confirmed_event_record.evidence->>'orderTotalCents')::bigint;
    END IF;
    IF (confirmed_event_record.evidence ? 'allInTotalCents'
        AND confirmed_event_record.evidence ? 'orderTotalCents'
        AND confirmed_event_record.evidence->>'allInTotalCents'
          <> confirmed_event_record.evidence->>'orderTotalCents')
      OR confirmed_total_value <> actual_amount_cents_value THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal reservation commit total does not match the verified action evidence';
    END IF;
  END IF;

  mutation_timestamp := pg_catalog.to_char(
    GREATEST(
      pg_catalog.statement_timestamp(),
      graph_record.reservation_updated_at::timestamptz + INTERVAL '1 millisecond'
    ) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  IF operation_name = 'release_spend_reservation' THEN
    UPDATE ${relation(manifest.schemaName, "spend_reservations")}
    SET status = 'released', release_reason = release_reason_value,
        updated_at = mutation_timestamp
    WHERE id = reservation_id_value AND tenant_id = resolved_tenant_id
      AND user_id = resolved_user_id AND status = 'active'
      AND updated_at = graph_record.reservation_updated_at;
  ELSE
    UPDATE ${relation(manifest.schemaName, "spend_reservations")}
    SET status = 'committed', committed_amount_cents = actual_amount_cents_value,
        updated_at = mutation_timestamp
    WHERE id = reservation_id_value AND tenant_id = resolved_tenant_id
      AND user_id = resolved_user_id AND status = 'active'
      AND updated_at = graph_record.reservation_updated_at;
  END IF;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal reservation-lifecycle mutation was ambiguous';
  END IF;

  reservation_result := reservation_result || pg_catalog.jsonb_build_object(
    'status', CASE WHEN operation_name = 'release_spend_reservation'
      THEN 'released' ELSE 'committed' END,
    'releaseReason', CASE WHEN operation_name = 'release_spend_reservation'
      THEN release_reason_value ELSE graph_record.release_reason END,
    'committedAmountCents', CASE WHEN operation_name = 'commit_spend_reservation'
      THEN actual_amount_cents_value ELSE graph_record.committed_amount_cents END,
    'updatedAt', mutation_timestamp
  );
  ledger_result := pg_catalog.jsonb_build_object(
    'id', ledger_id_value, 'reservationId', reservation_id_value,
    'actionJobId', action_job_id_value,
    'entryType', CASE WHEN operation_name = 'release_spend_reservation'
      THEN 'released' ELSE 'committed' END,
    'reservedDeltaCents', -graph_record.reserved_amount_cents,
    'spentDeltaCents', CASE WHEN operation_name = 'commit_spend_reservation'
      THEN actual_amount_cents_value ELSE 0 END,
    'quantityDelta', -graph_record.reservation_quantity,
    'currency', graph_record.reservation_currency,
    'reasonCode', expected_reason_code,
    'correlationId', action_job_id_value, 'createdAt', mutation_timestamp
  );
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'request', request_payload,
    'result', pg_catalog.jsonb_build_object(
      'reservation', reservation_result, 'ledger', ledger_result
    )
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value, 'correlationId', action_job_id_value,
    'reasonCode', expected_reason_code, 'message', expected_message,
    'data', audit_data_value
  );

  INSERT INTO ${relation(manifest.schemaName, "spend_ledger_entries")}(
    id, tenant_id, user_id, reservation_id, action_job_id, entry_type,
    reserved_delta_cents, spent_delta_cents, quantity_delta, currency,
    reason_code, correlation_id, metadata_json, created_at
  ) VALUES (
    ledger_id_value, resolved_tenant_id, resolved_user_id,
    reservation_id_value, action_job_id_value,
    CASE WHEN operation_name = 'release_spend_reservation'
      THEN 'released' ELSE 'committed' END,
    -graph_record.reserved_amount_cents,
    CASE WHEN operation_name = 'commit_spend_reservation'
      THEN actual_amount_cents_value ELSE 0 END,
    -graph_record.reservation_quantity, graph_record.reservation_currency,
    expected_reason_code, action_job_id_value, '{}', mutation_timestamp
  );
  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id,
    action_job_id_value, expected_event_type, expected_reason_code,
    expected_message, audit_data_value::text, mutation_timestamp
  );
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at, updated_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'spend_reservation',
    reservation_id_value, expected_event_type, outbox_payload_value::text,
    mutation_timestamp, '', mutation_timestamp
  );
  RETURN QUERY SELECT ${commonResultSql("applied", true)}::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalReservationLifecycleApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_reservation_lifecycle_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.reservationLifecycleRole.name,
    functionName: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalReservationLifecycleApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName:
      "yoink_guard_signal_reservation_lifecycle_apply_receipt",
    receiptTriggerName:
      "yoink_signal_reservation_lifecycle_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.sourceSyncApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      sourceSyncApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      operationCount: 2,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      spendScopeConsumed: true,
      deterministicRequestIdentity: true,
      immutableLifecycleReplay: true,
      lifecycleAwareOutboxReplay: true,
      currentActionReservationGraphRevalidation: true,
      terminalReleaseStateRevalidation: true,
      serverClockExpiryRelease: true,
      possibleMutationExpiryReleaseBlocked: true,
      verifiedSubmitOrderCommit: true,
      unambiguousVerifiedTotal: true,
      reservationCreationPredecessorParity: true,
      reservationReleaseParity: true,
      reservationCommitParity: true,
      appendOnlyLedgerParity: true,
      atomicReservationLedgerAuditOutbox: true,
      databaseOwnedTimestamps: true,
      missionFulfillmentMutation: false,
      checkoutMutation: false,
      orderSubmissionMutation: false,
      sourceStatusWriterParity: true,
      sourceSyncWriterParity: true,
      sourceWriterParity: false,
      retailerQualificationWriterParity: true,
      missionPolicyWriterParity: true,
      configurationWriterParity: false,
      reservationWriterParity: true,
      writerLockProtocolParity: false,
      actionAuthority: false,
      checkoutAuthority: false,
      orderSubmissionAuthority: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalReservationLifecycleCapabilityProjection():
PostgresSignalReservationLifecycleCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalReservationLifecycleApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    sourceSyncApplyContractVersion: 1,
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
    spendScopeConsumed: true,
    deterministicRequestIdentity: true,
    immutableLifecycleReplay: true,
    lifecycleAwareOutboxReplay: true,
    currentActionReservationGraphRevalidation: true,
    terminalReleaseStateRevalidation: true,
    serverClockExpiryRelease: true,
    possibleMutationExpiryReleaseBlocked: true,
    verifiedSubmitOrderCommit: true,
    unambiguousVerifiedTotal: true,
    reservationCreationPredecessorParity: true,
    reservationReleaseParity: true,
    reservationCommitParity: true,
    appendOnlyLedgerParity: true,
    atomicReservationLedgerAuditOutbox: true,
    databaseOwnedTimestamps: true,
    missionFulfillmentMutation: false,
    checkoutMutation: false,
    orderSubmissionMutation: false,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    sourceWriterParity: false,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    configurationWriterParity: false,
    reservationWriterParity: true,
    writerLockProtocolParity: false,
    operationCount: 2,
    protectedTenantTableCount: 6,
    forcedRlsTableCount: 6,
    mutationTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    spendMutationAuthority: true,
    actionAuthority: false,
    checkoutAuthority: false,
    orderSubmissionAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export type PostgresSignalReservationLifecycleApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalReservationLifecycleApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalReservationLifecycleApplyManifest()
): Promise<PostgresSignalReservationLifecycleApplyQualificationReceipt> {
  await verifyPostgresSignalSourceSyncApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalSourceSyncApplyManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalReservationLifecycleApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalReservationLifecycleApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalReservationLifecycleApplyQualificationReceipt> {
  await verifyPostgresSignalSourceSyncApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalSourceSyncApplyManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalReservationLifecycleApplyQualificationError(
      `The PostgreSQL reservation-lifecycle ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalReservationLifecycleOperation,
  requestId: string
): PostgresSignalReservationLifecycleApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalReservationLifecycleApplyQualificationError(
      "The PostgreSQL reservation-lifecycle result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const reservation = result.reservation;
  const ledger = result.ledger;
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "already_current", "already_applied"])
      .has(String(result.outcome))
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || !Number.isSafeInteger(result.mutationStatementCount)
    || !Number.isSafeInteger(result.mutationRowCount)
    || typeof result.reservationMutated !== "boolean"
    || typeof result.ledgerMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || result.mutationApplied !== (result.outcome === "applied")
    || result.idempotentReplay !== (result.outcome !== "applied")
    || result.mutationStatementCount !== (result.outcome === "applied" ? 4 : 0)
    || result.mutationRowCount !== (result.outcome === "applied" ? 4 : 0)
    || result.reservationMutated !== (result.outcome === "applied")
    || result.ledgerMutated !== (result.outcome === "applied")
    || result.auditMutated !== (result.outcome === "applied")
    || result.outboxMutated !== (result.outcome === "applied")
    || !reservation || typeof reservation !== "object" || Array.isArray(reservation)
    || (ledger !== null && (!ledger || typeof ledger !== "object" || Array.isArray(ledger)))
    || result.sourceSyncWriterParity !== true
    || result.sourceWriterParity !== false
    || result.retailerQualificationWriterParity !== true
    || result.missionPolicyWriterParity !== true
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== true
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true
    || result.spendMutationAuthority !== true
    || result.actionAuthority !== false
    || result.checkoutAuthority !== false
    || result.orderSubmissionAuthority !== false
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalReservationLifecycleApplyQualificationError(
      "The PostgreSQL reservation-lifecycle result contract changed."
    );
  }
  return result as unknown as PostgresSignalReservationLifecycleApplyResult;
}

export class NodePostgresSignalReservationLifecycleApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalReservationLifecycleApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalReservationLifecycleApplyManifest(),
    options: NodePostgresSignalReservationLifecycleApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalReservationLifecycleApplyQualificationError(
        "The PostgreSQL reservation-lifecycle connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_reservation_lifecycle"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_reservation_lifecycle");
  }

  async applyReservationLifecycle(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalReservationLifecycleOperation,
    requestIdValue: string,
    requestPayload: PostgresSignalReservationLifecyclePayload
  ): Promise<PostgresSignalReservationLifecycleApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as
      PostgresSignalReservationLifecycleOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (!new Set<PostgresSignalReservationLifecycleOperation>([
      "release_spend_reservation", "commit_spend_reservation"
    ]).has(operation)
      || !REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalReservationLifecycleRequestId(
        { tenantId, userId }, operation, requestPayload
      )
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalReservationLifecycleApplyQualificationError(
        "The PostgreSQL reservation-lifecycle apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(
        `SET LOCAL ROLE ${identifier(this.manifest.reservationLifecycleRole.name)}`
      );
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalReservationLifecycleApplyQualificationError(
          "The PostgreSQL reservation-lifecycle function returned an ambiguous result."
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
