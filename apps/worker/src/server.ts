import { mkdirSync } from "node:fs";
import { SqliteBackgroundWorkerStore } from "../../../packages/database/src/background-worker-store.js";
import { YoinkDatabase } from "../../../packages/database/src/database.js";
import { BackgroundMaintenanceHandler } from "../../../packages/engine/src/background-maintenance.js";
import { BackgroundWorkerRuntime } from "../../../packages/engine/src/background-worker-runtime.js";
import { loadWorkerConfig } from "./config.js";

let db: YoinkDatabase | null = null;
let runtime: BackgroundWorkerRuntime | null = null;
let shutdownStarted = false;

async function shutdown(signal: string, requestedExitCode = 0): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const forceExit = setTimeout(() => process.exit(1), 5_000);
  forceExit.unref();
  let exitCode = requestedExitCode;
  try {
    await runtime?.stop();
  } catch {
    exitCode = 1;
    process.stderr.write("Yoink standalone worker shutdown failed safely.\n");
  }
  try {
    db?.close();
  } catch {
    exitCode = 1;
  }
  clearTimeout(forceExit);
  process.stdout.write(`Yoink standalone worker stopped (${signal}).\n`);
  process.exit(exitCode);
}

async function start(): Promise<void> {
  try {
    const config = loadWorkerConfig();
    mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
    db = new YoinkDatabase(config.databasePath, { migrationMode: "require_current" });
    const store = new SqliteBackgroundWorkerStore(db, { principalMode: "all" });
    runtime = new BackgroundWorkerRuntime({
      store,
      handler: new BackgroundMaintenanceHandler(db),
      version: config.version,
      runtimeKind: "standalone",
      workerId: config.workerId,
      pollIntervalMs: config.pollIntervalMs,
      leaseSeconds: config.leaseSeconds,
      maximumPrincipalsPerCycle: config.maximumPrincipalsPerCycle,
      maximumTasksPerCycle: config.maximumTasksPerCycle,
      maximumTasksPerPrincipal: config.maximumTasksPerPrincipal,
      unrefTimer: false
    });
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    await runtime.start();
    const status = runtime.status();
    process.stdout.write(`Yoink ${config.version} standalone worker ready as ${config.workerId}.\n`);
    process.stdout.write(`${status.lastPrincipalCount} principal scope(s) visited in the initial bounded cycle; PostgreSQL fleet readiness remains gated.\n`);
  } catch {
    process.stderr.write("Yoink standalone worker startup failed safely; initialize and migrate the API database first.\n");
    await shutdown("STARTUP_FAILURE", 1);
  }
}

void start();
