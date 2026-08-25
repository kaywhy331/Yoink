import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../apps/api/src/config.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";

test("configuration keeps hosted authentication disabled by default", () => {
  const config = loadConfig(process.cwd(), {});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.hosted, null);
  assert.equal(config.observerRecipeWitness, null);
  assert.equal(config.backgroundWorkerMode, "embedded");
  assert.equal(loadConfig(process.cwd(), { YOINK_BACKGROUND_WORKER: "0" }).backgroundWorkerMode, "disabled");
  assert.equal(loadConfig(process.cwd(), { YOINK_BACKGROUND_WORKER: "1" }).backgroundWorkerMode, "embedded");
  assert.equal(loadConfig(process.cwd(), { YOINK_BACKGROUND_WORKER_MODE: "external" }).backgroundWorkerMode, "external");
  assert.throws(() => loadConfig(process.cwd(), { YOINK_BACKGROUND_WORKER: "sometimes" }), /must be 1.*or 0/);
  assert.throws(() => loadConfig(process.cwd(), { YOINK_BACKGROUND_WORKER_MODE: "sometimes" }), /embedded, external, or disabled/);
  assert.throws(() => loadConfig(process.cwd(), {
    YOINK_BACKGROUND_WORKER: "1",
    YOINK_BACKGROUND_WORKER_MODE: "embedded"
  }), /not both/);
  assert.throws(() => loadConfig(process.cwd(), { YOINK_DATA_DIR: "" }), /non-empty directory/);
});

test("hosted configuration requires authentication allowlists and an independently pinned recipe witness", () => {
  assert.throws(() => loadConfig(process.cwd(), { YOINK_HOSTED_MODE: "1" }), /requires a 32-byte/);
  const witness = ObserverRecipeSigner.ephemeral();
  const hosted = {
    YOINK_HOSTED_MODE: "1",
    YOINK_HOSTED_PROXY_SECRET: "a-secret-value-that-is-at-least-thirty-two-bytes",
    YOINK_HOSTED_HOSTS: "yoink.example.com,internal.example.com:443",
    YOINK_HOSTED_ORIGINS: "https://yoink.example.com"
  };
  assert.throws(() => loadConfig(process.cwd(), hosted), /independently operated observer recipe witness/);
  const config = loadConfig(process.cwd(), {
    ...hosted,
    YOINK_OBSERVER_RECIPE_WITNESS_URL: "https://witness.example.net/v1/checkpoints",
    YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID: "yoink-production",
    YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID: witness.keyId,
    YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI: witness.publicKeySpki,
    YOINK_OBSERVER_RECIPE_WITNESS_MAX_AGE_SECONDS: "600"
  });
  assert.deepEqual(config.hosted, {
    proxySecret: "a-secret-value-that-is-at-least-thirty-two-bytes",
    allowedHosts: ["yoink.example.com", "internal.example.com:443"],
    allowedOrigins: ["https://yoink.example.com"]
  });
  assert.deepEqual(config.observerRecipeWitness, {
    endpoint: "https://witness.example.net/v1/checkpoints",
    logId: "yoink-production",
    key: { algorithm: "Ed25519", keyId: witness.keyId, publicKeySpki: witness.publicKeySpki },
    maxAgeSeconds: 600
  });
  assert.equal(config.backgroundWorkerMode, "external");
});

test("observer recipe witness configuration rejects partial, insecure, or mismatched public pins", () => {
  const witness = ObserverRecipeSigner.ephemeral();
  assert.throws(() => loadConfig(process.cwd(), {
    YOINK_OBSERVER_RECIPE_WITNESS_URL: "https://witness.example.net/v1/checkpoints"
  }), /requires URL, log ID, key ID, and public key SPKI together/);
  assert.throws(() => loadConfig(process.cwd(), {
    YOINK_OBSERVER_RECIPE_WITNESS_URL: "http://witness.example.net/v1/checkpoints",
    YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID: "yoink-production",
    YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID: witness.keyId,
    YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI: witness.publicKeySpki
  }), /HTTPS URL/);
  assert.throws(() => loadConfig(process.cwd(), {
    YOINK_OBSERVER_RECIPE_WITNESS_URL: "https://witness.example.net/v1/checkpoints",
    YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID: "yoink-production",
    YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID: "a".repeat(64),
    YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI: witness.publicKeySpki
  }), /public key pin is invalid/);
});
