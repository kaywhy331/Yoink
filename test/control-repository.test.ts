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
