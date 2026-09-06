import assert from "node:assert/strict";

import { TARGET_ADD_ADAPTER_VERSION, type SignalEventInput } from "../../packages/contracts/src/index.js";
import { CatalogRepository } from "../../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../../packages/database/src/database.js";
import { SignalRepository } from "../../packages/database/src/signal-repository.js";
import { SpendLedgerRepository } from "../../packages/database/src/spend-ledger-repository.js";
import { SignalEngine } from "../../packages/engine/src/signal-engine.js";

export const NOW = new Date("2026-08-22T19:00:00.000Z").getTime();

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
  control.replaceStrategies([]);
  control.setActionsPaused(false, "Test enabled actions");
  return { db, engine: new SignalEngine(db) };
}

function qualifyTargetAdd(db: YoinkDatabase): void {
  db.run(
    `INSERT INTO retailer_adapter_qualifications(
       tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
       evidence_hash, qualified_at, updated_at
     ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', 'signal-engine-target-evidence', ?, ?)`,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    TARGET_ADD_ADAPTER_VERSION,
    new Date(NOW).toISOString(),
    new Date(NOW).toISOString()
  );
}

export function checkoutFixture(outcome: "got_it" | "missed_it" = "got_it", total = 6500, reportAt = NOW + 2000, fromReview = false) {
  const { db, engine } = seededEngine();
  const listingId = db.get<{ id: string }>("SELECT id FROM listings WHERE retailer_id = 'target' AND retailer_sku = '95280894'")!.id;
  engine.control.replaceStrategies([], NOW);
  engine.control.createConfiguredMission({ contractVersion: 1, listingId, targetQuantity: 2,
    maxUnitPriceCents: 7000, maxAllInCents: 18680, actionCeiling: "add_to_cart", sellerPolicy: "first_party_only",
    fulfillment: "shipping", substitutionPolicy: "exact_only", cooldownSeconds: 900,
    confirmation: "CREATE_EXACT_PURCHASE_PLAN" }, NOW);
  qualifyTargetAdd(db);
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
  const created = engine.process(trackalackerSignal(), NOW);
  const jobId = created.actionJobId;
  assert.ok(jobId);
  const signals = new SignalRepository(db);
  const spend = new SpendLedgerRepository(db);
  db.run("UPDATE action_jobs SET state = ? WHERE id = ?", fromReview ? "manual_review" : "confirmed", jobId);
  if (!fromReview) spend.releaseForJob(jobId, "add_to_cart_confirmed_without_order", NOW + 1000);
  signals.reportCartOutcome(jobId, outcome, "I_REVIEWED_CHECKOUT_RESULT", outcome === "got_it" ? total : null, "Original report", reportAt);
  const missionId = db.get<{ id: string }>("SELECT mission_id AS id FROM action_jobs WHERE id = ?", jobId)!.id;
  return { db, engine, signals, spend, jobId, missionId, reportAt };
}
