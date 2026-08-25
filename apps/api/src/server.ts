import { mkdirSync } from "node:fs";
import { createYoinkServer } from "./app.js";
import { loadConfig } from "./config.js";
import { YoinkDatabase } from "../../../packages/database/src/database.js";
import { ObserverRecipeTrustAuthority } from "../../../packages/observer-registry/src/trust.js";
import { ObserverRecipeWitnessClient } from "../../../packages/observer-registry/src/witness.js";
import {
  allowHostedExtensionOrigins,
  allowHostedHosts,
  allowHostedMutationOrigins,
  createHostedRequestScopeResolver
} from "./hosted-request-auth.js";
import { SqliteBackgroundWorkerStore } from "../../../packages/database/src/background-worker-store.js";
import { BackgroundMaintenanceHandler } from "../../../packages/engine/src/background-maintenance.js";
import { BackgroundWorkerRuntime } from "../../../packages/engine/src/background-worker-runtime.js";

const config = loadConfig();
mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
const db = new YoinkDatabase(config.databasePath);
const backgroundWorkerStore = new SqliteBackgroundWorkerStore(db, {
  principalMode: config.hosted ? "all" : "fixed"
});
const backgroundWorker = new BackgroundWorkerRuntime({
  store: backgroundWorkerStore,
  handler: new BackgroundMaintenanceHandler(db),
  version: config.version,
  runtimeKind: "local_in_process",
  workerId: "background_worker_embedded"
});
const hostedDependencies = config.hosted ? {
  requestScopeResolver: createHostedRequestScopeResolver(db, { proxySecret: config.hosted.proxySecret }),
  hostValidator: allowHostedHosts(config.hosted.allowedHosts),
  mutationOriginValidator: allowHostedMutationOrigins(config.hosted.allowedOrigins),
  extensionOriginValidator: allowHostedExtensionOrigins(config.hosted.allowedExtensionOrigins),
  localExtensionReleaseEnabled: false
} : {};
const witnessDependencies = config.observerRecipeWitness ? {
  observerRecipeWitness: new ObserverRecipeWitnessClient(config.observerRecipeWitness),
  observerRecipeWitnessRequired: config.hosted !== null
} : {
  observerRecipeWitnessRequired: false
};
const server = createYoinkServer({
  db,
  webRoot: config.webRoot,
  releaseRoot: config.releaseRoot,
  observerRecipeTrust: ObserverRecipeTrustAuthority.persistent(config.dataDirectory),
  version: config.version,
  backgroundWorkerStatus: async () => {
    if (config.backgroundWorkerMode === "embedded") {
      return { ...backgroundWorker.status(), mode: "embedded" as const };
    }
    if (config.backgroundWorkerMode === "external") {
      return {
        ...await backgroundWorkerStore.deploymentStatus("standalone", Date.now()),
        mode: "external" as const
      };
    }
    return {
        state: "disabled",
        healthy: false,
        runtimeKind: "local_in_process",
        mode: "disabled",
        lastHeartbeatAt: "",
        lastErrorCode: "operator_disabled"
      } as const;
  },
  ...witnessDependencies,
  ...hostedDependencies
});

let shutdownStarted = false;

async function shutdown(signal: string, requestedExitCode = 0): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const forceExit = setTimeout(() => process.exit(1), 5_000);
  forceExit.unref();
  let exitCode = requestedExitCode;
  try {
    if (config.backgroundWorkerMode === "embedded") await backgroundWorker.stop();
  } catch {
    exitCode = 1;
    process.stderr.write("Yoink background worker shutdown failed safely.\n");
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    db.close();
  } catch {
    exitCode = 1;
  }
  clearTimeout(forceExit);
  process.stdout.write(`Yoink stopped (${signal}).\n`);
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

server.listen(config.port, config.host, () => {
  void (async () => {
    if (config.backgroundWorkerMode === "embedded") await backgroundWorker.start();
    process.stdout.write(`Yoink ${config.version} ready at http://${config.host}:${config.port}\n`);
    process.stdout.write("TrackaLacker push ingress is available; retailer actions remain qualification-gated and live-verified.\n");
    process.stdout.write(`Durable background work mode is ${config.backgroundWorkerMode}; the PostgreSQL production fleet remains gated.\n`);
  })().catch(() => {
    process.stderr.write("Yoink background worker startup failed; the service is closing safely.\n");
    void shutdown("STARTUP_FAILURE", 1);
  });
});
