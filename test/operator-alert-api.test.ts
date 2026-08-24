import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION,
  AMAZON_OBSERVER_VERSION,
  RESOLVE_OPERATOR_ALERT_CONFIRMATION,
  SAVE_OPERATOR_ALERT_RULE_CONFIRMATION,
  type RetailerAdapterDiagnosticInput
} from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

function diagnostic(): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date().toISOString(),
    retailerId: "amazon",
    retailerSku: "B0FB21526X",
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

test("device diagnostics immediately feed permission-gated operator alert APIs", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "alert-api-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"e".repeat(32)}`;
  try {
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
    const diagnosticResponse = await fetch(`${baseUrl}/api/v1/devices/self/adapter-diagnostics/amazon`, {
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
    };
    assert.equal(alerts.canManage, true);
    assert.equal(alerts.mutationAuthority, false);
    assert.equal(alerts.counts.openOperatorAlerts, 1);
    assert.equal(alerts.incidents[0]?.privacyClassification, "operational_aggregate");
    assert.equal(alerts.deliveries.length, 2);
    assert.equal(JSON.stringify(alerts).includes("B0FB21526X"), false);
    assert.equal(JSON.stringify(alerts).includes("DO_NOT_STORE"), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM operator_alert_incidents")).includes("B0FB21526X"), false);

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
    assert.equal(snapshot.capabilities.operatorAlertMutationAuthority, false);
    assert.ok(snapshot.operatorAlerts);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
