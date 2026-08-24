import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface YoinkConfig {
  host: "127.0.0.1";
  port: number;
  dataDirectory: string;
  databasePath: string;
  webRoot: string;
  releaseRoot: string;
  version: string;
  hosted: {
    proxySecret: string;
    allowedHosts: string[];
    allowedOrigins: string[];
  } | null;
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

export function loadConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): YoinkConfig {
  const projectRoot = resolve(cwd);
  const requestedDataDirectory = String(env.YOINK_DATA_DIR ?? "data").trim();
  const dataDirectory = isAbsolute(requestedDataDirectory)
    ? requestedDataDirectory
    : resolve(projectRoot, requestedDataDirectory);
  const hostedRequested = env.YOINK_HOSTED_MODE === "1";
  const proxySecret = String(env.YOINK_HOSTED_PROXY_SECRET ?? "");
  const allowedHosts = String(env.YOINK_HOSTED_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOrigins = String(env.YOINK_HOSTED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (hostedRequested && (Buffer.byteLength(proxySecret, "utf8") < 32 || !allowedHosts.length || !allowedOrigins.length)) {
    throw new Error("Hosted mode requires a 32-byte YOINK_HOSTED_PROXY_SECRET plus explicit YOINK_HOSTED_HOSTS and YOINK_HOSTED_ORIGINS.");
  }
  return {
    host: "127.0.0.1",
    port: port(env.YOINK_PORT),
    dataDirectory,
    databasePath: join(dataDirectory, "yoink.sqlite"),
    webRoot: join(projectRoot, "apps", "web"),
    releaseRoot: join(projectRoot, "release"),
    version: projectVersion(projectRoot),
    hosted: hostedRequested ? { proxySecret, allowedHosts, allowedOrigins } : null
  };
}
