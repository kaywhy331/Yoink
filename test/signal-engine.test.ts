import assert from "node:assert/strict";
import test from "node:test";
import type { SignalEventInput, StrategyDefinition } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

const NOW = new Date("2026-08-22T19:00:00.000Z").getTime();

function purchaseStrategies(): StrategyDefinition[] {
  return [
    {
      id: "strategy_target_msrp",
      name: "Target at MSRP",
      enabled: true,
      position: 1,
      revision: 1,
      sources: ["trackalacker"],
      retailers: ["target"],
      pricePolicy: { kind: "at_or_below_msrp" },
      sellerPolicy: "first_party_only",
      allowedSellers: [],
      includeKeywords: "pokemon + \"elite trainer box\"",
      excludeKeywords: "used | refurbished",
      action: "add_to_cart",
      quantity: 2,
      fulfillment: "shipping",
      maxSignalAgeSeconds: 120
    },
    {
      id: "strategy_catchall_notify",
      name: "Catchall notify",
      enabled: true,
      position: 1_000,
      revision: 1,
      sources: [],
      retailers: [],
      pricePolicy: { kind: "any" },
      sellerPolicy: "first_party_only",
      allowedSellers: [],
      includeKeywords: "",
      excludeKeywords: "",
      action: "notify",
      quantity: 1,
      fulfillment: "shipping",
      maxSignalAgeSeconds: 120
    }
  ];
}

function trackalackerSignal(overrides: Partial<SignalEventInput> = {}): SignalEventInput {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: "track-event-1",
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: "5000",
      sourceListingId: "50001",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      title: "Pokemon Midnight Elite Trainer Box"
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 6500,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      orderLimit: 3,
      fulfillment: "shipping",
      offerId: "```ephemeral-offer-secret```"
    },
    evidence: {
      headline: "Pokemon Midnight Elite Trainer Box is in stock at Target",
      body: "In stock for $65.00"
    },
    parserVersion: "test-v1",
    ...overrides
  };
}

function seededEngine(): { db: YoinkDatabase; engine: SignalEngine } {
  const db = new YoinkDatabase();
  const catalog = new CatalogRepository(db);
  catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "5000",
    sourceListingId: "50001",
    title: "Pokemon Midnight Elite Trainer Box",
    retailerId: "target",
    retailerSku: "95280894",
    canonicalUrl: "https://www.target.com/p/-/A-95280894",
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 6999,
    currency: "USD",
    observedAt: new Date(NOW - 60_000).toISOString()
  }, NOW);
  const control = new ControlRepository(db);
  control.replaceStrategies(purchaseStrategies());
  control.setActionsPaused(false, "Test enabled actions");
  return { db, engine: new SignalEngine(db) };
}

test("an exact under-MSRP signal creates one mission and a bounded shadow action job", () => {
  const { db, engine } = seededEngine();
  try {
    const result = engine.process(trackalackerSignal(), NOW);
    assert.equal(result.resolution, "matched");
    assert.equal(result.missionCreated, true);
    assert.equal(result.decision, "qualified");
    assert.equal(result.actionJobState, "shadow_ready");

    const job = db.get<{
      action: string;
      quantity: number;
      max_unit_price_cents: number;
      max_order_total_cents: number;
      fulfillment: string;
      expected_seller: string;
    }>("SELECT action, quantity, max_unit_price_cents, max_order_total_cents, fulfillment, expected_seller FROM action_jobs WHERE id = ?", result.actionJobId);
    assert.deepEqual({ ...job }, {
      action: "add_to_cart",
      quantity: 2,
      max_unit_price_cents: 6500,
      max_order_total_cents: 17560,
      fulfillment: "shipping",
      expected_seller: "Target"
    });
    assert.equal(db.get<{ target_quantity: number }>("SELECT target_quantity FROM missions WHERE id = ?", result.missionId)?.target_quantity, 2);

    const storedSignal = db.get<{ offer_json: string }>("SELECT offer_json FROM signal_events WHERE signal_id = ?", result.signalId)?.offer_json ?? "";
    const storedAudit = db.all<{ data_json: string }>("SELECT data_json FROM audit_events").map((row) => row.data_json).join("\n");
    assert.equal(storedSignal.includes("ephemeral-offer-secret"), false);
    assert.equal(storedAudit.includes("ephemeral-offer-secret"), false);
    assert.match(storedSignal, /offerFingerprint/);
  } finally {
    db.close();
  }
});

test("transport duplicates do not create another incident or job", () => {
  const { db, engine } = seededEngine();
  try {
    const first = engine.process(trackalackerSignal(), NOW);
    const duplicate = engine.process(trackalackerSignal(), NOW + 500);
    assert.equal(duplicate.duplicate, true);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_incidents")?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 1);
    assert.ok(first.actionJobId);
  } finally {
    db.close();
  }
});

test("another source corroborates the same opportunity without a second action", () => {
  const { db, engine } = seededEngine();
  try {
    const first = engine.process(trackalackerSignal(), NOW);
    const discord = engine.process({
      ...trackalackerSignal(),
      sourceConnectionId: "source_discord_local",
      source: "discord",
      externalEventId: "discord-event-1",
      identity: {
        retailerId: "target",
        retailerSku: "95280894",
        title: "Pokemon Midnight Elite Trainer Box"
      }
    }, NOW + 1_000);
    assert.equal(discord.corroborated, true);
    assert.equal(discord.incidentId, first.incidentId);
    assert.equal(discord.actionJobId, first.actionJobId);
    assert.equal(db.get<{ occurrence_count: number }>("SELECT occurrence_count FROM signal_incidents WHERE id = ?", first.incidentId)?.occurrence_count, 2);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 1);
  } finally {
    db.close();
  }
});

test("one active purchase job claims sibling store listings but releases after a safe cancellation", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const first = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "sibling-product",
      sourceListingId: "sibling-listing-1",
      title: "Pokemon Sibling Store Fixture",
      retailerId: "target",
      retailerSku: "111111111",
      canonicalUrl: "https://www.target.com/p/-/A-111111111",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 6999
    }, NOW);
    catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "sibling-product",
      sourceListingId: "sibling-listing-2",
      title: "Pokemon Sibling Store Fixture",
      retailerId: "target",
      retailerSku: "222222222",
      canonicalUrl: "https://www.target.com/p/-/A-222222222",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 6999
    }, NOW);
    const control = new ControlRepository(db);
    control.replaceStrategies(purchaseStrategies().map((strategy) => ({ ...strategy, includeKeywords: "" })), NOW);
    control.setActionsPaused(false, "Test enabled actions", NOW);
    const engine = new SignalEngine(db);
    const input = (listingId: string, sku: string, event: string, observedAt: number): SignalEventInput => ({
      ...trackalackerSignal(),
      externalEventId: event,
      observedAt: new Date(observedAt).toISOString(),
      identity: {
        sourceProductId: "sibling-product",
        sourceListingId: listingId,
        retailerId: "target",
        retailerSku: sku,
        canonicalUrl: `https://www.target.com/p/-/A-${sku}`,
        title: "Pokemon Sibling Store Fixture"
      }
    });
    const claimed = engine.process(input("sibling-listing-1", "111111111", "sibling-event-1", NOW - 2_000), NOW);
    const sibling = engine.process(input("sibling-listing-2", "222222222", "sibling-event-2", NOW - 1_000), NOW + 100);
    assert.equal(claimed.actionJobState, "shadow_ready");
    assert.equal(sibling.decision, "sibling_store_claimed");
    assert.equal(sibling.actionJobId, claimed.actionJobId);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 1);

    new SignalRepository(db).transitionJob(
      claimed.actionJobId,
      "cancelled",
      "cancelled_before_mutation",
      "The stale shadow claim was cancelled before mutation.",
      {},
      NOW + 200
    );
    const later = engine.process(input("sibling-listing-2", "222222222", "sibling-event-3", NOW + 500), NOW + 600);
    assert.notEqual(later.actionJobId, claimed.actionJobId);
    assert.equal(later.actionJobState, "shadow_ready");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 2);
    assert.equal(first.listing.variantId, db.get<{ variant_id: string }>("SELECT variant_id FROM listings WHERE retailer_sku = '222222222'")?.variant_id);
  } finally {
    db.close();
  }
});

test("closing an offer-mismatch incident permits a legitimate newer re-signal", () => {
  const { db, engine } = seededEngine();
  try {
    const first = engine.process(trackalackerSignal(), NOW);
    const signals = new SignalRepository(db);
    signals.transitionJob(first.actionJobId, "awaiting_executor", "fixture", "Fixture entered execution.", {}, NOW + 500);
    signals.transitionJob(first.actionJobId, "leased", "fixture", "Fixture lease acquired.", {}, NOW + 750);
    signals.transitionJob(first.actionJobId, "navigating", "fixture", "Fixture navigation started.", {}, NOW + 1_000);
    signals.transitionJob(first.actionJobId, "verifying_listing", "fixture", "Fixture offer verification started.", {}, NOW + 1_250);
    signals.transitionJob(first.actionJobId, "offer_rejected", "live_offer_changed", "The exact live offer no longer matched.", {}, NOW + 2_000);
    const second = engine.process(trackalackerSignal({
      externalEventId: "track-event-2",
      observedAt: new Date(NOW + 3_000).toISOString()
    }), NOW + 4_000);
    assert.equal(second.duplicate, false);
    assert.equal(second.corroborated, false);
    assert.notEqual(second.incidentId, first.incidentId);
    assert.notEqual(second.actionJobId, first.actionJobId);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 2);
  } finally {
    db.close();
  }
});

test("a locked uncertain job can be closed only after explicit user browser review", () => {
  const { db, engine } = seededEngine();
  try {
    const result = engine.process(trackalackerSignal({ externalEventId: "track-event-manual-review" }), NOW);
    db.run("UPDATE action_jobs SET state = 'manual_review' WHERE id = ?", result.actionJobId);
    db.run("UPDATE action_jobs SET expires_at = ? WHERE id = ?", new Date(NOW - 1_000).toISOString(), result.actionJobId);
    db.run("UPDATE signal_incidents SET status = 'locked' WHERE id = ?", result.incidentId);
    const signals = new SignalRepository(db);
    const missionId = db.get<{ mission_id: string }>("SELECT mission_id FROM action_jobs WHERE id = ?", result.actionJobId)?.mission_id;
    assert.ok(missionId);
    assert.equal(signals.activePurchaseJobForMission(missionId, NOW + 86_400_000)?.id, result.actionJobId);
    assert.throws(() => signals.resolveReviewJob(
      result.actionJobId,
      "cancelled",
      "",
      ""
    ), /explicit browser-state confirmation/);
    const resolved = signals.resolveReviewJob(
      result.actionJobId,
      "cancelled",
      "I_REVIEWED_BROWSER_STATE",
      "Retailer cart checked empty",
      NOW + 1_000
    );
    assert.equal(resolved.state, "cancelled");
    assert.equal(db.get<{ status: string }>("SELECT status FROM signal_incidents WHERE id = ?", result.incidentId)?.status, "closed");
    assert.equal(db.get<{ reason_code: string }>("SELECT reason_code FROM action_events WHERE job_id = ? ORDER BY created_at DESC LIMIT 1", result.actionJobId)?.reason_code, "user_verified_no_purchase");
  } finally {
    db.close();
  }
});

test("an over-MSRP signal falls through to the lower catchall notification", () => {
  const { db, engine } = seededEngine();
  try {
    const result = engine.process(trackalackerSignal({
      externalEventId: "track-event-high-price",
      offer: {
        availability: "in_stock",
        unitPriceCents: 7000,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        fulfillment: "shipping"
      }
    }), NOW);
    assert.equal(result.strategyId, "strategy_catchall_notify");
    assert.equal(result.actionJobState, "notify_only");
    assert.equal(result.decision, "qualified");
  } finally {
    db.close();
  }
});

test("an explicit allowed-seller list never qualifies a sellerless signal", () => {
  const { db, engine } = seededEngine();
  try {
    const control = new ControlRepository(db);
    control.replaceStrategies(purchaseStrategies().map((strategy) => strategy.id === "strategy_target_msrp"
      ? { ...strategy, allowedSellers: ["Target"] }
      : strategy));
    const result = engine.process(trackalackerSignal({
      externalEventId: "track-event-seller-missing",
      offer: {
        availability: "in_stock",
        unitPriceCents: 6500,
        currency: "USD",
        sellerName: "",
        sellerType: "unknown",
        fulfillment: "shipping"
      }
    }), NOW);
    assert.equal(result.strategyId, "strategy_catchall_notify");
    assert.equal(result.actionJobState, "notify_only");
  } finally {
    db.close();
  }
});

test("test signals never create catalog records, missions, incidents, or jobs", () => {
  const db = new YoinkDatabase();
  try {
    const result = new SignalEngine(db).process(trackalackerSignal({
      externalEventId: "track-test-event",
      test: true,
      identity: {
        sourceProductId: "new-test-product",
        sourceListingId: "new-test-listing",
        retailerId: "amazon",
        retailerSku: "B0TEST0001",
        canonicalUrl: "https://www.amazon.com/dp/B0TEST0001",
        title: "Test product"
      }
    }), NOW);
    assert.equal(result.decision, "test_signal");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_incidents")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 0);
  } finally {
    db.close();
  }
});

test("a trusted exact new-product signal creates catalog identity but degrades safely without MSRP", () => {
  const db = new YoinkDatabase();
  try {
    const control = new ControlRepository(db);
    control.replaceStrategies(purchaseStrategies());
    control.setActionsPaused(false, "Test enabled actions");
    const result = new SignalEngine(db).process(trackalackerSignal({
      externalEventId: "brand-new-event",
      identity: {
        sourceProductId: "brand-new-product",
        sourceListingId: "brand-new-listing",
        retailerId: "amazon",
        retailerSku: "B0NEW00001",
        canonicalUrl: "https://www.amazon.com/dp/B0NEW00001",
        title: "Pokemon New Elite Trainer Box"
      }
    }), NOW);
    assert.equal(result.resolutionMethod, "exact_signal_identity");
    assert.equal(result.missionCreated, true);
    assert.equal(result.actionJobState, "notify_only");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 1);
  } finally {
    db.close();
  }
});
