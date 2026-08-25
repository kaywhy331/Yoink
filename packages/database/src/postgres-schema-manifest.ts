import { createHash } from "node:crypto";
import { canonicalPortabilityJson } from "./portability.js";
import { YoinkDatabase } from "./database.js";

export interface PostgresForeignKeyColumn {
  from: string;
  to: string;
}

export interface PostgresForeignKeyDescriptor {
  name: string;
  targetTable: string;
  columns: PostgresForeignKeyColumn[];
  onDelete: "NO ACTION" | "RESTRICT" | "SET NULL" | "SET DEFAULT" | "CASCADE";
  onUpdate: "NO ACTION" | "RESTRICT" | "SET NULL" | "SET DEFAULT" | "CASCADE";
}

export interface PostgresIndexColumn {
  name: string;
  descending: boolean;
}

export interface PostgresIndexDescriptor {
  name: string;
  unique: boolean;
  columns: PostgresIndexColumn[];
  predicate: string;
}

export interface PostgresCheckDescriptor {
  name: string;
  expression: string;
}

export interface PostgresTriggerDescriptor {
  name: string;
  timing: "BEFORE" | "AFTER";
  event: "INSERT" | "UPDATE" | "DELETE";
  condition: string;
  action:
    | { kind: "reject"; message: string }
    | { kind: "credential_issued_at_backfill" };
}

export interface PostgresTableSchemaDescriptor {
  name: string;
  directTenantScope: boolean;
  defaultExpressionCount: number;
  foreignKeys: PostgresForeignKeyDescriptor[];
  indexes: PostgresIndexDescriptor[];
  checks: PostgresCheckDescriptor[];
  checkConstraintCount: number;
  triggers: PostgresTriggerDescriptor[];
}

export interface PostgresSchemaManifest {
  contractVersion: 1;
  tableCount: number;
  foreignKeyCount: number;
  indexCount: number;
  defaultExpressionCount: number;
  checkConstraintCount: number;
  triggerCount: number;
  directTenantTableCount: number;
  inheritedTenantPathTableCount: number;
  noTenantPathTableCount: number;
  fingerprint: string;
  tables: PostgresTableSchemaDescriptor[];
}

interface SchemaTableRow {
  name: string;
  sql: string;
}

interface TableColumnRow {
  name: string;
  dflt_value: string | null;
}

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
}

interface IndexColumnRow {
  seqno: number;
  cid: number;
  name: string | null;
  desc: number;
  key: number;
}

interface IndexSqlRow {
  sql: string | null;
}

interface TriggerRow {
  name: string;
  tbl_name: string;
  sql: string;
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const FOREIGN_KEY_ACTIONS = new Set(["NO ACTION", "RESTRICT", "SET NULL", "SET DEFAULT", "CASCADE"]);

function identifier(value: unknown, context: string): string {
  const result = String(value ?? "");
  if (!SAFE_IDENTIFIER.test(result)) throw new Error(`The canonical SQLite schema contains an unsafe ${context}.`);
  return result;
}

function foreignKeyAction(value: unknown): PostgresForeignKeyDescriptor["onDelete"] {
  const result = String(value ?? "").toUpperCase();
  if (!FOREIGN_KEY_ACTIONS.has(result)) throw new Error("The canonical SQLite schema contains an unsupported foreign-key action.");
  return result as PostgresForeignKeyDescriptor["onDelete"];
}

function quotedSqliteIdentifier(value: string): string {
  return `"${identifier(value, "identifier")}"`;
}

function postgresObjectName(value: string): string {
  const safe = identifier(value, "PostgreSQL object name");
  if (Buffer.byteLength(safe, "utf8") <= 63) return safe;
  const suffix = createHash("sha256").update(safe).digest("hex").slice(0, 12);
  return `${safe.slice(0, 50)}_${suffix}`;
}

function indexPredicate(sql: string | null): string {
  if (!sql) return "";
  const match = /\sWHERE\s+([\s\S]+)$/i.exec(sql.trim());
  return match?.[1]?.trim() ?? "";
}

function checkExpressions(tableName: string, sql: string): PostgresCheckDescriptor[] {
  const results: PostgresCheckDescriptor[] = [];
  const pattern = /\bCHECK\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const start = pattern.lastIndex;
    let depth = 1;
    let singleQuoted = false;
    let doubleQuoted = false;
    let end = -1;
    for (let index = start; index < sql.length; index += 1) {
      const character = sql[index];
      const next = sql[index + 1];
      if (singleQuoted) {
        if (character === "'" && next === "'") {
          index += 1;
        } else if (character === "'") {
          singleQuoted = false;
        }
        continue;
      }
      if (doubleQuoted) {
        if (character === '"' && next === '"') {
          index += 1;
        } else if (character === '"') {
          doubleQuoted = false;
        }
        continue;
      }
      if (character === "'") {
        singleQuoted = true;
      } else if (character === '"') {
        doubleQuoted = true;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0 || singleQuoted || doubleQuoted) {
      throw new Error(`Canonical table ${tableName} contains an unterminated check constraint.`);
    }
    const expression = sql.slice(start, end).trim();
    if (!expression || /[;]|--|\/\*/.test(expression)) {
      throw new Error(`Canonical table ${tableName} contains an unsafe check constraint.`);
    }
    results.push({
      name: postgresObjectName(`yoink_check_${tableName}_${results.length + 1}`),
      expression
    });
    pattern.lastIndex = end + 1;
  }
  return results;
}

function triggerDescriptor(row: TriggerRow): PostgresTriggerDescriptor {
  const name = postgresObjectName(identifier(row.name, "trigger name"));
  const tableName = identifier(row.tbl_name, "trigger table name");
  const match = /^CREATE\s+TRIGGER\s+[A-Za-z_][A-Za-z0-9_]*\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:WHEN\s+([\s\S]*?))?\s*BEGIN\s+([\s\S]*?)\s*END$/i.exec(row.sql.trim());
  if (!match) throw new Error(`Canonical trigger ${name} has an unsupported structure.`);
  const timing = String(match[1]).toUpperCase() as PostgresTriggerDescriptor["timing"];
  const event = String(match[2]).toUpperCase() as PostgresTriggerDescriptor["event"];
  const condition = String(match[3] ?? "").trim();
  const body = String(match[4] ?? "").trim();
  if (/[;]|--|\/\*/.test(condition)) throw new Error(`Canonical trigger ${name} has an unsafe condition.`);
  const rejection = /^SELECT\s+RAISE\s*\(\s*ABORT\s*,\s*'((?:''|[^'])*)'\s*\)\s*;?$/i.exec(body);
  if (rejection?.[1] !== undefined) {
    return {
      name,
      timing,
      event,
      condition,
      action: { kind: "reject", message: rejection[1].replaceAll("''", "'") }
    };
  }
  const normalizedBody = body.replace(/\s+/g, " ").replace(/;$/, "").trim();
  if (name === "extension_devices_credential_insert_backfill"
    && tableName === "extension_devices"
    && timing === "AFTER"
    && event === "INSERT"
    && normalizedBody === "UPDATE extension_devices SET credential_issued_at = NEW.created_at WHERE id = NEW.id") {
    return {
      name,
      timing,
      event,
      condition,
      action: { kind: "credential_issued_at_backfill" }
    };
  }
  throw new Error(`Canonical trigger ${name} has an unsupported action.`);
}

function manifestFingerprint(value: Omit<PostgresSchemaManifest, "fingerprint">): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

export function buildPostgresSchemaManifest(): PostgresSchemaManifest {
  const db = new YoinkDatabase(":memory:");
  try {
    const triggerRows = db.all<TriggerRow>(
      "SELECT name, tbl_name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name"
    );
    const triggers = new Map<string, PostgresTriggerDescriptor[]>();
    for (const row of triggerRows) {
      const table = identifier(row.tbl_name, "trigger table name");
      const descriptors = triggers.get(table) ?? [];
      descriptors.push(triggerDescriptor(row));
      triggers.set(table, descriptors);
    }

    const tableRows = db.all<SchemaTableRow>(`
      SELECT name, sql FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
      ORDER BY name
    `);
    const tables = tableRows.map((row): PostgresTableSchemaDescriptor => {
      const tableName = identifier(row.name, "table name");
      const columns = db.all<TableColumnRow>(`PRAGMA table_xinfo(${quotedSqliteIdentifier(tableName)})`);
      const directTenantScope = columns.some((column) => column.name === "tenant_id");

      const foreignKeyRows = db.all<ForeignKeyRow>(`PRAGMA foreign_key_list(${quotedSqliteIdentifier(tableName)})`);
      const grouped = new Map<number, ForeignKeyRow[]>();
      for (const foreignKey of foreignKeyRows) {
        const rows = grouped.get(Number(foreignKey.id)) ?? [];
        rows.push(foreignKey);
        grouped.set(Number(foreignKey.id), rows);
      }
      const foreignKeys = [...grouped.entries()]
        .sort(([left], [right]) => left - right)
        .map(([id, rows]): PostgresForeignKeyDescriptor => {
          const ordered = [...rows].sort((left, right) => Number(left.seq) - Number(right.seq));
          const first = ordered[0];
          if (!first) throw new Error("The canonical SQLite schema contains an empty foreign key.");
          return {
            name: postgresObjectName(`yoink_fk_${tableName}_${id}`),
            targetTable: identifier(first.table, "foreign-key target table"),
            columns: ordered.map((column) => ({
              from: identifier(column.from, "foreign-key source column"),
              to: identifier(column.to, "foreign-key target column")
            })),
            onDelete: foreignKeyAction(first.on_delete),
            onUpdate: foreignKeyAction(first.on_update)
          };
        });

      const indexes = db.all<IndexListRow>(`PRAGMA index_list(${quotedSqliteIdentifier(tableName)})`)
        .filter((row) => row.origin !== "pk")
        .map((row): PostgresIndexDescriptor => {
          const sqliteName = identifier(row.name, "index name");
          const indexColumns = db.all<IndexColumnRow>(`PRAGMA index_xinfo(${quotedSqliteIdentifier(sqliteName)})`)
            .filter((column) => Number(column.key) === 1)
            .sort((left, right) => Number(left.seqno) - Number(right.seqno));
          if (!indexColumns.length || indexColumns.some((column) => Number(column.cid) < 0 || !column.name)) {
            throw new Error(`Canonical index ${sqliteName} uses an unsupported expression or hidden column.`);
          }
          const sql = db.get<IndexSqlRow>("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?", sqliteName)?.sql ?? null;
          return {
            name: postgresObjectName(sqliteName),
            unique: Number(row.unique) === 1,
            columns: indexColumns.map((column) => ({
              name: identifier(column.name, "index column"),
              descending: Number(column.desc) === 1
            })),
            predicate: indexPredicate(sql)
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));

      const checks = checkExpressions(tableName, row.sql);
      return {
        name: tableName,
        directTenantScope,
        defaultExpressionCount: columns.filter((column) => column.dflt_value !== null).length,
        foreignKeys,
        indexes,
        checks,
        checkConstraintCount: checks.length,
        triggers: [...(triggers.get(tableName) ?? [])].sort((left, right) => left.name.localeCompare(right.name))
      };
    });

    const tenantPathTables = new Set(tables.filter((table) => table.directTenantScope).map((table) => table.name));
    let discoveredTenantPath = true;
    while (discoveredTenantPath) {
      discoveredTenantPath = false;
      for (const table of tables) {
        if (!tenantPathTables.has(table.name)
          && table.foreignKeys.some((foreignKey) => tenantPathTables.has(foreignKey.targetTable))) {
          tenantPathTables.add(table.name);
          discoveredTenantPath = true;
        }
      }
    }
    const directTenantTableCount = tables.filter((table) => table.directTenantScope).length;
    const withoutFingerprint: Omit<PostgresSchemaManifest, "fingerprint"> = {
      contractVersion: 1,
      tableCount: tables.length,
      foreignKeyCount: tables.reduce((count, table) => count + table.foreignKeys.length, 0),
      indexCount: tables.reduce((count, table) => count + table.indexes.length, 0),
      defaultExpressionCount: tables.reduce((count, table) => count + table.defaultExpressionCount, 0),
      checkConstraintCount: tables.reduce((count, table) => count + table.checkConstraintCount, 0),
      triggerCount: tables.reduce((count, table) => count + table.triggers.length, 0),
      directTenantTableCount,
      inheritedTenantPathTableCount: tenantPathTables.size - directTenantTableCount,
      noTenantPathTableCount: tables.length - tenantPathTables.size,
      tables
    };
    return { ...withoutFingerprint, fingerprint: manifestFingerprint(withoutFingerprint) };
  } finally {
    db.close();
  }
}
