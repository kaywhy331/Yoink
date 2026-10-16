import { officialMsrpFixture } from "./helpers/official-msrp.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  type JobState,
  type SignalEventInput,
  type StrategyDefinition
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { RetailerReadinessRepository } from "../packages/database/src/retailer-readiness-repository.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import { UserActionConnectorRepository } from "../packages/database/src/user-action-connector-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { seedLegacyStrategyPlan } from "./helpers/legacy-strategy-plan.js";

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

function targetSignal(
  externalEventId = "target-execution-event-1",
  fulfillment: "shipping" | "pickup" = "shipping"
): SignalEventInput {
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
      sellerType: "first_party",
      fulfillment
    }
  };
}

function qualifyAddLane(db: YoinkDatabase, retailerId: string, adapterVersion: string): void {
  db.run(
    `INSERT INTO retailer_adapter_qualifications(
       tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
       evidence_hash, qualified_at, updated_at, expires_at
     ) VALUES (?, ?, ?, ?, 'add_to_cart', 'qualified', ?, ?, ?, ?)`,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    retailerId,
    adapterVersion,
    `${retailerId}-add-test-evidence`,
    new Date(NOW).toISOString(),
    new Date(NOW).toISOString(),
    new Date(NOW + 30 * 24 * 60 * 60_000).toISOString()
  );
}

function targetExecution(
  db: YoinkDatabase,
  directPlan = false,
  fulfillment: "shipping" | "pickup" = "shipping"
): { execution: ExecutionRepository; deviceId: string; token: string } {
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
    officialMsrpFixture(db, listing.listing.id, NOW, 5999);
    control.createConfiguredMission({
      contractVersion: 1,
      listingId: listing.listing.id,
      officialMsrpEvidenceId: db.get<{ id: string }>("SELECT id FROM official_msrp_evidence WHERE listing_id=? ORDER BY revision DESC LIMIT 1", listing.listing.id)?.id ?? "",
      targetQuantity: 1,
      maxUnitPriceCents: 5999,
      maxAllInCents: 10_000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment,
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, NOW);
    control.replaceStrategies([], NOW);
  } else {
    control.replaceStrategies([targetStrategy()]);
    seedLegacyStrategyPlan(db, { retailerId: "target", retailerSku: "1011483414" }, { now: NOW });
  }
  qualifyAddLane(db, "target", TARGET_ADD_ADAPTER_VERSION);
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
  const processed = new SignalEngine(db).process(targetSignal(
    directPlan ? `target-direct-${fulfillment}-execution-event-1` : undefined,
    fulfillment
  ), NOW);
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
      jobReconciliation: true, officialMsrpCartV1: true,
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
  seedLegacyStrategyPlan(db, { retailerId: "walmart", retailerSku: "17354421975" }, { now: NOW });
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
      jobReconciliation: true, officialMsrpCartV1: true,
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
  seedLegacyStrategyPlan(db, { retailerId: "amazon", retailerSku: asin }, { now: NOW });
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
      jobReconciliation: true, officialMsrpCartV1: true,
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
  seedLegacyStrategyPlan(db, { retailerId: "bestbuy", retailerSku: sku }, { now: NOW });
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
      jobReconciliation: true, officialMsrpCartV1: true,
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
    seedLegacyStrategyPlan(db, { retailerId: "amazon", retailerSku: "B0EXE00001" }, { now: NOW });
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const processed = new SignalEngine(db).process(signal(), NOW);
    assert.equal(processed.actionJobState, "notify_only");
    assert.equal(processed.decision, "intent_action_ceiling");

    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const paired = devices.pair({
      pairingCode: code.code,
      capabilities: { readiness: true, jobReconciliation: true, officialMsrpCartV1: true, retailerMutation: false }
    }, NOW);
    const execution = new ExecutionRepository(db);
    assert.deepEqual(execution.leaseNextJob(paired.id, NOW + 1_000), { job: null, reason: "device_unavailable" });

    db.run(
      "UPDATE extension_devices SET capabilities_json = ? WHERE id = ?",
      JSON.stringify({ readiness: true, jobReconciliation: true, officialMsrpCartV1: true, retailerMutation: true, platform: "qualified-test" }),
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
        { retailerId: "walmart", retailerSku: "17354421975", unitPriceCents: 5000 },
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
      {
        retailerId: "amazon",
        retailerSku: "B0AMZN0001",
        offerListingId: "DO_NOT_STORE",
        latency: {
          leaseToCartReadyMs: 1_234,
          leaseToBaselineMs: 300,
          baselineToOfferMs: 400,
          offerToClickMs: 78,
          clickToSettleMs: 56,
          clickToCartReadyMs: 456,
          settleToCartReadyMs: 400,
          secret: "DO_NOT_STORE"
        }
      },
      NOW + 3_000
    );
    assert.equal(navigating.state, "navigating");
    assert.equal(JSON.stringify(db.all("SELECT data_json FROM audit_events")).includes("DO_NOT_STORE"), false);
    const evidence = JSON.parse(String(db.get<{ evidence_json: string }>(
      "SELECT evidence_json FROM action_events WHERE job_id = ? ORDER BY created_at DESC LIMIT 1",
      lease.job.id
    )?.evidence_json || "{}")) as Record<string, unknown>;
    assert.deepEqual(evidence.latency, {
      leaseToCartReadyMs: 1_234,
      leaseToBaselineMs: 300,
      baselineToOfferMs: 400,
      offerToClickMs: 78,
      clickToSettleMs: 56,
      clickToCartReadyMs: 456,
      settleToCartReadyMs: 400
    });
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

test("an explicit pickup Target cart plan is rejected before any job is created", () => {
  const db = new YoinkDatabase();
  try {
    assert.throws(() => targetExecution(db, true, "pickup"), { code: "official_msrp_cart_policy_invalid" });
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM action_jobs")?.n, 0);
  } finally { db.close(); }
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

test("fresh exact-device retailer session blockers defer a guarded add without consuming it", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    const readiness = new RetailerReadinessRepository(db);
    readiness.record(deviceId, {
      contractVersion: 1,
      retailerId: "target",
      signedInState: "signed_out",
      cartBaselineState: "unknown",
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      errorCode: "signed_out"
    }, NOW + 1_500);

    assert.deepEqual(readiness.freshSessionBlockers(NOW + 2_000).map((item) => ({
      deviceId: item.deviceId,
      retailerId: item.retailerId,
      signedInState: item.signedInState
    })), [{ deviceId, retailerId: "target", signedInState: "signed_out" }]);
    assert.equal(readiness.lane("target", NOW + 2_000).readyForGuardedAdd, false);
    assert.deepEqual(execution.leaseNextJob(deviceId, NOW + 2_000), { job: null, reason: "no_jobs" });
    assert.equal(db.get<{ state: string }>(
      "SELECT state FROM action_jobs ORDER BY created_at LIMIT 1"
    )?.state, "awaiting_executor");

    readiness.record(deviceId, {
      contractVersion: 1,
      retailerId: "target",
      signedInState: "ready",
      cartBaselineState: "unknown",
      adapterVersion: TARGET_ADD_ADAPTER_VERSION
    }, NOW + 2_500);
    assert.deepEqual(readiness.freshSessionBlockers(NOW + 3_000), []);
    assert.equal(readiness.lane("target", NOW + 3_000).readyForGuardedAdd, true);
    const lease = execution.leaseNextJob(deviceId, NOW + 3_000);
    assert.equal(lease.reason, "leased");
    assert.equal(lease.job?.retailerId, "target");
  } finally {
    db.close();
  }
});

test("the Chrome host-access hint can only narrow lease selection and never consumes hidden-store work", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    assert.deepEqual(
      execution.leaseNextJob(deviceId, NOW + 2_000, ["walmart", "unknown"]),
      { job: null, reason: "no_jobs" }
    );
    assert.equal(db.get<{ state: string }>(
      "SELECT state FROM action_jobs ORDER BY created_at LIMIT 1"
    )?.state, "awaiting_executor");

    const lease = execution.leaseNextJob(deviceId, NOW + 3_000, ["target", "unknown"]);
    assert.equal(lease.reason, "leased");
    assert.equal(lease.job?.retailerId, "target");
  } finally {
    db.close();
  }
});

test("stale or adapter-mismatched session evidence cannot suppress a guarded add", () => {
  for (const [label, adapterVersion, updatedAt] of [
    ["stale", TARGET_ADD_ADAPTER_VERSION, NOW - 31 * 60_000],
    ["future", TARGET_ADD_ADAPTER_VERSION, NOW + 2_001],
    ["old_adapter", "target-add-previous", NOW + 1_500]
  ] as const) {
    const db = new YoinkDatabase();
    try {
      const { execution, deviceId } = targetExecution(db);
      new RetailerReadinessRepository(db).record(deviceId, {
        contractVersion: 1,
        retailerId: "target",
        signedInState: "challenged",
        cartBaselineState: "unknown",
        adapterVersion,
        errorCode: label
      }, updatedAt);
      const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
      assert.equal(lease.reason, "leased", label);
    } finally {
      db.close();
    }
  }
});

test("an unavailable earlier store cannot head-of-line block a qualified queued store", () => {
  for (const blocker of ["unqualified", "session_blocked"] as const) {
    const db = new YoinkDatabase();
    try {
      const target = targetExecution(db);
      walmartExecution(db);
      db.run(
        "UPDATE extension_devices SET capabilities_json = ? WHERE id = ?",
        JSON.stringify({
          readiness: true,
          jobReconciliation: true, officialMsrpCartV1: true,
          targetAddOnly: true,
          targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION,
          walmartAddOnly: true,
          walmartAddAdapterVersion: WALMART_ADD_ADAPTER_VERSION
        }),
        target.deviceId
      );
      db.run(
        `UPDATE action_jobs SET created_at = ?
         WHERE listing_id IN (SELECT id FROM listings WHERE retailer_id = 'target')`,
        new Date(NOW - 1_000).toISOString()
      );
      if (blocker === "unqualified") {
        db.run(
          "UPDATE retailer_adapter_qualifications SET status = 'retired' WHERE retailer_id = 'target'"
        );
      } else {
        new RetailerReadinessRepository(db).record(target.deviceId, {
          contractVersion: 1,
          retailerId: "target",
          signedInState: "challenged",
          cartBaselineState: "unknown",
          adapterVersion: TARGET_ADD_ADAPTER_VERSION,
          errorCode: "security_challenge"
        }, NOW + 1_500);
      }

      const lease = target.execution.leaseNextJob(
        target.deviceId,
        NOW + 2_000,
        ["target", "walmart"]
      );
      assert.equal(lease.reason, "leased", blocker);
      assert.equal(lease.job?.retailerId, "walmart", blocker);
      assert.equal(db.get<{ state: string }>(
        `SELECT aj.state FROM action_jobs aj
         JOIN listings listing ON listing.id = aj.listing_id
         WHERE listing.retailer_id = 'target'`
      )?.state, "awaiting_executor", blocker);
    } finally {
      db.close();
    }
  }
});

test("batched Chrome progress is atomic when a later transition is invalid", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    const beforeEvents = db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM action_events WHERE job_id = ?",
      lease.job.id
    )?.count;
    assert.throws(() => execution.reconcileJobBatch(
      deviceId,
      lease.job!.id,
      lease.job!.capabilityToken,
      [
        { state: "navigating", reasonCode: "navigation_started", message: "Navigation started.", evidence: {} },
        { state: "confirmed", reasonCode: "invalid_skip", message: "Invalid skipped state.", evidence: {} }
      ],
      NOW + 3_000
    ), /cannot move/i);
    assert.equal(
      db.get<{ state: string }>("SELECT state FROM action_jobs WHERE id = ?", lease.job.id)?.state,
      "leased"
    );
    assert.equal(
      db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM action_events WHERE job_id = ?",
        lease.job.id
      )?.count,
      beforeEvents
    );
  } finally {
    db.close();
  }
});

test("lease heartbeat is capped by the action job's real remaining execution budget", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    const budgetEnd = NOW + 8_000;
    db.run("UPDATE action_jobs SET expires_at = ? WHERE id = ?", new Date(budgetEnd).toISOString(), lease.job.id);
    const heartbeat = execution.heartbeatJob(
      deviceId,
      lease.job.id,
      lease.job.capabilityToken,
      NOW + 3_000
    );
    assert.equal(heartbeat.leaseExpiresAt, new Date(budgetEnd).toISOString());
    assert.equal(heartbeat.remainingBudgetMs, 5_000);
    assert.throws(() => execution.heartbeatJob(
      deviceId,
      lease.job!.id,
      lease.job!.capabilityToken,
      budgetEnd
    ), /execution budget has expired/);
  } finally {
    db.close();
  }
});

test("device-scoped action handoff reconciliation closes after an explicit dashboard outcome", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    for (const [index, state] of [
      "navigating",
      "verifying_listing",
      "offer_verified",
      "add_authorized",
      "adding",
      "cart_verified",
      "confirmed"
    ].entries()) {
      execution.reconcileJob(
        deviceId,
        lease.job.id,
        lease.job.capabilityToken,
        state as JobState,
        `fixture_${state}`,
        `Fixture ${state}.`,
        { retailerId: lease.job.retailerId, retailerSku: lease.job.retailerSku, unitPriceCents: lease.job.maxUnitPriceCents },
        NOW + 3_000 + index
      );
    }
    assert.deepEqual(execution.actionHandoffStatuses(deviceId, [lease.job.id]), [{
      jobId: lease.job.id,
      status: "cart_ready"
    }]);
    assert.deepEqual(execution.actionHandoffStatuses("device_other", [lease.job.id]), []);
    new SignalRepository(db).reportCartOutcome(
      lease.job.id,
      "missed_it",
      "I_REVIEWED_CHECKOUT_RESULT",
      null,
      "",
      NOW + 20_000
    );
    assert.deepEqual(execution.actionHandoffStatuses(deviceId, [lease.job.id]), [{
      jobId: lease.job.id,
      status: "closed"
    }]);
    assert.throws(() => execution.actionHandoffStatuses(deviceId, []), /One through ten/);
    assert.throws(() => execution.actionHandoffStatuses(deviceId, ["invalid id"]), /must be valid/);
  } finally {
    db.close();
  }
});

test("device-scoped action handoff reconciliation exposes mutation uncertainty as Needs you", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    for (const [index, state] of [
      "navigating",
      "verifying_listing",
      "offer_verified",
      "add_authorized",
      "adding",
      "manual_review"
    ].entries()) {
      execution.reconcileJob(
        deviceId,
        lease.job.id,
        lease.job.capabilityToken,
        state as JobState,
        `fixture_${state}`,
        `Fixture ${state}.`,
        { retailerId: lease.job.retailerId, retailerSku: lease.job.retailerSku, unitPriceCents: lease.job.maxUnitPriceCents },
        NOW + 3_000 + index
      );
    }
    assert.deepEqual(execution.actionHandoffStatuses(deviceId, [lease.job.id]), [{
      jobId: lease.job.id,
      status: "needs_you"
    }]);
  } finally {
    db.close();
  }
});

test("Carted, Needs you, and Missed connectors follow every shared action transition path", () => {
  const scenarios = [{
    eventType: "carted",
    states: ["navigating", "verifying_listing", "offer_verified", "add_authorized", "adding", "cart_verified", "confirmed"],
    recover: false
  }, {
    eventType: "needs_you",
    states: ["navigating", "verifying_listing", "offer_verified", "add_authorized", "adding"],
    recover: true
  }, {
    eventType: "missed",
    states: ["navigating", "verifying_listing", "offer_rejected"],
    recover: false
  }] as const;

  for (const scenario of scenarios) {
    const db = new YoinkDatabase();
    try {
      const { execution, deviceId } = targetExecution(db);
      const connectors = new UserActionConnectorRepository(db, { checkout_hook: "f".repeat(64) });
      connectors.save({
        contractVersion: 1,
        kind: "webhook",
        name: `${scenario.eventType} fixture`,
        endpointReference: "checkout_hook",
        events: [scenario.eventType]
      }, "", NOW + 1_000);
      const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
      assert.equal(lease.reason, "leased");
      assert.ok(lease.job);
      for (const [index, state] of scenario.states.entries()) {
        execution.reconcileJob(
          deviceId,
          lease.job.id,
          lease.job.capabilityToken,
          state,
          `fixture_${state}`,
          `Fixture ${state}.`,
          { retailerId: lease.job.retailerId, retailerSku: lease.job.retailerSku, unitPriceCents: lease.job.maxUnitPriceCents,
            ...(state === "confirmed" ? { checkoutAvailability: "available", checkoutVerifiedAt: new Date(NOW + 3_000 + index * 1_000).toISOString() } : {}) },
          NOW + 3_000 + index * 1_000
        );
      }
      if (scenario.recover) {
        assert.equal(execution.recoverExpiredLeases(NOW + 60_000), 1);
        assert.throws(() => execution.reconcileJob(
          deviceId,
          lease.job!.id,
          lease.job!.capabilityToken,
          "manual_review",
          "stale_device_report",
          "A stale device report must be rejected.",
          {},
          NOW + 61_000
        ), /capability is invalid/);
      }
      const deliveries = connectors.listDeliveries();
      assert.equal(deliveries.length, 1);
      assert.equal(deliveries[0]?.eventType, scenario.eventType);
      assert.equal(deliveries[0]?.actionJobId, lease.job.id);
      assert.equal(deliveries[0]?.state, "pending");
      const connectorLease = connectors.leaseNext(NOW + (scenario.recover ? 70_000 : 10_000));
      assert.equal(connectorLease?.eventType, scenario.eventType);
      assert.equal(connectorLease?.actionJobId, lease.job.id);
      assert.equal(connectorLease?.payload.checkoutManual, true);
    } finally {
      db.close();
    }
  }
});

test("action recovery leaves a cross-tenant shared signal incident unchanged", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    const lease = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.equal(lease.reason, "leased");
    assert.ok(lease.job);
    const incidentId = db.get<{ incident_id: string }>(
      "SELECT incident_id FROM action_jobs WHERE id = ?",
      lease.job.id
    )?.incident_id;
    assert.ok(incidentId);
    db.run(
      "INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)",
      "tenant_execution_shared",
      "Execution shared tenant",
      new Date(NOW).toISOString()
    );
    db.run(
      "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
      "user_execution_shared",
      "tenant_execution_shared",
      "Execution shared user",
      new Date(NOW).toISOString()
    );
    db.run(
      `INSERT INTO source_connections(
         id, tenant_id, user_id, source, name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "source_execution_shared",
      "tenant_execution_shared",
      "user_execution_shared",
      "fixture",
      "Shared incident fixture",
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString()
    );
    db.run(
      `INSERT INTO signal_events(
         id, tenant_id, user_id, source_connection_id, signal_id,
         external_event_id, transport_hash, schema_version, source, event_type,
         observed_at, received_at, identity_json, offer_json, evidence_json,
         parser_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'fixture', 'restock', ?, ?, '{}', '{}', '{}',
                 'execution-shared-v1', ?)`,
      "signal_execution_shared",
      "tenant_execution_shared",
      "user_execution_shared",
      "source_execution_shared",
      "signal-execution-shared",
      "external-execution-shared",
      "transport-execution-shared",
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString()
    );
    db.run(
      `INSERT INTO signal_occurrences(
         id, event_id, incident_id, source_connection_id,
         observed_at, received_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "occurrence_execution_shared",
      "signal_execution_shared",
      incidentId,
      "source_execution_shared",
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString()
    );
    assert.equal(execution.reconcileJob(
      deviceId,
      lease.job.id,
      lease.job.capabilityToken,
      "navigating",
      "navigation_started",
      "Navigation started.",
      {},
      NOW + 4_000
    ).state, "navigating");
    assert.equal(execution.recoverExpiredLeases(NOW + 50_000), 1);
    assert.equal(
      db.get<{ state: string }>("SELECT state FROM action_jobs WHERE id = ?", lease.job.id)?.state,
      "expired"
    );
    assert.deepEqual(
      { ...db.get<{ status: string; closedReason: string }>(
        "SELECT status, closed_reason AS closedReason FROM signal_incidents WHERE id = ?",
        incidentId
      ) },
      { status: "open", closedReason: "" }
    );
    assert.equal(
      db.get<{ status: string }>(
        "SELECT status FROM spend_reservations WHERE action_job_id = ?",
        lease.job.id
      )?.status,
      "released"
    );
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
        { retailerId: lease.job.retailerId, retailerSku: lease.job.retailerSku, unitPriceCents: lease.job.maxUnitPriceCents },
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

test("checkout stock rejection closes the job without a success alert or an automatic re-add", () => {
  const db = new YoinkDatabase();
  try {
    const { execution, deviceId } = targetExecution(db);
    const connectors = new UserActionConnectorRepository(db, { checkout_hook: "f".repeat(64) });
    connectors.save({contractVersion: 1, kind: "webhook", name: "Checkout alerts", endpointReference: "checkout_hook", events: ["carted", "needs_you"]}, "", NOW);
    const {job} = execution.leaseNextJob(deviceId, NOW + 2_000);
    assert.ok(job);
    for (const [index, state] of ["navigating", "verifying_listing", "offer_verified", "add_authorized", "adding", "cart_verified", "checkout_review"].entries()) {
      execution.reconcileJob(deviceId, job.id, job.capabilityToken, state as JobState, `fixture_${state}`, "Fixture checkout.",
        {retailerId: job.retailerId, retailerSku: job.retailerSku, unitPriceCents: job.maxUnitPriceCents}, NOW + 3000 + index);
    }
    assert.throws(() => execution.reconcileJob(deviceId, job.id, job.capabilityToken, "offer_rejected", "out_of_stock", "Unavailable", {}, NOW + 4000), /recent checkout check/);
    execution.reconcileJob(deviceId, job.id, job.capabilityToken, "offer_rejected", "out_of_stock", "Unavailable",
      {retailerId: job.retailerId, retailerSku: job.retailerSku, checkoutAvailability: "out_of_stock", checkoutVerifiedAt: new Date(NOW + 4000).toISOString()}, NOW + 4001);
    assert.equal(db.get<{state: string}>("SELECT state FROM action_jobs WHERE id=?", job.id)?.state, "offer_rejected");
    assert.deepEqual(connectors.listDeliveries(), []);
    assert.equal(connectors.queueForJob("carted", job.id, NOW + 4002), 0);
    assert.deepEqual(execution.actionHandoffStatuses(deviceId, [job.id]), [{jobId: job.id, status: "closed"}]);
  } finally { db.close(); }
});

test("cart-only and stale checkout evidence never enqueue a checkout-ready message", () => {
  for (const proof of [{}, {checkoutAvailability: "available", checkoutVerifiedAt: new Date(NOW - 60_000).toISOString()}]) {
    const db = new YoinkDatabase();
    try {
      const { execution, deviceId } = targetExecution(db);
      const connectors = new UserActionConnectorRepository(db, { checkout_hook: "f".repeat(64) });
      connectors.save({contractVersion: 1, kind: "webhook", name: "Checkout alerts", endpointReference: "checkout_hook", events: ["carted"]}, "", NOW);
      const {job} = execution.leaseNextJob(deviceId, NOW + 2_000);
      assert.ok(job);
      for (const [index, state] of ["navigating", "verifying_listing", "offer_verified", "add_authorized", "adding", "cart_verified", "confirmed"].entries()) {
        execution.reconcileJob(deviceId, job.id, job.capabilityToken, state as JobState, `fixture_${state}`, "Fixture checkout.",
          {retailerId: job.retailerId, retailerSku: job.retailerSku, unitPriceCents: job.maxUnitPriceCents, ...proof}, NOW + 3000 + index);
      }
      assert.deepEqual(connectors.listDeliveries(), []);
    } finally { db.close(); }
  }
});
