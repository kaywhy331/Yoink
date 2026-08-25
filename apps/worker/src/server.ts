import { mkdirSync } from "node:fs";
import { SqliteBackgroundWorkerStore } from "../../../packages/database/src/background-worker-store.js";
import { YoinkDatabase } from "../../../packages/database/src/database.js";
import { BackgroundMaintenanceHandler } from "../../../packages/engine/src/background-maintenance.js";
import { BackgroundWorkerRuntime } from "../../../packages/engine/src/background-worker-runtime.js";
import { ObserverRecipeRepository } from "../../../packages/database/src/observer-recipe-repository.js";
import { ObserverRecipeTrustAuthority } from "../../../packages/observer-registry/src/trust.js";
import { ObserverRecipeWitnessClient } from "../../../packages/observer-registry/src/witness.js";
import { ObserverRecipeWitnessRefreshService } from "../../../packages/engine/src/observer-recipe-witness-refresh.js";
import { loadWorkerConfig } from "./config.js";
import { HmacOperatorAlertWebhookTransport } from "../../../packages/engine/src/operator-alert-webhook.js";
import { OperatorAlertConnectorDispatchService } from "../../../packages/engine/src/operator-alert-connector-dispatch.js";

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
    const workerDb = db;
    const store = new SqliteBackgroundWorkerStore(workerDb, { principalMode: "all" });
    const observerRecipeWitness = config.observerRecipeWitness
      ? new ObserverRecipeWitnessClient(config.observerRecipeWitness)
      : null;
    const observerRecipeWitnessRefresh = observerRecipeWitness
      ? {
          execute(now: number) {
            // Reload only the root-signed public manifest for every bounded run
            // so key rotation does not require loading a private signer or
            // restarting the worker.
            return new ObserverRecipeWitnessRefreshService(
              new ObserverRecipeRepository(workerDb, ObserverRecipeTrustAuthority.witnessVerificationOnly(config.dataDirectory), {
                witnessVerifier: observerRecipeWitness.verifier,
                witnessEndpointOrigin: observerRecipeWitness.endpointOrigin,
                witnessRequired: config.observerRecipeWitnessRequired
              }),
              observerRecipeWitness
            ).execute(now);
          }
        }
      : undefined;
    const operatorAlertConnectorDispatch = new OperatorAlertConnectorDispatchService(
      workerDb,
      config.operatorAlertWebhookRegistry,
      new HmacOperatorAlertWebhookTransport(config.operatorAlertWebhookRegistry, process.env)
    );
    runtime = new BackgroundWorkerRuntime({
      store,
      handler: new BackgroundMaintenanceHandler(workerDb, observerRecipeWitnessRefresh
        ? { observerRecipeWitnessRefresh, operatorAlertConnectorDispatch }
        : { operatorAlertConnectorDispatch }),
      version: config.version,
      deploymentFingerprint: config.deploymentFingerprint,
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
    process.stdout.write(status.healthy
      ? `Yoink ${config.version} standalone worker ready as ${config.workerId}.\n`
      : `Yoink ${config.version} standalone worker is online but deployment-gated.\n`);
    process.stdout.write(`${status.lastPrincipalCount} principal scope(s) visited in the initial bounded cycle; PostgreSQL fleet readiness remains gated.\n`);
  } catch {
    process.stderr.write("Yoink standalone worker startup failed safely; initialize and migrate the API database first.\n");
    await shutdown("STARTUP_FAILURE", 1);
  }
}

void start();
