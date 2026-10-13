import { mkdirSync } from "node:fs";
import { createServer as createProbeServer } from "node:net";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createYoinkServer } from "./app.js";
import { watchControlStdin } from "./control-channel.js";
import { createActionJobAvailabilityPulse } from "./action-job-availability.js";
import { loadBuildInfo } from "./build-info.js";
import { loadConfig, type YoinkConfig } from "./config.js";
import { YoinkDatabase, YoinkStartupError } from "../../../packages/database/src/database.js";
import { CatalogRepository } from "../../../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../../../packages/database/src/control-repository.js";
import {
  acquireDataDirectoryLock,
  DataDirectoryLockedError,
  type DataDirectoryLock
} from "../../../packages/database/src/data-directory-lock.js";
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
import { ProductImageStore, productImageSources } from "../../../packages/database/src/product-image-store.js";
import { ProductImageCache } from "../../../packages/engine/src/product-image-cache.js";
import { WindowsNotificationWatcher, windowsNotificationDatabasePath } from "./windows-notification-watcher.js";

/**
 * Startup is a short, logged ladder (P-05, P-04, P-01, P-12):
 *   configuration → port probe → data-directory lock → database (prune, backup, migrate) → listen.
 * Anything that fails before the database is opened exits 78 so a supervisor
 * with `RestartPreventExitStatus=78` does not loop on a problem only the
 * operator can fix; the message names the fix in one line.
 */
const NON_RETRYABLE_EXIT = 78;
const debug = process.env.YOINK_DEBUG === "1";
const startedAt = new Date().toISOString();
const phase = (line: string): void => { process.stdout.write(`${line}\n`); };

function failStartup(step: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Yoink could not start (${step}): ${message}\n`);
  if (debug && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  else if (!debug) process.stderr.write("Set YOINK_DEBUG=1 for the stack trace.\n");
  const exitCode = error instanceof YoinkStartupError || error instanceof DataDirectoryLockedError
    ? error.exitCode
    : NON_RETRYABLE_EXIT;
  process.exit(exitCode);
}

/** Refuses early, before the database is touched, when the port is already owned. */
function probePort(host: string, port: number): Promise<void> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createProbeServer();
    probe.unref();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        rejectPort(new YoinkStartupError(
          "port_in_use",
          `${host}:${port} is already in use. If the yoink-local-api user unit is running, use npm run release:local (or systemctl --user restart yoink-local-api) instead of starting a second copy; otherwise set YOINK_PORT.`
        ));
        return;
      }
      rejectPort(error);
    });
    probe.listen(port, host, () => { probe.close(() => resolvePort()); });
  });
}

let config: YoinkConfig;
try {
  config = loadConfig();
} catch (error) {
  failStartup("configuration", error);
}
phase(`Yoink ${config.version} starting: data directory ${config.dataDirectory}, port ${config.port}, worker mode ${config.backgroundWorkerMode}.`);
try {
  await probePort(config.host, config.port);
} catch (error) {
  failStartup("port", error);
}
let dataDirectoryLock: DataDirectoryLock;
try {
  mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
  dataDirectoryLock = acquireDataDirectoryLock(config.dataDirectory, {
    command: `${process.argv0} ${process.argv.slice(1).join(" ")}`.slice(0, 200),
    allowShared: process.env.YOINK_ALLOW_SHARED_DATA === "1"
  });
} catch (error) {
  failStartup("data directory", error);
}
let db: YoinkDatabase;
try {
  phase("Yoink database: opening and checking integrity.");
  db = new YoinkDatabase(config.databasePath, { logger: phase });
  const schema = db.schemaVersions();
  phase(`Yoink database: schema ${schema.applied} of ${schema.expected} ready.`);
  // Items an "All New …" entry still holds as its own listings get their own
  // products now, rather than at the next TrackaLacker sync.
  if (!config.hosted) {
    try {
      const refiled = new CatalogRepository(db).refileCollectionListings();
      if (refiled) phase(`Yoink catalog: ${refiled} All New item${refiled === 1 ? "" : "s"} filed as their own products.`);
    } catch (error) {
      phase(`Yoink catalog: All New items stay as they are until the next sync (${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}).`);
    }
    // Cart items with no MSRP on record add at any price up to their max.
    try {
      const armed = new ControlRepository(db).armUnconfirmedCartPlans();
      if (armed.length) phase(`Yoink plans: ${armed.length} cart item${armed.length === 1 ? "" : "s"} without an MSRP now add at any price up to the max (${armed.map((plan) => plan.title).join(", ").slice(0, 300)}).`);
    } catch (error) {
      phase(`Yoink plans: cart items without an MSRP stay as they are (${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}).`);
    }
  }
} catch (error) {
  dataDirectoryLock.release();
  failStartup("database", error);
}
const build = loadBuildInfo(process.cwd(), {
  runningFromDist: fileURLToPath(import.meta.url).includes(`${sep}dist${sep}`),
  startedAt,
  version: config.version
});
phase(`Yoink build: ${build.kind} ${build.commit.slice(0, 12)}${build.dirty ? " (dirty)" : ""}${build.builtAt ? ` built ${build.builtAt}` : ""}${build.staleAgainstSource ? ` — source is at ${build.sourceCommit.slice(0, 12)}; rebuild and restart` : ""}.`);
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
// Product images are saved on this install once each and then served from here
// (local installs only). If the folder cannot be used, dashboards keep the links.
let productImageStore: ProductImageStore | null = null;
if (config.productImages) {
  try {
    productImageStore = new ProductImageStore(config.dataDirectory);
  } catch (error) {
    process.stderr.write(`Yoink product images: cannot use the media folder (${error instanceof Error ? error.message : String(error)}); dashboards keep the original image links.\n`);
  }
}
const productImageCache = productImageStore
  ? new ProductImageCache({
      store: productImageStore,
      sources: () => productImageSources(db),
      log: phase,
      userAgent: `Yoink/${config.version} (product images)`
    })
  : null;
// Discord messages Windows shows on this PC become calls (Setup › Discord); local installs only.
const windowsNotifications = config.hosted ? null : new WindowsNotificationWatcher({
  databasePath: windowsNotificationDatabasePath(),
  log: phase
});
const shutdownController = new AbortController();
const server = createYoinkServer({
  shutdownSignal: shutdownController.signal,
  db,
  dataDirectory: config.dataDirectory,
  hosted: config.hosted !== null,
  webRoot: config.webRoot,
  releaseRoot: config.releaseRoot,
  observerRecipeTrust,
  version: config.version,
  build,
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
  ...(productImageStore ? {
    productImages: productImageStore,
    productImagesChanged: () => productImageCache?.wake()
  } : {}),
  ...(windowsNotifications ? { windowsNotifications } : {}),
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
  // Long-polls (up to 25 s) return at once without leasing, and new requests
  // get 503; otherwise server.close() waits for them and the force exit fires (API-08).
  shutdownController.abort();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  const closeStragglers = setTimeout(() => server.closeAllConnections(), 1_000);
  closeStragglers.unref();
  try {
    if (config.backgroundWorkerMode === "embedded") await backgroundWorker.stop();
  } catch {
    exitCode = 1;
    process.stderr.write("Yoink background worker shutdown failed safely.\n");
  }
  await productImageCache?.stop();
  await windowsNotifications?.stop();
  await closed;
  clearTimeout(closeStragglers);
  try {
    db.close();
  } catch {
    exitCode = 1;
  }
  dataDirectoryLock.release();
  clearTimeout(forceExit);
  process.stdout.write(`Yoink stopped (${signal}).\n`);
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
// The Windows tray app stops Yoink by writing `stop` to stdin (or by exiting).
if (process.env.YOINK_CONTROL_STDIN === "1") watchControlStdin(process.stdin, (reason) => void shutdown(reason));
process.once("exit", () => { dataDirectoryLock.release(); });
// A throw after a response started, or in a fire-and-forget hook, must not
// take the whole API (and every in-flight lease) down with it (API-19).
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`Yoink unhandled rejection (kept running): ${message.slice(0, 300)}\n`);
});

const startupListenError = (error: NodeJS.ErrnoException): void => {
  // The probe above makes this rare (a race with another process); still say
  // what happened instead of an unhandled 'error' stack, and release the lock.
  dataDirectoryLock.release();
  failStartup("listen", error.code === "EADDRINUSE"
    ? new YoinkStartupError("port_in_use", `${config.host}:${config.port} was taken while Yoink was starting; stop the other process or set YOINK_PORT.`)
    : error);
};
server.once("error", startupListenError);

server.listen(config.port, config.host, () => {
  // Exit 78 is reserved for failures before listening. Once serving, an
  // accept error (EMFILE under descriptor pressure) is logged and survived;
  // anything else exits 1 so systemd restarts the service (API-09).
  server.off("error", startupListenError);
  server.on("error", (error: NodeJS.ErrnoException) => {
    process.stderr.write(`Yoink server error: ${error.code ?? ""} ${error.message}\n`);
    if (["EMFILE", "ENFILE", "ECONNABORTED", "ECONNRESET"].includes(String(error.code ?? ""))) return;
    void shutdown("SERVER_ERROR", 1);
  });
  productImageCache?.start();
  windowsNotifications?.start();
  void (async () => {
    if (config.backgroundWorkerMode === "embedded") await backgroundWorker.start();
    process.stdout.write(`Yoink ${config.version} ready at http://${config.host}:${config.port} (build ${build.commit.slice(0, 12)}, started ${startedAt})\n`);
    process.stdout.write("TrackaLacker push ingress is available; retailer actions remain qualification-gated and live-verified.\n");
    process.stdout.write(`Durable background work mode is ${config.backgroundWorkerMode}; the PostgreSQL production fleet remains gated.\n`);
  })().catch(() => {
    // The API keeps serving reads; health reports the worker unhealthy and
    // an admin can restart it (API-15).
    process.stderr.write("Yoink background worker startup failed; the API keeps serving and health reports the worker unhealthy.\n");
  });
});
