import {
  ObserverRecipeWitnessClient,
  type ObserverRecipeWitnessClientOptions
} from "./witness.js";

export type ObserverRecipeWitnessRuntimeConfig = Omit<
  ObserverRecipeWitnessClientOptions,
  "fetch" | "requestTimeoutMs"
>;

export function loadObserverRecipeWitnessConfig(
  env: NodeJS.ProcessEnv
): ObserverRecipeWitnessRuntimeConfig | null {
  const values = {
    endpoint: String(env.YOINK_OBSERVER_RECIPE_WITNESS_URL ?? "").trim(),
    logId: String(env.YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID ?? "").trim(),
    keyId: String(env.YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID ?? "").trim(),
    publicKeySpki: String(env.YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI ?? "").trim()
  };
  const requested = Object.values(values).some(Boolean);
  if (!requested) return null;
  if (Object.values(values).some((value) => !value)) {
    throw new Error("Observer recipe witness configuration requires URL, log ID, key ID, and public key SPKI together.");
  }
  const config: ObserverRecipeWitnessRuntimeConfig = {
    endpoint: values.endpoint,
    logId: values.logId,
    key: {
      algorithm: "Ed25519",
      keyId: values.keyId,
      publicKeySpki: values.publicKeySpki
    },
    maxAgeSeconds: Number(env.YOINK_OBSERVER_RECIPE_WITNESS_MAX_AGE_SECONDS ?? 900)
  };
  // Keep configuration validation identical in API and worker processes.
  new ObserverRecipeWitnessClient(config);
  return config;
}
