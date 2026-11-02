import assert from "node:assert/strict";
import test from "node:test";
import {
  TARGET_ADD_ACTIVATION_CONFIRMATION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  type RetailerAdapterDiagnosticInput,
  type RetailerReverificationRunInput,
  type TargetShadowObservationInput
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { QualificationRepository } from "../packages/database/src/qualification-repository.js";
import { RetailerReadinessRepository } from "../packages/database/src/retailer-readiness-repository.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";
import { RETAILER_READINESS_POLICY } from "../packages/contracts/src/add-lanes.js";

const NOW = new Date("2026-09-03T18:00:00.000Z").getTime();

test("sign-in survives the warm interval while cart proof expires independently", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const devices = new DeviceRepository(db);
    const readiness = new RetailerReadinessRepository(db);
    const observed = NOW + 2_000;
    readiness.record(device.id, { contractVersion: 1, retailerId: "target", signedInState: "ready",
      adapterVersion: TARGET_ADD_ADAPTER_VERSION, cartBaselineState: "ready",
      baselineObservedAt: new Date(observed).toISOString(),
      expiresAt: new Date(observed + RETAILER_READINESS_POLICY.cartBaselineMaxAgeMs).toISOString() }, observed);
    const check = (age: number) => {
      devices.heartbeat(device.id, { extensionVersion: "1.19.5" }, observed + age);
      return readiness.lane("target", observed + age).checklist;
    };
    assert.equal(check(0).find(item => item.id === "cart_baseline")?.ready, true);
    for (const age of [6 * 60_000, 20 * 60_000, RETAILER_READINESS_POLICY.sessionMaxAgeMs]) {
      const checks = check(age);
      assert.equal(checks.find(item => item.id === "signed_in")?.ready, true);
      assert.equal(checks.find(item => item.id === "cart_baseline")?.ready, false);
    }
    assert.equal(check(RETAILER_READINESS_POLICY.sessionMaxAgeMs + 1).find(item => item.id === "signed_in")?.ready, false);
    assert.equal(check(-1).find(item => item.id === "signed_in")?.ready, false, "future session evidence is unknown");
    devices.heartbeat(device.id, {}, observed + 1);
    assert.equal(readiness.lane("target", observed).checklist.find(item => item.id === "signed_in")?.ready, false, "future heartbeat is not online");
    assert.equal(devices.listDevices(observed)[0]?.online, false);
    assert.equal(readiness.lane("target", observed + 90_002).checklist.find(item => item.id === "signed_in")?.ready, false, "stale heartbeat is not online");
  } finally { db.close(); }
});

test("signed-out evidence blocks through the warm interval and clears on a new signed-in report", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const readiness = new RetailerReadinessRepository(db);
    const observed = NOW + 2_000;
    const report = { contractVersion: 1 as const, retailerId: "target" as const,
      adapterVersion: TARGET_ADD_ADAPTER_VERSION, cartBaselineState: "unknown" as const };
    readiness.record(device.id, { ...report, signedInState: "signed_out" }, observed);
    assert.equal(readiness.freshSessionBlockers(observed + 20 * 60_000).length, 1);
    assert.equal(readiness.freshSessionBlockers(observed + RETAILER_READINESS_POLICY.sessionMaxAgeMs).length, 1);
    assert.equal(readiness.freshSessionBlockers(observed + RETAILER_READINESS_POLICY.sessionMaxAgeMs + 1).length, 0);
    assert.equal(readiness.freshSessionBlockers(observed - 1).length, 0);
    readiness.record(device.id, { ...report, signedInState: "ready" }, observed + 21 * 60_000);
    assert.equal(readiness.freshSessionBlockers(observed + 21 * 60_000).length, 0);
  } finally { db.close(); }
});

function pairedDevice(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  return devices.pair({
    pairingCode: code.code,
    extensionVersion: "1.19.5",
    capabilities: {
      readiness: true,
      jobReconciliation: true,
      targetAddOnly: true,
      targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
    }
  }, NOW + 1_000);
}

function observation(retailerSku: string, observedAt: number, availability: "in_stock" | "out_of_stock" = "in_stock"): TargetShadowObservationInput {
  return {
    adapterVersion: TARGET_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    pageKind: "product",
    retailerId: "target",
    retailerSku,
    availability,
    unitPriceCents: 5999,
    currency: "USD",
    sellerName: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: availability === "in_stock",
    securityChallenge: false,
    interactiveBlock: ""
  };
}

function seedListing(db: YoinkDatabase, retailerSku: string, status: string): void {
  const timestamp = new Date(NOW).toISOString();
  db.run(
    "INSERT OR IGNORE INTO product_families(id, title, brand, created_at, updated_at) VALUES ('family_readiness', 'Readiness fixtures', '', ?, ?)",
    timestamp,
    timestamp
  );
  db.run(
    "INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, 'family_readiness', ?, '{}', ?, ?)",
    `variant_${retailerSku}`,
    `Fixture ${retailerSku}`,
    timestamp,
    timestamp
  );
  db.run(
    `INSERT INTO listings(
       id, variant_id, retailer_id, retailer_sku, canonical_url, status,
       execution_supported, currency, created_at, updated_at
     ) VALUES (?, ?, 'target', ?, ?, ?, 0, 'USD', ?, ?)`,
    `listing_${retailerSku}`,
    `variant_${retailerSku}`,
    retailerSku,
    `https://www.target.com/p/-/A-${retailerSku}`,
    status,
    timestamp,
    timestamp
  );
}

function targetDiagnostic(retailerSku: string, observedAt: number, outcome: "failed" | "passed"): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    retailerId: "target",
    retailerSku,
    adapterVersion: TARGET_OBSERVER_VERSION,
    operation: "observe",
    outcome,
    failureStage: outcome === "passed" ? "complete" : "price_binding",
    reasonCode: outcome === "passed" ? "verified" : "price_binding_missing",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "buybox",
      sellerShape: "legacy",
      fulfillmentShape: "shipping",
      addControlCount: 1,
      genericAddIntentCount: 1,
      scopedControlCount: 0,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      variationSkuCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      priceCandidateCount: outcome === "passed" ? 1 : 0,
      quantityControlCount: 0,
      securityChallenge: false,
      interactiveBlock: ""
    }
  };
}

function runReceipt(overrides: Partial<RetailerReverificationRunInput> = {}): RetailerReverificationRunInput {
  return {
    contractVersion: 1,
    runId: "run_target_00000001",
    retailerId: "target",
    automatic: true,
    trigger: "scheduled",
    outcome: "blocked",
    reasonCode: "out_of_stock",
    attemptedProductCount: 3,
    passedProductCount: 0,
    startedAt: new Date(NOW + 20_000).toISOString(),
    finishedAt: new Date(NOW + 60_000).toISOString(),
    extensionVersion: "1.19.5",
    planSignature: "reverification-plan-v3:trigger:abc",
    ...overrides
  };
}

test("candidates prefer purchasable products and reserve catalog slots when the lane lacks a current rehearsal", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const shadows = new ShadowObservationRepository(db);
    const historySkus = ["100000001", "100000002", "100000003", "100000004", "100000005", "100000006", "100000007", "100000008", "100000009"];
    historySkus.forEach((retailerSku, index) => {
      shadows.record(device.id, observation(retailerSku, NOW + 2_000 + index * 10), NOW + 3_000 + index * 10);
      seedListing(db, retailerSku, "out_of_stock");
    });
    seedListing(db, "200000001", "in_stock");
    seedListing(db, "200000002", "preorder");

    const lane = new RetailerReadinessRepository(db).lane("target", NOW + 10_000);
    assert.equal(lane.candidates.length, 8);
    const purchasable = lane.candidates.filter((candidate) => candidate.currentlyPurchasable);
    assert.deepEqual(new Set(purchasable.map((candidate) => candidate.retailerSku)), new Set(["200000001", "200000002"]));
    assert.ok(purchasable.every((candidate) => candidate.source === "catalog"));
    assert.equal(lane.blockedReason, "");
    assert.equal(lane.automaticCheckNeeded, true);
    assert.equal(lane.degraded, false);
    assert.equal(lane.lastAutomaticRun, null);
    assert.equal(lane.consecutiveNonPassingRuns, 0);

    db.run("UPDATE listings SET status = 'in_stock' WHERE retailer_sku = '100000009'");
    const reordered = new RetailerReadinessRepository(db).lane("target", NOW + 11_000);
    const nonRepair = reordered.candidates.filter((candidate) => !candidate.repairableObserverFailure);
    const firstSoldOut = nonRepair.findIndex((candidate) => !candidate.currentlyPurchasable);
    const lastPurchasableHistory = nonRepair.findIndex((candidate) => candidate.retailerSku === "100000009");
    assert.ok(lastPurchasableHistory >= 0 && (firstSoldOut === -1 || lastPurchasableHistory < firstSoldOut),
      "a purchasable history product must sort before sold-out history products");
  } finally {
    db.close();
  }
});

test("a lane with only sold-out history reports no purchasable candidate and stops automatic checks", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const shadows = new ShadowObservationRepository(db);
    shadows.record(device.id, observation("100000001", NOW + 2_000), NOW + 3_000);
    shadows.record(device.id, observation("100000002", NOW + 2_100), NOW + 3_100);
    const readiness = new RetailerReadinessRepository(db);
    const blocked = readiness.lane("target", NOW + 10_000);
    assert.equal(blocked.candidates.length, 2);
    assert.equal(blocked.blockedReason, "no_purchasable_candidate");
    assert.equal(blocked.automaticCheckNeeded, false);

    seedListing(db, "300000001", "in_stock");
    const unblocked = readiness.lane("target", NOW + 11_000);
    assert.equal(unblocked.blockedReason, "");
    assert.equal(unblocked.automaticCheckNeeded, true);
    assert.equal(unblocked.candidates.some((candidate) => candidate.retailerSku === "300000001" && candidate.currentlyPurchasable), true);

    const empty = new YoinkDatabase();
    try {
      pairedDevice(empty);
      assert.equal(new RetailerReadinessRepository(empty).lane("target", NOW + 10_000).blockedReason, "no_candidate");
    } finally {
      empty.close();
    }
  } finally {
    db.close();
  }
});

test("current-version failures degrade a lane and stop guarded adds until fresh passing evidence arrives", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const shadows = new ShadowObservationRepository(db);
    const first = shadows.record(device.id, observation("100000001", NOW + 2_000), NOW + 3_000);
    shadows.record(device.id, observation("100000002", NOW + 4_000), NOW + 5_000);
    const qualifications = new QualificationRepository(db);
    qualifications.recordTargetAddRehearsal(device.id, {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: first.id,
      observedAt: new Date(NOW + 6_000).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, NOW + 7_000);
    qualifications.activateTargetAdd({
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      evidenceHash: shadows.targetQualificationReadiness(NOW + 8_000).qualificationEvidenceHash,
      confirmation: TARGET_ADD_ACTIVATION_CONFIRMATION
    }, NOW + 9_000);
    const readiness = new RetailerReadinessRepository(db);
    const healthy = readiness.lane("target", NOW + 10_000);
    assert.equal(healthy.degraded, false);
    assert.deepEqual(healthy.degradedReasons, []);
    assert.equal(healthy.readyForGuardedAdd, true);
    assert.equal(healthy.checklist.find((check) => check.id === "store_checks")?.ready, true);
    assert.equal(qualifications.targetAddQualified(NOW + 10_000), true);

    const diagnostics = new AdapterDiagnosticRepository(db);
    diagnostics.record(device.id, targetDiagnostic("100000001", NOW + 11_000, "failed"), NOW + 12_000);
    const oneFailure = readiness.lane("target", NOW + 12_500);
    assert.equal(oneFailure.degraded, false, "one failing product is a repair, not a degraded lane");
    diagnostics.record(device.id, targetDiagnostic("100000002", NOW + 12_000, "failed"), NOW + 13_000);
    const degraded = readiness.lane("target", NOW + 14_000);
    assert.equal(degraded.degraded, true);
    assert.deepEqual(degraded.degradedReasons, ["open_repair_current_version"]);
    assert.equal(degraded.readyForGuardedAdd, false);
    assert.equal(degraded.automaticCheckNeeded, true);
    assert.equal(degraded.checklist.find((check) => check.id === "store_checks")?.label, "Store checks failing");
    assert.equal(qualifications.targetAddQualified(NOW + 14_000), false);
    assert.equal(db.get<{ status: string }>("SELECT status FROM retailer_adapter_qualifications WHERE retailer_id = 'target'")?.status, "qualified",
      "degradation never rewrites the qualification row");

    diagnostics.record(device.id, targetDiagnostic("100000001", NOW + 15_000, "passed"), NOW + 16_000);
    diagnostics.record(device.id, targetDiagnostic("100000002", NOW + 15_500, "passed"), NOW + 16_500);
    const recovered = readiness.lane("target", NOW + 17_000);
    assert.equal(recovered.degraded, false);
    assert.equal(recovered.readyForGuardedAdd, true);
    assert.equal(qualifications.targetAddQualified(NOW + 17_000), true);
  } finally {
    db.close();
  }
});

test("run receipts are validated, idempotent, and summarize the last automatic run on the lane", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const readiness = new RetailerReadinessRepository(db);
    const recorded = readiness.recordReverificationRun(device.id, runReceipt(), NOW + 61_000);
    assert.equal(recorded.retailerId, "target");
    assert.equal(recorded.outcome, "blocked");
    assert.equal(recorded.automatic, true);
    const repeated = readiness.recordReverificationRun(device.id, runReceipt({ outcome: "error" }), NOW + 62_000);
    assert.equal(repeated.id, recorded.id, "a repeated run id returns the stored receipt");
    assert.equal(repeated.outcome, "blocked");

    let lane = readiness.lane("target", NOW + 63_000);
    assert.deepEqual(lane.lastAutomaticRun, {
      runId: "run_target_00000001",
      outcome: "blocked",
      reasonCode: "out_of_stock",
      attemptedProductCount: 3,
      passedProductCount: 0,
      finishedAt: new Date(NOW + 60_000).toISOString(),
      extensionVersion: "1.19.5"
    });
    assert.equal(lane.consecutiveNonPassingRuns, 1);

    readiness.recordReverificationRun(device.id, runReceipt({
      runId: "run_target_00000002", outcome: "skipped", reasonCode: "automatic_check_cooldown",
      attemptedProductCount: 0, finishedAt: new Date(NOW + 70_000).toISOString()
    }), NOW + 71_000);
    assert.equal(readiness.lane("target", NOW + 72_000).consecutiveNonPassingRuns, 1, "neutral outcomes neither count nor clear");
    readiness.recordReverificationRun(device.id, runReceipt({
      runId: "run_target_00000003", outcome: "error", reasonCode: "plan_fetch_failed",
      attemptedProductCount: 1, finishedAt: new Date(NOW + 80_000).toISOString()
    }), NOW + 81_000);
    assert.equal(readiness.lane("target", NOW + 82_000).consecutiveNonPassingRuns, 2);
    readiness.recordReverificationRun(device.id, runReceipt({
      runId: "run_target_00000004", automatic: false, trigger: "manual", outcome: "error", reasonCode: "manual_probe",
      attemptedProductCount: 1, finishedAt: new Date(NOW + 85_000).toISOString()
    }), NOW + 86_000);
    lane = readiness.lane("target", NOW + 87_000);
    assert.equal(lane.consecutiveNonPassingRuns, 2, "manual runs never count toward a stall");
    assert.equal(lane.lastAutomaticRun?.runId, "run_target_00000003");
    readiness.recordReverificationRun(device.id, runReceipt({
      runId: "run_target_00000005", outcome: "passed", reasonCode: "qualification_evidence_ready",
      attemptedProductCount: 2, passedProductCount: 1, finishedAt: new Date(NOW + 90_000).toISOString()
    }), NOW + 91_000);
    lane = readiness.lane("target", NOW + 92_000);
    assert.equal(lane.consecutiveNonPassingRuns, 0);
    assert.equal(lane.lastAutomaticRun?.outcome, "passed");

    assert.throws(() => readiness.recordReverificationRun(device.id, runReceipt({ runId: "short" }), NOW + 61_000), /run ID/);
    assert.throws(() => readiness.recordReverificationRun(device.id, runReceipt({ runId: "run_target_bad_counts", passedProductCount: 4 }), NOW + 61_000), /out of bounds/);
    assert.throws(() => readiness.recordReverificationRun(device.id, runReceipt({ runId: "run_target_stale_0001" }), NOW + 60_000 + 11 * 60_000), /stale/);
    assert.throws(() => readiness.recordReverificationRun(device.id, runReceipt({ runId: "run_target_contract_2", contractVersion: 2 as 1 }), NOW + 61_000), /contract version/);
    assert.throws(() => readiness.recordReverificationRun(device.id, runReceipt({ runId: "run_target_bad_reason", reasonCode: "Bad Reason!" }), NOW + 61_000), /reason code/);
    assert.throws(() => readiness.recordReverificationRun(device.id, runReceipt({ runId: "run_target_bad_outcome", outcome: "exploded" as "error" }), NOW + 61_000), /outcome/);
    assert.throws(() => readiness.recordReverificationRun("device_missing", runReceipt({ runId: "run_target_no_device" }), NOW + 61_000), /paired device/);
    const stored = JSON.stringify(db.all("SELECT * FROM audit_events WHERE event_type = 'retailer_reverification_run'"));
    assert.equal(stored.includes("target.com"), false);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'retailer_reverification_run'"
    )?.count, 5, "a repeated run id records nothing new");
  } finally {
    db.close();
  }
});
