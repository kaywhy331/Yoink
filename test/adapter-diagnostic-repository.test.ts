import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_OBSERVER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  RETAILER_OBSERVER_VERSIONS,
  type RetailerAdapterDiagnosticInput,
  type RetailerAdapterLayoutEvidence
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";

const NOW = new Date("2026-08-23T23:15:00.000Z").getTime();

function pairedDevice(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  return devices.pair({ pairingCode: code.code }, NOW + 1_000);
}

function layout(overrides: Partial<RetailerAdapterLayoutEvidence> = {}): RetailerAdapterLayoutEvidence {
  return {
    schemaVersion: 1,
    pageKind: "product",
    scopeKind: "accordion",
    sellerShape: "legacy",
    fulfillmentShape: "shipping",
    addControlCount: 1,
    genericAddIntentCount: 1,
    scopedControlCount: 0,
    explicitSkuInputCount: 2,
    exactSkuInputCount: 2,
    variationSkuCount: 0,
    canonicalOfferInputCount: 2,
    canonicalOfferDistinctCount: 2,
    alternateOfferInputCount: 1,
    alternateOfferDistinctCount: 1,
    priceCandidateCount: 1,
    quantityControlCount: 0,
    securityChallenge: false,
    interactiveBlock: "",
    ...overrides
  };
}

function diagnostic(overrides: Partial<RetailerAdapterDiagnosticInput> = {}): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date(NOW + 1_000).toISOString(),
    retailerId: "amazon",
    retailerSku: "B0FB21526X",
    adapterVersion: AMAZON_OBSERVER_VERSION,
    operation: "observe",
    outcome: "failed",
    failureStage: "offer_binding",
    reasonCode: "offer_binding_ambiguous",
    attemptCount: 1,
    domChanged: false,
    layout: layout(),
    ...overrides
  };
}

function runtimeLayout(): RetailerAdapterLayoutEvidence {
  return layout({
    scopeKind: "none",
    sellerShape: "none",
    fulfillmentShape: "none",
    addControlCount: 0,
    genericAddIntentCount: 0,
    scopedControlCount: 0,
    explicitSkuInputCount: 0,
    exactSkuInputCount: 0,
    variationSkuCount: 0,
    canonicalOfferInputCount: 0,
    canonicalOfferDistinctCount: 0,
    alternateOfferInputCount: 0,
    alternateOfferDistinctCount: 0,
    priceCandidateCount: 0,
    quantityControlCount: 0
  });
}

test("adapter diagnostics persist only normalized structural evidence and group repair incidents", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    const input = {
      ...diagnostic(),
      rawDom: "DO_NOT_STORE_DOM",
      cookie: "DO_NOT_STORE_COOKIE",
      offerListingID: "DO_NOT_STORE_OFFER",
      layout: { ...layout(), arbitraryText: "DO_NOT_STORE_TEXT" }
    };
    const failed = repository.record(device.id, input, NOW + 2_000);
    assert.match(failed.layoutFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(failed.outcome, "failed");
    assert.equal(failed.layout.genericAddIntentCount, 1);
    assert.equal(repository.listRepairQueue()[0]?.status, "open");
    const retried = repository.record(device.id, input, NOW + 2_500);
    assert.equal(retried.id, failed.id);
    assert.equal(repository.counts().adapterDiagnosticEvents, 1);

    repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 3_000).toISOString(),
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified",
      layout: layout({ scopedControlCount: 1 })
    }), NOW + 4_000);
    const repaired = repository.listRepairQueue()[0];
    assert.equal(repaired?.status, "recovered");
    assert.equal(repaired?.occurrenceCount, 1);
    assert.equal(repaired?.affectedSkuCount, 1);
    assert.deepEqual(repository.counts(), {
      adapterDiagnosticEvents: 2,
      openAdapterRepairGroups: 0,
      recoveredAdapterRepairGroups: 1
    });

    const durable = JSON.stringify(db.all("SELECT * FROM retailer_adapter_diagnostics"));
    assert.equal(durable.includes("DO_NOT_STORE"), false);
    assert.equal(durable.includes(device.token), false);
  } finally {
    db.close();
  }
});

test("adapter diagnostics reject malformed, stale, secret-shaped, and inconsistent input", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    assert.throws(() => repository.record(device.id, diagnostic({ reasonCode: "raw error: secret" }), NOW + 2_000), /reason code/);
    assert.throws(() => repository.record(device.id, diagnostic({ reasonCode: "b0fb21526x" }), NOW + 2_000), /allowlisted/);
    assert.throws(() => repository.record(device.id, diagnostic({ observedAt: new Date(NOW - 11 * 60_000).toISOString() }), NOW), /stale/);
    assert.throws(() => repository.record(device.id, diagnostic({ outcome: "passed" }), NOW + 2_000), /inconsistent/);
    assert.throws(() => repository.record(device.id, diagnostic({ layout: layout({ canonicalOfferDistinctCount: 3 }) }), NOW + 2_000), /counts/);
    assert.throws(() => repository.record(device.id, diagnostic({ adapterVersion: "amazon-observer-spoofed" }), NOW + 2_000), /version/);
    assert.throws(() => repository.record("missing_device", diagnostic(), NOW + 2_000), /unavailable/);
    assert.equal(repository.counts().adapterDiagnosticEvents, 0);
  } finally {
    db.close();
  }
});

test("a transient layout failure recovered by retry is retained without opening repair work", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    repository.record(device.id, diagnostic({
      outcome: "recovered",
      failureStage: "add_control",
      reasonCode: "dom_hydration_recovered",
      attemptCount: 3,
      domChanged: true,
      layout: layout({ addControlCount: 0, canonicalOfferInputCount: 0, canonicalOfferDistinctCount: 0 })
    }), NOW + 2_000);
    const item = repository.listRepairQueue()[0];
    assert.equal(item?.status, "recovered");
    assert.equal(item?.maxAttemptCount, 3);
    assert.equal(item?.domChangedSeen, true);
  } finally {
    db.close();
  }
});

test("a later successful inspection closes zero-content runtime incidents for every affected exact SKU", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 1_000).toISOString(),
      failureStage: "runner",
      reasonCode: "observer_bundle_injection_failed",
      layout: runtimeLayout()
    }), NOW + 2_000);
    repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 3_000).toISOString(),
      retailerSku: "B0GYTRYV7P",
      failureStage: "runner",
      reasonCode: "observer_execution_failed",
      layout: runtimeLayout()
    }), NOW + 4_000);
    let runtimeRepair = repository.listRepairQueue()[0];
    assert.equal(runtimeRepair?.status, "open");
    assert.equal(runtimeRepair?.occurrenceCount, 2);
    assert.equal(runtimeRepair?.affectedSkuCount, 2);

    repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 5_000).toISOString(),
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified",
      layout: layout({ scopedControlCount: 1, canonicalOfferDistinctCount: 1 })
    }), NOW + 6_000);
    runtimeRepair = repository.listRepairQueue().find((item) => item.failureStage === "runner");
    assert.equal(runtimeRepair?.status, "open");

    repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 7_000).toISOString(),
      retailerSku: "B0GYTRYV7P",
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified",
      layout: layout({ scopedControlCount: 1, canonicalOfferDistinctCount: 1 })
    }), NOW + 8_000);
    runtimeRepair = repository.listRepairQueue().find((item) => item.failureStage === "runner");
    assert.equal(runtimeRepair?.status, "recovered");
    assert.equal(runtimeRepair?.lastRecoveryAt, new Date(NOW + 8_000).toISOString());
    assert.equal(repository.counts().openAdapterRepairGroups, 0);
  } finally {
    db.close();
  }
});

test("a strictly newer packaged observer can supersede an older exact-SKU repair with a deliberate manual result", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    const bestBuyLayout = layout({
      scopeKind: "none",
      fulfillmentShape: "none",
      addControlCount: 0,
      genericAddIntentCount: 0,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      variationSkuCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0
    });
    const failed = repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 1_000).toISOString(),
      retailerId: "bestbuy",
      retailerSku: "6664887",
      adapterVersion: BESTBUY_OBSERVER_VERSION,
      failureStage: "add_control",
      reasonCode: "add_control_missing",
      layout: bestBuyLayout
    }), NOW + 2_000);
    db.run(
      "UPDATE retailer_adapter_diagnostics SET adapter_version = 'bestbuy-observer-v3' WHERE id = ?",
      failed.id
    );
    assert.equal(repository.listRepairQueue().find((item) => item.reasonCode === "add_control_missing")?.status, "open");

    repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 3_000).toISOString(),
      retailerId: "bestbuy",
      retailerSku: "6664887",
      adapterVersion: BESTBUY_OBSERVER_VERSION,
      outcome: "rejected",
      failureStage: "interactive_block",
      reasonCode: "interactive_location",
      layout: { ...bestBuyLayout, interactiveBlock: "location" }
    }), NOW + 4_000);
    const repaired = repository.listRepairQueue().find((item) => item.reasonCode === "add_control_missing");
    assert.equal(repaired?.status, "recovered");
    assert.equal(repaired?.lastRecoveryAt, new Date(NOW + 4_000).toISOString());
  } finally {
    db.close();
  }
});

test("read-only retailer diagnostics are version-bound and can open repair work without enabling actions", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    const disneyLayout = layout({
      scopeKind: "form",
      sellerShape: "none",
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      addControlCount: 0
    });
    const stored = repository.record(device.id, diagnostic({
      retailerId: "disney",
      retailerSku: "409914998395",
      adapterVersion: RETAILER_OBSERVER_VERSIONS.disney,
      failureStage: "add_control",
      reasonCode: "add_control_missing",
      layout: disneyLayout
    }), NOW + 2_000);
    assert.equal(stored.retailerId, "disney");
    assert.equal(repository.listRepairQueue()[0]?.retailerId, "disney");
    assert.equal(db.get<{ execution_supported: number }>(
      "SELECT execution_supported FROM retailers WHERE id = 'disney'"
    )?.execution_supported, 0);
    assert.throws(() => repository.record(device.id, diagnostic({
      retailerId: "disney",
      retailerSku: "409914998395",
      adapterVersion: AMAZON_OBSERVER_VERSION,
      layout: disneyLayout
    }), NOW + 2_000), /version/);
  } finally {
    db.close();
  }
});
