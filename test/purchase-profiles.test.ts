import { officialMsrpFixture } from "./helpers/official-msrp.js";
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
    assert.equal(profile.fulfillment, "shipping", "legacy-compatible profile fulfillment defaults to Shipping");
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
      fulfillment: "pickup",
      priceMode: "store_price",
      cooldownSeconds: 0
    });
    assert.equal(updated.profiles.length, 1);
    assert.equal(updated.profiles[0]?.id, profile.id);
    assert.equal(updated.profiles[0]?.targetQuantity, 3);
    assert.equal(updated.profiles[0]?.actionCeiling, "add_to_cart");
    assert.equal(updated.profiles[0]?.fulfillment, "pickup");
    assert.equal(updated.profiles[0]?.maxUnitPriceCents, null, "a store-price profile carries no fixed cap");

    const legacyProfile = { ...updated.profiles[0] } as Record<string, unknown>;
    delete legacyProfile.fulfillment;
    db.run(
      "UPDATE app_settings SET purchase_profiles_json = ?",
      JSON.stringify([legacyProfile])
    );
    assert.equal(control.listPurchaseProfiles()[0]?.fulfillment, "shipping",
      "profiles stored before fulfillment existed retain the historical Shipping behavior");

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
    const shippingFallback = control.savePurchaseProfile({
      name: "Legacy shipping fallback",
      targetQuantity: 1,
      actionCeiling: "notify",
      fulfillment: "courier" as "shipping",
      priceMode: "store_price"
    }).profiles.find((profile) => profile.name === "Legacy shipping fallback");
    assert.equal(shippingFallback?.fulfillment, "shipping");
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

test("saved cart profiles require exact review even when catalog MSRP exists", () => {
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
      targetQuantity: 2,
      actionCeiling: "add_to_cart",
      fulfillment: "pickup",
      priceMode: "msrp_offset_percent",
      msrpOffsetPercent: -10,
      cooldownSeconds: 0
    }, now + 1_000);
    assert.equal(resaved.propagation.matchedMissionCount, 2);
    assert.equal(resaved.propagation.updatedMissionCount, 0);
    assert.equal(resaved.propagation.skipped.length, 2);
    assert.equal(resaved.propagation.skipped.find(x => x.missionId === skippedMission.mission.id)?.missionId, skippedMission.mission.id);
    assert.equal(resaved.propagation.skipped.find(x => x.missionId === skippedMission.mission.id)?.reasonCode, "msrp_unavailable");

    const linkedDetail = control.missionDetail(linkedMission.mission.id) as {
      targetQuantity: number;
      intentPolicy: Record<string, unknown>;
      targets: Array<Record<string, unknown>>;
    };
    const linkedTarget = linkedDetail.targets.find((target) => target.listingId === withMsrp.listing.id);
    assert.equal(resaved.propagation.skipped.find(x => x.missionId === linkedMission.mission.id)?.reasonCode, "official_msrp_plan_review_required");
    assert.equal(linkedTarget?.maxUnitPriceCents, 4_000);
    assert.equal(linkedTarget?.sellerPolicy, "first_party_only");
    assert.equal(linkedTarget?.fulfillment, "shipping");
    assert.equal(linkedDetail.targetQuantity, 1);
    assert.equal(linkedDetail.intentPolicy.maxAllInCents, 4_000);
    assert.equal(linkedDetail.intentPolicy.actionCeiling, "notify");
    assert.equal(linkedDetail.intentPolicy.revision, 1);

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
      4_000,
      "deleting the profile keeps the mission's last caps"
    );
  } finally {
    db.close();
  }
});

test("bulk cart setup preserves plans pending exact review and refuses unsupported targets", () => {
  const db = new YoinkDatabase();
  const now = new Date("2026-09-01T16:00:00.000Z").getTime();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const supported = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "bulk-profile-supported-product",
      sourceListingId: "bulk-profile-supported-listing",
      title: "Bulk Profile Supported Fixture",
      retailerId: "target",
      retailerSku: "95280913",
      canonicalUrl: "https://www.target.com/p/-/A-95280913",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 5_000
    }, now);
    const unsupported = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "bulk-profile-unsupported-product",
      sourceListingId: "bulk-profile-unsupported-listing",
      title: "Bulk Profile Unsupported Fixture",
      retailerId: "walmart",
      retailerSku: "19988614229",
      canonicalUrl: "https://www.walmart.com/ip/fixture/19988614229",
      listingStatus: "in_stock",
      executionSupported: false,
      msrpCents: 5_000
    }, now);
    const supportedMission = control.createConfiguredMission({
      contractVersion: 1,
      listingId: supported.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5_000,
      maxAllInCents: 5_000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now);
    const unsupportedMission = control.createConfiguredMission({
      contractVersion: 1,
      listingId: unsupported.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5_000,
      maxAllInCents: 5_000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now);
    const profile = control.savePurchaseProfile({
      name: "Guarded shipping",
      targetQuantity: 2,
      actionCeiling: "add_to_cart",
      fulfillment: "shipping",
      priceMode: "fixed_cap",
      maxUnitPriceCents: 4_500,
      cooldownSeconds: 60
    }, now).profiles[0];
    assert.ok(profile);

    assert.throws(() => control.applyPurchaseProfileToMissions({
      profileId: profile.id,
      missionIds: [supportedMission.mission.id],
      confirmation: "wrong" as "APPLY_PROFILE_TO_SELECTED_PURCHASE_PLANS"
    }, now + 1), /review and confirm/i);
    assert.equal(
      db.get<{ profileId: string }>("SELECT quick_add_profile_id AS profileId FROM missions WHERE id = ?", supportedMission.mission.id)?.profileId,
      "",
      "a missing confirmation leaves the plan unlinked"
    );

    const applied = control.applyPurchaseProfileToMissions({
      profileId: profile.id,
      missionIds: [supportedMission.mission.id, unsupportedMission.mission.id],
      confirmation: "APPLY_PROFILE_TO_SELECTED_PURCHASE_PLANS"
    }, now + 2);
    assert.equal(applied.selectedMissionCount, 2);
    assert.equal(applied.linkedMissionCount, 2);
    assert.equal(applied.propagation.matchedMissionCount, 2);
    assert.equal(applied.propagation.updatedMissionCount, 0);
    assert.equal(applied.propagation.skipped.length, 2);
    assert.equal(applied.propagation.skipped.find(x => x.missionId === unsupportedMission.mission.id)?.reasonCode, "unsupported_target");
    assert.equal(applied.propagation.skipped.find(x => x.missionId === supportedMission.mission.id)?.reasonCode, "official_msrp_plan_review_required");

    const updated = control.missionDetail(supportedMission.mission.id) as {
      targetQuantity: number;
      intentPolicy: { actionCeiling: string; cooldownSeconds: number };
      targets: Array<{ maxUnitPriceCents: number; sellerPolicy: string; fulfillment: string }>;
    };
    assert.equal(updated.targetQuantity, 1);
    assert.equal(updated.intentPolicy.actionCeiling, "notify");
    assert.equal(updated.intentPolicy.cooldownSeconds, 0);
    assert.equal(updated.targets[0]?.maxUnitPriceCents, 5_000);
    assert.equal(updated.targets[0]?.sellerPolicy, "first_party_only");
    assert.equal(updated.targets[0]?.fulfillment, "shipping");

    const retained = control.missionDetail(unsupportedMission.mission.id) as {
      targetQuantity: number;
      intentPolicy: { actionCeiling: string; revision: number };
    };
    assert.equal(retained.targetQuantity, 1);
    assert.equal(retained.intentPolicy.actionCeiling, "notify");
    assert.equal(retained.intentPolicy.revision, 1, "a skipped plan keeps its prior authorization revision");
    assert.equal(
      db.get<{ profileId: string }>("SELECT quick_add_profile_id AS profileId FROM missions WHERE id = ?", unsupportedMission.mission.id)?.profileId,
      profile.id,
      "a skipped plan remains linked so a later profile save can retry after the store becomes supported"
    );

    db.run("UPDATE retailers SET execution_supported = 1 WHERE id = 'walmart'");
    db.run("UPDATE listings SET execution_supported = 1 WHERE retailer_id = 'walmart'");
    const reconciled = control.reconcilePurchaseProfilesForRetailer("walmart", now + 3);
    assert.equal(reconciled.retailerId, "walmart");
    assert.equal(reconciled.matchedProfileCount, 1);
    assert.equal(reconciled.matchedMissionCount, 1);
    assert.equal(reconciled.updatedMissionCount, 0);
    assert.equal(reconciled.skipped[0]?.reasonCode, "official_msrp_plan_review_required");
    const afterLaneActivation = control.missionDetail(unsupportedMission.mission.id) as {
      targetQuantity: number;
      intentPolicy: { actionCeiling: string; revision: number };
      targets: Array<{ fulfillment: string; sellerPolicy: string }>;
    };
    assert.equal(afterLaneActivation.targetQuantity, 1);
    assert.equal(afterLaneActivation.intentPolicy.actionCeiling, "notify");
    assert.equal(afterLaneActivation.intentPolicy.revision, 1);
    assert.equal(afterLaneActivation.targets[0]?.fulfillment, "shipping");
    assert.equal(afterLaneActivation.targets[0]?.sellerPolicy, "first_party_only");
    assert.throws(() => control.reconcilePurchaseProfilesForRetailer("gamestop", now + 4), /guarded retailer/i);
  } finally {
    db.close();
  }
});

test("changing a linked cart profile to notify-only never waits for missing price evidence", () => {
  const db = new YoinkDatabase();
  const now = new Date("2026-09-01T17:00:00.000Z").getTime();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const listing = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "profile-downgrade-product",
      sourceListingId: "profile-downgrade-listing",
      title: "Profile Downgrade Fixture",
      retailerId: "target",
      retailerSku: "95280914",
      canonicalUrl: "https://www.target.com/p/-/A-95280914",
      listingStatus: "unknown",
      executionSupported: true
    }, now);
    const profile = control.savePurchaseProfile({
      name: "Initially cart",
      targetQuantity: 1,
      actionCeiling: "add_to_cart",
      fulfillment: "shipping",
      priceMode: "fixed_cap",
      maxUnitPriceCents: 5_000
    }, now).profiles[0];
    assert.ok(profile);
    const review = officialMsrpFixture(db, listing.listing.id, now, 5000);
    const mission = control.createConfiguredMission({
      contractVersion: 1,
      listingId: listing.listing.id,
      officialMsrpEvidenceId: review.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5_000,
      maxAllInCents: 8_960,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN",
      quickAddProfileId: profile.id
    }, now);

    const downgraded = control.savePurchaseProfile({
      id: profile.id,
      name: "Initially cart",
      targetQuantity: 1,
      actionCeiling: "notify",
      fulfillment: "shipping",
      priceMode: "store_price"
    }, now + 1_000);
    assert.equal(downgraded.propagation.updatedMissionCount, 1);
    assert.deepEqual(downgraded.propagation.skipped, []);
    const detail = control.missionDetail(mission.mission.id) as {
      intentPolicy: { actionCeiling: string; revision: number };
      targets: Array<{ maxUnitPriceCents: number | null }>;
    };
    assert.equal(detail.intentPolicy.actionCeiling, "notify");
    assert.equal(detail.intentPolicy.revision, 2);
    assert.equal(detail.targets[0]?.maxUnitPriceCents, 5_000, "the prior cap remains until fresh price evidence exists");
  } finally {
    db.close();
  }
});
