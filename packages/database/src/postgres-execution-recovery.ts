import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { BACKGROUND_TASK_KINDS } from "../../domain/src/background-task.js";
import { nowIso } from "../../domain/src/ids.js";
import { jobMayHaveMutated } from "../../domain/src/job-state.js";
import {
  EXECUTION_RECOVERY_AFTER_MUTATION_MESSAGE,
  EXECUTION_RECOVERY_AFTER_MUTATION_REASON,
  EXECUTION_RECOVERY_BEFORE_MUTATION_MESSAGE,
  EXECUTION_RECOVERY_BEFORE_MUTATION_REASON,
  EXECUTION_RECOVERY_LEASE_STATES,
  EXECUTION_RECOVERY_SIGNAL_WINDOW_MESSAGE,
  EXECUTION_RECOVERY_SIGNAL_WINDOW_REASON
} from "./execution-repository.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  inspectPostgresCutoverPreflight,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  type PostgresQueryResult,
  type PostgresQuerySession,
  logIdlePostgresClientErrors
} from "./postgres-cutover.js";
import {
  POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
  buildPostgresNotificationRecoveryManifest,
  verifyPostgresNotificationRecoveryBoundary
} from "./postgres-notification-recovery.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";
import { SPEND_RESERVATION_EXPIRY_REASON } from "./spend-ledger-repository.js";

export const POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION = 1;
export const POSTGRES_EXECUTION_RECOVERY_RECEIPT_TABLE = "yoink_execution_recovery_receipt";
export const POSTGRES_EXECUTION_RECOVERY_FUNCTION = "yoink_recover_action_execution";

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BOUNDARY_HANDLER_TASK_KINDS = Object.freeze(["execution_recovery"] as const);
const QUALIFIED_HANDLER_TASK_KINDS = Object.freeze([
  "notification_recovery",
  "execution_recovery"
] as const);
const PROTECTED_TABLES = Object.freeze([
  "action_events",
  "action_jobs",
  "audit_events",
  "outbox_events",
  "signal_events",
  "signal_incidents",
  "signal_occurrences",
  "spend_ledger_entries",
  "spend_reservations"
] as const);
const FORCED_RLS_TABLES = PROTECTED_TABLES;
const INDIRECT_SCOPE_TABLES = Object.freeze([] as const);
const FUNCTION_ARGUMENT_TYPES = Object.freeze(["text", "text"] as const);
const FUNCTION_RESULT_TYPE =
  "TABLE(recovered_action_leases bigint, expired_action_jobs bigint, released_spend_reservations bigint)";
const MAXIMUM_CLOCK_SKEW_MS = 300_000;

export interface PostgresExecutionRecoveryManifest {
  contractVersion: typeof POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  notificationRecoveryContractVersion: typeof POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION;
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  notificationRecoveryRoleNamespace: string;
  executionRecoveryRoleNamespace: string;
  notificationRecoveryManifestFingerprint: string;
  executionRecoveryRole: {
    kind: "execution_recovery_handler";
    name: string;
    functionName: typeof POSTGRES_EXECUTION_RECOVERY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTableNames: string[];
    forcedRlsTableNames: string[];
    indirectScopeTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
    insertAccess: false;
    deleteAccess: false;
  };
  protectedTableCount: 9;
  forcedRlsTableCount: 9;
  indirectScopeTableCount: 0;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  boundaryHandlerTaskKinds: ["execution_recovery"];
  boundaryHandlerTaskKindCount: 1;
  qualifiedHandlerTaskKinds: ["notification_recovery", "execution_recovery"];
  qualifiedHandlerTaskKindCount: 2;
  totalHandlerTaskKindCount: number;
  executionRecoveryRepositoryParity: true;
  notificationRecoveryRepositoryParity: true;
  serverClockBoundRecovery: true;
  sharedIncidentMutationFailClosed: true;
  fullHandlerRepositoryParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresExecutionRecoveryQualificationReceipt {
  contractVersion: typeof POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  notificationRecoveryContractVersion: typeof POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION;
  phase: "verified";
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  notificationRecoveryRoleNamespace: string;
  executionRecoveryRoleNamespace: string;
  roleManifestFingerprint: string;
  notificationRecoveryManifestFingerprint: string;
  executionRecoveryRoleName: string;
  protectedTableCount: 9;
  forcedRlsTableCount: 9;
  indirectScopeTableCount: 0;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryHandlerTaskKindCount: 1;
  qualifiedHandlerTaskKindCount: 2;
  totalHandlerTaskKindCount: number;
  boundaryCatalogFingerprint: string;
  serverBoundPrincipalLookup: true;
  serverClockBoundRecovery: true;
  sharedIncidentMutationFailClosed: true;
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

export interface PostgresExecutionRecoveryCapabilityProjection {
  contractVersion: typeof POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  notificationRecoveryContractVersion: typeof POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION;
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
  serverClockBoundRecovery: true;
  sharedIncidentMutationFailClosed: true;
  readCommittedTransactionAdapter: true;
  notificationRecoveryRepositoryParity: true;
  executionRecoveryRepositoryParity: true;
  fullHandlerRepositoryParity: false;
  handlerTaskKindCount: 2;
  totalHandlerTaskKindCount: number;
  protectedTableCount: 9;
  forcedRlsTableCount: 9;
  indirectScopeTableCount: 0;
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

export interface PostgresExecutionRecoveryResult {
  recoveredActionLeases: number;
  expiredActionJobs: number;
  releasedSpendReservations: number;
}

export interface NodePostgresExecutionRecoveryDatabaseOptions {
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
  notification_recovery_contract_version: string | number | bigint;
  phase: string;
  read_role_namespace: string;
  session_role_namespace: string;
  queue_write_role_namespace: string;
  control_role_namespace: string;
  notification_recovery_role_namespace: string;
  execution_recovery_role_namespace: string;
  role_manifest_fingerprint: string;
  notification_recovery_manifest_fingerprint: string;
  execution_recovery_role_name: string;
  protected_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  indirect_scope_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  boundary_handler_task_kind_count: string | number | bigint;
  qualified_handler_task_kind_count: string | number | bigint;
  total_handler_task_kind_count: string | number | bigint;
  boundary_catalog_fingerprint: string;
  server_bound_principal_lookup: boolean;
  server_clock_bound_recovery: boolean;
  shared_incident_mutation_fail_closed: boolean;
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
  indirectScopeTableCount: number;
  directTableGrantCount: number;
  functionGrantCount: number;
  membershipCount: number;
  activePrincipalCount: number;
  boundaryCatalogFingerprint: string;
}

let cachedCapabilityProjection: Readonly<PostgresExecutionRecoveryCapabilityProjection> | null = null;

export class PostgresExecutionRecoveryQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresExecutionRecoveryQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery schema is invalid."
    );
  }
  return normalized;
}

function roleNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role namespace must contain 3 through 32 lowercase letters, numbers, or underscores."
    );
  }
  return normalized;
}

function executionRoleName(namespace: string): string {
  const value = `${namespace}_execution_recovery`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role name exceeds 63 bytes."
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
    throw new PostgresExecutionRecoveryQualificationError(
      `The PostgreSQL execution-recovery ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresExecutionRecoveryQualificationError(
      `The PostgreSQL execution-recovery ${label} is out of range.`
    );
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresExecutionRecoveryQualificationError(
      `The PostgreSQL execution-recovery ${label} is invalid.`
    );
  }
  return normalized;
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresExecutionRecoveryQualificationError(
      `The PostgreSQL execution-recovery ${label} is invalid.`
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

function auditSource(
  manifest: PostgresExecutionRecoveryManifest,
  values: {
    aggregateType: string;
    correlation: string;
    eventType: string;
    reason: string;
    message: string;
    data: string;
  }
): string {
  return `
    audit_id := ${generatedId("audit")};
    outbox_id := ${generatedId("outbox")};
    audit_data := ${values.data};
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type,
      reason_code, message, data_json, created_at
    ) VALUES (
      audit_id, resolved_tenant_id, resolved_user_id, ${values.correlation},
      ${values.eventType}, ${values.reason}, ${values.message}, audit_data,
      recovery_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at
    ) VALUES (
      outbox_id, resolved_tenant_id, ${values.aggregateType}, ${values.correlation},
      ${values.eventType},
      pg_catalog.json_build_object(
        'auditId', audit_id,
        'correlationId', ${values.correlation},
        'reasonCode', ${values.reason},
        'message', ${values.message},
        'data', audit_data::json
      )::text,
      recovery_timestamp, ''
    );`;
}

function releaseReservationBody(
  manifest: PostgresExecutionRecoveryManifest,
  reason: string
): string {
  const releaseMessage = sqlLiteral("The action reservation was released without recording a purchase.");
  return `
    release_reason_value := ${reason};
    UPDATE ${relation(manifest.schemaName, "spend_reservations")}
    SET status = 'released', release_reason = release_reason_value,
        updated_at = recovery_timestamp
    WHERE id = reservation_record.id AND tenant_id = resolved_tenant_id
      AND user_id = resolved_user_id AND status = 'active';
    spend_ledger_id := ${generatedId("spend_ledger")};
    INSERT INTO ${relation(manifest.schemaName, "spend_ledger_entries")}(
      id, tenant_id, user_id, reservation_id, action_job_id, entry_type,
      reserved_delta_cents, spent_delta_cents, quantity_delta, currency,
      reason_code, correlation_id, metadata_json, created_at
    ) VALUES (
      spend_ledger_id, resolved_tenant_id, resolved_user_id,
      reservation_record.id, reservation_record.action_job_id, 'released',
      -reservation_record.reserved_amount_cents, 0, -reservation_record.quantity,
      reservation_record.currency, release_reason_value,
      reservation_record.action_job_id, '{}', recovery_timestamp
    );
    ${auditSource(manifest, {
      aggregateType: sqlLiteral("spend_reservation"),
      correlation: "reservation_record.action_job_id",
      eventType: sqlLiteral("spend_reservation_released"),
      reason: "release_reason_value",
      message: releaseMessage,
      data: `pg_catalog.json_build_object(
        'reservationId', reservation_record.id,
        'amountCents', reservation_record.reserved_amount_cents,
        'quantity', reservation_record.quantity
      )::text`
    })}`;
}

function releaseReservationForJobSource(
  manifest: PostgresExecutionRecoveryManifest,
  reason: string
): string {
  return `
    SELECT reservation.id, reservation.action_job_id,
           reservation.reserved_amount_cents, reservation.quantity,
           reservation.currency
      INTO reservation_record
    FROM ${relation(manifest.schemaName, "spend_reservations")} AS reservation
    WHERE reservation.tenant_id = resolved_tenant_id
      AND reservation.user_id = resolved_user_id
      AND reservation.action_job_id = job_record.id
      AND reservation.status = 'active'
    FOR UPDATE;
    IF FOUND THEN
      ${releaseReservationBody(manifest, reason)}
    END IF;`;
}

function incidentUpdateSource(
  manifest: PostgresExecutionRecoveryManifest,
  status: "closed" | "locked"
): string {
  return `
    UPDATE ${relation(manifest.schemaName, "signal_incidents")} AS incident
    SET status = ${sqlLiteral(status)}, closed_reason = next_state,
        updated_at = recovery_timestamp
    WHERE incident.id = job_record.incident_id
      AND incident.tenant_id = resolved_tenant_id
      AND incident.user_id = resolved_user_id
      AND NOT EXISTS (
        SELECT 1 FROM ${relation(manifest.schemaName, "action_jobs")} AS other_job
        WHERE other_job.incident_id = incident.id
          AND (other_job.tenant_id <> resolved_tenant_id
            OR other_job.user_id <> resolved_user_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
        JOIN ${relation(manifest.schemaName, "signal_events")} AS event
          ON event.id = occurrence.event_id
        WHERE occurrence.incident_id = incident.id
          AND (event.tenant_id <> resolved_tenant_id
            OR event.user_id <> resolved_user_id)
      );`;
}

function transitionJobSource(
  manifest: PostgresExecutionRecoveryManifest,
  mode: "lease" | "pending"
): string {
  const previousStateData =
    "pg_catalog.json_build_object('previousState', job_record.previous_state)::text";
  const leaseSetup = `
    next_state := CASE
      WHEN job_record.previous_state = 'submitting' THEN 'submission_uncertain'
      WHEN job_record.previous_state = ANY(ARRAY[${EXECUTION_RECOVERY_LEASE_STATES
        .filter((state) => jobMayHaveMutated(state) && state !== "submitting")
        .map(sqlLiteral).join(", ")}]::text[]) THEN 'manual_review'
      WHEN job_record.previous_state = 'add_authorized' THEN 'cancelled'
      ELSE 'expired'
    END;
    transition_reason := CASE WHEN job_record.previous_state = ANY(ARRAY[${EXECUTION_RECOVERY_LEASE_STATES
      .filter((state) => jobMayHaveMutated(state))
      .map(sqlLiteral).join(", ")}]::text[])
      THEN ${sqlLiteral(EXECUTION_RECOVERY_AFTER_MUTATION_REASON)}
      ELSE ${sqlLiteral(EXECUTION_RECOVERY_BEFORE_MUTATION_REASON)} END;
    transition_message := CASE WHEN job_record.previous_state = ANY(ARRAY[${EXECUTION_RECOVERY_LEASE_STATES
      .filter((state) => jobMayHaveMutated(state))
      .map(sqlLiteral).join(", ")}]::text[])
      THEN ${sqlLiteral(EXECUTION_RECOVERY_AFTER_MUTATION_MESSAGE)}
      ELSE ${sqlLiteral(EXECUTION_RECOVERY_BEFORE_MUTATION_MESSAGE)} END;`;
  const pendingSetup = `
    next_state := 'expired';
    transition_reason := ${sqlLiteral(EXECUTION_RECOVERY_SIGNAL_WINDOW_REASON)};
    transition_message := ${sqlLiteral(EXECUTION_RECOVERY_SIGNAL_WINDOW_MESSAGE)};`;
  const capabilityRetirement = mode === "lease" ? `
    UPDATE ${relation(manifest.schemaName, "action_jobs")}
    SET capability_nonce_hash = pg_catalog.md5(pg_catalog.gen_random_uuid()::text)
          || pg_catalog.md5(pg_catalog.gen_random_uuid()::text),
        lease_expires_at = recovery_timestamp, updated_at = recovery_timestamp
    WHERE id = job_record.id AND tenant_id = resolved_tenant_id
      AND user_id = resolved_user_id;
    recovered_count := recovered_count + 1;` : `
    expired_count := expired_count + 1;`;
  return `
    ${mode === "lease" ? leaseSetup : pendingSetup}
    UPDATE ${relation(manifest.schemaName, "action_jobs")}
    SET state = next_state, updated_at = recovery_timestamp
    WHERE id = job_record.id AND tenant_id = resolved_tenant_id
      AND user_id = resolved_user_id;
    action_event_id := ${generatedId("action_event")};
    INSERT INTO ${relation(manifest.schemaName, "action_events")}(
      id, job_id, state, reason_code, message, evidence_json, created_at
    ) VALUES (
      action_event_id, job_record.id, next_state, transition_reason,
      transition_message, ${previousStateData}, recovery_timestamp
    );
    IF next_state IN ('expired', 'cancelled') THEN
      ${incidentUpdateSource(manifest, "closed")}
      ${releaseReservationForJobSource(manifest, "next_state")}
    ELSIF next_state IN ('manual_review', 'submission_uncertain') THEN
      ${incidentUpdateSource(manifest, "locked")}
    END IF;
    ${auditSource(manifest, {
      aggregateType: sqlLiteral("action_job"),
      correlation: "job_record.id",
      eventType: sqlLiteral("action_job_transition"),
      reason: "next_state",
      message: "transition_message",
      data: previousStateData
    })}
    ${capabilityRetirement}`;
}

function executionFunctionSource(manifest: PostgresExecutionRecoveryManifest): string {
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  recovery_timestamp TEXT;
  recovered_count BIGINT := 0;
  expired_count BIGINT := 0;
  released_count BIGINT := 0;
  job_record RECORD;
  reservation_record RECORD;
  next_state TEXT;
  transition_reason TEXT;
  transition_message TEXT;
  release_reason_value TEXT;
  action_event_id TEXT;
  spend_ledger_id TEXT;
  audit_id TEXT;
  outbox_id TEXT;
  audit_data TEXT;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected execution-recovery principal is invalid';
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
      'yoink_execution_recovery_v1:' || resolved_tenant_id || ':' || resolved_user_id,
      0
    )
  );

  FOR job_record IN
    SELECT job.id, job.state AS previous_state, job.incident_id
    FROM ${relation(manifest.schemaName, "action_jobs")} AS job
    WHERE job.tenant_id = resolved_tenant_id AND job.user_id = resolved_user_id
      AND job.lease_expires_at <> '' AND job.lease_expires_at < recovery_timestamp
      AND job.state = ANY(ARRAY[${EXECUTION_RECOVERY_LEASE_STATES.map(sqlLiteral).join(", ")}]::text[])
    ORDER BY job.lease_expires_at, job.id
    FOR UPDATE SKIP LOCKED
  LOOP
    ${transitionJobSource(manifest, "lease")}
  END LOOP;

  FOR job_record IN
    SELECT job.id, job.state AS previous_state, job.incident_id
    FROM ${relation(manifest.schemaName, "action_jobs")} AS job
    WHERE job.tenant_id = resolved_tenant_id AND job.user_id = resolved_user_id
      AND job.expires_at < recovery_timestamp
      AND job.state IN ('shadow_ready', 'awaiting_executor')
    ORDER BY job.expires_at, job.id
    FOR UPDATE SKIP LOCKED
  LOOP
    ${transitionJobSource(manifest, "pending")}
  END LOOP;

  FOR reservation_record IN
    SELECT reservation.id, reservation.action_job_id,
           reservation.reserved_amount_cents, reservation.quantity,
           reservation.currency
    FROM ${relation(manifest.schemaName, "spend_reservations")} AS reservation
    WHERE reservation.tenant_id = resolved_tenant_id
      AND reservation.user_id = resolved_user_id
      AND reservation.status = 'active'
      AND reservation.expires_at <= recovery_timestamp
    ORDER BY reservation.expires_at, reservation.id
    FOR UPDATE SKIP LOCKED
  LOOP
    ${releaseReservationBody(manifest, sqlLiteral(SPEND_RESERVATION_EXPIRY_REASON))}
    released_count := released_count + 1;
  END LOOP;

  RETURN QUERY SELECT recovered_count, expired_count, released_count;
END
`;
}

export function buildPostgresExecutionRecoveryManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification"
): PostgresExecutionRecoveryManifest {
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
  if (new Set([
    readNamespace,
    sessionNamespace,
    queueNamespace,
    controlNamespace,
    notificationNamespace,
    executionNamespace
  ]).size !== 6) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL read, session, queue-write, worker-control, notification-recovery, and execution-recovery namespaces must be distinct."
    );
  }
  const notificationManifest = buildPostgresNotificationRecoveryManifest(
    schema,
    readNamespace,
    sessionNamespace,
    queueNamespace,
    controlNamespace,
    notificationNamespace
  );
  const withoutFingerprint: Omit<PostgresExecutionRecoveryManifest, "fingerprint"> = {
    contractVersion: POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    notificationRecoveryContractVersion: POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
    schemaName: schema,
    readRoleNamespace: readNamespace,
    sessionRoleNamespace: sessionNamespace,
    queueWriteRoleNamespace: queueNamespace,
    controlRoleNamespace: controlNamespace,
    notificationRecoveryRoleNamespace: notificationNamespace,
    executionRecoveryRoleNamespace: executionNamespace,
    notificationRecoveryManifestFingerprint: notificationManifest.fingerprint,
    executionRecoveryRole: {
      kind: "execution_recovery_handler",
      name: executionRoleName(executionNamespace),
      functionName: POSTGRES_EXECUTION_RECOVERY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTableNames: [...PROTECTED_TABLES],
      forcedRlsTableNames: [...FORCED_RLS_TABLES],
      indirectScopeTableNames: [...INDIRECT_SCOPE_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false,
      insertAccess: false,
      deleteAccess: false
    },
    protectedTableCount: 9,
    forcedRlsTableCount: 9,
    indirectScopeTableCount: 0,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    boundaryHandlerTaskKinds: ["execution_recovery"],
    boundaryHandlerTaskKindCount: 1,
    qualifiedHandlerTaskKinds: ["notification_recovery", "execution_recovery"],
    qualifiedHandlerTaskKindCount: 2,
    totalHandlerTaskKindCount: BACKGROUND_TASK_KINDS.length,
    executionRecoveryRepositoryParity: true,
    notificationRecoveryRepositoryParity: true,
    serverClockBoundRecovery: true,
    sharedIncidentMutationFailClosed: true,
    fullHandlerRepositoryParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresExecutionRecoveryCapabilityProjection(): PostgresExecutionRecoveryCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresExecutionRecoveryManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    notificationRecoveryContractVersion: POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
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
    serverClockBoundRecovery: true,
    sharedIncidentMutationFailClosed: true,
    readCommittedTransactionAdapter: true,
    notificationRecoveryRepositoryParity: true,
    executionRecoveryRepositoryParity: true,
    fullHandlerRepositoryParity: false,
    handlerTaskKindCount: 2,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    protectedTableCount: 9,
    forcedRlsTableCount: 9,
    indirectScopeTableCount: 0,
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
  manifest: PostgresExecutionRecoveryManifest
): Promise<BoundaryInspection> {
  const role = manifest.executionRecoveryRole.name;
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
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role is missing or has an unsafe role attribute."
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
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role must not have an active membership."
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
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role must not have a direct table or column grant."
    );
  }

  const effectiveTables = await session.query<{
    tableName: string;
    maySelect: boolean;
    mayInsert: boolean;
    mayUpdate: boolean;
    mayDelete: boolean;
    mayEscalate: boolean;
  }>(
    `SELECT relation.relname AS "tableName",
            has_table_privilege($2, relation.oid, 'SELECT') AS "maySelect",
            has_table_privilege($2, relation.oid, 'INSERT') AS "mayInsert",
            has_table_privilege($2, relation.oid, 'UPDATE') AS "mayUpdate",
            has_table_privilege($2, relation.oid, 'DELETE') AS "mayDelete",
            (has_table_privilege($2, relation.oid, 'TRUNCATE')
              OR has_table_privilege($2, relation.oid, 'REFERENCES')
              OR has_table_privilege($2, relation.oid, 'TRIGGER')) AS "mayEscalate"
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY relation.relname`,
    [manifest.schemaName, role]
  );
  if (effectiveTables.rows.some((row) => row.maySelect || row.mayInsert
    || row.mayUpdate || row.mayDelete || row.mayEscalate)) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role has an unauthorized effective table privilege."
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
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role has an invalid schema privilege."
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
    || routine.routineName !== manifest.executionRecoveryRole.functionName
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role
    || routine.source !== executionFunctionSource(manifest)) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery function boundary is incomplete."
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
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery function grant is not exact."
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
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role must not access application-schema sequences."
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
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role must not own application-schema objects."
    );
  }

  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery role must not depend on direct table policies."
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
  const indirectRows = rls.rows.filter((row) => !row.enabled && !row.forced);
  if (rls.rows.length !== manifest.protectedTableCount
    || rls.rows.map((row) => row.tableName).join(",") !== [...PROTECTED_TABLES].join(",")
    || forcedRows.map((row) => row.tableName).join(",") !== [...FORCED_RLS_TABLES].join(",")
    || indirectRows.map((row) => row.tableName).join(",") !== [...INDIRECT_SCOPE_TABLES].join(",")) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery protected-table scope is incomplete."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresExecutionRecoveryQualificationError(
      "Execution-recovery qualification cannot activate a runtime principal."
    );
  }

  return {
    protectedTableCount: rls.rows.length,
    forcedRlsTableCount: forcedRows.length,
    indirectScopeTableCount: indirectRows.length,
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
  manifest: PostgresExecutionRecoveryManifest
): PostgresExecutionRecoveryQualificationReceipt {
  if (row.phase !== "verified"
    || row.read_role_namespace !== manifest.readRoleNamespace
    || row.session_role_namespace !== manifest.sessionRoleNamespace
    || row.queue_write_role_namespace !== manifest.queueWriteRoleNamespace
    || row.control_role_namespace !== manifest.controlRoleNamespace
    || row.notification_recovery_role_namespace !== manifest.notificationRecoveryRoleNamespace
    || row.execution_recovery_role_namespace !== manifest.executionRecoveryRoleNamespace
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.notification_recovery_manifest_fingerprint
      !== manifest.notificationRecoveryManifestFingerprint
    || row.execution_recovery_role_name !== manifest.executionRecoveryRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.server_bound_principal_lookup !== true
    || row.server_clock_bound_recovery !== true
    || row.shared_incident_mutation_fail_closed !== true
    || row.execution_recovery_repository_parity !== true
    || row.notification_recovery_repository_parity !== true
    || row.full_handler_repository_parity !== false
    || row.direct_table_access !== false || row.insert_access !== false
    || row.delete_access !== false || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery receipt is incomplete or unsafe."
    );
  }
  if (exactInteger(row.contract_version, "contract version")
      !== POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION
    || exactInteger(row.cutover_contract_version, "cutover contract version")
      !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || exactInteger(row.notification_recovery_contract_version, "notification-recovery contract version")
      !== POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION
    || exactInteger(row.protected_table_count, "protected table count")
      !== manifest.protectedTableCount
    || exactInteger(row.forced_rls_table_count, "forced-RLS table count")
      !== manifest.forcedRlsTableCount
    || exactInteger(row.indirect_scope_table_count, "indirect-scope table count")
      !== manifest.indirectScopeTableCount
    || exactInteger(row.direct_table_grant_count, "direct table-grant count") !== 0
    || exactInteger(row.function_grant_count, "function grant count") !== 1
    || exactInteger(row.membership_count, "membership count") !== 0
    || exactInteger(row.active_principal_count, "active principal count") !== 0
    || exactInteger(row.boundary_handler_task_kind_count, "boundary handler task-kind count") !== 1
    || exactInteger(row.qualified_handler_task_kind_count, "qualified handler task-kind count") !== 2
    || exactInteger(row.total_handler_task_kind_count, "total handler task-kind count")
      !== manifest.totalHandlerTaskKindCount) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery receipt uses an unsupported or active contract."
    );
  }
  return {
    contractVersion: POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    notificationRecoveryContractVersion: POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
    phase: "verified",
    schemaName: manifest.schemaName,
    readRoleNamespace: manifest.readRoleNamespace,
    sessionRoleNamespace: manifest.sessionRoleNamespace,
    queueWriteRoleNamespace: manifest.queueWriteRoleNamespace,
    controlRoleNamespace: manifest.controlRoleNamespace,
    notificationRecoveryRoleNamespace: manifest.notificationRecoveryRoleNamespace,
    executionRecoveryRoleNamespace: manifest.executionRecoveryRoleNamespace,
    roleManifestFingerprint: manifest.fingerprint,
    notificationRecoveryManifestFingerprint: manifest.notificationRecoveryManifestFingerprint,
    executionRecoveryRoleName: manifest.executionRecoveryRole.name,
    protectedTableCount: 9,
    forcedRlsTableCount: 9,
    indirectScopeTableCount: 0,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryHandlerTaskKindCount: 1,
    qualifiedHandlerTaskKindCount: 2,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    serverBoundPrincipalLookup: true,
    serverClockBoundRecovery: true,
    sharedIncidentMutationFailClosed: true,
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
  manifest: PostgresExecutionRecoveryManifest
): Promise<PostgresExecutionRecoveryQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_RECEIPT_TABLE)}
     WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresExecutionRecoveryQualificationReceipt,
  manifest: PostgresExecutionRecoveryManifest
): void {
  if (inspection.protectedTableCount !== receipt.protectedTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.indirectScopeTableCount !== receipt.indirectScopeTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresExecutionRecoveryQualificationError(
      "The PostgreSQL execution-recovery boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresExecutionRecoveryBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification"
): Promise<PostgresExecutionRecoveryQualificationReceipt> {
  const manifest = buildPostgresExecutionRecoveryManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace
  );
  await verifyPostgresNotificationRecoveryBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresExecutionRecoveryBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  now = Date.now()
): Promise<PostgresExecutionRecoveryQualificationReceipt> {
  const manifest = buildPostgresExecutionRecoveryManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresExecutionRecoveryQualificationError(
      "Execution-recovery qualification requires the supported cutover/control role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresExecutionRecoveryQualificationError(
      "Execution-recovery qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresNotificationRecoveryBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace
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
        manifest.executionRecoveryRole.name,
        manifest.schemaName,
        POSTGRES_EXECUTION_RECOVERY_RECEIPT_TABLE,
        [POSTGRES_EXECUTION_RECOVERY_FUNCTION, "yoink_execution_recovery_receipt_guard"]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing boundary object count") !== 0) {
      throw new PostgresExecutionRecoveryQualificationError(
        "Execution-recovery qualification refuses an existing role, function, guard, or receipt."
      );
    }

    await session.query(
      `CREATE ROLE ${identifier(manifest.executionRecoveryRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.executionRecoveryRole.name)}`
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${executionFunctionSource(manifest)}$yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_FUNCTION)}(TEXT, TEXT)
       FROM PUBLIC`
    );
    await session.query(
      `GRANT EXECUTE ON FUNCTION
       ${relation(manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_FUNCTION)}(TEXT, TEXT)
       TO ${identifier(manifest.executionRecoveryRole.name)}`
    );

    await session.query(`CREATE TABLE ${relation(manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_RECEIPT_TABLE)} (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      contract_version BIGINT NOT NULL CHECK (contract_version = ${POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION}),
      cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = ${POSTGRES_CUTOVER_CONTRACT_VERSION}),
      notification_recovery_contract_version BIGINT NOT NULL CHECK (
        notification_recovery_contract_version = ${POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION}
      ),
      phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
      read_role_namespace TEXT NOT NULL,
      session_role_namespace TEXT NOT NULL,
      queue_write_role_namespace TEXT NOT NULL,
      control_role_namespace TEXT NOT NULL,
      notification_recovery_role_namespace TEXT NOT NULL,
      execution_recovery_role_namespace TEXT NOT NULL,
      role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
      notification_recovery_manifest_fingerprint TEXT NOT NULL CHECK (
        notification_recovery_manifest_fingerprint ~ '^[a-f0-9]{64}$'
      ),
      execution_recovery_role_name TEXT NOT NULL,
      protected_table_count BIGINT NOT NULL,
      forced_rls_table_count BIGINT NOT NULL,
      indirect_scope_table_count BIGINT NOT NULL,
      direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
      function_grant_count BIGINT NOT NULL,
      membership_count BIGINT NOT NULL CHECK (membership_count = 0),
      active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
      boundary_handler_task_kind_count BIGINT NOT NULL CHECK (boundary_handler_task_kind_count = 1),
      qualified_handler_task_kind_count BIGINT NOT NULL CHECK (qualified_handler_task_kind_count = 2),
      total_handler_task_kind_count BIGINT NOT NULL,
      boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
      server_bound_principal_lookup BOOLEAN NOT NULL DEFAULT TRUE CHECK (server_bound_principal_lookup = TRUE),
      server_clock_bound_recovery BOOLEAN NOT NULL DEFAULT TRUE CHECK (server_clock_bound_recovery = TRUE),
      shared_incident_mutation_fail_closed BOOLEAN NOT NULL DEFAULT TRUE CHECK (
        shared_incident_mutation_fail_closed = TRUE
      ),
      execution_recovery_repository_parity BOOLEAN NOT NULL DEFAULT TRUE CHECK (
        execution_recovery_repository_parity = TRUE
      ),
      notification_recovery_repository_parity BOOLEAN NOT NULL DEFAULT TRUE CHECK (
        notification_recovery_repository_parity = TRUE
      ),
      full_handler_repository_parity BOOLEAN NOT NULL DEFAULT FALSE CHECK (full_handler_repository_parity = FALSE),
      direct_table_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (direct_table_access = FALSE),
      insert_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (insert_access = FALSE),
      delete_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (delete_access = FALSE),
      runtime_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (runtime_authority = FALSE),
      production_ready BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_ready = FALSE),
      applied_at TEXT NOT NULL,
      verified_at TEXT NOT NULL DEFAULT ''
    )`);
    await session.query(
      `REVOKE ALL PRIVILEGES ON ${relation(manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_RECEIPT_TABLE)}
       FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_RECEIPT_TABLE)}(
         id, contract_version, cutover_contract_version, notification_recovery_contract_version,
         phase, read_role_namespace, session_role_namespace, queue_write_role_namespace,
         control_role_namespace, notification_recovery_role_namespace,
         execution_recovery_role_namespace, role_manifest_fingerprint,
         notification_recovery_manifest_fingerprint, execution_recovery_role_name,
         protected_table_count, forced_rls_table_count, indirect_scope_table_count,
         direct_table_grant_count, function_grant_count, membership_count,
         active_principal_count, boundary_handler_task_kind_count,
         qualified_handler_task_kind_count, total_handler_task_kind_count,
         boundary_catalog_fingerprint, applied_at
       ) VALUES ('active', $1, $2, $3, 'loading', $4, $5, $6, $7, $8, $9, $10, $11,
                 $12, 0, 0, 0, 0, 0, 0, 0, 1, 2, $13, repeat('0', 64), $14)`,
      [
        POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
        POSTGRES_CUTOVER_CONTRACT_VERSION,
        POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
        manifest.readRoleNamespace,
        manifest.sessionRoleNamespace,
        manifest.queueWriteRoleNamespace,
        manifest.controlRoleNamespace,
        manifest.notificationRecoveryRoleNamespace,
        manifest.executionRecoveryRoleNamespace,
        manifest.fingerprint,
        manifest.notificationRecoveryManifestFingerprint,
        manifest.executionRecoveryRole.name,
        manifest.totalHandlerTaskKindCount,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_RECEIPT_TABLE)}
       SET phase = 'verified', protected_table_count = $1, forced_rls_table_count = $2,
           indirect_scope_table_count = $3, direct_table_grant_count = $4,
           function_grant_count = $5, membership_count = $6, active_principal_count = $7,
           boundary_catalog_fingerprint = $8, verified_at = $9
       WHERE id = 'active' AND phase = 'loading'`,
      [
        inspection.protectedTableCount,
        inspection.forcedRlsTableCount,
        inspection.indirectScopeTableCount,
        inspection.directTableGrantCount,
        inspection.functionGrantCount,
        inspection.membershipCount,
        inspection.activePrincipalCount,
        inspection.boundaryCatalogFingerprint,
        verifiedAt
      ]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_execution_recovery_receipt_guard")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'execution-recovery receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_execution_recovery_receipt_guard")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_execution_recovery_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_execution_recovery_receipt_guard")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

class ExecutionRecoverySession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresExecutionRecoveryDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresExecutionRecoveryManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
    requestedReadRoleNamespace = "yoink_qualification",
    requestedSessionRoleNamespace = "yoink_session_qualification",
    requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
    requestedControlRoleNamespace = "yoink_control_qualification",
    requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
    requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
    options: NodePostgresExecutionRecoveryDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresExecutionRecoveryManifest(
      requestedSchema,
      requestedReadRoleNamespace,
      requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace,
      requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace,
      requestedExecutionRecoveryRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresExecutionRecoveryQualificationError(
        "The PostgreSQL execution-recovery connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_execution_recovery_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_execution_recovery_qualification");
  }

  async recover(
    principal: BackgroundWorkerPrincipal,
    now = Date.now()
  ): Promise<PostgresExecutionRecoveryResult> {
    const tenantId = principalId(principal?.tenantId, "expected tenant ID");
    const userId = principalId(principal?.userId, "expected user ID");
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresExecutionRecoveryQualificationError(
        "The PostgreSQL execution-recovery cycle timestamp differs from the process clock."
      );
    }
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.executionRecoveryRole.name)}`);
      const session = new ExecutionRecoverySession(client);
      const result = await session.query<{
        recoveredActionLeases: string | number | bigint;
        expiredActionJobs: string | number | bigint;
        releasedSpendReservations: string | number | bigint;
      }>(
        `SELECT recovered_action_leases AS "recoveredActionLeases",
                expired_action_jobs AS "expiredActionJobs",
                released_spend_reservations AS "releasedSpendReservations"
         FROM ${relation(this.manifest.schemaName, POSTGRES_EXECUTION_RECOVERY_FUNCTION)}(
           $1, $2
         )`,
        [tenantId, userId]
      );
      const row = result.rows[0];
      if (result.rows.length !== 1 || !row) {
        throw new PostgresExecutionRecoveryQualificationError(
          "The PostgreSQL execution-recovery function returned an ambiguous result."
        );
      }
      const recovered = {
        recoveredActionLeases: exactInteger(row.recoveredActionLeases, "recovered action-lease count"),
        expiredActionJobs: exactInteger(row.expiredActionJobs, "expired action-job count"),
        releasedSpendReservations: exactInteger(
          row.releasedSpendReservations,
          "released spend-reservation count"
        )
      };
      await client.query("COMMIT");
      return recovered;
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
