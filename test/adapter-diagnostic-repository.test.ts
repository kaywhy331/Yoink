import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_OBSERVER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  RETAILER_OBSERVER_VERSIONS,
  type RetailerAdapterDiagnosticInput,
  type RetailerAdapterLayoutEvidence
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository, AdapterDiagnosticValidationError } from "../packages/database/src/adapter-diagnostic-repository.js";
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

test("Best Buy high-demand evidence reaches the server as a deliberate manual policy result", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    const stored = repository.record(device.id, diagnostic({
      retailerId: "bestbuy",
      retailerSku: "6669782",
      adapterVersion: BESTBUY_OBSERVER_VERSION,
      outcome: "rejected",
      failureStage: "interactive_block",
      reasonCode: "interactive_high_demand",
      layout: layout({
        scopeKind: "buybox",
        addControlCount: 1,
        scopedControlCount: 1,
        explicitSkuInputCount: 0,
        exactSkuInputCount: 0,
        variationSkuCount: 0,
        canonicalOfferInputCount: 0,
        canonicalOfferDistinctCount: 0,
        alternateOfferInputCount: 0,
        alternateOfferDistinctCount: 0,
        interactiveBlock: "high_demand"
      })
    }), NOW + 2_000);
    assert.equal(stored.reasonCode, "interactive_high_demand");
    assert.equal(stored.layout.interactiveBlock, "high_demand");
    assert.equal(repository.listRepairQueue().length, 0);
  } finally {
    db.close();
  }
});

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
      recoveredAdapterRepairGroups: 1,
      agedOutAdapterRepairGroups: 0,
      supersededAdapterRepairGroups: 0
    });

    const durable = JSON.stringify(db.all("SELECT * FROM retailer_adapter_diagnostics"));
    assert.equal(durable.includes("DO_NOT_STORE"), false);
    assert.equal(durable.includes(device.token), false);
  } finally {
    db.close();
  }
});

test("repair landmarks aggregate exact-SKU and distinct-device evidence without becoming executable", () => {
  const db = new YoinkDatabase();
  try {
    const devices = [pairedDevice(db), pairedDevice(db), pairedDevice(db)];
    const repository = new AdapterDiagnosticRepository(db);
    const repairLayout = layout({
      scopeKind: "none",
      fulfillmentShape: "shipping",
      addControlCount: 0,
      genericAddIntentCount: 1,
      scopedControlCount: 0,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      variationSkuCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      repairLandmarks: [{
        field: "addControl",
        elementKind: "role_button",
        attribute: "data-testid",
        value: "pdp-add-to-cart-control",
        selector: "body *",
        textContent: "Private Fixture"
      } as never]
    });
    for (const [index, retailerSku] of ["6612619", "6669690", "6528565"].entries()) {
      repository.record(devices[index]?.id ?? "", diagnostic({
        observedAt: new Date(NOW + 1_000 + index).toISOString(),
        retailerId: "bestbuy",
        retailerSku,
        adapterVersion: BESTBUY_OBSERVER_VERSION,
        failureStage: "add_control",
        reasonCode: "add_control_selector_miss",
        layout: repairLayout
      }), NOW + 2_000 + index);
    }
    const item = repository.listRepairQueue()[0];
    assert.equal(item?.status, "open");
    assert.deepEqual(item?.repairSuggestions, [{
      field: "addControl",
      selector: "[role='button'][data-testid='pdp-add-to-cart-control']",
      mode: "disabled_state",
      occurrenceCount: 3,
      distinctDeviceCount: 3,
      distinctSkuCount: 3,
      minimumDeviceCount: 3,
      minimumSkuCount: 2,
      reviewState: "maintainer_ready",
      executable: false
    }]);
    const durable = JSON.stringify(db.all("SELECT layout_json FROM retailer_adapter_diagnostics"));
    assert.equal(durable.includes("Private Fixture"), false);
    assert.equal(durable.includes("selector"), false);
  } finally {
    db.close();
  }
});

test("five-field landmarks aggregate independently without retaining observed commerce values", () => {
  const db = new YoinkDatabase();
  try {
    const devices = [pairedDevice(db), pairedDevice(db), pairedDevice(db)];
    const repository = new AdapterDiagnosticRepository(db);
    const repairLayout = layout({
      scopeKind: "form",
      addControlCount: 1,
      genericAddIntentCount: 1,
      genericAvailabilityCandidateCount: 1,
      genericPriceCandidateCount: 1,
      genericSellerCandidateCount: 1,
      genericFulfillmentCandidateCount: 1,
      scopedControlCount: 1,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      variationSkuCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      priceCandidateCount: 0,
      repairLandmarks: [
        { field: "availability", elementKind: "div", attribute: "data-testid", value: "product-availability-status" },
        { field: "unitPrice", elementKind: "span", attribute: "data-testid", value: "product-current-price" },
        { field: "seller", elementKind: "p", attribute: "data-testid", value: "seller-display-name" },
        { field: "fulfillment", elementKind: "div", attribute: "data-testid", value: "shipping-fulfillment-option" },
        { field: "addControl", elementKind: "button", attribute: "data-automation-id", value: "atc" }
      ]
    });
    for (const [index, retailerSku] of ["6612619", "6669690", "6528565"].entries()) {
      repository.record(devices[index]?.id ?? "", diagnostic({
        observedAt: new Date(NOW + 1_000 + index).toISOString(),
        retailerId: "bestbuy",
        retailerSku,
        adapterVersion: BESTBUY_OBSERVER_VERSION,
        failureStage: "price_binding",
        reasonCode: "price_selector_miss",
        layout: repairLayout
      }), NOW + 2_000 + index);
    }
    const suggestions = repository.listRepairQueue()[0]?.repairSuggestions ?? [];
    assert.equal(suggestions.length, 5);
    assert.deepEqual(Object.fromEntries(suggestions.map((suggestion) => [suggestion.field, {
      selector: suggestion.selector,
      mode: suggestion.mode,
      devices: suggestion.distinctDeviceCount,
      skus: suggestion.distinctSkuCount,
      reviewState: suggestion.reviewState,
      executable: suggestion.executable
    }])), {
      addControl: {
        selector: "button[data-automation-id='atc']", mode: "disabled_state",
        devices: 3, skus: 3, reviewState: "maintainer_ready", executable: false
      },
      availability: {
        selector: "div[data-testid='product-availability-status']", mode: "text",
        devices: 3, skus: 3, reviewState: "maintainer_ready", executable: false
      },
      fulfillment: {
        selector: "div[data-testid='shipping-fulfillment-option']", mode: "text",
        devices: 3, skus: 3, reviewState: "maintainer_ready", executable: false
      },
      seller: {
        selector: "p[data-testid='seller-display-name']", mode: "text",
        devices: 3, skus: 3, reviewState: "maintainer_ready", executable: false
      },
      unitPrice: {
        selector: "span[data-testid='product-current-price']", mode: "text",
        devices: 3, skus: 3, reviewState: "maintainer_ready", executable: false
      }
    });
    const durable = JSON.stringify(db.all("SELECT layout_json FROM retailer_adapter_diagnostics"));
    for (const forbidden of ["$19.99", "Sold and shipped by", "In stock", "Shipping", "DO_NOT_STORE"]) {
      assert.equal(durable.includes(forbidden), false);
    }
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
    assert.throws(() => repository.record(device.id, diagnostic({ layout: layout({
      addControlCount: 0,
      genericAddIntentCount: 1,
      repairLandmarks: [{ field: "addControl", elementKind: "button", attribute: "data-testid", value: "account-add-to-cart" }]
    }) }), NOW + 2_000), /privacy bounded/);
    assert.throws(() => repository.record(device.id, diagnostic({ layout: layout({
      addControlCount: 0,
      genericAddIntentCount: 1,
      repairLandmarks: [{ field: "addControl", elementKind: "button", attribute: "data-testid", value: "add-to-cart-private-fixture" }]
    }) }), NOW + 2_000), /privacy bounded/);
    assert.throws(() => repository.record(device.id, diagnostic({ layout: layout({
      repairLandmarks: [{ field: "addControl", elementKind: "button", attribute: "data-testid", value: "pdp-add-to-cart" }]
    }) }), NOW + 2_000), /selector-miss/);
    assert.throws(() => repository.record(device.id, diagnostic({
      failureStage: "price_binding",
      reasonCode: "price_selector_miss",
      layout: layout({
        priceCandidateCount: 0,
        genericPriceCandidateCount: 1,
        genericSellerCandidateCount: 1,
        repairLandmarks: [{
          field: "seller", elementKind: "p", attribute: "data-testid", value: "seller-display-name"
        }]
      })
    }), NOW + 2_000), /matching bounded landmark/);
    assert.throws(() => repository.record(device.id, diagnostic({
      failureStage: "price_binding",
      reasonCode: "price_selector_miss",
      layout: layout({
        genericPriceCandidateCount: 1,
        repairLandmarks: [{
          field: "unitPrice", elementKind: "input", attribute: "data-testid", value: "product-price"
        }]
      })
    }), NOW + 2_000), /privacy bounded/);
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

test("a constrained semantic recovery retains bounded landmarks without opening repair work", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    const stored = repository.record(device.id, diagnostic({
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "semantic_layout_recovered",
      layout: layout({
        addControlCount: 0,
        genericAddIntentCount: 1,
        scopedControlCount: 1,
        priceCandidateCount: 0,
        genericPriceCandidateCount: 1,
        canonicalOfferInputCount: 1,
        canonicalOfferDistinctCount: 1,
        repairLandmarks: [
          { field: "unitPrice", elementKind: "div", attribute: "data-testid", value: "commerce-amount" },
          { field: "addControl", elementKind: "input", attribute: "data-button-state", value: "primary-cart-action" }
        ]
      })
    }), NOW + 2_000);
    assert.equal(stored.outcome, "passed");
    assert.equal(stored.reasonCode, "semantic_layout_recovered");
    assert.equal(stored.layout.repairLandmarks?.length, 2);
    assert.equal(repository.listRepairQueue().length, 0);
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
    assert.equal(runtimeRepair?.status, "recovered");
    assert.equal(runtimeRepair?.occurrenceCount, 2);
    assert.equal(runtimeRepair?.affectedSkuCount, 2);
    assert.deepEqual(runtimeRepair?.repairRetailerSkus, []);

    repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 5_000).toISOString(),
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified",
      layout: layout({ scopedControlCount: 1, canonicalOfferDistinctCount: 1 })
    }), NOW + 6_000);
    runtimeRepair = repository.listRepairQueue().find((item) => item.failureStage === "runner");
    assert.equal(runtimeRepair?.status, "recovered");
    assert.deepEqual(runtimeRepair?.repairRetailerSkus, [],
      "infrastructure evidence remains visible but cannot become adapter repair work");

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
    assert.deepEqual(runtimeRepair?.repairRetailerSkus, []);
    assert.equal(runtimeRepair?.lastRecoveryAt, "");
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
    assert.equal(repository.listRepairQueue().find((item) => item.reasonCode === "add_control_missing")?.status, "superseded");

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
    assert.equal(repaired?.status, "superseded");
  } finally {
    db.close();
  }
});

test("a later same-version exact-SKU result supersedes an earlier layout failure", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    const failedLayout = layout({
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
    repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 1_000).toISOString(),
      retailerId: "bestbuy",
      retailerSku: "6688068",
      adapterVersion: BESTBUY_OBSERVER_VERSION,
      failureStage: "add_control",
      reasonCode: "add_control_missing",
      layout: failedLayout
    }), NOW + 2_000);
    assert.equal(repository.listRepairQueue().find((item) => item.reasonCode === "add_control_missing")?.status, "open");

    repository.record(device.id, diagnostic({
      observedAt: new Date(NOW + 3_000).toISOString(),
      retailerId: "bestbuy",
      retailerSku: "6688068",
      adapterVersion: BESTBUY_OBSERVER_VERSION,
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified",
      layout: layout({ explicitSkuInputCount: 0, exactSkuInputCount: 0,
        canonicalOfferInputCount: 0, canonicalOfferDistinctCount: 0,
        alternateOfferInputCount: 0, alternateOfferDistinctCount: 0 })
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

test("a passing no-click rehearsal supersedes an earlier live-add binding failure but not a runner failure", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    repository.record(device.id, diagnostic({
      adapterVersion: "amazon-add-v11",
      operation: "live_add",
      outcome: "failed",
      failureStage: "add_control",
      reasonCode: "add_control_changed"
    }), NOW + 2_000);
    assert.equal(repository.listRepairQueue(50, NOW + 2_000)[0]?.status, "open");
    repository.record(device.id, diagnostic({
      adapterVersion: "amazon-add-v11",
      operation: "rehearse_add",
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified",
      observedAt: new Date(NOW + 3_000).toISOString()
    }), NOW + 4_000);
    const bindingGroup = repository.listRepairQueue(50, NOW + 4_000).find((item) => item.operation === "live_add");
    assert.equal(bindingGroup?.status, "recovered", "a rehearsal that binds the exact product closes a live-add binding failure");
    assert.deepEqual(bindingGroup?.repairRetailerSkus, []);

    repository.record(device.id, diagnostic({
      retailerSku: "B0RUNNER01",
      adapterVersion: "amazon-add-v11",
      operation: "live_add",
      outcome: "failed",
      failureStage: "runner",
      reasonCode: "runner_failed",
      observedAt: new Date(NOW + 5_000).toISOString(),
      layout: layout({ addControlCount: 0, genericAddIntentCount: 0, scopedControlCount: 0 })
    }), NOW + 6_000);
    repository.record(device.id, diagnostic({
      retailerSku: "B0RUNNER01",
      adapterVersion: "amazon-add-v11",
      operation: "rehearse_add",
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified",
      observedAt: new Date(NOW + 7_000).toISOString()
    }), NOW + 8_000);
    const runnerGroup = repository.listRepairQueue(50, NOW + 8_000)
      .find((item) => item.operation === "live_add" && item.latestRetailerSku === "B0RUNNER01");
    assert.equal(runnerGroup?.status, "recovered", "infrastructure failures never open adapter repair work");
  } finally {
    db.close();
  }
});

test("an unresolved repair ages out after fourteen days and stops driving replays", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    repository.record(device.id, diagnostic(), NOW + 2_000);
    const day = 24 * 60 * 60_000;
    assert.equal(repository.listRepairQueue(50, NOW + 13 * day)[0]?.status, "open");
    const aged = repository.listRepairQueue(50, NOW + 15 * day)[0];
    assert.equal(aged?.status, "aged_out");
    assert.deepEqual(aged?.repairRetailerSkus, ["B0FB21526X"], "the unresolved SKU stays visible for maintainers");
    assert.deepEqual(repository.counts(NOW + 15 * day), {
      adapterDiagnosticEvents: 1,
      openAdapterRepairGroups: 0,
      recoveredAdapterRepairGroups: 0,
      agedOutAdapterRepairGroups: 1,
      supersededAdapterRepairGroups: 0
    });
  } finally {
    db.close();
  }
});

test("an unavailable product page is a rejected page-identity result that closes the exact SKU", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    repository.record(device.id, diagnostic(), NOW + 2_000);
    assert.equal(repository.listRepairQueue(50, NOW + 2_000)[0]?.status, "open");
    const unavailable = (): RetailerAdapterDiagnosticInput => diagnostic({
      outcome: "rejected",
      failureStage: "page_identity",
      reasonCode: "product_page_unavailable",
      observedAt: new Date(NOW + 3_000).toISOString(),
      layout: runtimeLayout()
    });
    assert.throws(() => repository.record(device.id, { ...unavailable(), outcome: "failed" }, NOW + 4_000), /rejected read-only page-identity/);
    assert.throws(() => repository.record(device.id, { ...unavailable(), operation: "rehearse_add", adapterVersion: "amazon-add-v11" }, NOW + 4_000), /rejected read-only page-identity/);
    const recorded = repository.record(device.id, { ...unavailable(), layout: { ...runtimeLayout(), pageKind: "other" } }, NOW + 4_000);
    assert.equal(recorded.reasonCode, "product_page_unavailable");
    const group = repository.listRepairQueue(50, NOW + 4_000).find((item) => item.repairSuggestions !== undefined && item.operation === "observe" && item.reasonCode === "offer_binding_ambiguous");
    assert.equal(group?.status, "recovered", "the unreachable product no longer keeps the layout group open");
  } finally {
    db.close();
  }
});

test("Target identity counts are adapter evidence, never Amazon offer fields", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    const targetLayout = (variationSkuCount: number) => layout({
      scopeKind: "buybox",
      addControlCount: 1,
      genericAddIntentCount: 0,
      scopedControlCount: 1,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      variationSkuCount,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0
    });
    const targetDiagnostic = (overrides: Partial<RetailerAdapterDiagnosticInput>) => diagnostic({
      retailerId: "target",
      retailerSku: "95280894",
      adapterVersion: RETAILER_OBSERVER_VERSIONS.target,
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified",
      ...overrides
    });
    // A real Target page carries several TCIN identities; the count is not
    // layout evidence and must neither reject the diagnostic nor change its
    // fingerprint.
    const withIdentities = repository.record(device.id, targetDiagnostic({
      observedAt: new Date(NOW + 1_000).toISOString(),
      layout: targetLayout(3)
    }), NOW + 2_000);
    assert.equal(withIdentities.layout.variationSkuCount, 0);
    const withoutIdentities = repository.record(device.id, targetDiagnostic({
      observedAt: new Date(NOW + 2_000).toISOString(),
      layout: targetLayout(0)
    }), NOW + 3_000);
    assert.notEqual(withoutIdentities.id, withIdentities.id);
    assert.equal(withoutIdentities.layoutFingerprint, withIdentities.layoutFingerprint);
    // Amazon offer inputs on a non-Amazon page remain a contract violation,
    // reported as a typed validation error the API maps to a 400.
    assert.throws(
      () => repository.record(device.id, targetDiagnostic({
        observedAt: new Date(NOW + 3_000).toISOString(),
        layout: { ...targetLayout(0), canonicalOfferInputCount: 1 }
      }), NOW + 4_000),
      AdapterDiagnosticValidationError
    );
    assert.throws(
      () => repository.record(device.id, { ...targetDiagnostic({}), attemptCount: 9 }, NOW + 5_000),
      AdapterDiagnosticValidationError
    );
  } finally {
    db.close();
  }
});

test("a closed repair group says whether the adapter was re-checked or the item merely changed state", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new AdapterDiagnosticRepository(db);
    const walmartLayout = layout({
      scopeKind: "buybox",
      addControlCount: 1,
      genericAddIntentCount: 0,
      scopedControlCount: 1,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      priceCandidateCount: 0
    });
    const walmart = (overrides: Partial<RetailerAdapterDiagnosticInput>) => diagnostic({
      retailerId: "walmart",
      retailerSku: "20895014480",
      adapterVersion: RETAILER_OBSERVER_VERSIONS.walmart,
      failureStage: "price_binding",
      reasonCode: "price_binding_missing",
      layout: walmartLayout,
      ...overrides
    });
    repository.record(device.id, walmart({ observedAt: new Date(NOW + 1_000).toISOString() }), NOW + 2_000);
    const openItem = repository.listRepairQueue(50, NOW + 2_000)[0];
    assert.equal(openItem?.status, "open");
    assert.equal(openItem?.recoveryKind, "");
    assert.equal(openItem?.currentVersionVerified, false);

    // The product sells out: a listing-state result closes the group but
    // proves nothing about the price selector.
    repository.record(device.id, walmart({
      observedAt: new Date(NOW + 3_000).toISOString(),
      outcome: "rejected",
      failureStage: "policy",
      reasonCode: "out_of_stock",
      layout: { ...walmartLayout, addControlCount: 0, scopedControlCount: 0 }
    }), NOW + 4_000);
    const restocked = repository.listRepairQueue(50, NOW + 4_000).find((item) => item.reasonCode === "price_binding_missing");
    assert.equal(restocked?.status, "recovered");
    assert.equal(restocked?.recoveryKind, "listing_state");
    assert.equal(restocked?.currentVersionVerified, false);

    // A current-version pass on the same layout is the proof.
    repository.record(device.id, walmart({
      observedAt: new Date(NOW + 5_000).toISOString(),
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified"
    }), NOW + 6_000);
    const verified = repository.listRepairQueue(50, NOW + 6_000).find((item) => item.reasonCode === "price_binding_missing");
    assert.equal(verified?.status, "recovered");
    assert.equal(verified?.recoveryKind, "passed");
    assert.equal(verified?.currentVersionVerified, true);
  } finally {
    db.close();
  }
});
