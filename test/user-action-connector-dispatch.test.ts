import assert from "node:assert/strict";
import test from "node:test";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { UserActionConnectorRepository } from "../packages/database/src/user-action-connector-repository.js";
import { UserActionConnectorDispatchService } from "../packages/engine/src/user-action-connector-dispatch.js";
import {
  BoundUserActionWebhookTransport,
  loadUserActionWebhookRegistry,
  type UserActionWebhookRequest
} from "../packages/engine/src/user-action-webhook.js";

const NOW = Date.parse("2026-08-30T20:00:00.000Z");

function registry(kind: "discord" | "slack" | "webhook" = "webhook") {
  return loadUserActionWebhookRegistry({
    YOINK_USER_ACTION_CONNECTORS_JSON: JSON.stringify([{
      reference: "checkout_hook",
      kind,
      endpoint: "https://connectors.example.test/yoink"
    }])
  });
}

test("user-action connector dispatch leases through a capability and classifies delivery outcomes", async () => {
  const db = new YoinkDatabase();
  try {
    const configured = registry();
    const repository = new UserActionConnectorRepository(db, configured.bindings);
    const connector = repository.save({
      contractVersion: 1,
      kind: "webhook",
      name: "Checkout handoff",
      endpointReference: "checkout_hook",
      events: ["test"]
    }, "", NOW);
    repository.queueTest(connector.id, NOW + 1);
    const delivered: UserActionWebhookRequest[] = [];
    const success = new UserActionConnectorDispatchService(db, configured, {
      async deliver(request) {
        delivered.push(request);
        return { delivered: true, retryable: false, reasonCode: "connector_delivered", httpStatus: 204 };
      }
    });
    const first = await success.execute(NOW + 2);
    assert.equal(first.userConnectorDeliveriesAttempted, 1);
    assert.equal(first.userConnectorDeliveriesSucceeded, 1);
    assert.equal(delivered[0]?.endpointReference, "checkout_hook");
    assert.equal(delivered[0]?.payload.checkoutManual, true);
    assert.equal(repository.listDeliveries()[0]?.state, "delivered");

    repository.queueTest(connector.id, NOW + 3);
    const rejected = new UserActionConnectorDispatchService(db, configured, {
      async deliver() {
        return { delivered: false, retryable: false, reasonCode: "connector_rejected", httpStatus: 403 };
      }
    });
    const second = await rejected.execute(NOW + 4);
    assert.equal(second.userConnectorDeliveriesDeadLettered, 1);
    assert.equal(repository.listDeliveries()[0]?.state, "dead_letter");
    assert.equal(repository.listDeliveries()[0]?.lastErrorCode, "connector_rejected");
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("bound webhook transport uses deployment-owned HTTPS endpoints, manual redirects, and signatures", async () => {
  const secret = "s".repeat(48);
  const configured = loadUserActionWebhookRegistry({
    YOINK_USER_ACTION_CONNECTORS_JSON: JSON.stringify([{
      reference: "checkout_hook",
      kind: "discord",
      endpoint: "https://discord.example.test/yoink",
      signingSecretEnvironment: "YOINK_USER_ACTION_CONNECTOR_SECRET_CHECKOUT"
    }]),
    YOINK_USER_ACTION_CONNECTOR_SECRET_CHECKOUT: secret
  });
  const received: Array<{ url: string; init: RequestInit }> = [];
  const transport = new BoundUserActionWebhookTransport(
    configured,
    { YOINK_USER_ACTION_CONNECTOR_SECRET_CHECKOUT: secret },
    async (input, init) => {
      received.push({ url: String(input), init: init || {} });
      return new Response(null, { status: 204 });
    }
  );
  const result = await transport.deliver({
    deliveryId: "user_connector_delivery_test",
    connectorKind: "discord",
    endpointReference: "checkout_hook",
    payload: { eventType: "carted", title: "Target cards", privateNote: "must-not-forward" }
  });
  assert.equal(result.delivered, true);
  const request = received[0];
  assert.ok(request);
  assert.equal(request.url, "https://discord.example.test/yoink");
  assert.equal(request.init.redirect, "manual");
  const headers = request.init.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], "Yoink-User-Action-Connector/1");
  assert.match(headers["X-Yoink-Signature"] ?? "", /^sha256=[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    content: "Target cards · carted"
  });
  assert.throws(() => loadUserActionWebhookRegistry({
    YOINK_USER_ACTION_CONNECTORS_JSON: JSON.stringify([{
      reference: "bad_hook",
      kind: "webhook",
      endpoint: "https://127.0.0.1/private"
    }])
  }), /public HTTPS/);
});

test("an unavailable connector binding cannot block a later healthy delivery", async () => {
  const db = new YoinkDatabase();
  try {
    const configured = registry();
    const repository = new UserActionConnectorRepository(db, configured.bindings);
    const unavailable = repository.save({
      contractVersion: 1,
      kind: "webhook",
      name: "Removed deployment binding",
      endpointReference: "removed_hook",
      events: ["test"]
    }, "", NOW);
    repository.queueTest(unavailable.id, NOW + 1);
    const healthy = repository.save({
      contractVersion: 1,
      kind: "webhook",
      name: "Healthy checkout handoff",
      endpointReference: "checkout_hook",
      events: ["test"]
    }, "", NOW + 2);
    repository.queueTest(healthy.id, NOW + 3);

    const service = new UserActionConnectorDispatchService(db, configured, {
      async deliver() {
        return { delivered: true, retryable: false, reasonCode: "connector_delivered", httpStatus: 204 };
      }
    });
    const result = await service.execute(NOW + 4);
    assert.equal(result.userConnectorDeliveriesAttempted, 1);
    assert.equal(result.userConnectorDeliveriesSucceeded, 1);
    const states = new Map(repository.listDeliveries().map((item) => [item.connectorId, item]));
    assert.equal(states.get(unavailable.id)?.state, "dead_letter");
    assert.equal(states.get(unavailable.id)?.lastErrorCode, "connector_binding_unavailable");
    assert.equal(states.get(healthy.id)?.state, "delivered");
    db.assertIntegrity();
  } finally {
    db.close();
  }
});
