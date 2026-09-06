import assert from "node:assert/strict";
import test from "node:test";
import { buildUserSetupReadiness } from "../packages/domain/src/user-setup.js";

const BASE = {
  version: "0.32.0",
  devices: [],
  sources: [],
  products: 0,
  pendingProductProposals: 0,
  plans: [],
  actionsPaused: true,
  executionMode: "shadow"
};

test("setup readiness guides a new user without implying purchase authority", () => {
  const setup = buildUserSetupReadiness(BASE);
  assert.equal(setup.level, "needs_product");
  assert.equal(setup.completedSteps, 0);
  assert.equal(setup.readyForMonitoring, false);
  assert.equal(setup.readyForGuardedAdds, false);
  assert.deepEqual(setup.steps[0]?.primaryAction, "add_product");
  assert.deepEqual(setup.steps[2]?.secondaryAction, "pair_companion");
  assert.equal(setup.companion.downloadUrl, "/api/v1/extension/release/download");
  assert.equal(buildUserSetupReadiness({ ...BASE, companionDownloadUrl: "" }).companion.downloadUrl, "");
  assert.match(setup.steps[4]?.summary ?? "", /Checkout, payment, raffle entry, and order submission always remain manual/);

  const pending = buildUserSetupReadiness({
    ...BASE,
    devices: [{ status: "active", extensionVersion: "0.32.0", online: true }],
    sources: [{ source: "trackalacker", status: "connected" }],
    pendingProductProposals: 1
  });
  assert.equal(pending.level, "product_in_review");
  assert.equal(pending.steps[0]?.state, "waiting");
  assert.match(pending.steps[0]?.summary ?? "", /No stock claim or purchase plan was created/);
});

test("setup readiness distinguishes configured monitoring, guarded actions, and offline Chrome", () => {
  const configured = {
    ...BASE,
    devices: [{ status: "active", extensionVersion: "0.32.0", online: true }],
    sources: [
      { source: "user_link", status: "manual" },
      { source: "browser", status: "connected" }
    ],
    products: 2,
    plans: [{ status: "active", actionCeiling: "add_to_cart" }],
    actionsPaused: false,
    executionMode: "live"
  };
  const ready = buildUserSetupReadiness(configured);
  assert.equal(ready.level, "guarded_cart_ready");
  assert.equal(ready.readyForMonitoring, true);
  assert.equal(ready.readyForGuardedAdds, true);
  assert.equal(ready.connectedSignalCount, 1);
  assert.equal(ready.completedSteps, 5);

  const offline = buildUserSetupReadiness({
    ...configured,
    devices: [{ status: "active", extensionVersion: "0.32.0", online: false }]
  });
  assert.equal(offline.level, "temporarily_offline");
  assert.equal(offline.readyForMonitoring, true);
  assert.equal(offline.readyForGuardedAdds, false);
  assert.equal(offline.steps[2]?.state, "attention");
  assert.equal(offline.steps[4]?.state, "attention");
});

test("setup readiness uses authoritative plan readiness instead of treating every add mapping as armed", () => {
  const configured = {
    ...BASE,
    devices: [{ status: "active", extensionVersion: "0.32.0", online: true }],
    sources: [{ source: "browser", status: "connected" }],
    products: 1,
    actionsPaused: false,
    executionMode: "live",
    plans: [{
      status: "active",
      actionCeiling: "add_to_cart",
      automationReadiness: {
        state: "guarded_add_lane_closed",
        level: "attention",
        headline: "Amazon guarded add is not qualified yet",
        summary: "Monitoring remains available while retailer clicks stay closed.",
        readyForMonitoring: true,
        readyForGuardedAdd: false,
        nextAction: "review_plan"
      }
    }]
  };
  const closed = buildUserSetupReadiness(configured);
  assert.equal(closed.level, "needs_action_enablement");
  assert.equal(closed.readyForMonitoring, true);
  assert.equal(closed.readyForGuardedAdds, false);
  assert.match(closed.headline, /Amazon guarded add/);
  assert.match(closed.steps[4]?.summary ?? "", /retailer clicks stay closed/);

  const armed = buildUserSetupReadiness({
    ...configured,
    plans: [{
      ...configured.plans[0],
      automationReadiness: {
        state: "guarded_add_armed",
        level: "ready",
        headline: "Guarded add is armed",
        summary: "Fresh runtime proof is still required.",
        readyForMonitoring: true,
        readyForGuardedAdd: true,
        nextAction: "wait_for_offer"
      }
    }]
  });
  assert.equal(armed.level, "guarded_cart_ready");
  assert.equal(armed.readyForGuardedAdds, true);
});


test("a plan can be saved before Chrome and full saved counts retain inactive plans", () => {
  const first = buildUserSetupReadiness({ ...BASE, products: 1 });
  assert.equal(first.level, "needs_plan");
  assert.equal(first.steps[1]?.state, "current");
  assert.equal(first.readyForMonitoring, false);
  for (const status of ["paused", "archived", "satisfied"]) {
    const saved = buildUserSetupReadiness({ ...BASE, products: 1, plans: [{ status }] });
    assert.equal(saved.level, "review_saved_plans");
    assert.equal(saved.savedPlanCount, 1);
    assert.equal(saved.readyForMonitoring, false);
    assert.equal(saved.steps[1]?.state, "complete");
    assert.equal(saved.steps[4]?.primaryAction, "view_plans");
  }
  const outsideSample = buildUserSetupReadiness({ ...BASE, savedPlanCount: 21 });
  assert.equal(outsideSample.level, "review_saved_plans");
  assert.equal(outsideSample.savedPlanCount, 21);
  const notify = buildUserSetupReadiness({ ...BASE, products: 1, plans: [{ status: "active", actionCeiling: "notify" }] });
  assert.equal(notify.level, "needs_companion");
  assert.equal(notify.savedPlanCount, 1);
  assert.equal(notify.readyForMonitoring, false);
  assert.equal(notify.readyForGuardedAdds, false);
});
