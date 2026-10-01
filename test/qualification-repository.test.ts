import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_ADD_ACTIVATION_CONFIRMATION,
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  BESTBUY_ADD_ACTIVATION_CONFIRMATION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  TARGET_ADD_ACTIVATION_CONFIRMATION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  TARGET_SELECTOR_PACK_VERSION,
  WALMART_ADD_ACTIVATION_CONFIRMATION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  type TargetAddRehearsalInput,
  type AmazonShadowObservationInput,
  type BestBuyShadowObservationInput,
  type TargetShadowObservationInput,
  type WalmartShadowObservationInput
} from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { QualificationRepository } from "../packages/database/src/qualification-repository.js";
import { RetailerReadinessRepository } from "../packages/database/src/retailer-readiness-repository.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";

const NOW = new Date("2026-08-23T04:00:00.000Z").getTime();

function observation(observedAt: string): TargetShadowObservationInput {
  return {
    adapterVersion: TARGET_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt,
    pageKind: "product",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: "https://www.target.com/p/-/A-1011483414",
    availability: "in_stock",
    unitPriceCents: 5999,
    currency: "USD",
    sellerName: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: ""
  };
}

function walmartObservation(observedAt: string, retailerSku = "17354421975"): WalmartShadowObservationInput {
  return {
    adapterVersion: WALMART_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt,
    pageKind: "product",
    retailerId: "walmart",
    retailerSku,
    availability: "in_stock",
    unitPriceCents: 4499,
    currency: "USD",
    sellerName: "Walmart",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: ""
  };
}

function amazonObservation(observedAt: string, retailerSku = "B0GYTRYV7P"): AmazonShadowObservationInput {
  return {
    adapterVersion: AMAZON_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt,
    pageKind: "product",
    retailerId: "amazon",
    retailerSku,
    availability: "in_stock",
    unitPriceCents: 2186,
    currency: "USD",
    sellerName: "Amazon.com",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: "",
    purchaseRouteKind: "amazon_buy_now",
    purchaseRouteReady: true,
    routeReasonCode: "offer_route_verified"
  };
}

function bestBuyObservation(observedAt: string, retailerSku = "6588149"): BestBuyShadowObservationInput {
  return {
    adapterVersion: BESTBUY_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt,
    pageKind: "product",
    retailerId: "bestbuy",
    retailerSku,
    availability: "in_stock",
    unitPriceCents: 699,
    currency: "USD",
    sellerName: "Best Buy",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: ""
  };
}

test("a paired extension records one sanitized, idempotent no-click Target rehearsal", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({ pairingCode: code.code }, NOW + 1_000);
    const shadow = new ShadowObservationRepository(db).record(
      device.id,
      observation(new Date(NOW + 2_000).toISOString()),
      NOW + 3_000
    );
    const repository = new QualificationRepository(db);
    const input: TargetAddRehearsalInput & { cookie: string; pageText: string } = {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1 as const,
      shadowObservationId: shadow.id,
      observedAt: new Date(NOW + 4_000).toISOString(),
      outcome: "passed" as const,
      reasonCode: "verified",
      cookie: "DO_NOT_STORE",
      pageText: "DO_NOT_STORE"
    };
    const first = repository.recordTargetAddRehearsal(device.id, input, NOW + 5_000);
    const duplicate = repository.recordTargetAddRehearsal(device.id, input, NOW + 6_000);
    assert.equal(first.id, duplicate.id);
    assert.equal(first.outcome, "passed");
    assert.match(first.evidenceHash, /^[a-f0-9]{64}$/);
    assert.throws(() => repository.recordTargetAddRehearsal(device.id, {
      ...input,
      outcome: "rejected",
      reasonCode: "over_unit_cap"
    }, NOW + 7_000), /different.*result/);
    const durable = JSON.stringify({
      trials: db.all("SELECT * FROM retailer_adapter_trials"),
      audit: db.all("SELECT * FROM audit_events")
    });
    assert.equal(durable.includes("DO_NOT_STORE"), false);
    assert.equal(durable.includes(device.token), false);
    const readiness = new ShadowObservationRepository(db).targetQualificationReadiness(NOW + 8_000);
    assert.equal(readiness.rehearsalReady, true);
    assert.equal(readiness.liveEvidenceReady, false);
    assert.equal(readiness.qualificationEvidenceReady, false);
    assert.match(readiness.qualificationEvidenceHash, /^[a-f0-9]{64}$/);
  } finally {
    db.close();
  }
});

test("Target rehearsal receipts reject stale, unpaired, and non-actionable evidence", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({ pairingCode: code.code }, NOW + 1_000);
    const shadow = new ShadowObservationRepository(db).record(device.id, {
      ...observation(new Date(NOW + 2_000).toISOString()),
      availability: "out_of_stock",
      unitPriceCents: null,
      sellerName: "",
      sellerType: "unknown",
      fulfillment: "unknown",
      addControlActionable: false
    }, NOW + 3_000);
    const repository = new QualificationRepository(db);
    const input: TargetAddRehearsalInput = {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1 as const,
      shadowObservationId: shadow.id,
      observedAt: new Date(NOW + 4_000).toISOString(),
      outcome: "passed" as const,
      reasonCode: "verified"
    };
    assert.throws(() => repository.recordTargetAddRehearsal(device.id, input, NOW + 5_000), /actionable/);
    assert.throws(() => repository.recordTargetAddRehearsal("device_missing", input, NOW + 5_000), /unavailable/);
    assert.throws(() => repository.recordTargetAddRehearsal(device.id, {
      ...input,
      observedAt: new Date(NOW - 11 * 60_000).toISOString()
    }, NOW), /stale/);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_trials")?.count, 0);
  } finally {
    db.close();
  }
});

test("explicit activation requires two Target-sold shipping samples, one rehearsal, and a current capable companion", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({
      pairingCode: code.code,
      extensionVersion: "0.5.0",
      capabilities: {
        readiness: true,
        jobReconciliation: true,
        targetAddOnly: true,
        targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
      }
    }, NOW + 1_000);
    const shadows = new ShadowObservationRepository(db);
    const first = shadows.record(device.id, observation(new Date(NOW + 2_000).toISOString()), NOW + 3_000);
    shadows.record(device.id, {
      ...observation(new Date(NOW + 4_000).toISOString()),
      retailerSku: "202258620"
    }, NOW + 5_000);
    const repository = new QualificationRepository(db);
    repository.recordTargetAddRehearsal(device.id, {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: first.id,
      observedAt: new Date(NOW + 6_000).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 7_000);
    const ready = shadows.targetQualificationReadiness(NOW + 8_000);
    assert.equal(ready.liveEvidenceReady, true);
    assert.equal(ready.qualificationEvidenceReady, true);
    assert.equal(ready.checks.find((check) => check.id === "named_marketplace_actionable")?.met, false);
    assert.equal(ready.checks.find((check) => check.id === "named_marketplace_actionable")?.requiredForQualification, false);
    assert.throws(() => repository.activateTargetAdd({
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      evidenceHash: "0".repeat(64),
      confirmation: TARGET_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000), /changed or is incomplete/);
    const catalogTimestamp = new Date(NOW).toISOString();
    db.run(
      "INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
      "family_target_activation_test",
      "Target activation fixture",
      catalogTimestamp,
      catalogTimestamp
    );
    db.run(
      "INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)",
      "variant_target_activation_test",
      "family_target_activation_test",
      "Target activation fixture",
      catalogTimestamp,
      catalogTimestamp
    );
    db.run(
      `INSERT INTO listings(
         id, variant_id, retailer_id, retailer_sku, canonical_url, status,
         execution_supported, currency, created_at, updated_at
       ) VALUES (?, ?, 'target', ?, ?, 'active', 0, 'USD', ?, ?)`,
      "listing_target_activation_test",
      "variant_target_activation_test",
      "1011483414",
      "https://www.target.com/p/-/A-1011483414",
      catalogTimestamp,
      catalogTimestamp
    );
    const activated = repository.activateTargetAdd({
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      evidenceHash: ready.qualificationEvidenceHash,
      confirmation: TARGET_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000);
    assert.equal(activated.promotedJobs, 0);
    assert.equal(activated.readiness.addToCartQualified, true);
    assert.equal(activated.readiness.mutationAuthorized, false);
    assert.equal(db.get<{ execution_supported: number }>(
      "SELECT execution_supported FROM retailers WHERE id = 'target'"
    )?.execution_supported, 1);
    assert.equal(db.get<{ execution_supported: number }>(
      "SELECT execution_supported FROM listings WHERE id = 'listing_target_activation_test'"
    )?.execution_supported, 1);
    assert.deepEqual(new ControlRepository(db).settings(), {
      actionsPaused: true,
      pauseReason: "First-run safety pause",
      executionMode: "live",
      dedupeWindowSeconds: 300,
      affiliateMode: "prefer_fallback",
      taxBps: 1200,
      storeAllowancesCents: { target: 3000, walmart: 3000, amazon: 3000, bestbuy: 3000 },
      plansFromCalls: false
    });
    assert.equal(repository.targetAddQualified(NOW + 10_000), true);
    db.run("UPDATE retailer_adapter_trials SET pack_version = 'target-pack-v0'");
    const packPending = new RetailerReadinessRepository(db).lane("target", NOW + 10_500);
    assert.equal(packPending.qualification.warning, "pack_unverified");
    assert.equal(packPending.readyForGuardedAdd, false);
    assert.equal(packPending.automaticCheckNeeded, true);
    assert.equal(db.get<{ status: string }>(
      "SELECT status FROM retailer_adapter_qualifications WHERE retailer_id = 'target'"
    )?.status, "qualified", "a pack-only change never retires the qualification row");
    const packCheck = shadows.record(device.id, {
      ...observation(new Date(NOW + 11_000).toISOString()),
      retailerSku: "202258620",
      canonicalUrl: "https://www.target.com/p/-/A-202258620"
    }, NOW + 12_000);
    repository.recordTargetAddRehearsal(device.id, {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      packVersion: TARGET_SELECTOR_PACK_VERSION,
      contractVersion: 1,
      shadowObservationId: packCheck.id,
      observedAt: new Date(NOW + 13_000).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 14_000);
    const packVerified = new RetailerReadinessRepository(db).lane("target", NOW + 15_000);
    assert.equal(packVerified.qualification.warning, "none");
    assert.equal(packVerified.expectedPackVersion, TARGET_SELECTOR_PACK_VERSION);
    assert.equal(repository.targetAddQualified(NOW + 15_000), true);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'retailer_adapter_pack_verified'"
    )?.count, 2);
    const qualificationExpiresAt = new Date(activated.readiness.qualification?.expiresAt ?? "").getTime();
    assert.equal(Number.isFinite(qualificationExpiresAt), true);
    const expiring = shadows.targetQualificationReadiness(qualificationExpiresAt - 6 * 24 * 60 * 60_000);
    assert.equal(expiring.addToCartQualified, true);
    assert.equal(expiring.qualification?.warning, "expiring");
    const expired = shadows.targetQualificationReadiness(qualificationExpiresAt);
    assert.equal(expired.addToCartQualified, false);
    assert.equal(expired.mutationAuthorized, false);
    assert.equal(expired.qualification?.warning, "expired");
    assert.match(expired.nextStep, /qualification expired/i);
    assert.equal(repository.targetAddQualified(qualificationExpiresAt), false);
    const durable = JSON.stringify(db.all("SELECT * FROM audit_events"));
    assert.equal(durable.includes(device.token), false);
  } finally {
    db.close();
  }
});

test("fresh checks renew a previously authorized lane without unpausing actions and honor manual retirement", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({
      pairingCode: code.code,
      extensionVersion: "1.19.3",
      capabilities: {
        readiness: true,
        jobReconciliation: true,
        targetAddOnly: true,
        targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
      }
    }, NOW + 1_000);
    const shadows = new ShadowObservationRepository(db);
    const first = shadows.record(device.id, observation(new Date(NOW + 2_000).toISOString()), NOW + 3_000);
    shadows.record(device.id, {
      ...observation(new Date(NOW + 4_000).toISOString()),
      retailerSku: "202258620"
    }, NOW + 5_000);
    const repository = new QualificationRepository(db);
    repository.recordTargetAddRehearsal(device.id, {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: first.id,
      observedAt: new Date(NOW + 6_000).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 7_000);
    const ready = shadows.targetQualificationReadiness(NOW + 8_000);
    repository.activateTargetAdd({
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      evidenceHash: ready.qualificationEvidenceHash,
      confirmation: TARGET_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000);

    db.run(
      `UPDATE retailer_adapter_qualifications
       SET status = 'retired', adapter_version = 'target-add-v6'
       WHERE retailer_id = 'target'`
    );
    db.run("UPDATE retailers SET execution_supported = 0 WHERE id = 'target'");
    db.run("UPDATE listings SET execution_supported = 0 WHERE retailer_id = 'target'");
    const renewal = repository.renewPreviouslyQualified("target", device.id, NOW + 10_000);
    assert.equal(renewal.renewed, true);
    assert.equal(repository.targetAddQualified(NOW + 10_001), true);
    assert.equal(db.get<{ executionSupported: number }>(
      "SELECT execution_supported AS executionSupported FROM retailers WHERE id = 'target'"
    )?.executionSupported, 1);
    assert.equal(new ControlRepository(db).settings().actionsPaused, true);

    new RetailerReadinessRepository(db).retireLane("target", "operator_retired", NOW + 11_000);
    const blocked = repository.renewPreviouslyQualified("target", device.id, NOW + 12_000);
    assert.deepEqual(blocked, {
      retailerId: "target",
      renewed: false,
      reasonCode: "lane_manually_retired",
      promotedJobs: 0
    });
    assert.equal(repository.targetAddQualified(NOW + 12_001), false);
  } finally {
    db.close();
  }
});

test("Walmart activation is independent, evidence-bound, and preserves the global pause", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({
      pairingCode: code.code,
      extensionVersion: "0.8.2",
      capabilities: {
        readiness: true,
        jobReconciliation: true,
        walmartAddOnly: true,
        walmartAddAdapterVersion: WALMART_ADD_ADAPTER_VERSION
      }
    }, NOW + 1_000);
    const shadows = new ShadowObservationRepository(db);
    const first = shadows.record(device.id, walmartObservation(new Date(NOW + 2_000).toISOString()), NOW + 3_000);
    shadows.record(device.id, walmartObservation(new Date(NOW + 4_000).toISOString(), "98765432101"), NOW + 5_000);
    const repository = new QualificationRepository(db);
    const trial = repository.recordWalmartAddRehearsal(device.id, {
      adapterVersion: WALMART_ADD_ADAPTER_VERSION,
      observerVersion: WALMART_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: first.id,
      observedAt: new Date(NOW + 6_000).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 7_000);
    assert.equal(trial.retailerId, "walmart");
    assert.match(trial.evidenceHash, /^[a-f0-9]{64}$/);
    const ready = shadows.walmartQualificationReadiness(NOW + 8_000);
    assert.equal(ready.liveEvidenceReady, true);
    assert.equal(ready.rehearsalReady, true);
    assert.equal(ready.qualificationEvidenceReady, true);
    assert.equal(ready.addToCartQualified, false);
    assert.throws(() => repository.activateWalmartAdd({
      adapterVersion: WALMART_ADD_ADAPTER_VERSION,
      evidenceHash: "0".repeat(64),
      confirmation: WALMART_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000), /changed or is incomplete/);
    const activated = repository.activateWalmartAdd({
      adapterVersion: WALMART_ADD_ADAPTER_VERSION,
      evidenceHash: ready.qualificationEvidenceHash,
      confirmation: WALMART_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000);
    assert.equal(activated.readiness.addToCartQualified, true);
    assert.equal(activated.readiness.mutationAuthorized, false);
    assert.equal(repository.walmartAddQualified(NOW + 10_000), true);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'walmart'")?.execution_supported, 1);
    assert.deepEqual(new ControlRepository(db).settings(), {
      actionsPaused: true,
      pauseReason: "First-run safety pause",
      executionMode: "shadow",
      dedupeWindowSeconds: 300,
      affiliateMode: "prefer_fallback",
      taxBps: 1200,
      storeAllowancesCents: { target: 3000, walmart: 3000, amazon: 3000, bestbuy: 3000 },
      plansFromCalls: false
    });
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    assert.equal(shadows.walmartQualificationReadiness(NOW + 10_000).mutationAuthorized, true);
    assert.equal(JSON.stringify(db.all("SELECT * FROM audit_events")).includes(device.token), false);
  } finally {
    db.close();
  }
});

test("Amazon activation requires exact ephemeral-route evidence and preserves the global pause", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({
      pairingCode: code.code,
      extensionVersion: "0.11.0",
      capabilities: {
        readiness: true,
        jobReconciliation: true,
        amazonAddOnly: true,
        amazonAddAdapterVersion: AMAZON_ADD_ADAPTER_VERSION
      }
    }, NOW + 1_000);
    const shadows = new ShadowObservationRepository(db);
    const first = shadows.record(device.id, amazonObservation(new Date(NOW + 2_000).toISOString()), NOW + 3_000);
    shadows.record(device.id, amazonObservation(new Date(NOW + 4_000).toISOString(), "B0SECOND01"), NOW + 5_000);
    const repository = new QualificationRepository(db);
    const trial = repository.recordAmazonAddRehearsal(device.id, {
      adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
      observerVersion: AMAZON_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: first.id,
      observedAt: new Date(NOW + 6_000).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 7_000);
    assert.equal(trial.retailerId, "amazon");
    assert.match(trial.evidenceHash, /^[a-f0-9]{64}$/);
    const ready = shadows.amazonQualificationReadiness(NOW + 8_000);
    assert.equal(ready.liveEvidenceReady, true);
    assert.equal(ready.rehearsalReady, true);
    assert.equal(ready.qualificationEvidenceReady, true);
    assert.equal(ready.checks.find((check) => check.id === "offer_route_ready")?.met, true);
    assert.equal(ready.addToCartQualified, false);
    assert.throws(() => repository.activateAmazonAdd({
      adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
      evidenceHash: "0".repeat(64),
      confirmation: AMAZON_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000), /changed or is incomplete/);
    const activated = repository.activateAmazonAdd({
      adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
      evidenceHash: ready.qualificationEvidenceHash,
      confirmation: AMAZON_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000);
    assert.equal(activated.readiness.addToCartQualified, true);
    assert.equal(activated.readiness.mutationAuthorized, false);
    assert.equal(repository.amazonAddQualified(NOW + 10_000), true);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'amazon'")?.execution_supported, 1);
    assert.deepEqual(new ControlRepository(db).settings(), {
      actionsPaused: true,
      pauseReason: "First-run safety pause",
      executionMode: "shadow",
      dedupeWindowSeconds: 300,
      affiliateMode: "prefer_fallback",
      taxBps: 1200,
      storeAllowancesCents: { target: 3000, walmart: 3000, amazon: 3000, bestbuy: 3000 },
      plansFromCalls: false
    });
  } finally {
    db.close();
  }
});

test("Best Buy activation accepts an actionable preorder as first-party shipping evidence", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({
      pairingCode: code.code,
      extensionVersion: "0.11.0",
      capabilities: {
        readiness: true,
        jobReconciliation: true,
        bestBuyAddOnly: true,
        bestBuyAddAdapterVersion: BESTBUY_ADD_ADAPTER_VERSION
      }
    }, NOW + 1_000);
    const shadows = new ShadowObservationRepository(db);
    const preorder = shadows.record(device.id, {
      ...bestBuyObservation(new Date(NOW + 1_500).toISOString(), "6678193"),
      availability: "preorder"
    }, NOW + 1_750);
    const preorderOnly = shadows.bestBuyQualificationReadiness(NOW + 1_800);
    assert.equal(preorderOnly.checks.find((check) => check.id === "first_party_actionable")?.observed, 1);
    assert.equal(preorderOnly.checks.find((check) => check.id === "shipping_actionable")?.observed, 1);
    assert.equal(preorderOnly.liveEvidenceReady, false);
    shadows.record(device.id, bestBuyObservation(new Date(NOW + 2_000).toISOString(), "6588152"), NOW + 3_000);
    const repository = new QualificationRepository(db);
    const trial = repository.recordBestBuyAddRehearsal(device.id, {
      adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
      observerVersion: BESTBUY_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: preorder.id,
      observedAt: new Date(NOW + 4_000).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 5_000);
    assert.equal(trial.retailerId, "bestbuy");
    const ready = shadows.bestBuyQualificationReadiness(NOW + 6_000);
    assert.equal(ready.liveEvidenceReady, true);
    assert.equal(ready.rehearsalReady, true);
    assert.equal(ready.qualificationEvidenceReady, true);
    assert.equal(ready.addToCartQualified, false);
    const activated = repository.activateBestBuyAdd({
      adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
      evidenceHash: ready.qualificationEvidenceHash,
      confirmation: BESTBUY_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 7_000);
    assert.equal(activated.readiness.addToCartQualified, true);
    assert.equal(activated.readiness.mutationAuthorized, false);
    assert.equal(repository.bestBuyAddQualified(NOW + 8_000), true);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'bestbuy'")?.execution_supported, 1);
    assert.equal(new ControlRepository(db).settings().actionsPaused, true);
  } finally {
    db.close();
  }
});

test("a legacy suspended lane renews after fresh passing evidence like any other previously authorized lane", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({
      pairingCode: code.code,
      extensionVersion: "1.19.5",
      capabilities: {
        readiness: true,
        jobReconciliation: true,
        targetAddOnly: true,
        targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
      }
    }, NOW + 1_000);
    const shadows = new ShadowObservationRepository(db);
    const first = shadows.record(device.id, observation(new Date(NOW + 2_000).toISOString()), NOW + 3_000);
    shadows.record(device.id, {
      ...observation(new Date(NOW + 4_000).toISOString()),
      retailerSku: "202258620"
    }, NOW + 5_000);
    const repository = new QualificationRepository(db);
    repository.recordTargetAddRehearsal(device.id, {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: first.id,
      observedAt: new Date(NOW + 6_000).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 7_000);
    repository.activateTargetAdd({
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      evidenceHash: shadows.targetQualificationReadiness(NOW + 8_000).qualificationEvidenceHash,
      confirmation: TARGET_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000);
    db.run("UPDATE retailer_adapter_qualifications SET status = 'suspended' WHERE retailer_id = 'target'");
    assert.equal(repository.targetAddQualified(NOW + 9_500), false);
    const blockedLane = new RetailerReadinessRepository(db).lane("target", NOW + 9_500);
    assert.equal(blockedLane.qualification.status, "suspended");
    assert.equal(blockedLane.blockedReason, "no_purchasable_candidate", "without a purchasable product the refresh cannot run");
    const catalogTimestamp = new Date(NOW).toISOString();
    db.run(
      "INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES ('family_suspended', 'Suspended fixture', '', ?, ?)",
      catalogTimestamp,
      catalogTimestamp
    );
    db.run(
      "INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES ('variant_suspended', 'family_suspended', 'Suspended fixture', '{}', ?, ?)",
      catalogTimestamp,
      catalogTimestamp
    );
    db.run(
      `INSERT INTO listings(
         id, variant_id, retailer_id, retailer_sku, canonical_url, status,
         execution_supported, currency, created_at, updated_at
       ) VALUES ('listing_suspended', 'variant_suspended', 'target', '1011483414', 'https://www.target.com/p/-/A-1011483414', 'in_stock', 0, 'USD', ?, ?)`,
      catalogTimestamp,
      catalogTimestamp
    );
    const lane = new RetailerReadinessRepository(db).lane("target", NOW + 9_500);
    assert.equal(lane.blockedReason, "");
    assert.equal(lane.automaticCheckNeeded, true, "a suspended lane is a previously authorized lane that needs a refresh");
    const renewal = repository.renewPreviouslyQualified("target", device.id, NOW + 10_000);
    assert.equal(renewal.renewed, true);
    assert.equal(repository.targetAddQualified(NOW + 10_001), true);
  } finally {
    db.close();
  }
});
