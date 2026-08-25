import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const WORKER_ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;

export interface YoinkWorkerConfig {
  dataDirectory: string;
  databasePath: string;
  version: string;
  workerId: string;
  pollIntervalMs: number;
  leaseSeconds: number;
  maximumPrincipalsPerCycle: number;
  maximumTasksPerCycle: number;
  maximumTasksPerPrincipal: number;
}

function projectVersion(projectRoot: string): string {
  try {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as { version?: unknown };
    return String(packageJson.version ?? "0.0.0").slice(0, 40);
  } catch {
    return "0.0.0";
  }
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  variable: string
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${variable} must be a whole number from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

export function loadWorkerConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): YoinkWorkerConfig {
  const projectRoot = resolve(cwd);
  const requestedDataDirectory = String(env.YOINK_DATA_DIR ?? "data").trim();
  if (!requestedDataDirectory) throw new Error("YOINK_DATA_DIR must identify a non-empty directory.");
  const dataDirectory = isAbsolute(requestedDataDirectory)
    ? requestedDataDirectory
    : resolve(projectRoot, requestedDataDirectory);
  const workerId = String(env.YOINK_WORKER_ID ?? "background_worker_standalone").trim();
  if (!WORKER_ID_PATTERN.test(workerId)) {
    throw new Error("YOINK_WORKER_ID must contain 3 through 120 letters, numbers, underscores, or hyphens.");
  }
  return {
    dataDirectory,
    databasePath: join(dataDirectory, "yoink.sqlite"),
    version: projectVersion(projectRoot),
    workerId,
    pollIntervalMs: boundedInteger(env.YOINK_WORKER_POLL_MS, 2_000, 500, 60_000, "YOINK_WORKER_POLL_MS"),
    leaseSeconds: boundedInteger(env.YOINK_WORKER_LEASE_SECONDS, 60, 15, 300, "YOINK_WORKER_LEASE_SECONDS"),
    maximumPrincipalsPerCycle: boundedInteger(
      env.YOINK_WORKER_PRINCIPALS_PER_CYCLE,
      100,
      1,
      500,
      "YOINK_WORKER_PRINCIPALS_PER_CYCLE"
    ),
    maximumTasksPerCycle: boundedInteger(
      env.YOINK_WORKER_TASKS_PER_CYCLE,
      100,
      1,
      1_000,
      "YOINK_WORKER_TASKS_PER_CYCLE"
    ),
    maximumTasksPerPrincipal: boundedInteger(
      env.YOINK_WORKER_TASKS_PER_PRINCIPAL,
      20,
      1,
      100,
      "YOINK_WORKER_TASKS_PER_PRINCIPAL"
    )
  };
}
