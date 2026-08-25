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
  assert.equal(setup.level, "needs_companion");
  assert.equal(setup.completedSteps, 0);
  assert.equal(setup.readyForMonitoring, false);
  assert.equal(setup.readyForGuardedAdds, false);
  assert.deepEqual(setup.steps[0]?.primaryAction, "download_companion");
  assert.deepEqual(setup.steps[0]?.secondaryAction, "pair_companion");
  assert.match(setup.steps[4]?.summary ?? "", /Checkout, payment, raffle entry, and order submission always remain manual/);

  const pending = buildUserSetupReadiness({
    ...BASE,
    devices: [{ status: "active", extensionVersion: "0.32.0", online: true }],
    sources: [{ source: "trackalacker", status: "connected" }],
    pendingProductProposals: 1
  });
  assert.equal(pending.level, "product_in_review");
  assert.equal(pending.steps[2]?.state, "waiting");
  assert.match(pending.steps[2]?.summary ?? "", /No stock claim or purchase plan was created/);
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
  assert.equal(offline.steps[0]?.state, "attention");
  assert.equal(offline.steps[4]?.state, "attention");
});
