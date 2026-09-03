import assert from "node:assert/strict";
import test from "node:test";
import {
  ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION,
  AMAZON_OBSERVER_VERSION,
  RESOLVE_OPERATOR_ALERT_CONFIRMATION,
  SAVE_OPERATOR_ALERT_RULE_CONFIRMATION,
  type RetailerAdapterDiagnosticInput,
  type RetailerAdapterLayoutEvidence
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { OperatorAlertRepository } from "../packages/database/src/operator-alert-repository.js";
import { HOSTED_PRINCIPAL_CONFIRMATION, PrincipalRepository } from "../packages/database/src/principal-repository.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-24T18:00:00.000Z").getTime();

function pairedDevice(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(NOW);
  return devices.pair({ pairingCode: pairing.code }, NOW + 500);
}

function layout(scopedControlCount = 0): RetailerAdapterLayoutEvidence {
  return {
    schemaVersion: 1,
    pageKind: "product",
    scopeKind: "accordion",
    sellerShape: "legacy",
    fulfillmentShape: "shipping",
    addControlCount: 1,
    genericAddIntentCount: 1,
    scopedControlCount,
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
  };
}

function failedDiagnostic(retailerSku: string, observedAt: number): RetailerAdapterDiagnosticInput {
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
    layout: layout()
  };
}

test("sanitized adapter repair groups open, dedupe, acknowledge, and auto-resolve operator alerts", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const diagnostics = new AdapterDiagnosticRepository(db);
    const alerts = new OperatorAlertRepository(db);
    diagnostics.record(device.id, failedDiagnostic("B0FB21526X", NOW + 1_000), NOW + 2_000);

    const opened = alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_alert_open_001", NOW + 2_100);
    assert.deepEqual(opened, { opened: 1, updated: 0, resolved: 0, escalated: 0, routed: 2 });
    assert.deepEqual(
      alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_alert_retry_001", NOW + 2_200),
      { opened: 0, updated: 0, resolved: 0, escalated: 0, routed: 0 }
    );

    let snapshot = alerts.snapshot(NOW + 2_200) as {
      rawBrowsingDataStored: boolean;
      mutationAuthority: boolean;
      counts: Record<string, number>;
      incidents: Array<Record<string, unknown>>;
      events: Array<Record<string, unknown>>;
      deliveries: Array<Record<string, unknown>>;
    };
    assert.equal(snapshot.rawBrowsingDataStored, false);
    assert.equal(snapshot.mutationAuthority, false);
    assert.equal(snapshot.counts.openOperatorAlerts, 1);
    assert.equal(snapshot.incidents[0]?.privacyClassification, "operational_aggregate");
    assert.equal(snapshot.incidents[0]?.occurrenceCount, 1);
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.deliveries.length, 2);
    assert.deepEqual(new Set(snapshot.deliveries.map((item) => item.deliveryState)), new Set(["delivered", "pending"]));
    const durable = JSON.stringify({
      incidents: db.all("SELECT * FROM operator_alert_incidents"),
      events: db.all("SELECT * FROM operator_alert_events"),
      deliveries: db.all("SELECT * FROM operator_alert_deliveries")
    });
    assert.equal(durable.includes("B0FB21526X"), false);
    assert.equal(durable.includes(device.token), false);

    const incidentId = String(snapshot.incidents[0]?.id);
    assert.throws(() => alerts.acknowledge(incidentId, {
      reasonCode: "b0fb21526x" as "operator_investigating",
      confirmation: ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION
    }, "request_alert_bad_ack_001", NOW + 2_900), /allowlisted/);
    const acknowledged = alerts.acknowledge(incidentId, {
      reasonCode: "operator_investigating",
      note: "Reviewing the sanitized layout group.",
      confirmation: ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION
    }, "request_alert_ack_001", NOW + 3_000);
    assert.equal(acknowledged.status, "acknowledged");

    diagnostics.record(device.id, {
      ...failedDiagnostic("B0FB21526X", NOW + 4_000),
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified",
      layout: layout(1)
    }, NOW + 5_000);
    const recovered = alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_alert_recovered_001", NOW + 5_100);
    assert.equal(recovered.resolved, 1);
    snapshot = alerts.snapshot(NOW + 5_100) as typeof snapshot;
    assert.equal(snapshot.counts.openOperatorAlerts, 0);
    assert.equal(snapshot.counts.resolvedOperatorAlerts, 1);
    assert.equal(snapshot.incidents[0]?.status, "resolved");
    assert.equal(snapshot.incidents[0]?.resolutionCode, "adapter_recovered");
    assert.deepEqual(snapshot.events.map((item) => item.eventType), ["auto_resolved", "acknowledged", "opened"]);
    assert.throws(
      () => db.run("UPDATE operator_alert_events SET reason_code = 'tampered'"),
      /append-only/
    );
  } finally {
    db.close();
  }
});

test("active operator incidents prioritize the newest failure over older severity", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const diagnostics = new AdapterDiagnosticRepository(db);
    const alerts = new OperatorAlertRepository(db);
    diagnostics.record(device.id, failedDiagnostic("B0OLDLAY01", NOW + 1_000), NOW + 2_000);
    alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_alert_old_001", NOW + 2_100);
    const olderIncident = alerts.incidents("open", 10, NOW + 2_100)[0];
    assert.ok(olderIncident);
    db.run(
      "UPDATE operator_alert_incidents SET severity = 'critical' WHERE id = ?",
      olderIncident.id
    );

    diagnostics.record(device.id, {
      ...failedDiagnostic("B0NEWLAY02", NOW + 3_000),
      layout: {
        ...layout(),
        scopeKind: "buybox",
        sellerShape: "offer_display_combined"
      }
    }, NOW + 4_000);
    alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_alert_new_001", NOW + 4_100);

    const active = alerts.incidents("open", 10, NOW + 4_100);
    assert.equal(active.length, 2);
    assert.equal(active[0]?.severity, "warning");
    assert.equal(active[0]?.lastSeenAt, new Date(NOW + 4_000).toISOString());
    assert.equal(active[1]?.severity, "critical");
  } finally {
    db.close();
  }
});

test("rule thresholds, escalation, manual resolution, and historical suppression are deterministic", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const diagnostics = new AdapterDiagnosticRepository(db);
    const alerts = new OperatorAlertRepository(db);
    const defaultRule = alerts.rules()[0];
    assert.ok(defaultRule);
    alerts.saveRule({
      ...defaultRule,
      enabled: false,
      confirmation: SAVE_OPERATOR_ALERT_RULE_CONFIRMATION
    }, defaultRule.id, NOW + 1_000);
    const rule = alerts.saveRule({
      eventFamily: "adapter_repair",
      name: "Repeated Amazon observer failures",
      enabled: true,
      severity: "error",
      minimumOccurrences: 2,
      dedupeWindowSeconds: 60,
      escalationAfterSeconds: 300,
      retailerScope: "amazon",
      operationScope: "observe",
      routes: ["dashboard"],
      confirmation: SAVE_OPERATOR_ALERT_RULE_CONFIRMATION
    }, "", NOW + 1_100);

    diagnostics.record(device.id, failedDiagnostic("B0FB21526X", NOW + 2_000), NOW + 3_000);
    assert.equal(alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_threshold_001", NOW + 3_100).opened, 0);
    diagnostics.record(device.id, failedDiagnostic("B0GYTRYV7P", NOW + 4_000), NOW + 5_000);
    assert.equal(alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_threshold_002", NOW + 5_100).opened, 1);
    let incident = alerts.incidents("open", 10, NOW + 5_100)[0];
    assert.equal(incident?.ruleId, rule.id);
    assert.equal(incident?.severity, "error");
    assert.equal(incident?.occurrenceCount, 2);

    const escalation = alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_escalation_001", NOW + 305_000);
    assert.equal(escalation.escalated, 1);
    incident = alerts.incidents("open", 10, NOW + 305_000)[0];
    assert.equal(incident?.severity, "critical");
    assert.ok(incident?.escalatedAt);

    const resolved = alerts.resolve(incident?.id ?? "", {
      reasonCode: "maintainer_triaged",
      note: "The bounded repair group was transferred to a packaged adapter fix.",
      confirmation: RESOLVE_OPERATOR_ALERT_CONFIRMATION
    }, "request_manual_resolve_001", NOW + 306_000);
    assert.equal(resolved.status, "resolved");
    assert.equal(alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_historical_replay_001", NOW + 307_000).opened, 0);

    diagnostics.record(device.id, failedDiagnostic("B0FPPWKMGK", NOW + 308_000), NOW + 309_000);
    assert.equal(alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_new_failure_001", NOW + 309_100).opened, 1);
    assert.equal(alerts.incidents("all", 10, NOW + 309_100).filter((item) => item.ruleId === rule.id).length, 2);
    assert.throws(() => alerts.saveRule({
      ...rule,
      routes: [],
      confirmation: SAVE_OPERATOR_ALERT_RULE_CONFIRMATION
    }, rule.id), /route/);
  } finally {
    db.close();
  }
});

test("operator alert rules and redacted incidents remain tenant isolated", () => {
  const db = new YoinkDatabase();
  const serviceScope: RequestScope = {
    tenantId: "tenant_local",
    userId: "user_local",
    actorKind: "service",
    actorId: "principal_service",
    internalServiceCapability: "internal.principal"
  };
  const secondScope: RequestScope = {
    tenantId: "tenant_alert_second",
    userId: "user_alert_second",
    actorKind: "user",
    actorId: "user_alert_second"
  };
  try {
    runWithRequestScope(serviceScope, () => new PrincipalRepository(db).provision({
      tenantId: secondScope.tenantId,
      userId: secondScope.userId,
      tenantName: "Second alert tenant",
      displayName: "Second alert user",
      confirmation: HOSTED_PRINCIPAL_CONFIRMATION
    }, NOW));
    db.run(
      `INSERT INTO authorization_memberships(
         tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
       ) VALUES (?, ?, 'security_admin', 'active', 'test_fixture', ?, ?)`,
      secondScope.tenantId,
      secondScope.userId,
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString()
    );
    let secondIncidentId = "";
    runWithRequestScope(secondScope, () => {
      const device = pairedDevice(db);
      const diagnostics = new AdapterDiagnosticRepository(db);
      const alerts = new OperatorAlertRepository(db);
      diagnostics.record(device.id, failedDiagnostic("B0FB21526X", NOW + 1_000), NOW + 2_000);
      alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "request_second_tenant_001", NOW + 2_100);
      const snapshot = alerts.snapshot(NOW + 2_100) as { counts: Record<string, number>; incidents: Array<{ id: string }> };
      assert.equal(snapshot.counts.openOperatorAlerts, 1);
      secondIncidentId = snapshot.incidents[0]?.id ?? "";
    });
    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => {
      const alerts = new OperatorAlertRepository(db);
      const snapshot = alerts.snapshot(NOW + 2_100) as { counts: Record<string, number>; incidents: unknown[] };
      assert.equal(snapshot.counts.openOperatorAlerts, 0);
      assert.deepEqual(snapshot.incidents, []);
      assert.throws(
        () => alerts.acknowledge(secondIncidentId, {
          reasonCode: "operator_investigating",
          confirmation: ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION
        }, "request_cross_tenant_001"),
        /does not exist in this tenant/
      );
    });
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operator_alert_incidents WHERE tenant_id = ?",
      secondScope.tenantId
    )?.count, 1);
  } finally {
    db.close();
  }
});
