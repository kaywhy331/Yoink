#!/usr/bin/env node

import { resolve } from "node:path";
import { YoinkDatabase } from "../dist/packages/database/src/database.js";
import {
  compareDatabaseToPortabilityArchive,
  exportPortabilityArchive,
  restorePortabilityArchiveToNewDatabase,
  verifyPortabilityArchive
} from "../dist/packages/database/src/portability.js";

function usage() {
  process.stderr.write(`Usage:
  npm run portability -- export <source.sqlite> <archive.yoink.ndjson>
  npm run portability -- verify <archive.yoink.ndjson>
  npm run portability -- compare <source.sqlite> <archive.yoink.ndjson>
  npm run portability -- restore <archive.yoink.ndjson> <new.sqlite>
  npm run portability -- drill <source.sqlite> <archive.yoink.ndjson> <new.sqlite>
`);
}

function pathArgument(value, label) {
  if (!value) throw new Error(`Missing ${label} path.`);
  return resolve(process.cwd(), value);
}

function withReadOnlyDatabase(filePath, operation) {
  const db = new YoinkDatabase(filePath, { readOnly: true });
  try {
    return operation(db);
  } finally {
    db.close();
  }
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const [command, first, second] = process.argv.slice(2);

try {
  if (command === "export") {
    const sourcePath = pathArgument(first, "source database");
    const archivePath = pathArgument(second, "archive");
    const result = withReadOnlyDatabase(sourcePath, (db) => exportPortabilityArchive(db, archivePath));
    print({ operation: "export", sourcePath, archivePath, ...result, header: undefined });
  } else if (command === "verify") {
    const archivePath = pathArgument(first, "archive");
    const result = verifyPortabilityArchive(archivePath);
    print({ operation: "verify", archivePath, verified: true, ...result, header: undefined });
  } else if (command === "compare") {
    const sourcePath = pathArgument(first, "source database");
    const archivePath = pathArgument(second, "archive");
    const result = withReadOnlyDatabase(sourcePath, (db) => compareDatabaseToPortabilityArchive(db, archivePath));
    print({
      operation: "compare",
      sourcePath,
      archivePath,
      matched: result.matched,
      archiveDataSha256: result.archiveDataSha256,
      databaseDataSha256: result.databaseDataSha256,
      mismatchedTables: result.mismatchedTables
    });
    if (!result.matched) process.exitCode = 2;
  } else if (command === "restore") {
    const archivePath = pathArgument(first, "archive");
    const destinationPath = pathArgument(second, "new database");
    const result = restorePortabilityArchiveToNewDatabase(archivePath, destinationPath);
    print({
      operation: "restore",
      archivePath,
      destinationPath,
      matched: result.matched,
      dataSha256: result.databaseDataSha256,
      tableCount: result.database.tableCount,
      rowCount: result.database.rowCount
    });
  } else if (command === "drill") {
    const sourcePath = pathArgument(first, "source database");
    const archivePath = pathArgument(second, "archive");
    const destinationPath = pathArgument(process.argv[5], "new database");
    const exported = withReadOnlyDatabase(sourcePath, (db) => exportPortabilityArchive(db, archivePath));
    const verified = verifyPortabilityArchive(archivePath);
    const restored = restorePortabilityArchiveToNewDatabase(archivePath, destinationPath);
    const sourceParity = withReadOnlyDatabase(sourcePath, (db) => compareDatabaseToPortabilityArchive(db, archivePath));
    print({
      operation: "drill",
      sourcePath,
      archivePath,
      destinationPath,
      archiveVerified: verified.dataSha256 === exported.dataSha256,
      restoreMatched: restored.matched,
      sourceStillMatchesArchive: sourceParity.matched,
      dataSha256: restored.databaseDataSha256,
      fileSha256: verified.fileSha256,
      byteLength: verified.byteLength,
      tableCount: restored.database.tableCount,
      rowCount: restored.database.rowCount,
      sourceMismatchedTables: sourceParity.mismatchedTables
    });
    if (!sourceParity.matched) process.exitCode = 2;
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`Yoink portability operation failed safely: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
