import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error jsdom intentionally ships without bundled TypeScript declarations here.
import { JSDOM } from "jsdom";
import { captureEvidenceCapsule } from "../apps/extension/src/evidence-capsule.js";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import {
  POKEMONCENTER_OBSERVER_VERSION,
  RETAILERS_SELECTOR_PACK_VERSION,
  TARGET_OBSERVER_VERSION,
  TARGET_SELECTOR_PACK_VERSION,
  type RetailerAdapterDiagnosticInput,
  type RetailerAdapterLayoutEvidence
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { EvidenceCapsuleStore } from "../packages/database/src/evidence-capsule-store.js";
// @ts-expect-error The repair CLI is intentionally an importable JavaScript command module.
import { applyRepair, inspectRepair } from "../scripts/repair.mjs";

const SKU = "1011483414";
const URL = `https://www.target.com/p/fixture/A-${SKU}`;

function layout(): RetailerAdapterLayoutEvidence {
  return {
    schemaVersion: 1, pageKind: "product", scopeKind: "none", sellerShape: "legacy", fulfillmentShape: "shipping",
    addControlCount: 0, genericAddIntentCount: 1, scopedControlCount: 0, explicitSkuInputCount: 0,
    exactSkuInputCount: 0, variationSkuCount: 0, canonicalOfferInputCount: 0, canonicalOfferDistinctCount: 0,
    alternateOfferInputCount: 0, alternateOfferDistinctCount: 0, priceCandidateCount: 1,
    quantityControlCount: 0, securityChallenge: false, interactiveBlock: ""
  };
}

test("repair command names the failed pack field, candidate, and promotion command without editing", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "yoink-repair-command-"));
  const databasePath = join(dataDirectory, "yoink.sqlite");
  const now = Date.now();
  let fingerprint = "";
  try {
    const db = new YoinkDatabase(databasePath);
    const devices = new DeviceRepository(db);
    const pairing = devices.createPairingCode(now - 2_000);
    const device = devices.pair({ pairingCode: pairing.code }, now - 1_000);
    const diagnostic: RetailerAdapterDiagnosticInput = {
      contractVersion: 1,
      observedAt: new Date(now).toISOString(),
      retailerId: "target",
      retailerSku: SKU,
      adapterVersion: TARGET_OBSERVER_VERSION,
      packVersion: TARGET_SELECTOR_PACK_VERSION,
      operation: "observe",
      outcome: "failed",
      failureStage: "add_control",
      reasonCode: "add_control_selector_miss",
      attemptCount: 1,
      domChanged: false,
      layout: layout()
    };
    fingerprint = new AdapterDiagnosticRepository(db).record(device.id, diagnostic, now + 100).layoutFingerprint;
    const dom = new JSDOM(readFileSync(join(process.cwd(), "test", "fixtures", "target", "product-selector-miss.html"), "utf8"), { url: URL });
    const capsule = await captureEvidenceCapsule({
      id: "cap_REPAIRCOMMAND0000000000000001",
      document: dom.window.document,
      url: URL,
      retailerId: "target",
      retailerSku: SKU,
      diagnostic,
      trigger: "diagnostic_failed",
      observerVersion: TARGET_OBSERVER_VERSION,
      addAdapterVersion: "target-add-v11",
      packVersion: TARGET_SELECTOR_PACK_VERSION,
      extensionVersion: "1.22.0",
      trace: [],
      capturedAt: new Date(now).toISOString(),
      environment: { isVisible: () => true }
    });
    new EvidenceCapsuleStore(dataDirectory).accept(capsule, new Date(now + 200).toISOString());
    db.close();

    const result = await inspectRepair({
      identifier: `target:${fingerprint}`,
      dataDirectory,
      databasePath,
      json: false
    });
    assert.equal(result.incident.diagnosticClass, "adapter_defect");
    assert.equal(result.pack.field, "addControl");
    assert.ok(result.pack.selectors.every((selector: { matched: number }) => selector.matched === 0));
    assert.ok(result.candidates.some((candidate: { attributes: Record<string, string> }) =>
      candidate.attributes["data-test"] === "new-cart-action"));
    assert.equal(result.replay.reproduced, true);
    assert.match(result.promoteCommand, /npm run capsule:promote -- cap_REPAIRCOMMAND/);
    assert.match(result.promoteCommand, /--expect-reason add_control_selector_miss/);
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("repair --apply proves a selector by replay before it stays in the pack, and restores the pack otherwise", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "yoink-repair-apply-"));
  const packRoot = mkdtempSync(join(tmpdir(), "yoink-repair-packs-"));
  const databasePath = join(dataDirectory, "yoink.sqlite");
  const now = Date.now();
  let fingerprint = "";
  try {
    for (const name of readdirSync(join(process.cwd(), "packages", "browser-adapters", "packs"))) {
      copyFileSync(join(process.cwd(), "packages", "browser-adapters", "packs", name), join(packRoot, name));
    }
    const db = new YoinkDatabase(databasePath);
    const devices = new DeviceRepository(db);
    const pairing = devices.createPairingCode(now - 2_000);
    const device = devices.pair({ pairingCode: pairing.code }, now - 1_000);
    const diagnostic: RetailerAdapterDiagnosticInput = {
      contractVersion: 1,
      observedAt: new Date(now).toISOString(),
      retailerId: "target",
      retailerSku: SKU,
      adapterVersion: TARGET_OBSERVER_VERSION,
      packVersion: TARGET_SELECTOR_PACK_VERSION,
      operation: "observe",
      outcome: "failed",
      failureStage: "add_control",
      reasonCode: "add_control_selector_miss",
      attemptCount: 1,
      domChanged: false,
      layout: layout()
    };
    fingerprint = new AdapterDiagnosticRepository(db).record(device.id, diagnostic, now + 100).layoutFingerprint;
    const dom = new JSDOM(readFileSync(join(process.cwd(), "test", "fixtures", "target", "product-selector-miss.html"), "utf8"), { url: URL });
    const capsule = await captureEvidenceCapsule({
      id: "cap_REPAIRAPPLY000000000000000001",
      document: dom.window.document,
      url: URL,
      retailerId: "target",
      retailerSku: SKU,
      diagnostic,
      trigger: "diagnostic_failed",
      observerVersion: TARGET_OBSERVER_VERSION,
      addAdapterVersion: "target-add-v11",
      packVersion: TARGET_SELECTOR_PACK_VERSION,
      extensionVersion: "1.22.0",
      trace: [],
      capturedAt: new Date(now).toISOString(),
      environment: { isVisible: () => true }
    });
    new EvidenceCapsuleStore(dataDirectory).accept(capsule, new Date(now + 200).toISOString());
    db.close();

    const registryPath = join(packRoot, "add-lanes.ts");
    copyFileSync(join(process.cwd(), "packages", "contracts", "src", "add-lanes.ts"), registryPath);
    const registryBefore = readFileSync(registryPath, "utf8");
    const contractsPath = join(packRoot, "index.ts");
    copyFileSync(join(process.cwd(), "packages", "contracts", "src", "index.ts"), contractsPath);
    const contractsBefore = readFileSync(contractsPath, "utf8");
    const packBefore = readFileSync(join(packRoot, "target.json"), "utf8");
    const calls: string[] = [];
    const hooks = (replayStatus: number) => ({
      regenerate: () => { calls.push("regenerate"); return { status: 0, output: "" }; },
      replay: (capsuleId: string) => { calls.push(`replay:${capsuleId}`); return { status: replayStatus, output: replayStatus ? "not reproduced" : "" }; }
    });
    const options = {
      identifier: `target:${fingerprint}`,
      dataDirectory,
      databasePath,
      json: false,
      selector: "button[data-test='new-cart-action']",
      packRoot,
      registryPath,
      contractsPath
    };

    const failed = await applyRepair(options, hooks(1));
    assert.equal(failed.applied, false);
    assert.equal(failed.failedStep, "replay");
    assert.equal(readFileSync(join(packRoot, "target.json"), "utf8"), packBefore, "a failed replay restores the pack byte for byte");
    assert.equal(readFileSync(registryPath, "utf8"), registryBefore, "a failed replay restores the lane registry too");
    assert.equal(readFileSync(contractsPath, "utf8"), contractsBefore, "a failed replay restores the contracts constant too");
    assert.equal(readdirSync(packRoot).some((name) => name.includes("repair-backup")), false);

    const applied = await applyRepair(options, hooks(0));
    assert.equal(applied.applied, true);
    assert.equal(applied.field, "addControl");
    assert.equal(applied.previousVersion, TARGET_SELECTOR_PACK_VERSION);
    assert.equal(applied.packVersion, TARGET_SELECTOR_PACK_VERSION.replace(/v(\d+)$/, (_match, digits: string) => `v${Number(digits) + 1}`));
    const pack = JSON.parse(readFileSync(join(packRoot, "target.json"), "utf8")) as { packVersion: string; fields: Record<string, { selectors: string[] }> };
    assert.equal(pack.packVersion, applied.packVersion);
    assert.ok(pack.fields.addControl?.selectors.includes("button[data-test='new-cart-action']"));
    const lock = JSON.parse(readFileSync(join(packRoot, "lock.json"), "utf8")) as { packs: Record<string, { packVersion: string }> };
    assert.equal(lock.packs["target.json"]?.packVersion, applied.packVersion);
    assert.ok(readFileSync(registryPath, "utf8").includes(`packVersion: "${applied.packVersion}"`), "the lane registry declares the new pack version");
    assert.equal(readFileSync(registryPath, "utf8").includes(`packVersion: "${TARGET_SELECTOR_PACK_VERSION}"`), false);
    assert.ok(readFileSync(contractsPath, "utf8").includes(`TARGET_SELECTOR_PACK_VERSION = "${applied.packVersion}"`), "the contracts constant follows the pack");
    assert.equal(readFileSync(join(packRoot, "target.json"), "utf8").split("\n").filter((line) => line.includes("\"selectors\"")).length, 12,
      "the pack keeps its one-line-per-field layout");
    // Each attempt regenerates the packaged version file before replaying; a
    // failed replay regenerates once more after the pack is restored.
    assert.deepEqual(calls, [
      "regenerate", "replay:cap_REPAIRAPPLY000000000000000001", "regenerate",
      "regenerate", "replay:cap_REPAIRAPPLY000000000000000001"
    ]);
    assert.match(applied.promoteCommand, /--expect-reason verified/);
    assert.equal(readdirSync(packRoot).some((name) => name.includes("repair-backup")), false);
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
    rmSync(packRoot, { recursive: true, force: true });
  }
});

test("repair --apply on the shared retailers pack moves every add lane that declares it (PLAT-12)", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "yoink-repair-shared-"));
  const packRoot = mkdtempSync(join(tmpdir(), "yoink-repair-shared-packs-"));
  const sku = "10-10320-101";
  const url = `https://www.pokemoncenter.com/product/${sku}/fixture`;
  const now = Date.now();
  try {
    for (const name of readdirSync(join(process.cwd(), "packages", "browser-adapters", "packs"))) {
      copyFileSync(join(process.cwd(), "packages", "browser-adapters", "packs", name), join(packRoot, name));
    }
    const diagnostic: RetailerAdapterDiagnosticInput = {
      contractVersion: 1,
      observedAt: new Date(now).toISOString(),
      retailerId: "pokemoncenter",
      retailerSku: sku,
      adapterVersion: POKEMONCENTER_OBSERVER_VERSION,
      packVersion: RETAILERS_SELECTOR_PACK_VERSION,
      operation: "observe",
      outcome: "failed",
      failureStage: "price_binding",
      reasonCode: "price_unavailable",
      attemptCount: 1,
      domChanged: false,
      layout: layout()
    };
    const dom = new JSDOM(readFileSync(join(process.cwd(), "test", "fixtures", "retailers", "pokemoncenter-in-stock.html"), "utf8"), { url });
    const capsule = await captureEvidenceCapsule({
      id: "cap_REPAIRSHARED00000000000000001",
      document: dom.window.document,
      url,
      retailerId: "pokemoncenter",
      retailerSku: sku,
      diagnostic,
      trigger: "diagnostic_failed",
      observerVersion: POKEMONCENTER_OBSERVER_VERSION,
      addAdapterVersion: "pokemoncenter-add-v1",
      packVersion: RETAILERS_SELECTOR_PACK_VERSION,
      extensionVersion: "1.22.0",
      trace: [],
      capturedAt: new Date(now).toISOString(),
      environment: { isVisible: () => true }
    });
    new EvidenceCapsuleStore(dataDirectory).accept(capsule, new Date(now + 200).toISOString());

    const registryPath = join(packRoot, "add-lanes.ts");
    copyFileSync(join(process.cwd(), "packages", "contracts", "src", "add-lanes.ts"), registryPath);
    const contractsPath = join(packRoot, "index.ts");
    copyFileSync(join(process.cwd(), "packages", "contracts", "src", "index.ts"), contractsPath);
    const sharing = Object.values(ADD_LANES).filter((lane) => lane.packVersion === RETAILERS_SELECTOR_PACK_VERSION).length;
    assert.ok(sharing > 1, "several add lanes share the retailers pack");
    const applied = await applyRepair({
      identifier: "cap_REPAIRSHARED00000000000000001",
      dataDirectory,
      databasePath: join(dataDirectory, "missing.sqlite"),
      json: false,
      selector: "[data-testid='repair-price']",
      packRoot,
      registryPath,
      contractsPath
    }, {
      regenerate: () => ({ status: 0, output: "" }),
      replay: () => ({ status: 0, output: "" })
    });
    assert.equal(applied.applied, true, applied.output);
    assert.equal(applied.previousVersion, RETAILERS_SELECTOR_PACK_VERSION);
    const registry = readFileSync(registryPath, "utf8");
    assert.equal(registry.includes(`packVersion: "${RETAILERS_SELECTOR_PACK_VERSION}"`), false, "no lane keeps the old shared version");
    assert.equal(registry.split(`packVersion: "${applied.packVersion}"`).length - 1, sharing, "every sharing lane names the new version");
    assert.ok(readFileSync(contractsPath, "utf8").includes(`RETAILERS_SELECTOR_PACK_VERSION = "${applied.packVersion}"`));
    const pack = JSON.parse(readFileSync(join(packRoot, "retailers.json"), "utf8")) as { packVersion: string };
    assert.equal(pack.packVersion, applied.packVersion);
    assert.equal(readdirSync(packRoot).some((name) => name.includes("repair-backup")), false);
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
    rmSync(packRoot, { recursive: true, force: true });
  }
});
