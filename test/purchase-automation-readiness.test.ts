import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION
} from "../packages/contracts/src/index.js";
import {
  buildPurchaseAutomationReadiness,
  type PurchaseAutomationPlanInput,
  type PurchaseAutomationReadinessContext
} from "../packages/domain/src/purchase-automation-readiness.js";

const NOW = new Date("2026-08-25T18:00:00.000Z").getTime();

const TARGET = {
  targetId: "mission_target_target",
  listingId: "listing_target",
  retailerId: "target",
  retailerName: "Target",
  retailerSku: "123456789",
  enabled: true,
  executionSupported: true,
  maxUnitPriceCents: 5000,
  sellerPolicy: "first_party_only",
  fulfillment: "shipping"
};

const AMAZON = {
  ...TARGET,
  targetId: "mission_target_amazon",
  listingId: "listing_amazon",
  retailerId: "amazon",
  retailerName: "Amazon",
  retailerSku: "B0READY0001"
};

function plan(overrides: Partial<PurchaseAutomationPlanInput> = {}): PurchaseAutomationPlanInput {
  return {
    id: "mission_readiness",
    status: "active",
    title: "Exact readiness fixture",
    targetQuantity: 2,
    actionCeiling: "add_to_cart",
    decisionMode: "purchase_intent",
    expiresAt: "",
    targets: [TARGET],
    ...overrides
  };
}

function context(overrides: Partial<PurchaseAutomationReadinessContext> = {}): PurchaseAutomationReadinessContext {
  return {
    version: "0.45.0",
    executionMode: "live",
    actionsPaused: false,
    sources: [{ source: "trackalacker", status: "connected" }],
    devices: [{
      status: "active",
      extensionVersion: "0.45.0",
      online: true,
      capabilities: {
        notifications: true,
        jobReconciliation: true,
        targetAddOnly: true,
        targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION,
        amazonAddOnly: true,
        amazonAddAdapterVersion: AMAZON_ADD_ADAPTER_VERSION
      }
    }],
    qualifications: { target: true, walmart: false, amazon: false, bestbuy: false },
    now: NOW,
    ...overrides
  };
}

test("an exact direct plan is armed only for a qualified lane and a capable online companion", () => {
  const readiness = buildPurchaseAutomationReadiness(plan(), context());
  assert.equal(readiness.contractVersion, 1);
  assert.equal(readiness.state, "guarded_add_armed");
  assert.equal(readiness.level, "ready");
  assert.equal(readiness.readyForMonitoring, true);
  assert.equal(readiness.readyForGuardedAdd, true);
  assert.equal(readiness.effectiveAutomation, "guarded_add");
  assert.equal(readiness.guardedAddAttemptQuantity, 1);
  assert.equal(readiness.targets[0]?.reasonCode, "armed_for_fresh_offer");
  assert.equal(readiness.targets[0]?.readyForGuardedAdd, true);
  assert.equal(readiness.checks.at(-1)?.state, "runtime");
  assert.match(readiness.summary, /exactly one item/);
});

test("a packaged Amazon mapping is reported as closed until its separate lane is qualified", () => {
  const readiness = buildPurchaseAutomationReadiness(
    plan({ targets: [AMAZON] }),
    context()
  );
  assert.equal(readiness.state, "guarded_add_lane_closed");
  assert.equal(readiness.readyForMonitoring, true);
  assert.equal(readiness.readyForGuardedAdd, false);
  assert.equal(readiness.effectiveAutomation, "none");
  assert.equal(readiness.targets[0]?.packagedMapping, true);
  assert.equal(readiness.targets[0]?.laneQualified, false);
  assert.equal(readiness.targets[0]?.reasonCode, "lane_not_qualified");
  assert.match(readiness.headline, /Amazon/);
});

test("mixed-store plans arm only the exact target whose lane and runner are both ready", () => {
  const readiness = buildPurchaseAutomationReadiness(plan({ targets: [TARGET, AMAZON] }), context());
  assert.equal(readiness.state, "guarded_add_armed");
  assert.equal(readiness.targets.length, 2);
  assert.equal(readiness.targets.find((target) => target.retailerId === "target")?.readyForGuardedAdd, true);
  assert.equal(readiness.targets.find((target) => target.retailerId === "amazon")?.readyForGuardedAdd, false);
  assert.match(readiness.summary, /Target/);
});

test("notification plans remain mapping-independent and explain an offline companion", () => {
  const notificationPlan = plan({
    actionCeiling: "notify",
    targets: [{ ...AMAZON, executionSupported: false }]
  });
  const offline = buildPurchaseAutomationReadiness(notificationPlan, context({
    devices: context().devices.map((device) => ({ ...device, online: false }))
  }));
  assert.equal(offline.state, "companion_offline");
  assert.equal(offline.readyForMonitoring, true);
  assert.equal(offline.readyForGuardedAdd, false);
  assert.equal(offline.effectiveAutomation, "notification");

  const online = buildPurchaseAutomationReadiness(notificationPlan, context());
  assert.equal(online.state, "notification_ready");
  assert.equal(online.effectiveAutomation, "notification");
});

test("readiness distinguishes unsafe policy, missing runner, test mode, pause, expiry, and legacy decisions", () => {
  assert.equal(buildPurchaseAutomationReadiness(
    plan({ targets: [{ ...TARGET, fulfillment: "pickup" }] }), context()
  ).state, "guarded_add_armed");
  assert.equal(buildPurchaseAutomationReadiness(
    plan({ targets: [{ ...TARGET, fulfillment: "either" }] }), context()
  ).state, "guarded_add_policy_incomplete");

  assert.equal(buildPurchaseAutomationReadiness(plan(), context({
    devices: context().devices.map((device) => ({
      ...device,
      capabilities: { notifications: true, jobReconciliation: true }
    }))
  })).state, "guarded_add_device_incapable");

  assert.equal(buildPurchaseAutomationReadiness(plan(), context({ executionMode: "shadow" })).state, "guarded_add_shadow");
  assert.equal(buildPurchaseAutomationReadiness(plan(), context({ actionsPaused: true })).state, "guarded_add_paused");
  assert.equal(buildPurchaseAutomationReadiness(plan({ expiresAt: new Date(NOW - 1).toISOString() }), context()).state, "expired");
  assert.equal(buildPurchaseAutomationReadiness(plan({ decisionMode: "strategy" }), context()).state, "advanced_strategy");
});
