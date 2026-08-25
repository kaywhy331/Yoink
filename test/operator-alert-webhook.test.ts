import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  HmacOperatorAlertWebhookTransport,
  loadOperatorAlertWebhookRegistry
} from "../packages/engine/src/operator-alert-webhook.js";

const SECRET_ENV = "YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY";
const SECRET = "a-deployment-owned-signing-secret-at-least-32-bytes";

function environment(endpoint = "https://alerts.example.com/v1/yoink"): NodeJS.ProcessEnv {
  return {
    YOINK_OPERATOR_ALERT_WEBHOOKS_JSON: JSON.stringify([{
      reference: "ops_primary",
      endpoint,
      signingSecretEnvironment: SECRET_ENV
    }]),
    [SECRET_ENV]: SECRET
  };
}

test("webhook registry fingerprints public deployment material without retaining secrets", () => {
  const registry = loadOperatorAlertWebhookRegistry(environment());
  assert.equal(registry.definitions.length, 1);
  assert.match(registry.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(registry).includes(SECRET), false);
  assert.notEqual(
    registry.fingerprint,
    loadOperatorAlertWebhookRegistry(environment("https://alerts.example.com/v2/yoink")).fingerprint
  );
  assert.throws(
    () => loadOperatorAlertWebhookRegistry(environment("http://alerts.example.com/v1/yoink")),
    /public HTTPS/
  );
  assert.throws(
    () => loadOperatorAlertWebhookRegistry(environment("https://127.0.0.1/v1/yoink")),
    /IP literals/
  );
  assert.throws(
    () => loadOperatorAlertWebhookRegistry(environment("https://alerts.example.com/v1/yoink?token=secret")),
    /query strings/
  );
  assert.throws(() => loadOperatorAlertWebhookRegistry({
    YOINK_OPERATOR_ALERT_WEBHOOKS_JSON: JSON.stringify([{
      reference: "ops_primary",
      endpoint: "https://alerts.example.com/v1/yoink",
      signingSecretEnvironment: "HOME"
    }])
  }), /dedicated.*environment variable/);
});

test("webhook transport sends stable HMAC-signed JSON and rejects redirects", async () => {
  const registry = loadOperatorAlertWebhookRegistry(environment());
  let observedUrl = "";
  let observedBody = "";
  let observedHeaders = new Headers();
  const acceptedFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    observedUrl = String(input);
    observedBody = String(init?.body ?? "");
    observedHeaders = new Headers(init?.headers);
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  const transport = new HmacOperatorAlertWebhookTransport(registry, environment(), acceptedFetch);
  const result = await transport.deliver({
    deliveryId: "alert_connector_delivery_001",
    eventId: "alert_event_001",
    endpointReference: "ops_primary",
    payload: { severity: "critical", occurrenceCount: 3, contractVersion: 1 }
  });
  assert.deepEqual(result, { disposition: "delivered", reasonCode: "webhook_accepted", httpStatus: 202 });
  assert.equal(observedUrl, "https://alerts.example.com/v1/yoink");
  assert.equal(observedBody, '{"contractVersion":1,"occurrenceCount":3,"severity":"critical"}');
  assert.equal(observedHeaders?.get("X-Yoink-Delivery-ID"), "alert_connector_delivery_001");
  assert.equal(
    observedHeaders?.get("X-Yoink-Signature"),
    `sha256=${createHmac("sha256", SECRET).update(observedBody, "utf8").digest("hex")}`
  );

  const redirecting = new HmacOperatorAlertWebhookTransport(
    registry,
    environment(),
    (async () => new Response(null, { status: 302 })) as typeof fetch
  );
  assert.deepEqual(await redirecting.deliver({
    deliveryId: "alert_connector_delivery_002",
    eventId: "alert_event_002",
    endpointReference: "ops_primary",
    payload: { contractVersion: 1 }
  }), { disposition: "dead_letter", reasonCode: "webhook_redirect_rejected", httpStatus: 302 });
});

test("webhook secret resolution fails closed and transport errors remain redacted", async () => {
  const registry = loadOperatorAlertWebhookRegistry(environment());
  assert.throws(
    () => new HmacOperatorAlertWebhookTransport(registry, {}),
    /32 through 512 bytes/
  );
  const transport = new HmacOperatorAlertWebhookTransport(
    registry,
    environment(),
    (async () => { throw new Error(`network failed with ${SECRET}`); }) as typeof fetch
  );
  const result = await transport.deliver({
    deliveryId: "alert_connector_delivery_003",
    eventId: "alert_event_003",
    endpointReference: "ops_primary",
    payload: { contractVersion: 1 }
  });
  assert.deepEqual(result, { disposition: "retry", reasonCode: "webhook_transport_failed", httpStatus: 0 });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});
