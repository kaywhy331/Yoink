import assert from "node:assert/strict";
import test from "node:test";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("purchase profiles save, update, and delete with explicit validation", () => {
  const db = new YoinkDatabase();
  try {
    const control = new ControlRepository(db);
    assert.deepEqual(control.listPurchaseProfiles(), []);

    const saved = control.savePurchaseProfile({
      name: "Two under MSRP",
      targetQuantity: 2,
      actionCeiling: "notify",
      priceMode: "fixed_cap",
      maxUnitPriceCents: 2500,
      cooldownSeconds: 900
    });
    assert.equal(saved.length, 1);
    const profile = saved[0];
    assert.ok(profile);
    assert.equal(profile.name, "Two under MSRP");
    assert.equal(profile.targetQuantity, 2);
    assert.equal(profile.priceMode, "fixed_cap");
    assert.equal(profile.maxUnitPriceCents, 2500);
    assert.equal(control.listPurchaseProfiles().length, 1);

    const updated = control.savePurchaseProfile({
      id: profile.id,
      name: "Two under MSRP",
      targetQuantity: 3,
      actionCeiling: "add_to_cart",
      priceMode: "store_price",
      cooldownSeconds: 0
    });
    assert.equal(updated.length, 1);
    assert.equal(updated[0]?.id, profile.id);
    assert.equal(updated[0]?.targetQuantity, 3);
    assert.equal(updated[0]?.actionCeiling, "add_to_cart");
    assert.equal(updated[0]?.maxUnitPriceCents, null, "a store-price profile carries no fixed cap");

    const remaining = control.deletePurchaseProfile(profile.id);
    assert.deepEqual(remaining, []);
    assert.deepEqual(control.listPurchaseProfiles(), []);
  } finally {
    db.close();
  }
});

test("purchase profiles refuse reserved names, duplicates, and incomplete fixed caps", () => {
  const db = new YoinkDatabase();
  try {
    const control = new ControlRepository(db);
    assert.throws(() => control.savePurchaseProfile({
      name: "Default",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "store_price"
    }), /reserved/i);
    assert.throws(() => control.savePurchaseProfile({
      name: "Fixed without price",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "fixed_cap"
    }), /maximum item price/i);
    assert.throws(() => control.savePurchaseProfile({
      name: "Zero quantity",
      targetQuantity: 0,
      actionCeiling: "notify",
      priceMode: "store_price"
    }), /1 through 99/);
    control.savePurchaseProfile({
      name: "Original",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "store_price"
    });
    assert.throws(() => control.savePurchaseProfile({
      name: "original",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "store_price"
    }), /already uses that name/i);
    assert.throws(() => control.deletePurchaseProfile("purchase_profile_missing"), /no longer exists/i);
  } finally {
    db.close();
  }
});
