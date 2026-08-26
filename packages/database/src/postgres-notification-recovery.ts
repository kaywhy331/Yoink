import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { BACKGROUND_TASK_KINDS } from "../../domain/src/background-task.js";
import { nowIso } from "../../domain/src/ids.js";
import { NOTIFICATION_DELIVERY_MAX_ATTEMPTS } from "./notification-repository.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  inspectPostgresCutoverPreflight,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  type PostgresQueryResult,
  type PostgresQuerySession
} from "./postgres-cutover.js";
import { canonicalPortabilityJson } from "./portability.js";
import {
  POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE
} from "./postgres-tenant-session.js";
import {
  POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
  buildPostgresWorkerControlManifest,
  verifyPostgresWorkerControlBoundary
} from "./postgres-worker-control.js";

export const POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION = 1;
export const POSTGRES_NOTIFICATION_RECOVERY_RECEIPT_TABLE = "yoink_notification_recovery_receipt";
export const POSTGRES_NOTIFICATION_RECOVERY_FUNCTION = "yoink_recover_notification_deliveries";

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const HANDLER_TASK_KINDS = Object.freeze(["notification_recovery"] as const);
const PROTECTED_TABLES = Object.freeze(["action_jobs", "notification_deliveries"] as const);
const FUNCTION_ARGUMENT_TYPES = Object.freeze(["text", "text"] as const);
const FUNCTION_RESULT_TYPE = "TABLE(expired_notifications bigint, requeued_leases bigint, failed_leases bigint)";
const MAXIMUM_CLOCK_SKEW_MS = 300_000;

export interface PostgresNotificationRecoveryManifest {
  contractVersion: typeof POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  workerControlContractVersion: typeof POSTGRES_WORKER_CONTROL_CONTRACT_VERSION;
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  recoveryRoleNamespace: string;
  workerControlManifestFingerprint: string;
  recoveryRole: {
    kind: "notification_recovery_handler";
    name: string;
    functionName: typeof POSTGRES_NOTIFICATION_RECOVERY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
    insertAccess: false;
    deleteAccess: false;
  };
  protectedTableCount: 2;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  handlerTaskKinds: ["notification_recovery"];
  handlerTaskKindCount: 1;
  totalHandlerTaskKindCount: number;
  notificationRecoveryRepositoryParity: true;
  serverClockBoundRecovery: true;
  fullHandlerRepositoryParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresNotificationRecoveryQualificationReceipt {
  contractVersion: typeof POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  workerControlContractVersion: typeof POSTGRES_WORKER_CONTROL_CONTRACT_VERSION;
  phase: "verified";
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  recoveryRoleNamespace: string;
  roleManifestFingerprint: string;
  workerControlManifestFingerprint: string;
  recoveryRoleName: string;
  protectedTableCount: 2;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  handlerTaskKindCount: 1;
  totalHandlerTaskKindCount: number;
  boundaryCatalogFingerprint: string;
  serverBoundPrincipalLookup: true;
  serverClockBoundRecovery: true;
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

export interface PostgresNotificationRecoveryCapabilityProjection {
  contractVersion: typeof POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  workerControlContractVersion: typeof POSTGRES_WORKER_CONTROL_CONTRACT_VERSION;
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
  readCommittedTransactionAdapter: true;
  notificationRecoveryRepositoryParity: true;
  fullHandlerRepositoryParity: false;
  handlerTaskKindCount: 1;
  totalHandlerTaskKindCount: number;
  protectedTableCount: 2;
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

export interface PostgresNotificationRecoveryResult {
  expiredNotifications: number;
  requeuedLeases: number;
  failedLeases: number;
}

export interface NodePostgresNotificationRecoveryDatabaseOptions {
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
  worker_control_contract_version: string | number | bigint;
  phase: string;
  read_role_namespace: string;
  session_role_namespace: string;
  queue_write_role_namespace: string;
  control_role_namespace: string;
  recovery_role_namespace: string;
  role_manifest_fingerprint: string;
  worker_control_manifest_fingerprint: string;
  recovery_role_name: string;
  protected_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  handler_task_kind_count: string | number | bigint;
  total_handler_task_kind_count: string | number | bigint;
  boundary_catalog_fingerprint: string;
  server_bound_principal_lookup: boolean;
  server_clock_bound_recovery: boolean;
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
  directTableGrantCount: number;
  functionGrantCount: number;
  membershipCount: number;
  activePrincipalCount: number;
  boundaryCatalogFingerprint: string;
}

let cachedCapabilityProjection: Readonly<PostgresNotificationRecoveryCapabilityProjection> | null = null;

export class PostgresNotificationRecoveryQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresNotificationRecoveryQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery schema is invalid."
    );
  }
  return normalized;
}

function roleNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role namespace must contain 3 through 32 lowercase letters, numbers, or underscores."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_notification_recovery`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role name exceeds 63 bytes."
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

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresNotificationRecoveryQualificationError(
      `The PostgreSQL notification-recovery ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresNotificationRecoveryQualificationError(
      `The PostgreSQL notification-recovery ${label} is out of range.`
    );
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresNotificationRecoveryQualificationError(
      `The PostgreSQL notification-recovery ${label} is invalid.`
    );
  }
  return normalized;
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresNotificationRecoveryQualificationError(
      `The PostgreSQL notification-recovery ${label} is invalid.`
    );
  }
  return normalized;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function recoveryFunctionSource(manifest: PostgresNotificationRecoveryManifest): string {
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  recovery_timestamp TEXT;
  expired_count BIGINT := 0;
  requeued_count BIGINT := 0;
  failed_count BIGINT := 0;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected notification-recovery principal is invalid';
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

  UPDATE ${relation(manifest.schemaName, "notification_deliveries")} AS delivery
  SET state = 'expired', assigned_device_id = NULL, capability_hash = '',
      lease_expires_at = '', failure_code = 'job_window_expired',
      updated_at = recovery_timestamp
  WHERE delivery.tenant_id = resolved_tenant_id
    AND delivery.user_id = resolved_user_id
    AND delivery.state IN ('pending', 'leased')
    AND EXISTS (
      SELECT 1 FROM ${relation(manifest.schemaName, "action_jobs")} AS job
      WHERE job.id = delivery.job_id
        AND job.tenant_id = resolved_tenant_id
        AND job.user_id = resolved_user_id
        AND job.expires_at <= recovery_timestamp
    );
  GET DIAGNOSTICS expired_count = ROW_COUNT;

  UPDATE ${relation(manifest.schemaName, "notification_deliveries")} AS delivery
  SET state = 'failed', assigned_device_id = NULL, capability_hash = '',
      lease_expires_at = '', failure_code = 'delivery_attempts_exhausted',
      updated_at = recovery_timestamp
  WHERE delivery.tenant_id = resolved_tenant_id
    AND delivery.user_id = resolved_user_id
    AND delivery.state = 'leased'
    AND delivery.attempts >= ${NOTIFICATION_DELIVERY_MAX_ATTEMPTS}
    AND delivery.lease_expires_at <> ''
    AND delivery.lease_expires_at <= recovery_timestamp;
  GET DIAGNOSTICS failed_count = ROW_COUNT;

  UPDATE ${relation(manifest.schemaName, "notification_deliveries")} AS delivery
  SET state = 'pending', assigned_device_id = NULL, capability_hash = '',
      lease_expires_at = '', failure_code = 'lease_expired_requeued',
      updated_at = recovery_timestamp
  WHERE delivery.tenant_id = resolved_tenant_id
    AND delivery.user_id = resolved_user_id
    AND delivery.state = 'leased'
    AND delivery.attempts < ${NOTIFICATION_DELIVERY_MAX_ATTEMPTS}
    AND delivery.lease_expires_at <> ''
    AND delivery.lease_expires_at <= recovery_timestamp;
  GET DIAGNOSTICS requeued_count = ROW_COUNT;

  RETURN QUERY SELECT expired_count, requeued_count, failed_count;
END
`;
}

export function buildPostgresNotificationRecoveryManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedRecoveryRoleNamespace = "yoink_notify_qualification"
): PostgresNotificationRecoveryManifest {
  const schema = schemaName(requestedSchema);
  const readNamespace = roleNamespace(requestedReadRoleNamespace, "yoink_qualification");
  const sessionNamespace = roleNamespace(requestedSessionRoleNamespace, "yoink_session_qualification");
  const queueNamespace = roleNamespace(requestedQueueWriteRoleNamespace, "yoink_queue_write_qualification");
  const controlNamespace = roleNamespace(requestedControlRoleNamespace, "yoink_control_qualification");
  const recoveryNamespace = roleNamespace(requestedRecoveryRoleNamespace, "yoink_notify_qualification");
  if (new Set([
    readNamespace,
    sessionNamespace,
    queueNamespace,
    controlNamespace,
    recoveryNamespace
  ]).size !== 5) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL read, session, queue-write, worker-control, and notification-recovery namespaces must be distinct."
    );
  }
  const workerControlManifest = buildPostgresWorkerControlManifest(
    schema,
    readNamespace,
    sessionNamespace,
    queueNamespace,
    controlNamespace
  );
  const withoutFingerprint: Omit<PostgresNotificationRecoveryManifest, "fingerprint"> = {
    contractVersion: POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    workerControlContractVersion: POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
    schemaName: schema,
    readRoleNamespace: readNamespace,
    sessionRoleNamespace: sessionNamespace,
    queueWriteRoleNamespace: queueNamespace,
    controlRoleNamespace: controlNamespace,
    recoveryRoleNamespace: recoveryNamespace,
    workerControlManifestFingerprint: workerControlManifest.fingerprint,
    recoveryRole: {
      kind: "notification_recovery_handler",
      name: roleName(recoveryNamespace),
      functionName: POSTGRES_NOTIFICATION_RECOVERY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTableNames: [...PROTECTED_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false,
      insertAccess: false,
      deleteAccess: false
    },
    protectedTableCount: 2,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    handlerTaskKinds: ["notification_recovery"],
    handlerTaskKindCount: 1,
    totalHandlerTaskKindCount: BACKGROUND_TASK_KINDS.length,
    notificationRecoveryRepositoryParity: true,
    serverClockBoundRecovery: true,
    fullHandlerRepositoryParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresNotificationRecoveryCapabilityProjection(): PostgresNotificationRecoveryCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresNotificationRecoveryManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    workerControlContractVersion: POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
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
    readCommittedTransactionAdapter: true,
    notificationRecoveryRepositoryParity: true,
    fullHandlerRepositoryParity: false,
    handlerTaskKindCount: manifest.handlerTaskKindCount,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    protectedTableCount: manifest.protectedTableCount,
    directTableGrantCount: manifest.directTableGrantCount,
    functionGrantCount: manifest.functionGrantCount,
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
  manifest: PostgresNotificationRecoveryManifest
): Promise<BoundaryInspection> {
  const role = manifest.recoveryRole.name;
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [role]
  );
  const roleRow = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !roleRow
    || roleRow.rolsuper || roleRow.rolinherit || roleRow.rolcreaterole
    || roleRow.rolcreatedb || roleRow.rolcanlogin || roleRow.rolreplication || roleRow.rolbypassrls) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role is missing or has an unsafe role attribute."
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
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role must not have an active membership."
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
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role must not have a direct table or column grant."
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
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role has an unauthorized effective table privilege."
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
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role has an invalid schema privilege."
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
    || routine.routineName !== manifest.recoveryRole.functionName
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role
    || routine.source !== recoveryFunctionSource(manifest)) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery function boundary is incomplete."
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
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery function grant is not exact."
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
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role must not access application-schema sequences."
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
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role must not own application-schema objects."
    );
  }

  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery role must not depend on direct table policies."
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
  if (rls.rows.length !== manifest.protectedTableCount
    || rls.rows.some((row) => !row.enabled || !row.forced)
    || rls.rows.map((row) => row.tableName).join(",") !== [...PROTECTED_TABLES].sort().join(",")) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery protected-table boundary is incomplete."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresNotificationRecoveryQualificationError(
      "Notification-recovery qualification cannot activate a runtime principal."
    );
  }

  return {
    protectedTableCount: rls.rows.length,
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
  manifest: PostgresNotificationRecoveryManifest
): PostgresNotificationRecoveryQualificationReceipt {
  if (row.phase !== "verified"
    || row.read_role_namespace !== manifest.readRoleNamespace
    || row.session_role_namespace !== manifest.sessionRoleNamespace
    || row.queue_write_role_namespace !== manifest.queueWriteRoleNamespace
    || row.control_role_namespace !== manifest.controlRoleNamespace
    || row.recovery_role_namespace !== manifest.recoveryRoleNamespace
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.worker_control_manifest_fingerprint !== manifest.workerControlManifestFingerprint
    || row.recovery_role_name !== manifest.recoveryRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.server_bound_principal_lookup !== true
    || row.server_clock_bound_recovery !== true
    || row.notification_recovery_repository_parity !== true
    || row.full_handler_repository_parity !== false
    || row.direct_table_access !== false || row.insert_access !== false
    || row.delete_access !== false || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery receipt is incomplete or unsafe."
    );
  }
  if (exactInteger(row.contract_version, "contract version")
      !== POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION
    || exactInteger(row.cutover_contract_version, "cutover contract version")
      !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || exactInteger(row.worker_control_contract_version, "worker-control contract version")
      !== POSTGRES_WORKER_CONTROL_CONTRACT_VERSION
    || exactInteger(row.protected_table_count, "protected table count") !== manifest.protectedTableCount
    || exactInteger(row.direct_table_grant_count, "direct table-grant count") !== 0
    || exactInteger(row.function_grant_count, "function grant count") !== 1
    || exactInteger(row.membership_count, "membership count") !== 0
    || exactInteger(row.active_principal_count, "active principal count") !== 0
    || exactInteger(row.handler_task_kind_count, "handler task-kind count") !== 1
    || exactInteger(row.total_handler_task_kind_count, "total handler task-kind count")
      !== manifest.totalHandlerTaskKindCount) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery receipt uses an unsupported or active contract."
    );
  }
  return {
    contractVersion: POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    workerControlContractVersion: POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
    phase: "verified",
    schemaName: manifest.schemaName,
    readRoleNamespace: manifest.readRoleNamespace,
    sessionRoleNamespace: manifest.sessionRoleNamespace,
    queueWriteRoleNamespace: manifest.queueWriteRoleNamespace,
    controlRoleNamespace: manifest.controlRoleNamespace,
    recoveryRoleNamespace: manifest.recoveryRoleNamespace,
    roleManifestFingerprint: manifest.fingerprint,
    workerControlManifestFingerprint: manifest.workerControlManifestFingerprint,
    recoveryRoleName: manifest.recoveryRole.name,
    protectedTableCount: 2,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    handlerTaskKindCount: 1,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    serverBoundPrincipalLookup: true,
    serverClockBoundRecovery: true,
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
  manifest: PostgresNotificationRecoveryManifest
): Promise<PostgresNotificationRecoveryQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_RECEIPT_TABLE)}
     WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresNotificationRecoveryQualificationReceipt,
  manifest: PostgresNotificationRecoveryManifest
): void {
  if (inspection.protectedTableCount !== receipt.protectedTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresNotificationRecoveryQualificationError(
      "The PostgreSQL notification-recovery boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresNotificationRecoveryBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedRecoveryRoleNamespace = "yoink_notify_qualification"
): Promise<PostgresNotificationRecoveryQualificationReceipt> {
  const manifest = buildPostgresNotificationRecoveryManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedRecoveryRoleNamespace
  );
  await verifyPostgresWorkerControlBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresNotificationRecoveryBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedRecoveryRoleNamespace = "yoink_notify_qualification",
  now = Date.now()
): Promise<PostgresNotificationRecoveryQualificationReceipt> {
  const manifest = buildPostgresNotificationRecoveryManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedRecoveryRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresNotificationRecoveryQualificationError(
      "Notification-recovery qualification requires the supported cutover/control role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresNotificationRecoveryQualificationError(
      "Notification-recovery qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresWorkerControlBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace
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
        manifest.recoveryRole.name,
        manifest.schemaName,
        POSTGRES_NOTIFICATION_RECOVERY_RECEIPT_TABLE,
        [POSTGRES_NOTIFICATION_RECOVERY_FUNCTION, "yoink_notification_recovery_receipt_guard"]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing boundary object count") !== 0) {
      throw new PostgresNotificationRecoveryQualificationError(
        "Notification-recovery qualification refuses an existing role, function, guard, or receipt."
      );
    }

    await session.query(
      `CREATE ROLE ${identifier(manifest.recoveryRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)} TO ${identifier(manifest.recoveryRole.name)}`
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${recoveryFunctionSource(manifest)}$yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_FUNCTION)}(TEXT, TEXT)
       FROM PUBLIC`
    );
    await session.query(
      `GRANT EXECUTE ON FUNCTION
       ${relation(manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_FUNCTION)}(TEXT, TEXT)
       TO ${identifier(manifest.recoveryRole.name)}`
    );

    await session.query(`CREATE TABLE ${relation(manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_RECEIPT_TABLE)} (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      contract_version BIGINT NOT NULL CHECK (contract_version = ${POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION}),
      cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = ${POSTGRES_CUTOVER_CONTRACT_VERSION}),
      worker_control_contract_version BIGINT NOT NULL CHECK (
        worker_control_contract_version = ${POSTGRES_WORKER_CONTROL_CONTRACT_VERSION}
      ),
      phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
      read_role_namespace TEXT NOT NULL,
      session_role_namespace TEXT NOT NULL,
      queue_write_role_namespace TEXT NOT NULL,
      control_role_namespace TEXT NOT NULL,
      recovery_role_namespace TEXT NOT NULL,
      role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
      worker_control_manifest_fingerprint TEXT NOT NULL CHECK (
        worker_control_manifest_fingerprint ~ '^[a-f0-9]{64}$'
      ),
      recovery_role_name TEXT NOT NULL,
      protected_table_count BIGINT NOT NULL,
      direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
      function_grant_count BIGINT NOT NULL,
      membership_count BIGINT NOT NULL CHECK (membership_count = 0),
      active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
      handler_task_kind_count BIGINT NOT NULL CHECK (handler_task_kind_count = 1),
      total_handler_task_kind_count BIGINT NOT NULL,
      boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
      server_bound_principal_lookup BOOLEAN NOT NULL DEFAULT TRUE CHECK (server_bound_principal_lookup = TRUE),
      server_clock_bound_recovery BOOLEAN NOT NULL DEFAULT TRUE CHECK (server_clock_bound_recovery = TRUE),
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
      `REVOKE ALL PRIVILEGES ON ${relation(manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_RECEIPT_TABLE)}
       FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_RECEIPT_TABLE)}(
         id, contract_version, cutover_contract_version, worker_control_contract_version,
         phase, read_role_namespace, session_role_namespace, queue_write_role_namespace,
         control_role_namespace, recovery_role_namespace, role_manifest_fingerprint,
         worker_control_manifest_fingerprint, recovery_role_name, protected_table_count,
         direct_table_grant_count, function_grant_count, membership_count,
         active_principal_count, handler_task_kind_count, total_handler_task_kind_count,
         boundary_catalog_fingerprint, applied_at
       ) VALUES ('active', $1, $2, $3, 'loading', $4, $5, $6, $7, $8, $9, $10, $11,
                 0, 0, 0, 0, 0, 1, $12, repeat('0', 64), $13)`,
      [
        POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
        POSTGRES_CUTOVER_CONTRACT_VERSION,
        POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
        manifest.readRoleNamespace,
        manifest.sessionRoleNamespace,
        manifest.queueWriteRoleNamespace,
        manifest.controlRoleNamespace,
        manifest.recoveryRoleNamespace,
        manifest.fingerprint,
        manifest.workerControlManifestFingerprint,
        manifest.recoveryRole.name,
        manifest.totalHandlerTaskKindCount,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_RECEIPT_TABLE)}
       SET phase = 'verified', protected_table_count = $1, direct_table_grant_count = $2,
           function_grant_count = $3, membership_count = $4, active_principal_count = $5,
           boundary_catalog_fingerprint = $6, verified_at = $7
       WHERE id = 'active' AND phase = 'loading'`,
      [
        inspection.protectedTableCount,
        inspection.directTableGrantCount,
        inspection.functionGrantCount,
        inspection.membershipCount,
        inspection.activePrincipalCount,
        inspection.boundaryCatalogFingerprint,
        verifiedAt
      ]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_notification_recovery_receipt_guard")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO ${identifier(manifest.schemaName)}, pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification-recovery receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_notification_recovery_receipt_guard")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_notification_recovery_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_notification_recovery_receipt_guard")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

class NotificationRecoverySession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresNotificationRecoveryDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresNotificationRecoveryManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
    requestedReadRoleNamespace = "yoink_qualification",
    requestedSessionRoleNamespace = "yoink_session_qualification",
    requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
    requestedControlRoleNamespace = "yoink_control_qualification",
    requestedRecoveryRoleNamespace = "yoink_notify_qualification",
    options: NodePostgresNotificationRecoveryDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresNotificationRecoveryManifest(
      requestedSchema,
      requestedReadRoleNamespace,
      requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace,
      requestedControlRoleNamespace,
      requestedRecoveryRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresNotificationRecoveryQualificationError(
        "The PostgreSQL notification-recovery connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_notification_recovery_qualification"
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
  ): Promise<PostgresNotificationRecoveryResult> {
    const tenantId = principalId(principal?.tenantId, "expected tenant ID");
    const userId = principalId(principal?.userId, "expected user ID");
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresNotificationRecoveryQualificationError(
        "The PostgreSQL notification-recovery cycle timestamp differs from the process clock."
      );
    }
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.recoveryRole.name)}`);
      const session = new NotificationRecoverySession(client);
      const result = await session.query<{
        expiredNotifications: string | number | bigint;
        requeuedLeases: string | number | bigint;
        failedLeases: string | number | bigint;
      }>(
        `SELECT expired_notifications AS "expiredNotifications",
                requeued_leases AS "requeuedLeases",
                failed_leases AS "failedLeases"
         FROM ${relation(this.manifest.schemaName, POSTGRES_NOTIFICATION_RECOVERY_FUNCTION)}(
           $1, $2
         )`,
        [tenantId, userId]
      );
      const row = result.rows[0];
      if (result.rows.length !== 1 || !row) {
        throw new PostgresNotificationRecoveryQualificationError(
          "The PostgreSQL notification-recovery function returned an ambiguous result."
        );
      }
      const recovered = {
        expiredNotifications: exactInteger(row.expiredNotifications, "expired notification count"),
        requeuedLeases: exactInteger(row.requeuedLeases, "requeued lease count"),
        failedLeases: exactInteger(row.failedLeases, "failed lease count")
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
