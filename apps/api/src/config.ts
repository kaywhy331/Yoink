import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  ObserverRecipeWitnessClient,
  type ObserverRecipeWitnessClientOptions
} from "../../../packages/observer-registry/src/witness.js";

export interface YoinkConfig {
  host: "127.0.0.1";
  port: number;
  dataDirectory: string;
  databasePath: string;
  webRoot: string;
  releaseRoot: string;
  version: string;
  backgroundWorkerMode: "embedded" | "external" | "disabled";
  hosted: {
    proxySecret: string;
    allowedHosts: string[];
    allowedOrigins: string[];
    allowedExtensionOrigins: string[];
  } | null;
  observerRecipeWitness: Omit<ObserverRecipeWitnessClientOptions, "fetch" | "requestTimeoutMs"> | null;
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
  const proxySecret = String(env.YOINK_HOSTED_PROXY_SECRET ?? "");
  const allowedHosts = String(env.YOINK_HOSTED_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOrigins = String(env.YOINK_HOSTED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowedExtensionOrigins = hostedExtensionOrigins(env.YOINK_HOSTED_EXTENSION_ORIGINS);
  if (hostedRequested && (Buffer.byteLength(proxySecret, "utf8") < 32
    || !allowedHosts.length || !allowedOrigins.length || !allowedExtensionOrigins.length)) {
    throw new Error("Hosted mode requires a 32-byte YOINK_HOSTED_PROXY_SECRET plus explicit YOINK_HOSTED_HOSTS, YOINK_HOSTED_ORIGINS, and YOINK_HOSTED_EXTENSION_ORIGINS.");
  }
  const witnessValues = {
    endpoint: String(env.YOINK_OBSERVER_RECIPE_WITNESS_URL ?? "").trim(),
    logId: String(env.YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID ?? "").trim(),
    keyId: String(env.YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID ?? "").trim(),
    publicKeySpki: String(env.YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI ?? "").trim()
  };
  const witnessRequested = Object.values(witnessValues).some(Boolean);
  const maxAgeSeconds = Number(env.YOINK_OBSERVER_RECIPE_WITNESS_MAX_AGE_SECONDS ?? 900);
  let observerRecipeWitness: YoinkConfig["observerRecipeWitness"] = null;
  if (witnessRequested) {
    if (Object.values(witnessValues).some((value) => !value)) {
      throw new Error("Observer recipe witness configuration requires URL, log ID, key ID, and public key SPKI together.");
    }
    observerRecipeWitness = {
      endpoint: witnessValues.endpoint,
      logId: witnessValues.logId,
      key: {
        algorithm: "Ed25519",
        keyId: witnessValues.keyId,
        publicKeySpki: witnessValues.publicKeySpki
      },
      maxAgeSeconds
    };
    // Constructor validation keeps configuration and runtime URL/key rules identical.
    new ObserverRecipeWitnessClient(observerRecipeWitness);
  }
  if (hostedRequested && !observerRecipeWitness) {
    throw new Error("Hosted mode requires an independently operated observer recipe witness configuration.");
  }
  return {
    host: "127.0.0.1",
    port: port(env.YOINK_PORT),
    dataDirectory,
    databasePath: join(dataDirectory, "yoink.sqlite"),
    webRoot: join(projectRoot, "apps", "web"),
    releaseRoot: join(projectRoot, "release"),
    version: projectVersion(projectRoot),
    backgroundWorkerMode,
    hosted: hostedRequested ? { proxySecret, allowedHosts, allowedOrigins, allowedExtensionOrigins } : null,
    observerRecipeWitness
  };
}
