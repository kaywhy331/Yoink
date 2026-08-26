import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
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
import { canonicalPortabilityJson } from "./portability.js";
import {
  POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
  buildPostgresTenantQueueWriteManifest,
  verifyPostgresTenantQueueWriteBoundary
} from "./postgres-tenant-queue-writes.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_WORKER_CONTROL_CONTRACT_VERSION = 1;
export const POSTGRES_WORKER_CONTROL_RECEIPT_TABLE = "yoink_worker_control_receipt";

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface PostgresWorkerControlTableGrant {
  tableName: string;
  selectColumns: string[];
  updateColumns: string[];
}

export interface PostgresWorkerControlManifest {
  contractVersion: typeof POSTGRES_WORKER_CONTROL_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  queueWriteContractVersion: typeof POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION;
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  queueWriteManifestFingerprint: string;
  controlRole: {
    kind: "background_worker_control";
    name: string;
    tableGrants: PostgresWorkerControlTableGrant[];
    login: false;
    inherit: false;
    bypassRls: false;
    insertAccess: false;
    deleteAccess: false;
  };
  tableCount: 3;
  grantCount: 19;
  permissivePolicyCount: 3;
  activePrincipalCount: 0;
  principalEnumeration: true;
  deploymentStatus: true;
  workerStopping: true;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresWorkerControlQualificationReceipt {
  contractVersion: typeof POSTGRES_WORKER_CONTROL_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  queueWriteContractVersion: typeof POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION;
  phase: "verified";
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  roleManifestFingerprint: string;
  queueWriteManifestFingerprint: string;
  controlRoleName: string;
  tableCount: 3;
  grantCount: 19;
  membershipCount: 0;
  activePrincipalCount: 0;
  permissivePolicyCount: 3;
  boundaryCatalogFingerprint: string;
  principalEnumeration: true;
  deploymentStatus: true;
  workerStopping: true;
  insertAccess: false;
  deleteAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresWorkerControlCapabilityProjection {
  contractVersion: typeof POSTGRES_WORKER_CONTROL_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  queueWriteContractVersion: typeof POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION;
  deterministicManifestImplemented: true;
  atomicQualificationApplyImplemented: true;
  exactEffectivePrivilegeVerification: true;
  immutableBoundaryCatalogFingerprint: true;
  qualificationSuiteParity: true;
  noLogin: true;
  noInherit: true;
  noBypassRls: true;
  readCommittedTransactionAdapter: true;
  controlRepositoryParity: true;
  principalEnumeration: true;
  deploymentStatus: true;
  workerStopping: true;
  tableCount: 3;
  grantCount: 19;
  permissivePolicyCount: 3;
  insertTableCount: 0;
  updateTableCount: 1;
  deleteTableCount: 0;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface NodePostgresWorkerControlDatabaseOptions {
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

interface ColumnGrantRow extends Record<string, unknown> {
  table_name: string;
  column_name: string;
  privilege_type: string;
  is_grantable: string;
}

interface PolicyRow extends Record<string, unknown> {
  policyName: string;
  tableName: string;
  permissive: string;
  roleCount: string | number | bigint;
  roleName: string;
  command: string;
  usingExpression: string | null;
  checkExpression: string | null;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  queue_write_contract_version: string | number | bigint;
  phase: string;
  read_role_namespace: string;
  session_role_namespace: string;
  queue_write_role_namespace: string;
  control_role_namespace: string;
  role_manifest_fingerprint: string;
  queue_write_manifest_fingerprint: string;
  control_role_name: string;
  table_count: string | number | bigint;
  grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  permissive_policy_count: string | number | bigint;
  boundary_catalog_fingerprint: string;
  principal_enumeration: boolean;
  deployment_status: boolean;
  worker_stopping: boolean;
  insert_access: boolean;
  delete_access: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  applied_at: string;
  verified_at: string;
}

interface BoundaryInspection {
  tableCount: number;
  grantCount: number;
  membershipCount: number;
  activePrincipalCount: number;
  permissivePolicyCount: number;
  boundaryCatalogFingerprint: string;
}

const TABLE_GRANTS: ReadonlyArray<{
  readonly tableName: string;
  readonly selectColumns: readonly string[];
  readonly updateColumns: readonly string[];
}> = Object.freeze([
  Object.freeze({
    tableName: "users",
    selectColumns: Object.freeze(["tenant_id", "id"]),
    updateColumns: Object.freeze([])
  }),
  Object.freeze({
    tableName: "background_worker_deployment_expectations",
    selectColumns: Object.freeze([
      "id",
      "contract_version",
      "desired_mode",
      "runtime_version",
      "deployment_fingerprint"
    ]),
    updateColumns: Object.freeze([])
  }),
  Object.freeze({
    tableName: "background_worker_heartbeats",
    selectColumns: Object.freeze([
      "tenant_id",
      "subject_user_id",
      "worker_id",
      "runtime_kind",
      "state",
      "heartbeat_at",
      "last_error_code",
      "deployment_fingerprint"
    ]),
    updateColumns: Object.freeze(["state", "heartbeat_at", "stopped_at", "last_error_code"])
  })
]);

const POLICY_SPECS = Object.freeze([
  Object.freeze({
    policyName: "yoink_worker_control_users_select",
    tableName: "users",
    command: "SELECT",
    usingExpression: "true",
    checkExpression: null,
    checkSql: null
  }),
  Object.freeze({
    policyName: "yoink_worker_control_heartbeats_select",
    tableName: "background_worker_heartbeats",
    command: "SELECT",
    usingExpression: "true",
    checkExpression: null,
    checkSql: null
  }),
  Object.freeze({
    policyName: "yoink_worker_control_heartbeats_update",
    tableName: "background_worker_heartbeats",
    command: "UPDATE",
    usingExpression: "true",
    checkExpression: "(state = 'stopped'::text)",
    checkSql: "state = 'stopped'"
  })
]);

let cachedCapabilityProjection: PostgresWorkerControlCapabilityProjection | null = null;

export class PostgresWorkerControlQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresWorkerControlQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresWorkerControlQualificationError("The PostgreSQL worker-control schema is invalid.");
  }
  return normalized;
}

function roleNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role namespace must contain 3 through 32 lowercase letters, numbers, or underscores."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_background_worker_control`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresWorkerControlQualificationError("The PostgreSQL worker-control role name exceeds 63 bytes.");
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
    throw new PostgresWorkerControlQualificationError(`The PostgreSQL worker-control ${label} is invalid.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresWorkerControlQualificationError(`The PostgreSQL worker-control ${label} is out of range.`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresWorkerControlQualificationError(`The PostgreSQL worker-control ${label} is invalid.`);
  }
  return normalized;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function cloneTableGrants(): PostgresWorkerControlTableGrant[] {
  return TABLE_GRANTS.map((grant) => ({
    tableName: grant.tableName,
    selectColumns: [...grant.selectColumns],
    updateColumns: [...grant.updateColumns]
  }));
}

export function buildPostgresWorkerControlManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification"
): PostgresWorkerControlManifest {
  const schema = schemaName(requestedSchema);
  const readNamespace = roleNamespace(requestedReadRoleNamespace, "yoink_qualification");
  const sessionNamespace = roleNamespace(requestedSessionRoleNamespace, "yoink_session_qualification");
  const queueNamespace = roleNamespace(requestedQueueWriteRoleNamespace, "yoink_queue_write_qualification");
  const controlNamespace = roleNamespace(requestedControlRoleNamespace, "yoink_control_qualification");
  if (new Set([readNamespace, sessionNamespace, queueNamespace, controlNamespace]).size !== 4) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL read, session, queue-write, and worker-control namespaces must be distinct."
    );
  }
  const queueManifest = buildPostgresTenantQueueWriteManifest(
    schema,
    readNamespace,
    sessionNamespace,
    queueNamespace
  );
  const withoutFingerprint: Omit<PostgresWorkerControlManifest, "fingerprint"> = {
    contractVersion: POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    queueWriteContractVersion: POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
    schemaName: schema,
    readRoleNamespace: readNamespace,
    sessionRoleNamespace: sessionNamespace,
    queueWriteRoleNamespace: queueNamespace,
    controlRoleNamespace: controlNamespace,
    queueWriteManifestFingerprint: queueManifest.fingerprint,
    controlRole: {
      kind: "background_worker_control",
      name: roleName(controlNamespace),
      tableGrants: cloneTableGrants(),
      login: false,
      inherit: false,
      bypassRls: false,
      insertAccess: false,
      deleteAccess: false
    },
    tableCount: 3,
    grantCount: 19,
    permissivePolicyCount: 3,
    activePrincipalCount: 0,
    principalEnumeration: true,
    deploymentStatus: true,
    workerStopping: true,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresWorkerControlCapabilityProjection(): PostgresWorkerControlCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresWorkerControlManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    queueWriteContractVersion: POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactEffectivePrivilegeVerification: true,
    immutableBoundaryCatalogFingerprint: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    readCommittedTransactionAdapter: true,
    controlRepositoryParity: true,
    principalEnumeration: true,
    deploymentStatus: true,
    workerStopping: true,
    tableCount: manifest.tableCount,
    grantCount: manifest.grantCount,
    permissivePolicyCount: manifest.permissivePolicyCount,
    insertTableCount: 0,
    updateTableCount: 1,
    deleteTableCount: 0,
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
  manifest: PostgresWorkerControlManifest
): Promise<BoundaryInspection> {
  const role = manifest.controlRole.name;
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
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role is missing or has an unsafe role attribute."
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
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role must not have an active membership."
    );
  }

  const tableGrants = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM information_schema.role_table_grants
     WHERE table_schema = $1 AND grantee = $2`,
    [manifest.schemaName, role]
  );
  if (exactInteger(tableGrants.rows[0]?.count, "table-level grant count") !== 0) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role must not have a table-level grant."
    );
  }

  const grants = await session.query<ColumnGrantRow>(
    `SELECT table_name, column_name, privilege_type, is_grantable
     FROM information_schema.role_column_grants
     WHERE table_schema = $1 AND grantee = $2
     ORDER BY table_name, column_name, privilege_type`,
    [manifest.schemaName, role]
  );
  const expectedGrants = new Set(manifest.controlRole.tableGrants.flatMap((grant) => [
    ...grant.selectColumns.map((column) => `${grant.tableName}:${column}:SELECT:NO`),
    ...grant.updateColumns.map((column) => `${grant.tableName}:${column}:UPDATE:NO`)
  ]));
  const actualGrants = new Set(grants.rows.map((grant) =>
    `${grant.table_name}:${grant.column_name}:${grant.privilege_type}:${grant.is_grantable}`));
  if (actualGrants.size !== expectedGrants.size
    || [...actualGrants].some((grant) => !expectedGrants.has(grant))) {
    throw new PostgresWorkerControlQualificationError(
      "PostgreSQL worker-control column grants differ from the deterministic manifest."
    );
  }

  const privilegeByTable = new Map(manifest.controlRole.tableGrants.map((grant) =>
    [grant.tableName, {
      select: new Set(grant.selectColumns),
      update: new Set(grant.updateColumns)
    }]));
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
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role has an unauthorized effective table privilege."
    );
  }

  const effectiveColumns = await session.query<{
    tableName: string;
    columnName: string;
    maySelect: boolean;
    mayInsert: boolean;
    mayUpdate: boolean;
    mayReference: boolean;
  }>(
    `SELECT relation.relname AS "tableName", attribute.attname AS "columnName",
            has_column_privilege($2, relation.oid, attribute.attname, 'SELECT') AS "maySelect",
            has_column_privilege($2, relation.oid, attribute.attname, 'INSERT') AS "mayInsert",
            has_column_privilege($2, relation.oid, attribute.attname, 'UPDATE') AS "mayUpdate",
            has_column_privilege($2, relation.oid, attribute.attname, 'REFERENCES') AS "mayReference"
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
     WHERE namespace.nspname = $1 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND attribute.attnum > 0 AND NOT attribute.attisdropped
     ORDER BY relation.relname, attribute.attnum`,
    [manifest.schemaName, role]
  );
  if (effectiveColumns.rows.some((row) => {
    const expected = privilegeByTable.get(row.tableName);
    return row.maySelect !== Boolean(expected?.select.has(row.columnName))
      || row.mayUpdate !== Boolean(expected?.update.has(row.columnName))
      || row.mayInsert || row.mayReference;
  })) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role has an invalid schema privilege."
    );
  }

  const executableRoutines = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_proc routine
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = $1 AND has_function_privilege($2, routine.oid, 'EXECUTE')`,
    [manifest.schemaName, role]
  );
  if (exactInteger(executableRoutines.rows[0]?.count, "executable routine count") !== 0) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role must not execute application-schema routines."
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
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role must not access application-schema sequences."
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
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control role must not own application-schema objects."
    );
  }

  const policies = await session.query<PolicyRow>(
    `SELECT policyname AS "policyName", tablename AS "tableName", permissive,
            cardinality(roles) AS "roleCount", roles[1]::text AS "roleName",
            cmd AS command, qual AS "usingExpression", with_check AS "checkExpression"
     FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])
     ORDER BY policyname`,
    [manifest.schemaName, role]
  );
  const expectedPolicies = new Map<string, (typeof POLICY_SPECS)[number]>(
    POLICY_SPECS.map((policy) => [policy.policyName, policy])
  );
  if (policies.rows.length !== manifest.permissivePolicyCount
    || policies.rows.some((policy) => {
      const expected = expectedPolicies.get(policy.policyName);
      return !expected || policy.permissive !== "PERMISSIVE"
        || exactInteger(policy.roleCount, "permissive-policy role count") !== 1
        || policy.roleName !== role || policy.tableName !== expected.tableName
        || policy.command !== expected.command
        || policy.usingExpression !== expected.usingExpression
        || policy.checkExpression !== expected.checkExpression;
    })) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control policy surface is incomplete."
    );
  }

  const rls = await session.query<{
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
    [manifest.schemaName, ["users", "background_worker_heartbeats"]]
  );
  if (rls.rows.length !== 2 || rls.rows.some((row) => !row.enabled || !row.forced)) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control RLS table surface is incomplete."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresWorkerControlQualificationError(
      "Worker-control qualification cannot activate a runtime principal."
    );
  }

  return {
    tableCount: privilegeByTable.size,
    grantCount: grants.rows.length,
    membershipCount,
    activePrincipalCount,
    permissivePolicyCount: policies.rows.length,
    boundaryCatalogFingerprint: fingerprint({
      grants: grants.rows,
      policies: policies.rows.map((policy) => ({
        name: policy.policyName,
        table: policy.tableName,
        permissive: policy.permissive,
        role: policy.roleName,
        command: policy.command,
        usingExpression: policy.usingExpression,
        checkExpression: policy.checkExpression
      })),
      rls: rls.rows
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresWorkerControlManifest
): PostgresWorkerControlQualificationReceipt {
  if (row.phase !== "verified"
    || row.read_role_namespace !== manifest.readRoleNamespace
    || row.session_role_namespace !== manifest.sessionRoleNamespace
    || row.queue_write_role_namespace !== manifest.queueWriteRoleNamespace
    || row.control_role_namespace !== manifest.controlRoleNamespace
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.queue_write_manifest_fingerprint !== manifest.queueWriteManifestFingerprint
    || row.control_role_name !== manifest.controlRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.principal_enumeration !== true || row.deployment_status !== true
    || row.worker_stopping !== true || row.insert_access !== false
    || row.delete_access !== false || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control receipt is incomplete or unsafe."
    );
  }
  if (exactInteger(row.contract_version, "contract version") !== POSTGRES_WORKER_CONTROL_CONTRACT_VERSION
    || exactInteger(row.cutover_contract_version, "cutover contract version") !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || exactInteger(row.queue_write_contract_version, "queue-write contract version")
      !== POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION
    || exactInteger(row.table_count, "table count") !== manifest.tableCount
    || exactInteger(row.grant_count, "grant count") !== manifest.grantCount
    || exactInteger(row.membership_count, "membership count") !== 0
    || exactInteger(row.active_principal_count, "active principal count") !== 0
    || exactInteger(row.permissive_policy_count, "permissive-policy count")
      !== manifest.permissivePolicyCount) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control receipt uses an unsupported or active contract."
    );
  }
  return {
    contractVersion: POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    queueWriteContractVersion: POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
    phase: "verified",
    schemaName: manifest.schemaName,
    readRoleNamespace: manifest.readRoleNamespace,
    sessionRoleNamespace: manifest.sessionRoleNamespace,
    queueWriteRoleNamespace: manifest.queueWriteRoleNamespace,
    controlRoleNamespace: manifest.controlRoleNamespace,
    roleManifestFingerprint: manifest.fingerprint,
    queueWriteManifestFingerprint: manifest.queueWriteManifestFingerprint,
    controlRoleName: manifest.controlRole.name,
    tableCount: 3,
    grantCount: 19,
    membershipCount: 0,
    activePrincipalCount: 0,
    permissivePolicyCount: 3,
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    principalEnumeration: true,
    deploymentStatus: true,
    workerStopping: true,
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
  manifest: PostgresWorkerControlManifest
): Promise<PostgresWorkerControlQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_WORKER_CONTROL_RECEIPT_TABLE)}
     WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresWorkerControlQualificationReceipt,
  manifest: PostgresWorkerControlManifest
): void {
  if (inspection.tableCount !== receipt.tableCount
    || inspection.grantCount !== receipt.grantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.permissivePolicyCount !== receipt.permissivePolicyCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresWorkerControlQualificationError(
      "The PostgreSQL worker-control boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresWorkerControlBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification"
): Promise<PostgresWorkerControlQualificationReceipt> {
  const manifest = buildPostgresWorkerControlManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace
  );
  await verifyPostgresTenantQueueWriteBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresWorkerControlBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  now = Date.now()
): Promise<PostgresWorkerControlQualificationReceipt> {
  const manifest = buildPostgresWorkerControlManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresWorkerControlQualificationError(
      "Worker-control qualification requires the supported cutover/control role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresWorkerControlQualificationError(
      "Worker-control qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresTenantQueueWriteBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace
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
         WHERE namespace.nspname = $2 AND routine.proname = $4
       ) + (
         SELECT COUNT(*) FROM pg_catalog.pg_policies
         WHERE schemaname = $2 AND policyname = ANY($5::text[])
       ) AS count`,
      [
        manifest.controlRole.name,
        manifest.schemaName,
        POSTGRES_WORKER_CONTROL_RECEIPT_TABLE,
        "yoink_worker_control_receipt_guard",
        POLICY_SPECS.map((policy) => policy.policyName)
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing boundary object count") !== 0) {
      throw new PostgresWorkerControlQualificationError(
        "Worker-control qualification refuses an existing role, policy, guard, or receipt."
      );
    }

    await session.query(
      `CREATE ROLE ${identifier(manifest.controlRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)} TO ${identifier(manifest.controlRole.name)}`
    );
    for (const grant of manifest.controlRole.tableGrants) {
      if (grant.selectColumns.length) {
        await session.query(
          `GRANT SELECT (${grant.selectColumns.map(identifier).join(", ")})
           ON ${relation(manifest.schemaName, grant.tableName)}
           TO ${identifier(manifest.controlRole.name)}`
        );
      }
      if (grant.updateColumns.length) {
        await session.query(
          `GRANT UPDATE (${grant.updateColumns.map(identifier).join(", ")})
           ON ${relation(manifest.schemaName, grant.tableName)}
           TO ${identifier(manifest.controlRole.name)}`
        );
      }
    }
    for (const policy of POLICY_SPECS) {
      await session.query(
        `CREATE POLICY ${identifier(policy.policyName)}
         ON ${relation(manifest.schemaName, policy.tableName)} AS PERMISSIVE FOR ${policy.command}
         TO ${identifier(manifest.controlRole.name)}
         USING (TRUE)${policy.checkSql ? ` WITH CHECK (${policy.checkSql})` : ""}`
      );
    }

    await session.query(`CREATE TABLE ${relation(manifest.schemaName, POSTGRES_WORKER_CONTROL_RECEIPT_TABLE)} (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      contract_version BIGINT NOT NULL CHECK (contract_version = ${POSTGRES_WORKER_CONTROL_CONTRACT_VERSION}),
      cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = ${POSTGRES_CUTOVER_CONTRACT_VERSION}),
      queue_write_contract_version BIGINT NOT NULL CHECK (
        queue_write_contract_version = ${POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION}
      ),
      phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
      read_role_namespace TEXT NOT NULL,
      session_role_namespace TEXT NOT NULL,
      queue_write_role_namespace TEXT NOT NULL,
      control_role_namespace TEXT NOT NULL,
      role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
      queue_write_manifest_fingerprint TEXT NOT NULL CHECK (
        queue_write_manifest_fingerprint ~ '^[a-f0-9]{64}$'
      ),
      control_role_name TEXT NOT NULL,
      table_count BIGINT NOT NULL,
      grant_count BIGINT NOT NULL,
      membership_count BIGINT NOT NULL CHECK (membership_count = 0),
      active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
      permissive_policy_count BIGINT NOT NULL,
      boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
      principal_enumeration BOOLEAN NOT NULL DEFAULT TRUE CHECK (principal_enumeration = TRUE),
      deployment_status BOOLEAN NOT NULL DEFAULT TRUE CHECK (deployment_status = TRUE),
      worker_stopping BOOLEAN NOT NULL DEFAULT TRUE CHECK (worker_stopping = TRUE),
      insert_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (insert_access = FALSE),
      delete_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (delete_access = FALSE),
      runtime_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (runtime_authority = FALSE),
      production_ready BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_ready = FALSE),
      applied_at TEXT NOT NULL,
      verified_at TEXT NOT NULL DEFAULT ''
    )`);
    await session.query(
      `REVOKE ALL PRIVILEGES ON ${relation(manifest.schemaName, POSTGRES_WORKER_CONTROL_RECEIPT_TABLE)}
       FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_WORKER_CONTROL_RECEIPT_TABLE)}(
         id, contract_version, cutover_contract_version, queue_write_contract_version,
         phase, read_role_namespace, session_role_namespace, queue_write_role_namespace,
         control_role_namespace, role_manifest_fingerprint, queue_write_manifest_fingerprint,
         control_role_name, table_count, grant_count, membership_count,
         active_principal_count, permissive_policy_count, boundary_catalog_fingerprint, applied_at
       ) VALUES ('active', $1, $2, $3, 'loading', $4, $5, $6, $7, $8, $9, $10,
                 0, 0, 0, 0, 0, repeat('0', 64), $11)`,
      [
        POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
        POSTGRES_CUTOVER_CONTRACT_VERSION,
        POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
        manifest.readRoleNamespace,
        manifest.sessionRoleNamespace,
        manifest.queueWriteRoleNamespace,
        manifest.controlRoleNamespace,
        manifest.fingerprint,
        manifest.queueWriteManifestFingerprint,
        manifest.controlRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_WORKER_CONTROL_RECEIPT_TABLE)}
       SET phase = 'verified', table_count = $1, grant_count = $2,
           membership_count = $3, active_principal_count = $4,
           permissive_policy_count = $5, boundary_catalog_fingerprint = $6,
           verified_at = $7
       WHERE id = 'active' AND phase = 'loading'`,
      [
        inspection.tableCount,
        inspection.grantCount,
        inspection.membershipCount,
        inspection.activePrincipalCount,
        inspection.permissivePolicyCount,
        inspection.boundaryCatalogFingerprint,
        verifiedAt
      ]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_worker_control_receipt_guard")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO ${identifier(manifest.schemaName)}, pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'worker-control receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_worker_control_receipt_guard")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_worker_control_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(manifest.schemaName, POSTGRES_WORKER_CONTROL_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_worker_control_receipt_guard")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

class WorkerControlSession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresWorkerControlDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresWorkerControlManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
    requestedReadRoleNamespace = "yoink_qualification",
    requestedSessionRoleNamespace = "yoink_session_qualification",
    requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
    requestedControlRoleNamespace = "yoink_control_qualification",
    options: NodePostgresWorkerControlDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresWorkerControlManifest(
      requestedSchema,
      requestedReadRoleNamespace,
      requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace,
      requestedControlRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresWorkerControlQualificationError(
        "The PostgreSQL worker-control connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_worker_control_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async controlTransaction<T>(
    operation: (session: PostgresQuerySession) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.controlRole.name)}`);
      const result = await operation(new WorkerControlSession(client));
      await client.query("COMMIT");
      return result;
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
