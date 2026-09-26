import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_OBSERVER_VERSION,
  RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION,
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
      new AdapterDiagnosticRepository(db).listRepairQueue(50, NOW + 2_100),
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
      connectors: {
        counts: Record<string, number>;
        connectors: Array<Record<string, unknown>>;
        health: Array<Record<string, unknown>>;
        deliveries: Array<Record<string, unknown>>;
      };
    }).connectors;
    assert.equal(connectorSnapshot.connectors[0]?.runtimeBound, true);
    assert.equal(connectorSnapshot.counts.deliveredOperatorAlertConnectorDeliveries, 1);
    assert.equal(connectorSnapshot.counts.healthyOperatorAlertConnectors, 1);
    assert.equal(connectorSnapshot.health[0]?.status, "healthy");
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
      new AdapterDiagnosticRepository(db).listRepairQueue(50, NOW + 2_100),
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
    assert.equal((alerts.snapshot(NOW + 2_200) as {
      connectors: { health: Array<Record<string, unknown>> };
    }).connectors.health[0]?.status, "degraded");
    assert.equal((alerts.snapshot(NOW + 2_100 + 901_000) as {
      connectors: { health: Array<Record<string, unknown>> };
    }).connectors.health[0]?.status, "critical");

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
    assert.equal((alerts.snapshot(NOW + 300) as {
      connectors: { health: Array<Record<string, unknown>> };
    }).connectors.health[0]?.status, "unbound");
    seedFailure(db, "B0GF44F4MG");
    alerts.reconcileAdapterRepairs(
      new AdapterDiagnosticRepository(db).listRepairQueue(50, NOW + 2_100),
      "request_connector_unbound_001",
      NOW + 2_100
    );
    const repository = new OperatorAlertConnectorRepository(db);
    assert.equal(repository.leaseNext({}, 60, NOW + 2_200), null);
    assert.equal(db.get<{ state: string }>("SELECT state FROM operator_alert_connector_deliveries")?.state, "pending");
    assert.throws(
      () => db.run("UPDATE operator_alert_connector_deliveries SET state = 'delivered'"),
      /delivery transition is invalid/
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

test("an authorized dead-letter replay preserves exact identity, payload, binding, and immutable history", async () => {
  const db = new YoinkDatabase();
  try {
    const alerts = new OperatorAlertRepository(db, REGISTRY.bindings);
    saveConnector(alerts);
    seedFailure(db, "B0FH8M48ZC");
    alerts.reconcileAdapterRepairs(
      new AdapterDiagnosticRepository(db).listRepairQueue(50, NOW + 2_100),
      "request_connector_replay_open_001",
      NOW + 2_100
    );
    const rejected: OperatorAlertWebhookTransport = {
      async deliver() {
        return { disposition: "dead_letter", reasonCode: "webhook_rejected", httpStatus: 400 };
      }
    };
    await new OperatorAlertConnectorDispatchService(db, REGISTRY, rejected).execute(NOW + 2_200);
    const before = db.get<{
      id: string; payloadJson: string; payloadHash: string; idempotencyKeyHash: string;
      endpointReference: string; endpointBindingFingerprint: string;
    }>(
      `SELECT id, payload_json AS payloadJson, payload_hash AS payloadHash,
              idempotency_key_hash AS idempotencyKeyHash,
              endpoint_reference AS endpointReference,
              endpoint_binding_fingerprint AS endpointBindingFingerprint
       FROM operator_alert_connector_deliveries`
    );
    assert.ok(before);
    const critical = (alerts.snapshot(NOW + 2_200) as {
      connectors: { health: Array<Record<string, unknown>>; deliveries: Array<Record<string, unknown>> };
    }).connectors;
    assert.equal(critical.health[0]?.status, "critical");
    assert.equal(critical.deliveries[0]?.replayEligible, true);
    assert.throws(
      () => db.run(
        `UPDATE operator_alert_connector_deliveries SET state = 'pending', attempt_count = 0,
           payload_json = '{}', lease_capability_hash = '', lease_expires_at = '',
           next_attempt_at = '', last_error_code = '', last_http_status = 0,
           delivered_at = '', updated_at = ? WHERE id = ?`,
        new Date(NOW + 2_250).toISOString(),
        before.id
      ),
      /delivery transition is invalid/
    );

    const replayed = alerts.replayConnectorDelivery(before.id, {
      reasonCode: "operator_verified_retry",
      confirmation: RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION
    }, "request_connector_manual_replay_001", NOW + 2_300);
    assert.equal(replayed.id, before.id);
    assert.equal(replayed.deliveryState, "pending");
    assert.equal(replayed.attemptCount, 0);
    assert.equal(replayed.manualReplayCount, 1);
    assert.equal(replayed.replayEligible, false);
    const afterReplay = db.get<typeof before & { state: string; attemptCount: number }>(
      `SELECT id, payload_json AS payloadJson, payload_hash AS payloadHash,
              idempotency_key_hash AS idempotencyKeyHash,
              endpoint_reference AS endpointReference,
              endpoint_binding_fingerprint AS endpointBindingFingerprint,
              state, attempt_count AS attemptCount
       FROM operator_alert_connector_deliveries`
    );
    assert.equal(afterReplay?.id, before.id);
    assert.equal(afterReplay?.payloadJson, before.payloadJson);
    assert.equal(afterReplay?.payloadHash, before.payloadHash);
    assert.equal(afterReplay?.idempotencyKeyHash, before.idempotencyKeyHash);
    assert.equal(afterReplay?.endpointReference, before.endpointReference);
    assert.equal(afterReplay?.endpointBindingFingerprint, before.endpointBindingFingerprint);
    assert.equal(afterReplay?.state, "pending");
    assert.equal(afterReplay?.attemptCount, 0);

    const observedDeliveryIds: string[] = [];
    const accepted: OperatorAlertWebhookTransport = {
      async deliver(request) {
        observedDeliveryIds.push(request.deliveryId);
        return { disposition: "delivered", reasonCode: "webhook_accepted", httpStatus: 204 };
      }
    };
    await new OperatorAlertConnectorDispatchService(db, REGISTRY, accepted).execute(NOW + 2_400);
    assert.deepEqual(observedDeliveryIds, [before.id]);
    const delivered = (alerts.snapshot(NOW + 2_400) as {
      connectors: { health: Array<Record<string, unknown>>; deliveries: Array<Record<string, unknown>> };
    }).connectors;
    assert.equal(delivered.health[0]?.status, "degraded");
    assert.equal(delivered.health[0]?.deliverySuccessRatePercent, 50);
    assert.equal(delivered.deliveries[0]?.deliveryState, "delivered");
    assert.equal(delivered.deliveries[0]?.manualReplayCount, 1);
    assert.deepEqual(
      db.all<{ eventType: string; reasonCode: string }>(
        "SELECT event_type AS eventType, reason_code AS reasonCode FROM operator_alert_connector_delivery_events ORDER BY sequence"
      ).map((row) => [row.eventType, row.reasonCode]),
      [
        ["queued", "alert_event_routed"],
        ["leased", "worker_lease"],
        ["dead_lettered", "webhook_rejected"],
        ["retry_scheduled", "operator_manual_replay"],
        ["leased", "worker_lease"],
        ["delivered", "webhook_accepted"]
      ]
    );
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'operator_alert_connector_delivery_replayed'"
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("an expired twelfth-attempt lease becomes a replayable dead letter instead of stranded work", async () => {
  const db = new YoinkDatabase();
  try {
    const alerts = new OperatorAlertRepository(db, REGISTRY.bindings);
    saveConnector(alerts);
    seedFailure(db, "B0GYQGQHZL");
    alerts.reconcileAdapterRepairs(
      new AdapterDiagnosticRepository(db).listRepairQueue(50, NOW + 2_100),
      "request_connector_exhausted_open_001",
      NOW + 2_100
    );
    const repository = new OperatorAlertConnectorRepository(db, REGISTRY.bindings);
    let claimAt = NOW + 2_200;
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const lease = repository.leaseNext(REGISTRY.bindings, 15, claimAt);
      assert.equal(lease?.attempt, attempt);
      assert.equal(repository.fail(
        lease?.id ?? "",
        lease?.capabilityToken ?? "",
        "webhook_retryable_status",
        503,
        1,
        false,
        claimAt + 1
      ), "retry");
      claimAt += 2_000;
    }
    const abandoned = repository.leaseNext(REGISTRY.bindings, 15, claimAt);
    assert.equal(abandoned?.attempt, 12);
    let transportCalls = 0;
    const result = await new OperatorAlertConnectorDispatchService(db, REGISTRY, {
      async deliver() {
        transportCalls += 1;
        return { disposition: "delivered", reasonCode: "webhook_accepted", httpStatus: 204 };
      }
    }).execute(claimAt + 16_000);
    assert.equal(result.connectorDeliveriesDeadLettered, 1);
    assert.equal(result.connectorDeliveriesAttempted, 0);
    assert.equal(transportCalls, 0);
    const receipt = repository.receipts(1)[0];
    assert.equal(receipt?.deliveryState, "dead_letter");
    assert.equal(receipt?.attemptCount, 12);
    assert.equal(receipt?.lastErrorCode, "lease_attempts_exhausted");
    assert.equal(receipt?.replayEligible, true);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operator_alert_connector_delivery_events WHERE reason_code = 'lease_attempts_exhausted'"
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("manual connector replay fails closed on drift, invalid input, and the three-cycle bound", async () => {
  const db = new YoinkDatabase();
  try {
    const alerts = new OperatorAlertRepository(db, REGISTRY.bindings);
    saveConnector(alerts);
    seedFailure(db, "B015TKSSB8");
    alerts.reconcileAdapterRepairs(
      new AdapterDiagnosticRepository(db).listRepairQueue(50, NOW + 2_100),
      "request_connector_replay_bound_001",
      NOW + 2_100
    );
    const rejected: OperatorAlertWebhookTransport = {
      async deliver() {
        return { disposition: "dead_letter", reasonCode: "webhook_rejected", httpStatus: 422 };
      }
    };
    await new OperatorAlertConnectorDispatchService(db, REGISTRY, rejected).execute(NOW + 2_200);
    const deliveryId = db.get<{ id: string }>("SELECT id FROM operator_alert_connector_deliveries")?.id ?? "";
    assert.throws(() => alerts.replayConnectorDelivery(deliveryId, {
      reasonCode: "operator_verified_retry",
      confirmation: "" as typeof RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION
    }, "request_connector_replay_invalid_001", NOW + 2_300), /confirmation/);
    assert.throws(() => new OperatorAlertConnectorRepository(db, { ops_primary: "c".repeat(64) }).replayDeadLetter(
      deliveryId,
      {
        reasonCode: "operator_verified_retry",
        confirmation: RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION
      },
      "request_connector_replay_drift_001",
      NOW + 2_300
    ), /not currently eligible/);

    for (let replay = 1; replay <= 3; replay += 1) {
      alerts.replayConnectorDelivery(deliveryId, {
        reasonCode: replay === 1 ? "receiver_recovered" : replay === 2 ? "rate_limit_cleared" : "operator_verified_retry",
        confirmation: RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION
      }, `request_connector_replay_cycle_00${replay}`, NOW + 2_300 + replay * 200);
      await new OperatorAlertConnectorDispatchService(db, REGISTRY, rejected).execute(NOW + 2_400 + replay * 200);
    }
    const receipt = new OperatorAlertConnectorRepository(db, REGISTRY.bindings).receipts(1)[0];
    assert.equal(receipt?.manualReplayCount, 3);
    assert.equal(receipt?.replayEligible, false);
    assert.equal(receipt?.replayIneligibilityReason, "manual_replay_limit_reached");
    assert.throws(() => alerts.replayConnectorDelivery(deliveryId, {
      reasonCode: "operator_verified_retry",
      confirmation: RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION
    }, "request_connector_replay_cycle_004", NOW + 4_000), /not currently eligible/);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operator_alert_connector_delivery_events WHERE reason_code = 'operator_manual_replay'"
    )?.count, 3);
  } finally {
    db.close();
  }
});
