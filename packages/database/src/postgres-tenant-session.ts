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
import {
  POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
  POSTGRES_RUNTIME_READ_ROLE_RECEIPT_TABLE,
  buildPostgresRuntimeReadRoleManifest,
  verifyPostgresRuntimeReadRoles
} from "./postgres-runtime-roles.js";
import { canonicalPortabilityJson } from "./portability.js";
import {
  buildPostgresSchemaManifest,
  type PostgresTableSchemaDescriptor
} from "./postgres-schema-manifest.js";

export const POSTGRES_TENANT_SESSION_CONTRACT_VERSION = 1;
export const POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE = "yoink_tenant_session_principals";
export const POSTGRES_TENANT_SESSION_RECEIPT_TABLE = "yoink_tenant_session_receipt";
export const POSTGRES_TENANT_SESSION_BINDER_FUNCTION = "yoink_bind_tenant_session";
export const POSTGRES_TENANT_SESSION_SCOPE_FUNCTION = "yoink_tenant_session_scope";

const TENANT_PARAMETER = "yoink.tenant_id";
const USER_PARAMETER = "yoink.user_id";
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const SAFE_PRINCIPAL_ROLE = /^[a-z][a-z0-9_]{2,62}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;

export interface PostgresTenantSessionRoleDescriptor {
  kind: "tenant_session_reader";
  name: string;
  tableNames: string[];
  privileges: ["SELECT"];
  login: false;
  inherit: false;
  bypassRls: false;
  writeAccess: false;
  directParameterSetPrevented: false;
  directParameterScopeExpansionPrevented: true;
}

export interface PostgresTenantSessionManifest {
  contractVersion: typeof POSTGRES_TENANT_SESSION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  runtimeReadRoleContractVersion: typeof POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION;
  schemaName: string;
  readRoleNamespace: string;
  roleNamespace: string;
  runtimeReadRoleManifestFingerprint: string;
  sessionRole: PostgresTenantSessionRoleDescriptor;
  principalTableName: typeof POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE;
  receiptTableName: typeof POSTGRES_TENANT_SESSION_RECEIPT_TABLE;
  binderFunctionName: typeof POSTGRES_TENANT_SESSION_BINDER_FUNCTION;
  scopeFunctionName: typeof POSTGRES_TENANT_SESSION_SCOPE_FUNCTION;
  parameterNames: [typeof TENANT_PARAMETER, typeof USER_PARAMETER];
  tenantRlsTableCount: number;
  restrictivePolicyCount: number;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresTenantSessionQualificationReceipt {
  contractVersion: typeof POSTGRES_TENANT_SESSION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  runtimeReadRoleContractVersion: typeof POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION;
  phase: "verified";
  schemaName: string;
  readRoleNamespace: string;
  roleNamespace: string;
  roleManifestFingerprint: string;
  runtimeReadRoleManifestFingerprint: string;
  sessionRoleName: string;
  tenantRlsTableCount: number;
  grantCount: number;
  membershipCount: 0;
  activePrincipalCount: 0;
  parameterCount: 2;
  restrictivePolicyCount: number;
  boundaryCatalogFingerprint: string;
  directParameterSetPrevented: false;
  directParameterScopeExpansionPrevented: true;
  serverBoundRestrictivePolicies: true;
  zeroArgumentSecurityDefinerBinder: true;
  transactionLocalBinding: true;
  readOnly: true;
  principalProvisioningImplemented: false;
  productionIdentityQualified: false;
  runtimeAuthority: false;
  productionReady: false;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresTenantSessionCapabilityProjection {
  contractVersion: typeof POSTGRES_TENANT_SESSION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  runtimeReadRoleContractVersion: typeof POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION;
  deterministicManifestImplemented: true;
  atomicQualificationApplyImplemented: true;
  exactPrivilegeVerificationImplemented: true;
  qualificationSuiteParity: true;
  noLogin: true;
  noInherit: true;
  noBypassRls: true;
  serverOwnedPrincipalRegistry: true;
  zeroArgumentSecurityDefinerBinder: true;
  serverBoundRestrictivePolicies: true;
  directParameterSetPrevented: false;
  directParameterScopeExpansionPrevented: true;
  transactionLocalBinding: true;
  readOnlyTransactionAdapter: true;
  nativePostgresMajorVersion: 16;
  nativeTwoPrincipalIsolationQualified: true;
  tenantRlsTableCount: number;
  activePrincipalCount: 0;
  principalProvisioningImplemented: false;
  runtimeWriteRoleParity: false;
  productionIdentityQualified: false;
  activeRuntimeRoleApplied: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresTenantSessionPrincipal {
  tenantId: string;
  userId: string;
}

export interface NodePostgresTenantReadDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface RoleAuthorityRow extends Record<string, unknown> {
  rolcreaterole: boolean;
  rolsuper: boolean;
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
  runtime_read_role_contract_version: string | number | bigint;
  phase: string;
  read_role_namespace: string;
  role_namespace: string;
  role_manifest_fingerprint: string;
  runtime_read_role_manifest_fingerprint: string;
  session_role_name: string;
  tenant_rls_table_count: string | number | bigint;
  grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  parameter_count: string | number | bigint;
  restrictive_policy_count: string | number | bigint;
  boundary_catalog_fingerprint: string;
  direct_parameter_set_prevented: boolean;
  direct_parameter_scope_expansion_prevented: boolean;
  server_bound_restrictive_policies: boolean;
  zero_argument_security_definer_binder: boolean;
  transaction_local_binding: boolean;
  read_only: boolean;
  principal_provisioning_implemented: boolean;
  production_identity_qualified: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  applied_at: string;
  verified_at: string;
}

interface BindingRow extends Record<string, unknown> {
  tenantId: string;
  userId: string;
}

interface BoundaryInspection {
  tenantRlsTableCount: number;
  grantCount: number;
  membershipCount: number;
  activePrincipalCount: number;
  restrictivePolicyCount: number;
  boundaryCatalogFingerprint: string;
}

let cachedCapabilityProjection: PostgresTenantSessionCapabilityProjection | null = null;

export class PostgresTenantSessionQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresTenantSessionQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresTenantSessionQualificationError("The PostgreSQL tenant-session schema is invalid.");
  }
  return normalized;
}

function roleNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session role namespace must contain 3 through 32 lowercase letters, numbers, or underscores."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const name = `${namespace}_tenant_session_reader`;
  if (Buffer.byteLength(name, "utf8") > 63) {
    throw new PostgresTenantSessionQualificationError("The PostgreSQL tenant-session role name exceeds 63 bytes.");
  }
  return name;
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
    throw new PostgresTenantSessionQualificationError(`The PostgreSQL tenant-session ${label} is invalid.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresTenantSessionQualificationError(`The PostgreSQL tenant-session ${label} is out of range.`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresTenantSessionQualificationError(`The PostgreSQL tenant-session ${label} is invalid.`);
  }
  return normalized;
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresTenantSessionQualificationError(`The PostgreSQL tenant-session ${label} is invalid.`);
  }
  return normalized;
}

function manifestFingerprint(value: Omit<PostgresTenantSessionManifest, "fingerprint">): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function policyName(tableName: string): string {
  const base = `yoink_server_bound_${tableName}`;
  if (Buffer.byteLength(base, "utf8") <= 63) return base;
  const suffix = createHash("sha256").update(base).digest("hex").slice(0, 12);
  return `${base.slice(0, 50)}_${suffix}`;
}

function serverBoundTenantCondition(
  schema: string,
  table: PostgresTableSchemaDescriptor,
  tenantExpression: string
): string {
  if (table.tenantScopeKind === "direct") {
    return `${identifier("tenant_id")} = ${tenantExpression}`;
  }
  if (!(table.tenantScopeKind === "inherited" || table.tenantScopeKind === "mixed")) {
    throw new PostgresTenantSessionQualificationError(
      `Table ${table.name} is not eligible for a tenant-session restrictive policy.`
    );
  }
  const condition = table.tenantOwnershipEdges.map((edge, index) => {
    const alias = `yoink_session_owner_${index + 1}`;
    const childColumns = edge.columns.map((column) =>
      `${identifier(table.name)}.${identifier(column.from)}`);
    const joins = edge.columns.map((column) =>
      `${identifier(alias)}.${identifier(column.to)} = ${identifier(table.name)}.${identifier(column.from)}`);
    const exists = `EXISTS (SELECT 1 FROM ${relation(schema, edge.targetTable)} AS ${identifier(alias)} `
      + `WHERE ${joins.join(" AND ")} AND ${identifier(alias)}.${identifier("tenant_id")} = ${tenantExpression})`;
    if (edge.requiredForOwnership) return exists;
    const allNull = childColumns.map((column) => `${column} IS NULL`).join(" AND ");
    const allPresent = childColumns.map((column) => `${column} IS NOT NULL`).join(" AND ");
    return `((${allNull}) OR ((${allPresent}) AND ${exists}))`;
  }).join(" AND ");
  if (!condition) {
    throw new PostgresTenantSessionQualificationError(
      `Table ${table.name} has no enforceable tenant-session ownership path.`
    );
  }
  return condition;
}

export function buildPostgresTenantSessionManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedRoleNamespace = "yoink_session_qualification"
): PostgresTenantSessionManifest {
  const schema = schemaName(requestedSchema);
  const readNamespace = roleNamespace(requestedReadRoleNamespace, "yoink_qualification");
  const namespace = roleNamespace(requestedRoleNamespace, "yoink_session_qualification");
  if (namespace === readNamespace) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session namespace must differ from the read-role template namespace."
    );
  }
  const readManifest = buildPostgresRuntimeReadRoleManifest(schema, readNamespace);
  const tenantTables = readManifest.roles.find((role) => role.kind === "tenant_reader")?.tableNames ?? [];
  if (tenantTables.length !== 82 || new Set(tenantTables).size !== tenantTables.length) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session table surface does not match the exact tenant RLS read contract."
    );
  }
  const withoutFingerprint: Omit<PostgresTenantSessionManifest, "fingerprint"> = {
    contractVersion: POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    runtimeReadRoleContractVersion: POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
    schemaName: schema,
    readRoleNamespace: readNamespace,
    roleNamespace: namespace,
    runtimeReadRoleManifestFingerprint: readManifest.fingerprint,
    sessionRole: {
      kind: "tenant_session_reader",
      name: roleName(namespace),
      tableNames: [...tenantTables],
      privileges: ["SELECT"],
      login: false,
      inherit: false,
      bypassRls: false,
      writeAccess: false,
      directParameterSetPrevented: false,
      directParameterScopeExpansionPrevented: true
    },
    principalTableName: POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE,
    receiptTableName: POSTGRES_TENANT_SESSION_RECEIPT_TABLE,
    binderFunctionName: POSTGRES_TENANT_SESSION_BINDER_FUNCTION,
    scopeFunctionName: POSTGRES_TENANT_SESSION_SCOPE_FUNCTION,
    parameterNames: [TENANT_PARAMETER, USER_PARAMETER],
    tenantRlsTableCount: tenantTables.length,
    restrictivePolicyCount: tenantTables.length,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: manifestFingerprint(withoutFingerprint) };
}

export function postgresTenantSessionCapabilityProjection(): PostgresTenantSessionCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresTenantSessionManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    runtimeReadRoleContractVersion: POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactPrivilegeVerificationImplemented: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    serverOwnedPrincipalRegistry: true,
    zeroArgumentSecurityDefinerBinder: true,
    serverBoundRestrictivePolicies: true,
    directParameterSetPrevented: false,
    directParameterScopeExpansionPrevented: true,
    transactionLocalBinding: true,
    readOnlyTransactionAdapter: true,
    nativePostgresMajorVersion: 16,
    nativeTwoPrincipalIsolationQualified: true,
    tenantRlsTableCount: manifest.tenantRlsTableCount,
    activePrincipalCount: 0,
    principalProvisioningImplemented: false,
    runtimeWriteRoleParity: false,
    productionIdentityQualified: false,
    activeRuntimeRoleApplied: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

async function assertReadRoleReceipt(
  session: PostgresQuerySession,
  manifest: PostgresTenantSessionManifest
): Promise<void> {
  const result = await session.query<{
    contract_version: string | number | bigint;
    cutover_contract_version: string | number | bigint;
    phase: string;
    role_namespace: string;
    role_manifest_fingerprint: string;
    read_only: boolean;
    runtime_authority: boolean;
    production_ready: boolean;
  }>(
    `SELECT contract_version, cutover_contract_version, phase, role_namespace,
            role_manifest_fingerprint, read_only, runtime_authority, production_ready
     FROM ${relation(manifest.schemaName, POSTGRES_RUNTIME_READ_ROLE_RECEIPT_TABLE)}
     WHERE id = 'active'`
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row
    || exactInteger(row.contract_version, "read-role contract version") !== POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION
    || exactInteger(row.cutover_contract_version, "cutover contract version") !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || row.phase !== "verified"
    || row.role_namespace !== manifest.readRoleNamespace
    || row.role_manifest_fingerprint !== manifest.runtimeReadRoleManifestFingerprint
    || row.read_only !== true
    || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresTenantSessionQualificationError(
      "Tenant-session qualification requires the exact current verified, inactive read-role receipt."
    );
  }
}

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresTenantSessionManifest
): Promise<BoundaryInspection> {
  const role = manifest.sessionRole.name;
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
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session role is missing or has an unsafe role attribute."
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
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session qualification role must not have active memberships."
    );
  }

  const grants = await session.query<GrantRow>(
    `SELECT table_name, privilege_type, is_grantable
     FROM information_schema.role_table_grants
     WHERE table_schema = $1 AND grantee = $2
     ORDER BY table_name, privilege_type`,
    [manifest.schemaName, role]
  );
  const expected = new Set(manifest.sessionRole.tableNames.map((table) => `${table}:SELECT:NO`));
  const actual = new Set(grants.rows.map((grant) =>
    `${grant.table_name}:${grant.privilege_type}:${grant.is_grantable}`));
  if (actual.size !== expected.size || [...actual].some((grant) => !expected.has(grant))) {
    throw new PostgresTenantSessionQualificationError(
      "PostgreSQL tenant-session grants differ from the deterministic read-only manifest."
    );
  }

  const columnGrants = await session.query<GrantRow>(
    `SELECT table_name, privilege_type, is_grantable
     FROM information_schema.role_column_grants
     WHERE table_schema = $1 AND grantee = $2
     ORDER BY table_name, column_name, privilege_type`,
    [manifest.schemaName, role]
  );
  if (columnGrants.rows.some((grant) => grant.privilege_type !== "SELECT"
    || grant.is_grantable !== "NO"
    || !manifest.sessionRole.tableNames.includes(grant.table_name))) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session role has an unauthorized column privilege."
    );
  }

  const effectiveTablePrivileges = await session.query<{
    tableName: string;
    maySelect: boolean;
    mayWrite: boolean;
  }>(
    `SELECT relation.relname AS "tableName",
            has_table_privilege($2, relation.oid, 'SELECT') AS "maySelect",
            (has_table_privilege($2, relation.oid, 'INSERT')
              OR has_table_privilege($2, relation.oid, 'UPDATE')
              OR has_table_privilege($2, relation.oid, 'DELETE')
              OR has_table_privilege($2, relation.oid, 'TRUNCATE')
              OR has_table_privilege($2, relation.oid, 'REFERENCES')
              OR has_table_privilege($2, relation.oid, 'TRIGGER')) AS "mayWrite"
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY relation.relname`,
    [manifest.schemaName, role]
  );
  const effectiveReads = new Set(effectiveTablePrivileges.rows
    .filter((row) => row.maySelect)
    .map((row) => row.tableName));
  if (effectiveReads.size !== expected.size
    || [...effectiveReads].some((table) => !manifest.sessionRole.tableNames.includes(table))
    || effectiveTablePrivileges.rows.some((row) => row.mayWrite)) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session role has an unauthorized effective table privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session role has an invalid schema privilege."
    );
  }

  const expectedFunctions = [manifest.binderFunctionName, manifest.scopeFunctionName].sort();
  const boundaryFunctions = await session.query<{
    functionName: string;
    securityDefiner: boolean;
    argumentCount: string | number | bigint;
    roleMayExecute: boolean;
    publicMayExecute: boolean;
    ownerName: string;
    languageName: string;
    configuration: string[];
    definition: string;
  }>(
    `SELECT routine.proname AS "functionName",
            routine.prosecdef AS "securityDefiner",
            routine.pronargs AS "argumentCount",
            has_function_privilege($1, routine.oid, 'EXECUTE') AS "roleMayExecute",
            COALESCE(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), FALSE) AS "publicMayExecute",
            owner_role.rolname AS "ownerName", language.lanname AS "languageName",
            COALESCE(routine.proconfig, ARRAY[]::text[]) AS configuration,
            pg_catalog.pg_get_functiondef(routine.oid) AS definition
     FROM pg_catalog.pg_proc routine
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
     JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = routine.proowner
     JOIN pg_catalog.pg_language language ON language.oid = routine.prolang
     CROSS JOIN LATERAL aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl
     WHERE namespace.nspname = $2 AND routine.proname = ANY($3::text[])
     GROUP BY routine.oid, routine.proname, routine.prosecdef, routine.pronargs,
              owner_role.rolname, language.lanname, routine.proconfig
     ORDER BY routine.proname`,
    [role, manifest.schemaName, expectedFunctions]
  );
  if (boundaryFunctions.rows.length !== 2
    || boundaryFunctions.rows.map((row) => row.functionName).join(",") !== expectedFunctions.join(",")
    || boundaryFunctions.rows.some((row) => row.securityDefiner !== true
      || exactInteger(row.argumentCount, "boundary-function argument count") !== 0
      || row.roleMayExecute !== true || row.publicMayExecute !== false
      || row.languageName !== "plpgsql"
      || row.configuration.length !== 1 || row.configuration[0] !== "search_path=pg_catalog")) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session binder or scope-function privilege boundary is incomplete."
    );
  }

  const otherExecutableRoutines = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_proc routine
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = $1 AND NOT (routine.proname = ANY($2::text[]))
       AND has_function_privilege($3, routine.oid, 'EXECUTE')`,
    [manifest.schemaName, expectedFunctions, role]
  );
  if (exactInteger(otherExecutableRoutines.rows[0]?.count, "unexpected executable routine count") !== 0) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session role can execute an unauthorized application routine."
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
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session role must not access application-schema sequences."
    );
  }

  const ownedObjects = await session.query<{ count: string | number | bigint }>(
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
  if (exactInteger(ownedObjects.rows[0]?.count, "owned object count") !== 0) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session role must not own application-schema objects."
    );
  }

  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(DISTINCT relation.oid) AS count
     FROM pg_catalog.pg_policies policy
     JOIN pg_catalog.pg_class relation ON relation.relname = policy.tablename
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
       AND namespace.nspname = policy.schemaname
     WHERE policy.schemaname = $1
       AND relation.relrowsecurity = TRUE AND relation.relforcerowsecurity = TRUE`,
    [manifest.schemaName]
  );
  const tenantRlsTableCount = exactInteger(policies.rows[0]?.count, "tenant RLS table count");
  if (tenantRlsTableCount !== manifest.tenantRlsTableCount) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session RLS surface does not match the current tenant read contract."
    );
  }

  const expectedPolicies = new Map(manifest.sessionRole.tableNames.map((table) => [policyName(table), table]));
  const restrictivePolicies = await session.query<{
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
  if (restrictivePolicies.rows.length !== manifest.restrictivePolicyCount
    || restrictivePolicies.rows.some((policy) => policy.permissive !== "RESTRICTIVE"
      || exactInteger(policy.roleCount, "restrictive-policy role count") !== 1
      || policy.roleName !== role
      || policy.command !== "ALL"
      || !policy.usingExpression || policy.usingExpression !== policy.checkExpression
      || expectedPolicies.get(policy.policyName) !== policy.tableName)) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL server-bound restrictive policy surface is incomplete."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM ${relation(manifest.schemaName, manifest.principalTableName)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresTenantSessionQualificationError(
      "Tenant-session qualification cannot activate a runtime principal."
    );
  }
  const boundaryCatalogFingerprint = createHash("sha256").update(canonicalPortabilityJson({
    functions: boundaryFunctions.rows.map((row) => ({
      name: row.functionName,
      owner: row.ownerName,
      language: row.languageName,
      securityDefiner: row.securityDefiner,
      argumentCount: exactInteger(row.argumentCount, "boundary-function argument count"),
      configuration: row.configuration,
      definition: row.definition
    })),
    policies: restrictivePolicies.rows.map((policy) => ({
      name: policy.policyName,
      table: policy.tableName,
      permissive: policy.permissive,
      roles: [policy.roleName],
      command: policy.command,
      usingExpression: policy.usingExpression,
      checkExpression: policy.checkExpression
    }))
  })).digest("hex");
  return {
    tenantRlsTableCount,
    grantCount: grants.rows.length,
    membershipCount,
    activePrincipalCount,
    restrictivePolicyCount: restrictivePolicies.rows.length,
    boundaryCatalogFingerprint
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresTenantSessionManifest
): PostgresTenantSessionQualificationReceipt {
  if (row.phase !== "verified"
    || row.read_role_namespace !== manifest.readRoleNamespace
    || row.role_namespace !== manifest.roleNamespace
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.runtime_read_role_manifest_fingerprint !== manifest.runtimeReadRoleManifestFingerprint
    || row.session_role_name !== manifest.sessionRole.name
    || !/^[a-f0-9]{64}$/.test(row.boundary_catalog_fingerprint)
    || row.direct_parameter_set_prevented !== false
    || row.direct_parameter_scope_expansion_prevented !== true
    || row.server_bound_restrictive_policies !== true
    || row.zero_argument_security_definer_binder !== true
    || row.transaction_local_binding !== true
    || row.read_only !== true
    || row.principal_provisioning_implemented !== false
    || row.production_identity_qualified !== false
    || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session receipt is incomplete or unsafe."
    );
  }
  if (exactInteger(row.contract_version, "contract version") !== POSTGRES_TENANT_SESSION_CONTRACT_VERSION
    || exactInteger(row.cutover_contract_version, "cutover contract version") !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || exactInteger(row.runtime_read_role_contract_version, "read-role contract version")
      !== POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION
    || exactInteger(row.membership_count, "membership count") !== 0
    || exactInteger(row.active_principal_count, "active principal count") !== 0
    || exactInteger(row.parameter_count, "parameter count") !== 2
    || exactInteger(row.restrictive_policy_count, "restrictive policy count")
      !== manifest.restrictivePolicyCount) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session receipt uses an unsupported or active contract."
    );
  }
  return {
    contractVersion: POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    runtimeReadRoleContractVersion: POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
    phase: "verified",
    schemaName: manifest.schemaName,
    readRoleNamespace: manifest.readRoleNamespace,
    roleNamespace: manifest.roleNamespace,
    roleManifestFingerprint: manifest.fingerprint,
    runtimeReadRoleManifestFingerprint: manifest.runtimeReadRoleManifestFingerprint,
    sessionRoleName: manifest.sessionRole.name,
    tenantRlsTableCount: exactInteger(row.tenant_rls_table_count, "tenant RLS table count"),
    grantCount: exactInteger(row.grant_count, "grant count"),
    membershipCount: 0,
    activePrincipalCount: 0,
    parameterCount: 2,
    restrictivePolicyCount: exactInteger(row.restrictive_policy_count, "restrictive policy count"),
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    directParameterSetPrevented: false,
    directParameterScopeExpansionPrevented: true,
    serverBoundRestrictivePolicies: true,
    zeroArgumentSecurityDefinerBinder: true,
    transactionLocalBinding: true,
    readOnly: true,
    principalProvisioningImplemented: false,
    productionIdentityQualified: false,
    runtimeAuthority: false,
    productionReady: false,
    appliedAt: timestamp(row.applied_at, "application timestamp"),
    verifiedAt: timestamp(row.verified_at, "verification timestamp")
  };
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresTenantSessionManifest
): Promise<PostgresTenantSessionQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, manifest.receiptTableName)} WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresTenantSessionQualificationReceipt,
  manifest: PostgresTenantSessionManifest
): void {
  if (inspection.tenantRlsTableCount !== receipt.tenantRlsTableCount
    || inspection.grantCount !== receipt.grantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.restrictivePolicyCount !== receipt.restrictivePolicyCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.tenantRlsTableCount !== manifest.tenantRlsTableCount
    || receipt.grantCount !== manifest.tenantRlsTableCount
    || receipt.restrictivePolicyCount !== manifest.restrictivePolicyCount) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresTenantSessionBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedRoleNamespace = "yoink_session_qualification"
): Promise<PostgresTenantSessionQualificationReceipt> {
  const manifest = buildPostgresTenantSessionManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedRoleNamespace
  );
  await verifyPostgresRuntimeReadRoles(database, manifest.schemaName, manifest.readRoleNamespace);
  return database.transaction(async (session) => {
    await assertReadRoleReceipt(session, manifest);
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresTenantSessionBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedRoleNamespace = "yoink_session_qualification",
  now = Date.now()
): Promise<PostgresTenantSessionQualificationReceipt> {
  const manifest = buildPostgresTenantSessionManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedRoleNamespace
  );
  await verifyPostgresRuntimeReadRoles(database, manifest.schemaName, manifest.readRoleNamespace);
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls || preflight.serverVersionMajor < 15) {
    throw new PostgresTenantSessionQualificationError(
      "Tenant-session qualification requires PostgreSQL 15+ and the cutover/control role."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresTenantSessionQualificationError(
      "Tenant-session qualification requires temporary CREATEROLE authority."
    );
  }
  const appliedAt = nowIso(now);
  return database.transaction(async (session) => {
    await assertReadRoleReceipt(session, manifest);
    const existingRole = await session.query<{ count: string | number | bigint }>(
      "SELECT COUNT(*) AS count FROM pg_catalog.pg_roles WHERE rolname = $1",
      [manifest.sessionRole.name]
    );
    const existingObjects = await session.query<{ count: string | number | bigint }>(
      `SELECT (
         SELECT COUNT(*) FROM information_schema.tables
         WHERE table_schema = $1 AND table_name IN ($2, $3)
       ) + (
         SELECT COUNT(*) FROM information_schema.routines
         WHERE routine_schema = $1 AND routine_name IN ($4, $5)
       ) AS count`,
      [
        manifest.schemaName,
        manifest.principalTableName,
        manifest.receiptTableName,
        manifest.binderFunctionName,
        manifest.scopeFunctionName
      ]
    );
    if (exactInteger(existingRole.rows[0]?.count, "existing role count") !== 0
      || exactInteger(existingObjects.rows[0]?.count, "existing object count") !== 0) {
      throw new PostgresTenantSessionQualificationError(
        "Tenant-session qualification refuses an existing role, registry, binder, or receipt."
      );
    }

    await session.query(
      `CREATE ROLE ${identifier(manifest.sessionRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await session.query(`GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)} TO ${identifier(manifest.sessionRole.name)}`);
    await session.query(
      `GRANT SELECT ON ${manifest.sessionRole.tableNames
        .map((table) => relation(manifest.schemaName, table)).join(", ")}
       TO ${identifier(manifest.sessionRole.name)}`
    );

    await session.query(`CREATE TABLE ${relation(manifest.schemaName, manifest.principalTableName)} (
      principal_role TEXT PRIMARY KEY CHECK (principal_role ~ '^[a-z][a-z0-9_]{2,62}$'),
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      provisioned_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id, user_id)
        REFERENCES ${relation(manifest.schemaName, "users")}(tenant_id, id) ON DELETE CASCADE
    )`);
    await session.query(
      `REVOKE ALL PRIVILEGES ON ${relation(manifest.schemaName, manifest.principalTableName)} FROM PUBLIC`
    );

    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, manifest.scopeFunctionName)}()
       RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $yoink$
       DECLARE
         resolved_tenant_id TEXT;
         resolved_principal_count BIGINT;
       BEGIN
         SELECT MIN(principal.tenant_id), COUNT(*)
           INTO resolved_tenant_id, resolved_principal_count
         FROM ${relation(manifest.schemaName, manifest.principalTableName)} AS principal
         WHERE principal.principal_role = session_user::text AND principal.active = TRUE;
         IF resolved_principal_count <> 1 OR resolved_tenant_id IS NULL THEN
           RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal is not active';
         END IF;
         RETURN resolved_tenant_id;
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${relation(manifest.schemaName, manifest.scopeFunctionName)}() FROM PUBLIC`
    );
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${relation(manifest.schemaName, manifest.scopeFunctionName)}()
       TO ${identifier(manifest.sessionRole.name)}`
    );

    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, manifest.binderFunctionName)}()
       RETURNS TABLE(tenant_id TEXT, user_id TEXT)
       LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $yoink$
       DECLARE
         resolved_tenant_id TEXT;
         resolved_user_id TEXT;
         resolved_principal_count BIGINT;
       BEGIN
         SELECT MIN(principal.tenant_id), MIN(principal.user_id), COUNT(*)
           INTO resolved_tenant_id, resolved_user_id, resolved_principal_count
         FROM ${relation(manifest.schemaName, manifest.principalTableName)} AS principal
         WHERE principal.principal_role = session_user::text AND principal.active = TRUE;
         IF resolved_principal_count <> 1 OR resolved_tenant_id IS NULL OR resolved_user_id IS NULL THEN
           RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal is not active';
         END IF;
         PERFORM pg_catalog.set_config('${TENANT_PARAMETER}', resolved_tenant_id, TRUE);
         PERFORM pg_catalog.set_config('${USER_PARAMETER}', resolved_user_id, TRUE);
         RETURN QUERY SELECT resolved_tenant_id, resolved_user_id;
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${relation(manifest.schemaName, manifest.binderFunctionName)}() FROM PUBLIC`
    );
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${relation(manifest.schemaName, manifest.binderFunctionName)}()
       TO ${identifier(manifest.sessionRole.name)}`
    );

    const schemaManifest = buildPostgresSchemaManifest();
    const tableByName = new Map(schemaManifest.tables.map((table) => [table.name, table]));
    const tenantExpression = `${relation(manifest.schemaName, manifest.scopeFunctionName)}()`;
    for (const tableName of manifest.sessionRole.tableNames) {
      const table = tableByName.get(tableName);
      if (!table) {
        throw new PostgresTenantSessionQualificationError(
          `Tenant-session policy table ${tableName} is absent from the schema manifest.`
        );
      }
      const condition = serverBoundTenantCondition(manifest.schemaName, table, tenantExpression);
      await session.query(
        `CREATE POLICY ${identifier(policyName(table.name))}
         ON ${relation(manifest.schemaName, table.name)} AS RESTRICTIVE FOR ALL
         TO ${identifier(manifest.sessionRole.name)}
         USING (${condition}) WITH CHECK (${condition})`
      );
    }

    await session.query(`CREATE TABLE ${relation(manifest.schemaName, manifest.receiptTableName)} (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      contract_version BIGINT NOT NULL CHECK (contract_version = ${POSTGRES_TENANT_SESSION_CONTRACT_VERSION}),
      cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = ${POSTGRES_CUTOVER_CONTRACT_VERSION}),
      runtime_read_role_contract_version BIGINT NOT NULL CHECK (
        runtime_read_role_contract_version = ${POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION}
      ),
      phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
      read_role_namespace TEXT NOT NULL,
      role_namespace TEXT NOT NULL,
      role_manifest_fingerprint TEXT NOT NULL CHECK (length(role_manifest_fingerprint) = 64),
      runtime_read_role_manifest_fingerprint TEXT NOT NULL CHECK (
        length(runtime_read_role_manifest_fingerprint) = 64
      ),
      session_role_name TEXT NOT NULL,
      tenant_rls_table_count BIGINT NOT NULL,
      grant_count BIGINT NOT NULL,
      membership_count BIGINT NOT NULL CHECK (membership_count = 0),
      active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
      parameter_count BIGINT NOT NULL CHECK (parameter_count = 2),
      restrictive_policy_count BIGINT NOT NULL,
      boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
      direct_parameter_set_prevented BOOLEAN NOT NULL DEFAULT FALSE CHECK (
        direct_parameter_set_prevented = FALSE
      ),
      direct_parameter_scope_expansion_prevented BOOLEAN NOT NULL DEFAULT TRUE CHECK (
        direct_parameter_scope_expansion_prevented = TRUE
      ),
      server_bound_restrictive_policies BOOLEAN NOT NULL DEFAULT TRUE CHECK (
        server_bound_restrictive_policies = TRUE
      ),
      zero_argument_security_definer_binder BOOLEAN NOT NULL DEFAULT TRUE CHECK (
        zero_argument_security_definer_binder = TRUE
      ),
      transaction_local_binding BOOLEAN NOT NULL DEFAULT TRUE CHECK (transaction_local_binding = TRUE),
      read_only BOOLEAN NOT NULL DEFAULT TRUE CHECK (read_only = TRUE),
      principal_provisioning_implemented BOOLEAN NOT NULL DEFAULT FALSE CHECK (
        principal_provisioning_implemented = FALSE
      ),
      production_identity_qualified BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_identity_qualified = FALSE),
      runtime_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (runtime_authority = FALSE),
      production_ready BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_ready = FALSE),
      applied_at TEXT NOT NULL,
      verified_at TEXT NOT NULL DEFAULT ''
    )`);
    await session.query(
      `REVOKE ALL PRIVILEGES ON ${relation(manifest.schemaName, manifest.receiptTableName)} FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, manifest.receiptTableName)}(
         id, contract_version, cutover_contract_version, runtime_read_role_contract_version,
         phase, read_role_namespace, role_namespace, role_manifest_fingerprint,
         runtime_read_role_manifest_fingerprint, session_role_name, tenant_rls_table_count,
         grant_count, membership_count, active_principal_count, parameter_count,
         restrictive_policy_count, boundary_catalog_fingerprint, applied_at
       ) VALUES ('active', $1, $2, $3, 'loading', $4, $5, $6, $7, $8, 0, 0, 0, 0, 2, 0,
                 repeat('0', 64), $9)`,
      [
        POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
        POSTGRES_CUTOVER_CONTRACT_VERSION,
        POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
        manifest.readRoleNamespace,
        manifest.roleNamespace,
        manifest.fingerprint,
        manifest.runtimeReadRoleManifestFingerprint,
        manifest.sessionRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, manifest.receiptTableName)}
       SET phase = 'verified', tenant_rls_table_count = $1, grant_count = $2,
           membership_count = $3, active_principal_count = $4,
           restrictive_policy_count = $5, boundary_catalog_fingerprint = $6, verified_at = $7
       WHERE id = 'active' AND phase = 'loading'`,
      [
        inspection.tenantRlsTableCount,
        inspection.grantCount,
        inspection.membershipCount,
        inspection.activePrincipalCount,
        inspection.restrictivePolicyCount,
        inspection.boundaryCatalogFingerprint,
        verifiedAt
      ]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_tenant_session_receipt_guard")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO ${identifier(manifest.schemaName)}, pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'tenant-session receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${relation(manifest.schemaName, "yoink_tenant_session_receipt_guard")}()
       FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_tenant_session_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(manifest.schemaName, manifest.receiptTableName)}
       FOR EACH ROW EXECUTE FUNCTION ${relation(manifest.schemaName, "yoink_tenant_session_receipt_guard")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

class TenantReadSession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresTenantReadDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresTenantSessionManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
    requestedReadRoleNamespace = "yoink_qualification",
    requestedRoleNamespace = "yoink_session_qualification",
    options: NodePostgresTenantReadDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresTenantSessionManifest(
      requestedSchema,
      requestedReadRoleNamespace,
      requestedRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 2;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresTenantSessionQualificationError(
        "The PostgreSQL tenant read-session connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_tenant_read_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async readTransaction<T>(
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
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.sessionRole.name)}`);
      const binding = await client.query<BindingRow>(
        `SELECT tenant_id AS "tenantId", user_id AS "userId"
         FROM ${relation(this.manifest.schemaName, this.manifest.binderFunctionName)}()`
      );
      const row = binding.rows[0];
      if (binding.rows.length !== 1 || !row
        || row.tenantId !== expected.tenantId || row.userId !== expected.userId) {
        throw new PostgresTenantSessionQualificationError(
          "The server-bound PostgreSQL tenant session does not match the expected authenticated principal."
        );
      }
      const result = await operation(new TenantReadSession(client));
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

export function assertPostgresTenantSessionPrincipalRole(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_PRINCIPAL_ROLE.test(normalized)) {
    throw new PostgresTenantSessionQualificationError(
      "The PostgreSQL tenant-session principal role is invalid."
    );
  }
  return normalized;
}
