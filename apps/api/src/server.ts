import { mkdirSync } from "node:fs";
import { createYoinkServer } from "./app.js";
import { loadConfig } from "./config.js";
import { YoinkDatabase } from "../../../packages/database/src/database.js";
import { ObserverRecipeTrustAuthority } from "../../../packages/observer-registry/src/trust.js";
import { ObserverRecipeWitnessClient } from "../../../packages/observer-registry/src/witness.js";
import {
  allowHostedHosts,
  allowHostedMutationOrigins,
  createHostedRequestScopeResolver
} from "./hosted-request-auth.js";
import { BackgroundWorkerRuntime } from "./background-worker-runtime.js";

const config = loadConfig();
mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
const db = new YoinkDatabase(config.databasePath);
const backgroundWorker = new BackgroundWorkerRuntime({
  db,
  version: config.version,
  workerId: "background_worker_local"
});
const hostedDependencies = config.hosted ? {
  requestScopeResolver: createHostedRequestScopeResolver(db, { proxySecret: config.hosted.proxySecret }),
  hostValidator: allowHostedHosts(config.hosted.allowedHosts),
  mutationOriginValidator: allowHostedMutationOrigins(config.hosted.allowedOrigins)
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
  backgroundWorkerStatus: () => config.backgroundWorkerEnabled
    ? backgroundWorker.status()
    : {
        state: "disabled",
        healthy: false,
        runtimeKind: "local_in_process",
        lastHeartbeatAt: "",
        lastErrorCode: "operator_disabled"
      },
  ...witnessDependencies,
  ...hostedDependencies
});

function shutdown(signal: string): void {
  backgroundWorker.stop();
  server.close(() => {
    db.close();
    process.stdout.write(`Yoink stopped (${signal}).\n`);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

server.listen(config.port, config.host, () => {
  if (config.backgroundWorkerEnabled) backgroundWorker.start();
  process.stdout.write(`Yoink ${config.version} ready at http://${config.host}:${config.port}\n`);
  process.stdout.write("TrackaLacker push ingress is available; retailer actions remain qualification-gated and live-verified.\n");
  process.stdout.write(`Durable local background work is ${config.backgroundWorkerEnabled ? "running" : "operator-disabled"}; the production worker fleet remains gated.\n`);
});
