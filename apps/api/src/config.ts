import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadObserverRecipeWitnessConfig,
  type ObserverRecipeWitnessRuntimeConfig
} from "../../../packages/observer-registry/src/config.js";
import {
  loadOperatorAlertWebhookRegistry,
  type OperatorAlertWebhookRegistry
} from "../../../packages/engine/src/operator-alert-webhook.js";
import {
  loadInternalServiceCapabilityRegistry,
  type InternalServiceCapabilityRegistry
} from "./internal-service-capabilities.js";
import {
  loadUserActionWebhookRegistry,
  type UserActionWebhookRegistry
} from "../../../packages/engine/src/user-action-webhook.js";

export interface YoinkConfig {
  host: "127.0.0.1";
  port: number;
  dataDirectory: string;
  databasePath: string;
  webRoot: string;
  releaseRoot: string;
  version: string;
  backgroundWorkerMode: "embedded" | "external" | "disabled";
  /** Save product images on this install and serve them locally (never in hosted mode). */
  productImages: boolean;
  hosted: {
    proxySecret: string;
    allowedHosts: string[];
    allowedOrigins: string[];
    allowedExtensionOrigins: string[];
    internalServiceCapabilities: InternalServiceCapabilityRegistry;
  } | null;
  observerRecipeWitness: ObserverRecipeWitnessRuntimeConfig | null;
  operatorAlertWebhookRegistry: OperatorAlertWebhookRegistry;
  userActionWebhookRegistry: UserActionWebhookRegistry;
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? 32991);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error("YOINK_PORT must be a whole TCP port from 1024 through 65535.");
  }
  return parsed;
}

function projectVersion(projectRoot: string): string {
  try {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as { version?: unknown };
    return String(packageJson.version ?? "0.0.0").slice(0, 40);
  } catch {
    return "0.0.0";
  }
}

function hostedExtensionOrigins(value: string | undefined): string[] {
  return [...new Set(String(value ?? "").split(",").map((candidate) => candidate.trim()).filter(Boolean).map((candidate) => {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error("YOINK_HOSTED_EXTENSION_ORIGINS must contain exact chrome-extension origins with 32-character IDs.");
    }
    if (parsed.protocol !== "chrome-extension:"
      || !/^[a-p]{32}$/.test(parsed.hostname)
      || parsed.username || parsed.password
      || (parsed.pathname !== "" && parsed.pathname !== "/")
      || parsed.search || parsed.hash) {
      throw new Error("YOINK_HOSTED_EXTENSION_ORIGINS must contain exact chrome-extension origins with 32-character IDs.");
    }
    return `chrome-extension://${parsed.hostname}`;
  }))];
}

/**
 * The UI the API serves. A compiled API (dist/) serves the web bundle the
 * build copied next to it (dist/web), stamped with the same build, so an
 * uncommitted apps/web edit never reaches shoppers against an older API
 * (PLAT-09). Under tsx, or before a build copied the UI, the source tree is used.
 */
function servedWebRoot(projectRoot: string): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  if (moduleDirectory.includes(`${sep}dist${sep}`)) {
    const builtWeb = resolve(moduleDirectory, "..", "..", "..", "web");
    if (existsSync(join(builtWeb, "index.html"))) return builtWeb;
  }
  return join(projectRoot, "apps", "web");
}

export function loadConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): YoinkConfig {
  const projectRoot = resolve(cwd);
  const requestedDataDirectory = String(env.YOINK_DATA_DIR ?? "data").trim();
  if (!requestedDataDirectory) throw new Error("YOINK_DATA_DIR must identify a non-empty directory.");
  const dataDirectory = isAbsolute(requestedDataDirectory)
    ? requestedDataDirectory
    : resolve(projectRoot, requestedDataDirectory);
  const hostedRequested = env.YOINK_HOSTED_MODE === "1";
  const legacyWorkerValue = env.YOINK_BACKGROUND_WORKER;
  const requestedWorkerMode = env.YOINK_BACKGROUND_WORKER_MODE;
  if (legacyWorkerValue !== undefined && requestedWorkerMode !== undefined) {
    throw new Error("Choose YOINK_BACKGROUND_WORKER_MODE or the legacy YOINK_BACKGROUND_WORKER switch, not both.");
  }
  if (legacyWorkerValue !== undefined && !["0", "1"].includes(String(legacyWorkerValue).trim())) {
    throw new Error("YOINK_BACKGROUND_WORKER must be 1 (embedded) or 0 (disabled).");
  }
  if (requestedWorkerMode !== undefined && !["embedded", "external", "disabled"].includes(String(requestedWorkerMode).trim())) {
    throw new Error("YOINK_BACKGROUND_WORKER_MODE must be embedded, external, or disabled.");
  }
  const backgroundWorkerMode: YoinkConfig["backgroundWorkerMode"] = requestedWorkerMode !== undefined
    ? String(requestedWorkerMode).trim() as YoinkConfig["backgroundWorkerMode"]
    : legacyWorkerValue !== undefined
      ? String(legacyWorkerValue).trim() === "1" ? "embedded" : "disabled"
      : hostedRequested ? "external" : "embedded";
  const requestedProductImages = env.YOINK_PRODUCT_IMAGES;
  if (requestedProductImages !== undefined && !["0", "1"].includes(String(requestedProductImages).trim())) {
    throw new Error("YOINK_PRODUCT_IMAGES must be 1 (save product images on this install) or 0 (keep the original links).");
  }
  const productImages = !hostedRequested && String(requestedProductImages ?? "1").trim() === "1";
  const proxySecret = String(env.YOINK_HOSTED_PROXY_SECRET ?? "");
  const allowedHosts = String(env.YOINK_HOSTED_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOrigins = String(env.YOINK_HOSTED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowedExtensionOrigins = hostedExtensionOrigins(env.YOINK_HOSTED_EXTENSION_ORIGINS);
  if (hostedRequested && (Buffer.byteLength(proxySecret, "utf8") < 32
    || !allowedHosts.length || !allowedOrigins.length || !allowedExtensionOrigins.length)) {
    throw new Error("Hosted mode requires a 32-byte YOINK_HOSTED_PROXY_SECRET plus explicit YOINK_HOSTED_HOSTS, YOINK_HOSTED_ORIGINS, and YOINK_HOSTED_EXTENSION_ORIGINS.");
  }
  const internalServiceCapabilities = loadInternalServiceCapabilityRegistry(
    env.YOINK_HOSTED_SERVICE_CAPABILITIES_JSON,
    hostedRequested
  );
  const observerRecipeWitness = loadObserverRecipeWitnessConfig(env);
  const operatorAlertWebhookRegistry = loadOperatorAlertWebhookRegistry(env);
  const userActionWebhookRegistry = loadUserActionWebhookRegistry(env);
  if (hostedRequested && !observerRecipeWitness) {
    throw new Error("Hosted mode requires an independently operated observer recipe witness configuration.");
  }
  return {
    host: "127.0.0.1",
    port: port(env.YOINK_PORT),
    dataDirectory,
    databasePath: join(dataDirectory, "yoink.sqlite"),
    webRoot: servedWebRoot(projectRoot),
    releaseRoot: join(projectRoot, "release"),
    version: projectVersion(projectRoot),
    backgroundWorkerMode,
    productImages,
    hosted: hostedRequested ? {
      proxySecret,
      allowedHosts,
      allowedOrigins,
      allowedExtensionOrigins,
      internalServiceCapabilities
    } : null,
    observerRecipeWitness,
    operatorAlertWebhookRegistry,
    userActionWebhookRegistry
  };
}
