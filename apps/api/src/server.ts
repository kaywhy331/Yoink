import { mkdirSync } from "node:fs";
import { createYoinkServer } from "./app.js";
import { loadConfig } from "./config.js";
import { YoinkDatabase } from "../../../packages/database/src/database.js";
import { ObserverRecipeSigner } from "../../../packages/observer-registry/src/signer.js";
import {
  allowHostedHosts,
  allowHostedMutationOrigins,
  createHostedRequestScopeResolver
} from "./hosted-request-auth.js";

const config = loadConfig();
mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
const db = new YoinkDatabase(config.databasePath);
const hostedDependencies = config.hosted ? {
  requestScopeResolver: createHostedRequestScopeResolver(db, { proxySecret: config.hosted.proxySecret }),
  hostValidator: allowHostedHosts(config.hosted.allowedHosts),
  mutationOriginValidator: allowHostedMutationOrigins(config.hosted.allowedOrigins)
} : {};
const server = createYoinkServer({
  db,
  webRoot: config.webRoot,
  releaseRoot: config.releaseRoot,
  observerRecipeSigner: ObserverRecipeSigner.persistent(config.dataDirectory),
  version: config.version,
  ...hostedDependencies
});

function shutdown(signal: string): void {
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
  process.stdout.write(`Yoink ${config.version} ready at http://${config.host}:${config.port}\n`);
  process.stdout.write("TrackaLacker push ingress is available; retailer actions remain qualification-gated and live-verified.\n");
});
