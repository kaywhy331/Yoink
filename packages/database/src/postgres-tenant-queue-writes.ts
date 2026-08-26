import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { nowIso } from "../../domain/src/ids.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  POSTGRES_JSON_VALID_FUNCTION,
  inspectPostgresCutoverPreflight,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  type PostgresQueryResult,
  type PostgresQuerySession
} from "./postgres-cutover.js";
import { canonicalPortabilityJson } from "./portability.js";
import { buildPostgresSchemaManifest } from "./postgres-schema-manifest.js";
import {
  POSTGRES_TENANT_SESSION_BINDER_FUNCTION,
  POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
  POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE,
  POSTGRES_TENANT_SESSION_SCOPE_FUNCTION,
  buildPostgresServerBoundTenantCondition,
  buildPostgresTenantSessionManifest,
  verifyPostgresTenantSessionBoundary,
  type PostgresTenantSessionPrincipal
} from "./postgres-tenant-session.js";

export const POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION = 3;
export const POSTGRES_TENANT_QUEUE_WRITE_RECEIPT_TABLE = "yoink_tenant_queue_write_receipt";

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;

type QueueWritePrivilege = "SELECT" | "INSERT" | "UPDATE";

export interface PostgresTenantQueueWriteTableGrant {
  tableName: string;
  privileges: QueueWritePrivilege[];
}

export interface PostgresTenantQueueWriteFunctionGrant {
  functionName: string;
  argumentTypes: ["text"];
  purpose: "immutable_json_constraint_helper";
}

export interface PostgresTenantQueueWriteManifest {
  contractVersion: typeof POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  tenantSessionContractVersion: typeof POSTGRES_TENANT_SESSION_CONTRACT_VERSION;
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  writeRoleNamespace: string;
  tenantSessionManifestFingerprint: string;
  tenantSessionRoleName: string;
  writeRole: {
    kind: "tenant_queue_writer";
    name: string;
    tableGrants: PostgresTenantQueueWriteTableGrant[];
    functionGrants: PostgresTenantQueueWriteFunctionGrant[];
    login: false;
    inherit: false;
    bypassRls: false;
    deleteAccess: false;
    truncateAccess: false;
    referencesAccess: false;
    triggerAccess: false;
  };
  tableCount: 5;
  grantCount: 12;
  functionGrantCount: 3;
  constraintHelperFunctionCount: 1;
  restrictivePolicyCount: 4;
  activePrincipalCount: 0;
  handlerRepositoryParity: false;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresTenantQueueWriteQualificationReceipt {
  contractVersion: typeof POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  tenantSessionContractVersion: typeof POSTGRES_TENANT_SESSION_CONTRACT_VERSION;
  phase: "verified";
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  writeRoleNamespace: string;
  roleManifestFingerprint: string;
  tenantSessionManifestFingerprint: string;
  writeRoleName: string;
  tableCount: 5;
  grantCount: 12;
  functionGrantCount: 3;
  constraintHelperFunctionCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  restrictivePolicyCount: 4;
  boundaryCatalogFingerprint: string;
  readCommittedTransactions: true;
  serverBoundRestrictivePolicies: true;
  effectivePrivilegeVerification: true;
  deleteAccess: false;
  principalProvisioningImplemented: false;
  handlerRepositoryParity: false;
  runtimeAuthority: false;
  productionReady: false;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresTenantQueueWriteCapabilityProjection {
  contractVersion: typeof POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  tenantSessionContractVersion: typeof POSTGRES_TENANT_SESSION_CONTRACT_VERSION;
  deterministicManifestImplemented: true;
  atomicQualificationApplyImplemented: true;
  exactEffectivePrivilegeVerification: true;
  immutableBoundaryCatalogFingerprint: true;
  qualificationSuiteParity: true;
  noLogin: true;
  noInherit: true;
  noBypassRls: true;
  serverBoundRestrictivePolicies: true;
  readCommittedTransactionAdapter: true;
  nativeTwoPrincipalWriteIsolationQualified: true;
  queueStoreRepositoryParity: true;
  atomicDeploymentAttestationAndQueueWrite: true;
  controlRepositoryParity: false;
  tableCount: 5;
  grantCount: 12;
  functionGrantCount: 3;
  constraintHelperFunctionCount: 1;
  insertTableCount: 4;
  updateTableCount: 3;
  deleteTableCount: 0;
  activePrincipalCount: 0;
  principalProvisioningImplemented: false;
  handlerRepositoryParity: false;
  activeRuntimeRoleApplied: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface NodePostgresTenantQueueWriteDatabaseOptions {
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

interface GrantRow extends Record<string, unknown> {
  table_name: string;
  privilege_type: string;
  is_grantable: string;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  tenant_session_contract_version: string | number | bigint;
  phase: string;
  read_role_namespace: string;
  session_role_namespace: string;
  write_role_namespace: string;
  role_manifest_fingerprint: string;
  tenant_session_manifest_fingerprint: string;
  write_role_name: string;
  table_count: string | number | bigint;
  grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  constraint_helper_function_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  restrictive_policy_count: string | number | bigint;
  boundary_catalog_fingerprint: string;
  read_committed_transactions: boolean;
  server_bound_restrictive_policies: boolean;
  effective_privilege_verification: boolean;
  delete_access: boolean;
  principal_provisioning_implemented: boolean;
  handler_repository_parity: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  applied_at: string;
  verified_at: string;
}

interface BoundaryInspection {
  tableCount: number;
  grantCount: number;
  functionGrantCount: number;
  membershipCount: number;
  activePrincipalCount: number;
  restrictivePolicyCount: number;
  boundaryCatalogFingerprint: string;
}

interface BindingRow extends Record<string, unknown> {
  tenantId: string;
  userId: string;
}

const TABLE_GRANTS: ReadonlyArray<{
  readonly tableName: string;
  readonly privileges: readonly QueueWritePrivilege[];
}> = Object.freeze([
  Object.freeze({
    tableName: "background_task_schedules",
    privileges: Object.freeze(["SELECT", "INSERT", "UPDATE"] as const)
  }),
  Object.freeze({
    tableName: "background_tasks",
    privileges: Object.freeze(["SELECT", "INSERT", "UPDATE"] as const)
  }),
  Object.freeze({
    tableName: "background_task_events",
    privileges: Object.freeze(["SELECT", "INSERT"] as const)
  }),
  Object.freeze({
    tableName: "background_worker_heartbeats",
    privileges: Object.freeze(["SELECT", "INSERT", "UPDATE"] as const)
  }),
  Object.freeze({
    tableName: "background_worker_deployment_expectations",
    privileges: Object.freeze(["SELECT"] as const)
  })
]);

const TENANT_QUEUE_TABLES = new Set([
  "background_task_schedules",
  "background_tasks",
  "background_task_events",
  "background_worker_heartbeats"
]);

let cachedCapabilityProjection: PostgresTenantQueueWriteCapabilityProjection | null = null;

export class PostgresTenantQueueWriteQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresTenantQueueWriteQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresTenantQueueWriteQualificationError("The PostgreSQL tenant queue-write schema is invalid.");
  }
  return normalized;
}

function roleNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write role namespace must contain 3 through 32 lowercase letters, numbers, or underscores."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_tenant_queue_writer`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write role name exceeds 63 bytes."
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

function policyName(tableName: string): string {
  const base = `yoink_server_queue_write_${tableName}`;
  if (Buffer.byteLength(base, "utf8") <= 63) return base;
  const suffix = createHash("sha256").update(base).digest("hex").slice(0, 12);
  return `${base.slice(0, 50)}_${suffix}`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresTenantQueueWriteQualificationError(
      `The PostgreSQL tenant queue-write ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresTenantQueueWriteQualificationError(
      `The PostgreSQL tenant queue-write ${label} is out of range.`
    );
  }
  return parsed;
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresTenantQueueWriteQualificationError(
      `The PostgreSQL tenant queue-write ${label} is invalid.`
    );
  }
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresTenantQueueWriteQualificationError(
      `The PostgreSQL tenant queue-write ${label} is invalid.`
    );
  }
  return normalized;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function cloneTableGrants(): PostgresTenantQueueWriteTableGrant[] {
  return TABLE_GRANTS.map((grant) => ({
    tableName: grant.tableName,
    privileges: [...grant.privileges]
  }));
}

function constraintFunctionGrants(): PostgresTenantQueueWriteFunctionGrant[] {
  return [{
    functionName: POSTGRES_JSON_VALID_FUNCTION,
    argumentTypes: ["text"],
    purpose: "immutable_json_constraint_helper"
  }];
}

export function buildPostgresTenantQueueWriteManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedWriteRoleNamespace = "yoink_queue_write_qualification"
): PostgresTenantQueueWriteManifest {
  const schema = schemaName(requestedSchema);
  const readNamespace = roleNamespace(requestedReadRoleNamespace, "yoink_qualification");
  const sessionNamespace = roleNamespace(requestedSessionRoleNamespace, "yoink_session_qualification");
  const writeNamespace = roleNamespace(requestedWriteRoleNamespace, "yoink_queue_write_qualification");
  if (new Set([readNamespace, sessionNamespace, writeNamespace]).size !== 3) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL read, session, and queue-write namespaces must be distinct."
    );
  }
  const sessionManifest = buildPostgresTenantSessionManifest(
    schema,
    readNamespace,
    sessionNamespace
  );
  const withoutFingerprint: Omit<PostgresTenantQueueWriteManifest, "fingerprint"> = {
    contractVersion: POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    tenantSessionContractVersion: POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
    schemaName: schema,
    readRoleNamespace: readNamespace,
    sessionRoleNamespace: sessionNamespace,
    writeRoleNamespace: writeNamespace,
    tenantSessionManifestFingerprint: sessionManifest.fingerprint,
    tenantSessionRoleName: sessionManifest.sessionRole.name,
    writeRole: {
      kind: "tenant_queue_writer",
      name: roleName(writeNamespace),
      tableGrants: cloneTableGrants(),
      functionGrants: constraintFunctionGrants(),
      login: false,
      inherit: false,
      bypassRls: false,
      deleteAccess: false,
      truncateAccess: false,
      referencesAccess: false,
      triggerAccess: false
    },
    tableCount: 5,
    grantCount: 12,
    functionGrantCount: 3,
    constraintHelperFunctionCount: 1,
    restrictivePolicyCount: 4,
    activePrincipalCount: 0,
    handlerRepositoryParity: false,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresTenantQueueWriteCapabilityProjection(): PostgresTenantQueueWriteCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresTenantQueueWriteManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    tenantSessionContractVersion: POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactEffectivePrivilegeVerification: true,
    immutableBoundaryCatalogFingerprint: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    serverBoundRestrictivePolicies: true,
    readCommittedTransactionAdapter: true,
    nativeTwoPrincipalWriteIsolationQualified: true,
    queueStoreRepositoryParity: true,
    atomicDeploymentAttestationAndQueueWrite: true,
    controlRepositoryParity: false,
    tableCount: manifest.tableCount,
    grantCount: manifest.grantCount,
    functionGrantCount: manifest.functionGrantCount,
    constraintHelperFunctionCount: manifest.constraintHelperFunctionCount,
    insertTableCount: 4,
    updateTableCount: 3,
    deleteTableCount: 0,
    activePrincipalCount: 0,
    principalProvisioningImplemented: false,
    handlerRepositoryParity: false,
    activeRuntimeRoleApplied: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresTenantQueueWriteManifest
): Promise<BoundaryInspection> {
  const role = manifest.writeRole.name;
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
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write role is missing or has an unsafe role attribute."
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
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write role must not have an active membership."
    );
  }

  const grants = await session.query<GrantRow>(
    `SELECT table_name, privilege_type, is_grantable
     FROM information_schema.role_table_grants
     WHERE table_schema = $1 AND grantee = $2
     ORDER BY table_name, privilege_type`,
    [manifest.schemaName, role]
  );
  const expectedGrants = new Set(manifest.writeRole.tableGrants.flatMap((grant) =>
    grant.privileges.map((privilege) => `${grant.tableName}:${privilege}:NO`)));
  const actualGrants = new Set(grants.rows.map((grant) =>
    `${grant.table_name}:${grant.privilege_type}:${grant.is_grantable}`));
  if (actualGrants.size !== expectedGrants.size
    || [...actualGrants].some((grant) => !expectedGrants.has(grant))) {
    throw new PostgresTenantQueueWriteQualificationError(
      "PostgreSQL tenant queue-write grants differ from the deterministic manifest."
    );
  }

  const privilegeByTable = new Map(manifest.writeRole.tableGrants.map((grant) =>
    [grant.tableName, new Set(grant.privileges)]));
  const effective = await session.query<{
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
  if (effective.rows.some((row) => {
    const expected = privilegeByTable.get(row.tableName) ?? new Set<QueueWritePrivilege>();
    return row.maySelect !== expected.has("SELECT")
      || row.mayInsert !== expected.has("INSERT")
      || row.mayUpdate !== expected.has("UPDATE")
      || row.mayDelete || row.mayEscalate;
  })) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write role has an unauthorized effective table privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write role has an invalid schema privilege."
    );
  }

  const expectedFunctionSpecs = new Map([
    [POSTGRES_TENANT_SESSION_BINDER_FUNCTION, {
      argumentCount: 0,
      identityArguments: "",
      securityDefiner: true,
      volatility: "v",
      strict: false,
      configuration: ["search_path=pg_catalog"]
    }],
    [POSTGRES_TENANT_SESSION_SCOPE_FUNCTION, {
      argumentCount: 0,
      identityArguments: "",
      securityDefiner: true,
      volatility: "s",
      strict: false,
      configuration: ["search_path=pg_catalog"]
    }],
    [POSTGRES_JSON_VALID_FUNCTION, {
      argumentCount: 1,
      identityArguments: "value text",
      securityDefiner: false,
      volatility: "i",
      strict: true,
      configuration: []
    }]
  ]);
  const expectedFunctions = [...expectedFunctionSpecs.keys()].sort();
  const functions = await session.query<{
    functionName: string;
    ownerName: string;
    languageName: string;
    securityDefiner: boolean;
    argumentCount: string | number | bigint;
    identityArguments: string;
    volatility: string;
    strict: boolean;
    configuration: string[];
    definition: string;
    publicMayExecute: boolean;
  }>(
    `SELECT routine.proname AS "functionName", owner_role.rolname AS "ownerName",
            language.lanname AS "languageName", routine.prosecdef AS "securityDefiner",
            routine.pronargs AS "argumentCount",
            pg_catalog.pg_get_function_identity_arguments(routine.oid) AS "identityArguments",
            routine.provolatile AS volatility, routine.proisstrict AS strict,
            COALESCE(routine.proconfig, ARRAY[]::text[]) AS configuration,
            pg_catalog.pg_get_functiondef(routine.oid) AS definition,
            COALESCE(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), FALSE) AS "publicMayExecute"
     FROM pg_catalog.pg_proc routine
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
     JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = routine.proowner
     JOIN pg_catalog.pg_language language ON language.oid = routine.prolang
     CROSS JOIN LATERAL aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl
     WHERE namespace.nspname = $1 AND has_function_privilege($2, routine.oid, 'EXECUTE')
     GROUP BY routine.oid, routine.proname, owner_role.rolname, language.lanname,
              routine.prosecdef, routine.pronargs, routine.proconfig,
              routine.provolatile, routine.proisstrict
     ORDER BY routine.proname`,
    [manifest.schemaName, role]
  );
  if (functions.rows.length !== manifest.functionGrantCount
    || functions.rows.map((row) => row.functionName).join(",") !== expectedFunctions.join(",")
    || functions.rows.some((row) => {
      const expected = expectedFunctionSpecs.get(row.functionName);
      return !expected || row.languageName !== "plpgsql"
        || row.securityDefiner !== expected.securityDefiner
        || exactInteger(row.argumentCount, "boundary-function argument count") !== expected.argumentCount
        || row.identityArguments !== expected.identityArguments
        || row.volatility !== expected.volatility || row.strict !== expected.strict
        || row.configuration.join(",") !== expected.configuration.join(",")
        || row.publicMayExecute;
    })) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write function boundary is incomplete."
    );
  }

  const sequences = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_class sequence
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = sequence.relnamespace
     WHERE namespace.nspname = $1 AND sequence.relkind = 'S'
       AND (has_sequence_privilege($2, sequence.oid, 'USAGE')
         OR has_sequence_privilege($2, sequence.oid, 'SELECT')
         OR has_sequence_privilege($2, sequence.oid, 'UPDATE'))`,
    [manifest.schemaName, role]
  );
  if (exactInteger(sequences.rows[0]?.count, "accessible sequence count") !== 0) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write role must not access application-schema sequences."
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
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write role must not own application-schema objects."
    );
  }

  const expectedPolicies = new Map(manifest.writeRole.tableGrants
    .filter((grant) => TENANT_QUEUE_TABLES.has(grant.tableName))
    .map((grant) => [policyName(grant.tableName), grant.tableName]));
  const policies = await session.query<{
    policyName: string;
    tableName: string;
    permissive: string;
    roleCount: string | number | bigint;
    roleName: string;
    command: string;
    usingExpression: string | null;
    checkExpression: string | null;
  }>(
    `SELECT policyname AS "policyName", tablename AS "tableName", permissive,
            cardinality(roles) AS "roleCount", roles[1]::text AS "roleName",
            cmd AS command, qual AS "usingExpression", with_check AS "checkExpression"
     FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND policyname = ANY($2::text[])
     ORDER BY policyname`,
    [manifest.schemaName, [...expectedPolicies.keys()]]
  );
  if (policies.rows.length !== manifest.restrictivePolicyCount
    || policies.rows.some((policy) => policy.permissive !== "RESTRICTIVE"
      || exactInteger(policy.roleCount, "restrictive-policy role count") !== 1
      || policy.roleName !== role || policy.command !== "ALL"
      || !policy.usingExpression || policy.usingExpression !== policy.checkExpression
      || expectedPolicies.get(policy.policyName) !== policy.tableName)) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write restrictive policy surface is incomplete."
    );
  }

  const rlsTables = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(DISTINCT relation.oid) AS count
     FROM pg_catalog.pg_policies policy
     JOIN pg_catalog.pg_class relation ON relation.relname = policy.tablename
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
       AND namespace.nspname = policy.schemaname
     WHERE policy.schemaname = $1
       AND relation.relrowsecurity = TRUE AND relation.relforcerowsecurity = TRUE`,
    [manifest.schemaName]
  );
  if (exactInteger(rlsTables.rows[0]?.count, "tenant RLS table count") !== 83) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write RLS table surface is incomplete."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresTenantQueueWriteQualificationError(
      "Tenant queue-write qualification cannot activate a runtime principal."
    );
  }

  return {
    tableCount: privilegeByTable.size,
    grantCount: grants.rows.length,
    functionGrantCount: functions.rows.length,
    membershipCount,
    activePrincipalCount,
    restrictivePolicyCount: policies.rows.length,
    boundaryCatalogFingerprint: fingerprint({
      grants: grants.rows,
      functions: functions.rows.map((row) => ({
        name: row.functionName,
        owner: row.ownerName,
        language: row.languageName,
        securityDefiner: row.securityDefiner,
        argumentCount: exactInteger(row.argumentCount, "boundary-function argument count"),
        identityArguments: row.identityArguments,
        volatility: row.volatility,
        strict: row.strict,
        configuration: row.configuration,
        definition: row.definition
      })),
      policies: policies.rows.map((policy) => ({
        name: policy.policyName,
        table: policy.tableName,
        permissive: policy.permissive,
        role: policy.roleName,
        command: policy.command,
        usingExpression: policy.usingExpression,
        checkExpression: policy.checkExpression
      }))
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresTenantQueueWriteManifest
): PostgresTenantQueueWriteQualificationReceipt {
  if (row.phase !== "verified"
    || row.read_role_namespace !== manifest.readRoleNamespace
    || row.session_role_namespace !== manifest.sessionRoleNamespace
    || row.write_role_namespace !== manifest.writeRoleNamespace
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.tenant_session_manifest_fingerprint !== manifest.tenantSessionManifestFingerprint
    || row.write_role_name !== manifest.writeRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.read_committed_transactions !== true
    || row.server_bound_restrictive_policies !== true
    || row.effective_privilege_verification !== true
    || row.delete_access !== false
    || row.principal_provisioning_implemented !== false
    || row.handler_repository_parity !== false
    || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write receipt is incomplete or unsafe."
    );
  }
  if (exactInteger(row.contract_version, "contract version") !== POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION
    || exactInteger(row.cutover_contract_version, "cutover contract version") !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || exactInteger(row.tenant_session_contract_version, "tenant-session contract version")
      !== POSTGRES_TENANT_SESSION_CONTRACT_VERSION
    || exactInteger(row.table_count, "table count") !== manifest.tableCount
    || exactInteger(row.grant_count, "grant count") !== manifest.grantCount
    || exactInteger(row.function_grant_count, "function grant count") !== manifest.functionGrantCount
    || exactInteger(row.constraint_helper_function_count, "constraint-helper function count")
      !== manifest.constraintHelperFunctionCount
    || exactInteger(row.membership_count, "membership count") !== 0
    || exactInteger(row.active_principal_count, "active principal count") !== 0
    || exactInteger(row.restrictive_policy_count, "restrictive policy count")
      !== manifest.restrictivePolicyCount) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write receipt uses an unsupported or active contract."
    );
  }
  return {
    contractVersion: POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    tenantSessionContractVersion: POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
    phase: "verified",
    schemaName: manifest.schemaName,
    readRoleNamespace: manifest.readRoleNamespace,
    sessionRoleNamespace: manifest.sessionRoleNamespace,
    writeRoleNamespace: manifest.writeRoleNamespace,
    roleManifestFingerprint: manifest.fingerprint,
    tenantSessionManifestFingerprint: manifest.tenantSessionManifestFingerprint,
    writeRoleName: manifest.writeRole.name,
    tableCount: 5,
    grantCount: 12,
    functionGrantCount: 3,
    constraintHelperFunctionCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    restrictivePolicyCount: 4,
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    readCommittedTransactions: true,
    serverBoundRestrictivePolicies: true,
    effectivePrivilegeVerification: true,
    deleteAccess: false,
    principalProvisioningImplemented: false,
    handlerRepositoryParity: false,
    runtimeAuthority: false,
    productionReady: false,
    appliedAt: timestamp(row.applied_at, "application timestamp"),
    verifiedAt: timestamp(row.verified_at, "verification timestamp")
  };
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresTenantQueueWriteManifest
): Promise<PostgresTenantQueueWriteQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_TENANT_QUEUE_WRITE_RECEIPT_TABLE)}
     WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresTenantQueueWriteQualificationReceipt,
  manifest: PostgresTenantQueueWriteManifest
): void {
  if (inspection.tableCount !== receipt.tableCount
    || inspection.grantCount !== receipt.grantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.restrictivePolicyCount !== receipt.restrictivePolicyCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresTenantQueueWriteQualificationError(
      "The PostgreSQL tenant queue-write boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresTenantQueueWriteBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedWriteRoleNamespace = "yoink_queue_write_qualification"
): Promise<PostgresTenantQueueWriteQualificationReceipt> {
  const manifest = buildPostgresTenantQueueWriteManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedWriteRoleNamespace
  );
  await verifyPostgresTenantSessionBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresTenantQueueWriteBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedWriteRoleNamespace = "yoink_queue_write_qualification",
  now = Date.now()
): Promise<PostgresTenantQueueWriteQualificationReceipt> {
  const manifest = buildPostgresTenantQueueWriteManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedWriteRoleNamespace
  );
  await verifyPostgresTenantSessionBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls
    || preflight.serverVersionMajor < 15) {
    throw new PostgresTenantQueueWriteQualificationError(
      "Tenant queue-write qualification requires PostgreSQL 15+ and the cutover/control role."
    );
  }
  const authority = await database.query<{ rolcreaterole: boolean; rolsuper: boolean }>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresTenantQueueWriteQualificationError(
      "Tenant queue-write qualification requires temporary CREATEROLE authority."
    );
  }
  const appliedAt = nowIso(now);
  return database.transaction(async (session) => {
    const existing = await session.query<{ count: string | number | bigint }>(
      `SELECT (
         SELECT COUNT(*) FROM pg_catalog.pg_roles WHERE rolname = $1
       ) + (
         SELECT COUNT(*) FROM information_schema.tables
         WHERE table_schema = $2 AND table_name = $3
       ) + (
         SELECT COUNT(*) FROM information_schema.routines
         WHERE routine_schema = $2 AND routine_name = $4
       ) + (
         SELECT COUNT(*) FROM pg_catalog.pg_policies
         WHERE schemaname = $2 AND policyname = ANY($5::text[])
       ) AS count`,
      [
        manifest.writeRole.name,
        manifest.schemaName,
        POSTGRES_TENANT_QUEUE_WRITE_RECEIPT_TABLE,
        "yoink_tenant_queue_write_receipt_guard",
        manifest.writeRole.tableGrants
          .filter((grant) => TENANT_QUEUE_TABLES.has(grant.tableName))
          .map((grant) => policyName(grant.tableName))
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing boundary object count") !== 0) {
      throw new PostgresTenantQueueWriteQualificationError(
        "Tenant queue-write qualification refuses an existing role, policy, guard, or receipt."
      );
    }

    await session.query(
      `CREATE ROLE ${identifier(manifest.writeRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)} TO ${identifier(manifest.writeRole.name)}`
    );
    for (const grant of manifest.writeRole.tableGrants) {
      await session.query(
        `GRANT ${grant.privileges.join(", ")} ON ${relation(manifest.schemaName, grant.tableName)}
         TO ${identifier(manifest.writeRole.name)}`
      );
    }
    for (const functionName of [
      POSTGRES_TENANT_SESSION_BINDER_FUNCTION,
      POSTGRES_TENANT_SESSION_SCOPE_FUNCTION
    ]) {
      await session.query(
        `GRANT EXECUTE ON FUNCTION ${relation(manifest.schemaName, functionName)}()
         TO ${identifier(manifest.writeRole.name)}`
      );
    }
    for (const grant of manifest.writeRole.functionGrants) {
      await session.query(
        `GRANT EXECUTE ON FUNCTION
         ${relation(manifest.schemaName, grant.functionName)}(${grant.argumentTypes.join(", ")})
         TO ${identifier(manifest.writeRole.name)}`
      );
    }

    const schemaManifest = buildPostgresSchemaManifest();
    const tableByName = new Map(schemaManifest.tables.map((table) => [table.name, table]));
    const tenantExpression = `${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_SCOPE_FUNCTION)}()`;
    for (const grant of manifest.writeRole.tableGrants
      .filter((candidate) => TENANT_QUEUE_TABLES.has(candidate.tableName))) {
      const table = tableByName.get(grant.tableName);
      if (!table) {
        throw new PostgresTenantQueueWriteQualificationError(
          `Tenant queue-write policy table ${grant.tableName} is absent from the schema manifest.`
        );
      }
      const condition = buildPostgresServerBoundTenantCondition(
        manifest.schemaName,
        table,
        tenantExpression
      );
      await session.query(
        `CREATE POLICY ${identifier(policyName(grant.tableName))}
         ON ${relation(manifest.schemaName, grant.tableName)} AS RESTRICTIVE FOR ALL
         TO ${identifier(manifest.writeRole.name)}
         USING (${condition}) WITH CHECK (${condition})`
      );
    }

    await session.query(`CREATE TABLE ${relation(manifest.schemaName, POSTGRES_TENANT_QUEUE_WRITE_RECEIPT_TABLE)} (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      contract_version BIGINT NOT NULL CHECK (contract_version = ${POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION}),
      cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = ${POSTGRES_CUTOVER_CONTRACT_VERSION}),
      tenant_session_contract_version BIGINT NOT NULL CHECK (
        tenant_session_contract_version = ${POSTGRES_TENANT_SESSION_CONTRACT_VERSION}
      ),
      phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
      read_role_namespace TEXT NOT NULL,
      session_role_namespace TEXT NOT NULL,
      write_role_namespace TEXT NOT NULL,
      role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
      tenant_session_manifest_fingerprint TEXT NOT NULL CHECK (
        tenant_session_manifest_fingerprint ~ '^[a-f0-9]{64}$'
      ),
      write_role_name TEXT NOT NULL,
      table_count BIGINT NOT NULL,
      grant_count BIGINT NOT NULL,
      function_grant_count BIGINT NOT NULL,
      constraint_helper_function_count BIGINT NOT NULL,
      membership_count BIGINT NOT NULL CHECK (membership_count = 0),
      active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
      restrictive_policy_count BIGINT NOT NULL,
      boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
      read_committed_transactions BOOLEAN NOT NULL DEFAULT TRUE CHECK (read_committed_transactions = TRUE),
      server_bound_restrictive_policies BOOLEAN NOT NULL DEFAULT TRUE CHECK (
        server_bound_restrictive_policies = TRUE
      ),
      effective_privilege_verification BOOLEAN NOT NULL DEFAULT TRUE CHECK (
        effective_privilege_verification = TRUE
      ),
      delete_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (delete_access = FALSE),
      principal_provisioning_implemented BOOLEAN NOT NULL DEFAULT FALSE CHECK (
        principal_provisioning_implemented = FALSE
      ),
      handler_repository_parity BOOLEAN NOT NULL DEFAULT FALSE CHECK (handler_repository_parity = FALSE),
      runtime_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (runtime_authority = FALSE),
      production_ready BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_ready = FALSE),
      applied_at TEXT NOT NULL,
      verified_at TEXT NOT NULL DEFAULT ''
    )`);
    await session.query(
      `REVOKE ALL PRIVILEGES ON ${relation(manifest.schemaName, POSTGRES_TENANT_QUEUE_WRITE_RECEIPT_TABLE)}
       FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_TENANT_QUEUE_WRITE_RECEIPT_TABLE)}(
         id, contract_version, cutover_contract_version, tenant_session_contract_version,
         phase, read_role_namespace, session_role_namespace, write_role_namespace,
         role_manifest_fingerprint, tenant_session_manifest_fingerprint, write_role_name,
         table_count, grant_count, function_grant_count, constraint_helper_function_count,
         membership_count, active_principal_count,
         restrictive_policy_count, boundary_catalog_fingerprint, applied_at
       ) VALUES ('active', $1, $2, $3, 'loading', $4, $5, $6, $7, $8, $9,
                 0, 0, 0, 0, 0, 0, 0, repeat('0', 64), $10)`,
      [
        POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
        POSTGRES_CUTOVER_CONTRACT_VERSION,
        POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
        manifest.readRoleNamespace,
        manifest.sessionRoleNamespace,
        manifest.writeRoleNamespace,
        manifest.fingerprint,
        manifest.tenantSessionManifestFingerprint,
        manifest.writeRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_TENANT_QUEUE_WRITE_RECEIPT_TABLE)}
       SET phase = 'verified', table_count = $1, grant_count = $2,
           function_grant_count = $3, constraint_helper_function_count = $4,
           membership_count = $5, active_principal_count = $6, restrictive_policy_count = $7,
           boundary_catalog_fingerprint = $8, verified_at = $9
       WHERE id = 'active' AND phase = 'loading'`,
      [
        inspection.tableCount,
        inspection.grantCount,
        inspection.functionGrantCount,
        manifest.constraintHelperFunctionCount,
        inspection.membershipCount,
        inspection.activePrincipalCount,
        inspection.restrictivePolicyCount,
        inspection.boundaryCatalogFingerprint,
        verifiedAt
      ]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_tenant_queue_write_receipt_guard")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO ${identifier(manifest.schemaName)}, pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'tenant queue-write receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_tenant_queue_write_receipt_guard")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_tenant_queue_write_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(manifest.schemaName, POSTGRES_TENANT_QUEUE_WRITE_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_tenant_queue_write_receipt_guard")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

class TenantQueueWriteSession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresTenantQueueWriteDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresTenantQueueWriteManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
    requestedReadRoleNamespace = "yoink_qualification",
    requestedSessionRoleNamespace = "yoink_session_qualification",
    requestedWriteRoleNamespace = "yoink_queue_write_qualification",
    options: NodePostgresTenantQueueWriteDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresTenantQueueWriteManifest(
      requestedSchema,
      requestedReadRoleNamespace,
      requestedSessionRoleNamespace,
      requestedWriteRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 2;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresTenantQueueWriteQualificationError(
        "The PostgreSQL tenant queue-write connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_tenant_queue_write_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async writeTransaction<T>(
    expectedPrincipal: PostgresTenantSessionPrincipal,
    operation: (session: PostgresQuerySession) => Promise<T>
  ): Promise<T> {
    const expected = {
      tenantId: principalId(expectedPrincipal.tenantId, "expected tenant ID"),
      userId: principalId(expectedPrincipal.userId, "expected user ID")
    };
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.writeRole.name)}`);
      const binding = await client.query<BindingRow>(
        `SELECT tenant_id AS "tenantId", user_id AS "userId"
         FROM ${relation(this.manifest.schemaName, POSTGRES_TENANT_SESSION_BINDER_FUNCTION)}()`
      );
      const row = binding.rows[0];
      if (binding.rows.length !== 1 || !row
        || row.tenantId !== expected.tenantId || row.userId !== expected.userId) {
        throw new PostgresTenantQueueWriteQualificationError(
          "The server-bound PostgreSQL queue-write session does not match the expected authenticated principal."
        );
      }
      const result = await operation(new TenantQueueWriteSession(client));
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
