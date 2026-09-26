#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ADD_LANES,
  RETAILER_OBSERVER_VERSIONS,
  RETAILER_SELECTOR_PACK_VERSIONS
} from "../packages/contracts/src/index.ts";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.ts";
import { acquireDataDirectoryLock, DataDirectoryLockedError } from "../packages/database/src/data-directory-lock.ts";
import { YoinkDatabase } from "../packages/database/src/database.ts";
import { OperatorAlertRepository } from "../packages/database/src/operator-alert-repository.ts";
import { classifyAdapterDiagnostic } from "../packages/domain/src/adapter-diagnostic-class.ts";
import { loadCapsule, replayCapsuleObject } from "./replay-capsule.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argumentsFor(argv) {
  const options = {
    dataDirectory: resolve(process.env.YOINK_DATA_DIR || join(ROOT, "data")),
    databasePath: "",
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") options.json = true;
    else if (["--data-dir", "--database"].includes(value)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a value.`);
      index += 1;
      if (value === "--data-dir") options.dataDirectory = resolve(next);
      else options.databasePath = resolve(next);
    } else throw new Error(`Unknown option ${value}.`);
  }
  options.databasePath = options.databasePath
    || resolve(process.env.YOINK_DATABASE_PATH || join(options.dataDirectory, "yoink.sqlite"));
  return options;
}

function indexItems(dataDirectory) {
  const path = join(dataDirectory, "evidence", "index.json");
  if (!existsSync(path)) return [];
  const value = JSON.parse(readFileSync(path, "utf8"));
  return (Array.isArray(value) ? value : value.items) || [];
}

function packagedVersions(item, extensionVersion) {
  const lane = ADD_LANES[item.retailerId];
  return {
    adapterVersion: item.operation === "observe"
      ? RETAILER_OBSERVER_VERSIONS[item.retailerId]
      : lane?.contractVersion || "",
    packVersion: RETAILER_SELECTOR_PACK_VERSIONS[item.retailerId] || "",
    extensionVersion
  };
}

export async function recheckCapsules(options) {
  const items = indexItems(options.dataDirectory);
  if (!items.length || !existsSync(options.databasePath)) {
    return { checked: 0, fixedPendingLive: 0, manualActionRequired: 0, stillFailing: 0, errors: 0, results: [] };
  }
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  // Only the service migrates, backs up and seeds the live database (PLAT-03,
  // I6). The recheck takes the data-directory lock so the service cannot
  // start underneath it, skips when the service already holds it, and opens
  // the database in require_current mode, so an older or newer schema is a
  // skip rather than a migration from this source tree.
  let lock;
  try {
    lock = acquireDataDirectoryLock(options.dataDirectory, { command: "capsules:recheck" });
  } catch (error) {
    if (error instanceof DataDirectoryLockedError) {
      return skipped("data_directory_locked", `the data directory is in use by pid ${error.owner.pid} (${error.owner.command})`);
    }
    throw error;
  }
  let db;
  try {
    db = new YoinkDatabase(options.databasePath, { migrationMode: "require_current" });
  } catch (error) {
    lock.release();
    return skipped("schema_not_current", error instanceof Error ? error.message : String(error));
  }
  try {
    const diagnostics = new AdapterDiagnosticRepository(db);
    const alerts = new OperatorAlertRepository(db);
    const queue = diagnostics.listRepairQueue(2_000);
    // Normally the API has already opened these alerts. Reconciliation here
    // makes the release command deterministic if a local process stopped
    // between recording its diagnostic and creating the aggregate incident.
    alerts.reconcileAdapterRepairs(queue, "adapter_repair_release_recheck");
    const results = [];
    for (const group of queue.filter((item) => ["open", "superseded"].includes(item.status))) {
      const capsuleEntry = items
        .filter((entry) => entry?.retailerId === group.retailerId
          && entry?.operation === group.operation
          && entry?.layoutFingerprint === group.layoutFingerprint)
        .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)))[0];
      if (!capsuleEntry?.id) continue;
      try {
        const capsule = loadCapsule(capsuleEntry.id, options.dataDirectory);
        const replay = await replayCapsuleObject(capsule, { bundle: true });
        const diagnosticClass = classifyAdapterDiagnostic(replay.actual);
        const fixed = replay.actual.outcome === "passed" || diagnosticClass === "listing_state";
        let transitioned = 0;
        if (fixed) {
          transitioned = alerts.markAdapterRepairFixedPendingLive(group, {
            capsuleId: capsuleEntry.id,
            packagedVersions: packagedVersions(group, String(packageJson.version)),
            result: { ...replay.actual, diagnosticClass }
          }).length;
        }
        results.push({
          groupKey: `${group.retailerId}:${group.operation}:${group.layoutFingerprint}`,
          capsuleId: capsuleEntry.id,
          outcome: replay.actual.outcome,
          failureStage: replay.actual.failureStage,
          reasonCode: replay.actual.reasonCode,
          diagnosticClass,
          manualActionRequired: diagnosticClass === "interactive_block",
          fixed,
          transitioned
        });
      } catch (error) {
        results.push({
          groupKey: `${group.retailerId}:${group.operation}:${group.layoutFingerprint}`,
          capsuleId: capsuleEntry.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return {
      checked: results.length,
      fixedPendingLive: results.filter((result) => result.fixed && result.transitioned > 0).length,
      manualActionRequired: results.filter((result) => result.manualActionRequired).length,
      stillFailing: results.filter((result) => result.fixed === false && !result.manualActionRequired).length,
      errors: results.filter((result) => result.error).length,
      results
    };
  } finally {
    db.close();
    lock.release();
  }
}

function skipped(reason, detail) {
  return { checked: 0, fixedPendingLive: 0, manualActionRequired: 0, stillFailing: 0, errors: 0, results: [], skipped: reason, detail };
}

export async function runRecheckCli(argv = process.argv.slice(2)) {
  try {
    const options = argumentsFor(argv);
    const result = await recheckCapsules(options);
    if (result.skipped && !options.json) {
      process.stdout.write(`Skipped the repair capsule recheck (${result.skipped}): ${result.detail}. Run npm run capsules:recheck while the service is stopped, after it has migrated the database.\n`);
      return 0;
    }
    process.stdout.write(options.json
      ? `${JSON.stringify(result)}\n`
      : `Rechecked ${result.checked} repair capsule${result.checked === 1 ? "" : "s"}; ${result.fixedPendingLive} fixed pending a live check, ${result.manualActionRequired} need a manual store step, ${result.stillFailing} still failing, ${result.errors} errored.\n`);
    return result.errors ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runRecheckCli();
}
