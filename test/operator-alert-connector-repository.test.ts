import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_OBSERVER_VERSION,
  SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION,
  type RetailerAdapterDiagnosticInput
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { OperatorAlertConnectorRepository } from "../packages/database/src/operator-alert-connector-repository.js";
import { OperatorAlertRepository } from "../packages/database/src/operator-alert-repository.js";
import { OperatorAlertConnectorDispatchService } from "../packages/engine/src/operator-alert-connector-dispatch.js";
import type { OperatorAlertWebhookTransport } from "../packages/engine/src/operator-alert-webhook.js";

const NOW = new Date("2026-08-25T18:00:00.000Z").getTime();
const REGISTRY = {
  definitions: [{
    reference: "ops_primary",
    endpoint: "https://alerts.example.com/v1/yoink",
    signingSecretEnvironment: "YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY",
    bindingFingerprint: "b".repeat(64)
  }],
  bindings: { ops_primary: "b".repeat(64) },
  fingerprint: "a".repeat(64)
} as const;

function diagnostic(retailerSku: string, observedAt = NOW + 1_000): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    retailerId: "amazon",
    retailerSku,
    adapterVersion: AMAZON_OBSERVER_VERSION,
    operation: "observe",
    outcome: "failed",
    failureStage: "offer_binding",
    reasonCode: "offer_binding_ambiguous",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "accordion",
      sellerShape: "legacy",
      fulfillmentShape: "shipping",
      addControlCount: 1,
      genericAddIntentCount: 1,
      scopedControlCount: 0,
      explicitSkuInputCount: 2,
      exactSkuInputCount: 2,
      variationSkuCount: 0,
      canonicalOfferInputCount: 2,
      canonicalOfferDistinctCount: 1,
      alternateOfferInputCount: 1,
      alternateOfferDistinctCount: 1,
      priceCandidateCount: 1,
      quantityControlCount: 0,
      securityChallenge: false,
      interactiveBlock: ""
    }
  };
}

function seedFailure(db: YoinkDatabase, sku = "B0FB21526X"): void {
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(NOW);
  const device = devices.pair({ pairingCode: pairing.code }, NOW + 100);
  new AdapterDiagnosticRepository(db).record(device.id, diagnostic(sku), NOW + 2_000);
}

function saveConnector(alerts: OperatorAlertRepository, endpointReference = "ops_primary") {
  return alerts.saveConnector({
    name: "Primary operations webhook",
    enabled: true,
    kind: "webhook",
    endpointReference,
    minimumSeverity: "warning",
    confirmation: SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION
  }, "", NOW + 200);
}

test("sanitized alert events queue and durably dispatch through a bound connector", async () => {
  const db = new YoinkDatabase();
  try {
    const alerts = new OperatorAlertRepository(db, REGISTRY.bindings);
    saveConnector(alerts);
    seedFailure(db);
    assert.equal(alerts.reconcileAdapterRepairs(
      new AdapterDiagnosticRepository(db).listRepairQueue(),
      "request_connector_open_001",
      NOW + 2_100
    ).opened, 1);

    const stored = db.get<{ payloadJson: string }>(
      "SELECT payload_json AS payloadJson FROM operator_alert_connector_deliveries"
    );
    assert.ok(stored);
    assert.equal(stored.payloadJson.includes("B0FB21526X"), false);
    assert.equal(stored.payloadJson.includes("Amazon.com"), false);
    const payload = JSON.parse(stored.payloadJson) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), [
      "affectedEntityCount", "contractVersion", "emittedAt", "eventId", "eventType",
      "failureStage", "firstSeenAt", "incidentId", "lastSeenAt", "layoutFingerprint",
      "occurrenceCount", "operation", "privacyClassification", "reasonCode", "retailerId", "severity"
    ]);

    const observed: Array<Record<string, unknown>> = [];
    const transport: OperatorAlertWebhookTransport = {
      async deliver(request) {
        observed.push({ ...request });
        return { disposition: "delivered", reasonCode: "webhook_accepted", httpStatus: 202 };
      }
    };
    const driftedRegistry = {
      ...REGISTRY,
      definitions: [{ ...REGISTRY.definitions[0], endpoint: "https://other.example.com/v1/yoink", bindingFingerprint: "c".repeat(64) }],
      bindings: { ops_primary: "c".repeat(64) },
      fingerprint: "d".repeat(64)
    };
    const drifted = await new OperatorAlertConnectorDispatchService(db, driftedRegistry, transport).execute(NOW + 2_150);
    assert.equal(drifted.connectorDeliveriesAttempted, 0);
    assert.equal(db.get<{ state: string }>("SELECT state FROM operator_alert_connector_deliveries")?.state, "pending");
    const dispatched = await new OperatorAlertConnectorDispatchService(db, REGISTRY, transport).execute(NOW + 2_200);
    assert.equal(dispatched.connectorDeliveriesAttempted, 1);
    assert.equal(dispatched.connectorDeliveriesSucceeded, 1);
    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.endpointReference, "ops_primary");

    const connectorSnapshot = (alerts.snapshot(NOW + 2_200) as {
      connectors: { counts: Record<string, number>; connectors: Array<Record<string, unknown>>; deliveries: Array<Record<string, unknown>> };
    }).connectors;
    assert.equal(connectorSnapshot.connectors[0]?.runtimeBound, true);
    assert.equal(connectorSnapshot.counts.deliveredOperatorAlertConnectorDeliveries, 1);
    assert.equal(connectorSnapshot.deliveries[0]?.deliveryState, "delivered");
    assert.equal(connectorSnapshot.deliveries[0]?.lastHttpStatus, 202);
    assert.deepEqual(
      db.all<{ eventType: string }>("SELECT event_type AS eventType FROM operator_alert_connector_delivery_events ORDER BY sequence").map((row) => row.eventType),
      ["queued", "leased", "delivered"]
    );
    assert.throws(
      () => db.run("UPDATE operator_alert_connector_delivery_events SET reason_code = 'tampered'"),
      /append-only/
    );
  } finally {
    db.close();
  }
});

test("retryable failures retain bounded work and connector changes cancel instead of retargeting", async () => {
  const db = new YoinkDatabase();
  try {
    const alerts = new OperatorAlertRepository(db, {
      ops_primary: "b".repeat(64),
      ops_secondary: "c".repeat(64)
    });
    const connector = saveConnector(alerts);
    seedFailure(db, "B0FPPWKMGK");
    alerts.reconcileAdapterRepairs(
      new AdapterDiagnosticRepository(db).listRepairQueue(),
      "request_connector_retry_001",
      NOW + 2_100
    );
    const retrying: OperatorAlertWebhookTransport = {
      async deliver() {
        return { disposition: "retry", reasonCode: "webhook_retryable_status", httpStatus: 503 };
      }
    };
    const result = await new OperatorAlertConnectorDispatchService(db, REGISTRY, retrying).execute(NOW + 2_200);
    assert.equal(result.connectorDeliveriesRetried, 1);
    assert.equal(db.get<{ state: string }>("SELECT state FROM operator_alert_connector_deliveries")?.state, "retry_wait");

    alerts.saveConnector({
      name: connector.name,
      enabled: true,
      kind: "webhook",
      endpointReference: "ops_secondary",
      minimumSeverity: "warning",
      confirmation: SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION
    }, connector.id, NOW + 2_300);
    const cancelled = db.get<{ state: string; endpointReference: string }>(
      "SELECT state, endpoint_reference AS endpointReference FROM operator_alert_connector_deliveries"
    );
    assert.equal(cancelled?.state, "cancelled");
    assert.equal(cancelled?.endpointReference, "ops_primary");
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operator_alert_connector_delivery_events WHERE event_type = 'cancelled'"
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("unbound connector references remain visible and cannot be leased", () => {
  const db = new YoinkDatabase();
  try {
    const alerts = new OperatorAlertRepository(db, {});
    const connector = saveConnector(alerts, "staged_reference");
    assert.equal(connector.runtimeBound, false);
    seedFailure(db, "B0GF44F4MG");
    alerts.reconcileAdapterRepairs(
      new AdapterDiagnosticRepository(db).listRepairQueue(),
      "request_connector_unbound_001",
      NOW + 2_100
    );
    const repository = new OperatorAlertConnectorRepository(db);
    assert.equal(repository.leaseNext({}, 60, NOW + 2_200), null);
    assert.equal(db.get<{ state: string }>("SELECT state FROM operator_alert_connector_deliveries")?.state, "pending");
    assert.throws(
      () => db.run("UPDATE operator_alert_connector_deliveries SET state = 'delivered'"),
      /delivery state is invalid/
    );
    assert.throws(() => alerts.saveConnector({
      name: "Bad connector",
      enabled: true,
      kind: "webhook",
      endpointReference: "https://attacker.example/path",
      minimumSeverity: "warning",
      confirmation: SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION
    }), /endpoint reference/);
  } finally {
    db.close();
  }
});
