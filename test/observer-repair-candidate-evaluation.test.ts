import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  BESTBUY_OBSERVER_VERSION,
  type RetailerAdapterDiagnosticInput,
  type RetailerAdapterLayoutEvidence
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ObserverRepairCandidateRepository } from "../packages/database/src/observer-repair-candidate-repository.js";
import { ObserverRecipeRepository } from "../packages/database/src/observer-recipe-repository.js";
import { BackgroundMaintenanceHandler } from "../packages/engine/src/background-maintenance.js";
import { ObserverRecipeTrustAuthority } from "../packages/observer-registry/src/trust.js";

const NOW = new Date("2026-08-25T12:00:00.000Z").getTime();

function pairedDevice(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  return devices.pair({ pairingCode: code.code, extensionVersion: "0.47.0" }, NOW + 1_000);
}

function repairLayout(landmarkValue = "pdp-add-to-cart-control"): RetailerAdapterLayoutEvidence {
  return {
    schemaVersion: 1,
    pageKind: "product",
    scopeKind: "none",
    sellerShape: "none",
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
    priceCandidateCount: 1,
    quantityControlCount: 0,
    securityChallenge: false,
    interactiveBlock: "",
    repairLandmarks: [{
      field: "addControl",
      elementKind: "role_button",
      attribute: "data-testid",
      value: landmarkValue
    }]
  };
}

function diagnostic(
  retailerSku: string,
  observedAt: number,
  landmarkValue = "pdp-add-to-cart-control"
): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    retailerId: "bestbuy",
    retailerSku,
    adapterVersion: BESTBUY_OBSERVER_VERSION,
    operation: "observe",
    outcome: "failed",
    failureStage: "add_control",
    reasonCode: "add_control_selector_miss",
    attemptCount: 1,
    domChanged: false,
    layout: repairLayout(landmarkValue)
  };
}

function fiveFieldDiagnostic(retailerSku: string, observedAt: number): RetailerAdapterDiagnosticInput {
  return {
    ...diagnostic(retailerSku, observedAt),
    failureStage: "price_binding",
    reasonCode: "price_selector_miss",
    layout: {
      ...repairLayout(),
      scopeKind: "form",
      sellerShape: "legacy",
      fulfillmentShape: "shipping",
      addControlCount: 1,
      genericAddIntentCount: 1,
      genericAvailabilityCandidateCount: 1,
      genericPriceCandidateCount: 1,
      genericSellerCandidateCount: 1,
      genericFulfillmentCandidateCount: 1,
      scopedControlCount: 1,
      priceCandidateCount: 0,
      repairLandmarks: [
        { field: "availability", elementKind: "div", attribute: "data-testid", value: "product-availability-status" },
        { field: "unitPrice", elementKind: "span", attribute: "data-testid", value: "product-current-price" },
        { field: "seller", elementKind: "p", attribute: "data-testid", value: "seller-display-name" },
        { field: "fulfillment", elementKind: "div", attribute: "data-testid", value: "shipping-fulfillment-option" },
        { field: "addControl", elementKind: "button", attribute: "data-automation-id", value: "atc" }
      ]
    }
  };
}

test("the durable worker compiles mature repair evidence into one unsigned quarantined observer-only candidate", async () => {
  const db = new YoinkDatabase();
  try {
    const devices = [pairedDevice(db), pairedDevice(db), pairedDevice(db)];
    const diagnostics = new AdapterDiagnosticRepository(db);
    for (const [index, retailerSku] of ["6612619", "6669690", "6528565"].entries()) {
      diagnostics.record(
        devices[index]?.id ?? "",
        diagnostic(retailerSku, NOW + 2_000 + index),
        NOW + 3_000 + index
      );
    }
    const handler = new BackgroundMaintenanceHandler(db);
    const context = {
      principal: { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID },
      workerId: "observer_repair_candidate_worker",
      runtimeKind: "standalone" as const,
      runtimeVersion: "0.47.0",
      deploymentFingerprint: "a".repeat(64)
    };
    const first = await handler.execute(context, "observer_recipe_candidate_evaluation", NOW + 5_000);
    assert.deepEqual(first, {
      repairGroupsEvaluated: 1,
      matureRepairGroups: 1,
      unsupportedMatureSelectors: 0,
      selectorsEvaluated: 1,
      candidateFieldsEvaluated: 1,
      supportedRepairFields: 5,
      candidatesCreated: 1,
      candidatesReused: 0,
      candidatesDeferred: 0,
      expiredCandidates: 0,
      reviewedCandidates: 0,
      generatedCandidateLifetimeDays: 30,
      mutationAuthority: false,
      generatedCandidatesExecutable: false
    });
    const candidate = db.get<{
      id: string;
      retailerId: string;
      recipeVersion: string;
      minimumExtensionVersion: string;
      recipeJson: string;
      recipeFingerprint: string;
      lifecycleState: string;
      provenanceCode: string;
      signatureKeyId: string;
      signature: string;
      signedAt: string;
      trustManifestGeneration: number;
      trustManifestHash: string;
      killSwitch: number;
    }>(
      `SELECT id, retailer_id AS retailerId, recipe_version AS recipeVersion,
              minimum_extension_version AS minimumExtensionVersion,
              recipe_json AS recipeJson, recipe_fingerprint AS recipeFingerprint,
              lifecycle_state AS lifecycleState, provenance_code AS provenanceCode,
              signature_key_id AS signatureKeyId, signature, signed_at AS signedAt,
              trust_manifest_generation AS trustManifestGeneration,
              trust_manifest_hash AS trustManifestHash, kill_switch AS killSwitch
       FROM observer_recipe_candidates`
    );
    assert.ok(candidate);
    assert.equal(candidate.retailerId, "bestbuy");
    assert.match(candidate.recipeVersion, /^bestbuy-repair-[a-f0-9]{12}$/);
    assert.equal(candidate.minimumExtensionVersion, "0.47.0");
    assert.deepEqual(JSON.parse(candidate.recipeJson), {
      addControl: {
        mode: "disabled_state",
        selectors: ["[role='button'][data-testid='pdp-add-to-cart-control']"]
      }
    });
    assert.match(candidate.recipeFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(candidate.lifecycleState, "quarantined");
    assert.equal(candidate.provenanceCode, "privacy_bounded_repair_miner");
    assert.equal(candidate.signatureKeyId, "");
    assert.equal(candidate.signature, "");
    assert.equal(candidate.signedAt, "");
    assert.equal(candidate.trustManifestGeneration, 0);
    assert.equal(candidate.trustManifestHash, "");
    assert.equal(candidate.killSwitch, 0);
    assert.equal(db.get<{ reasonCode: string }>(
      "SELECT reason_code AS reasonCode FROM observer_recipe_lifecycle_events WHERE recipe_id = ?",
      candidate.id
    )?.reasonCode, "privacy_bounded_repair_candidate_generated");
    const audit = db.get<{ dataJson: string }>(
      "SELECT data_json AS dataJson FROM audit_events WHERE event_type = 'observer_recipe_repair_candidate_generated'"
    );
    assert.ok(audit);
    assert.deepEqual(Object.keys(JSON.parse(audit.dataJson)).sort(), [
      "executable",
      "fieldCount",
      "generated",
      "layoutFingerprint",
      "minimumDistinctDeviceCount",
      "minimumDistinctSkuCount",
      "mutationAuthority",
      "occurrenceCount",
      "recipeFingerprint",
      "retailerId",
      "selectorCount"
    ]);
    const recipeDurableState = JSON.stringify({
      recipes: db.all("SELECT * FROM observer_recipe_candidates"),
      lifecycle: db.all("SELECT * FROM observer_recipe_lifecycle_events"),
      audit: db.all("SELECT * FROM audit_events WHERE event_type = 'observer_recipe_repair_candidate_generated'")
    });
    for (const forbidden of [...devices.map((device) => device.token), "6612619", "6669690", "6528565", "DO_NOT_STORE"]) {
      assert.equal(recipeDurableState.includes(forbidden), false);
    }
    const registry = new ObserverRecipeRepository(db, ObserverRecipeTrustAuthority.ephemeral(NOW));
    assert.equal(registry.active("bestbuy", NOW + 6_000), null);
    const server = createYoinkServer({
      db,
      webRoot: join(process.cwd(), "apps", "web"),
      version: "0.47.0-test"
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as AddressInfo;
      const snapshot = await fetch(`http://127.0.0.1:${address.port}/api/v1/snapshot`).then(
        (response) => response.json()
      ) as {
        counts: Record<string, number>;
        observerRegistry: { mutationCapable: boolean; recipes: Array<Record<string, unknown>> };
      };
      assert.equal(snapshot.counts.generatedObserverRepairCandidates, 1);
      assert.equal(snapshot.counts.quarantinedGeneratedObserverRepairCandidates, 1);
      assert.equal(snapshot.observerRegistry.mutationCapable, false);
      assert.equal(snapshot.observerRegistry.recipes.length, 1);
      assert.equal(snapshot.observerRegistry.recipes[0]?.provenanceCode, "privacy_bounded_repair_miner");
      assert.equal(snapshot.observerRegistry.recipes[0]?.lifecycleState, "quarantined");
    } finally {
      server.close();
      await once(server, "close");
    }

    const second = await handler.execute(context, "observer_recipe_candidate_evaluation", NOW + 65_000);
    assert.equal(second.candidatesCreated, 0);
    assert.equal(second.candidatesReused, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM observer_recipe_candidates")?.count, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_lifecycle_events WHERE recipe_id = ?",
      candidate.id
    )?.count, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'observer_recipe_repair_candidate_generated'"
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("the durable worker compiles all five fixed read-only fields into one complete unsigned candidate", async () => {
  const db = new YoinkDatabase();
  try {
    const devices = [pairedDevice(db), pairedDevice(db), pairedDevice(db)];
    const diagnostics = new AdapterDiagnosticRepository(db);
    for (const [index, retailerSku] of ["6612619", "6669690", "6528565"].entries()) {
      diagnostics.record(
        devices[index]?.id ?? "",
        fiveFieldDiagnostic(retailerSku, NOW + 2_000 + index),
        NOW + 3_000 + index
      );
    }
    const result = await new BackgroundMaintenanceHandler(db).execute({
      principal: { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID },
      workerId: "observer_repair_candidate_worker",
      runtimeKind: "standalone",
      runtimeVersion: "0.48.0",
      deploymentFingerprint: "d".repeat(64)
    }, "observer_recipe_candidate_evaluation", NOW + 5_000);
    assert.deepEqual(result, {
      repairGroupsEvaluated: 1,
      matureRepairGroups: 1,
      unsupportedMatureSelectors: 0,
      selectorsEvaluated: 5,
      candidateFieldsEvaluated: 5,
      supportedRepairFields: 5,
      candidatesCreated: 1,
      candidatesReused: 0,
      candidatesDeferred: 0,
      expiredCandidates: 0,
      reviewedCandidates: 0,
      generatedCandidateLifetimeDays: 30,
      mutationAuthority: false,
      generatedCandidatesExecutable: false
    });
    const candidate = db.get<{ recipeJson: string; signature: string; lifecycleState: string }>(
      `SELECT recipe_json AS recipeJson, signature, lifecycle_state AS lifecycleState
       FROM observer_recipe_candidates`
    );
    assert.ok(candidate);
    assert.deepEqual(JSON.parse(candidate.recipeJson), {
      availability: { mode: "text", selectors: ["div[data-testid='product-availability-status']"] },
      unitPrice: { mode: "text", selectors: ["span[data-testid='product-current-price']"] },
      seller: { mode: "text", selectors: ["p[data-testid='seller-display-name']"] },
      fulfillment: { mode: "text", selectors: ["div[data-testid='shipping-fulfillment-option']"] },
      addControl: { mode: "disabled_state", selectors: ["button[data-automation-id='atc']"] }
    });
    assert.equal(candidate.signature, "");
    assert.equal(candidate.lifecycleState, "quarantined");
    const durable = JSON.stringify({
      candidate: db.all("SELECT * FROM observer_recipe_candidates"),
      lifecycle: db.all("SELECT * FROM observer_recipe_lifecycle_events"),
      audit: db.all("SELECT * FROM audit_events WHERE event_type = 'observer_recipe_repair_candidate_generated'")
    });
    for (const forbidden of [
      "$19.99", "Sold and shipped by Best Buy", "In stock", "Shipping",
      ...devices.map((device) => device.token), "6612619", "6669690", "6528565"
    ]) {
      assert.equal(durable.includes(forbidden), false);
    }
  } finally {
    db.close();
  }
});

test("the signing-free candidate repository rejects weak, arbitrary, or secret-shaped repair input", () => {
  const db = new YoinkDatabase();
  try {
    const candidates = new ObserverRepairCandidateRepository(db);
    const valid = {
      retailerId: "bestbuy" as const,
      layoutFingerprint: "b".repeat(64),
      fields: {
        addControl: {
          mode: "disabled_state" as const,
          selectors: ["button[data-testid='pdp-add-to-cart-control']"]
        }
      },
      minimumExtensionVersion: "0.47.0",
      occurrenceCount: 3,
      minimumDistinctDeviceCount: 3,
      minimumDistinctSkuCount: 2
    };
    assert.throws(() => candidates.ensure({ ...valid, minimumDistinctDeviceCount: 2 }), /evidence/);
    assert.throws(() => candidates.ensure({ ...valid, minimumDistinctSkuCount: 1 }), /evidence/);
    assert.throws(() => candidates.ensure({ ...valid, occurrenceCount: 2 }), /evidence/);
    assert.throws(() => candidates.ensure({ ...valid, minimumExtensionVersion: "worker-test" }), /evidence/);
    assert.throws(() => candidates.ensure({
      ...valid,
      fields: { addControl: { mode: "disabled_state", selectors: ["#checkout"] } }
    }), /compatible/);
    assert.throws(() => candidates.ensure({
      ...valid,
      fields: { addControl: { mode: "disabled_state", selectors: ["button[name='account-add-to-cart']"] } }
    }), /compatible/);
    assert.throws(() => candidates.ensure({
      ...valid,
      fields: { addControl: { mode: "disabled_state", selectors: ["button[data-testid='pdp:add:to:cart:control']"] } }
    }), /compatible/);
    assert.throws(() => candidates.ensure({
      ...valid,
      fields: {
        addControl: {
          mode: "disabled_state",
          selectors: [
            "button[data-testid='pdp-add-to-cart-control']",
            "button[data-testid='pdp-add-to-cart-control']"
          ]
        }
      }
    }), /unique/);
    assert.throws(() => candidates.ensure({
      ...valid,
      fields: { unitPrice: { mode: "disabled_state", selectors: ["span[data-testid='product-price']"] } }
    }), /fixed read-only schema/);
    assert.throws(() => candidates.ensure({
      ...valid,
      fields: { addControl: { mode: "disabled_state", selectors: ["div[data-testid='pdp-add-to-cart-control']"] } }
    }), /compatible/);
    assert.throws(() => candidates.ensure({
      ...valid,
      fields: { unitPrice: { mode: "text", selectors: ["input[data-testid='product-price']"] } }
    }), /compatible/);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM observer_recipe_candidates")?.count, 0);
  } finally {
    db.close();
  }
});

test("generated candidate identity is replay-safe within a package and collision-safe across package versions", () => {
  const db = new YoinkDatabase();
  try {
    const candidates = new ObserverRepairCandidateRepository(db);
    const input = {
      retailerId: "bestbuy" as const,
      layoutFingerprint: "c".repeat(64),
      fields: {
        addControl: {
          mode: "disabled_state" as const,
          selectors: ["button[data-testid='pdp-add-to-cart-control']"]
        }
      },
      minimumExtensionVersion: "0.47.0",
      occurrenceCount: 3,
      minimumDistinctDeviceCount: 3,
      minimumDistinctSkuCount: 2
    };
    const first = candidates.ensure(input, NOW);
    const replay = candidates.ensure(input, NOW + 1_000);
    const nextPackage = candidates.ensure({ ...input, minimumExtensionVersion: "0.48.0" }, NOW + 2_000);
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.id, first.id);
    assert.equal(nextPackage.created, true);
    assert.notEqual(nextPackage.id, first.id);
    assert.notEqual(nextPackage.recipeVersion, first.recipeVersion);
    assert.notEqual(nextPackage.recipeFingerprint, first.recipeFingerprint);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM observer_recipe_candidates")?.count, 2);
  } finally {
    db.close();
  }
});

test("the worker records and skips mature repair landmarks that cannot satisfy the recipe selector grammar", async () => {
  const db = new YoinkDatabase();
  try {
    const devices = [pairedDevice(db), pairedDevice(db), pairedDevice(db)];
    const diagnostics = new AdapterDiagnosticRepository(db);
    for (const [index, retailerSku] of ["6612619", "6669690", "6528565"].entries()) {
      diagnostics.record(
        devices[index]?.id ?? "",
        diagnostic(retailerSku, NOW + 2_000 + index, "pdp:add:to:cart:control"),
        NOW + 3_000 + index
      );
    }
    const result = await new BackgroundMaintenanceHandler(db).execute({
      principal: { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID },
      workerId: "observer_repair_candidate_worker",
      runtimeKind: "standalone",
      runtimeVersion: "0.47.0",
      deploymentFingerprint: "a".repeat(64)
    }, "observer_recipe_candidate_evaluation", NOW + 5_000);
    assert.deepEqual(result, {
      repairGroupsEvaluated: 1,
      matureRepairGroups: 0,
      unsupportedMatureSelectors: 1,
      selectorsEvaluated: 0,
      candidateFieldsEvaluated: 0,
      supportedRepairFields: 5,
      candidatesCreated: 0,
      candidatesReused: 0,
      candidatesDeferred: 0,
      expiredCandidates: 0,
      reviewedCandidates: 0,
      generatedCandidateLifetimeDays: 30,
      mutationAuthority: false,
      generatedCandidatesExecutable: false
    });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM observer_recipe_candidates")?.count, 0);
  } finally {
    db.close();
  }
});

test("the standalone candidate compiler has no observer signing-key dependency", () => {
  const sources = [
    readFileSync(join(process.cwd(), "packages", "engine", "src", "observer-recipe-candidate-evaluation.ts"), "utf8"),
    readFileSync(join(process.cwd(), "packages", "database", "src", "observer-repair-candidate-repository.ts"), "utf8")
  ];
  for (const source of sources) {
    assert.doesNotMatch(source, /observer-registry|ObserverRecipeTrustAuthority|ObserverRecipeSigner|privateKey/);
  }
  assert.match(sources[1] ?? "", /'quarantined'.*'', 0/s);
  assert.match(sources[1] ?? "", /mutationAuthority: false/);
});

test("generated observer candidates are absent from every packaged mutation runner", () => {
  for (const filename of ["target-action.ts", "walmart-action.ts", "amazon-action.ts", "bestbuy-action.ts"]) {
    const source = readFileSync(join(process.cwd(), "apps", "extension", "src", filename), "utf8");
    assert.doesNotMatch(source, /observer.?recipe|privacy_bounded_repair_miner/i);
  }
});
