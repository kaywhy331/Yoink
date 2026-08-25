import assert from "node:assert/strict";
import test from "node:test";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("missions edit the complete exact retailer target set atomically", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const first = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "mission-product",
      sourceListingId: "mission-target-1",
      title: "Editable Mission Fixture",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4499
    });
    const second = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "mission-product",
      sourceListingId: "mission-target-2",
      title: "Editable Mission Fixture",
      retailerId: "amazon",
      retailerSku: "B0MISSION01",
      canonicalUrl: "https://www.amazon.com/dp/B0MISSION01",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 4499
    });
    const control = new ControlRepository(db);
    const ensured = control.ensureMission(first.listing.variantId, first.listing.id, "test");
    const detail = control.missionDetail(ensured.mission.id) as { targets: Array<Record<string, unknown>> };
    assert.equal(detail.targets.length, 2);
    const target = detail.targets.find((item) => item.listingId === first.listing.id);
    const amazon = detail.targets.find((item) => item.listingId === second.listing.id);
    assert.ok(target?.id);
    assert.ok(amazon?.id);

    const updated = control.updateMission(ensured.mission.id, {
      status: "active",
      targetQuantity: 3,
      targets: [
        {
          id: String(target?.id),
          enabled: true,
          maxUnitPriceCents: 4200,
          sellerPolicy: "first_party_only",
          fulfillment: "shipping"
        },
        {
          id: String(amazon?.id),
          enabled: false,
          maxUnitPriceCents: null,
          sellerPolicy: "allow_third_party",
          fulfillment: "inherit"
        }
      ]
    }) as { targetQuantity: number; targets: Array<Record<string, unknown>> };
    assert.equal(updated.targetQuantity, 3);
    assert.equal(updated.targets.find((item) => item.id === target?.id)?.maxUnitPriceCents, 4200);
    assert.equal(updated.targets.find((item) => item.id === amazon?.id)?.enabled, false);
    assert.throws(() => control.updateMission(ensured.mission.id, {
      status: "paused",
      targetQuantity: 4,
      targets: [{
        id: String(target?.id), enabled: true, maxUnitPriceCents: null,
        sellerPolicy: "inherit", fulfillment: "inherit"
      }]
    }), /complete exact target set/);
    assert.equal((control.missionDetail(ensured.mission.id) as { targetQuantity: number }).targetQuantity, 3);
  } finally {
    db.close();
  }
});

test("guided purchase setup creates one reviewed revision with only the chosen exact store enabled", () => {
  const db = new YoinkDatabase();
  const now = new Date("2026-08-24T20:00:00.000Z").getTime();
  try {
    const catalog = new CatalogRepository(db);
    const selected = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "guided-product",
      sourceListingId: "guided-target",
      title: "Guided Exact Fixture",
      retailerId: "target",
      retailerSku: "95280895",
      canonicalUrl: "https://www.target.com/p/-/A-95280895",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4500
    }, now);
    const sibling = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "guided-product",
      sourceListingId: "guided-amazon",
      title: "Guided Exact Fixture",
      retailerId: "amazon",
      retailerSku: "B0GUIDED001",
      canonicalUrl: "https://www.amazon.com/dp/B0GUIDED001",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4600
    }, now);
    const control = new ControlRepository(db);
    const created = control.createConfiguredMission({
      contractVersion: 1,
      listingId: selected.listing.id,
      targetQuantity: 2,
      maxUnitPriceCents: 5000,
      maxAllInCents: 15_000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      expiresAt: new Date(now + 86_400_000).toISOString(),
      cooldownSeconds: 900,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now);
    assert.equal(created.created, true);
    const detail = control.missionDetail(created.mission.id) as {
      targetQuantity: number;
      intentPolicy: Record<string, unknown>;
      targets: Array<Record<string, unknown>>;
    };
    assert.equal(detail.targetQuantity, 2);
    assert.equal(detail.intentPolicy.revision, 1);
    assert.equal(detail.intentPolicy.actionCeiling, "add_to_cart");
    assert.equal(detail.intentPolicy.maxAllInCents, 15_000);
    assert.equal(detail.intentPolicy.cooldownSeconds, 900);
    const selectedTarget = detail.targets.find((target) => target.listingId === selected.listing.id);
    const siblingTarget = detail.targets.find((target) => target.listingId === sibling.listing.id);
    assert.deepEqual({
      enabled: selectedTarget?.enabled,
      maxUnitPriceCents: selectedTarget?.maxUnitPriceCents,
      sellerPolicy: selectedTarget?.sellerPolicy,
      fulfillment: selectedTarget?.fulfillment
    }, {
      enabled: true,
      maxUnitPriceCents: 5000,
      sellerPolicy: "first_party_only",
      fulfillment: "shipping"
    });
    assert.equal(siblingTarget?.enabled, false);
    assert.equal(siblingTarget?.maxUnitPriceCents, null);
    assert.throws(() => control.createConfiguredMission({
      contractVersion: 1,
      listingId: selected.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5000,
      maxAllInCents: 5000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now + 1), /already exists/);
    const discoveredLater = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "guided-product",
      sourceListingId: "guided-later-target",
      title: "Guided Exact Fixture",
      retailerId: "target",
      retailerSku: "95280898",
      canonicalUrl: "https://www.target.com/p/-/A-95280898",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4700
    }, now + 2);
    const expanded = control.missionDetail(created.mission.id) as {
      intentPolicy: { revision: number; targets: Array<Record<string, unknown>> };
      targets: Array<Record<string, unknown>>;
    };
    assert.equal(expanded.targets.find((target) => target.listingId === discoveredLater.listing.id)?.enabled, false);
    assert.equal(expanded.intentPolicy.revision, 1);
    assert.equal(expanded.intentPolicy.targets.length, 2);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM mission_intent_revisions WHERE mission_id = ?",
      created.mission.id
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("failed guided setup rolls back every mission, target, and policy write", () => {
  const db = new YoinkDatabase();
  const now = new Date("2026-08-24T20:00:00.000Z").getTime();
  try {
    const created = new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "guided-rollback-product",
      sourceListingId: "guided-rollback-listing",
      title: "Guided Rollback Fixture",
      retailerId: "target",
      retailerSku: "95280896",
      canonicalUrl: "https://www.target.com/p/-/A-95280896",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4500
    }, now);
    const control = new ControlRepository(db);
    assert.throws(() => control.createConfiguredMission({
      contractVersion: 1,
      listingId: created.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5000,
      maxAllInCents: 5000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now), /tax and store-fee safety reserve/);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.throws(() => control.createConfiguredMission({
      contractVersion: 1,
      listingId: created.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5000,
      maxAllInCents: 5000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      expiresAt: new Date(now - 1).toISOString(),
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now), /future timestamp/);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM mission_targets")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM mission_intent_revisions")?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type IN ('mission_created', 'purchase_intent_policy_revised')"
    )?.count, 0);
  } finally {
    db.close();
  }
});

test("legacy user plan creation is notification-only until limits are explicitly reviewed", () => {
  const db = new YoinkDatabase();
  try {
    const created = new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "safe-user-draft",
      sourceListingId: "safe-user-draft-listing",
      title: "Safe User Draft Fixture",
      retailerId: "target",
      retailerSku: "95280897",
      canonicalUrl: "https://www.target.com/p/-/A-95280897",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4500
    });
    const control = new ControlRepository(db);
    const mission = control.ensureUserMission(created.listing.variantId, created.listing.id);
    const detail = control.missionDetail(mission.mission.id) as {
      intentPolicy: Record<string, unknown>;
      targets: Array<Record<string, unknown>>;
    };
    assert.equal(detail.intentPolicy.revision, 1);
    assert.equal(detail.intentPolicy.actionCeiling, "notify");
    assert.equal(detail.targets[0]?.enabled, true);
    assert.equal(detail.targets[0]?.maxUnitPriceCents, null);
    assert.equal(detail.targets[0]?.sellerPolicy, "first_party_only");
  } finally {
    db.close();
  }
});

test("control-plane guardrail settings validate and round-trip", () => {
  const db = new YoinkDatabase();
  try {
    const control = new ControlRepository(db);
    const settings = control.updateSettings({
      dedupeWindowSeconds: 180,
      affiliateMode: "disabled",
      taxBps: 825,
      storeAllowancesCents: { target: 500, walmart: 600, amazon: 700, bestbuy: 800 }
    });
    assert.equal(settings.dedupeWindowSeconds, 180);
    assert.equal(settings.affiliateMode, "disabled");
    assert.equal(settings.taxBps, 825);
    assert.deepEqual(settings.storeAllowancesCents, { target: 500, walmart: 600, amazon: 700, bestbuy: 800 });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'guardrail_settings_updated'")?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM outbox_events WHERE event_type = 'guardrail_settings_updated'")?.count, 1);
    assert.throws(() => control.updateSettings({
      dedupeWindowSeconds: 1,
      affiliateMode: "prefer_fallback",
      taxBps: 0,
      storeAllowancesCents: {}
    }), /dedupe window/);
  } finally {
    db.close();
  }
});

test("source cards expose bounded reliability projections without counting test signals", () => {
  const db = new YoinkDatabase();
  try {
    const source = new ControlRepository(db).listSources().find((item) => item.id === "source_trackalacker_local");
    assert.ok(source);
    assert.equal(source.signalCount, 0);
    assert.equal(source.matchedSignalCount, 0);
    assert.equal(source.unresolvedSignalCount, 0);
    assert.equal(source.ambiguousSignalCount, 0);
    assert.equal(source.qualifiedSignalCount, 0);
    assert.equal(source.corroboratedSignalCount, 0);
    assert.equal(source.matchRatePercent, null);
  } finally {
    db.close();
  }
});
