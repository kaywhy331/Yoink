import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error jsdom intentionally ships without bundled TypeScript declarations here.
import { JSDOM } from "jsdom";
import { captureEvidenceCapsule } from "../apps/extension/src/evidence-capsule.js";
import {
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
import { inspectRepair } from "../scripts/repair.mjs";

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
      addAdapterVersion: "target-add-v8",
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
