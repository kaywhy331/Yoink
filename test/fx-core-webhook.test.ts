import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  BoundUserActionWebhookTransport,
  loadUserActionWebhookRegistry
} from "../packages/engine/src/user-action-webhook.js";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

test("user connector deliveries carry a timestamped V2 signature bound to the delivery ID", async () => {
  const secret = "s".repeat(48);
  const env = {
    YOINK_USER_ACTION_CONNECTORS_JSON: JSON.stringify([{
      reference: "checkout_hook",
      kind: "webhook",
      endpoint: "https://hooks.example.test/yoink",
      signingSecretEnvironment: "YOINK_USER_ACTION_CONNECTOR_SECRET_CHECKOUT"
    }]),
    YOINK_USER_ACTION_CONNECTOR_SECRET_CHECKOUT: secret
  };
  const received: RequestInit[] = [];
  const transport = new BoundUserActionWebhookTransport(
    loadUserActionWebhookRegistry(env),
    env,
    async (_input, init) => {
      received.push(init || {});
      return new Response(null, { status: 204 });
    },
    () => NOW
  );
  const result = await transport.deliver({
    deliveryId: "user_connector_delivery_v2",
    connectorKind: "webhook",
    endpointReference: "checkout_hook",
    payload: { eventType: "carted", title: "Target cards" }
  });
  assert.equal(result.delivered, true);
  const headers = received[0]?.headers as Record<string, string>;
  const body = String(received[0]?.body);
  const timestamp = String(NOW / 1_000);
  assert.equal(headers["X-Yoink-Timestamp"], timestamp);
  assert.equal(headers["X-Yoink-Delivery-ID"], "user_connector_delivery_v2");
  // The legacy body-only header stays for existing receivers.
  assert.equal(headers["X-Yoink-Signature"], `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  assert.equal(
    headers["X-Yoink-Signature-V2"],
    `sha256=${createHmac("sha256", secret).update(`${timestamp}.user_connector_delivery_v2.${body}`).digest("hex")}`
  );
});
