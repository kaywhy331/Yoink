import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../apps/api/src/config.js";
import {
  loadInternalServiceCapabilityRegistry,
  safeInternalServiceCapabilityProjection
} from "../apps/api/src/internal-service-capabilities.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";

test("configuration keeps hosted authentication disabled by default", () => {
  const config = loadConfig(process.cwd(), {});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.hosted, null);
  assert.equal(config.observerRecipeWitness, null);
  assert.deepEqual(config.operatorAlertWebhookRegistry.definitions, []);
  assert.match(config.operatorAlertWebhookRegistry.fingerprint, /^[a-f0-9]{64}$/);
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

test("operator alert webhook configuration exposes only deployment-owned public references", () => {
  const config = loadConfig(process.cwd(), {
    YOINK_OPERATOR_ALERT_WEBHOOKS_JSON: JSON.stringify([{
      reference: "ops_primary",
      endpoint: "https://alerts.example.com/v1/yoink",
      signingSecretEnvironment: "YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY"
    }]),
    YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY: "this-secret-is-not-read-by-the-api-config-loader"
  });
  assert.equal(config.operatorAlertWebhookRegistry.definitions[0]?.reference, "ops_primary");
  assert.equal(config.operatorAlertWebhookRegistry.definitions[0]?.endpoint, "https://alerts.example.com/v1/yoink");
  assert.equal(config.operatorAlertWebhookRegistry.definitions[0]?.signingSecretEnvironment, "YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY");
  assert.match(config.operatorAlertWebhookRegistry.definitions[0]?.bindingFingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.equal(config.operatorAlertWebhookRegistry.bindings.ops_primary, config.operatorAlertWebhookRegistry.definitions[0]?.bindingFingerprint);
  assert.equal(JSON.stringify(config.operatorAlertWebhookRegistry).includes("this-secret"), false);
  assert.throws(() => loadConfig(process.cwd(), {
    YOINK_OPERATOR_ALERT_WEBHOOKS_JSON: "not-json"
  }), /JSON array/);
});

test("hosted configuration requires authentication allowlists and an independently pinned recipe witness", () => {
  assert.throws(() => loadConfig(process.cwd(), { YOINK_HOSTED_MODE: "1" }), /requires a 32-byte/);
  const witness = ObserverRecipeSigner.ephemeral();
  const hosted = {
    YOINK_HOSTED_MODE: "1",
    YOINK_HOSTED_PROXY_SECRET: "a-secret-value-that-is-at-least-thirty-two-bytes",
    YOINK_HOSTED_HOSTS: "yoink.example.com,internal.example.com:443",
    YOINK_HOSTED_ORIGINS: "https://yoink.example.com",
    YOINK_HOSTED_EXTENSION_ORIGINS: `chrome-extension://${"b".repeat(32)}`,
    YOINK_HOSTED_SERVICE_CAPABILITIES_JSON: JSON.stringify({
      delivery_worker: "internal.delivery",
      identity_risk_worker: "internal.eligibility",
      principal_sync: "internal.principal"
    })
  };
  const hostedWithoutServiceRegistry = { ...hosted } as Record<string, string>;
  delete hostedWithoutServiceRegistry.YOINK_HOSTED_SERVICE_CAPABILITIES_JSON;
  assert.throws(
    () => loadConfig(process.cwd(), hostedWithoutServiceRegistry),
    /requires an explicit YOINK_HOSTED_SERVICE_CAPABILITIES_JSON/
  );
  assert.throws(() => loadConfig(process.cwd(), hosted), /independently operated observer recipe witness/);
  const config = loadConfig(process.cwd(), {
    ...hosted,
    YOINK_OBSERVER_RECIPE_WITNESS_URL: "https://witness.example.net/v1/checkpoints",
    YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID: "yoink-production",
    YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID: witness.keyId,
    YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI: witness.publicKeySpki,
    YOINK_OBSERVER_RECIPE_WITNESS_MAX_AGE_SECONDS: "600"
  });
  assert.equal(config.hosted?.proxySecret, "a-secret-value-that-is-at-least-thirty-two-bytes");
  assert.deepEqual(config.hosted?.allowedHosts, ["yoink.example.com", "internal.example.com:443"]);
  assert.deepEqual(config.hosted?.allowedOrigins, ["https://yoink.example.com"]);
  assert.deepEqual(config.hosted?.allowedExtensionOrigins, [`chrome-extension://${"b".repeat(32)}`]);
  assert.equal(config.hosted?.internalServiceCapabilities.configuredServiceCount, 3);
  assert.deepEqual(config.hosted?.internalServiceCapabilities.coverage, {
    delivery: 1,
    eligibility: 1,
    principal: 1
  });
  assert.deepEqual(config.observerRecipeWitness, {
    endpoint: "https://witness.example.net/v1/checkpoints",
    logId: "yoink-production",
    key: { algorithm: "Ed25519", keyId: witness.keyId, publicKeySpki: witness.publicKeySpki },
    maxAgeSeconds: 600
  });
  assert.equal(config.backgroundWorkerMode, "external");
});

test("internal service capability configuration is exact, singular, and safely projected", () => {
  assert.throws(
    () => loadInternalServiceCapabilityRegistry(undefined, true),
    /requires an explicit YOINK_HOSTED_SERVICE_CAPABILITIES_JSON/
  );
  assert.throws(() => loadInternalServiceCapabilityRegistry("[]"), /exact JSON object/);
  assert.throws(() => loadInternalServiceCapabilityRegistry("not-json"), /exact JSON object/);
  assert.throws(() => loadInternalServiceCapabilityRegistry(JSON.stringify({ ab: "internal.delivery" })), /actor ID/);
  assert.throws(() => loadInternalServiceCapabilityRegistry(JSON.stringify({ worker_one: ["internal.delivery"] })), /exactly one/);
  assert.throws(() => loadInternalServiceCapabilityRegistry(JSON.stringify({ worker_one: "internal.unknown" })), /exactly one/);
  assert.throws(() => loadInternalServiceCapabilityRegistry(JSON.stringify(Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`worker_${index}`, "internal.delivery"])
  ))), /at most 64/);

  const registry = loadInternalServiceCapabilityRegistry(JSON.stringify({
    principal_worker: "internal.principal",
    delivery_worker: "internal.delivery"
  }));
  const safe = safeInternalServiceCapabilityProjection(registry);
  assert.equal(safe.configured, true);
  assert.equal(safe.configuredServiceCount, 2);
  assert.deepEqual(safe.coverage, { delivery: 1, eligibility: 0, principal: 1 });
  assert.equal(safe.oneCapabilityPerService, true);
  assert.equal(safe.unconfiguredServicesDenied, true);
  assert.equal(safe.clientCapabilityHeadersAccepted, false);
  assert.match(safe.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(safe).includes("delivery_worker"), false);
  assert.equal(JSON.stringify(safe).includes("principal_worker"), false);
  assert.deepEqual(safe.definitions.map((item) => item.capability), ["internal.delivery", "internal.principal"]);
  assert.equal(registry.assignments.delivery_worker, "internal.delivery");
  const explicitDenyAll = loadInternalServiceCapabilityRegistry("{}");
  assert.equal(explicitDenyAll.configured, true);
  assert.equal(explicitDenyAll.configuredServiceCount, 0);
});

test("hosted configuration requires an exact package-pinned Chrome extension origin", () => {
  const base = {
    YOINK_HOSTED_MODE: "1",
    YOINK_HOSTED_PROXY_SECRET: "a-secret-value-that-is-at-least-thirty-two-bytes",
    YOINK_HOSTED_HOSTS: "yoink.example.com",
    YOINK_HOSTED_ORIGINS: "https://yoink.example.com"
  };
  assert.throws(() => loadConfig(process.cwd(), base), /YOINK_HOSTED_EXTENSION_ORIGINS/);
  assert.throws(() => loadConfig(process.cwd(), {
    ...base,
    YOINK_HOSTED_EXTENSION_ORIGINS: "chrome-extension://not-a-real-extension-id"
  }), /exact chrome-extension origins/);
  assert.throws(() => loadConfig(process.cwd(), {
    ...base,
    YOINK_HOSTED_EXTENSION_ORIGINS: `https://${"b".repeat(32)}.example.com`
  }), /exact chrome-extension origins/);
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
