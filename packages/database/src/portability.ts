import { createHash, type Hash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { SQLInputValue, StatementSync } from "node:sqlite";
import { nowIso } from "../../domain/src/ids.js";
import { YoinkDatabase } from "./database.js";

export const PORTABILITY_FORMAT = "yoink-portability-ndjson-v1";
export const PORTABILITY_MAX_ROW_BYTES = 16 * 1024 * 1024;

interface MigrationDescriptor {
  version: number;
  name: string;
}

export interface PortabilityColumnDescriptor {
  name: string;
  declaredType: string;
  notNull: boolean;
  defaultSql: string | null;
  primaryKeyPosition: number;
}

export interface PortabilityTableDescriptor {
  name: string;
  columns: PortabilityColumnDescriptor[];
}

export interface PortabilityHeader {
  record: "header";
  format: typeof PORTABILITY_FORMAT;
  generatedAt: string;
  sourceDialect: "sqlite";
  schemaVersion: number;
  migrations: MigrationDescriptor[];
  tables: PortabilityTableDescriptor[];
}

export interface PortabilityTableSummary {
  name: string;
  rowCount: number;
  contentSha256: string;
}

export interface PortabilityDataSummary {
  schemaVersion: number;
  tableCount: number;
  rowCount: number;
  dataSha256: string;
  tables: PortabilityTableSummary[];
}

export interface PortabilityArchiveVerification extends PortabilityDataSummary {
  header: PortabilityHeader;
  fileSha256: string;
  byteLength: number;
}

export interface PortabilityParityResult {
  matched: boolean;
  archiveDataSha256: string;
  databaseDataSha256: string;
  mismatchedTables: string[];
  database: PortabilityDataSummary;
  archive: PortabilityArchiveVerification;
}

export type PortableTaggedValue =
  | { $type: "bigint"; value: string }
  | { $type: "blob"; base64: string };
export type PortableValue = null | string | number | PortableTaggedValue;
type JsonRecord = Record<string, unknown>;

export interface PortabilityRowBatch {
  table: PortabilityTableDescriptor;
  values: PortableValue[][];
}

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden: number;
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function canonicalPortabilityJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Portability data contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalPortabilityJson(entry)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as JsonRecord;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalPortabilityJson(record[key])}`).join(",")}}`;
  }
  throw new Error("Portability data contains an unsupported value.");
}

function hashLine(hash: Hash, value: unknown): void {
  hash.update(canonicalPortabilityJson(value));
  hash.update("\n");
}

function quoteIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error(`Unsafe SQLite identifier in portability schema: ${value}`);
  return `"${value}"`;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, keys: readonly string[], context: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${context} contains unexpected or missing fields.`);
  }
}

function requiredString(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error(`Invalid portability ${field}.`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`Invalid portability ${field}.`);
  return Number(value);
}

function encodeValue(value: unknown): PortableValue {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("SQLite returned a non-finite number during portability export.");
    return value;
  }
  if (typeof value === "bigint") return { $type: "bigint", value: value.toString() };
  if (ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return { $type: "blob", base64: bytes.toString("base64") };
  }
  throw new Error("SQLite returned an unsupported value during portability export.");
}

export function decodePortabilityValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!isRecord(value)) throw new Error("A portability row contains an unsupported value.");
  if (value.$type === "bigint") {
    exactKeys(value, ["$type", "value"], "A bigint portability value");
    const encoded = requiredString(value.value, "bigint value", 40);
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(encoded)) throw new Error("A portability bigint is malformed.");
    return BigInt(encoded);
  }
  if (value.$type === "blob") {
    exactKeys(value, ["$type", "base64"], "A blob portability value");
    if (typeof value.base64 !== "string" || value.base64.length > PORTABILITY_MAX_ROW_BYTES * 2) {
      throw new Error("A portability blob is malformed.");
    }
    const decoded = Buffer.from(value.base64, "base64");
    if (decoded.toString("base64") !== value.base64) throw new Error("A portability blob is not canonical base64.");
    return decoded;
  }
  throw new Error("A portability row contains an unknown tagged value.");
}

function migrations(db: YoinkDatabase): MigrationDescriptor[] {
  const result = db.all<MigrationDescriptor>("SELECT version, name FROM schema_migrations ORDER BY version");
  if (!result.length) throw new Error("The source database has no applied Yoink migrations.");
  for (let index = 0; index < result.length; index += 1) {
    const migration = result[index];
    if (!migration || !Number.isSafeInteger(migration.version) || migration.version <= 0 || !migration.name) {
      throw new Error("The source database has an invalid migration ledger.");
    }
    if (index > 0 && migration.version <= (result[index - 1]?.version ?? 0)) {
      throw new Error("The source database migration ledger is not strictly ordered.");
    }
  }
  return result;
}

function tableDescriptors(db: YoinkDatabase): PortabilityTableDescriptor[] {
  const names = db.all<{ name: string }>(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
    ORDER BY name
  `);
  if (!names.length) throw new Error("The source database has no portable application tables.");
  return names.map(({ name }) => {
    quoteIdentifier(name);
    const info = db.all<TableInfoRow>(`PRAGMA table_xinfo(${quoteIdentifier(name)})`);
    if (!info.length) throw new Error(`Portable table ${name} has no columns.`);
    if (info.some((column) => Number(column.hidden) !== 0)) {
      throw new Error(`Portable table ${name} uses generated or hidden columns that require a new archive format.`);
    }
    const columns = info.map((column) => {
      quoteIdentifier(column.name);
      return {
        name: column.name,
        declaredType: String(column.type ?? "").trim().toUpperCase(),
        notNull: Number(column.notnull) === 1,
        defaultSql: column.dflt_value === null ? null : String(column.dflt_value),
        primaryKeyPosition: Number(column.pk)
      };
    });
    const primaryKey = columns.filter((column) => column.primaryKeyPosition > 0)
      .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
    if (!primaryKey.length || primaryKey.some((column, index) => column.primaryKeyPosition !== index + 1)) {
      throw new Error(`Portable table ${name} must have a stable primary key.`);
    }
    return { name, columns };
  });
}

function dataHashSeed(header: Pick<PortabilityHeader, "schemaVersion" | "migrations" | "tables">): Hash {
  const hash = createHash("sha256");
  hashLine(hash, {
    format: PORTABILITY_FORMAT,
    schemaVersion: header.schemaVersion,
    migrations: header.migrations,
    tables: header.tables
  });
  return hash;
}

function tableHashSeed(table: PortabilityTableDescriptor): Hash {
  const hash = createHash("sha256");
  hashLine(hash, table);
  return hash;
}

function selectSql(table: PortabilityTableDescriptor): string {
  const columns = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const primaryKey = table.columns.filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
    .map((column) => quoteIdentifier(column.name));
  return `SELECT ${columns} FROM ${quoteIdentifier(table.name)} ORDER BY ${primaryKey.join(", ")}`;
}

function summarizeTable(db: YoinkDatabase, table: PortabilityTableDescriptor): PortabilityTableSummary {
  const hash = tableHashSeed(table);
  let rowCount = 0;
  const statement = db.connection.prepare(selectSql(table));
  statement.setReadBigInts(true);
  for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
    const values = table.columns.map((column) => encodeValue(row[column.name]));
    hashLine(hash, values);
    rowCount += 1;
  }
  return { name: table.name, rowCount, contentSha256: hash.digest("hex") };
}

function completeDataSummary(
  schemaVersion: number,
  tables: PortabilityTableSummary[],
  dataHash: Hash
): PortabilityDataSummary {
  for (const table of tables) hashLine(dataHash, table);
  return {
    schemaVersion,
    tableCount: tables.length,
    rowCount: tables.reduce((total, table) => total + table.rowCount, 0),
    dataSha256: dataHash.digest("hex"),
    tables
  };
}

export function summarizePortableDatabase(db: YoinkDatabase): PortabilityDataSummary {
  return db.readTransaction(() => {
    const migrationList = migrations(db);
    const tables = tableDescriptors(db);
    const schemaVersion = migrationList.at(-1)?.version ?? 0;
    const summaries = tables.map((table) => summarizeTable(db, table));
    return completeDataSummary(schemaVersion, summaries, dataHashSeed({ schemaVersion, migrations: migrationList, tables }));
  });
}

class ArchiveWriter {
  private readonly hash = createHash("sha256");
  private bytes = 0;

  constructor(private readonly descriptor: number) {}

  write(value: unknown): void {
    const body = Buffer.from(`${canonicalPortabilityJson(value)}\n`, "utf8");
    let offset = 0;
    while (offset < body.length) offset += writeSync(this.descriptor, body, offset);
    this.hash.update(body);
    this.bytes += body.length;
  }

  finish(): { fileSha256: string; byteLength: number } {
    return { fileSha256: this.hash.digest("hex"), byteLength: this.bytes };
  }
}

export function exportPortabilityArchive(
  db: YoinkDatabase,
  filePath: string,
  generatedAt = nowIso()
): PortabilityArchiveVerification {
  if (!filePath || filePath === ":memory:") throw new Error("A portability archive requires an explicit file path.");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("A portability archive requires a valid generation timestamp.");
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  let descriptor: number | null = null;
  let created = false;
  let completed = false;
  try {
    descriptor = openSync(filePath, "wx", 0o600);
    created = true;
    const writer = new ArchiveWriter(descriptor);
    const result = db.readTransaction(() => {
      const migrationList = migrations(db);
      const tables = tableDescriptors(db);
      const schemaVersion = migrationList.at(-1)?.version ?? 0;
      const header: PortabilityHeader = {
        record: "header",
        format: PORTABILITY_FORMAT,
        generatedAt,
        sourceDialect: "sqlite",
        schemaVersion,
        migrations: migrationList,
        tables
      };
      writer.write(header);
      const dataHash = dataHashSeed(header);
      const summaries: PortabilityTableSummary[] = [];
      for (const table of tables) {
        writer.write({ record: "table_start", table: table.name });
        const tableHash = tableHashSeed(table);
        let rowCount = 0;
        const statement = db.connection.prepare(selectSql(table));
        statement.setReadBigInts(true);
        for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
          const values = table.columns.map((column) => encodeValue(row[column.name]));
          const rowRecord = { record: "row", values };
          writer.write(rowRecord);
          hashLine(tableHash, values);
          rowCount += 1;
        }
        const summary = { name: table.name, rowCount, contentSha256: tableHash.digest("hex") };
        summaries.push(summary);
        writer.write({ record: "table_end", table: table.name, rowCount, contentSha256: summary.contentSha256 });
      }
      const summary = completeDataSummary(schemaVersion, summaries, dataHash);
      writer.write({
        record: "footer",
        tableCount: summary.tableCount,
        rowCount: summary.rowCount,
        dataSha256: summary.dataSha256
      });
      return { header, summary };
    });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    chmodSync(filePath, 0o600);
    const file = writer.finish();
    completed = true;
    return { ...result.summary, ...file, header: result.header };
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (created && !completed && existsSync(filePath)) unlinkSync(filePath);
  }
}

function parseJsonLine(line: Buffer, lineNumber: number): JsonRecord {
  if (!line.length) throw new Error(`Portability archive line ${lineNumber} is empty.`);
  if (line.length > PORTABILITY_MAX_ROW_BYTES) {
    throw new Error(`Portability archive line ${lineNumber} exceeds the ${PORTABILITY_MAX_ROW_BYTES}-byte row limit.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
  } catch {
    throw new Error(`Portability archive line ${lineNumber} is not valid canonical UTF-8 JSON.`);
  }
  if (!isRecord(parsed)) throw new Error(`Portability archive line ${lineNumber} is not an object record.`);
  return parsed;
}

function scanLines(filePath: string, visitor: (record: JsonRecord, lineNumber: number) => void): {
  fileSha256: string;
  byteLength: number;
} {
  const size = statSync(filePath).size;
  if (size <= 0) throw new Error("The portability archive is empty.");
  const descriptor = openSync(filePath, "r");
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let pending = Buffer.alloc(0);
  let bytes = 0;
  let lineNumber = 0;
  try {
    while (true) {
      const count = readSync(descriptor, chunk, 0, chunk.length, null);
      if (!count) break;
      const body = Buffer.from(chunk.subarray(0, count));
      hash.update(body);
      bytes += body.length;
      pending = pending.length ? Buffer.concat([pending, body]) : body;
      let lineStart = 0;
      while (true) {
        const newline = pending.indexOf(0x0a, lineStart);
        if (newline < 0) break;
        lineNumber += 1;
        visitor(parseJsonLine(pending.subarray(lineStart, newline), lineNumber), lineNumber);
        lineStart = newline + 1;
      }
      pending = pending.subarray(lineStart);
      if (pending.length > PORTABILITY_MAX_ROW_BYTES) {
        throw new Error(`Portability archive line ${lineNumber + 1} exceeds the ${PORTABILITY_MAX_ROW_BYTES}-byte row limit.`);
      }
    }
    if (pending.length) throw new Error("The portability archive is truncated or lacks a final newline.");
    return { fileSha256: hash.digest("hex"), byteLength: bytes };
  } finally {
    closeSync(descriptor);
  }
}

function validateColumn(value: unknown): PortabilityColumnDescriptor {
  if (!isRecord(value)) throw new Error("A portability column descriptor is malformed.");
  exactKeys(value, ["name", "declaredType", "notNull", "defaultSql", "primaryKeyPosition"], "A portability column descriptor");
  const name = requiredString(value.name, "column name", 128);
  if (!SAFE_IDENTIFIER.test(name)) throw new Error("A portability column name is unsafe.");
  const declaredType = typeof value.declaredType === "string" && value.declaredType.length <= 64 ? value.declaredType : "";
  if (!/^[A-Z0-9_ (),]*$/.test(declaredType)) throw new Error("A portability declared type is invalid.");
  if (typeof value.notNull !== "boolean") throw new Error("A portability not-null flag is invalid.");
  if (value.defaultSql !== null && (typeof value.defaultSql !== "string" || value.defaultSql.length > 512)) {
    throw new Error("A portability default expression is invalid.");
  }
  return {
    name,
    declaredType,
    notNull: value.notNull,
    defaultSql: value.defaultSql as string | null,
    primaryKeyPosition: requiredInteger(value.primaryKeyPosition, "primary-key position")
  };
}

function validateTable(value: unknown): PortabilityTableDescriptor {
  if (!isRecord(value)) throw new Error("A portability table descriptor is malformed.");
  exactKeys(value, ["name", "columns"], "A portability table descriptor");
  const name = requiredString(value.name, "table name", 128);
  if (!SAFE_IDENTIFIER.test(name) || name === "schema_migrations" || name.startsWith("sqlite_")) {
    throw new Error("A portability table name is unsafe.");
  }
  if (!Array.isArray(value.columns) || !value.columns.length || value.columns.length > 512) {
    throw new Error(`Portable table ${name} has an invalid column list.`);
  }
  const columns = value.columns.map(validateColumn);
  if (new Set(columns.map((column) => column.name)).size !== columns.length) {
    throw new Error(`Portable table ${name} contains duplicate columns.`);
  }
  const primaryKey = columns.filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
  if (!primaryKey.length || primaryKey.some((column, index) => column.primaryKeyPosition !== index + 1)) {
    throw new Error(`Portable table ${name} lacks a stable primary key.`);
  }
  return { name, columns };
}

function validateHeader(value: JsonRecord): PortabilityHeader {
  exactKeys(value, ["record", "format", "generatedAt", "sourceDialect", "schemaVersion", "migrations", "tables"], "The portability header");
  if (value.record !== "header" || value.format !== PORTABILITY_FORMAT || value.sourceDialect !== "sqlite") {
    throw new Error("The portability archive format or source dialect is unsupported.");
  }
  const generatedAt = requiredString(value.generatedAt, "generation timestamp", 64);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("The portability generation timestamp is invalid.");
  if (!Array.isArray(value.migrations) || !value.migrations.length || value.migrations.length > 10_000) {
    throw new Error("The portability migration ledger is invalid.");
  }
  const migrationList = value.migrations.map((migration, index) => {
    if (!isRecord(migration)) throw new Error("A portability migration descriptor is malformed.");
    exactKeys(migration, ["version", "name"], "A portability migration descriptor");
    const result = {
      version: requiredInteger(migration.version, "migration version", 1),
      name: requiredString(migration.name, "migration name", 256)
    };
    if (index > 0 && result.version <= requiredInteger((value.migrations as JsonRecord[])[index - 1]?.version, "migration version", 1)) {
      throw new Error("The portability migration ledger is not strictly ordered.");
    }
    return result;
  });
  const schemaVersion = requiredInteger(value.schemaVersion, "schema version", 1);
  if (migrationList.at(-1)?.version !== schemaVersion) throw new Error("The portability schema version does not match its migration ledger.");
  if (!Array.isArray(value.tables) || !value.tables.length || value.tables.length > 10_000) {
    throw new Error("The portability table manifest is invalid.");
  }
  const tables = value.tables.map(validateTable);
  const names = tables.map((table) => table.name);
  if (new Set(names).size !== names.length || [...names].sort().some((name, index) => name !== names[index])) {
    throw new Error("The portability table manifest is duplicated or not deterministically ordered.");
  }
  return {
    record: "header",
    format: PORTABILITY_FORMAT,
    generatedAt,
    sourceDialect: "sqlite",
    schemaVersion,
    migrations: migrationList,
    tables
  };
}

function validateRowValues(value: unknown, table: PortabilityTableDescriptor): PortableValue[] {
  if (!Array.isArray(value) || value.length !== table.columns.length) {
    throw new Error(`A portability row for ${table.name} has the wrong column count.`);
  }
  for (const entry of value) decodePortabilityValue(entry);
  return value as PortableValue[];
}

export function verifyPortabilityArchive(filePath: string): PortabilityArchiveVerification {
  let header: PortabilityHeader | null = null;
  let currentTable: PortabilityTableDescriptor | null = null;
  let currentHash: Hash | null = null;
  let currentRows = 0;
  let tableIndex = 0;
  let footerSeen = false;
  let dataHash: Hash | null = null;
  const summaries: PortabilityTableSummary[] = [];
  let footerRowCount = 0;
  let footerTableCount = 0;
  let footerDataSha256 = "";
  const file = scanLines(filePath, (record, lineNumber) => {
    if (!header) {
      if (lineNumber !== 1) throw new Error("The portability header must be the first record.");
      header = validateHeader(record);
      dataHash = dataHashSeed(header);
      return;
    }
    if (footerSeen) throw new Error("The portability archive contains records after its footer.");
    if (!currentTable) {
      if (tableIndex < header.tables.length) {
        exactKeys(record, ["record", "table"], "A portability table-start record");
        const expected = header.tables[tableIndex];
        if (record.record !== "table_start" || record.table !== expected?.name || !expected) {
          throw new Error("The portability table sequence does not match its manifest.");
        }
        currentTable = expected;
        currentHash = tableHashSeed(expected);
        currentRows = 0;
        return;
      }
      exactKeys(record, ["record", "tableCount", "rowCount", "dataSha256"], "The portability footer");
      if (record.record !== "footer") throw new Error("The portability archive footer is missing.");
      footerTableCount = requiredInteger(record.tableCount, "footer table count");
      footerRowCount = requiredInteger(record.rowCount, "footer row count");
      footerDataSha256 = requiredString(record.dataSha256, "footer data hash", 64);
      if (!SHA256.test(footerDataSha256)) throw new Error("The portability footer data hash is invalid.");
      footerSeen = true;
      return;
    }
    if (record.record === "row") {
      exactKeys(record, ["record", "values"], `A portability row for ${currentTable.name}`);
      const values = validateRowValues(record.values, currentTable);
      hashLine(currentHash as Hash, values);
      currentRows += 1;
      return;
    }
    exactKeys(record, ["record", "table", "rowCount", "contentSha256"], `The portability table-end record for ${currentTable.name}`);
    if (record.record !== "table_end" || record.table !== currentTable.name) {
      throw new Error(`Portable table ${currentTable.name} is missing its end record.`);
    }
    const declaredRows = requiredInteger(record.rowCount, "table row count");
    const declaredHash = requiredString(record.contentSha256, "table content hash", 64);
    const actualHash = (currentHash as Hash).digest("hex");
    if (declaredRows !== currentRows || !SHA256.test(declaredHash) || declaredHash !== actualHash) {
      throw new Error(`Portable table ${currentTable.name} failed its row-count or content-hash check.`);
    }
    const summary = { name: currentTable.name, rowCount: currentRows, contentSha256: actualHash };
    summaries.push(summary);
    hashLine(dataHash as Hash, summary);
    currentTable = null;
    currentHash = null;
    currentRows = 0;
    tableIndex += 1;
  });
  const finalHeader = header as PortabilityHeader | null;
  const finalDataHash = dataHash as Hash | null;
  if (!finalHeader || currentTable || !footerSeen || tableIndex !== finalHeader.tables.length || !finalDataHash) {
    throw new Error("The portability archive is incomplete.");
  }
  const rowCount = summaries.reduce((total, table) => total + table.rowCount, 0);
  const dataSha256 = finalDataHash.digest("hex");
  if (footerTableCount !== summaries.length || footerRowCount !== rowCount || footerDataSha256 !== dataSha256) {
    throw new Error("The portability archive footer failed its aggregate count or data-hash check.");
  }
  return {
    header: finalHeader,
    schemaVersion: finalHeader.schemaVersion,
    tableCount: summaries.length,
    rowCount,
    dataSha256,
    tables: summaries,
    ...file
  };
}

export async function streamVerifiedPortabilityRows(
  filePath: string,
  expected: PortabilityArchiveVerification,
  consumer: (batch: PortabilityRowBatch) => Promise<void> | void,
  batchSize = 250
): Promise<void> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("A portability stream batch must contain 1 through 1000 rows.");
  }
  const before = verifyPortabilityArchive(filePath);
  if (before.fileSha256 !== expected.fileSha256
    || before.byteLength !== expected.byteLength
    || before.dataSha256 !== expected.dataSha256) {
    throw new Error("The portability archive changed before streaming began.");
  }

  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let tableIndex = -1;
  let currentTable: PortabilityTableDescriptor | null = null;
  let currentRows = 0;
  let batch: PortableValue[][] = [];
  let headerSeen = false;
  let footerSeen = false;

  const flush = async (): Promise<void> => {
    if (!currentTable || !batch.length) return;
    const values = batch;
    batch = [];
    await consumer({ table: currentTable, values });
  };

  try {
    for await (const line of lines) {
      lineNumber += 1;
      const record = parseJsonLine(Buffer.from(line, "utf8"), lineNumber);
      if (!headerSeen) {
        const header = validateHeader(record);
        if (canonicalPortabilityJson(header) !== canonicalPortabilityJson(expected.header)) {
          throw new Error("The portability archive header changed during streaming.");
        }
        headerSeen = true;
        continue;
      }
      if (footerSeen) throw new Error("The portability archive contains records after its footer.");
      if (!currentTable) {
        if (record.record === "footer") {
          exactKeys(record, ["record", "tableCount", "rowCount", "dataSha256"], "The portability footer");
          if (tableIndex + 1 !== expected.header.tables.length
            || Number(record.tableCount) !== expected.tableCount
            || Number(record.rowCount) !== expected.rowCount
            || record.dataSha256 !== expected.dataSha256) {
            throw new Error("The portability archive footer changed during streaming.");
          }
          footerSeen = true;
          continue;
        }
        exactKeys(record, ["record", "table"], "A portability table-start record");
        tableIndex += 1;
        currentTable = expected.header.tables[tableIndex] ?? null;
        currentRows = 0;
        if (!currentTable || record.record !== "table_start" || record.table !== currentTable.name) {
          throw new Error("The portability table sequence changed during streaming.");
        }
        continue;
      }
      if (record.record === "row") {
        exactKeys(record, ["record", "values"], `A portability row for ${currentTable.name}`);
        batch.push(validateRowValues(record.values, currentTable));
        currentRows += 1;
        if (batch.length >= batchSize) await flush();
        continue;
      }
      exactKeys(record, ["record", "table", "rowCount", "contentSha256"], `The portability table-end record for ${currentTable.name}`);
      const expectedSummary = expected.tables[tableIndex];
      if (record.record !== "table_end"
        || record.table !== currentTable.name
        || Number(record.rowCount) !== currentRows
        || Number(record.rowCount) !== expectedSummary?.rowCount
        || record.contentSha256 !== expectedSummary?.contentSha256) {
        throw new Error(`Portable table ${currentTable.name} changed during streaming.`);
      }
      await flush();
      currentTable = null;
      currentRows = 0;
    }
  } finally {
    lines.close();
    input.destroy();
  }

  if (!headerSeen || !footerSeen || currentTable || tableIndex + 1 !== expected.header.tables.length) {
    throw new Error("The portability archive became incomplete during streaming.");
  }
  const after = verifyPortabilityArchive(filePath);
  if (after.fileSha256 !== expected.fileSha256
    || after.byteLength !== expected.byteLength
    || after.dataSha256 !== expected.dataSha256) {
    throw new Error("The portability archive changed during streaming.");
  }
}

function assertCompatibleSchema(db: YoinkDatabase, archive: PortabilityArchiveVerification): void {
  const currentMigrations = migrations(db);
  const currentTables = tableDescriptors(db);
  if (canonicalPortabilityJson(currentMigrations) !== canonicalPortabilityJson(archive.header.migrations)) {
    throw new Error("The portability archive migration ledger does not exactly match this Yoink build.");
  }
  if (canonicalPortabilityJson(currentTables) !== canonicalPortabilityJson(archive.header.tables)) {
    throw new Error("The portability archive table schema does not exactly match this Yoink build.");
  }
}

export function assertPortabilityArchiveCompatibleWithCurrentBuild(
  archive: PortabilityArchiveVerification
): void {
  const current = new YoinkDatabase(":memory:");
  try {
    assertCompatibleSchema(current, archive);
  } finally {
    current.close();
  }
}

export function compareDatabaseToPortabilityArchive(
  db: YoinkDatabase,
  filePath: string
): PortabilityParityResult {
  const archive = verifyPortabilityArchive(filePath);
  assertCompatibleSchema(db, archive);
  const database = summarizePortableDatabase(db);
  const archivedTables = new Map(archive.tables.map((table) => [table.name, table.contentSha256]));
  const currentTables = new Map(database.tables.map((table) => [table.name, table.contentSha256]));
  const names = new Set([...archivedTables.keys(), ...currentTables.keys()]);
  const mismatchedTables = [...names].filter((name) => archivedTables.get(name) !== currentTables.get(name)).sort();
  return {
    matched: database.dataSha256 === archive.dataSha256 && mismatchedTables.length === 0,
    archiveDataSha256: archive.dataSha256,
    databaseDataSha256: database.dataSha256,
    mismatchedTables,
    database,
    archive
  };
}

function removeCreatedDatabaseFiles(filePath: string): void {
  for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
}

function importVerifiedRows(
  db: YoinkDatabase,
  filePath: string,
  archive: PortabilityArchiveVerification
): void {
  let tableIndex = -1;
  let table: PortabilityTableDescriptor | null = null;
  let statement: StatementSync | null = null;
  const rescanned = scanLines(filePath, (record) => {
    if (record.record === "header" || record.record === "footer" || record.record === "table_end") return;
    if (record.record === "table_start") {
      tableIndex += 1;
      table = archive.header.tables[tableIndex] ?? null;
      if (!table || record.table !== table.name) throw new Error("The portability archive changed during restore.");
      const columns = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
      const placeholders = table.columns.map(() => "?").join(", ");
      statement = db.connection.prepare(`INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders})`);
      return;
    }
    if (record.record !== "row" || !table || !statement) throw new Error("The portability archive changed during restore.");
    const values = validateRowValues(record.values, table).map(decodePortabilityValue);
    statement.run(...values);
  });
  if (rescanned.fileSha256 !== archive.fileSha256 || rescanned.byteLength !== archive.byteLength) {
    throw new Error("The portability archive changed during restore.");
  }
}

export function restorePortabilityArchiveToNewDatabase(
  filePath: string,
  destinationPath: string
): PortabilityParityResult {
  if (!destinationPath || destinationPath === ":memory:") throw new Error("A restored database requires an explicit new file path.");
  for (const candidate of [destinationPath, `${destinationPath}-wal`, `${destinationPath}-shm`]) {
    if (existsSync(candidate)) throw new Error("The restore destination or one of its SQLite sidecar files already exists.");
  }
  const archive = verifyPortabilityArchive(filePath);
  let destination: YoinkDatabase | null = null;
  try {
    destination = new YoinkDatabase(destinationPath);
    assertCompatibleSchema(destination, archive);
    destination.exec("PRAGMA foreign_keys = OFF");
    destination.transaction(() => {
      for (const table of [...archive.header.tables].reverse()) {
        destination?.exec(`DELETE FROM ${quoteIdentifier(table.name)}`);
      }
      importVerifiedRows(destination as YoinkDatabase, filePath, archive);
    });
    destination.exec("PRAGMA foreign_keys = ON");
    const foreignKeyFailures = destination.all<Record<string, unknown>>("PRAGMA foreign_key_check");
    if (foreignKeyFailures.length) throw new Error("The restored database failed foreign-key validation.");
    destination.assertIntegrity();
    const database = summarizePortableDatabase(destination);
    const mismatchedTables = database.tables
      .filter((table, index) => table.contentSha256 !== archive.tables[index]?.contentSha256)
      .map((table) => table.name);
    if (database.dataSha256 !== archive.dataSha256 || mismatchedTables.length) {
      throw new Error("The restored database failed exact portability parity validation.");
    }
    const result: PortabilityParityResult = {
      matched: true,
      archiveDataSha256: archive.dataSha256,
      databaseDataSha256: database.dataSha256,
      mismatchedTables: [],
      database,
      archive
    };
    destination.close();
    destination = null;
    return result;
  } catch (error) {
    try {
      destination?.close();
    } finally {
      removeCreatedDatabaseFiles(destinationPath);
    }
    throw error;
  }
}
