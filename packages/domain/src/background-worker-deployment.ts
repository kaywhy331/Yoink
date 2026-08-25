import {
  BACKGROUND_TASK_DEFINITIONS,
  BACKGROUND_TASK_KINDS
} from "./background-task.js";
import { stableHash } from "./ids.js";

export const BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION = 2;

export type BackgroundWorkerDeploymentMode = "embedded" | "external" | "disabled";

export interface BackgroundWorkerPublicWitnessConfig {
  endpoint: string;
  logId: string;
  key: {
    algorithm: "Ed25519";
    keyId: string;
    publicKeySpki: string;
  };
  maxAgeSeconds: number;
}

export interface BackgroundWorkerDeploymentFingerprintInput {
  runtimeVersion: string;
  observerRecipeWitness: BackgroundWorkerPublicWitnessConfig | null;
  observerRecipeWitnessRequired: boolean;
  operatorAlertWebhookRegistryFingerprint: string;
}

export function backgroundWorkerDeploymentFingerprint(
  input: BackgroundWorkerDeploymentFingerprintInput
): string {
  const runtimeVersion = String(input?.runtimeVersion ?? "").trim();
  if (!runtimeVersion || runtimeVersion.length > 40) {
    throw new Error("A bounded worker runtime version is required for deployment attestation.");
  }
  const witness = input.observerRecipeWitness;
  const connectorRegistryFingerprint = String(input.operatorAlertWebhookRegistryFingerprint ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(connectorRegistryFingerprint)) {
    throw new Error("A valid operator alert webhook registry fingerprint is required for deployment attestation.");
  }
  const taskRegistry = BACKGROUND_TASK_KINDS.map((taskKind) => {
    const definition = BACKGROUND_TASK_DEFINITIONS[taskKind];
    return [taskKind, definition.intervalSeconds, definition.maximumAttempts];
  });
  return stableHash(
    "yoink_background_worker_deployment_v2",
    BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION,
    runtimeVersion,
    JSON.stringify(taskRegistry),
    input.observerRecipeWitnessRequired ? 1 : 0,
    witness ? 1 : 0,
    witness?.endpoint ?? "",
    witness?.logId ?? "",
    witness?.key.algorithm ?? "",
    witness?.key.keyId ?? "",
    witness ? stableHash("yoink_worker_witness_public_spki_v1", witness.key.publicKeySpki) : "",
    witness?.maxAgeSeconds ?? 0,
    connectorRegistryFingerprint
  );
}
