import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
// @ts-expect-error jsdom intentionally ships without bundled TypeScript declarations here.
import { JSDOM } from "jsdom";
import { captureEvidenceCapsule } from "../apps/extension/src/evidence-capsule.js";
import {
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  WALMART_SELECTOR_PACK_VERSION,
  type RetailerAdapterDiagnosticInput
} from "../packages/contracts/src/index.js";

const ROOT = process.cwd();
const URL = "https://www.walmart.com/ip/20895014480";

function diagnostic(): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: "2026-09-04T20:00:00.000Z",
    retailerId: "walmart",
    retailerSku: "20895014480",
    adapterVersion: WALMART_OBSERVER_VERSION,
    packVersion: WALMART_SELECTOR_PACK_VERSION,
    operation: "observe",
    outcome: "rejected",
    failureStage: "availability_binding",
    reasonCode: "listing_unavailable_layout",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "none",
      sellerShape: "legacy",
      fulfillmentShape: "none",
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
      interactiveBlock: ""
    }
  };
}

function replay(path: string, ...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/replay-capsule.mjs", path, ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

test("the replay command reproduces a sanitized structured Walmart capsule and uses its trace", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-replay-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const html = readFileSync(join(ROOT, "test/fixtures/retailers/walmart-unavailable-structured.html"), "utf8");
  const dom = new JSDOM(html, { url: URL });
  const capsule = await captureEvidenceCapsule({
    document: dom.window.document,
    url: URL,
    retailerId: "walmart",
    retailerSku: "20895014480",
    diagnostic: diagnostic(),
    trigger: "diagnostic_failed",
    observerVersion: WALMART_OBSERVER_VERSION,
    addAdapterVersion: WALMART_ADD_ADAPTER_VERSION,
    packVersion: WALMART_SELECTOR_PACK_VERSION,
    extensionVersion: "1.22.0",
    capturedAt: "2026-09-04T20:00:00.000Z",
    id: "cap_replaywalmart20895014480",
    environment: {
      isVisible: () => true,
      rect: () => ({ x: 0, y: 0, width: 100, height: 40 })
    }
  });
  const capsulePath = join(directory, "walmart.json");
  writeFileSync(capsulePath, JSON.stringify(capsule));

  const source = replay(capsulePath, "--expect", "reproduce", "--json");
  assert.equal(source.status, 0, source.stderr);
  const result = JSON.parse(source.stdout);
  assert.deepEqual(result.actual, {
    outcome: "rejected",
    failureStage: "availability_binding",
    reasonCode: "listing_unavailable_layout"
  });
  assert.ok(result.trace.some((entry: Record<string, unknown>) => entry.step === "structured_offer"
    && entry.condition === "product.availabilityStatus"
    && entry.actual === "OUT_OF_STOCK"
    && entry.passed === false));
  assert.ok(result.trace.some((entry: Record<string, unknown>) => entry.step === "price"
    && Number(entry.matched) > 0 && entry.scoped === 0));

  const bundled = replay(capsulePath, "--bundle", "--expect", "reproduce", "--json");
  assert.equal(bundled.status, 0, bundled.stderr);

  const changed = { ...capsule, outcome: "passed", failureStage: "complete", reasonCode: "verified" };
  const changedPath = join(directory, "changed.json");
  writeFileSync(changedPath, JSON.stringify(changed));
  assert.equal(replay(changedPath, "--expect", "reproduce", "--json").status, 1);
  assert.equal(replay(join(directory, "missing.json"), "--expect", "reproduce").status, 2);

  // Keep both add-version imports live so skew in the test setup is caught by TypeScript.
  assert.notEqual(TARGET_ADD_ADAPTER_VERSION, capsule.addAdapterVersion);
});
