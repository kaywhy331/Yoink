#!/usr/bin/env node

import { resolve } from "node:path";
import {
  NodePostgresCutoverDatabase,
  importPostgresCutoverArchive,
  inspectPostgresCutoverPreflight,
  loadPostgresCutoverConnectionConfig,
  verifyPostgresCutoverArchive
} from "../dist/packages/database/src/postgres-cutover.js";

function usage() {
  process.stderr.write(`Usage:
  YOINK_POSTGRES_URL=... npm run postgres:cutover -- preflight
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_CUTOVER_ACK=offline-one-shot npm run postgres:cutover -- import <archive.yoink.ndjson> [private_schema]
  YOINK_POSTGRES_URL=... npm run postgres:cutover -- verify <archive.yoink.ndjson> [private_schema]

TLS defaults to verify-full. local-insecure is accepted only for an exact loopback host.
`);
}

function archivePath(value) {
  if (!value) throw new Error("archive_required");
  return resolve(process.cwd(), value);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/YOINK_POSTGRES_URL|TLS|loopback|certificate/i.test(message)) return "configuration_invalid";
  if (/archive|portability|hash|schema version|manifest/i.test(message)) return "archive_or_schema_invalid";
  if (/already exists|duplicate|reused|CREATE SCHEMA/i.test(message)) return "target_not_empty";
  if (/reconciliation|does not match|mismatch/i.test(message)) return "reconciliation_failed";
  if (/server|feature floor|RLS|role/i.test(message)) return "server_preflight_failed";
  return "postgres_operation_failed";
}

const [command, first, second] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["preflight", "import", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else {
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "preflight") {
      const preflight = await inspectPostgresCutoverPreflight(database);
      print({ operation: "postgres_preflight", ...preflight });
      if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) process.exitCode = 2;
    } else if (command === "import") {
      if (process.env.YOINK_POSTGRES_CUTOVER_ACK !== "offline-one-shot") {
        throw new Error("An offline one-shot cutover acknowledgement is required.");
      }
      const result = await importPostgresCutoverArchive(database, archivePath(first), second);
      print({
        operation: "postgres_import",
        schemaName: result.schemaName,
        matched: result.matched,
        archiveDataSha256: result.archiveDataSha256,
        databaseDataSha256: result.databaseDataSha256,
        tableCount: result.database.tableCount,
        rowCount: result.database.rowCount,
        manifestFingerprint: result.manifest.fingerprint,
        receipt: result.receipt
      });
    } else {
      const result = await verifyPostgresCutoverArchive(database, archivePath(first), second);
      print({
        operation: "postgres_verify",
        schemaName: result.schemaName,
        matched: result.matched,
        archiveDataSha256: result.archiveDataSha256,
        databaseDataSha256: result.databaseDataSha256,
        mismatchedTables: result.mismatchedTables,
        tableCount: result.database.tableCount,
        rowCount: result.database.rowCount,
        receipt: result.receipt
      });
      if (!result.matched) process.exitCode = 2;
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL cutover operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
