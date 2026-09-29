#!/usr/bin/env node
// Exports a Yoink data directory as one ZIP for moving Yoink to another
// machine (the Windows tray app imports it: "Import data from ZIP…").
//
//   node scripts/export-data.mjs                          # data/ → ~/Yoink-Data-<time>.zip
//   node scripts/export-data.mjs --data-dir=<dir> --out=<file.zip>
//   node scripts/export-data.mjs --allow-running          # export while the service runs
//
// The database is copied with VACUUM INTO from a read-only connection, so the
// copy is one consistent snapshot even while the service writes. Stop the
// service first for a real move all the same (systemctl --user stop
// yoink-local-api): anything it records after the snapshot is not in the ZIP.
//
// Copied: the database snapshot and every other file (keys, trust manifest,
// evidence capsules). Left out: the lock, WAL/SHM files, the pre-migration
// backups (yoink.sqlite.before-*) and portability/ exports, which are
// rebuildable or history. The ZIP holds signing keys and pairing hashes:
// it is written owner-only; move it privately and delete it after importing.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_EXPORT_SCHEMA_VERSION = 1;
export const DATA_MANIFEST_FILE = "yoink-data.json";
const argv = process.argv.slice(2);
const option = (name) => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";

/** Whether a top-level entry of the data directory travels with the export. */
export function exportedEntry(name) {
  if (name === "yoink.sqlite") return false; // replaced by the snapshot
  if (name === "yoink.lock" || name === DATA_MANIFEST_FILE) return false;
  if (name.endsWith("-wal") || name.endsWith("-shm") || name.endsWith("-journal")) return false;
  if (name.startsWith("yoink.sqlite.before-")) return false;
  if (name === "portability" || name.endsWith(".tmp")) return false;
  return true;
}

/** The running owner recorded in the lock, when its process is still alive. */
function liveOwner(dataDirectory) {
  const path = join(dataDirectory, "yoink.lock");
  if (!existsSync(path)) return null;
  try {
    const owner = JSON.parse(readFileSync(path, "utf8"));
    process.kill(Number(owner.pid), 0);
    return owner;
  } catch {
    return null;
  }
}

function main() {
  const dataDirectory = resolve(ROOT, option("--data-dir") || process.env.YOINK_DATA_DIR || "data");
  const database = join(dataDirectory, "yoink.sqlite");
  if (!existsSync(database)) throw new Error(`${database} does not exist.`);
  const owner = liveOwner(dataDirectory);
  if (owner && !argv.includes("--allow-running")) {
    throw new Error(`Yoink (pid ${owner.pid}) is running on ${dataDirectory}. Stop it first (systemctl --user stop yoink-local-api) so nothing is recorded after the export, or pass --allow-running for a snapshot of this moment.`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = resolve(option("--out") || join(homedir(), `Yoink-Data-${stamp}.zip`));
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  const scratch = mkdtempSync(join(tmpdir(), "yoink-data-export-"));
  chmodSync(scratch, 0o700);
  try {
    const stage = join(scratch, "data");
    mkdirSync(stage, { mode: 0o700 });
    const source = new DatabaseSync(database, { readOnly: true });
    let schema;
    try {
      const snapshot = join(stage, "yoink.sqlite");
      source.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
      schema = source.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get()?.version ?? 0;
    } finally {
      source.close();
    }
    const check = new DatabaseSync(join(stage, "yoink.sqlite"), { readOnly: true });
    try {
      const integrity = check.prepare("PRAGMA quick_check").get();
      if (Object.values(integrity ?? {})[0] !== "ok") throw new Error(`The snapshot failed its integrity check: ${JSON.stringify(integrity)}`);
    } finally {
      check.close();
    }
    const copied = ["yoink.sqlite"];
    for (const name of readdirSync(dataDirectory).sort()) {
      if (!exportedEntry(name)) continue;
      cpSync(join(dataDirectory, name), join(stage, name), { recursive: true });
      copied.push(name);
    }
    writeFileSync(join(stage, DATA_MANIFEST_FILE), `${JSON.stringify({
      schemaVersion: DATA_EXPORT_SCHEMA_VERSION,
      product: "yoink-data",
      exportedAt: new Date().toISOString(),
      exportedFrom: hostname(),
      yoinkVersion: packageJson.version,
      databaseSchema: Number(schema),
      serviceWasRunning: Boolean(owner),
      entries: copied
    }, null, 2)}\n`);
    rmSync(output, { force: true });
    const zipped = spawnSync("zip", ["-X", "-r", "-q", output, "."], { cwd: stage, stdio: "inherit" });
    if (zipped.error) throw zipped.error;
    if (zipped.status !== 0) throw new Error(`zip failed with status ${zipped.status}.`);
    chmodSync(output, 0o600);
    const megabytes = (statSync(output).size / 1024 / 1024).toFixed(1);
    process.stdout.write(`Wrote ${output} (${megabytes} MB): database schema ${schema}, ${copied.length} entries${owner ? ", taken while the service was running" : ""}.\n`);
    process.stdout.write("It holds keys and pairing hashes: copy it privately, and delete it once imported.\n");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Data export failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
