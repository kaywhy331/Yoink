import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  type SignalEventInput,
  type StrategyDefinition
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

const NOW = new Date("2026-08-22T21:00:00.000Z").getTime();

function strategy(): StrategyDefinition {
  return {
    id: "strategy_execution_contract",
    name: "Execution contract test",
    enabled: true,
    position: 1,
    revision: 1,
    sources: ["trackalacker"],
    retailers: ["amazon"],
    pricePolicy: { kind: "at_or_below_msrp" },
    sellerPolicy: "first_party_only",
    allowedSellers: [],
    includeKeywords: "",
    excludeKeywords: "",
    action: "submit_order",
    quantity: 1,
    fulfillment: "shipping",
    maxSignalAgeSeconds: 120
  };
}

function signal(): SignalEventInput {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: "execution-event-1",
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: "execution-product-1",
      sourceListingId: "execution-listing-1",
      retailerId: "amazon",
      retailerSku: "B0EXE00001",
      canonicalUrl: "https://www.amazon.com/dp/B0EXE00001",
      title: "Execution Contract Product"
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 5000,
      currency: "USD",
      sellerName: "Amazon.com",
      sellerType: "first_party",
      orderLimit: 1,
      fulfillment: "shipping"
    },
    parserVersion: "execution-test-v1"
  };
}

function targetStrategy(): StrategyDefinition {
  return {
    ...strategy(),
    id: "strategy_target_add_contract",
    name: "Target add-only contract test",
    retailers: ["target"],
    action: "add_to_cart",
    quantity: 1
  };
}

function targetSignal(externalEventId = "target-execution-event-1"): SignalEventInput {
  return {
    ...signal(),
    externalEventId,
    identity: {
      sourceProductId: "target-execution-product-1",
      sourceListingId: "target-execution-listing-1",
      retailerId: "target",
      retailerSku: "1011483414",
      canonicalUrl: "https://www.target.com/p/-/A-1011483414",
      title: "Target Execution Contract Product"
    },
    offer: {
      ...signal().offer,
      sellerName: "Target",
      sellerType: "first_party"
    }
  };
}

function qualifyAddLane(db: YoinkDatabase, retailerId: string, adapterVersion: string): void {
  db.run(
    `INSERT INTO retailer_adapter_qualifications(
       tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
       evidence_hash, qualified_at, updated_at
     ) VALUES (?, ?, ?, ?, 'add_to_cart', 'qualified', ?, ?, ?)`,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    retailerId,
    adapterVersion,
    `${retailerId}-add-test-evidence`,
    new Date(NOW).toISOString(),
    new Date(NOW).toISOString()
  );
}

function targetExecution(db: YoinkDatabase, directPlan = false): { execution: ExecutionRepository; deviceId: string; token: string } {
  const listing = new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "target-execution-product-1",
    sourceListingId: "target-execution-listing-1",
    title: "Target Execution Contract Product",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: "https://www.target.com/p/-/A-1011483414",
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 5999,
    currency: "USD"
  }, NOW);
  const control = new ControlRepository(db);
  if (directPlan) {
    control.createConfiguredMission({
      contractVersion: 1,
      listingId: listing.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5999,
      maxAllInCents: 10_000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, NOW);
    control.replaceStrategies([], NOW);
  } else {
    control.replaceStrategies([targetStrategy()]);
  }
  qualifyAddLane(db, "target", TARGET_ADD_ADAPTER_VERSION);
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
  const processed = new SignalEngine(db).process(targetSignal(directPlan ? "target-direct-execution-event-1" : undefined), NOW);
  assert.equal(processed.actionJobState, "awaiting_executor");
  if (directPlan) {
    assert.equal(db.get<{ decision_source: string }>(
      "SELECT decision_source FROM action_jobs WHERE id = ?",
      processed.actionJobId
    )?.decision_source, "purchase_intent");
  }
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  const paired = devices.pair({
    pairingCode: code.code,
    capabilities: {
      readiness: true,
      jobReconciliation: true,
      targetAddOnly: true,
      targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
    }
  }, NOW + 1_000);
  return { execution: new ExecutionRepository(db), deviceId: paired.id, token: paired.token };
}

function walmartExecution(db: YoinkDatabase): { execution: ExecutionRepository; deviceId: string } {
  db.run("UPDATE retailers SET execution_supported = 1 WHERE id = 'walmart'");
  new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "walmart-execution-product-1",
    sourceListingId: "walmart-execution-listing-1",
    title: "Walmart Execution Contract Product",
    retailerId: "walmart",
    retailerSku: "17354421975",
    canonicalUrl: "https://www.walmart.com/ip/17354421975",
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 5999,
    currency: "USD"
  }, NOW);
  new ControlRepository(db).replaceStrategies([{
    ...targetStrategy(),
    id: "strategy_walmart_add_contract",
    name: "Walmart add-only contract test",
    retailers: ["walmart"]
  }]);
  qualifyAddLane(db, "walmart", WALMART_ADD_ADAPTER_VERSION);
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
  const processed = new SignalEngine(db).process({
    ...targetSignal("walmart-execution-event-1"),
    identity: {
      sourceProductId: "walmart-execution-product-1",
      sourceListingId: "walmart-execution-listing-1",
      retailerId: "walmart",
      retailerSku: "17354421975",
      canonicalUrl: "https://www.walmart.com/ip/17354421975",
      title: "Walmart Execution Contract Product"
    },
    offer: {
      ...targetSignal().offer,
      sellerName: "Walmart"
    }
  }, NOW);
  assert.equal(processed.actionJobState, "awaiting_executor");
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  const paired = devices.pair({
    pairingCode: code.code,
    capabilities: {
      readiness: true,
      jobReconciliation: true,
      walmartAddOnly: true,
      walmartAddAdapterVersion: WALMART_ADD_ADAPTER_VERSION
    }
  }, NOW + 1_000);
  return { execution: new ExecutionRepository(db), deviceId: paired.id };
}

function amazonExecution(db: YoinkDatabase): { execution: ExecutionRepository; deviceId: string } {
  const asin = "B0AMZN0001";
  db.run("UPDATE retailers SET execution_supported = 1 WHERE id = 'amazon'");
  new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "amazon-add-execution-product-1",
    sourceListingId: "amazon-add-execution-listing-1",
    title: "Amazon Add Contract Product",
    retailerId: "amazon",
    retailerSku: asin,
    canonicalUrl: `https://www.amazon.com/dp/${asin}`,
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 5999,
    currency: "USD"
  }, NOW);
  new ControlRepository(db).replaceStrategies([{
    ...targetStrategy(),
    id: "strategy_amazon_add_contract",
    name: "Amazon add-only contract test",
    retailers: ["amazon"]
  }]);
  qualifyAddLane(db, "amazon", AMAZON_ADD_ADAPTER_VERSION);
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
  const processed = new SignalEngine(db).process({
    ...targetSignal("amazon-add-execution-event-1"),
    identity: {
      sourceProductId: "amazon-add-execution-product-1",
      sourceListingId: "amazon-add-execution-listing-1",
      retailerId: "amazon",
      retailerSku: asin,
      canonicalUrl: `https://www.amazon.com/dp/${asin}`,
      title: "Amazon Add Contract Product"
    },
    offer: {
      ...targetSignal().offer,
      sellerName: "Amazon.com"
    }
  }, NOW);
  assert.equal(processed.actionJobState, "awaiting_executor");
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  const paired = devices.pair({
    pairingCode: code.code,
    capabilities: {
      readiness: true,
      jobReconciliation: true,
      amazonAddOnly: true,
      amazonAddAdapterVersion: AMAZON_ADD_ADAPTER_VERSION
    }
  }, NOW + 1_000);
  return { execution: new ExecutionRepository(db), deviceId: paired.id };
}

function bestBuyExecution(db: YoinkDatabase): { execution: ExecutionRepository; deviceId: string } {
  const sku = "6588149";
  const canonicalUrl = `https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/${sku}`;
  db.run("UPDATE retailers SET execution_supported = 1 WHERE id = 'bestbuy'");
  new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "bestbuy-add-execution-product-1",
    sourceListingId: "bestbuy-add-execution-listing-1",
    title: "Best Buy Add Contract Product",
    retailerId: "bestbuy",
    retailerSku: sku,
    canonicalUrl,
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 699,
    currency: "USD"
  }, NOW);
  new ControlRepository(db).replaceStrategies([{
    ...targetStrategy(),
    id: "strategy_bestbuy_add_contract",
    name: "Best Buy add-only contract test",
    retailers: ["bestbuy"]
  }]);
  qualifyAddLane(db, "bestbuy", BESTBUY_ADD_ADAPTER_VERSION);
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
  const processed = new SignalEngine(db).process({
    ...targetSignal("bestbuy-add-execution-event-1"),
    identity: {
      sourceProductId: "bestbuy-add-execution-product-1",
      sourceListingId: "bestbuy-add-execution-listing-1",
      retailerId: "bestbuy",
      retailerSku: sku,
      canonicalUrl,
      title: "Best Buy Add Contract Product"
    },
    offer: {
      ...targetSignal().offer,
      unitPriceCents: 699,
      sellerName: "Best Buy"
    }
  }, NOW);
  assert.equal(processed.actionJobState, "awaiting_executor");
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  const paired = devices.pair({
    pairingCode: code.code,
    capabilities: {
      readiness: true,
      jobReconciliation: true,
      bestBuyAddOnly: true,
      bestBuyAddAdapterVersion: BESTBUY_ADD_ADAPTER_VERSION
    }
  }, NOW + 1_000);
  return { execution: new ExecutionRepository(db), deviceId: paired.id };
}

test("a generic retailer-mutation flag cannot authorize an ungoverned lane", () => {
  const db = new YoinkDatabase();
  try {
    db.run("UPDATE retailers SET execution_supported = 1 WHERE id = 'amazon'");
    new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "execution-product-1",
      sourceListingId: "execution-listing-1",
      title: "Execution Contract Product",
      retailerId: "amazon",
      retailerSku: "B0EXE00001",
      canonicalUrl: "https://www.amazon.com/dp/B0EXE00001",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 5999,
      currency: "USD"
    }, NOW);
    new ControlRepository(db).replaceStrategies([strategy()]);
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const processed = new SignalEngine(db).process(signal(), NOW);
    assert.equal(processed.actionJobState, "notify_only");
    assert.equal(processed.decision, "intent_action_ceiling");

    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const paired = devices.pair({
      pairingCode: code.code,
      capabilities: { readiness: true, jobReconciliation: true, retailerMutation: false }
    }, NOW);
    const execution = new ExecutionRepository(db);
    assert.deepEqual(execution.leaseNextJob(paired.id, NOW + 1_000), { job: null, reason: "device_unavailable" });

    db.run(
      "UPDATE extension_devices SET capabilities_json = ? WHERE id = ?",
      JSON.stringify({ readiness: true, jobReconciliation: true, retailerMutation: true, platform: "qualified-test" }),
      paired.id
    );
    assert.deepEqual(execution.leaseNextJob(paired.id, NOW + 2_000), { job: null, reason: "device_unavailable" });

    db.run(
      `INSERT INTO retailer_adapter_qualifications(
         tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
         evidence_hash, qualified_at, updated_at
       ) VALUES (?, ?, 'amazon', 'test-v1', 'add_to_cart', 'qualified', 'test-evidence', ?, ?)`,
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString()
    );
    assert.deepEqual(execution.leaseNextJob(paired.id, NOW + 3_000), { job: null, reason: "device_unavailable" });

    db.run("UPDATE retailer_adapter_qualifications SET highest_action = 'submit_order' WHERE retailer_id = 'amazon'");
    assert.deepEqual(execution.leaseNextJob(paired.id, NOW + 4_000), { job: null, reason: "device_unavailable" });
  } finally {
    db.close();
  }
});

test("Walmart add-only leasing is adapter-bound, single-device, and recovery-locked after Add", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = walmartExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    assert.equal(lease.job.adapterVersion, WALMART_ADD_ADAPTER_VERSION);
    assert.equal(lease.job.retailerId, "walmart");
    assert.equal(lease.job.retailerSku, "17354421975");
    assert.equal(lease.job.action, "add_to_cart");
    assert.equal(lease.job.quantity, 1);
    assert.deepEqual(execution.leaseNextJob(deviceId, NOW + 3_000), { job: null, reason: "device_busy" });
    for (const [index, state] of ["navigating", "verifying_listing", "offer_verified", "add_authorized", "adding"].entries()) {
      execution.reconcileJob(
        deviceId,
        lease.job.id,
        lease.job.capabilityToken,
        state as "navigating" | "verifying_listing" | "offer_verified" | "add_authorized" | "adding",
        `fixture_${state}`,
        `Fixture ${state}.`,
        { retailerId: "walmart", retailerSku: "17354421975" },
        NOW + 4_000 + index * 1_000
      );
    }
    assert.equal(execution.recoverExpiredLeases(NOW + 60_000), 1);
    assert.equal(db.get<{ state: string }>("SELECT state FROM action_jobs WHERE id = ?", lease.job.id)?.state, "manual_review");
    assert.deepEqual(execution.leaseNextJob(deviceId, NOW + 61_000), { job: null, reason: "no_jobs" });
  } finally {
    db.close();
  }
});

test("Amazon add-only leasing requires the exact adapter and sanitizes ASIN evidence", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = amazonExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    assert.equal(lease.job.adapterVersion, AMAZON_ADD_ADAPTER_VERSION);
    assert.equal(lease.job.retailerId, "amazon");
    assert.equal(lease.job.retailerSku, "B0AMZN0001");
    const navigating = execution.reconcileJob(
      deviceId,
      lease.job.id,
      lease.job.capabilityToken,
      "navigating",
      "navigation_started",
      "Navigation started.",
      { retailerId: "amazon", retailerSku: "B0AMZN0001", offerListingId: "DO_NOT_STORE" },
      NOW + 3_000
    );
    assert.equal(navigating.state, "navigating");
    assert.equal(JSON.stringify(db.all("SELECT data_json FROM audit_events")).includes("DO_NOT_STORE"), false);
  } finally {
    db.close();
  }
});

test("Best Buy add-only leasing requires the exact independently qualified capability", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = bestBuyExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    assert.equal(lease.job.adapterVersion, BESTBUY_ADD_ADAPTER_VERSION);
    assert.equal(lease.job.retailerId, "bestbuy");
    assert.equal(lease.job.retailerSku, "6588149");
    assert.equal(lease.job.quantity, 1);
  } finally {
    db.close();
  }
});

test("a reviewed direct Target plan leases through the same guarded execution contract", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db, true);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    assert.equal(lease.job.adapterVersion, TARGET_ADD_ADAPTER_VERSION);
    assert.equal(lease.job.retailerId, "target");
    assert.equal(lease.job.retailerSku, "1011483414");
    assert.equal(lease.job.action, "add_to_cart");
    assert.equal(lease.job.quantity, 1);
  } finally {
    db.close();
  }
});

test("Target add-only leasing binds the exact adapter and expires safely before mutation", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    assert.equal(lease.job.adapterVersion, TARGET_ADD_ADAPTER_VERSION);
    assert.equal(lease.job.action, "add_to_cart");
    assert.equal(lease.job.quantity, 1);
    assert.deepEqual(execution.leaseNextJob(deviceId, NOW + 3_000), { job: null, reason: "device_busy" });
    assert.equal(execution.reconcileJob(
      deviceId, lease.job.id, lease.job.capabilityToken, "navigating",
      "navigation_started", "Navigation started.", {}, NOW + 4_000
    ).state, "navigating");
    assert.equal(execution.recoverExpiredLeases(NOW + 50_000), 1);
    assert.equal(db.get<{ state: string }>("SELECT state FROM action_jobs WHERE id = ?", lease.job.id)?.state, "expired");
    assert.deepEqual(execution.leaseNextJob(deviceId, NOW + 51_000), { job: null, reason: "no_jobs" });
  } finally {
    db.close();
  }
});

test("an expired Target lease after the add boundary locks instead of clicking twice", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    const transitions = [
      "navigating",
      "verifying_listing",
      "offer_verified",
      "add_authorized",
      "adding"
    ] as const;
    transitions.forEach((nextState, index) => {
      assert.equal(execution.reconcileJob(
        deviceId,
        lease.job.id,
        lease.job.capabilityToken,
        nextState,
        `fixture_${nextState}`,
        `Fixture ${nextState}.`,
        {},
        NOW + 3_000 + index * 1_000
      ).state, nextState);
    });
    assert.equal(execution.recoverExpiredLeases(NOW + 60_000), 1);
    assert.equal(db.get<{ state: string }>("SELECT state FROM action_jobs WHERE id = ?", lease.job.id)?.state, "manual_review");
    assert.deepEqual(execution.leaseNextJob(deviceId, NOW + 61_000), { job: null, reason: "no_jobs" });
    assert.throws(() => execution.reconcileJob(
      deviceId, lease.job.id, lease.job.capabilityToken, "confirmed", "late", "Late result.", {}, NOW + 62_000
    ), /capability is invalid/);
  } finally {
    db.close();
  }
});
