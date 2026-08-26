import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { BACKGROUND_TASK_KINDS } from "../../domain/src/background-task.js";
import { nowIso } from "../../domain/src/ids.js";
import { BACKGROUND_TASK_HISTORY_RETENTION_DAYS } from "./background-task-repository.js";
import {
  OBSERVER_RECIPE_RECOVERY_RETENTION_AUDIT_MESSAGE,
  OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
  OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH,
  OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION
} from "./observer-recipe-recovery-retention-repository.js";
import { OPERATIONAL_TELEMETRY_RETENTION_DAYS } from "./operational-telemetry-repository.js";
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
  POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
  buildPostgresExecutionRecoveryManifest,
  verifyPostgresExecutionRecoveryBoundary
} from "./postgres-execution-recovery.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION = 1;
export const POSTGRES_OPERATIONAL_RETENTION_RECEIPT_TABLE =
  "yoink_operational_retention_receipt";
export const POSTGRES_OPERATIONAL_RETENTION_FUNCTION =
  "yoink_apply_operational_retention";

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RECEIPT_ID = /^(?:telemetry_retention|observer_recovery_retention)_[a-f0-9]{32}$/;
const BOUNDARY_HANDLER_TASK_KINDS = Object.freeze([
  "operational_telemetry_retention"
] as const);
const QUALIFIED_HANDLER_TASK_KINDS = Object.freeze([
  "notification_recovery",
  "execution_recovery",
  "operational_telemetry_retention"
] as const);
const PROTECTED_TABLES = Object.freeze([
  "audit_events",
  "background_task_events",
  "background_tasks",
  "observer_recipe_recovery_evidence",
  "observer_recipe_recovery_retention_receipts",
  "observer_recipe_recovery_reviews",
  "operational_error_events",
  "operational_request_rollups",
  "operational_telemetry_retention_receipts",
  "outbox_events"
] as const);
const FUNCTION_ARGUMENT_TYPES = Object.freeze(["text", "text"] as const);
const FUNCTION_RESULT_TYPE =
  "TABLE(deleted_rollup_rows bigint, deleted_error_events bigint, cutoff_at text, telemetry_retention_receipt_id text, deleted_task_runs bigint, task_history_cutoff_at text, deleted_recovery_evidence bigint, deleted_recovery_review_events bigint, recovery_evidence_cutoff_at text, recovery_evidence_retention_days bigint, recovery_evidence_retention_receipt_id text)";
const MAXIMUM_CLOCK_SKEW_MS = 300_000;

export interface PostgresOperationalRetentionManifest {
  contractVersion: typeof POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  executionRecoveryContractVersion: typeof POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION;
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  notificationRecoveryRoleNamespace: string;
  executionRecoveryRoleNamespace: string;
  operationalRetentionRoleNamespace: string;
  executionRecoveryManifestFingerprint: string;
  operationalRetentionRole: {
    kind: "operational_telemetry_retention_handler";
    name: string;
    functionName: typeof POSTGRES_OPERATIONAL_RETENTION_FUNCTION;
    functionArgumentTypes: string[];
    protectedTableNames: string[];
    forcedRlsTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
    insertAccess: false;
    deleteAccess: false;
  };
  protectedTableCount: 10;
  forcedRlsTableCount: 10;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  boundaryHandlerTaskKinds: ["operational_telemetry_retention"];
  boundaryHandlerTaskKindCount: 1;
  qualifiedHandlerTaskKinds: [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention"
  ];
  qualifiedHandlerTaskKindCount: 3;
  totalHandlerTaskKindCount: number;
  operationalRetentionRepositoryParity: true;
  executionRecoveryRepositoryParity: true;
  notificationRecoveryRepositoryParity: true;
  serverClockBoundRetention: true;
  serverAuthenticatedReceiptActor: true;
  boundedEvidenceDeletionLimit: typeof OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH;
  fullHandlerRepositoryParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresOperationalRetentionQualificationReceipt {
  contractVersion: typeof POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  executionRecoveryContractVersion: typeof POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION;
  phase: "verified";
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  notificationRecoveryRoleNamespace: string;
  executionRecoveryRoleNamespace: string;
  operationalRetentionRoleNamespace: string;
  roleManifestFingerprint: string;
  executionRecoveryManifestFingerprint: string;
  operationalRetentionRoleName: string;
  protectedTableCount: 10;
  forcedRlsTableCount: 10;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryHandlerTaskKindCount: 1;
  qualifiedHandlerTaskKindCount: 3;
  totalHandlerTaskKindCount: number;
  boundaryCatalogFingerprint: string;
  serverBoundPrincipalLookup: true;
  serverClockBoundRetention: true;
  serverAuthenticatedReceiptActor: true;
  boundedEvidenceDeletionLimit: typeof OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH;
  operationalRetentionRepositoryParity: true;
  executionRecoveryRepositoryParity: true;
  notificationRecoveryRepositoryParity: true;
  fullHandlerRepositoryParity: false;
  directTableAccess: false;
  insertAccess: false;
  deleteAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresOperationalRetentionCapabilityProjection {
  contractVersion: typeof POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  executionRecoveryContractVersion: typeof POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION;
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
  serverClockBoundRetention: true;
  serverAuthenticatedReceiptActor: true;
  boundedEvidenceDeletionLimit: typeof OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH;
  readCommittedTransactionAdapter: true;
  operationalRetentionRepositoryParity: true;
  executionRecoveryRepositoryParity: true;
  notificationRecoveryRepositoryParity: true;
  fullHandlerRepositoryParity: false;
  handlerTaskKindCount: 3;
  totalHandlerTaskKindCount: number;
  protectedTableCount: 10;
  forcedRlsTableCount: 10;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  insertAccess: false;
  deleteAccess: false;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresOperationalRetentionResult {
  deletedRollupRows: number;
  deletedErrorEvents: number;
  cutoffAt: string;
  receiptId: string;
  deletedTaskRuns: number;
  taskHistoryCutoffAt: string;
  deletedRecoveryEvidence: number;
  deletedRecoveryReviewEvents: number;
  recoveryEvidenceCutoffAt: string;
  recoveryEvidenceRetentionDays: number;
  recoveryEvidenceRetentionReceiptId: string;
}

export interface NodePostgresOperationalRetentionDatabaseOptions {
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

interface RoleAuthorityRow extends Record<string, unknown> {
  rolcreaterole: boolean;
  rolsuper: boolean;
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
  execution_recovery_contract_version: string | number | bigint;
  phase: string;
  read_role_namespace: string;
  session_role_namespace: string;
  queue_write_role_namespace: string;
  control_role_namespace: string;
  notification_recovery_role_namespace: string;
  execution_recovery_role_namespace: string;
  operational_retention_role_namespace: string;
  role_manifest_fingerprint: string;
  execution_recovery_manifest_fingerprint: string;
  operational_retention_role_name: string;
  protected_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  boundary_handler_task_kind_count: string | number | bigint;
  qualified_handler_task_kind_count: string | number | bigint;
  total_handler_task_kind_count: string | number | bigint;
  boundary_catalog_fingerprint: string;
  server_bound_principal_lookup: boolean;
  server_clock_bound_retention: boolean;
  server_authenticated_receipt_actor: boolean;
  bounded_evidence_deletion_limit: string | number | bigint;
  operational_retention_repository_parity: boolean;
  execution_recovery_repository_parity: boolean;
  notification_recovery_repository_parity: boolean;
  full_handler_repository_parity: boolean;
  direct_table_access: boolean;
  insert_access: boolean;
  delete_access: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  applied_at: string;
  verified_at: string;
}

interface BoundaryInspection {
  protectedTableCount: number;
  forcedRlsTableCount: number;
  directTableGrantCount: number;
  functionGrantCount: number;
  membershipCount: number;
  activePrincipalCount: number;
  boundaryCatalogFingerprint: string;
}

let cachedCapabilityProjection: Readonly<PostgresOperationalRetentionCapabilityProjection> | null = null;

export class PostgresOperationalRetentionQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresOperationalRetentionQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention schema is invalid."
    );
  }
  return normalized;
}

function roleNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role namespace must contain 3 through 32 lowercase letters, numbers, or underscores."
    );
  }
  return normalized;
}

function operationalRetentionRoleName(namespace: string): string {
  const value = `${namespace}_operational_retention`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role name exceeds 63 bytes."
    );
  }
  return value;
}

function identifier(value: string): string {
  return `"${value}"`;
}

function relation(schema: string, object: string): string {
  return `${identifier(schema)}.${identifier(object)}`;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresOperationalRetentionQualificationError(
      `The PostgreSQL operational-retention ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresOperationalRetentionQualificationError(
      `The PostgreSQL operational-retention ${label} is out of range.`
    );
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresOperationalRetentionQualificationError(
      `The PostgreSQL operational-retention ${label} is invalid.`
    );
  }
  return normalized;
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresOperationalRetentionQualificationError(
      `The PostgreSQL operational-retention ${label} is invalid.`
    );
  }
  return normalized;
}

function receiptId(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (normalized && !RECEIPT_ID.test(normalized)) {
    throw new PostgresOperationalRetentionQualificationError(
      `The PostgreSQL operational-retention ${label} is invalid.`
    );
  }
  return normalized;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function generatedId(prefix: string): string {
  return `${sqlLiteral(`${prefix}_`)} || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')`;
}

function auditSource(manifest: PostgresOperationalRetentionManifest): string {
  return `
    audit_id := ${generatedId("audit")};
    outbox_id := ${generatedId("outbox")};
    audit_data := pg_catalog.json_build_object(
      'policyVersion', ${sqlLiteral(OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION)},
      'retentionDays', ${OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS},
      'cutoffAt', recovery_evidence_cutoff,
      'deletedEvidenceCount', deleted_recovery_evidence_count,
      'deletedReviewEventCount', deleted_recovery_review_count,
      'normalizedValuesRecorded', FALSE,
      'applicationAffected', FALSE,
      'fieldFillApplied', FALSE,
      'qualificationAffected', FALSE,
      'actionEnqueued', FALSE,
      'browserInvoked', FALSE
    )::text;
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type,
      reason_code, message, data_json, created_at
    ) VALUES (
      audit_id, resolved_tenant_id, resolved_user_id,
      recovery_evidence_receipt_id,
      'observer_recipe_recovery_retention_applied',
      ${sqlLiteral(OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION)},
      ${sqlLiteral(OBSERVER_RECIPE_RECOVERY_RETENTION_AUDIT_MESSAGE)},
      audit_data, retention_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at
    ) VALUES (
      outbox_id, resolved_tenant_id,
      'observer_recipe_recovery_retention', recovery_evidence_receipt_id,
      'observer_recipe_recovery_retention_applied',
      pg_catalog.json_build_object(
        'auditId', audit_id,
        'correlationId', recovery_evidence_receipt_id,
        'reasonCode', ${sqlLiteral(OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION)},
        'message', ${sqlLiteral(OBSERVER_RECIPE_RECOVERY_RETENTION_AUDIT_MESSAGE)},
        'data', audit_data::json
      )::text,
      retention_timestamp, ''
    );`;
}

function operationalRetentionFunctionSource(
  manifest: PostgresOperationalRetentionManifest
): string {
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  retention_clock TIMESTAMPTZ;
  retention_timestamp TEXT;
  operational_cutoff TEXT;
  recovery_evidence_cutoff TEXT;
  deleted_rollup_count BIGINT := 0;
  deleted_error_count BIGINT := 0;
  telemetry_receipt_id TEXT := '';
  deleted_task_count BIGINT := 0;
  evidence_ids TEXT[] := ARRAY[]::text[];
  deleted_recovery_evidence_count BIGINT := 0;
  deleted_recovery_review_count BIGINT := 0;
  recovery_evidence_receipt_id TEXT := '';
  audit_id TEXT;
  outbox_id TEXT;
  audit_data TEXT;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected operational-retention principal is invalid';
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
  retention_clock := pg_catalog.statement_timestamp();
  retention_timestamp := pg_catalog.to_char(
    retention_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  operational_cutoff := pg_catalog.to_char(
    (retention_clock - interval '${OPERATIONAL_TELEMETRY_RETENTION_DAYS} days') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  recovery_evidence_cutoff := pg_catalog.to_char(
    (retention_clock - interval '${OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS} days') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yoink_operational_retention_v1:' || resolved_tenant_id,
      0
    )
  );

  DELETE FROM ${relation(manifest.schemaName, "operational_request_rollups")}
  WHERE tenant_id = resolved_tenant_id AND bucket_start < operational_cutoff;
  GET DIAGNOSTICS deleted_rollup_count = ROW_COUNT;
  DELETE FROM ${relation(manifest.schemaName, "operational_error_events")}
  WHERE tenant_id = resolved_tenant_id AND occurred_at < operational_cutoff;
  GET DIAGNOSTICS deleted_error_count = ROW_COUNT;
  IF deleted_rollup_count > 0 OR deleted_error_count > 0 THEN
    telemetry_receipt_id := ${generatedId("telemetry_retention")};
    INSERT INTO ${relation(manifest.schemaName, "operational_telemetry_retention_receipts")}(
      id, tenant_id, cutoff_at, deleted_rollup_rows,
      deleted_error_events, privacy_classification, created_at
    ) VALUES (
      telemetry_receipt_id, resolved_tenant_id, operational_cutoff,
      deleted_rollup_count, deleted_error_count,
      'operational_aggregate', retention_timestamp
    );
  END IF;

  DELETE FROM ${relation(manifest.schemaName, "background_tasks")}
  WHERE tenant_id = resolved_tenant_id AND subject_user_id = resolved_user_id
    AND state IN ('succeeded', 'cancelled')
    AND completed_at <> '' AND completed_at <= operational_cutoff;
  GET DIAGNOSTICS deleted_task_count = ROW_COUNT;

  SELECT COALESCE(
           pg_catalog.array_agg(candidate.id ORDER BY candidate.received_at, candidate.id),
           ARRAY[]::text[]
         )
    INTO evidence_ids
  FROM (
    SELECT evidence.id, evidence.received_at
    FROM ${relation(manifest.schemaName, "observer_recipe_recovery_evidence")} AS evidence
    WHERE evidence.tenant_id = resolved_tenant_id
      AND evidence.user_id = resolved_user_id
      AND evidence.received_at <= recovery_evidence_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM ${relation(manifest.schemaName, "observer_recipe_recovery_reviews")} AS review
        WHERE review.tenant_id = evidence.tenant_id
          AND review.user_id = evidence.user_id
          AND review.evidence_id = evidence.id
          AND review.created_at > recovery_evidence_cutoff
      )
    ORDER BY evidence.received_at, evidence.id
    LIMIT ${OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH}
    FOR UPDATE OF evidence SKIP LOCKED
  ) AS candidate;
  IF pg_catalog.cardinality(evidence_ids) > 0 THEN
    SELECT COUNT(*) INTO deleted_recovery_review_count
    FROM ${relation(manifest.schemaName, "observer_recipe_recovery_reviews")}
    WHERE tenant_id = resolved_tenant_id AND user_id = resolved_user_id
      AND evidence_id = ANY(evidence_ids);
    DELETE FROM ${relation(manifest.schemaName, "observer_recipe_recovery_evidence")}
    WHERE tenant_id = resolved_tenant_id AND user_id = resolved_user_id
      AND id = ANY(evidence_ids);
    GET DIAGNOSTICS deleted_recovery_evidence_count = ROW_COUNT;
    IF deleted_recovery_evidence_count <> pg_catalog.cardinality(evidence_ids) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'bounded recovery-evidence retention set changed before deletion completed';
    END IF;
    recovery_evidence_receipt_id := ${generatedId("observer_recovery_retention")};
    INSERT INTO ${relation(manifest.schemaName, "observer_recipe_recovery_retention_receipts")}(
      id, tenant_id, user_id, policy_version, retention_days, cutoff_at,
      deleted_evidence_count, deleted_review_event_count,
      application_affected, field_fill_applied, created_by_actor_id,
      privacy_classification, created_at
    ) VALUES (
      recovery_evidence_receipt_id, resolved_tenant_id, resolved_user_id,
      ${sqlLiteral(OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION)},
      ${OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS}, recovery_evidence_cutoff,
      deleted_recovery_evidence_count, deleted_recovery_review_count,
      0, 0, session_user::text,
      'restricted_user_aggregate', retention_timestamp
    );
    ${auditSource(manifest)}
  END IF;

  RETURN QUERY SELECT
    deleted_rollup_count, deleted_error_count, operational_cutoff,
    telemetry_receipt_id, deleted_task_count, operational_cutoff,
    deleted_recovery_evidence_count, deleted_recovery_review_count,
    recovery_evidence_cutoff,
    ${OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS}::BIGINT,
    recovery_evidence_receipt_id;
END
`;
}

export function buildPostgresOperationalRetentionManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification"
): PostgresOperationalRetentionManifest {
  const schema = schemaName(requestedSchema);
  const readNamespace = roleNamespace(requestedReadRoleNamespace, "yoink_qualification");
  const sessionNamespace = roleNamespace(requestedSessionRoleNamespace, "yoink_session_qualification");
  const queueNamespace = roleNamespace(requestedQueueWriteRoleNamespace, "yoink_queue_write_qualification");
  const controlNamespace = roleNamespace(requestedControlRoleNamespace, "yoink_control_qualification");
  const notificationNamespace = roleNamespace(
    requestedNotificationRecoveryRoleNamespace,
    "yoink_notify_qualification"
  );
  const executionNamespace = roleNamespace(
    requestedExecutionRecoveryRoleNamespace,
    "yoink_execute_qualification"
  );
  const retentionNamespace = roleNamespace(
    requestedOperationalRetentionRoleNamespace,
    "yoink_retention_qualification"
  );
  if (new Set([
    readNamespace,
    sessionNamespace,
    queueNamespace,
    controlNamespace,
    notificationNamespace,
    executionNamespace,
    retentionNamespace
  ]).size !== 7) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL read, session, queue-write, worker-control, notification-recovery, execution-recovery, and operational-retention namespaces must be distinct."
    );
  }
  const executionManifest = buildPostgresExecutionRecoveryManifest(
    schema,
    readNamespace,
    sessionNamespace,
    queueNamespace,
    controlNamespace,
    notificationNamespace,
    executionNamespace
  );
  const withoutFingerprint: Omit<PostgresOperationalRetentionManifest, "fingerprint"> = {
    contractVersion: POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    executionRecoveryContractVersion: POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
    schemaName: schema,
    readRoleNamespace: readNamespace,
    sessionRoleNamespace: sessionNamespace,
    queueWriteRoleNamespace: queueNamespace,
    controlRoleNamespace: controlNamespace,
    notificationRecoveryRoleNamespace: notificationNamespace,
    executionRecoveryRoleNamespace: executionNamespace,
    operationalRetentionRoleNamespace: retentionNamespace,
    executionRecoveryManifestFingerprint: executionManifest.fingerprint,
    operationalRetentionRole: {
      kind: "operational_telemetry_retention_handler",
      name: operationalRetentionRoleName(retentionNamespace),
      functionName: POSTGRES_OPERATIONAL_RETENTION_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTableNames: [...PROTECTED_TABLES],
      forcedRlsTableNames: [...PROTECTED_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false,
      insertAccess: false,
      deleteAccess: false
    },
    protectedTableCount: 10,
    forcedRlsTableCount: 10,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    boundaryHandlerTaskKinds: [...BOUNDARY_HANDLER_TASK_KINDS],
    boundaryHandlerTaskKindCount: 1,
    qualifiedHandlerTaskKinds: [...QUALIFIED_HANDLER_TASK_KINDS],
    qualifiedHandlerTaskKindCount: 3,
    totalHandlerTaskKindCount: BACKGROUND_TASK_KINDS.length,
    operationalRetentionRepositoryParity: true,
    executionRecoveryRepositoryParity: true,
    notificationRecoveryRepositoryParity: true,
    serverClockBoundRetention: true,
    serverAuthenticatedReceiptActor: true,
    boundedEvidenceDeletionLimit: OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH,
    fullHandlerRepositoryParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresOperationalRetentionCapabilityProjection(): PostgresOperationalRetentionCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresOperationalRetentionManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    executionRecoveryContractVersion: POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
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
    serverClockBoundRetention: true,
    serverAuthenticatedReceiptActor: true,
    boundedEvidenceDeletionLimit: OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH,
    readCommittedTransactionAdapter: true,
    operationalRetentionRepositoryParity: true,
    executionRecoveryRepositoryParity: true,
    notificationRecoveryRepositoryParity: true,
    fullHandlerRepositoryParity: false,
    handlerTaskKindCount: 3,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    protectedTableCount: 10,
    forcedRlsTableCount: 10,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    insertAccess: false,
    deleteAccess: false,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresOperationalRetentionManifest
): Promise<BoundaryInspection> {
  const role = manifest.operationalRetentionRole.name;
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [role]
  );
  const roleRow = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !roleRow
    || roleRow.rolsuper || roleRow.rolinherit || roleRow.rolcreaterole
    || roleRow.rolcreatedb || roleRow.rolcanlogin || roleRow.rolreplication
    || roleRow.rolbypassrls) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role is missing or has an unsafe role attribute."
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
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role must not have an active membership."
    );
  }

  const directTableGrants = await session.query<{ count: string | number | bigint }>(
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
    directTableGrants.rows[0]?.count,
    "direct table-grant count"
  );
  if (directTableGrantCount !== 0) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role must not have a direct table or column grant."
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
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role has an unauthorized effective table privilege."
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
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role has an invalid schema privilege."
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
    || routine.routineName !== manifest.operationalRetentionRole.functionName
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role
    || routine.source !== operationalRetentionFunctionSource(manifest)) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention function boundary is incomplete."
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
     WHERE routine.oid = $1::oid
     ORDER BY grantee`,
    [routine.oid]
  );
  if (routineAcl.rows.length !== 2
    || !routineAcl.rows.some((row) => row.grantee === role
      && row.privilegeType === "EXECUTE" && row.grantable === false)
    || !routineAcl.rows.some((row) => row.grantee === routine.ownerName
      && row.privilegeType === "EXECUTE" && row.grantable === false)
    || routineAcl.rows.some((row) => row.grantee === "PUBLIC")) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention function grant is not exact."
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
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role must not access application-schema sequences."
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
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role must not own application-schema objects."
    );
  }

  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention role must not depend on direct table policies."
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
  const forcedRows = rls.rows.filter((row) => row.enabled && row.forced);
  if (rls.rows.length !== manifest.protectedTableCount
    || rls.rows.map((row) => row.tableName).join(",") !== [...PROTECTED_TABLES].join(",")
    || forcedRows.map((row) => row.tableName).join(",") !== [...PROTECTED_TABLES].join(",")) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention protected-table scope is incomplete."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresOperationalRetentionQualificationError(
      "Operational-retention qualification cannot activate a runtime principal."
    );
  }

  return {
    protectedTableCount: rls.rows.length,
    forcedRlsTableCount: forcedRows.length,
    directTableGrantCount,
    functionGrantCount: routines.rows.length,
    membershipCount,
    activePrincipalCount,
    boundaryCatalogFingerprint: fingerprint({
      role: roleRow,
      routine,
      routineAcl: routineAcl.rows,
      protectedTables: rls.rows
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresOperationalRetentionManifest
): PostgresOperationalRetentionQualificationReceipt {
  if (row.phase !== "verified"
    || row.read_role_namespace !== manifest.readRoleNamespace
    || row.session_role_namespace !== manifest.sessionRoleNamespace
    || row.queue_write_role_namespace !== manifest.queueWriteRoleNamespace
    || row.control_role_namespace !== manifest.controlRoleNamespace
    || row.notification_recovery_role_namespace !== manifest.notificationRecoveryRoleNamespace
    || row.execution_recovery_role_namespace !== manifest.executionRecoveryRoleNamespace
    || row.operational_retention_role_namespace !== manifest.operationalRetentionRoleNamespace
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.execution_recovery_manifest_fingerprint
      !== manifest.executionRecoveryManifestFingerprint
    || row.operational_retention_role_name !== manifest.operationalRetentionRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.server_bound_principal_lookup !== true
    || row.server_clock_bound_retention !== true
    || row.server_authenticated_receipt_actor !== true
    || row.operational_retention_repository_parity !== true
    || row.execution_recovery_repository_parity !== true
    || row.notification_recovery_repository_parity !== true
    || row.full_handler_repository_parity !== false
    || row.direct_table_access !== false || row.insert_access !== false
    || row.delete_access !== false || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention receipt is incomplete or unsafe."
    );
  }
  if (exactInteger(row.contract_version, "contract version")
      !== POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION
    || exactInteger(row.cutover_contract_version, "cutover contract version")
      !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || exactInteger(row.execution_recovery_contract_version, "execution-recovery contract version")
      !== POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION
    || exactInteger(row.protected_table_count, "protected table count") !== 10
    || exactInteger(row.forced_rls_table_count, "forced-RLS table count") !== 10
    || exactInteger(row.direct_table_grant_count, "direct table-grant count") !== 0
    || exactInteger(row.function_grant_count, "function grant count") !== 1
    || exactInteger(row.membership_count, "membership count") !== 0
    || exactInteger(row.active_principal_count, "active principal count") !== 0
    || exactInteger(row.boundary_handler_task_kind_count, "boundary handler task-kind count") !== 1
    || exactInteger(row.qualified_handler_task_kind_count, "qualified handler task-kind count") !== 3
    || exactInteger(row.total_handler_task_kind_count, "total handler task-kind count")
      !== manifest.totalHandlerTaskKindCount
    || exactInteger(row.bounded_evidence_deletion_limit, "bounded evidence-deletion limit")
      !== OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention receipt uses an unsupported or active contract."
    );
  }
  return {
    contractVersion: POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    executionRecoveryContractVersion: POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
    phase: "verified",
    schemaName: manifest.schemaName,
    readRoleNamespace: manifest.readRoleNamespace,
    sessionRoleNamespace: manifest.sessionRoleNamespace,
    queueWriteRoleNamespace: manifest.queueWriteRoleNamespace,
    controlRoleNamespace: manifest.controlRoleNamespace,
    notificationRecoveryRoleNamespace: manifest.notificationRecoveryRoleNamespace,
    executionRecoveryRoleNamespace: manifest.executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace: manifest.operationalRetentionRoleNamespace,
    roleManifestFingerprint: manifest.fingerprint,
    executionRecoveryManifestFingerprint: manifest.executionRecoveryManifestFingerprint,
    operationalRetentionRoleName: manifest.operationalRetentionRole.name,
    protectedTableCount: 10,
    forcedRlsTableCount: 10,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryHandlerTaskKindCount: 1,
    qualifiedHandlerTaskKindCount: 3,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    serverBoundPrincipalLookup: true,
    serverClockBoundRetention: true,
    serverAuthenticatedReceiptActor: true,
    boundedEvidenceDeletionLimit: OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH,
    operationalRetentionRepositoryParity: true,
    executionRecoveryRepositoryParity: true,
    notificationRecoveryRepositoryParity: true,
    fullHandlerRepositoryParity: false,
    directTableAccess: false,
    insertAccess: false,
    deleteAccess: false,
    runtimeAuthority: false,
    productionReady: false,
    appliedAt: timestamp(row.applied_at, "application timestamp"),
    verifiedAt: timestamp(row.verified_at, "verification timestamp")
  };
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresOperationalRetentionManifest
): Promise<PostgresOperationalRetentionQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_RECEIPT_TABLE)}
     WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresOperationalRetentionQualificationReceipt,
  manifest: PostgresOperationalRetentionManifest
): void {
  if (inspection.protectedTableCount !== receipt.protectedTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresOperationalRetentionQualificationError(
      "The PostgreSQL operational-retention boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresOperationalRetentionBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification"
): Promise<PostgresOperationalRetentionQualificationReceipt> {
  const manifest = buildPostgresOperationalRetentionManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace
  );
  await verifyPostgresExecutionRecoveryBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresOperationalRetentionBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  now = Date.now()
): Promise<PostgresOperationalRetentionQualificationReceipt> {
  const manifest = buildPostgresOperationalRetentionManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresOperationalRetentionQualificationError(
      "Operational-retention qualification requires the supported cutover/control role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresOperationalRetentionQualificationError(
      "Operational-retention qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresExecutionRecoveryBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace
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
        manifest.operationalRetentionRole.name,
        manifest.schemaName,
        POSTGRES_OPERATIONAL_RETENTION_RECEIPT_TABLE,
        [POSTGRES_OPERATIONAL_RETENTION_FUNCTION, "yoink_operational_retention_receipt_guard"]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing boundary object count") !== 0) {
      throw new PostgresOperationalRetentionQualificationError(
        "Operational-retention qualification refuses an existing role, function, guard, or receipt."
      );
    }

    await session.query(
      `CREATE ROLE ${identifier(manifest.operationalRetentionRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.operationalRetentionRole.name)}`
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${operationalRetentionFunctionSource(manifest)}$yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_FUNCTION)}(TEXT, TEXT)
       FROM PUBLIC`
    );
    await session.query(
      `GRANT EXECUTE ON FUNCTION
       ${relation(manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_FUNCTION)}(TEXT, TEXT)
       TO ${identifier(manifest.operationalRetentionRole.name)}`
    );

    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_RECEIPT_TABLE)} (
        id TEXT PRIMARY KEY CHECK (id = 'active'),
        contract_version BIGINT NOT NULL CHECK (contract_version = ${POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION}),
        cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = ${POSTGRES_CUTOVER_CONTRACT_VERSION}),
        execution_recovery_contract_version BIGINT NOT NULL CHECK (
          execution_recovery_contract_version = ${POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION}
        ),
        phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
        read_role_namespace TEXT NOT NULL,
        session_role_namespace TEXT NOT NULL,
        queue_write_role_namespace TEXT NOT NULL,
        control_role_namespace TEXT NOT NULL,
        notification_recovery_role_namespace TEXT NOT NULL,
        execution_recovery_role_namespace TEXT NOT NULL,
        operational_retention_role_namespace TEXT NOT NULL,
        role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
        execution_recovery_manifest_fingerprint TEXT NOT NULL CHECK (
          execution_recovery_manifest_fingerprint ~ '^[a-f0-9]{64}$'
        ),
        operational_retention_role_name TEXT NOT NULL,
        protected_table_count BIGINT NOT NULL,
        forced_rls_table_count BIGINT NOT NULL,
        direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
        function_grant_count BIGINT NOT NULL,
        membership_count BIGINT NOT NULL CHECK (membership_count = 0),
        active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
        boundary_handler_task_kind_count BIGINT NOT NULL CHECK (boundary_handler_task_kind_count = 1),
        qualified_handler_task_kind_count BIGINT NOT NULL CHECK (qualified_handler_task_kind_count = 3),
        total_handler_task_kind_count BIGINT NOT NULL,
        boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
        server_bound_principal_lookup BOOLEAN NOT NULL DEFAULT TRUE CHECK (server_bound_principal_lookup = TRUE),
        server_clock_bound_retention BOOLEAN NOT NULL DEFAULT TRUE CHECK (server_clock_bound_retention = TRUE),
        server_authenticated_receipt_actor BOOLEAN NOT NULL DEFAULT TRUE CHECK (
          server_authenticated_receipt_actor = TRUE
        ),
        bounded_evidence_deletion_limit BIGINT NOT NULL CHECK (
          bounded_evidence_deletion_limit = ${OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH}
        ),
        operational_retention_repository_parity BOOLEAN NOT NULL DEFAULT TRUE CHECK (
          operational_retention_repository_parity = TRUE
        ),
        execution_recovery_repository_parity BOOLEAN NOT NULL DEFAULT TRUE CHECK (
          execution_recovery_repository_parity = TRUE
        ),
        notification_recovery_repository_parity BOOLEAN NOT NULL DEFAULT TRUE CHECK (
          notification_recovery_repository_parity = TRUE
        ),
        full_handler_repository_parity BOOLEAN NOT NULL DEFAULT FALSE CHECK (
          full_handler_repository_parity = FALSE
        ),
        direct_table_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (direct_table_access = FALSE),
        insert_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (insert_access = FALSE),
        delete_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (delete_access = FALSE),
        runtime_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (runtime_authority = FALSE),
        production_ready BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_ready = FALSE),
        applied_at TEXT NOT NULL,
        verified_at TEXT NOT NULL DEFAULT ''
      )`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON ${relation(manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_RECEIPT_TABLE)}
       FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_RECEIPT_TABLE)}(
         id, contract_version, cutover_contract_version, execution_recovery_contract_version,
         phase, read_role_namespace, session_role_namespace, queue_write_role_namespace,
         control_role_namespace, notification_recovery_role_namespace,
         execution_recovery_role_namespace, operational_retention_role_namespace,
         role_manifest_fingerprint, execution_recovery_manifest_fingerprint,
         operational_retention_role_name, protected_table_count, forced_rls_table_count,
         direct_table_grant_count, function_grant_count, membership_count,
         active_principal_count, boundary_handler_task_kind_count,
         qualified_handler_task_kind_count, total_handler_task_kind_count,
         boundary_catalog_fingerprint, bounded_evidence_deletion_limit, applied_at
       ) VALUES ('active', $1, $2, $3, 'loading', $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, 0, 0, 0, 0, 0, 0, 1, 3, $14, repeat('0', 64), $15, $16)`,
      [
        POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
        POSTGRES_CUTOVER_CONTRACT_VERSION,
        POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
        manifest.readRoleNamespace,
        manifest.sessionRoleNamespace,
        manifest.queueWriteRoleNamespace,
        manifest.controlRoleNamespace,
        manifest.notificationRecoveryRoleNamespace,
        manifest.executionRecoveryRoleNamespace,
        manifest.operationalRetentionRoleNamespace,
        manifest.fingerprint,
        manifest.executionRecoveryManifestFingerprint,
        manifest.operationalRetentionRole.name,
        manifest.totalHandlerTaskKindCount,
        OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_RECEIPT_TABLE)}
       SET phase = 'verified', protected_table_count = $1, forced_rls_table_count = $2,
           direct_table_grant_count = $3, function_grant_count = $4,
           membership_count = $5, active_principal_count = $6,
           boundary_catalog_fingerprint = $7, verified_at = $8
       WHERE id = 'active' AND phase = 'loading'`,
      [
        inspection.protectedTableCount,
        inspection.forcedRlsTableCount,
        inspection.directTableGrantCount,
        inspection.functionGrantCount,
        inspection.membershipCount,
        inspection.activePrincipalCount,
        inspection.boundaryCatalogFingerprint,
        verifiedAt
      ]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_operational_retention_receipt_guard")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'operational-retention receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_operational_retention_receipt_guard")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_operational_retention_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_operational_retention_receipt_guard")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

class OperationalRetentionSession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresOperationalRetentionDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresOperationalRetentionManifest;

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
    options: NodePostgresOperationalRetentionDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresOperationalRetentionManifest(
      requestedSchema,
      requestedReadRoleNamespace,
      requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace,
      requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace,
      requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresOperationalRetentionQualificationError(
        "The PostgreSQL operational-retention connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_operational_retention_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async prune(
    principal: BackgroundWorkerPrincipal,
    now = Date.now()
  ): Promise<PostgresOperationalRetentionResult> {
    const tenantId = principalId(principal?.tenantId, "expected tenant ID");
    const userId = principalId(principal?.userId, "expected user ID");
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresOperationalRetentionQualificationError(
        "The PostgreSQL operational-retention cycle timestamp differs from the process clock."
      );
    }
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.operationalRetentionRole.name)}`);
      const session = new OperationalRetentionSession(client);
      const result = await session.query<{
        deletedRollupRows: string | number | bigint;
        deletedErrorEvents: string | number | bigint;
        cutoffAt: string;
        receiptId: string;
        deletedTaskRuns: string | number | bigint;
        taskHistoryCutoffAt: string;
        deletedRecoveryEvidence: string | number | bigint;
        deletedRecoveryReviewEvents: string | number | bigint;
        recoveryEvidenceCutoffAt: string;
        recoveryEvidenceRetentionDays: string | number | bigint;
        recoveryEvidenceRetentionReceiptId: string;
      }>(
        `SELECT deleted_rollup_rows AS "deletedRollupRows",
                deleted_error_events AS "deletedErrorEvents",
                cutoff_at AS "cutoffAt",
                telemetry_retention_receipt_id AS "receiptId",
                deleted_task_runs AS "deletedTaskRuns",
                task_history_cutoff_at AS "taskHistoryCutoffAt",
                deleted_recovery_evidence AS "deletedRecoveryEvidence",
                deleted_recovery_review_events AS "deletedRecoveryReviewEvents",
                recovery_evidence_cutoff_at AS "recoveryEvidenceCutoffAt",
                recovery_evidence_retention_days AS "recoveryEvidenceRetentionDays",
                recovery_evidence_retention_receipt_id AS "recoveryEvidenceRetentionReceiptId"
         FROM ${relation(this.manifest.schemaName, POSTGRES_OPERATIONAL_RETENTION_FUNCTION)}(
           $1, $2
         )`,
        [tenantId, userId]
      );
      const row = result.rows[0];
      if (result.rows.length !== 1 || !row) {
        throw new PostgresOperationalRetentionQualificationError(
          "The PostgreSQL operational-retention function returned an ambiguous result."
        );
      }
      const retained = {
        deletedRollupRows: exactInteger(row.deletedRollupRows, "deleted rollup-row count"),
        deletedErrorEvents: exactInteger(row.deletedErrorEvents, "deleted error-event count"),
        cutoffAt: timestamp(row.cutoffAt, "operational cutoff timestamp"),
        receiptId: receiptId(row.receiptId, "telemetry retention-receipt ID"),
        deletedTaskRuns: exactInteger(row.deletedTaskRuns, "deleted task-run count"),
        taskHistoryCutoffAt: timestamp(row.taskHistoryCutoffAt, "task-history cutoff timestamp"),
        deletedRecoveryEvidence: exactInteger(
          row.deletedRecoveryEvidence,
          "deleted recovery-evidence count"
        ),
        deletedRecoveryReviewEvents: exactInteger(
          row.deletedRecoveryReviewEvents,
          "deleted recovery-review count"
        ),
        recoveryEvidenceCutoffAt: timestamp(
          row.recoveryEvidenceCutoffAt,
          "recovery-evidence cutoff timestamp"
        ),
        recoveryEvidenceRetentionDays: exactInteger(
          row.recoveryEvidenceRetentionDays,
          "recovery-evidence retention days"
        ),
        recoveryEvidenceRetentionReceiptId: receiptId(
          row.recoveryEvidenceRetentionReceiptId,
          "recovery-evidence retention-receipt ID"
        )
      };
      if (retained.recoveryEvidenceRetentionDays !== OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS
        || retained.deletedRecoveryEvidence > OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH
        || (retained.deletedRollupRows + retained.deletedErrorEvents > 0) !== Boolean(retained.receiptId)
        || (retained.deletedRecoveryEvidence > 0)
          !== Boolean(retained.recoveryEvidenceRetentionReceiptId)) {
        throw new PostgresOperationalRetentionQualificationError(
          "The PostgreSQL operational-retention function returned an inconsistent receipt."
        );
      }
      await client.query("COMMIT");
      return retained;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyed = true;
        client.release(true);
        throw error;
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
