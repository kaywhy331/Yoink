import { createHash } from "node:crypto";
import { nowIso } from "../../domain/src/ids.js";
import {
  inspectPostgresCutoverPreflight,
  type PostgresCutoverDatabase,
  type PostgresQuerySession
} from "./postgres-cutover.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]{2,62}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface PostgresQualifiedFunctionBoundarySpec {
  boundaryKind: string;
  schemaName: string;
  roleName: string;
  functionName: string;
  functionArgumentsSql: string;
  functionArgumentTypes: string[];
  functionResultType: string;
  functionSource: string;
  receiptTableName: string;
  receiptGuardFunctionName: string;
  receiptTriggerName: string;
  manifestFingerprint: string;
  predecessorFingerprint: string;
  protectedTenantTableNames: string[];
  mutationTableNames: string[];
  metadata: Record<string, unknown>;
}

export interface PostgresQualifiedFunctionBoundaryInspection {
  protectedTenantTableCount: number;
  forcedRlsTableCount: number;
  mutationTableCount: number;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryCatalogFingerprint: string;
}

export interface PostgresQualifiedFunctionBoundaryReceipt
  extends PostgresQualifiedFunctionBoundaryInspection {
  contractVersion: 1;
  phase: "verified";
  boundaryKind: string;
  schemaName: string;
  roleName: string;
  manifestFingerprint: string;
  predecessorFingerprint: string;
  metadata: Record<string, unknown>;
  appliedAt: string;
  verifiedAt: string;
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

interface RoutineAclRow extends Record<string, unknown> {
  grantee: string;
  privilegeType: string;
  grantable: boolean;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: unknown;
  phase: string;
  boundary_kind: string;
  manifest_fingerprint: string;
  predecessor_fingerprint: string;
  role_name: string;
  protected_tenant_table_count: unknown;
  forced_rls_table_count: unknown;
  mutation_table_count: unknown;
  direct_table_grant_count: unknown;
  function_grant_count: unknown;
  membership_count: unknown;
  active_principal_count: unknown;
  boundary_catalog_fingerprint: string;
  metadata_json: string;
  applied_at: string;
  verified_at: string;
}

export class PostgresQualifiedFunctionBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresQualifiedFunctionBoundaryError";
  }
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function relation(schema: string, name: string): string {
  return `${identifier(schema)}.${identifier(name)}`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new PostgresQualifiedFunctionBoundaryError(`The ${label} is invalid.`);
  }
  return normalized;
}

function exactTimestamp(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new PostgresQualifiedFunctionBoundaryError(`The ${label} is invalid.`);
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function validatedSpec(spec: PostgresQualifiedFunctionBoundarySpec): PostgresQualifiedFunctionBoundarySpec {
  const identifiers = [
    spec.schemaName,
    spec.roleName,
    spec.functionName,
    spec.receiptTableName,
    spec.receiptGuardFunctionName,
    spec.receiptTriggerName
  ];
  if (identifiers.some((value) => !SAFE_IDENTIFIER.test(value))
    || !/^[a-z][a-z0-9_]{2,80}$/.test(spec.boundaryKind)
    || !SHA256.test(spec.manifestFingerprint)
    || !SHA256.test(spec.predecessorFingerprint)
    || !spec.functionArgumentsSql.trim()
    || !spec.functionArgumentTypes.length
    || !spec.functionResultType.trim()
    || !spec.functionSource.trim()) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function boundary specification is invalid.");
  }
  const protectedTables = [...new Set(spec.protectedTenantTableNames)].sort();
  const mutationTables = [...new Set(spec.mutationTableNames)].sort();
  if (!protectedTables.length
    || protectedTables.some((name) => !SAFE_IDENTIFIER.test(name))
    || mutationTables.some((name) => !protectedTables.includes(name))) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function boundary table set is invalid.");
  }
  return {
    ...spec,
    protectedTenantTableNames: protectedTables,
    mutationTableNames: mutationTables
  };
}

async function inspectBoundary(
  session: PostgresQuerySession,
  requestedSpec: PostgresQualifiedFunctionBoundarySpec
): Promise<PostgresQualifiedFunctionBoundaryInspection> {
  const spec = validatedSpec(requestedSpec);
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [spec.roleName]
  );
  const role = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !role || role.rolname !== spec.roleName
    || role.rolsuper || role.rolinherit || role.rolcreaterole || role.rolcreatedb
    || role.rolcanlogin || role.rolreplication || role.rolbypassrls) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function role attributes are unsafe.");
  }

  const memberships = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     WHERE member_role.rolname = $1`,
    [spec.roleName]
  );
  if (exactInteger(memberships.rows[0]?.count, "role membership count") !== 0) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function role must not inherit another role.");
  }

  const directGrants = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM information_schema.role_table_grants
       WHERE grantee = $1 AND table_schema = $2
     ) + (
       SELECT COUNT(*) FROM information_schema.role_column_grants
       WHERE grantee = $1 AND table_schema = $2
     ) AS count`,
    [spec.roleName, spec.schemaName]
  );
  if (exactInteger(directGrants.rows[0]?.count, "direct grant count") !== 0) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function role has a direct table or column grant.");
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
    [spec.schemaName, spec.roleName]
  );
  if (effectiveTables.rows.some((row) => row.maySelect || row.mayInsert
    || row.mayUpdate || row.mayDelete || row.mayEscalate)) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function role has effective table authority.");
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
    [spec.schemaName, spec.roleName]
  );
  if (effectiveColumns.rows.some((row) => row.maySelect || row.mayInsert
    || row.mayUpdate || row.mayReference)) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function role has effective column authority.");
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [spec.roleName, spec.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function schema grant is invalid.");
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
    [spec.schemaName, spec.roleName]
  );
  const routine = routines.rows[0];
  if (routines.rows.length !== 1 || !routine
    || routine.routineName !== spec.functionName
    || routine.argumentTypes !== spec.functionArgumentTypes.join(", ")
    || routine.resultType !== spec.functionResultType
    || routine.volatility !== "v" || !routine.securityDefiner || !routine.strict
    || routine.leakproof || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === spec.roleName || routine.source !== spec.functionSource) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified security-definer function is incomplete.");
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
     WHERE routine.oid = $1::oid ORDER BY grantee`,
    [routine.oid]
  );
  if (routineAcl.rows.length !== 2
    || !routineAcl.rows.some((row) => row.grantee === spec.roleName
      && row.privilegeType === "EXECUTE" && !row.grantable)
    || !routineAcl.rows.some((row) => row.grantee === routine.ownerName
      && row.privilegeType === "EXECUTE" && !row.grantable)
    || routineAcl.rows.some((row) => row.grantee === "PUBLIC")) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function ACL is not exact.");
  }

  const protectedTables = await session.query<{ tableName: string; enabled: boolean; forced: boolean }>(
    `SELECT relation.relname AS "tableName", relation.relrowsecurity AS enabled,
            relation.relforcerowsecurity AS forced
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relname = ANY($2::text[])
     ORDER BY relation.relname`,
    [spec.schemaName, spec.protectedTenantTableNames]
  );
  if (protectedTables.rows.length !== spec.protectedTenantTableNames.length
    || protectedTables.rows.some((row) => !row.enabled || !row.forced)
    || protectedTables.rows.map((row) => row.tableName).join(",")
      !== spec.protectedTenantTableNames.join(",")) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified protected-table set is incomplete.");
  }
  const mutationTables = protectedTables.rows.filter((row) => spec.mutationTableNames.includes(row.tableName));
  if (mutationTables.map((row) => row.tableName).join(",") !== spec.mutationTableNames.join(",")) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified mutation-table set is incomplete.");
  }

  const accessibleSequences = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_class sequence
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = sequence.relnamespace
     WHERE namespace.nspname = $1 AND sequence.relkind = 'S'
       AND (has_sequence_privilege($2, sequence.oid, 'USAGE')
         OR has_sequence_privilege($2, sequence.oid, 'SELECT')
         OR has_sequence_privilege($2, sequence.oid, 'UPDATE'))`,
    [spec.schemaName, spec.roleName]
  );
  if (exactInteger(accessibleSequences.rows[0]?.count, "accessible sequence count") !== 0) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function role can access a sequence.");
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
    [spec.schemaName, spec.roleName]
  );
  if (exactInteger(owned.rows[0]?.count, "owned object count") !== 0) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function role owns an application object.");
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [spec.schemaName, spec.roleName]
  );
  if (exactInteger(policies.rows[0]?.count, "direct policy count") !== 0) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function role has a direct RLS policy.");
  }
  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(spec.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)} AS principal
     JOIN pg_catalog.pg_roles AS principal_role
       ON principal_role.rolname = principal.principal_role
     JOIN pg_catalog.pg_roles AS boundary_role
       ON boundary_role.rolname = $1
     WHERE principal.active = TRUE
       AND pg_catalog.pg_has_role(principal_role.oid, boundary_role.oid, 'MEMBER')`,
    [spec.roleName]
  );
  if (exactInteger(principals.rows[0]?.count, "active principal count") !== 0) {
    throw new PostgresQualifiedFunctionBoundaryError(
      "Qualification cannot authorize an active runtime principal for this boundary."
    );
  }
  return {
    protectedTenantTableCount: protectedTables.rows.length,
    forcedRlsTableCount: protectedTables.rows.filter((row) => row.forced).length,
    mutationTableCount: mutationTables.length,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryCatalogFingerprint: fingerprint({ role, routine, routineAcl: routineAcl.rows, protectedTables: protectedTables.rows, mutationTables })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  spec: PostgresQualifiedFunctionBoundarySpec
): PostgresQualifiedFunctionBoundaryReceipt {
  let metadata: unknown;
  try { metadata = JSON.parse(row.metadata_json); } catch { metadata = null; }
  if (row.phase !== "verified" || row.boundary_kind !== spec.boundaryKind
    || row.manifest_fingerprint !== spec.manifestFingerprint
    || row.predecessor_fingerprint !== spec.predecessorFingerprint
    || row.role_name !== spec.roleName
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || canonicalPortabilityJson(metadata) !== canonicalPortabilityJson(spec.metadata)) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function receipt is inconsistent.");
  }
  const receipt: PostgresQualifiedFunctionBoundaryReceipt = {
    contractVersion: exactInteger(row.contract_version, "receipt contract version") as 1,
    phase: "verified",
    boundaryKind: spec.boundaryKind,
    schemaName: spec.schemaName,
    roleName: spec.roleName,
    manifestFingerprint: spec.manifestFingerprint,
    predecessorFingerprint: spec.predecessorFingerprint,
    protectedTenantTableCount: exactInteger(row.protected_tenant_table_count, "protected table count"),
    forcedRlsTableCount: exactInteger(row.forced_rls_table_count, "forced RLS table count"),
    mutationTableCount: exactInteger(row.mutation_table_count, "mutation table count"),
    directTableGrantCount: exactInteger(row.direct_table_grant_count, "direct grant count") as 0,
    functionGrantCount: exactInteger(row.function_grant_count, "function grant count") as 1,
    membershipCount: exactInteger(row.membership_count, "membership count") as 0,
    activePrincipalCount: exactInteger(row.active_principal_count, "active principal count") as 0,
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    metadata: spec.metadata,
    appliedAt: exactTimestamp(row.applied_at, "receipt application timestamp"),
    verifiedAt: exactTimestamp(row.verified_at, "receipt verification timestamp")
  };
  if (receipt.contractVersion !== 1
    || receipt.protectedTenantTableCount !== spec.protectedTenantTableNames.length
    || receipt.forcedRlsTableCount !== spec.protectedTenantTableNames.length
    || receipt.mutationTableCount !== spec.mutationTableNames.length
    || receipt.directTableGrantCount !== 0 || receipt.functionGrantCount !== 1
    || receipt.membershipCount !== 0 || receipt.activePrincipalCount !== 0) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function receipt uses an unsupported contract.");
  }
  return receipt;
}

async function readReceipt(
  session: PostgresQuerySession,
  spec: PostgresQualifiedFunctionBoundarySpec
): Promise<PostgresQualifiedFunctionBoundaryReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(spec.schemaName, spec.receiptTableName)} WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualified function receipt is missing or ambiguous.");
  }
  return receiptFromRow(result.rows[0], spec);
}

function assertInspectionMatchesReceipt(
  inspection: PostgresQualifiedFunctionBoundaryInspection,
  receipt: PostgresQualifiedFunctionBoundaryReceipt
): void {
  for (const key of [
    "protectedTenantTableCount",
    "forcedRlsTableCount",
    "mutationTableCount",
    "directTableGrantCount",
    "functionGrantCount",
    "membershipCount",
    "activePrincipalCount",
    "boundaryCatalogFingerprint"
  ] as const) {
    if (inspection[key] !== receipt[key]) {
      throw new PostgresQualifiedFunctionBoundaryError("The qualified function boundary drifted from its receipt.");
    }
  }
}

export async function verifyPostgresQualifiedFunctionBoundary(
  database: PostgresCutoverDatabase,
  requestedSpec: PostgresQualifiedFunctionBoundarySpec
): Promise<PostgresQualifiedFunctionBoundaryReceipt> {
  const spec = validatedSpec(requestedSpec);
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, spec);
    const inspection = await inspectBoundary(session, spec);
    assertInspectionMatchesReceipt(inspection, receipt);
    return receipt;
  });
}

export async function applyPostgresQualifiedFunctionBoundary(
  database: PostgresCutoverDatabase,
  requestedSpec: PostgresQualifiedFunctionBoundarySpec,
  now = Date.now()
): Promise<PostgresQualifiedFunctionBoundaryReceipt> {
  const spec = validatedSpec(requestedSpec);
  if (!Number.isSafeInteger(now)) {
    throw new PostgresQualifiedFunctionBoundaryError("The qualification timestamp is invalid.");
  }
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresQualifiedFunctionBoundaryError("Qualification requires the supported BYPASSRLS cutover role.");
  }
  const authority = await database.query<{ rolcreaterole: boolean; rolsuper: boolean }>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresQualifiedFunctionBoundaryError("Qualification requires temporary CREATEROLE authority.");
  }
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
      [spec.roleName, spec.schemaName, spec.receiptTableName, [spec.functionName, spec.receiptGuardFunctionName]]
    );
    if (exactInteger(existing.rows[0]?.count, "existing object count") !== 0) {
      throw new PostgresQualifiedFunctionBoundaryError("Qualification refuses an existing role, function, guard, or receipt.");
    }
    await session.query(
      `CREATE ROLE ${identifier(spec.roleName)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(`GRANT USAGE ON SCHEMA ${identifier(spec.schemaName)} TO ${identifier(spec.roleName)}`);
    for (const table of spec.protectedTenantTableNames) {
      await session.query(`ALTER TABLE ${relation(spec.schemaName, table)} ENABLE ROW LEVEL SECURITY`);
      await session.query(`ALTER TABLE ${relation(spec.schemaName, table)} FORCE ROW LEVEL SECURITY`);
    }
    await session.query(
      `CREATE FUNCTION ${relation(spec.schemaName, spec.functionName)}(${spec.functionArgumentsSql})
       RETURNS ${spec.functionResultType}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
       SET search_path TO pg_catalog
       AS $yoink$${spec.functionSource}$yoink$`
    );
    const functionIdentity = `${relation(spec.schemaName, spec.functionName)}(${spec.functionArgumentTypes.join(", ")})`;
    await session.query(`REVOKE ALL PRIVILEGES ON FUNCTION ${functionIdentity} FROM PUBLIC`);
    await session.query(`GRANT EXECUTE ON FUNCTION ${functionIdentity} TO ${identifier(spec.roleName)}`);
    await session.query(
      `CREATE TABLE ${relation(spec.schemaName, spec.receiptTableName)}(
         id TEXT PRIMARY KEY CHECK (id = 'active'),
         contract_version INTEGER NOT NULL CHECK (contract_version = 1),
         phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
         boundary_kind TEXT NOT NULL,
         manifest_fingerprint TEXT NOT NULL CHECK (manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         predecessor_fingerprint TEXT NOT NULL CHECK (predecessor_fingerprint ~ '^[a-f0-9]{64}$'),
         role_name TEXT NOT NULL,
         protected_tenant_table_count INTEGER NOT NULL,
         forced_rls_table_count INTEGER NOT NULL,
         mutation_table_count INTEGER NOT NULL,
         direct_table_grant_count INTEGER NOT NULL,
         function_grant_count INTEGER NOT NULL,
         membership_count INTEGER NOT NULL,
         active_principal_count INTEGER NOT NULL,
         boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
         metadata_json TEXT NOT NULL,
         applied_at TEXT NOT NULL,
         verified_at TEXT NOT NULL DEFAULT ''
       )`
    );
    await session.query(`REVOKE ALL PRIVILEGES ON ${relation(spec.schemaName, spec.receiptTableName)} FROM PUBLIC`);
    await session.query(
      `INSERT INTO ${relation(spec.schemaName, spec.receiptTableName)}(
         id, contract_version, phase, boundary_kind, manifest_fingerprint,
         predecessor_fingerprint, role_name, protected_tenant_table_count,
         forced_rls_table_count, mutation_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         boundary_catalog_fingerprint, metadata_json, applied_at
       ) VALUES ('active', 1, 'loading', $1, $2, $3, $4, 0, 0, 0, 0, 0, 0, 0,
                 repeat('0', 64), $5, $6)`,
      [spec.boundaryKind, spec.manifestFingerprint, spec.predecessorFingerprint, spec.roleName,
        canonicalPortabilityJson(spec.metadata), appliedAt]
    );
    const inspection = await inspectBoundary(session, spec);
    const verifiedAt = nowIso(now + 1);
    await session.query(
      `UPDATE ${relation(spec.schemaName, spec.receiptTableName)}
       SET phase = 'verified', protected_tenant_table_count = $1,
           forced_rls_table_count = $2, mutation_table_count = $3,
           direct_table_grant_count = $4, function_grant_count = $5,
           membership_count = $6, active_principal_count = $7,
           boundary_catalog_fingerprint = $8, verified_at = $9
       WHERE id = 'active' AND phase = 'loading'`,
      [inspection.protectedTenantTableCount, inspection.forcedRlsTableCount,
        inspection.mutationTableCount, inspection.directTableGrantCount,
        inspection.functionGrantCount, inspection.membershipCount,
        inspection.activePrincipalCount, inspection.boundaryCatalogFingerprint, verifiedAt]
    );
    await session.query(
      `CREATE FUNCTION ${relation(spec.schemaName, spec.receiptGuardFunctionName)}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'qualified function receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${relation(spec.schemaName, spec.receiptGuardFunctionName)}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier(spec.receiptTriggerName)}
       BEFORE UPDATE OR DELETE ON ${relation(spec.schemaName, spec.receiptTableName)}
       FOR EACH ROW EXECUTE FUNCTION ${relation(spec.schemaName, spec.receiptGuardFunctionName)}()`
    );
    const receipt = await readReceipt(session, spec);
    const finalInspection = await inspectBoundary(session, spec);
    assertInspectionMatchesReceipt(finalInspection, receipt);
    return receipt;
  });
}
