import assert from "node:assert/strict";
import test from "node:test";
import {
  BESTBUY_OBSERVER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { DropWindowRepository } from "../packages/database/src/drop-window-repository.js";
import { OrderConfirmationRepository } from "../packages/database/src/order-confirmation-repository.js";
import { PrivacyComplianceRepository } from "../packages/database/src/privacy-compliance-repository.js";
import { RestockPatternRepository } from "../packages/database/src/restock-pattern-repository.js";
import { RetailerReadinessRepository } from "../packages/database/src/retailer-readiness-repository.js";
import { QualificationRepository } from "../packages/database/src/qualification-repository.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";
import { UserActionConnectorRepository } from "../packages/database/src/user-action-connector-repository.js";
import { UserPrivacyRepository } from "../packages/database/src/user-privacy-repository.js";

const NOW = Date.parse("2026-08-30T18:00:00.000Z");

function seedListing(db: YoinkDatabase): void {
  db.exec(`
    INSERT INTO product_families(id, title, brand, created_at, updated_at)
      VALUES ('family_action_platform', 'Action platform cards', 'Bicycle',
        '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z');
    INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
      VALUES ('variant_action_platform', 'family_action_platform', 'Bicycle cards 2-pack', '{}',
        '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z');
    INSERT INTO listings(
      id, variant_id, retailer_id, retailer_sku, canonical_url,
      status, execution_supported, currency, created_at, updated_at
    ) VALUES (
      'listing_action_platform', 'variant_action_platform', 'target', '13331333',
      'https://www.target.com/p/-/A-13331333', 'in_stock', 1, 'USD',
      '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z'
    );
  `);
}

function pair(db: YoinkDatabase) {
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(NOW);
  return devices.pair({
    pairingCode: pairing.code,
    extensionVersion: "1.15.0",
    capabilities: { readiness: true, jobReconciliation: true }
  }, NOW + 1);
}

function seedConfirmedActionJob(db: YoinkDatabase, deviceId: string): string {
  const jobId = "job_action_platform_confirmed";
  db.exec(`
    INSERT INTO missions(
      id, tenant_id, user_id, variant_id, status, origin,
      target_quantity, fulfilled_quantity, created_at, updated_at
    ) VALUES (
      'mission_action_platform', 'tenant_local', 'user_local',
      'variant_action_platform', 'active', 'manual', 1, 0,
      '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z'
    );
    INSERT INTO mission_targets(
      id, mission_id, listing_id, enabled, max_unit_price_cents,
      currency, seller_policy, fulfillment, created_at, updated_at
    ) VALUES (
      'mission_target_action_platform', 'mission_action_platform',
      'listing_action_platform', 1, 600, 'USD', 'first_party_only', 'shipping',
      '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z'
    );
    INSERT INTO mission_intent_revisions(
      id, tenant_id, user_id, mission_id, revision, quantity, currency,
      max_all_in_cents, action_ceiling, substitution_policy, expires_at,
      cooldown_seconds, target_policy_json, policy_hash, change_reason,
      created_by_actor_id, created_at
    ) VALUES (
      'intent_action_platform', 'tenant_local', 'user_local',
      'mission_action_platform', 1, 1, 'USD', 600, 'add_to_cart',
      'exact_only', '', 0,
      '[{"targetId":"mission_target_action_platform","listingId":"listing_action_platform","retailerId":"target","enabled":true,"maxUnitPriceCents":600,"sellerPolicy":"first_party_only","fulfillment":"shipping"}]',
      'action-platform-policy', 'Exact add-to-cart plan armed.',
      'user_local', '2026-08-30T17:00:00.000Z'
    );
    INSERT INTO signal_incidents(
      id, tenant_id, user_id, listing_id, event_type, semantic_key, status,
      currency, first_observed_at, last_observed_at, created_at, updated_at
    ) VALUES (
      'incident_action_platform', 'tenant_local', 'user_local',
      'listing_action_platform', 'restock', 'action-platform-confirmation',
      'open', 'USD', '2026-08-30T17:00:00.000Z',
      '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z',
      '2026-08-30T17:00:00.000Z'
    );
  `);
  db.run(
    `INSERT INTO action_jobs(
       id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
       assigned_device_id, state, action, quantity, max_unit_price_cents,
       currency, seller_policy, fulfillment, listing_id, canonical_url,
       idempotency_key, capability_nonce_hash, expires_at, created_at, updated_at
     ) VALUES (
       ?, 'tenant_local', 'user_local', 'mission_action_platform',
       'mission_target_action_platform', 'incident_action_platform', ?,
       'confirmed', 'add_to_cart', 1, 600, 'USD', 'first_party_only',
       'shipping', 'listing_action_platform', 'https://www.target.com/p/-/A-13331333',
       'action-platform-confirmation-job', 'discarded', ?, ?, ?
     )`,
    jobId,
    deviceId,
    new Date(NOW + 60 * 60_000).toISOString(),
    new Date(NOW).toISOString(),
    new Date(NOW).toISOString()
  );
  return jobId;
}

test("drop windows lease exact read-only observations and close one item on stock", () => {
  const db = new YoinkDatabase();
  try {
    seedListing(db);
    const device = pair(db);
    const repository = new DropWindowRepository(db);
    const created = repository.create({
      contractVersion: 1,
      kind: "drop_window",
      retailerId: "target",
      title: "Target midnight cards",
      startsAt: new Date(NOW + 10 * 60_000).toISOString(),
      closesAt: new Date(NOW + 60 * 60_000).toISOString(),
      spreadSeconds: 0,
      confidenceBps: 8200,
      timezone: "America/Los_Angeles",
      products: [{
        listingId: "listing_action_platform",
        earlyAccess: { membership: "Circle", queueExpected: false }
      }]
    }, NOW);
    assert.equal(created.signals.length, 1);
    assert.equal(created.signals[0]?.eventType, "drop_window");
    assert.equal(created.items[0]?.earlyAccess.membership, "Circle");

    const enrolled = repository.enroll(created.items[0]!.id, NOW + 10);
    assert.equal(enrolled.state, "queued");
    assert.equal(enrolled.retailerSku, "13331333");
    const leased = repository.leaseNext(device.id, NOW + 20);
    assert.equal(leased.reason, "leased");
    assert.equal(leased.item?.readOnly, true);
    assert.equal(leased.item?.quantity, 1);
    const preorder = repository.recordObservation(device.id, enrolled.id, {
      contractVersion: 1,
      capabilityToken: leased.item!.capabilityToken,
      retailerId: "target",
      retailerSku: "13331333",
      availability: "preorder",
      unitPriceCents: 539,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      fulfillment: "shipping",
      observerVersion: "target-observer-v9",
      observedAt: new Date(NOW + 25).toISOString(),
      extensionVersion: "1.15.0"
    }, NOW + 30);
    assert.equal(preorder.item.state, "queued");
    assert.equal(preorder.signal, null);
    const leasedAgain = repository.leaseNext(device.id, NOW + 5 * 60_000);
    assert.equal(leasedAgain.reason, "leased");
    const observation = repository.recordObservation(device.id, enrolled.id, {
      contractVersion: 1,
      capabilityToken: leasedAgain.item!.capabilityToken,
      retailerId: "target",
      retailerSku: "13331333",
      availability: "in_stock",
      unitPriceCents: 539,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      fulfillment: "shipping",
      observerVersion: "target-observer-v9",
      observedAt: new Date(NOW + 5 * 60_000 + 5).toISOString(),
      extensionVersion: "1.15.0"
    }, NOW + 5 * 60_000 + 10);
    assert.equal(observation.item.state, "seen_in_stock");
    assert.equal(observation.signal?.eventType, "in_stock");
    assert.equal(observation.signal?.identity.retailerSku, "13331333");
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM watch_queue_items WHERE observation_capability_hash = ''"
    )?.count, 1);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("auto-watch backfills armed plans and drop-window supersession closes only the replaced watches", () => {
  const db = new YoinkDatabase();
  try {
    seedListing(db);
    const device = pair(db);
    seedConfirmedActionJob(db, device.id);
    const repository = new DropWindowRepository(db);
    const original = repository.create({
      contractVersion: 1,
      kind: "drop_window",
      retailerId: "target",
      title: "Original Target window",
      startsAt: new Date(NOW + 10 * 60_000).toISOString(),
      closesAt: new Date(NOW + 60 * 60_000).toISOString(),
      spreadSeconds: 0,
      confidenceBps: 7000,
      timezone: "America/Los_Angeles",
      products: [{ listingId: "listing_action_platform" }]
    }, NOW);
    assert.equal(repository.watchQueueMode(), "manual");
    assert.equal(original.items[0]?.watch, null);

    const enabled = repository.setWatchQueueMode("auto_armed", NOW + 1_000);
    assert.deepEqual(enabled, {
      mode: "auto_armed",
      previousMode: "manual",
      newlyEnrolledCount: 1
    });
    const autoWatch = repository.listWatchQueue(NOW + 1_001)[0];
    assert.equal(autoWatch?.enrollment, "auto_armed");
    assert.equal(autoWatch?.missionId, "mission_action_platform");
    assert.equal(repository.leaseNext(device.id, NOW + 2_000).reason, "leased");

    const replacement = repository.create({
      contractVersion: 1,
      kind: "queue_open",
      retailerId: "target",
      title: "Replacement Target queue",
      startsAt: new Date(NOW + 15 * 60_000).toISOString(),
      closesAt: new Date(NOW + 90 * 60_000).toISOString(),
      spreadSeconds: 0,
      confidenceBps: 8500,
      timezone: "America/Los_Angeles",
      supersedesId: original.id,
      products: [{ listingId: "listing_action_platform", earlyAccess: { membership: "Circle" } }]
    }, NOW + 3_000);
    assert.equal(replacement.supersedesId, original.id);
    assert.equal(repository.get(original.id)?.status, "superseded");
    assert.equal(repository.get(original.id)?.supersededById, replacement.id);
    const watches = repository.listWatchQueue(NOW + 3_001);
    const replacedWatch = watches.find((item) => item.dropWindowId === original.id);
    const replacementWatch = watches.find((item) => item.dropWindowId === replacement.id);
    assert.equal(replacedWatch?.state, "cancelled");
    assert.equal(replacedWatch?.closedReason, "window_superseded");
    assert.equal(replacementWatch?.state, "queued");
    assert.equal(replacementWatch?.enrollment, "auto_armed");

    const disabled = repository.setWatchQueueMode("manual", NOW + 4_000);
    assert.equal(disabled.mode, "manual");
    assert.equal(disabled.previousMode, "auto_armed");
    assert.equal(disabled.newlyEnrolledCount, 0);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("scheduled drop windows expose details, recalculate on edit, and cancel watches without touching jobs", () => {
  const db = new YoinkDatabase();
  try {
    seedListing(db);
    const device = pair(db);
    const jobId = seedConfirmedActionJob(db, device.id);
    const repository = new DropWindowRepository(db);
    const created = repository.create({
      contractVersion: 1,
      kind: "drop_window",
      retailerId: "target",
      title: "Target midnight cards",
      startsAt: new Date(NOW + 30 * 60_000).toISOString(),
      closesAt: new Date(NOW + 90 * 60_000).toISOString(),
      spreadSeconds: 0,
      confidenceBps: 6000,
      timezone: "America/Los_Angeles",
      products: [{ listingId: "listing_action_platform" }]
    }, NOW);
    const watch = repository.enroll(created.items[0]!.id, NOW + 1_000);

    const updated = repository.update(created.id, {
      title: "Target cards confirmed",
      startsAt: new Date(NOW + 45 * 60_000).toISOString(),
      closesAt: new Date(NOW + 120 * 60_000).toISOString(),
      spreadSeconds: 300,
      confidenceBps: 10_000,
      timezone: "America/New_York",
      earlyAccessNote: "Circle members may see stock first."
    }, NOW + 2_000);
    assert.equal(updated.title, "Target cards confirmed");
    assert.equal(updated.confidenceBps, 10_000);
    assert.equal(updated.timezone, "America/New_York");
    assert.equal(updated.optInCount, 1);
    assert.equal(updated.items[0]?.optInCount, 1);
    assert.equal(updated.items[0]?.watchStateCounts.queued, 1);
    assert.deepEqual(updated.optedInUsers, [{ userId: LOCAL_USER_ID, displayName: "Local user" }]);
    assert.equal(repository.list(NOW + 2_001).find((window) => window.id === created.id)?.optInCount, 1,
      "the list projection reports the same active opt-in count as the detail");
    assert.equal(updated.items[0]?.earlyAccess.note, "Circle members may see stock first.");
    assert.equal(updated.items[0]?.expectedAt, new Date(NOW + 45 * 60_000).toISOString());
    assert.equal(repository.listWatchQueue(NOW + 2_001)[0]?.observationClosesAt, new Date(NOW + 120 * 60_000).toISOString());

    const cancelled = repository.cancelWindow(created.id, "incorrect_schedule", NOW + 3_000);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.optInCount, 0, "cancelled watches are not opt-ins");
    assert.equal(cancelled.items[0]?.optInCount, 0);
    assert.equal(cancelled.items[0]?.watchStateCounts.cancelled, 1);
    assert.deepEqual(cancelled.optedInUsers, []);
    assert.equal(repository.list(NOW + 3_001).find((window) => window.id === created.id)?.optInCount, 0);
    assert.equal(repository.listWatchQueue(NOW + 3_001).find((item) => item.id === watch.id)?.state, "cancelled");
    assert.equal(db.get<{ state: string }>("SELECT state FROM action_jobs WHERE id = ?", jobId)?.state, "confirmed");
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'drop_window_cancelled' AND reason_code = 'incorrect_schedule'"
    )?.count, 1);
    assert.throws(() => repository.update(created.id, { title: "Too late" }, NOW + 4_000), /scheduled/i);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("store requalification plans reuse and rank a multi-product evidence history", () => {
  const db = new YoinkDatabase();
  try {
    seedListing(db);
    const device = pair(db);
    const shadows = new ShadowObservationRepository(db);
    const first = shadows.record(device.id, {
      adapterVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      observedAt: new Date(NOW + 1_000).toISOString(),
      pageKind: "product",
      retailerId: "target",
      retailerSku: "13331333",
      availability: "in_stock",
      unitPriceCents: 539,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      fulfillment: "shipping",
      addControlActionable: true,
      securityChallenge: false,
      interactiveBlock: ""
    }, NOW + 2_000);
    const incomplete = new RetailerReadinessRepository(db).lane("target", NOW + 3_000);
    assert.equal(incomplete.candidates.length, 1);
    assert.equal(incomplete.candidate?.retailerSku, "13331333");
    assert.deepEqual(incomplete.candidate?.qualificationTypes, [
      "first_party_actionable",
      "shipping_actionable"
    ]);
    assert.equal(incomplete.evidence.qualificationEvidenceReady, false);
    assert.equal(incomplete.automaticCheckNeeded, true);

    new QualificationRepository(db).recordTargetAddRehearsal(device.id, {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: first.id,
      observedAt: new Date(NOW + 3_500).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 4_000);
    shadows.record(device.id, {
      adapterVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      observedAt: new Date(NOW + 5_000).toISOString(),
      pageKind: "product",
      retailerId: "target",
      retailerSku: "94972381",
      availability: "in_stock",
      unitPriceCents: 3999,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      fulfillment: "shipping",
      addControlActionable: true,
      securityChallenge: false,
      interactiveBlock: ""
    }, NOW + 6_000);

    const complete = new RetailerReadinessRepository(db).lane("target", NOW + 7_000);
    assert.deepEqual(complete.candidates.map((candidate) => candidate.retailerSku), [
      "13331333",
      "94972381"
    ]);
    assert.equal(complete.candidates[1]?.canonicalUrl, "https://www.target.com/p/-/A-94972381",
      "a directly inspected product remains reusable before it is added to the catalog");
    assert.equal(complete.candidates[0]?.currentRehearsalPassed, true);
    assert.equal(complete.candidates[0]?.priorRehearsalPassed, true);
    assert.equal(complete.evidence.distinctSkuCount, 2);
    assert.equal(complete.evidence.qualificationEvidenceReady, true);
    assert.equal(complete.automaticCheckNeeded, false,
      "a complete current dossier should await explicit store activation without reopening products");
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("store requalification replays unresolved observer failures and reuses actionable preorders", () => {
  const db = new YoinkDatabase();
  try {
    const device = pair(db);
    db.exec(`
      INSERT INTO product_families(id, title, brand, created_at, updated_at)
        VALUES ('family_bestbuy_candidate', 'Best Buy candidate', '', '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z');
      INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
        VALUES ('variant_bestbuy_candidate', 'family_bestbuy_candidate', 'In-stock Best Buy candidate', '{}', '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z');
      INSERT INTO listings(
        id, variant_id, retailer_id, retailer_sku, canonical_url, status,
        execution_supported, currency, created_at, updated_at
      ) VALUES (
        'listing_bestbuy_candidate', 'variant_bestbuy_candidate', 'bestbuy', '6587244',
        'https://www.bestbuy.com/site/-/6587244.p', 'in_stock', 0, 'USD',
        '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z'
      );
    `);
    const shadows = new ShadowObservationRepository(db);
    shadows.record(device.id, {
      adapterVersion: BESTBUY_OBSERVER_VERSION,
      contractVersion: 1,
      observedAt: new Date(NOW + 1_000).toISOString(),
      pageKind: "product",
      retailerId: "bestbuy",
      retailerSku: "6688068",
      canonicalUrl: "https://www.bestbuy.com/product/example/sku/6688068",
      availability: "preorder",
      unitPriceCents: 2499,
      currency: "USD",
      sellerName: "Best Buy",
      sellerType: "first_party",
      fulfillment: "shipping",
      addControlActionable: true,
      securityChallenge: false,
      interactiveBlock: ""
    }, NOW + 2_000);
    shadows.record(device.id, {
      adapterVersion: WALMART_OBSERVER_VERSION,
      contractVersion: 1,
      observedAt: new Date(NOW + 3_000).toISOString(),
      pageKind: "product",
      retailerId: "walmart",
      retailerSku: "15561620611",
      canonicalUrl: "https://www.walmart.com/ip/15561620611",
      availability: "unknown",
      unitPriceCents: null,
      currency: "USD",
      sellerName: "Walmart",
      sellerType: "first_party",
      fulfillment: "unknown",
      addControlActionable: false,
      securityChallenge: false,
      interactiveBlock: ""
    }, NOW + 4_000);
    new AdapterDiagnosticRepository(db).record(device.id, {
      contractVersion: 1,
      observedAt: new Date(NOW + 4_500).toISOString(),
      retailerId: "walmart",
      retailerSku: "15561620611",
      adapterVersion: WALMART_OBSERVER_VERSION,
      operation: "observe",
      outcome: "failed",
      failureStage: "offer_binding",
      reasonCode: "offer_binding_missing",
      attemptCount: 1,
      domChanged: false,
      layout: {
        schemaVersion: 1,
        pageKind: "product",
        scopeKind: "none",
        sellerShape: "legacy",
        fulfillmentShape: "mixed",
        addControlCount: 2,
        genericAddIntentCount: 2,
        scopedControlCount: 0,
        explicitSkuInputCount: 0,
        exactSkuInputCount: 0,
        variationSkuCount: 0,
        canonicalOfferInputCount: 0,
        canonicalOfferDistinctCount: 0,
        alternateOfferInputCount: 0,
        alternateOfferDistinctCount: 0,
        priceCandidateCount: 50,
        quantityControlCount: 0,
        securityChallenge: false,
        interactiveBlock: ""
      }
    }, NOW + 5_000);
    db.run(
      "UPDATE retailer_adapter_diagnostics SET adapter_version = 'walmart-observer-v6' WHERE retailer_id = 'walmart' AND retailer_sku = '15561620611'"
    );

    const readiness = new RetailerReadinessRepository(db);
    const bestBuy = readiness.lane("bestbuy", NOW + 6_000);
    assert.deepEqual(bestBuy.candidates.map((candidate) => candidate.retailerSku), ["6688068", "6587244"],
      "the actionable preorder is preferred over an unobserved catalog candidate");
    assert.equal(bestBuy.candidate?.source, "evidence_history");
    assert.deepEqual(bestBuy.candidate?.qualificationTypes, ["first_party_actionable", "shipping_actionable"],
      "a first-party preorder with an exact shipping control supplies normal add qualification evidence");
    const walmart = readiness.lane("walmart", NOW + 6_000);
    assert.equal(walmart.candidate?.retailerSku, "15561620611");
    assert.equal(walmart.candidate?.repairableObserverFailure, true,
      "a prior-version failed layout remains available for bounded self-healing replay");
    assert.equal(walmart.automaticCheckNeeded, true);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("store requalification prioritizes unresolved products across distinct observed layouts", () => {
  const db = new YoinkDatabase();
  try {
    const device = pair(db);
    const shadows = new ShadowObservationRepository(db);
    const diagnostics = new AdapterDiagnosticRepository(db);
    const layout = (scopeKind: "none" | "buybox", addControlCount: number) => ({
      schemaVersion: 1 as const,
      pageKind: "product" as const,
      scopeKind,
      sellerShape: "legacy" as const,
      fulfillmentShape: "mixed" as const,
      addControlCount,
      genericAddIntentCount: addControlCount,
      scopedControlCount: scopeKind === "none" ? 0 : addControlCount,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      variationSkuCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      priceCandidateCount: 2,
      quantityControlCount: 0,
      securityChallenge: false,
      interactiveBlock: "" as const
    });
    const samples = [
      { retailerSku: "20895014480", scopeKind: "none" as const, addControlCount: 2, operation: "observe" as const },
      { retailerSku: "20252562938", scopeKind: "none" as const, addControlCount: 2, operation: "observe" as const },
      { retailerSku: "20145563530", scopeKind: "buybox" as const, addControlCount: 1, operation: "rehearse_add" as const }
    ];
    samples.forEach((sample, index) => {
      shadows.record(device.id, {
        adapterVersion: WALMART_OBSERVER_VERSION,
        contractVersion: 1,
        observedAt: new Date(NOW + 1_000 + index * 2_000).toISOString(),
        pageKind: "product",
        retailerId: "walmart",
        retailerSku: sample.retailerSku,
        canonicalUrl: `https://www.walmart.com/ip/${sample.retailerSku}`,
        availability: "unknown",
        unitPriceCents: null,
        currency: "USD",
        sellerName: "",
        sellerType: "unknown",
        fulfillment: "unknown",
        addControlActionable: false,
        securityChallenge: false,
        interactiveBlock: ""
      }, NOW + 2_000 + index * 2_000);
      diagnostics.record(device.id, {
        contractVersion: 1,
        observedAt: new Date(NOW + 2_500 + index * 2_000).toISOString(),
        retailerId: "walmart",
        retailerSku: sample.retailerSku,
        adapterVersion: sample.operation === "observe" ? WALMART_OBSERVER_VERSION : WALMART_ADD_ADAPTER_VERSION,
        operation: sample.operation,
        outcome: "failed",
        failureStage: "offer_binding",
        reasonCode: "offer_binding_missing",
        attemptCount: 1,
        domChanged: false,
        layout: layout(sample.scopeKind, sample.addControlCount)
      }, NOW + 3_000 + index * 2_000);
    });

    const candidates = new RetailerReadinessRepository(db).lane("walmart", NOW + 8_000).candidates;
    assert.equal(candidates.slice(0, 3).every((candidate) => candidate.repairableObserverFailure), true);
    assert.equal(candidates[0]?.layoutFingerprint === candidates[1]?.layoutFingerprint, false,
      "the first repair samples cover distinct observed page layouts");
    assert.equal(new Set(candidates.slice(0, 3).map((candidate) => candidate.retailerSku)).size, 3);
  } finally {
    db.close();
  }
});

test("readiness, privacy deletion, connectors, and restock aggregates stay bounded", () => {
  const db = new YoinkDatabase();
  try {
    seedListing(db);
    const device = pair(db);
    const readiness = new RetailerReadinessRepository(db).record(device.id, {
      contractVersion: 1,
      retailerId: "target",
      signedInState: "ready",
      cartBaselineState: "ready",
      baselineObservedAt: new Date(NOW + 100).toISOString(),
      expiresAt: new Date(NOW + 4 * 60_000).toISOString(),
      adapterVersion: TARGET_ADD_ADAPTER_VERSION
    }, NOW + 200);
    assert.equal(readiness.signedInState, "ready");
    const readyLane = new RetailerReadinessRepository(db).lane("target", NOW + 200);
    assert.equal(readyLane.checklist.find((item) => item.id === "signed_in")?.ready, true);
    assert.equal(readyLane.readyForWarmObservation, true);
    db.run(
      "UPDATE extension_devices SET last_seen_at = ? WHERE id = ?",
      new Date(NOW + 10 * 60_000).toISOString(), device.id
    );
    const staleSessionLane = new RetailerReadinessRepository(db).lane("target", NOW + 6 * 60_000);
    assert.equal(staleSessionLane.checklist.find((item) => item.id === "signed_in")?.ready, false);
    assert.equal(staleSessionLane.readyForWarmObservation, false);

    const privacy = new PrivacyComplianceRepository(db);
    privacy.record("privacy_policy", "viewed", "", NOW + 300);
    privacy.record("change_notice", "acknowledged", "", NOW + 400);
    const compliance = privacy.record("local_deletion", "deletion_completed", device.id, NOW + 500);
    assert.equal(compliance.policyViewed, true);
    assert.equal(compliance.changeAcknowledged, true);
    assert.equal(compliance.localDeletionVerified, true);

    const fingerprint = "a".repeat(64);
    const connectors = new UserActionConnectorRepository(db, { checkout_hook: fingerprint });
    const connector = connectors.save({
      contractVersion: 1,
      kind: "webhook",
      name: "Checkout handoff",
      endpointReference: "checkout_hook",
      events: ["notify", "carted", "needs_you", "missed", "test"]
    }, "", NOW + 600);
    assert.equal(connector.runtimeBound, true);
    const queued = connectors.queueTest(connector.id, NOW + 700);
    assert.equal(queued.state, "pending");
    const lease = connectors.leaseNext(NOW + 800);
    assert.equal(lease?.endpointReference, "checkout_hook");
    assert.equal(connectors.complete(lease!.id, lease!.capabilityToken, NOW + 900).state, "delivered");

    const channel = new DropWindowRepository(db).create({
      contractVersion: 1,
      kind: "queue_open",
      retailerId: "target",
      title: "Target queue",
      startsAt: new Date(NOW + 60_000).toISOString(),
      closesAt: new Date(NOW + 10 * 60_000).toISOString(),
      spreadSeconds: 0,
      confidenceBps: 5000,
      timezone: "UTC",
      products: [{ listingId: "listing_action_platform" }]
    }, NOW + 1_000);
    for (const [index, observedAt] of [
      "2026-08-28T10:00:00.000Z",
      "2026-08-29T10:15:00.000Z",
      "2026-08-30T10:05:00.000Z"
    ].entries()) {
      db.run(
        `INSERT INTO offer_observations(
          id, listing_id, source_connection_id, availability, currency,
          seller_name, seller_type, observed_at, created_at
        ) VALUES (?, 'listing_action_platform', ?, 'in_stock', 'USD', 'Target', 'first_party', ?, ?)`,
        `offer_pattern_${index}`,
        channel.sourceConnectionId,
        observedAt,
        observedAt
      );
    }
    const pattern = new RestockPatternRepository(db).recompute(
      "listing_action_platform",
      "America/Los_Angeles",
      NOW + 1_100
    );
    assert.equal(pattern.sampleCount, 3);
    assert.equal(pattern.histogram.reduce((sum, value) => sum + value, 0), 3);
    assert.ok(pattern.medianIntervalMinutes);
    assert.ok(pattern.confidenceBps > 0);

    const privacyExport = new UserPrivacyRepository(db).export(NOW + 1_200);
    const preferences = privacyExport.data.preferences as Record<string, unknown>;
    const sources = privacyExport.data.sources_and_signals as Record<string, unknown>;
    const devices = privacyExport.data.devices_and_retailer_evidence as Record<string, unknown>;
    assert.equal((preferences.action_connectors as unknown[]).length, 1);
    assert.equal((sources.drop_windows as unknown[]).length, 1);
    assert.equal((sources.restock_patterns as unknown[]).length, 1);
    assert.equal((devices.retailer_session_readiness as unknown[]).length, 1);
    const serializedExport = JSON.stringify(privacyExport);
    assert.equal(serializedExport.includes("capabilityToken"), false);
    assert.equal(serializedExport.includes("observation_capability_hash"), false);
    assert.equal(serializedExport.includes("payload_json"), false);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("order-confirmation observations require the exact device job binding and expose only bounded evidence", () => {
  const db = new YoinkDatabase();
  try {
    seedListing(db);
    const device = pair(db);
    const jobId = seedConfirmedActionJob(db, device.id);
    const confirmations = new OrderConfirmationRepository(db);
    const observed = confirmations.record(device.id, {
      contractVersion: 1,
      actionJobId: jobId,
      retailerId: "target",
      pageClass: "confirmation",
      observedAt: new Date(NOW + 1_000).toISOString()
    }, NOW + 2_000);
    assert.equal(observed.actionJobId, jobId);
    assert.equal(observed.retailerId, "target");
    assert.equal(observed.pageClass, "confirmation");
    assert.equal(observed.acknowledged, false);
    assert.equal(confirmations.list().length, 1);
    assert.throws(() => confirmations.record(device.id, {
      contractVersion: 1,
      actionJobId: jobId,
      retailerId: "walmart",
      pageClass: "confirmation",
      observedAt: new Date(NOW + 2_000).toISOString()
    }, NOW + 3_000), /not bound/i);
    assert.equal(confirmations.acknowledge(observed.id, NOW + 4_000).acknowledged, true);
    const stored = db.get<Record<string, unknown>>(
      "SELECT * FROM order_confirmation_observations WHERE id = ?",
      observed.id
    );
    assert.ok(stored?.evidence_hash);
    assert.equal("canonical_url" in (stored || {}), false);
    assert.equal("order_id" in (stored || {}), false);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});
