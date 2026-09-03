import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION,
  RESOLVE_OPERATOR_ALERT_CONFIRMATION,
  RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION,
  SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION,
  SAVE_OPERATOR_ALERT_RULE_CONFIRMATION,
  TARGET_OBSERVER_VERSION,
  type RetailerAdapterDiagnosticInput
} from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { OperatorAlertConnectorDispatchService } from "../packages/engine/src/operator-alert-connector-dispatch.js";
import type { OperatorAlertWebhookTransport } from "../packages/engine/src/operator-alert-webhook.js";

function diagnostic(): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date().toISOString(),
    retailerId: "target",
    retailerSku: "1010423703",
    adapterVersion: TARGET_OBSERVER_VERSION,
    operation: "observe",
    outcome: "failed",
    failureStage: "price_binding",
    reasonCode: "price_binding_missing",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "other",
      sellerShape: "legacy",
      fulfillmentShape: "shipping",
      addControlCount: 1,
      genericAddIntentCount: 1,
      scopedControlCount: 1,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      variationSkuCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      priceCandidateCount: 0,
      quantityControlCount: 0,
      securityChallenge: false,
      interactiveBlock: ""
    }
  };
}

test("device diagnostics immediately feed permission-gated operator alert APIs", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "alert-api-test",
    operatorAlertConnectorBindings: { ops_primary: "a".repeat(64) }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"e".repeat(32)}`;
  try {
    const createdConnector = await fetch(`${baseUrl}/api/v1/admin/alerts/connectors`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        name: "Primary operations webhook",
        enabled: true,
        kind: "webhook",
        endpointReference: "ops_primary",
        minimumSeverity: "warning",
        confirmation: SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION
      })
    });
    assert.equal(createdConnector.status, 201);
    const createdConnectorBody = await createdConnector.json() as { connector: Record<string, unknown> };
    assert.equal(createdConnectorBody.connector.runtimeBound, true);
    assert.equal(JSON.stringify(createdConnectorBody).includes("https://"), false);

    const pairing = await fetch(`${baseUrl}/api/v1/user/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    }).then((response) => response.json()) as { pairing: { code: string } };
    const paired = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ pairingCode: pairing.pairing.code })
    }).then((response) => response.json()) as { device: { token: string } };
    const diagnosticResponse = await fetch(`${baseUrl}/api/v1/devices/self/adapter-diagnostics/target`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.device.token}`,
        "X-Request-ID": "request_alert_device_001"
      },
      body: JSON.stringify({
        ...diagnostic(),
        rawDom: "DO_NOT_STORE",
        cookie: "DO_NOT_STORE",
        offerListingID: "DO_NOT_STORE"
      })
    });
    assert.equal(diagnosticResponse.status, 201);
    const accepted = await diagnosticResponse.json() as {
      diagnostic: { id: string };
      alertReconciliation: { opened: number; routed: number };
    };
    assert.ok(accepted.diagnostic.id);
    assert.deepEqual(accepted.alertReconciliation, { opened: 1, updated: 0, resolved: 0, escalated: 0, routed: 2 });

    let alerts = await fetch(`${baseUrl}/api/v1/admin/alerts`).then((response) => response.json()) as {
      canManage: boolean;
      mutationAuthority: boolean;
      counts: Record<string, number>;
      rules: Array<Record<string, unknown>>;
      incidents: Array<Record<string, unknown>>;
      deliveries: Array<Record<string, unknown>>;
      connectors: {
        connectors: Array<Record<string, unknown>>;
        health: Array<Record<string, unknown>>;
        deliveries: Array<Record<string, unknown>>;
      };
    };
    assert.equal(alerts.canManage, true);
    assert.equal(alerts.mutationAuthority, false);
    assert.equal(alerts.counts.openOperatorAlerts, 1);
    assert.equal(alerts.incidents[0]?.retailerId, "target");
    assert.equal(alerts.incidents[0]?.privacyClassification, "operational_aggregate");
    assert.equal(alerts.deliveries.length, 2);
    assert.equal(alerts.connectors.connectors.length, 1);
    assert.equal(alerts.connectors.deliveries.length, 1);
    assert.equal(alerts.connectors.deliveries[0]?.deliveryState, "pending");
    assert.equal(JSON.stringify(alerts).includes("1010423703"), false);
    assert.equal(JSON.stringify(alerts).includes("DO_NOT_STORE"), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM operator_alert_incidents")).includes("1010423703"), false);

    const rejectedTransport: OperatorAlertWebhookTransport = {
      async deliver() {
        return { disposition: "dead_letter", reasonCode: "webhook_rejected", httpStatus: 400 };
      }
    };
    await new OperatorAlertConnectorDispatchService(db, {
      definitions: [{
        reference: "ops_primary",
        endpoint: "https://alerts.example.com/v1/yoink",
        signingSecretEnvironment: "YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY",
        bindingFingerprint: "a".repeat(64)
      }],
      bindings: { ops_primary: "a".repeat(64) },
      fingerprint: "b".repeat(64)
    }, rejectedTransport).execute(Date.now());
    alerts = await fetch(`${baseUrl}/api/v1/admin/alerts`).then((response) => response.json()) as typeof alerts;
    assert.equal(alerts.connectors.health[0]?.status, "critical");
    assert.equal(alerts.connectors.deliveries[0]?.replayEligible, true);
    const connectorDeliveryId = String(alerts.connectors.deliveries[0]?.id);
    const replayed = await fetch(
      `${baseUrl}/api/v1/admin/alerts/connector-deliveries/${encodeURIComponent(connectorDeliveryId)}/retry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl, "X-Request-ID": "request_alert_replay_001" },
        body: JSON.stringify({
          reasonCode: "operator_verified_retry",
          confirmation: RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION
        })
      }
    );
    assert.equal(replayed.status, 202);
    const replayedBody = await replayed.json() as { delivery: Record<string, unknown> };
    assert.equal(replayedBody.delivery.id, connectorDeliveryId);
    assert.equal(replayedBody.delivery.deliveryState, "pending");
    assert.equal(replayedBody.delivery.manualReplayCount, 1);
    assert.equal(JSON.stringify(replayedBody).includes("https://"), false);
    const duplicateReplay = await fetch(
      `${baseUrl}/api/v1/admin/alerts/connector-deliveries/${encodeURIComponent(connectorDeliveryId)}/retry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl },
        body: JSON.stringify({
          reasonCode: "operator_verified_retry",
          confirmation: RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION
        })
      }
    );
    assert.equal(duplicateReplay.status, 409);

    const rule = alerts.rules[0] as Record<string, unknown>;
    const updatedRule = await fetch(`${baseUrl}/api/v1/admin/alerts/rules/${encodeURIComponent(String(rule.id))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        eventFamily: rule.eventFamily,
        name: "Adapter repair control-plane alerts",
        enabled: true,
        severity: "error",
        minimumOccurrences: 1,
        dedupeWindowSeconds: 600,
        escalationAfterSeconds: 1800,
        retailerScope: "*",
        operationScope: "*",
        routes: ["dashboard", "audit_outbox"],
        confirmation: SAVE_OPERATOR_ALERT_RULE_CONFIRMATION
      })
    });
    assert.equal(updatedRule.status, 200);

    const incidentId = String(alerts.incidents[0]?.id);
    const acknowledged = await fetch(`${baseUrl}/api/v1/admin/alerts/incidents/${encodeURIComponent(incidentId)}/acknowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        reasonCode: "operator_investigating",
        note: "Reviewing the aggregate repair evidence.",
        confirmation: ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION
      })
    });
    assert.equal(acknowledged.status, 200);
    const resolved = await fetch(`${baseUrl}/api/v1/admin/alerts/incidents/${encodeURIComponent(incidentId)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        reasonCode: "maintainer_triaged",
        note: "Transferred to the packaged observer repair workflow.",
        confirmation: RESOLVE_OPERATOR_ALERT_CONFIRMATION
      })
    });
    assert.equal(resolved.status, 200);
    alerts = await fetch(`${baseUrl}/api/v1/admin/alerts`).then((response) => response.json()) as typeof alerts;
    assert.equal(alerts.counts.openOperatorAlerts, 0);
    assert.equal(alerts.counts.resolvedOperatorAlerts, 1);

    const snapshot = await fetch(`${baseUrl}/api/v1/admin/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      capabilities: Record<string, boolean>;
      operatorAlerts: Record<string, unknown>;
    };
    assert.equal(snapshot.counts.resolvedOperatorAlerts, 1);
    assert.equal(snapshot.capabilities.privacyClassifiedOperatorAlerts, true);
    assert.equal(snapshot.capabilities.governedOperatorAlertConnectorReplay, true);
    assert.equal(snapshot.capabilities.operatorAlertConnectorHealthProjection, true);
    assert.equal(snapshot.capabilities.operatorAlertMutationAuthority, false);
    assert.ok(snapshot.operatorAlerts);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
