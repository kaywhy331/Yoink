import assert from "node:assert/strict";
import test from "node:test";
import { presentShopperPurchaseIntent } from "../apps/api/src/purchase-intent-presentation.js";

test("shopper plan presentation maps legacy Manual fulfillment to Shipping with evidence", () => {
  const legacyTarget = { id: "target_legacy", fulfillment: "manual" };
  const plan = {
    id: "plan_legacy",
    primaryFulfillment: "manual",
    targets: [legacyTarget, { id: "target_pickup", fulfillment: "pickup" }]
  };

  const presented = presentShopperPurchaseIntent(plan) as {
    primaryFulfillment: string;
    legacyFulfillmentMapped: boolean;
    targets: Array<{ fulfillment: string; legacyFulfillmentMapped?: boolean }>;
  };
  assert.equal(presented.primaryFulfillment, "shipping");
  assert.equal(presented.legacyFulfillmentMapped, true);
  assert.deepEqual(presented.targets.map((target) => target.fulfillment), ["shipping", "pickup"]);
  assert.equal(presented.targets[0]?.legacyFulfillmentMapped, true);
  assert.equal(legacyTarget.fulfillment, "manual", "presentation never mutates stored evidence");
});

test("shopper plan presentation defaults non-pickup legacy values to Shipping without a false migration note", () => {
  const presented = presentShopperPurchaseIntent({
    id: "plan_inherit",
    primaryFulfillment: "inherit",
    targets: [{ id: "target_inherit", fulfillment: "inherit" }]
  }) as {
    primaryFulfillment: string;
    legacyFulfillmentMapped?: boolean;
    targets: Array<{ fulfillment: string; legacyFulfillmentMapped?: boolean }>;
  };
  assert.equal(presented.primaryFulfillment, "shipping");
  assert.equal(presented.targets[0]?.fulfillment, "shipping");
  assert.equal(presented.legacyFulfillmentMapped, undefined);
  assert.equal(presented.targets[0]?.legacyFulfillmentMapped, undefined);
});
