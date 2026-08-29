import assert from "node:assert/strict";
import test from "node:test";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
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
    assert.equal(saved.profiles.length, 1);
    assert.deepEqual(saved.propagation, { matchedMissionCount: 0, updatedMissionCount: 0, skipped: [] });
    const profile = saved.profiles[0];
    assert.ok(profile);
    assert.equal(profile.name, "Two under MSRP");
    assert.equal(profile.targetQuantity, 2);
    assert.equal(profile.priceMode, "fixed_cap");
    assert.equal(profile.maxUnitPriceCents, 2500);
    assert.equal(profile.msrpOffsetPercent, null);
    assert.equal(profile.isDefault, false);
    assert.equal(control.listPurchaseProfiles().length, 1);

    const updated = control.savePurchaseProfile({
      id: profile.id,
      name: "Two under MSRP",
      targetQuantity: 3,
      actionCeiling: "add_to_cart",
      priceMode: "store_price",
      cooldownSeconds: 0
    });
    assert.equal(updated.profiles.length, 1);
    assert.equal(updated.profiles[0]?.id, profile.id);
    assert.equal(updated.profiles[0]?.targetQuantity, 3);
    assert.equal(updated.profiles[0]?.actionCeiling, "add_to_cart");
    assert.equal(updated.profiles[0]?.maxUnitPriceCents, null, "a store-price profile carries no fixed cap");

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
    assert.throws(() => control.savePurchaseProfile({
      name: "No offset",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "msrp_offset_percent"
    }), /-90 through 90/);
    assert.throws(() => control.savePurchaseProfile({
      name: "Offset too high",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "msrp_offset_percent",
      msrpOffsetPercent: 91
    }), /-90 through 90/);
    assert.throws(() => control.savePurchaseProfile({
      name: "Offset too low",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "msrp_offset_percent",
      msrpOffsetPercent: -91
    }), /-90 through 90/);
    assert.throws(() => control.savePurchaseProfile({
      name: "Fractional offset",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "msrp_offset_percent",
      msrpOffsetPercent: 1.5
    }), /-90 through 90/);
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

test("purchase profiles support MSRP and MSRP-offset price modes", () => {
  const db = new YoinkDatabase();
  try {
    const control = new ControlRepository(db);
    const msrp = control.savePurchaseProfile({
      name: "At MSRP",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "msrp"
    }).profiles[0];
    assert.ok(msrp);
    assert.equal(msrp.priceMode, "msrp");
    assert.equal(msrp.maxUnitPriceCents, null);
    assert.equal(msrp.msrpOffsetPercent, null);

    const offset = control.savePurchaseProfile({
      name: "Below MSRP",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "msrp_offset_percent",
      msrpOffsetPercent: -15
    }).profiles.find((candidate) => candidate.name === "Below MSRP");
    assert.ok(offset);
    assert.equal(offset.priceMode, "msrp_offset_percent");
    assert.equal(offset.msrpOffsetPercent, -15);
    assert.equal(offset.maxUnitPriceCents, null);
  } finally {
    db.close();
  }
});

test("only one purchase profile can be the default; setting a new one clears the previous", () => {
  const db = new YoinkDatabase();
  try {
    const control = new ControlRepository(db);
    const first = control.savePurchaseProfile({
      name: "First",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "store_price",
      isDefault: true
    }).profiles.find((candidate) => candidate.name === "First");
    assert.equal(first?.isDefault, true);

    const afterSecond = control.savePurchaseProfile({
      name: "Second",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "store_price",
      isDefault: true
    }).profiles;
    assert.equal(afterSecond.find((candidate) => candidate.name === "First")?.isDefault, false);
    assert.equal(afterSecond.find((candidate) => candidate.name === "Second")?.isDefault, true);

    const firstId = afterSecond.find((candidate) => candidate.name === "First")?.id;
    assert.ok(firstId);
    const afterEditWithoutDefault = control.savePurchaseProfile({
      id: firstId,
      name: "First",
      targetQuantity: 2,
      actionCeiling: "notify",
      priceMode: "store_price",
      isDefault: false
    }).profiles;
    assert.equal(afterEditWithoutDefault.find((candidate) => candidate.name === "Second")?.isDefault, true,
      "editing a non-default profile does not disturb the existing default");
  } finally {
    db.close();
  }
});

test("saving a linked purchase profile propagates re-derived caps to its missions, skipping listings that lack MSRP", () => {
  const db = new YoinkDatabase();
  const now = new Date("2026-08-26T12:00:00.000Z").getTime();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const withMsrp = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "profile-propagation-product",
      sourceListingId: "profile-propagation-target",
      title: "Propagation Fixture With MSRP",
      retailerId: "target",
      retailerSku: "95280910",
      canonicalUrl: "https://www.target.com/p/-/A-95280910",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 5000
    }, now);
    const withoutMsrp = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "profile-propagation-product-2",
      sourceListingId: "profile-propagation-target-2",
      title: "Propagation Fixture Without MSRP",
      retailerId: "target",
      retailerSku: "95280911",
      canonicalUrl: "https://www.target.com/p/-/A-95280911",
      listingStatus: "in_stock",
      executionSupported: true
    }, now);

    const profile = control.savePurchaseProfile({
      name: "MSRP quick add",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "msrp",
      cooldownSeconds: 0
    }, now).profiles[0];
    assert.ok(profile);

    const linkedMission = control.createConfiguredMission({
      contractVersion: 1,
      listingId: withMsrp.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 4_000,
      maxAllInCents: 4_000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN",
      quickAddProfileId: profile.id
    }, now);
    const skippedMission = control.createConfiguredMission({
      contractVersion: 1,
      listingId: withoutMsrp.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 3_000,
      maxAllInCents: 3_000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN",
      quickAddProfileId: profile.id
    }, now);
    assert.equal(
      db.get<{ profileId: string }>(
        "SELECT quick_add_profile_id AS profileId FROM missions WHERE id = ?",
        linkedMission.mission.id
      )?.profileId,
      profile.id
    );

    const resaved = control.savePurchaseProfile({
      id: profile.id,
      name: "MSRP quick add",
      targetQuantity: 1,
      actionCeiling: "notify",
      priceMode: "msrp_offset_percent",
      msrpOffsetPercent: -10,
      cooldownSeconds: 0
    }, now + 1_000);
    assert.equal(resaved.propagation.matchedMissionCount, 2);
    assert.equal(resaved.propagation.updatedMissionCount, 1);
    assert.equal(resaved.propagation.skipped.length, 1);
    assert.equal(resaved.propagation.skipped[0]?.missionId, skippedMission.mission.id);
    assert.equal(resaved.propagation.skipped[0]?.reasonCode, "msrp_unavailable");

    const linkedDetail = control.missionDetail(linkedMission.mission.id) as {
      intentPolicy: Record<string, unknown>;
      targets: Array<Record<string, unknown>>;
    };
    const linkedTarget = linkedDetail.targets.find((target) => target.listingId === withMsrp.listing.id);
    assert.equal(linkedTarget?.maxUnitPriceCents, 4_500, "5000 MSRP cents at a -10% offset");
    assert.equal(linkedDetail.intentPolicy.maxAllInCents, 4_500, "notify-only plans reserve no tax or store fee");
    assert.equal(linkedDetail.intentPolicy.revision, 2, "propagation recorded a new audited policy revision");

    const skippedDetail = control.missionDetail(skippedMission.mission.id) as {
      targets: Array<Record<string, unknown>>;
    };
    const skippedTarget = skippedDetail.targets.find((target) => target.listingId === withoutMsrp.listing.id);
    assert.equal(skippedTarget?.maxUnitPriceCents, 3_000, "a mission whose listing lacks MSRP keeps its prior caps");

    control.deletePurchaseProfile(profile.id, now + 2_000);
    assert.equal(
      db.get<{ profileId: string }>(
        "SELECT quick_add_profile_id AS profileId FROM missions WHERE id = ?",
        linkedMission.mission.id
      )?.profileId,
      "",
      "deleting the profile clears the linkage on referencing missions"
    );
    const afterDelete = control.missionDetail(linkedMission.mission.id) as { targets: Array<Record<string, unknown>> };
    assert.equal(
      afterDelete.targets.find((target) => target.listingId === withMsrp.listing.id)?.maxUnitPriceCents,
      4_500,
      "deleting the profile keeps the mission's last caps"
    );
  } finally {
    db.close();
  }
});
