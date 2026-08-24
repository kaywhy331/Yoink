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
    const activated = repository.activateTargetAdd({
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      evidenceHash: ready.qualificationEvidenceHash,
      confirmation: TARGET_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000);
    assert.equal(activated.promotedJobs, 0);
    assert.equal(activated.readiness.addToCartQualified, true);
    assert.equal(activated.readiness.mutationAuthorized, true);
    assert.deepEqual(new ControlRepository(db).settings(), {
      actionsPaused: false,
      pauseReason: "",
      executionMode: "live",
      dedupeWindowSeconds: 300,
      affiliateMode: "prefer_fallback",
      taxBps: 1200,
      storeAllowancesCents: { target: 3000, walmart: 3000, amazon: 3000, bestbuy: 3000 }
    });
    assert.equal(repository.targetAddQualified(), true);
    const durable = JSON.stringify(db.all("SELECT * FROM audit_events"));
    assert.equal(durable.includes(device.token), false);
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
    assert.equal(repository.walmartAddQualified(), true);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'walmart'")?.execution_supported, 1);
    assert.deepEqual(new ControlRepository(db).settings(), {
      actionsPaused: true,
      pauseReason: "First-run safety pause",
      executionMode: "shadow",
      dedupeWindowSeconds: 300,
      affiliateMode: "prefer_fallback",
      taxBps: 1200,
      storeAllowancesCents: { target: 3000, walmart: 3000, amazon: 3000, bestbuy: 3000 }
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
    assert.equal(repository.amazonAddQualified(), true);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'amazon'")?.execution_supported, 1);
    assert.deepEqual(new ControlRepository(db).settings(), {
      actionsPaused: true,
      pauseReason: "First-run safety pause",
      executionMode: "shadow",
      dedupeWindowSeconds: 300,
      affiliateMode: "prefer_fallback",
      taxBps: 1200,
      storeAllowancesCents: { target: 3000, walmart: 3000, amazon: 3000, bestbuy: 3000 }
    });
  } finally {
    db.close();
  }
});

test("Best Buy activation requires two explicitly first-party selected-shipping observations and a no-click rehearsal", () => {
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
    shadows.record(device.id, {
      ...bestBuyObservation(new Date(NOW + 1_500).toISOString(), "6678193"),
      availability: "preorder"
    }, NOW + 1_750);
    const preorderOnly = shadows.bestBuyQualificationReadiness(NOW + 1_800);
    assert.equal(preorderOnly.checks.find((check) => check.id === "first_party_actionable")?.observed, 0);
    assert.equal(preorderOnly.checks.find((check) => check.id === "shipping_actionable")?.observed, 0);
    assert.equal(preorderOnly.liveEvidenceReady, false);
    const first = shadows.record(device.id, bestBuyObservation(new Date(NOW + 2_000).toISOString()), NOW + 3_000);
    shadows.record(device.id, bestBuyObservation(new Date(NOW + 4_000).toISOString(), "6588152"), NOW + 5_000);
    const repository = new QualificationRepository(db);
    const trial = repository.recordBestBuyAddRehearsal(device.id, {
      adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
      observerVersion: BESTBUY_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: first.id,
      observedAt: new Date(NOW + 6_000).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 7_000);
    assert.equal(trial.retailerId, "bestbuy");
    const ready = shadows.bestBuyQualificationReadiness(NOW + 8_000);
    assert.equal(ready.liveEvidenceReady, true);
    assert.equal(ready.rehearsalReady, true);
    assert.equal(ready.qualificationEvidenceReady, true);
    assert.equal(ready.addToCartQualified, false);
    const activated = repository.activateBestBuyAdd({
      adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
      evidenceHash: ready.qualificationEvidenceHash,
      confirmation: BESTBUY_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000);
    assert.equal(activated.readiness.addToCartQualified, true);
    assert.equal(activated.readiness.mutationAuthorized, false);
    assert.equal(repository.bestBuyAddQualified(), true);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'bestbuy'")?.execution_supported, 1);
    assert.equal(new ControlRepository(db).settings().actionsPaused, true);
  } finally {
    db.close();
  }
});
