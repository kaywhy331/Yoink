import { createHash } from "node:crypto";
import { nowIso } from "../../domain/src/ids.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  inspectPostgresCutoverPreflight,
  type PostgresCutoverDatabase,
  type PostgresQuerySession
} from "./postgres-cutover.js";
import { canonicalPortabilityJson } from "./portability.js";
import {
  buildPostgresSchemaManifest,
  type PostgresSchemaManifest,
  type PostgresTenantScopeKind
} from "./postgres-schema-manifest.js";

export const POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION = 1;
export const POSTGRES_RUNTIME_READ_ROLE_RECEIPT_TABLE = "yoink_runtime_read_role_receipt";

export type PostgresRuntimeReadRoleKind =
  | "tenant_reader"
  | "shared_catalog_reader"
  | "authorization_catalog_reader"
  | "deployment_control_reader"
  | "tenant_registry_reader";

export interface PostgresRuntimeReadRoleDescriptor {
  kind: PostgresRuntimeReadRoleKind;
  name: string;
  tableNames: string[];
  privileges: ["SELECT"];
  login: false;
  inherit: false;
  bypassRls: false;
  writeAccess: false;
}

export interface PostgresRuntimeReadRoleManifest {
  contractVersion: typeof POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  schemaName: string;
  roleNamespace: string;
  schemaManifestFingerprint: string;
  roleCount: 5;
  grantedTableCount: number;
  unresolvedTableCount: number;
  unresolvedTables: string[];
  readOnly: true;
  runtimeAuthority: false;
  roles: PostgresRuntimeReadRoleDescriptor[];
  fingerprint: string;
}

export interface PostgresRuntimeReadRoleQualificationReceipt {
  contractVersion: typeof POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  phase: "verified";
  schemaName: string;
  roleNamespace: string;
  schemaManifestFingerprint: string;
  roleManifestFingerprint: string;
  roleCount: 5;
  grantedTableCount: number;
  grantCount: number;
  tenantPolicyCount: number;
  membershipCount: 0;
  unresolvedTables: string[];
  roles: PostgresRuntimeReadRoleDescriptor[];
  readOnly: true;
  runtimeAuthority: false;
  productionReady: false;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresRuntimeReadRoleCapabilityProjection {
  contractVersion: typeof POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  deterministicManifestImplemented: true;
  atomicQualificationApplyImplemented: true;
  exactGrantVerificationImplemented: true;
  qualificationSuiteParity: true;
  noLogin: true;
  noInherit: true;
  noBypassRls: true;
  readOnly: true;
  roleCount: 5;
  grantedTableCount: number;
  tenantRlsTableCount: number;
  sharedCatalogTableCount: number;
  authorizationCatalogTableCount: number;
  deploymentControlTableCount: number;
  tenantRegistryTableCount: number;
  unresolvedTableCount: number;
  unresolvedTables: string[];
  mixedSharedOfferAccess: false;
  runtimeWriteRoleParity: false;
  activeRuntimeRolesApplied: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

interface CutoverReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  phase: string;
  schema_manifest_fingerprint: string;
  runtime_authority: boolean;
  cutover_ready: boolean;
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
  grantee: string;
  table_name: string;
  privilege_type: string;
  is_grantable: string;
}

interface ColumnGrantRow extends GrantRow {
  column_name: string;
}

interface RuntimeRoleReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  phase: string;
  role_namespace: string;
  schema_manifest_fingerprint: string;
  role_manifest_fingerprint: string;
  role_count: string | number | bigint;
  granted_table_count: string | number | bigint;
  grant_count: string | number | bigint;
  tenant_policy_count: string | number | bigint;
  membership_count: string | number | bigint;
  applied_at: string;
  verified_at: string;
  read_only: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
}

interface RoleInspection {
  roleCount: number;
  grantedTableCount: number;
  grantCount: number;
  tenantPolicyCount: number;
  membershipCount: number;
}

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
let cachedCapabilityProjection: PostgresRuntimeReadRoleCapabilityProjection | null = null;

const ROLE_CLASSIFICATIONS = {
  tenant_reader: ["direct", "inherited", "mixed"],
  shared_catalog_reader: ["shared_catalog"],
  authorization_catalog_reader: ["authorization_catalog"],
  deployment_control_reader: ["deployment_control"],
  tenant_registry_reader: ["tenant_registry"]
} as const satisfies Readonly<Record<PostgresRuntimeReadRoleKind, readonly PostgresTenantScopeKind[]>>;

export class PostgresRuntimeReadRoleQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresRuntimeReadRoleQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresRuntimeReadRoleQualificationError("The PostgreSQL runtime-role schema is invalid.");
  }
  return normalized;
}

function roleNamespace(value: unknown): string {
  const normalized = String(value ?? "yoink_qualification").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "The PostgreSQL role namespace must contain 3 through 32 lowercase letters, numbers, or underscores."
    );
  }
  return normalized;
}

function identifier(value: string): string {
  return `"${value}"`;
}

function relation(schema: string, table: string): string {
  return `${identifier(schema)}.${identifier(table)}`;
}

function placeholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresRuntimeReadRoleQualificationError(`The PostgreSQL runtime-role ${label} is invalid.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresRuntimeReadRoleQualificationError(`The PostgreSQL runtime-role ${label} is out of range.`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresRuntimeReadRoleQualificationError(`The PostgreSQL runtime-role ${label} is invalid.`);
  }
  return normalized;
}

function manifestFingerprint(value: Omit<PostgresRuntimeReadRoleManifest, "fingerprint">): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function roleName(namespace: string, kind: PostgresRuntimeReadRoleKind): string {
  const name = `${namespace}_${kind}`;
  if (Buffer.byteLength(name, "utf8") > 63) {
    throw new PostgresRuntimeReadRoleQualificationError("The PostgreSQL runtime-role name exceeds 63 bytes.");
  }
  return name;
}

function tablesForKinds(manifest: PostgresSchemaManifest, kinds: readonly PostgresTenantScopeKind[]): string[] {
  const accepted = new Set(kinds);
  return manifest.tables
    .filter((table) => accepted.has(table.tenantScopeKind))
    .map((table) => table.name)
    .sort((left, right) => left.localeCompare(right));
}

export function buildPostgresRuntimeReadRoleManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedRoleNamespace = "yoink_qualification"
): PostgresRuntimeReadRoleManifest {
  const schema = schemaName(requestedSchema);
  const namespace = roleNamespace(requestedRoleNamespace);
  const schemaManifest = buildPostgresSchemaManifest();
  const kinds = Object.keys(ROLE_CLASSIFICATIONS) as PostgresRuntimeReadRoleKind[];
  const roles = kinds.map((kind): PostgresRuntimeReadRoleDescriptor => ({
    kind,
    name: roleName(namespace, kind),
    tableNames: tablesForKinds(schemaManifest, ROLE_CLASSIFICATIONS[kind]),
    privileges: ["SELECT"],
    login: false,
    inherit: false,
    bypassRls: false,
    writeAccess: false
  }));
  const unresolvedTables = tablesForKinds(schemaManifest, ["unresolved"]);
  const allAssignedTables = roles.flatMap((role) => role.tableNames);
  const distinctAssignedTables = new Set(allAssignedTables);
  if (roles.length !== 5
    || allAssignedTables.length !== distinctAssignedTables.size
    || distinctAssignedTables.size + unresolvedTables.length !== schemaManifest.tableCount
    || unresolvedTables.length !== schemaManifest.unresolvedTenantTableCount
    || roles.find((role) => role.kind === "tenant_reader")?.tableNames.length
      !== schemaManifest.directTenantTableCount
        + schemaManifest.inheritedTenantTableCount
        + schemaManifest.mixedTenantTableCount) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "The PostgreSQL runtime-role classifications do not cover the current schema exactly."
    );
  }
  const withoutFingerprint: Omit<PostgresRuntimeReadRoleManifest, "fingerprint"> = {
    contractVersion: POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    schemaName: schema,
    roleNamespace: namespace,
    schemaManifestFingerprint: schemaManifest.fingerprint,
    roleCount: 5,
    grantedTableCount: distinctAssignedTables.size,
    unresolvedTableCount: unresolvedTables.length,
    unresolvedTables,
    readOnly: true,
    runtimeAuthority: false,
    roles
  };
  return { ...withoutFingerprint, fingerprint: manifestFingerprint(withoutFingerprint) };
}

export function postgresRuntimeReadRoleCapabilityProjection(): PostgresRuntimeReadRoleCapabilityProjection {
  if (cachedCapabilityProjection) {
    return { ...cachedCapabilityProjection, unresolvedTables: [...cachedCapabilityProjection.unresolvedTables] };
  }
  const manifest = buildPostgresRuntimeReadRoleManifest();
  const tables = (kind: PostgresRuntimeReadRoleKind): number =>
    manifest.roles.find((role) => role.kind === kind)?.tableNames.length ?? 0;
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactGrantVerificationImplemented: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    readOnly: true,
    roleCount: 5,
    grantedTableCount: manifest.grantedTableCount,
    tenantRlsTableCount: tables("tenant_reader"),
    sharedCatalogTableCount: tables("shared_catalog_reader"),
    authorizationCatalogTableCount: tables("authorization_catalog_reader"),
    deploymentControlTableCount: tables("deployment_control_reader"),
    tenantRegistryTableCount: tables("tenant_registry_reader"),
    unresolvedTableCount: manifest.unresolvedTableCount,
    unresolvedTables: [...manifest.unresolvedTables],
    mixedSharedOfferAccess: false,
    runtimeWriteRoleParity: false,
    activeRuntimeRolesApplied: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection, unresolvedTables: [...cachedCapabilityProjection.unresolvedTables] };
}

async function assertCutoverReceipt(
  session: PostgresQuerySession,
  manifest: PostgresRuntimeReadRoleManifest
): Promise<void> {
  const result = await session.query<CutoverReceiptRow>(
    `SELECT contract_version, phase, schema_manifest_fingerprint, runtime_authority, cutover_ready
     FROM ${relation(manifest.schemaName, "yoink_cutover_receipt")} WHERE id = 'active'`
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row
    || exactInteger(row.contract_version, "cutover contract version") !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || row.phase !== "verified"
    || row.schema_manifest_fingerprint !== manifest.schemaManifestFingerprint
    || row.runtime_authority !== false
    || row.cutover_ready !== false) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "Runtime read roles require the exact current verified, inert cutover receipt."
    );
  }
}

async function inspectRoles(
  session: PostgresQuerySession,
  manifest: PostgresRuntimeReadRoleManifest
): Promise<RoleInspection> {
  const roleNames = manifest.roles.map((role) => role.name);
  const roleRows = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname IN (${placeholders(1, roleNames.length)})
     ORDER BY rolname`,
    roleNames
  );
  if (roleRows.rows.length !== manifest.roleCount
    || roleRows.rows.some((role) => role.rolsuper || role.rolinherit || role.rolcreaterole
      || role.rolcreatedb || role.rolcanlogin || role.rolreplication || role.rolbypassrls)) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "A PostgreSQL runtime read role is missing or has an unsafe role attribute."
    );
  }

  const membershipParameters = [...roleNames, ...roleNames];
  const memberships = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname IN (${placeholders(1, roleNames.length)})
        OR member_role.rolname IN (${placeholders(roleNames.length + 1, roleNames.length)})`,
    membershipParameters
  );
  const membershipCount = exactInteger(memberships.rows[0]?.count, "membership count");
  if (membershipCount !== 0) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "PostgreSQL runtime read roles must not inherit from or be granted to another role during qualification."
    );
  }

  const grants = await session.query<GrantRow>(
    `SELECT grantee, table_name, privilege_type, is_grantable
     FROM information_schema.role_table_grants
     WHERE table_schema = $1 AND grantee IN (${placeholders(2, roleNames.length)})
     ORDER BY grantee, table_name, privilege_type`,
    [manifest.schemaName, ...roleNames]
  );
  const expectedGrants = new Set(manifest.roles.flatMap((role) =>
    role.tableNames.map((table) => `${role.name}:${table}:SELECT:NO`)));
  const actualGrants = new Set(grants.rows.map((grant) =>
    `${grant.grantee}:${grant.table_name}:${grant.privilege_type}:${grant.is_grantable}`));
  if (actualGrants.size !== expectedGrants.size
    || [...actualGrants].some((grant) => !expectedGrants.has(grant))) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "PostgreSQL runtime read-role grants differ from the deterministic read-only manifest."
    );
  }

  const expectedRoleTables = new Set(manifest.roles.flatMap((role) =>
    role.tableNames.map((table) => `${role.name}:${table}`)));
  const columnGrants = await session.query<ColumnGrantRow>(
    `SELECT grantee, table_name, column_name, privilege_type, is_grantable
     FROM information_schema.role_column_grants
     WHERE table_schema = $1 AND grantee IN (${placeholders(2, roleNames.length)})
     ORDER BY grantee, table_name, column_name, privilege_type`,
    [manifest.schemaName, ...roleNames]
  );
  if (columnGrants.rows.some((grant) => grant.privilege_type !== "SELECT"
    || grant.is_grantable !== "NO"
    || !expectedRoleTables.has(`${grant.grantee}:${grant.table_name}`))) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "A PostgreSQL runtime read role has an unauthorized column privilege."
    );
  }

  for (const role of manifest.roles) {
    const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
      `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
              has_schema_privilege($1, $2, 'CREATE') AS create`,
      [role.name, manifest.schemaName]
    );
    if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
      throw new PostgresRuntimeReadRoleQualificationError(
        "A PostgreSQL runtime read role has an invalid schema privilege."
      );
    }
  }


  const roleObjectPlaceholders = placeholders(2, roleNames.length);
  const ownedObjects = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM pg_catalog.pg_class relation
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
       JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE namespace.nspname = $1 AND owner_role.rolname IN (${roleObjectPlaceholders})
     ) + (
       SELECT COUNT(*) FROM pg_catalog.pg_proc routine
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
       JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = routine.proowner
       WHERE namespace.nspname = $1 AND owner_role.rolname IN (${roleObjectPlaceholders})
     ) + (
       SELECT COUNT(*) FROM pg_catalog.pg_namespace namespace
       JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = namespace.nspowner
       WHERE namespace.nspname = $1 AND owner_role.rolname IN (${roleObjectPlaceholders})
     ) AS count`,
    [manifest.schemaName, ...roleNames]
  );
  if (exactInteger(ownedObjects.rows[0]?.count, "owned object count") !== 0) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "PostgreSQL runtime read roles must not own application-schema objects."
    );
  }

  const executableRoutines = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_proc routine
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
     JOIN pg_catalog.pg_roles runtime_role ON runtime_role.rolname IN (${placeholders(2, roleNames.length)})
     WHERE namespace.nspname = $1
       AND has_function_privilege(runtime_role.oid, routine.oid, 'EXECUTE')`,
    [manifest.schemaName, ...roleNames]
  );
  if (exactInteger(executableRoutines.rows[0]?.count, "executable routine count") !== 0) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "PostgreSQL runtime read roles must not execute application-schema routines."
    );
  }

  const accessibleSequences = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_class sequence
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = sequence.relnamespace
     JOIN pg_catalog.pg_roles runtime_role ON runtime_role.rolname IN (${placeholders(2, roleNames.length)})
     WHERE namespace.nspname = $1 AND sequence.relkind = 'S'
       AND (has_sequence_privilege(runtime_role.oid, sequence.oid, 'USAGE')
         OR has_sequence_privilege(runtime_role.oid, sequence.oid, 'SELECT')
         OR has_sequence_privilege(runtime_role.oid, sequence.oid, 'UPDATE'))`,
    [manifest.schemaName, ...roleNames]
  );
  if (exactInteger(accessibleSequences.rows[0]?.count, "accessible sequence count") !== 0) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "PostgreSQL runtime read roles must not access application-schema sequences."
    );
  }

  const schemaManifest = buildPostgresSchemaManifest();
  const expectedTenantPolicies = schemaManifest.directTenantTableCount
    + schemaManifest.inheritedTenantTableCount
    + schemaManifest.mixedTenantTableCount;
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_policies policy
     JOIN pg_catalog.pg_class relation ON relation.relname = policy.tablename
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
       AND namespace.nspname = policy.schemaname
     WHERE policy.schemaname = $1
       AND relation.relrowsecurity = TRUE
       AND relation.relforcerowsecurity = TRUE`,
    [manifest.schemaName]
  );
  const tenantPolicyCount = exactInteger(policies.rows[0]?.count, "tenant policy count");
  if (tenantPolicyCount !== expectedTenantPolicies) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "The PostgreSQL runtime tenant-role policy surface is incomplete."
    );
  }
  return {
    roleCount: roleRows.rows.length,
    grantedTableCount: new Set(grants.rows.map((grant) => grant.table_name)).size,
    grantCount: grants.rows.length,
    tenantPolicyCount,
    membershipCount
  };
}

function receiptFromRow(
  row: RuntimeRoleReceiptRow,
  manifest: PostgresRuntimeReadRoleManifest
): PostgresRuntimeReadRoleQualificationReceipt {
  if (row.phase !== "verified"
    || row.role_namespace !== manifest.roleNamespace
    || row.schema_manifest_fingerprint !== manifest.schemaManifestFingerprint
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.read_only !== true
    || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "The PostgreSQL runtime read-role receipt is incomplete or unsafe."
    );
  }
  const contractVersion = exactInteger(row.contract_version, "contract version");
  const cutoverContractVersion = exactInteger(row.cutover_contract_version, "cutover contract version");
  if (contractVersion !== POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION
    || cutoverContractVersion !== POSTGRES_CUTOVER_CONTRACT_VERSION) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "The PostgreSQL runtime read-role receipt uses an unsupported contract."
    );
  }
  const roleCount = exactInteger(row.role_count, "role count");
  const membershipCount = exactInteger(row.membership_count, "membership count");
  if (roleCount !== 5 || membershipCount !== 0) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "The PostgreSQL runtime read-role receipt contains an unsafe role topology."
    );
  }
  return {
    contractVersion: POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    phase: "verified",
    schemaName: manifest.schemaName,
    roleNamespace: manifest.roleNamespace,
    schemaManifestFingerprint: manifest.schemaManifestFingerprint,
    roleManifestFingerprint: manifest.fingerprint,
    roleCount: 5,
    grantedTableCount: exactInteger(row.granted_table_count, "granted-table count"),
    grantCount: exactInteger(row.grant_count, "grant count"),
    tenantPolicyCount: exactInteger(row.tenant_policy_count, "tenant policy count"),
    membershipCount: 0,
    unresolvedTables: [...manifest.unresolvedTables],
    roles: manifest.roles.map((role) => ({ ...role, tableNames: [...role.tableNames] })),
    readOnly: true,
    runtimeAuthority: false,
    productionReady: false,
    appliedAt: timestamp(row.applied_at, "application timestamp"),
    verifiedAt: timestamp(row.verified_at, "verification timestamp")
  };
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresRuntimeReadRoleManifest
): Promise<PostgresRuntimeReadRoleQualificationReceipt> {
  const result = await session.query<RuntimeRoleReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_RUNTIME_READ_ROLE_RECEIPT_TABLE)}
     WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "The PostgreSQL runtime read-role receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: RoleInspection,
  receipt: PostgresRuntimeReadRoleQualificationReceipt,
  manifest: PostgresRuntimeReadRoleManifest
): void {
  if (inspection.roleCount !== receipt.roleCount
    || inspection.grantedTableCount !== receipt.grantedTableCount
    || inspection.grantCount !== receipt.grantCount
    || inspection.tenantPolicyCount !== receipt.tenantPolicyCount
    || inspection.membershipCount !== receipt.membershipCount
    || receipt.grantedTableCount !== manifest.grantedTableCount
    || receipt.grantCount !== manifest.grantedTableCount) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "The PostgreSQL runtime read roles no longer match their verified receipt."
    );
  }
}

export async function verifyPostgresRuntimeReadRoles(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedRoleNamespace = "yoink_qualification"
): Promise<PostgresRuntimeReadRoleQualificationReceipt> {
  const manifest = buildPostgresRuntimeReadRoleManifest(requestedSchema, requestedRoleNamespace);
  return database.transaction(async (session) => {
    await assertCutoverReceipt(session, manifest);
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectRoles(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresRuntimeReadRoles(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedRoleNamespace = "yoink_qualification",
  now = Date.now()
): Promise<PostgresRuntimeReadRoleQualificationReceipt> {
  const manifest = buildPostgresRuntimeReadRoleManifest(requestedSchema, requestedRoleNamespace);
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "Runtime read-role qualification requires the supported cutover/control role."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresRuntimeReadRoleQualificationError(
      "Runtime read-role qualification requires temporary CREATEROLE authority."
    );
  }
  const appliedAt = nowIso(now);
  return database.transaction(async (session) => {
    await assertCutoverReceipt(session, manifest);
    const existingRoles = await session.query<{ rolname: string }>(
      `SELECT rolname FROM pg_catalog.pg_roles
       WHERE rolname IN (${placeholders(1, manifest.roles.length)})`,
      manifest.roles.map((role) => role.name)
    );
    const existingReceipt = await session.query<{ count: string | number | bigint }>(
      `SELECT COUNT(*) AS count FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2`,
      [manifest.schemaName, POSTGRES_RUNTIME_READ_ROLE_RECEIPT_TABLE]
    );
    if (existingRoles.rows.length || exactInteger(existingReceipt.rows[0]?.count, "existing receipt count") !== 0) {
      throw new PostgresRuntimeReadRoleQualificationError(
        "Runtime read-role qualification refuses existing roles or a reused receipt."
      );
    }

    for (const role of manifest.roles) {
      await session.query(
        `CREATE ROLE ${identifier(role.name)}
         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
      );
    }
    await session.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${identifier(manifest.schemaName)} FROM PUBLIC`);
    await session.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${identifier(manifest.schemaName)} FROM PUBLIC`);
    await session.query(
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${identifier(manifest.schemaName)} FROM PUBLIC`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA ${identifier(manifest.schemaName)} FROM PUBLIC`
    );
    for (const role of manifest.roles) {
      await session.query(`GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)} TO ${identifier(role.name)}`);
      await session.query(
        `GRANT SELECT ON ${role.tableNames.map((table) => relation(manifest.schemaName, table)).join(", ")}
         TO ${identifier(role.name)}`
      );
    }

    await session.query(`CREATE TABLE ${relation(manifest.schemaName, POSTGRES_RUNTIME_READ_ROLE_RECEIPT_TABLE)} (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      contract_version BIGINT NOT NULL CHECK (contract_version = ${POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION}),
      cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = ${POSTGRES_CUTOVER_CONTRACT_VERSION}),
      phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
      role_namespace TEXT NOT NULL,
      schema_manifest_fingerprint TEXT NOT NULL CHECK (length(schema_manifest_fingerprint) = 64),
      role_manifest_fingerprint TEXT NOT NULL CHECK (length(role_manifest_fingerprint) = 64),
      role_count BIGINT NOT NULL CHECK (role_count = 5),
      granted_table_count BIGINT NOT NULL,
      grant_count BIGINT NOT NULL,
      tenant_policy_count BIGINT NOT NULL,
      membership_count BIGINT NOT NULL CHECK (membership_count = 0),
      applied_at TEXT NOT NULL,
      verified_at TEXT NOT NULL DEFAULT '',
      read_only BOOLEAN NOT NULL DEFAULT TRUE CHECK (read_only = TRUE),
      runtime_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (runtime_authority = FALSE),
      production_ready BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_ready = FALSE)
    )`);
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_RUNTIME_READ_ROLE_RECEIPT_TABLE)}(
         id, contract_version, cutover_contract_version, phase, role_namespace,
         schema_manifest_fingerprint, role_manifest_fingerprint, role_count,
         granted_table_count, grant_count, tenant_policy_count, membership_count,
         applied_at
       ) VALUES ('active', $1, $2, 'loading', $3, $4, $5, 5, 0, 0, 0, 0, $6)`,
      [
        POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
        POSTGRES_CUTOVER_CONTRACT_VERSION,
        manifest.roleNamespace,
        manifest.schemaManifestFingerprint,
        manifest.fingerprint,
        appliedAt
      ]
    );
    const inspection = await inspectRoles(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_RUNTIME_READ_ROLE_RECEIPT_TABLE)}
       SET phase = 'verified', granted_table_count = $1, grant_count = $2,
           tenant_policy_count = $3, membership_count = $4, verified_at = $5
       WHERE id = 'active' AND phase = 'loading'`,
      [
        inspection.grantedTableCount,
        inspection.grantCount,
        inspection.tenantPolicyCount,
        inspection.membershipCount,
        verifiedAt
      ]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_runtime_read_role_receipt_guard")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO ${identifier(manifest.schemaName)}, pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'runtime read-role receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${relation(manifest.schemaName, "yoink_runtime_read_role_receipt_guard")}()
       FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_runtime_read_role_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(manifest.schemaName, POSTGRES_RUNTIME_READ_ROLE_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION ${relation(manifest.schemaName, "yoink_runtime_read_role_receipt_guard")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectRoles(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}
