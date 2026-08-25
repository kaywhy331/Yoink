import assert from "node:assert/strict";
import test from "node:test";
import { TARGET_ADD_ADAPTER_VERSION, type SignalEventInput, type StrategyDefinition } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { OfferIdentityRepository } from "../packages/database/src/offer-identity-repository.js";
import { PurchasePolicyRepository } from "../packages/database/src/purchase-policy-repository.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import { SpendLedgerRepository } from "../packages/database/src/spend-ledger-repository.js";
import { normalizeSignal } from "../packages/domain/src/normalize.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

const NOW = new Date("2026-08-24T18:00:00.000Z").getTime();

function listing(db: YoinkDatabase, sku: string, sourceProductId = `product-${sku}`) {
  return new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId,
    sourceListingId: `listing-${sku}`,
    title: `Exact Product ${sku}`,
    retailerId: "target",
    retailerSku: sku,
    canonicalUrl: `https://www.target.com/p/-/A-${sku}`,
    listingStatus: "in_stock",
    executionSupported: true,
    msrpCents: 5000,
    currency: "USD",
    variantAttributes: { color: "Blue", edition: "First", ignoredPrivateShape: "discarded" }
  }, NOW);
}

function signal(sku: string, eventId: string, priceCents = 4000): SignalEventInput {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: eventId,
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: `product-${sku}`,
      sourceListingId: `listing-${sku}`,
      retailerId: "target",
      retailerSku: sku,
      canonicalUrl: `https://www.target.com/p/-/A-${sku}`,
      title: `Exact Product ${sku}`
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: priceCents,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      orderLimit: 1,
      fulfillment: "shipping",
      offerId: `EPHEMERAL-${eventId}`
    },
    parserVersion: "purchase-safety-test-v1"
  };
}

function addStrategy(): StrategyDefinition {
  return {
    id: "strategy_exact_add",
    name: "Exact add",
    enabled: true,
    position: 1,
    revision: 1,
    sources: ["trackalacker"],
    retailers: ["target"],
    pricePolicy: { kind: "absolute_max", maxPriceCents: 5000 },
    sellerPolicy: "first_party_only",
    allowedSellers: [],
    includeKeywords: "",
    excludeKeywords: "",
    action: "add_to_cart",
    quantity: 1,
    fulfillment: "shipping",
    maxSignalAgeSeconds: 120
  };
}

function qualifyTargetAdd(db: YoinkDatabase): void {
  db.run(
    `INSERT INTO retailer_adapter_qualifications(
       tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
       evidence_hash, qualified_at, updated_at
     ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', 'purchase-safety-target-evidence', ?, ?)`,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    TARGET_ADD_ADAPTER_VERSION,
    new Date(NOW).toISOString(),
    new Date(NOW).toISOString()
  );
}

test("purchase intents append revisions and reject stale concurrent edits", () => {
  const db = new YoinkDatabase();
  try {
    const created = listing(db, "10000001");
    const control = new ControlRepository(db);
    const mission = control.ensureMission(created.listing.variantId, created.listing.id, "test");
    const initial = new PurchasePolicyRepository(db).current(mission.mission.id);
    assert.equal(initial?.revision, 1);
    const detail = control.missionDetail(mission.mission.id) as { targets: Array<Record<string, unknown>> };
    const target = detail.targets[0];
    assert.ok(target);
    const updated = control.updateMission(mission.mission.id, {
      status: "active",
      targetQuantity: 2,
      targets: [{
        id: String(target.id),
        enabled: true,
        maxUnitPriceCents: 4500,
        sellerPolicy: "first_party_only",
        fulfillment: "shipping"
      }],
      policy: {
        expectedRevision: 1,
        maxAllInCents: 10_000,
        actionCeiling: "add_to_cart",
        substitutionPolicy: "exact_only",
        cooldownSeconds: 60,
        expiresAt: new Date(NOW + 86_400_000).toISOString(),
        changeReason: "Fixture preferences"
      }
    }, NOW) as { intentPolicy: { revision: number; quantity: number; maxAllInCents: number } };
    assert.equal(updated.intentPolicy.revision, 2);
    assert.equal(updated.intentPolicy.quantity, 2);
    assert.equal(updated.intentPolicy.maxAllInCents, 10_000);
    assert.throws(() => control.updateMission(mission.mission.id, {
      status: "active",
      targetQuantity: 2,
      targets: [{
        id: String(target.id), enabled: true, maxUnitPriceCents: 4500,
        sellerPolicy: "first_party_only", fulfillment: "shipping"
      }],
      policy: { expectedRevision: 1, maxAllInCents: 9000 }
    }, NOW), /changed after it was loaded/);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM mission_intent_revisions WHERE mission_id = ?",
      mission.mission.id
    )?.count, 2);
    assert.throws(() => db.run(
      "UPDATE mission_intent_revisions SET change_reason = 'tampered' WHERE mission_id = ?",
      mission.mission.id
    ), /append-only/);
  } finally {
    db.close();
  }
});

test("exact offer keys separate seller bindings and never persist ephemeral offer tokens", () => {
  const db = new YoinkDatabase();
  try {
    const created = listing(db, "10000002");
    const control = new ControlRepository(db);
    const mission = control.ensureMission(created.listing.variantId, created.listing.id, "test");
    const policy = new PurchasePolicyRepository(db).current(mission.mission.id);
    assert.ok(policy);
    const repository = new OfferIdentityRepository(db);
    const firstSignal = normalizeSignal(signal("10000002", "exact-offer-first"), NOW);
    const first = repository.capture(
      firstSignal,
      created.listing,
      mission.mission.id,
      policy,
      "",
      1,
      5000,
      new Date(NOW + 60_000).toISOString(),
      NOW
    );
    const marketplaceSignal = normalizeSignal({
      ...signal("10000002", "exact-offer-marketplace"),
      offer: {
        ...signal("10000002", "exact-offer-marketplace").offer,
        sellerName: "Named Marketplace Seller",
        sellerType: "third_party"
      }
    }, NOW + 1_000);
    const second = repository.capture(
      marketplaceSignal,
      created.listing,
      mission.mission.id,
      policy,
      "",
      1,
      5000,
      new Date(NOW + 61_000).toISOString(),
      NOW + 1_000
    );
    assert.notEqual(first.exactOffer.id, second.exactOffer.id);
    assert.deepEqual(first.exactOffer.attributes, { color: "Blue", edition: "First" });
    const durable = JSON.stringify({
      keys: db.all("SELECT * FROM exact_offer_keys"),
      snapshots: db.all("SELECT * FROM offer_snapshots")
    });
    assert.equal(durable.includes("EPHEMERAL-exact-offer-first"), false);
    assert.equal(durable.includes("EPHEMERAL-exact-offer-marketplace"), false);
    assert.throws(() => db.run("DELETE FROM offer_snapshots WHERE id = ?", first.snapshot.id), /immutable/);
  } finally {
    db.close();
  }
});

test("concurrent jobs cannot exceed periodic spend and add-only confirmation never records a purchase", () => {
  const db = new YoinkDatabase();
  try {
    listing(db, "10000003");
    listing(db, "10000004");
    const control = new ControlRepository(db);
    control.replaceStrategies([addStrategy()]);
    control.updateSettings({
      dedupeWindowSeconds: 300,
      affiliateMode: "disabled",
      taxBps: 0,
      storeAllowancesCents: { target: 0, walmart: 0, amazon: 0, bestbuy: 0 }
    }, NOW);
    control.setActionsPaused(false, "Fixture live actions", NOW);
    qualifyTargetAdd(db);
    db.run("UPDATE app_settings SET execution_mode = 'live'");
    const spend = new SpendLedgerRepository(db);
    spend.updatePolicy({
      expectedRevision: spend.policy(NOW).revision,
      perOrderCapCents: 5000,
      dailyCapCents: 6000,
      monthlyCapCents: 20_000
    }, NOW);
    const engine = new SignalEngine(db);
    const first = engine.process(signal("10000003", "spend-first"), NOW);
    assert.equal(first.actionJobState, "awaiting_executor");
    assert.equal(spend.summary(NOW).activeReservedCents, 4000);
    const second = engine.process(signal("10000004", "spend-second"), NOW + 2_000);
    assert.equal(second.actionJobState, "notify_only");
    assert.equal(second.decision, "daily_spend_cap_exceeded");
    const firstReservation = spend.reservationForJob(first.actionJobId);
    assert.equal(firstReservation?.status, "active");

    const signals = new SignalRepository(db);
    signals.transitionJob(first.actionJobId, "leased", "fixture", "Leased.", {}, NOW + 3_000);
    signals.transitionJob(first.actionJobId, "navigating", "fixture", "Navigating.", {}, NOW + 4_000);
    signals.transitionJob(first.actionJobId, "verifying_listing", "fixture", "Verifying.", {}, NOW + 5_000);
    signals.transitionJob(first.actionJobId, "offer_verified", "fixture", "Verified.", {}, NOW + 6_000);
    signals.transitionJob(first.actionJobId, "add_authorized", "fixture", "Authorized.", {}, NOW + 7_000);
    signals.transitionJob(first.actionJobId, "adding", "fixture", "Adding.", {}, NOW + 8_000);
    signals.transitionJob(first.actionJobId, "cart_verified", "fixture", "Cart verified.", {}, NOW + 9_000);
    signals.transitionJob(first.actionJobId, "confirmed", "fixture", "Add confirmed.", {}, NOW + 10_000);
    assert.equal(spend.reservationForJob(first.actionJobId)?.status, "released");
    assert.equal(spend.summary(NOW + 10_000).spentTodayCents, 0);
    assert.equal(db.get<{ fulfilled: number }>(
      "SELECT fulfilled_quantity AS fulfilled FROM missions WHERE id = ?",
      first.missionId
    )?.fulfilled, 0);
    assert.deepEqual(
      db.all<{ entryType: string; spent: number }>(
        `SELECT entry_type AS entryType, spent_delta_cents AS spent
         FROM spend_ledger_entries WHERE action_job_id = ? ORDER BY created_at`,
        first.actionJobId
      ).map((row) => ({ ...row })),
      [{ entryType: "reserved", spent: 0 }, { entryType: "released", spent: 0 }]
    );
    assert.throws(() => db.run(
      "UPDATE spend_ledger_entries SET reason_code = 'tampered' WHERE action_job_id = ?",
      first.actionJobId
    ), /append-only/);
  } finally {
    db.close();
  }
});

test("revising an intent cancels unleased stale work and releases its reservation atomically", () => {
  const db = new YoinkDatabase();
  try {
    listing(db, "10000005");
    const control = new ControlRepository(db);
    control.replaceStrategies([addStrategy()]);
    control.updateSettings({
      dedupeWindowSeconds: 300,
      affiliateMode: "disabled",
      taxBps: 0,
      storeAllowancesCents: { target: 0, walmart: 0, amazon: 0, bestbuy: 0 }
    }, NOW);
    control.setActionsPaused(false, "Fixture live actions", NOW);
    qualifyTargetAdd(db);
    db.run("UPDATE app_settings SET execution_mode = 'live'");
    const result = new SignalEngine(db).process(signal("10000005", "stale-intent-job"), NOW);
    assert.equal(result.actionJobState, "awaiting_executor");
    const detail = control.missionDetail(result.missionId) as {
      status: "active";
      targetQuantity: number;
      intentPolicy: { revision: number };
      targets: Array<Record<string, unknown>>;
    };
    const target = detail.targets[0];
    assert.ok(target);
    control.updateMission(result.missionId, {
      status: "active",
      targetQuantity: detail.targetQuantity,
      targets: [{
        id: String(target.id),
        enabled: true,
        maxUnitPriceCents: 4500,
        sellerPolicy: "first_party_only",
        fulfillment: "shipping"
      }],
      policy: {
        expectedRevision: detail.intentPolicy.revision,
        maxAllInCents: 5000,
        actionCeiling: "add_to_cart",
        substitutionPolicy: "exact_only",
        cooldownSeconds: 0
      }
    }, NOW + 1_000);
    assert.equal(db.get<{ state: string }>("SELECT state FROM action_jobs WHERE id = ?", result.actionJobId)?.state, "cancelled");
    assert.equal(new SpendLedgerRepository(db).reservationForJob(result.actionJobId)?.status, "released");
    assert.equal(db.get<{ reason: string }>(
      "SELECT reason_code AS reason FROM action_events WHERE job_id = ? ORDER BY created_at DESC LIMIT 1",
      result.actionJobId
    )?.reason, "intent_revision_superseded");
  } finally {
    db.close();
  }
});
