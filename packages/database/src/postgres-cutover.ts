import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { SQLInputValue } from "node:sqlite";
import {
  PORTABILITY_FORMAT,
  assertPortabilityArchiveCompatibleWithCurrentBuild,
  canonicalPortabilityJson,
  decodePortabilityValue,
  streamVerifiedPortabilityRows,
  verifyPortabilityArchive,
  type PortableValue,
  type PortabilityArchiveVerification,
  type PortabilityColumnDescriptor,
  type PortabilityDataSummary,
  type PortabilityParityResult,
  type PortabilityTableDescriptor,
  type PortabilityTableSummary
} from "./portability.js";
import {
  buildPostgresSchemaManifest,
  type PostgresIndexDescriptor,
  type PostgresSchemaManifest,
  type PostgresTableSchemaDescriptor
} from "./postgres-schema-manifest.js";

export const POSTGRES_CUTOVER_CONTRACT_VERSION = 2;
export const POSTGRES_CUTOVER_MINIMUM_MAJOR_VERSION = 15;
export const POSTGRES_CUTOVER_DEFAULT_SCHEMA = "yoink_cutover";

export type PostgresCutoverTlsMode = "verify-full" | "local-insecure";

export interface PostgresCutoverConnectionConfig {
  connectionString: string;
  tlsMode: PostgresCutoverTlsMode;
  certificateAuthorityPem: string;
}

export interface PostgresQueryResult<T extends Record<string, unknown> = Record<string, unknown>> {
  rows: T[];
  rowCount?: number | null;
}

export interface PostgresQuerySession {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[]
  ): Promise<PostgresQueryResult<T>>;
}

export interface PostgresCutoverDatabase extends PostgresQuerySession {
  transaction<T>(operation: (session: PostgresQuerySession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface PostgresCutoverPreflight {
  contractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  serverVersionMajor: number;
  minimumServerVersionMajor: typeof POSTGRES_CUTOVER_MINIMUM_MAJOR_VERSION;
  serverVersionSupported: boolean;
  tlsActive: boolean;
  rowSecurityAvailable: boolean;
  skipLockedAvailable: boolean;
  cutoverRoleBypassesRls: boolean;
  productionReady: false;
}

export interface PostgresCutoverQualification {
  primaryKeysApplied: true;
  notNullConstraintsApplied: true;
  foreignKeysApplied: true;
  indexesApplied: true;
  defaultExpressionParity: true;
  directTenantRlsApplied: true;
  inheritedTenantRlsApplied: true;
  mixedTenantRlsFailClosed: true;
  tenantScopeClassificationComplete: true;
  checkConstraintParity: true;
  triggerParity: true;
  inheritedTenantRlsParity: true;
  mixedTenantScopeParity: false;
  sharedTableRuntimeRoleParity: false;
  postgresAsyncWorkerStoreImplemented: true;
  postgresAsyncWorkerStoreContractParity: true;
  singleConnectionWorkerLeaseSemanticsQualified: true;
  postgresBackgroundHandlerParity: false;
  asyncRuntimeRepositoryParity: false;
  fleetLeaseContentionQualified: false;
  backupRestoreQualified: false;
  productionIdentityQualified: false;
  runtimeAuthority: false;
  cutoverReady: false;
}

export interface PostgresCutoverReceipt {
  contractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  phase: "verified";
  sourceFormat: typeof PORTABILITY_FORMAT;
  sourceSchemaVersion: number;
  sourceFileSha256: string;
  sourceDataSha256: string;
  schemaManifestFingerprint: string;
  tableCount: number;
  rowCount: number;
  foreignKeyCount: number;
  indexCount: number;
  defaultExpressionCount: number;
  directTenantRlsTableCount: number;
  inheritedTenantRlsTableCount: number;
  mixedTenantRlsTableCount: number;
  importedAt: string;
  verifiedAt: string;
  qualification: PostgresCutoverQualification;
}

export interface PostgresCutoverImportResult extends PortabilityParityResult {
  schemaName: string;
  receipt: PostgresCutoverReceipt;
  manifest: PostgresSchemaManifest;
}

export interface PostgresCutoverCapabilityProjection {
  contractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  minimumServerVersionMajor: typeof POSTGRES_CUTOVER_MINIMUM_MAJOR_VERSION;
  productionDriverImplemented: true;
  oneShotImportImplemented: true;
  exactReconciliationImplemented: true;
  archiveTamperDetection: true;
  dualWriteSupported: false;
  runtimeAuthority: false;
  productionReady: false;
  portableTableCount: number;
  foreignKeyCount: number;
  indexCount: number;
  defaultExpressionCount: number;
  checkConstraintCount: number;
  triggerCount: number;
  directTenantRlsTableCount: number;
  inheritedTenantPathTableCount: number;
  noTenantPathTableCount: number;
  inheritedTenantRlsTableCount: number;
  mixedTenantRlsTableCount: number;
  sharedCatalogTableCount: number;
  authorizationCatalogTableCount: number;
  deploymentControlTableCount: number;
  tenantRegistryTableCount: number;
  unresolvedTenantTableCount: number;
  tenantScopeClassificationComplete: true;
  mixedTenantRlsFailClosed: true;
  defaultExpressionParity: true;
  checkConstraintParity: true;
  triggerParity: true;
  inheritedTenantRlsParity: true;
  mixedTenantScopeParity: false;
  sharedTableRuntimeRoleParity: false;
  postgresAsyncWorkerStoreImplemented: true;
  postgresAsyncWorkerStoreContractParity: true;
  singleConnectionWorkerLeaseSemanticsQualified: true;
  postgresBackgroundHandlerParity: false;
  asyncRuntimeRepositoryParity: false;
  fleetLeaseContentionQualified: false;
  backupRestoreQualified: false;
  schemaManifestFingerprint: string;
}

interface PreflightRow extends Record<string, unknown> {
  server_version_num: string;
  ssl_active: string | null;
  rolbypassrls: boolean;
  rolsuper: boolean;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  phase: string;
  source_format: string;
  source_schema_version: string | number | bigint;
  source_file_sha256: string;
  source_data_sha256: string;
  schema_manifest_fingerprint: string;
  table_count: string | number | bigint;
  row_count: string | number | bigint;
  foreign_key_count: string | number | bigint;
  index_count: string | number | bigint;
  default_expression_count: string | number | bigint;
  direct_tenant_rls_table_count: string | number | bigint;
  inherited_tenant_rls_table_count: string | number | bigint;
  mixed_tenant_rls_table_count: string | number | bigint;
  imported_at: string;
  verified_at: string;
  runtime_authority: boolean;
  cutover_ready: boolean;
}

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const SAFE_OBJECT_SOURCE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const LOCAL_POSTGRES_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
let cachedCapabilityProjection: PostgresCutoverCapabilityProjection | null = null;

function schemaName(value: unknown): string {
  const result = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(result) || result === "public" || result.startsWith("pg_")) {
    throw new Error("A PostgreSQL cutover schema must be a safe private identifier between 3 and 63 characters.");
  }
  return result;
}

function identifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error("The PostgreSQL cutover manifest contains an unsafe identifier.");
  return `"${value}"`;
}

function qualified(schema: string, object: string): string {
  return `${identifier(schema)}.${identifier(object)}`;
}

function objectName(value: string): string {
  if (!SAFE_OBJECT_SOURCE.test(value)) throw new Error("The PostgreSQL cutover manifest contains an unsafe object name.");
  if (Buffer.byteLength(value, "utf8") <= 63) return value;
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${value.slice(0, 50)}_${suffix}`;
}

function exactInteger(value: unknown, field: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) throw new Error(`The PostgreSQL cutover ${field} is invalid.`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`The PostgreSQL cutover ${field} is out of range.`);
  return parsed;
}

function isoTimestamp(value: unknown, field: string): string {
  const result = String(value ?? "");
  if (!result || !Number.isFinite(Date.parse(result))) throw new Error(`The PostgreSQL cutover ${field} is invalid.`);
  return result;
}

function hashLine(hash: ReturnType<typeof createHash>, value: unknown): void {
  hash.update(canonicalPortabilityJson(value));
  hash.update("\n");
}

function postgresType(column: PortabilityColumnDescriptor): "TEXT" | "BIGINT" | "BYTEA" {
  if (column.declaredType === "TEXT") return "TEXT";
  if (column.declaredType === "INTEGER") return "BIGINT";
  if (column.declaredType === "BLOB") return "BYTEA";
  throw new Error(`Portable column ${column.name} uses a type not qualified for PostgreSQL cutover.`);
}

function tableSql(schema: string, table: PortabilityTableDescriptor): string {
  const primaryKey = table.columns
    .filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
  const columns = table.columns.map((column) => {
    const nullable = column.notNull || column.primaryKeyPosition > 0 ? " NOT NULL" : "";
    const defaultValue = column.defaultSql === null ? "" : ` DEFAULT ${postgresDefaultSql(column.defaultSql)}`;
    return `${identifier(column.name)} ${postgresType(column)}${nullable}${defaultValue}`;
  });
  columns.push(`PRIMARY KEY (${primaryKey.map((column) => identifier(column.name)).join(", ")})`);
  return `CREATE TABLE ${qualified(schema, table.name)} (${columns.join(", ")})`;
}

function postgresDefaultSql(value: string): string {
  const normalized = value.trim();
  if (INTEGER.test(normalized)) return normalized;
  const quoted = /^'((?:''|[^'])*)'$/.exec(normalized);
  if (quoted?.[1] !== undefined) return postgresRegexLiteral(quoted[1].replaceAll("''", "'"));
  throw new Error("A canonical SQLite default expression is not safely translatable to PostgreSQL.");
}

function foreignKeySql(schema: string, table: PostgresTableSchemaDescriptor): string[] {
  return table.foreignKeys.map((foreignKey) => {
    const from = foreignKey.columns.map((column) => identifier(column.from)).join(", ");
    const to = foreignKey.columns.map((column) => identifier(column.to)).join(", ");
    return `ALTER TABLE ${qualified(schema, table.name)} ADD CONSTRAINT ${identifier(foreignKey.name)} `
      + `FOREIGN KEY (${from}) REFERENCES ${qualified(schema, foreignKey.targetTable)} (${to}) `
      + `ON UPDATE ${foreignKey.onUpdate} ON DELETE ${foreignKey.onDelete}`;
  });
}

function indexSql(schema: string, table: string, index: PostgresIndexDescriptor): string {
  if (/[;]|--|\/\*/.test(index.predicate)) {
    throw new Error("The PostgreSQL cutover manifest contains an unsafe partial-index predicate.");
  }
  const columns = index.columns
    .map((column) => `${identifier(column.name)}${column.descending ? " DESC" : ""}`)
    .join(", ");
  return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${identifier(index.name)} `
    + `ON ${qualified(schema, table)} (${columns})${index.predicate ? ` WHERE ${index.predicate}` : ""}`;
}

function postgresRegexLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqliteGlobRegex(pattern: string): string {
  let result = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      result += ".*";
    } else if (character === "?") {
      result += ".";
    } else if (character === "[") {
      const close = pattern.indexOf("]", index + 1);
      if (close < 0) throw new Error("The SQLite check manifest contains an invalid GLOB class.");
      const body = pattern.slice(index + 1, close);
      if (!body || /[\\]/.test(body)) throw new Error("The SQLite check manifest contains an unsupported GLOB class.");
      result += `[${body}]`;
      index = close;
    } else {
      result += /[.\\+(){}|^$]/.test(character ?? "") ? `\\${character}` : character;
    }
  }
  return `${result}$`;
}

function checkSql(schema: string, table: PostgresTableSchemaDescriptor): string[] {
  return table.checks.map((check) => {
    let expression = check.expression;
    expression = expression.replace(
      /((?:substr\s*\([^()]*\)|[A-Za-z_][A-Za-z0-9_]*))\s+(NOT\s+)?GLOB\s+'([^']*)'/gi,
      (_match, subject: string, negated: string | undefined, pattern: string) =>
        `${subject} ${negated ? "!~" : "~"} ${postgresRegexLiteral(sqliteGlobRegex(pattern))}`
    );
    expression = expression.replace(/\bjson_valid\s*\(/gi, `${qualified(schema, "yoink_json_valid")}(`);
    expression = expression.replace(
      /\bjson_type\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi,
      "jsonb_typeof(($1)::jsonb)"
    );
    expression = expression.replace(
      /\bjulianday\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi,
      "(EXTRACT(EPOCH FROM ($1)::timestamptz) / 86400.0)"
    );
    if (/\b(?:GLOB|json_valid|json_type|julianday)\b/i.test(expression) || /[;]|--|\/\*/.test(expression)) {
      throw new Error(`Canonical check ${check.name} is not safely translatable to PostgreSQL.`);
    }
    return `ALTER TABLE ${qualified(schema, table.name)} ADD CONSTRAINT ${identifier(check.name)} CHECK (${expression})`;
  });
}

function triggerCondition(expression: string): string {
  const translated = expression.replace(
    /strftime\(\s*'%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\s*,\s*'-(30|90) days'\s*\)/gi,
    (_match, days: string) => `to_char((clock_timestamp() - interval '${days} days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  );
  if (/\b(?:strftime|RAISE)\b/i.test(translated) || /[;]|--|\/\*/.test(translated)) {
    throw new Error("A canonical SQLite trigger condition is not safely translatable to PostgreSQL.");
  }
  return translated;
}

function triggerSql(schema: string, table: PostgresTableSchemaDescriptor): string[] {
  const statements: string[] = [];
  for (const trigger of table.triggers) {
    const functionName = objectName(`yoink_trigger_fn_${trigger.name}`);
    const condition = trigger.condition ? triggerCondition(trigger.condition) : "";
    let action: string;
    if (trigger.action.kind === "reject") {
      const rejection = `RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = ${postgresRegexLiteral(trigger.action.message)};`;
      action = condition ? `IF ${condition} THEN ${rejection} END IF;` : rejection;
    } else {
      if (trigger.event !== "INSERT" || trigger.timing !== "AFTER") {
        throw new Error(`Canonical trigger ${trigger.name} has an invalid backfill boundary.`);
      }
      const update = `UPDATE ${qualified(schema, table.name)} SET credential_issued_at = NEW.created_at WHERE id = NEW.id;`;
      action = condition ? `IF ${condition} THEN ${update} END IF;` : update;
    }
    const returned = trigger.event === "DELETE" ? "OLD" : "NEW";
    statements.push(`CREATE FUNCTION ${qualified(schema, functionName)}()
      RETURNS trigger LANGUAGE plpgsql SET search_path TO ${identifier(schema)}, pg_catalog AS $yoink$
      BEGIN
        ${action}
        RETURN ${returned};
      END
      $yoink$`);
    statements.push(
      `CREATE TRIGGER ${identifier(trigger.name)} ${trigger.timing} ${trigger.event} ON ${qualified(schema, table.name)} `
        + `FOR EACH ROW EXECUTE FUNCTION ${qualified(schema, functionName)}()`
    );
  }
  return statements;
}

function rlsSql(schema: string, table: PostgresTableSchemaDescriptor): string[] {
  if (!(table.tenantScopeKind === "direct"
    || table.tenantScopeKind === "inherited"
    || table.tenantScopeKind === "mixed")) return [];
  const policy = objectName(`yoink_tenant_scope_${table.name}`);
  const relation = qualified(schema, table.name);
  const tenantSetting = `NULLIF(current_setting('yoink.tenant_id', true), '')`;
  const condition = table.tenantScopeKind === "direct"
    ? `${identifier("tenant_id")} = ${tenantSetting}`
    : table.tenantOwnershipEdges.map((edge, index) => {
        const alias = `yoink_owner_${index + 1}`;
        const childColumns = edge.columns.map((column) =>
          `${identifier(table.name)}.${identifier(column.from)}`);
        const joins = edge.columns.map((column) =>
          `${identifier(alias)}.${identifier(column.to)} = ${identifier(table.name)}.${identifier(column.from)}`);
        const exists = `EXISTS (SELECT 1 FROM ${qualified(schema, edge.targetTable)} AS ${identifier(alias)} `
          + `WHERE ${joins.join(" AND ")} AND ${identifier(alias)}.${identifier("tenant_id")} = ${tenantSetting})`;
        if (edge.requiredForOwnership) return exists;
        const allNull = childColumns.map((column) => `${column} IS NULL`).join(" AND ");
        const allPresent = childColumns.map((column) => `${column} IS NOT NULL`).join(" AND ");
        return `((${allNull}) OR ((${allPresent}) AND ${exists}))`;
      }).join(" AND ");
  if (!condition) throw new Error(`Tenant-scoped table ${table.name} has no enforceable PostgreSQL ownership policy.`);
  return [
    `ALTER TABLE ${relation} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${relation} FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY ${identifier(policy)} ON ${relation} TO PUBLIC USING (${condition}) WITH CHECK (${condition})`,
    `REVOKE ALL ON TABLE ${relation} FROM PUBLIC`
  ];
}

function decodedParameters(values: PortableValue[]): unknown[] {
  return values.map((value) => {
    const decoded = decodePortabilityValue(value);
    return typeof decoded === "bigint" ? decoded.toString() : decoded;
  });
}

function insertSql(schema: string, table: PortabilityTableDescriptor, rows: PortableValue[][]): {
  sql: string;
  parameters: unknown[];
} {
  if (!rows.length) throw new Error("A PostgreSQL cutover insert batch cannot be empty.");
  const columns = table.columns.map((column) => identifier(column.name)).join(", ");
  const parameters: unknown[] = [];
  const groups = rows.map((row) => {
    if (row.length !== table.columns.length) throw new Error(`Portable table ${table.name} changed during PostgreSQL import.`);
    const decoded = decodedParameters(row);
    const placeholders = decoded.map((value) => {
      parameters.push(value);
      return `$${parameters.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return {
    sql: `INSERT INTO ${qualified(schema, table.name)} (${columns}) VALUES ${groups.join(", ")}`,
    parameters
  };
}

function portablePostgresValue(value: unknown, column: PortabilityColumnDescriptor): PortableValue {
  if (value === null) return null;
  if (column.declaredType === "TEXT") {
    if (typeof value !== "string") throw new Error(`PostgreSQL returned a non-text value for ${column.name}.`);
    return value;
  }
  if (column.declaredType === "INTEGER") {
    const encoded = typeof value === "bigint" ? value.toString() : String(value);
    if (!INTEGER.test(encoded)) throw new Error(`PostgreSQL returned a malformed integer for ${column.name}.`);
    return { $type: "bigint", value: encoded };
  }
  if (column.declaredType === "BLOB") {
    if (Buffer.isBuffer(value)) return { $type: "blob", base64: value.toString("base64") };
    if (ArrayBuffer.isView(value)) {
      return {
        $type: "blob",
        base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64")
      };
    }
    throw new Error(`PostgreSQL returned a malformed byte value for ${column.name}.`);
  }
  throw new Error(`PostgreSQL returned a value for an unsupported type in ${column.name}.`);
}

function receiptQualification(): PostgresCutoverQualification {
  return {
    primaryKeysApplied: true,
    notNullConstraintsApplied: true,
    foreignKeysApplied: true,
    indexesApplied: true,
    defaultExpressionParity: true,
    directTenantRlsApplied: true,
    inheritedTenantRlsApplied: true,
    mixedTenantRlsFailClosed: true,
    tenantScopeClassificationComplete: true,
    checkConstraintParity: true,
    triggerParity: true,
    inheritedTenantRlsParity: true,
    mixedTenantScopeParity: false,
    sharedTableRuntimeRoleParity: false,
    postgresAsyncWorkerStoreImplemented: true,
    postgresAsyncWorkerStoreContractParity: true,
    singleConnectionWorkerLeaseSemanticsQualified: true,
    postgresBackgroundHandlerParity: false,
    asyncRuntimeRepositoryParity: false,
    fleetLeaseContentionQualified: false,
    backupRestoreQualified: false,
    productionIdentityQualified: false,
    runtimeAuthority: false,
    cutoverReady: false
  };
}

export function postgresCutoverCapabilityProjection(): PostgresCutoverCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSchemaManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    minimumServerVersionMajor: POSTGRES_CUTOVER_MINIMUM_MAJOR_VERSION,
    productionDriverImplemented: true,
    oneShotImportImplemented: true,
    exactReconciliationImplemented: true,
    archiveTamperDetection: true,
    dualWriteSupported: false,
    runtimeAuthority: false,
    productionReady: false,
    portableTableCount: manifest.tableCount,
    foreignKeyCount: manifest.foreignKeyCount,
    indexCount: manifest.indexCount,
    defaultExpressionCount: manifest.defaultExpressionCount,
    checkConstraintCount: manifest.checkConstraintCount,
    triggerCount: manifest.triggerCount,
    directTenantRlsTableCount: manifest.directTenantTableCount,
    inheritedTenantPathTableCount: manifest.inheritedTenantPathTableCount,
    noTenantPathTableCount: manifest.noTenantPathTableCount,
    inheritedTenantRlsTableCount: manifest.inheritedTenantTableCount,
    mixedTenantRlsTableCount: manifest.mixedTenantTableCount,
    sharedCatalogTableCount: manifest.sharedCatalogTableCount,
    authorizationCatalogTableCount: manifest.authorizationCatalogTableCount,
    deploymentControlTableCount: manifest.deploymentControlTableCount,
    tenantRegistryTableCount: manifest.tenantRegistryTableCount,
    unresolvedTenantTableCount: manifest.unresolvedTenantTableCount,
    tenantScopeClassificationComplete: true,
    mixedTenantRlsFailClosed: true,
    defaultExpressionParity: true,
    checkConstraintParity: true,
    triggerParity: true,
    inheritedTenantRlsParity: true,
    mixedTenantScopeParity: false,
    sharedTableRuntimeRoleParity: false,
    postgresAsyncWorkerStoreImplemented: true,
    postgresAsyncWorkerStoreContractParity: true,
    singleConnectionWorkerLeaseSemanticsQualified: true,
    postgresBackgroundHandlerParity: false,
    asyncRuntimeRepositoryParity: false,
    fleetLeaseContentionQualified: false,
    backupRestoreQualified: false,
    schemaManifestFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

function receiptFromRow(row: ReceiptRow): PostgresCutoverReceipt {
  if (row.phase !== "verified" || row.source_format !== PORTABILITY_FORMAT
    || !SHA256.test(row.source_file_sha256) || !SHA256.test(row.source_data_sha256)
    || !SHA256.test(row.schema_manifest_fingerprint)
    || row.runtime_authority !== false || row.cutover_ready !== false) {
    throw new Error("The PostgreSQL cutover receipt is incomplete or unsafe.");
  }
  const contractVersion = exactInteger(row.contract_version, "contract version");
  if (contractVersion !== POSTGRES_CUTOVER_CONTRACT_VERSION) {
    throw new Error("The PostgreSQL cutover receipt uses an unsupported contract version.");
  }
  return {
    contractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    phase: "verified",
    sourceFormat: PORTABILITY_FORMAT,
    sourceSchemaVersion: exactInteger(row.source_schema_version, "source schema version"),
    sourceFileSha256: row.source_file_sha256,
    sourceDataSha256: row.source_data_sha256,
    schemaManifestFingerprint: row.schema_manifest_fingerprint,
    tableCount: exactInteger(row.table_count, "table count"),
    rowCount: exactInteger(row.row_count, "row count"),
    foreignKeyCount: exactInteger(row.foreign_key_count, "foreign-key count"),
    indexCount: exactInteger(row.index_count, "index count"),
    defaultExpressionCount: exactInteger(row.default_expression_count, "default-expression count"),
    directTenantRlsTableCount: exactInteger(row.direct_tenant_rls_table_count, "RLS table count"),
    inheritedTenantRlsTableCount: exactInteger(row.inherited_tenant_rls_table_count, "inherited RLS table count"),
    mixedTenantRlsTableCount: exactInteger(row.mixed_tenant_rls_table_count, "mixed RLS table count"),
    importedAt: isoTimestamp(row.imported_at, "import timestamp"),
    verifiedAt: isoTimestamp(row.verified_at, "verification timestamp"),
    qualification: receiptQualification()
  };
}

export function loadPostgresCutoverConnectionConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresCutoverConnectionConfig {
  const connectionString = String(env.YOINK_POSTGRES_URL ?? "").trim();
  if (!connectionString || connectionString.length > 4_096 || /\s/.test(connectionString)) {
    throw new Error("YOINK_POSTGRES_URL must contain one private PostgreSQL connection URI.");
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("YOINK_POSTGRES_URL is not a valid PostgreSQL connection URI.");
  }
  if (!(url.protocol === "postgres:" || url.protocol === "postgresql:") || url.hash) {
    throw new Error("YOINK_POSTGRES_URL must use PostgreSQL without a fragment.");
  }
  for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    if (url.searchParams.has(parameter)) {
      throw new Error("PostgreSQL TLS policy belongs in Yoink deployment configuration, not URI query parameters.");
    }
  }
  const tlsMode = String(env.YOINK_POSTGRES_TLS_MODE ?? "verify-full").trim();
  if (!(tlsMode === "verify-full" || tlsMode === "local-insecure")) {
    throw new Error("YOINK_POSTGRES_TLS_MODE must be verify-full or local-insecure.");
  }
  if (tlsMode === "local-insecure" && !LOCAL_POSTGRES_HOSTS.has(url.hostname)) {
    throw new Error("Insecure PostgreSQL transport is allowed only for an exact loopback host.");
  }
  const caPath = String(env.YOINK_POSTGRES_CA_FILE ?? "").trim();
  const certificateAuthorityPem = caPath ? readFileSync(caPath, "utf8") : "";
  if (certificateAuthorityPem && !certificateAuthorityPem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("YOINK_POSTGRES_CA_FILE does not contain a PEM certificate.");
  }
  return {
    connectionString,
    tlsMode,
    certificateAuthorityPem
  };
}

export class NodePostgresCutoverDatabase implements PostgresCutoverDatabase {
  private readonly pool: Pool;

  constructor(config: PostgresCutoverConnectionConfig) {
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: 2,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_cutover"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.pool.query<T>(sql, [...parameters]);
  }

  async transaction<T>(operation: (session: PostgresQuerySession) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await operation(new NodePostgresSession(client));
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

class NodePostgresSession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export async function inspectPostgresCutoverPreflight(
  database: PostgresQuerySession
): Promise<PostgresCutoverPreflight> {
  const result = await database.query<PreflightRow>(`
    SELECT current_setting('server_version_num') AS server_version_num,
           current_setting('ssl', true) AS ssl_active,
           role.rolbypassrls,
           role.rolsuper
    FROM pg_catalog.pg_roles role
    WHERE role.rolname = current_user
  `);
  const row = result.rows[0];
  if (!row) throw new Error("The PostgreSQL cutover role could not be inspected.");
  const versionNumber = exactInteger(row.server_version_num, "server version");
  const serverVersionMajor = Math.floor(versionNumber / 10_000);
  return {
    contractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    serverVersionMajor,
    minimumServerVersionMajor: POSTGRES_CUTOVER_MINIMUM_MAJOR_VERSION,
    serverVersionSupported: serverVersionMajor >= POSTGRES_CUTOVER_MINIMUM_MAJOR_VERSION,
    tlsActive: row.ssl_active === "on",
    rowSecurityAvailable: serverVersionMajor >= 9,
    skipLockedAvailable: serverVersionMajor >= 9,
    cutoverRoleBypassesRls: row.rolsuper === true || row.rolbypassrls === true,
    productionReady: false
  };
}

async function summarizePostgresTables(
  session: PostgresQuerySession,
  schema: string,
  archive: PortabilityArchiveVerification
): Promise<PortabilityDataSummary> {
  const dataHash = createHash("sha256");
  hashLine(dataHash, {
    format: PORTABILITY_FORMAT,
    schemaVersion: archive.header.schemaVersion,
    migrations: archive.header.migrations,
    tables: archive.header.tables
  });
  const summaries: PortabilityTableSummary[] = [];
  for (const table of archive.header.tables) {
    const tableHash = createHash("sha256");
    hashLine(tableHash, table);
    const primaryKey = table.columns
      .filter((column) => column.primaryKeyPosition > 0)
      .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
    let lastKey: unknown[] = [];
    let rowCount = 0;
    while (true) {
      const parameters = [...lastKey, 500];
      const where = lastKey.length
        ? `WHERE (${primaryKey.map((column) => identifier(column.name)).join(", ")}) > (`
          + `${lastKey.map((_, index) => `$${index + 1}`).join(", ")})`
        : "";
      const result = await session.query(
        `SELECT ${table.columns.map((column) => identifier(column.name)).join(", ")} `
          + `FROM ${qualified(schema, table.name)} ${where} `
          + `ORDER BY ${primaryKey.map((column) => identifier(column.name)).join(", ")} `
          + `LIMIT $${parameters.length}`,
        parameters
      );
      for (const row of result.rows) {
        const values = table.columns.map((column) => portablePostgresValue(row[column.name], column));
        hashLine(tableHash, values);
        rowCount += 1;
      }
      if (result.rows.length < 500) break;
      const finalRow = result.rows.at(-1);
      if (!finalRow) break;
      lastKey = primaryKey.map((column) => finalRow[column.name]);
    }
    const summary = { name: table.name, rowCount, contentSha256: tableHash.digest("hex") };
    summaries.push(summary);
    hashLine(dataHash, summary);
  }
  return {
    schemaVersion: archive.schemaVersion,
    tableCount: summaries.length,
    rowCount: summaries.reduce((count, table) => count + table.rowCount, 0),
    dataSha256: dataHash.digest("hex"),
    tables: summaries
  };
}

async function readReceipt(session: PostgresQuerySession, schema: string): Promise<PostgresCutoverReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${qualified(schema, "yoink_cutover_receipt")} WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) throw new Error("The PostgreSQL cutover receipt is missing or ambiguous.");
  return receiptFromRow(result.rows[0]);
}

export async function verifyPostgresCutoverArchive(
  database: PostgresCutoverDatabase,
  archivePath: string,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA
): Promise<PostgresCutoverImportResult> {
  const schema = schemaName(requestedSchema);
  const archive = verifyPortabilityArchive(archivePath);
  assertPortabilityArchiveCompatibleWithCurrentBuild(archive);
  const manifest = buildPostgresSchemaManifest();
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, schema);
    if (receipt.contractVersion !== POSTGRES_CUTOVER_CONTRACT_VERSION
      || receipt.sourceSchemaVersion !== archive.schemaVersion
      || receipt.sourceFileSha256 !== archive.fileSha256
      || receipt.sourceDataSha256 !== archive.dataSha256
      || receipt.schemaManifestFingerprint !== manifest.fingerprint
      || receipt.tableCount !== archive.tableCount
      || receipt.rowCount !== archive.rowCount
      || receipt.foreignKeyCount !== manifest.foreignKeyCount
      || receipt.indexCount !== manifest.indexCount
      || receipt.defaultExpressionCount !== manifest.defaultExpressionCount
      || receipt.directTenantRlsTableCount !== manifest.directTenantTableCount
      || receipt.inheritedTenantRlsTableCount !== manifest.inheritedTenantTableCount
      || receipt.mixedTenantRlsTableCount !== manifest.mixedTenantTableCount) {
      throw new Error("The PostgreSQL cutover receipt does not match this archive and Yoink build.");
    }
    const databaseSummary = await summarizePostgresTables(session, schema, archive);
    const archivedTables = new Map(archive.tables.map((table) => [table.name, table.contentSha256]));
    const mismatchedTables = databaseSummary.tables
      .filter((table) => archivedTables.get(table.name) !== table.contentSha256)
      .map((table) => table.name);
    return {
      schemaName: schema,
      matched: databaseSummary.dataSha256 === archive.dataSha256 && mismatchedTables.length === 0,
      archiveDataSha256: archive.dataSha256,
      databaseDataSha256: databaseSummary.dataSha256,
      mismatchedTables,
      database: databaseSummary,
      archive,
      receipt,
      manifest
    };
  });
}

export async function importPostgresCutoverArchive(
  database: PostgresCutoverDatabase,
  archivePath: string,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  now = new Date().toISOString()
): Promise<PostgresCutoverImportResult> {
  const schema = schemaName(requestedSchema);
  const archive = verifyPortabilityArchive(archivePath);
  assertPortabilityArchiveCompatibleWithCurrentBuild(archive);
  const manifest = buildPostgresSchemaManifest();
  if (manifest.tableCount !== archive.tableCount) {
    throw new Error("The PostgreSQL cutover manifest does not match the portability table count.");
  }
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.rowSecurityAvailable || !preflight.skipLockedAvailable) {
    throw new Error("The PostgreSQL server does not satisfy the Yoink cutover feature floor.");
  }
  if (!preflight.cutoverRoleBypassesRls) {
    throw new Error("The PostgreSQL cutover role must bypass RLS for whole-dataset reconciliation.");
  }
  const importedAt = isoTimestamp(now, "import timestamp");
  return database.transaction(async (session) => {
    await session.query(`CREATE SCHEMA ${identifier(schema)}`);
    await session.query(`CREATE FUNCTION ${qualified(schema, "yoink_json_valid")}(value TEXT)
      RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
      BEGIN
        PERFORM value::jsonb;
        RETURN TRUE;
      EXCEPTION WHEN others THEN
        RETURN FALSE;
      END
      $$`);
    await session.query(`CREATE TABLE ${qualified(schema, "yoink_cutover_receipt")} (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      contract_version BIGINT NOT NULL CHECK (contract_version = ${POSTGRES_CUTOVER_CONTRACT_VERSION}),
      phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
      source_format TEXT NOT NULL CHECK (source_format = '${PORTABILITY_FORMAT}'),
      source_schema_version BIGINT NOT NULL,
      source_file_sha256 TEXT NOT NULL,
      source_data_sha256 TEXT NOT NULL,
      schema_manifest_fingerprint TEXT NOT NULL,
      table_count BIGINT NOT NULL,
      row_count BIGINT NOT NULL,
      foreign_key_count BIGINT NOT NULL,
      index_count BIGINT NOT NULL,
      default_expression_count BIGINT NOT NULL,
      direct_tenant_rls_table_count BIGINT NOT NULL,
      inherited_tenant_rls_table_count BIGINT NOT NULL,
      mixed_tenant_rls_table_count BIGINT NOT NULL,
      imported_at TEXT NOT NULL,
      verified_at TEXT NOT NULL DEFAULT '',
      runtime_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (runtime_authority = FALSE),
      cutover_ready BOOLEAN NOT NULL DEFAULT FALSE CHECK (cutover_ready = FALSE)
    )`);
    await session.query(
      `INSERT INTO ${qualified(schema, "yoink_cutover_receipt")} (
         id, contract_version, phase, source_format, source_schema_version,
         source_file_sha256, source_data_sha256, schema_manifest_fingerprint,
         table_count, row_count, foreign_key_count, index_count,
         default_expression_count, direct_tenant_rls_table_count,
         inherited_tenant_rls_table_count, mixed_tenant_rls_table_count, imported_at
       ) VALUES ('active', $1, 'loading', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        POSTGRES_CUTOVER_CONTRACT_VERSION,
        PORTABILITY_FORMAT,
        archive.schemaVersion,
        archive.fileSha256,
        archive.dataSha256,
        manifest.fingerprint,
        archive.tableCount,
        archive.rowCount,
        manifest.foreignKeyCount,
        manifest.indexCount,
        manifest.defaultExpressionCount,
        manifest.directTenantTableCount,
        manifest.inheritedTenantTableCount,
        manifest.mixedTenantTableCount,
        importedAt
      ]
    );
    for (const table of archive.header.tables) await session.query(tableSql(schema, table));
    await streamVerifiedPortabilityRows(archivePath, archive, async ({ table, values }) => {
      const insert = insertSql(schema, table, values);
      await session.query(insert.sql, insert.parameters);
    });
    for (const table of manifest.tables) {
      for (const index of table.indexes) await session.query(indexSql(schema, table.name, index));
    }
    for (const table of manifest.tables) {
      for (const sql of foreignKeySql(schema, table)) await session.query(sql);
    }
    for (const table of manifest.tables) {
      for (const sql of checkSql(schema, table)) await session.query(sql);
    }

    const databaseSummary = await summarizePostgresTables(session, schema, archive);
    const archivedTables = new Map(archive.tables.map((table) => [table.name, table.contentSha256]));
    const mismatchedTables = databaseSummary.tables
      .filter((table) => archivedTables.get(table.name) !== table.contentSha256)
      .map((table) => table.name);
    if (databaseSummary.dataSha256 !== archive.dataSha256 || mismatchedTables.length) {
      throw new Error("The PostgreSQL cutover import failed exact logical-data reconciliation.");
    }

    for (const table of manifest.tables) {
      for (const sql of rlsSql(schema, table)) await session.query(sql);
    }
    for (const table of manifest.tables) {
      for (const sql of triggerSql(schema, table)) await session.query(sql);
    }
    const verifiedAt = new Date(Date.parse(importedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${qualified(schema, "yoink_cutover_receipt")}
       SET phase = 'verified', verified_at = $1
       WHERE id = 'active' AND phase = 'loading'`,
      [verifiedAt]
    );
    const receipt = await readReceipt(session, schema);
    return {
      schemaName: schema,
      matched: true,
      archiveDataSha256: archive.dataSha256,
      databaseDataSha256: databaseSummary.dataSha256,
      mismatchedTables: [],
      database: databaseSummary,
      archive,
      receipt,
      manifest
    };
  });
}
