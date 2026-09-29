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
    maxAllInCents: 10_000,
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
      id: "device_current",
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
    spend: {
      policy: { perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null },
      availableTodayCents: null,
      availableThisMonthCents: null
    },
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

test("a cart plan is not ready when its reviewed maximum exceeds current spending headroom", () => {
  const readiness = buildPurchaseAutomationReadiness(
    plan({ maxAllInCents: 10_000 }),
    context({
      spend: {
        policy: { perOrderCapCents: 9_000, dailyCapCents: 20_000, monthlyCapCents: 100_000 },
        availableTodayCents: 20_000,
        availableThisMonthCents: 100_000
      }
    })
  );
  assert.equal(readiness.state, "spend_limit_exceeded");
  assert.equal(readiness.readyForGuardedAdd, false);
  assert.equal(readiness.effectiveAutomation, "none");
  assert.equal(readiness.checks.find((item) => item.id === "spend")?.state, "attention");
  assert.match(readiness.summary, /\$90\.00.*per-order spending limit/);
});

test("a packaged Amazon mapping is reported as closed until its separate lane is qualified", () => {
  const readiness = buildPurchaseAutomationReadiness(
    plan({ targets: [AMAZON] }),
    context()
  );
  assert.equal(readiness.state, "guarded_add_lane_closed");
  assert.equal(readiness.nextAction, "store_setup");
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
  assert.match(readiness.headline, /Target/);
});

test("fresh exact-device store blockers are truthful without becoming global or permanent", () => {
  const blocker = {
    deviceId: "device_current",
    retailerId: "target" as const,
    signedInState: "challenged" as const
  };
  const blocked = buildPurchaseAutomationReadiness(plan(), context({ sessionBlockers: [blocker] }));
  assert.equal(blocked.state, "guarded_add_session_blocked");
  assert.equal(blocked.readyForGuardedAdd, false);
  assert.equal(blocked.effectiveAutomation, "notification");
  assert.equal(blocked.nextAction, "open_chrome");
  assert.equal(blocked.targets[0]?.sessionBlocked, true);
  assert.equal(blocked.targets[0]?.reasonCode, "retailer_session_blocked");
  assert.equal(blocked.checks.find((check) => check.id === "session")?.state, "waiting");

  const paused = buildPurchaseAutomationReadiness(plan(), context({
    actionsPaused: true,
    sessionBlockers: [blocker]
  }));
  assert.equal(paused.state, "guarded_add_paused");

  const anotherDeviceReady = buildPurchaseAutomationReadiness(plan(), context({
    sessionBlockers: [blocker],
    devices: [
      ...(context().devices),
      { ...context().devices[0], id: "device_second" }
    ]
  }));
  assert.equal(anotherDeviceReady.state, "guarded_add_armed");
  assert.equal(anotherDeviceReady.targets[0]?.sessionBlocked, false);
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

test("all shopper-visible readiness copy stays actionable and free of internal execution terms", () => {
  const notificationPlan = plan({ actionCeiling: "notify" });
  const variants = [
    buildPurchaseAutomationReadiness(plan({ status: "paused" }), context()),
    buildPurchaseAutomationReadiness(plan({ expiresAt: new Date(NOW - 1).toISOString() }), context()),
    buildPurchaseAutomationReadiness(plan({ decisionMode: "strategy" }), context()),
    buildPurchaseAutomationReadiness(plan({ targets: [] }), context()),
    buildPurchaseAutomationReadiness(notificationPlan, context({ sources: [] })),
    buildPurchaseAutomationReadiness(notificationPlan, context({ devices: [] })),
    buildPurchaseAutomationReadiness(notificationPlan, context({
      devices: context().devices.map((device) => ({ ...device, online: false }))
    })),
    buildPurchaseAutomationReadiness(notificationPlan, context()),
    buildPurchaseAutomationReadiness(plan({ targets: [{ ...TARGET, fulfillment: "either" }] }), context()),
    buildPurchaseAutomationReadiness(plan({ targets: [{ ...TARGET, executionSupported: false }] }), context()),
    buildPurchaseAutomationReadiness(plan(), context({
      qualifications: { target: false, walmart: false, amazon: false, bestbuy: false }
    })),
    buildPurchaseAutomationReadiness(plan(), context({
      devices: context().devices.map((device) => ({
        ...device,
        capabilities: { notifications: true, jobReconciliation: true }
      }))
    })),
    buildPurchaseAutomationReadiness(plan(), context({
      sessionBlockers: [{
        deviceId: "device_current",
        retailerId: "target",
        signedInState: "signed_out"
      }]
    })),
    buildPurchaseAutomationReadiness(plan(), context({ executionMode: "shadow" })),
    buildPurchaseAutomationReadiness(plan(), context({ actionsPaused: true })),
    buildPurchaseAutomationReadiness(plan(), context())
  ];
  const states = [...new Set(variants.map((readiness) => readiness.state))].sort();
  assert.deepEqual(states, [
    "advanced_strategy",
    "companion_offline",
    "expired",
    "guarded_add_armed",
    "guarded_add_device_incapable",
    "guarded_add_lane_closed",
    "guarded_add_paused",
    "guarded_add_policy_incomplete",
    "guarded_add_session_blocked",
    "guarded_add_shadow",
    "inactive",
    "needs_current_companion",
    "needs_signal",
    "needs_target",
    "notification_ready"
  ]);
  for (const readiness of variants) {
    const visibleCopy = [
      readiness.headline,
      readiness.summary,
      readiness.nextActionLabel,
      ...readiness.checks.flatMap((item) => [item.label, item.detail]),
      ...readiness.targets.map((target) => target.summary)
    ].join(" ");
    assert.doesNotMatch(visibleCopy, /\b(?:runner|lane|qualification)\b/i, readiness.state);
    assert.match(readiness.technicalReason, /^readiness:[a-z_]+/);
  }
});

test("a quiet tracking feed is not a connected call source, and its words carry no age (E-03)", () => {
  const quietSources = [{ source: "trackalacker", status: "stale" }, { source: "browser", status: "connected" }];
  for (const readiness of [
    buildPurchaseAutomationReadiness(plan({ actionCeiling: "notify" }), context({ sources: quietSources })),
    buildPurchaseAutomationReadiness(plan(), context({ sources: quietSources }))
  ]) {
    assert.equal(readiness.state, "needs_signal");
    assert.equal(readiness.readyForMonitoring, false);
    assert.equal(readiness.readyForGuardedAdd, false);
    assert.equal(readiness.headline, "Reconnect your product tracking");
    assert.equal(readiness.nextActionLabel, "Reconnect source");
    const signal = readiness.checks.find((item) => item.id === "signal");
    assert.equal(signal?.state, "waiting");
    assert.match(signal?.detail ?? "", /needs reconnecting/);
    // The preflight fingerprint binds this readiness: no minute-by-minute ages.
    assert.doesNotMatch(JSON.stringify(readiness), /\b\d+ (?:min|h|d) ago\b/);
  }
  const failed = buildPurchaseAutomationReadiness(plan({ actionCeiling: "notify" }),
    context({ sources: [{ source: "trackalacker", status: "error" }] }));
  assert.equal(failed.headline, "Reconnect your product tracking");
  // Another connected feed keeps the plan monitored; an unregistered feed still reads as "connect".
  assert.equal(buildPurchaseAutomationReadiness(plan({ actionCeiling: "notify" }), context({
    sources: [{ source: "trackalacker", status: "stale" }, { source: "discord", status: "connected" }]
  })).state, "notification_ready");
  assert.equal(buildPurchaseAutomationReadiness(plan({ actionCeiling: "notify" }), context({
    sources: [{ source: "trackalacker", status: "disconnected" }]
  })).headline, "Connect a call source");
});
