import { mkdirSync } from "node:fs";
import { createYoinkServer } from "./app.js";
import { createActionJobAvailabilityPulse } from "./action-job-availability.js";
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
import { safeInternalServiceCapabilityProjection } from "./internal-service-capabilities.js";
import { SqliteBackgroundWorkerStore } from "../../../packages/database/src/background-worker-store.js";
import { BackgroundMaintenanceHandler } from "../../../packages/engine/src/background-maintenance.js";
import { BackgroundWorkerRuntime } from "../../../packages/engine/src/background-worker-runtime.js";
import { ObserverRecipeRepository } from "../../../packages/database/src/observer-recipe-repository.js";
import { ObserverRecipeWitnessRefreshService } from "../../../packages/engine/src/observer-recipe-witness-refresh.js";
import {
  BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION,
  backgroundWorkerDeploymentFingerprint as deploymentFingerprintForWorker
} from "../../../packages/domain/src/background-worker-deployment.js";
import {
  HmacOperatorAlertWebhookTransport
} from "../../../packages/engine/src/operator-alert-webhook.js";
import { OperatorAlertConnectorDispatchService } from "../../../packages/engine/src/operator-alert-connector-dispatch.js";
import {
  BoundUserActionWebhookTransport
} from "../../../packages/engine/src/user-action-webhook.js";
import { UserActionConnectorDispatchService } from "../../../packages/engine/src/user-action-connector-dispatch.js";

const config = loadConfig();
mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
const db = new YoinkDatabase(config.databasePath);
const observerRecipeTrust = ObserverRecipeTrustAuthority.persistent(config.dataDirectory);
const observerRecipeWitness = config.observerRecipeWitness
  ? new ObserverRecipeWitnessClient(config.observerRecipeWitness)
  : null;
const observerRecipeWitnessRefresh = observerRecipeWitness
  ? new ObserverRecipeWitnessRefreshService(
      new ObserverRecipeRepository(db, observerRecipeTrust, {
        witnessVerifier: observerRecipeWitness.verifier,
        witnessEndpointOrigin: observerRecipeWitness.endpointOrigin,
        witnessRequired: config.hosted !== null
      }),
      observerRecipeWitness
    )
  : undefined;
const workerDeploymentFingerprint = deploymentFingerprintForWorker({
  runtimeVersion: config.version,
  observerRecipeWitness: config.observerRecipeWitness,
  observerRecipeWitnessRequired: config.hosted !== null,
  operatorAlertWebhookRegistryFingerprint: config.operatorAlertWebhookRegistry.fingerprint,
  userActionWebhookRegistryFingerprint: config.userActionWebhookRegistry.fingerprint
});
const operatorAlertConnectorDispatch = new OperatorAlertConnectorDispatchService(
  db,
  config.operatorAlertWebhookRegistry,
  config.backgroundWorkerMode === "embedded"
    ? new HmacOperatorAlertWebhookTransport(config.operatorAlertWebhookRegistry, process.env)
    : undefined
);
const userActionConnectorDispatch = new UserActionConnectorDispatchService(
  db,
  config.userActionWebhookRegistry,
  config.backgroundWorkerMode === "embedded"
    ? new BoundUserActionWebhookTransport(config.userActionWebhookRegistry, process.env)
    : undefined
);
const actionJobAvailability = createActionJobAvailabilityPulse();
const backgroundWorkerStore = new SqliteBackgroundWorkerStore(db, {
  principalMode: config.hosted ? "all" : "fixed"
});
backgroundWorkerStore.configureDeploymentExpectation(
  config.backgroundWorkerMode,
  workerDeploymentFingerprint,
  config.version
);
const backgroundWorker = new BackgroundWorkerRuntime({
  store: backgroundWorkerStore,
  handler: new BackgroundMaintenanceHandler(db, {
    ...(observerRecipeWitnessRefresh ? { observerRecipeWitnessRefresh } : {}),
    operatorAlertConnectorDispatch,
    userActionConnectorDispatch,
    onActionJobsCreated: () => { actionJobAvailability.notify(); }
  }),
  version: config.version,
  deploymentFingerprint: workerDeploymentFingerprint,
  runtimeKind: "local_in_process",
  workerId: "background_worker_embedded",
  onCycleComplete: () => { actionJobAvailability.notify(); }
});
const hostedDependencies = config.hosted ? {
  requestScopeResolver: createHostedRequestScopeResolver(db, {
    proxySecret: config.hosted.proxySecret,
    serviceCapabilities: config.hosted.internalServiceCapabilities.assignments
  }),
  internalServiceCapabilityRegistry: safeInternalServiceCapabilityProjection(
    config.hosted.internalServiceCapabilities
  ),
  hostValidator: allowHostedHosts(config.hosted.allowedHosts),
  mutationOriginValidator: allowHostedMutationOrigins(config.hosted.allowedOrigins),
  extensionOriginValidator: allowHostedExtensionOrigins(config.hosted.allowedExtensionOrigins),
  localExtensionReleaseEnabled: false
} : {};
const witnessDependencies = observerRecipeWitness ? {
  observerRecipeWitness,
  observerRecipeWitnessRequired: config.hosted !== null
} : {
  observerRecipeWitnessRequired: false
};
const server = createYoinkServer({
  db,
  dataDirectory: config.dataDirectory,
  hosted: config.hosted !== null,
  webRoot: config.webRoot,
  releaseRoot: config.releaseRoot,
  observerRecipeTrust,
  version: config.version,
  operatorAlertConnectorBindings: config.operatorAlertWebhookRegistry.bindings,
  userActionConnectorBindings: config.userActionWebhookRegistry.bindings,
  backgroundWorkerWake: () => backgroundWorker.wake(),
  actionJobAvailability,
  ...(config.backgroundWorkerMode === "embedded"
    ? { backgroundWorkerRestart: async () => backgroundWorker.restart() }
    : {}),
  backgroundWorkerStatus: async () => {
    if (config.backgroundWorkerMode === "embedded") {
      return { ...backgroundWorker.status(), mode: "embedded" as const };
    }
    if (config.backgroundWorkerMode === "external") {
      return {
        ...await backgroundWorkerStore.deploymentStatus(
          "standalone",
          workerDeploymentFingerprint,
          Date.now()
        ),
        mode: "external" as const
      };
    }
    return {
        state: "disabled",
        healthy: false,
        runtimeKind: "local_in_process",
        mode: "disabled",
        lastHeartbeatAt: "",
        lastErrorCode: "operator_disabled",
        deploymentAttested: false,
        deploymentContractVersion: BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION
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
