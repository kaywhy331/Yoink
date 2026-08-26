import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { BACKGROUND_TASK_KINDS } from "../../domain/src/background-task.js";
import { nowIso } from "../../domain/src/ids.js";
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
  POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION,
  buildPostgresObserverWitnessRefreshManifest,
  verifyPostgresObserverWitnessRefreshBoundary
} from "./postgres-observer-witness-refresh.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION = 1;
export const POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE =
  "yoink_hosted_delivery_lease_recovery_receipt";
export const POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION =
  "yoink_recover_hosted_delivery_leases";

const MAXIMUM_DELIVERY_ATTEMPTS = 20;
const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze(["text", "text"] as const);
const FUNCTION_RESULT_TYPE =
  "TABLE(inbox_requeued bigint, inbox_dead_lettered bigint, outbox_requeued bigint, outbox_dead_lettered bigint)";
const PROTECTED_TABLES = Object.freeze([
  "hosted_delivery_receipts",
  "inbox_messages",
  "outbox_events"
] as const);
const QUALIFIED_HANDLER_TASK_KINDS = Object.freeze([
  "notification_recovery",
  "execution_recovery",
  "operational_telemetry_retention",
  "observer_recipe_candidate_evaluation",
  "adapter_alert_reconciliation",
  "observer_recipe_witness_refresh"
] as const);

export interface PostgresHostedDeliveryLeaseRecoveryManifest {
  contractVersion: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  witnessRefreshContractVersion: typeof POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION;
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
  witnessRefreshManifestFingerprint: string;
  leaseRecoveryRole: {
    kind: "hosted_delivery_lease_recovery_boundary";
    name: string;
    functionName: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTableNames: string[];
    forcedRlsTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTableCount: 3;
  forcedRlsTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  boundaryHandlerTaskKinds: ["hosted_delivery_recovery"];
  qualifiedHandlerTaskKinds: [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention",
    "observer_recipe_candidate_evaluation",
    "adapter_alert_reconciliation",
    "observer_recipe_witness_refresh"
  ];
  qualifiedHandlerTaskKindCount: 6;
  totalHandlerTaskKindCount: number;
  maximumDeliveryAttempts: 20;
  serverBoundPrincipalLookup: true;
  databaseServerClock: true;
  deterministicReceiptHashParity: true;
  leaseRecoverySubBoundaryParity: true;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  mutationAuthority: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresHostedDeliveryLeaseRecoveryQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  witnessRefreshContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  witnessRefreshManifestFingerprint: string;
  leaseRecoveryRoleName: string;
  protectedTableCount: 3;
  forcedRlsTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  qualifiedHandlerTaskKindCount: 6;
  totalHandlerTaskKindCount: number;
  maximumDeliveryAttempts: 20;
  serverBoundPrincipalLookup: true;
  databaseServerClock: true;
  deterministicReceiptHashParity: true;
  leaseRecoverySubBoundaryParity: true;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  mutationAuthority: false;
  directTableAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  boundaryCatalogFingerprint: string;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresHostedDeliveryLeaseRecoveryCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  witnessRefreshContractVersion: 1;
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
  databaseServerClock: true;
  deterministicReceiptHashParity: true;
  readCommittedTransactionAdapter: true;
  nativeContentionQualified: true;
  leaseRecoverySubBoundaryParity: true;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  handlerTaskKindCount: 6;
  totalHandlerTaskKindCount: number;
  maximumDeliveryAttempts: 20;
  protectedTableCount: 3;
  forcedRlsTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresHostedDeliveryLeaseRecoveryResult {
  inboxRequeued: number;
  inboxDeadLettered: number;
  outboxRequeued: number;
  outboxDeadLettered: number;
}

export interface NodePostgresHostedDeliveryLeaseRecoveryDatabaseOptions {
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

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  witness_refresh_contract_version: string | number | bigint;
  phase: string;
  role_manifest_fingerprint: string;
  witness_refresh_manifest_fingerprint: string;
  lease_recovery_role_name: string;
  protected_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  qualified_handler_task_kind_count: string | number | bigint;
  total_handler_task_kind_count: string | number | bigint;
  maximum_delivery_attempts: string | number | bigint;
  server_bound_principal_lookup: boolean;
  database_server_clock: boolean;
  deterministic_receipt_hash_parity: boolean;
  lease_recovery_sub_boundary_parity: boolean;
  signal_ingress_repository_parity: boolean;
  hosted_delivery_handler_repository_parity: boolean;
  all_handler_repository_parity: boolean;
  mutation_authority: boolean;
  direct_table_access: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  boundary_catalog_fingerprint: string;
  applied_at: string;
  verified_at: string;
}

interface BoundaryInspection {
  protectedTableCount: number;
  forcedRlsTableCount: number;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryCatalogFingerprint: string;
}

interface RecoveryRow extends Record<string, unknown> {
  inboxRequeued: string | number | bigint;
  inboxDeadLettered: string | number | bigint;
  outboxRequeued: string | number | bigint;
  outboxDeadLettered: string | number | bigint;
}

let cachedCapabilityProjection:
Readonly<PostgresHostedDeliveryLeaseRecoveryCapabilityProjection> | null = null;

export class PostgresHostedDeliveryLeaseRecoveryQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresHostedDeliveryLeaseRecoveryQualificationError";
  }
}

function safeSchema(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role namespace is invalid."
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

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is out of range.`
    );
  }
  return parsed;
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is invalid.`
    );
  }
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is invalid.`
    );
  }
  return normalized;
}

function exactBoolean<T extends boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is invalid.`
    );
  }
  return expected;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function roleName(namespace: string): string {
  const value = `${namespace}_delivery_lease`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role name exceeds 63 bytes."
    );
  }
  return value;
}

function stableHashInputSql(parts: string[]): string {
  return parts.map((part) =>
    `pg_catalog.octet_length(${part})::text || ':' || ${part} || '|'`
  ).join(" || ");
}

export function hostedDeliveryLeaseRecoveryFunctionSource(
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): string {
  const receiptParts = stableHashInputSql([
    "'hosted_delivery_receipt_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "direction_value",
    "message_record.id::text",
    "disposition_value",
    "message_record.attempt::text",
    "'lease_expired'::text",
    "recovery_timestamp"
  ]);
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  recovery_timestamp TEXT;
  message_record RECORD;
  disposition_value TEXT;
  direction_value TEXT;
  receipt_input TEXT;
  inbox_requeued_count BIGINT := 0;
  inbox_dead_lettered_count BIGINT := 0;
  outbox_requeued_count BIGINT := 0;
  outbox_dead_lettered_count BIGINT := 0;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected hosted-delivery lease-recovery principal is invalid';
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
  recovery_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yoink_hosted_delivery_lease_recovery_v1:' || resolved_tenant_id || ':' || resolved_user_id,
      0
    )
  );

  direction_value := 'inbox';
  FOR message_record IN
    SELECT message.id, message.delivery_attempts AS attempt
    FROM ${relation(manifest.schemaName, "inbox_messages")} AS message
    WHERE message.tenant_id = resolved_tenant_id
      AND message.user_id = resolved_user_id
      AND message.state = 'processing'
      AND message.lease_capability_hash <> ''
      AND message.lease_expires_at <> ''
      AND message.lease_expires_at <= recovery_timestamp
    ORDER BY message.lease_expires_at, message.id
    FOR UPDATE
  LOOP
    disposition_value := CASE
      WHEN message_record.attempt >= ${MAXIMUM_DELIVERY_ATTEMPTS} THEN 'dead_letter'
      ELSE 'retry'
    END;
    UPDATE ${relation(manifest.schemaName, "inbox_messages")} AS message
    SET state = CASE WHEN disposition_value = 'dead_letter' THEN 'dead_letter' ELSE 'failed' END,
        lease_capability_hash = '', lease_expires_at = '',
        next_attempt_at = CASE WHEN disposition_value = 'dead_letter' THEN '' ELSE recovery_timestamp END,
        last_error_code = 'lease_expired', updated_at = recovery_timestamp
    WHERE message.id = message_record.id
      AND message.tenant_id = resolved_tenant_id
      AND message.user_id = resolved_user_id
      AND message.state = 'processing'
      AND message.lease_capability_hash <> ''
      AND message.lease_expires_at <> ''
      AND message.lease_expires_at <= recovery_timestamp;
    IF FOUND THEN
      receipt_input := ${receiptParts};
      INSERT INTO ${relation(manifest.schemaName, "hosted_delivery_receipts")}(
        id, tenant_id, user_id, direction, message_id, disposition,
        attempt, reason_code, receipt_hash, created_at
      ) VALUES (
        'delivery_receipt_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        resolved_tenant_id, resolved_user_id, direction_value, message_record.id,
        disposition_value, message_record.attempt, 'lease_expired',
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(receipt_input, 'UTF8')), 'hex'),
        recovery_timestamp
      );
      IF disposition_value = 'dead_letter' THEN
        inbox_dead_lettered_count := inbox_dead_lettered_count + 1;
      ELSE
        inbox_requeued_count := inbox_requeued_count + 1;
      END IF;
    END IF;
  END LOOP;

  direction_value := 'outbox';
  FOR message_record IN
    SELECT message.id, message.delivery_attempts AS attempt
    FROM ${relation(manifest.schemaName, "outbox_events")} AS message
    WHERE message.tenant_id = resolved_tenant_id
      AND message.delivery_state = 'pending'
      AND message.delivered_at = ''
      AND message.lease_capability_hash <> ''
      AND message.lease_expires_at <> ''
      AND message.lease_expires_at <= recovery_timestamp
    ORDER BY message.lease_expires_at, message.id
    FOR UPDATE
  LOOP
    disposition_value := CASE
      WHEN message_record.attempt >= ${MAXIMUM_DELIVERY_ATTEMPTS} THEN 'dead_letter'
      ELSE 'retry'
    END;
    UPDATE ${relation(manifest.schemaName, "outbox_events")} AS message
    SET delivery_state = CASE WHEN disposition_value = 'dead_letter' THEN 'dead_letter' ELSE 'pending' END,
        lease_capability_hash = '', lease_expires_at = '',
        next_attempt_at = CASE WHEN disposition_value = 'dead_letter' THEN '' ELSE recovery_timestamp END,
        last_error_code = 'lease_expired', updated_at = recovery_timestamp
    WHERE message.id = message_record.id
      AND message.tenant_id = resolved_tenant_id
      AND message.delivery_state = 'pending'
      AND message.delivered_at = ''
      AND message.lease_capability_hash <> ''
      AND message.lease_expires_at <> ''
      AND message.lease_expires_at <= recovery_timestamp;
    IF FOUND THEN
      receipt_input := ${receiptParts};
      INSERT INTO ${relation(manifest.schemaName, "hosted_delivery_receipts")}(
        id, tenant_id, user_id, direction, message_id, disposition,
        attempt, reason_code, receipt_hash, created_at
      ) VALUES (
        'delivery_receipt_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        resolved_tenant_id, resolved_user_id, direction_value, message_record.id,
        disposition_value, message_record.attempt, 'lease_expired',
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(receipt_input, 'UTF8')), 'hex'),
        recovery_timestamp
      );
      IF disposition_value = 'dead_letter' THEN
        outbox_dead_lettered_count := outbox_dead_lettered_count + 1;
      ELSE
        outbox_requeued_count := outbox_requeued_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT inbox_requeued_count, inbox_dead_lettered_count,
                      outbox_requeued_count, outbox_dead_lettered_count;
END
`;
}

export function buildPostgresHostedDeliveryLeaseRecoveryManifest(
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
  requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification"
): PostgresHostedDeliveryLeaseRecoveryManifest {
  const schema = safeSchema(requestedSchema);
  const previous = buildPostgresObserverWitnessRefreshManifest(
    schema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace,
    requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace
  );
  const leaseRecoveryRoleNamespace = safeNamespace(
    requestedLeaseRecoveryRoleNamespace,
    "yoink_delivery_qualification"
  );
  const priorNamespaces = new Set([
    previous.readRoleNamespace,
    previous.sessionRoleNamespace,
    previous.queueWriteRoleNamespace,
    previous.controlRoleNamespace,
    previous.notificationRecoveryRoleNamespace,
    previous.executionRecoveryRoleNamespace,
    previous.operationalRetentionRoleNamespace,
    previous.observerCandidateRoleNamespace,
    previous.alertDispatchRoleNamespace,
    previous.alertReconciliationRoleNamespace,
    previous.witnessRefreshRoleNamespace
  ]);
  if (priorNamespaces.has(leaseRecoveryRoleNamespace)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresHostedDeliveryLeaseRecoveryManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: 3,
    witnessRefreshContractVersion: 1,
    schemaName: previous.schemaName,
    readRoleNamespace: previous.readRoleNamespace,
    sessionRoleNamespace: previous.sessionRoleNamespace,
    queueWriteRoleNamespace: previous.queueWriteRoleNamespace,
    controlRoleNamespace: previous.controlRoleNamespace,
    notificationRecoveryRoleNamespace: previous.notificationRecoveryRoleNamespace,
    executionRecoveryRoleNamespace: previous.executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace: previous.operationalRetentionRoleNamespace,
    observerCandidateRoleNamespace: previous.observerCandidateRoleNamespace,
    alertDispatchRoleNamespace: previous.alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace: previous.alertReconciliationRoleNamespace,
    witnessRefreshRoleNamespace: previous.witnessRefreshRoleNamespace,
    leaseRecoveryRoleNamespace,
    witnessRefreshManifestFingerprint: previous.fingerprint,
    leaseRecoveryRole: {
      kind: "hosted_delivery_lease_recovery_boundary",
      name: roleName(leaseRecoveryRoleNamespace),
      functionName: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTableNames: [...PROTECTED_TABLES],
      forcedRlsTableNames: [...PROTECTED_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTableCount: 3,
    forcedRlsTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    boundaryHandlerTaskKinds: ["hosted_delivery_recovery"],
    qualifiedHandlerTaskKinds: [...QUALIFIED_HANDLER_TASK_KINDS],
    qualifiedHandlerTaskKindCount: 6,
    totalHandlerTaskKindCount: BACKGROUND_TASK_KINDS.length,
    maximumDeliveryAttempts: 20,
    serverBoundPrincipalLookup: true,
    databaseServerClock: true,
    deterministicReceiptHashParity: true,
    leaseRecoverySubBoundaryParity: true,
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    mutationAuthority: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresHostedDeliveryLeaseRecoveryCapabilityProjection():
PostgresHostedDeliveryLeaseRecoveryCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    witnessRefreshContractVersion: 1,
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
    databaseServerClock: true,
    deterministicReceiptHashParity: true,
    readCommittedTransactionAdapter: true,
    nativeContentionQualified: true,
    leaseRecoverySubBoundaryParity: true,
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    handlerTaskKindCount: 6,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    maximumDeliveryAttempts: 20,
    protectedTableCount: 3,
    forcedRlsTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): Promise<BoundaryInspection> {
  const role = manifest.leaseRecoveryRole.name;
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [role]
  );
  const roleRow = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !roleRow || roleRow.rolsuper || roleRow.rolinherit
    || roleRow.rolcreaterole || roleRow.rolcreatedb || roleRow.rolcanlogin
    || roleRow.rolreplication || roleRow.rolbypassrls) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role has an unsafe attribute."
    );
  }
  const membershipResult = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname = $1 OR member_role.rolname = $1`,
    [role]
  );
  if (exactInteger(membershipResult.rows[0]?.count, "membership count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role must remain unassigned."
    );
  }
  const directResult = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM information_schema.role_table_grants
       WHERE table_schema = $1 AND grantee = $2
     ) + (
       SELECT COUNT(*) FROM information_schema.role_column_grants
       WHERE table_schema = $1 AND grantee = $2
     ) AS count`,
    [manifest.schemaName, role]
  );
  if (exactInteger(directResult.rows[0]?.count, "direct grant count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role has direct table authority."
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
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role has an effective table privilege."
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
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role has an effective column privilege."
    );
  }
  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery schema privilege is invalid."
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
    || routine.routineName !== manifest.leaseRecoveryRole.functionName
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE || routine.volatility !== "v"
    || !routine.securityDefiner || !routine.strict || routine.leakproof
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role
    || routine.source !== hostedDeliveryLeaseRecoveryFunctionSource(manifest)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery function boundary is incomplete."
    );
  }
  const routineAcl = await session.query<{
    grantee: string;
    privilegeType: string;
    grantable: boolean;
  }>(
    `SELECT COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee,
            access.privilege_type AS "privilegeType", access.is_grantable AS grantable
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
      && row.privilegeType === "EXECUTE" && !row.grantable)
    || !routineAcl.rows.some((row) => row.grantee === routine.ownerName
      && row.privilegeType === "EXECUTE" && !row.grantable)
    || routineAcl.rows.some((row) => row.grantee === "PUBLIC")) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery function grant is not exact."
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
  if (exactInteger(accessibleSequences.rows[0]?.count, "accessible sequence count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role can access an application sequence."
    );
  }
  const rls = await session.query<{ tableName: string; enabled: boolean; forced: boolean }>(
    `SELECT relation.relname AS "tableName", relation.relrowsecurity AS enabled,
            relation.relforcerowsecurity AS forced
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relname = ANY($2::text[])
     ORDER BY relation.relname`,
    [manifest.schemaName, [...PROTECTED_TABLES]]
  );
  if (rls.rows.length !== PROTECTED_TABLES.length
    || rls.rows.some((row) => !row.enabled || !row.forced)
    || rls.rows.map((row) => row.tableName).join(",") !== [...PROTECTED_TABLES].join(",")) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery protected tables are not forced-RLS exact."
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
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role must not own schema objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role must not depend on a direct policy."
    );
  }
  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  if (exactInteger(principals.rows[0]?.count, "active principal count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "Hosted-delivery lease-recovery qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTableCount: rls.rows.length,
    forcedRlsTableCount: rls.rows.length,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryCatalogFingerprint: fingerprint({
      role: roleRow,
      routine,
      routineAcl: routineAcl.rows,
      rls: rls.rows
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): PostgresHostedDeliveryLeaseRecoveryQualificationReceipt {
  const receipt: PostgresHostedDeliveryLeaseRecoveryQualificationReceipt = {
    contractVersion: exactInteger(row.contract_version, "receipt contract version") as 1,
    cutoverContractVersion: exactInteger(row.cutover_contract_version, "cutover contract version") as 3,
    witnessRefreshContractVersion: exactInteger(
      row.witness_refresh_contract_version,
      "witness-refresh contract version"
    ) as 1,
    phase: row.phase as "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: row.role_manifest_fingerprint,
    witnessRefreshManifestFingerprint: row.witness_refresh_manifest_fingerprint,
    leaseRecoveryRoleName: row.lease_recovery_role_name,
    protectedTableCount: exactInteger(row.protected_table_count, "protected-table count") as 3,
    forcedRlsTableCount: exactInteger(row.forced_rls_table_count, "forced-RLS count") as 3,
    directTableGrantCount: exactInteger(row.direct_table_grant_count, "direct-grant count") as 0,
    functionGrantCount: exactInteger(row.function_grant_count, "function-grant count") as 1,
    membershipCount: exactInteger(row.membership_count, "membership count") as 0,
    activePrincipalCount: exactInteger(row.active_principal_count, "active-principal count") as 0,
    qualifiedHandlerTaskKindCount: exactInteger(
      row.qualified_handler_task_kind_count,
      "qualified-handler count"
    ) as 6,
    totalHandlerTaskKindCount: exactInteger(row.total_handler_task_kind_count, "total-handler count"),
    maximumDeliveryAttempts: exactInteger(row.maximum_delivery_attempts, "attempt limit") as 20,
    serverBoundPrincipalLookup: exactBoolean(
      row.server_bound_principal_lookup,
      true,
      "server-bound-principal flag"
    ),
    databaseServerClock: exactBoolean(row.database_server_clock, true, "server-clock flag"),
    deterministicReceiptHashParity: exactBoolean(
      row.deterministic_receipt_hash_parity,
      true,
      "receipt-hash parity flag"
    ),
    leaseRecoverySubBoundaryParity: exactBoolean(
      row.lease_recovery_sub_boundary_parity,
      true,
      "lease-recovery parity flag"
    ),
    signalIngressRepositoryParity: exactBoolean(
      row.signal_ingress_repository_parity,
      false,
      "signal-ingress parity flag"
    ),
    hostedDeliveryHandlerRepositoryParity: exactBoolean(
      row.hosted_delivery_handler_repository_parity,
      false,
      "handler parity flag"
    ),
    allHandlerRepositoryParity: exactBoolean(
      row.all_handler_repository_parity,
      false,
      "all-handler parity flag"
    ),
    mutationAuthority: exactBoolean(row.mutation_authority, false, "mutation-authority flag"),
    directTableAccess: exactBoolean(row.direct_table_access, false, "direct-table flag"),
    runtimeAuthority: exactBoolean(row.runtime_authority, false, "runtime-authority flag"),
    productionReady: exactBoolean(row.production_ready, false, "production-ready flag"),
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    appliedAt: timestamp(row.applied_at, "applied timestamp"),
    verifiedAt: timestamp(row.verified_at, "verified timestamp")
  };
  if (receipt.contractVersion !== 1 || receipt.cutoverContractVersion !== 3
    || receipt.witnessRefreshContractVersion !== 1 || receipt.phase !== "verified"
    || receipt.roleManifestFingerprint !== manifest.fingerprint
    || receipt.witnessRefreshManifestFingerprint !== manifest.witnessRefreshManifestFingerprint
    || receipt.leaseRecoveryRoleName !== manifest.leaseRecoveryRole.name
    || receipt.protectedTableCount !== 3 || receipt.forcedRlsTableCount !== 3
    || receipt.directTableGrantCount !== 0 || receipt.functionGrantCount !== 1
    || receipt.membershipCount !== 0 || receipt.activePrincipalCount !== 0
    || receipt.qualifiedHandlerTaskKindCount !== 6
    || receipt.totalHandlerTaskKindCount !== BACKGROUND_TASK_KINDS.length
    || receipt.maximumDeliveryAttempts !== 20
    || !receipt.serverBoundPrincipalLookup || !receipt.databaseServerClock
    || !receipt.deterministicReceiptHashParity || !receipt.leaseRecoverySubBoundaryParity
    || receipt.signalIngressRepositoryParity || receipt.hostedDeliveryHandlerRepositoryParity
    || receipt.allHandlerRepositoryParity || receipt.mutationAuthority
    || receipt.directTableAccess || receipt.runtimeAuthority || receipt.productionReady
    || !SHA256.test(receipt.boundaryCatalogFingerprint)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery receipt is incomplete or unsafe."
    );
  }
  return receipt;
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): Promise<PostgresHostedDeliveryLeaseRecoveryQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresHostedDeliveryLeaseRecoveryQualificationReceipt
): void {
  if (inspection.protectedTableCount !== receipt.protectedTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery boundary no longer matches its receipt."
    );
  }
}

function prerequisiteArguments(
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): Parameters<typeof verifyPostgresObserverWitnessRefreshBoundary> extends
  [PostgresCutoverDatabase, ...infer Rest] ? Rest : never {
  return [
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace,
    manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace,
    manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace
  ];
}

export async function verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
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
  requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification"
): Promise<PostgresHostedDeliveryLeaseRecoveryQualificationReceipt> {
  const manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace,
    requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace,
    requestedLeaseRecoveryRoleNamespace
  );
  await verifyPostgresObserverWitnessRefreshBoundary(database, ...prerequisiteArguments(manifest));
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt);
    return receipt;
  });
}

export async function applyPostgresHostedDeliveryLeaseRecoveryBoundary(
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
  now = Date.now()
): Promise<PostgresHostedDeliveryLeaseRecoveryQualificationReceipt> {
  const manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace,
    requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace,
    requestedLeaseRecoveryRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "Hosted-delivery lease-recovery qualification requires the supported BYPASSRLS control role."
    );
  }
  const authority = await database.query<{ rolcreaterole: boolean; rolsuper: boolean }>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "Hosted-delivery lease-recovery qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresObserverWitnessRefreshBoundary(database, ...prerequisiteArguments(manifest));
  const existing = await database.query<{
    roleExists: boolean;
    receiptExists: boolean;
    functionExists: boolean;
    guardExists: boolean;
  }>(
    `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS "roleExists",
            pg_catalog.to_regclass($2) IS NOT NULL AS "receiptExists",
            pg_catalog.to_regprocedure($3) IS NOT NULL AS "functionExists",
            pg_catalog.to_regprocedure($4) IS NOT NULL AS "guardExists"`,
    [
      manifest.leaseRecoveryRole.name,
      `${manifest.schemaName}.${POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE}`,
      `${manifest.schemaName}.${POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION}(text,text)`,
      `${manifest.schemaName}.yoink_guard_hosted_delivery_lease_recovery_receipt()`
    ]
  );
  if (existing.rows[0]?.roleExists || existing.rows[0]?.receiptExists
    || existing.rows[0]?.functionExists || existing.rows[0]?.guardExists) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "Hosted-delivery lease-recovery qualification refuses to reuse a role, function, guard, or receipt."
    );
  }
  const appliedAt = nowIso(now);
  await database.transaction(async (session) => {
    await session.query(
      `CREATE ROLE ${identifier(manifest.leaseRecoveryRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.leaseRecoveryRole.name)}`
    );
    for (const table of PROTECTED_TABLES) {
      await session.query(
        `ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`
      );
      await session.query(
        `ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`
      );
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, manifest.leaseRecoveryRole.functionName)}(
         expected_tenant_id text, expected_user_id text
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${hostedDeliveryLeaseRecoveryFunctionSource(manifest)}$yoink$`
    );
    const functionSignature = `${relation(
      manifest.schemaName,
      manifest.leaseRecoveryRole.functionName
    )}(text, text)`;
    await session.query(`REVOKE ALL ON FUNCTION ${functionSignature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${functionSignature}
       TO ${identifier(manifest.leaseRecoveryRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         witness_refresh_contract_version BIGINT NOT NULL CHECK (witness_refresh_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase = 'verified'),
         role_manifest_fingerprint TEXT NOT NULL,
         witness_refresh_manifest_fingerprint TEXT NOT NULL,
         lease_recovery_role_name TEXT NOT NULL,
         protected_table_count BIGINT NOT NULL CHECK (protected_table_count = 3),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 3),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         qualified_handler_task_kind_count BIGINT NOT NULL CHECK (qualified_handler_task_kind_count = 6),
         total_handler_task_kind_count BIGINT NOT NULL CHECK (total_handler_task_kind_count = 7),
         maximum_delivery_attempts BIGINT NOT NULL CHECK (maximum_delivery_attempts = 20),
         server_bound_principal_lookup BOOLEAN NOT NULL CHECK (server_bound_principal_lookup = TRUE),
         database_server_clock BOOLEAN NOT NULL CHECK (database_server_clock = TRUE),
         deterministic_receipt_hash_parity BOOLEAN NOT NULL CHECK (deterministic_receipt_hash_parity = TRUE),
         lease_recovery_sub_boundary_parity BOOLEAN NOT NULL CHECK (lease_recovery_sub_boundary_parity = TRUE),
         signal_ingress_repository_parity BOOLEAN NOT NULL CHECK (signal_ingress_repository_parity = FALSE),
         hosted_delivery_handler_repository_parity BOOLEAN NOT NULL CHECK (hosted_delivery_handler_repository_parity = FALSE),
         all_handler_repository_parity BOOLEAN NOT NULL CHECK (all_handler_repository_parity = FALSE),
         mutation_authority BOOLEAN NOT NULL CHECK (mutation_authority = FALSE),
         direct_table_access BOOLEAN NOT NULL CHECK (direct_table_access = FALSE),
         runtime_authority BOOLEAN NOT NULL CHECK (runtime_authority = FALSE),
         production_ready BOOLEAN NOT NULL CHECK (production_ready = FALSE),
         boundary_catalog_fingerprint TEXT NOT NULL,
         applied_at TEXT NOT NULL,
         verified_at TEXT NOT NULL
       )`
    );
    await session.query(
      `REVOKE ALL ON TABLE ${relation(
        manifest.schemaName,
        POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE
      )} FROM PUBLIC`
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_hosted_delivery_lease_recovery_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'hosted-delivery lease-recovery receipt is immutable';
       END
       $guard$`
    );
    await session.query(
      `REVOKE ALL ON FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_hosted_delivery_lease_recovery_receipt")}()
       FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_hosted_delivery_lease_recovery_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(
        manifest.schemaName,
        POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE
      )}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_hosted_delivery_lease_recovery_receipt")}()`
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `INSERT INTO ${relation(
        manifest.schemaName,
        POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE
      )}(
         singleton, contract_version, cutover_contract_version,
         witness_refresh_contract_version, phase, role_manifest_fingerprint,
         witness_refresh_manifest_fingerprint, lease_recovery_role_name,
         protected_table_count, forced_rls_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         qualified_handler_task_kind_count, total_handler_task_kind_count,
         maximum_delivery_attempts, server_bound_principal_lookup,
         database_server_clock, deterministic_receipt_hash_parity,
         lease_recovery_sub_boundary_parity, signal_ingress_repository_parity,
         hosted_delivery_handler_repository_parity, all_handler_repository_parity,
         mutation_authority, direct_table_access, runtime_authority,
         production_ready, boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 1, 'verified', $1, $2, $3,
         3, 3, 0, 1, 0, 0, 6, 7, 20,
         TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, FALSE,
         FALSE, FALSE, FALSE, FALSE, $4, $5, $6
       )`,
      [
        manifest.fingerprint,
        manifest.witnessRefreshManifestFingerprint,
        manifest.leaseRecoveryRole.name,
        inspection.boundaryCatalogFingerprint,
        appliedAt,
        verifiedAt
      ]
    );
  });
  return verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
    database,
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace,
    requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace,
    requestedLeaseRecoveryRoleNamespace
  );
}

class HostedDeliveryLeaseRecoverySession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresHostedDeliveryLeaseRecoveryDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresHostedDeliveryLeaseRecoveryManifest;

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
    options: NodePostgresHostedDeliveryLeaseRecoveryDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest(
      requestedSchema,
      requestedReadRoleNamespace,
      requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace,
      requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace,
      requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace,
      requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace,
      requestedAlertReconciliationRoleNamespace,
      requestedWitnessRefreshRoleNamespace,
      requestedLeaseRecoveryRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (maxConnections !== 1 && maxConnections !== 2) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted-delivery lease-recovery connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_hosted_delivery_lease_recovery_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async recover(
    principal: BackgroundWorkerPrincipal,
    now = Date.now()
  ): Promise<PostgresHostedDeliveryLeaseRecoveryResult> {
    const expectedTenantId = principalId(principal.tenantId, "expected tenant ID");
    const expectedUserId = principalId(principal.userId, "expected user ID");
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted-delivery lease-recovery cycle timestamp differs from the process clock."
      );
    }
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.leaseRecoveryRole.name)}`);
      const session = new HostedDeliveryLeaseRecoverySession(client);
      const result = await session.query<RecoveryRow>(
        `SELECT inbox_requeued AS "inboxRequeued",
                inbox_dead_lettered AS "inboxDeadLettered",
                outbox_requeued AS "outboxRequeued",
                outbox_dead_lettered AS "outboxDeadLettered"
         FROM ${relation(
          this.manifest.schemaName,
          this.manifest.leaseRecoveryRole.functionName
        )}($1, $2)`,
        [expectedTenantId, expectedUserId]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
          "The PostgreSQL hosted-delivery lease-recovery function returned an ambiguous result."
        );
      }
      const row = result.rows[0];
      const recovered = {
        inboxRequeued: exactInteger(row.inboxRequeued, "inbox requeue count"),
        inboxDeadLettered: exactInteger(row.inboxDeadLettered, "inbox dead-letter count"),
        outboxRequeued: exactInteger(row.outboxRequeued, "outbox requeue count"),
        outboxDeadLettered: exactInteger(row.outboxDeadLettered, "outbox dead-letter count")
      };
      await client.query("COMMIT");
      return recovered;
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
