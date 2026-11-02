import { UserBotConnections, UserBotTransport } from "../../../packages/engine/src/user-bot-connections.js";
import { UserBotDispatchRuntime } from "../../../packages/engine/src/user-bot-dispatch-runtime.js";
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
import { BoundUserActionWebhookTransport } from "../../../packages/engine/src/user-action-webhook.js";
import { UserActionConnectorDispatchService } from "../../../packages/engine/src/user-action-connector-dispatch.js";

let db: YoinkDatabase | null = null;
let runtime: BackgroundWorkerRuntime | null = null;
let shutdownStarted = false;
let botDispatch: UserBotDispatchRuntime | null = null;

async function shutdown(signal: string, requestedExitCode = 0): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const forceExit = setTimeout(() => process.exit(1), 5_000);
  forceExit.unref();
  let exitCode = requestedExitCode;
  try {
    await botDispatch?.stop();
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
  // Exit 78 (RestartPreventExitStatus) only for configuration the operator
  // must fix. A missing, busy or not-yet-migrated database is transient (the
  // API may simply not have started yet), so exit 1 and let the supervisor
  // retry with backoff (API-24).
  let configured = false;
  try {
    const config = loadWorkerConfig();
    configured = true;
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
    const userActionConnectorDispatch = new UserActionConnectorDispatchService(
      workerDb,
      config.userActionWebhookRegistry,
      new UserBotTransport(UserBotConnections.persistent(workerDb, config.dataDirectory), new BoundUserActionWebhookTransport(config.userActionWebhookRegistry, process.env))
    );
    botDispatch = new UserBotDispatchRuntime(workerDb, userActionConnectorDispatch);
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
    botDispatch.start();
    const status = runtime.status();
    process.stdout.write(status.healthy
      ? `Yoink ${config.version} standalone worker ready as ${config.workerId}.\n`
      : `Yoink ${config.version} standalone worker is online but deployment-gated.\n`);
    process.stdout.write(`${status.lastPrincipalCount} principal scope(s) visited in the initial bounded cycle; PostgreSQL fleet readiness remains gated.\n`);
  } catch (error) {
    // Name the real cause (a bad YOINK_WORKER_ID is not a missing database);
    // stacks stay behind YOINK_DEBUG=1 (P-05).
    const dataDirectory = String(process.env.YOINK_DATA_DIR ?? "").trim();
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = (dataDirectory ? rawMessage.replaceAll(dataDirectory, "the data directory") : rawMessage)
      .replace(/(^|[\s'"(])\/[^\s'")]+/g, "$1<path>");
    process.stderr.write(`Yoink standalone worker could not start: ${message}\n`);
    if (process.env.YOINK_DEBUG === "1" && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    else process.stderr.write("If the API has not initialized and migrated the database yet, start it first. Set YOINK_DEBUG=1 for the stack trace.\n");
    await shutdown("STARTUP_FAILURE", configured ? 1 : 78);
  }
}

void start();
