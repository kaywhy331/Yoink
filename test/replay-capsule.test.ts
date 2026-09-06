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
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  BESTBUY_SELECTOR_PACK_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  WALMART_SELECTOR_PACK_VERSION,
  type RetailerAdapterDiagnosticInput
} from "../packages/contracts/src/index.js";

const ROOT = process.cwd();
const URL = "https://www.walmart.com/ip/20895014480";

test("source and packaged replay agree on the Best Buy Pickup incident and exact no-click action", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-bestbuy-replay-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const url = "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ";
  const html = readFileSync(join(ROOT, "test/fixtures/retailers/bestbuy-lorcana-pickup-buy-now.html"), "utf8");
  const dom = new JSDOM(html, { url });
  const capsule = await captureEvidenceCapsule({
    document: dom.window.document,
    url,
    retailerId: "bestbuy",
    retailerSku: "6667316",
    diagnostic: {
      ...diagnostic(), retailerId: "bestbuy", retailerSku: "6667316",
      adapterVersion: BESTBUY_OBSERVER_VERSION, packVersion: BESTBUY_SELECTOR_PACK_VERSION,
      outcome: "rejected", failureStage: "policy", reasonCode: "fulfillment_not_supported"
    },
    trigger: "diagnostic_failed",
    observerVersion: BESTBUY_OBSERVER_VERSION,
    addAdapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
    packVersion: BESTBUY_SELECTOR_PACK_VERSION,
    extensionVersion: "1.22.5",
    requiredFulfillment: "shipping",
    capturedAt: "2026-09-05T14:59:37.045Z",
    id: "cap_replaybestbuy6667316",
    environment: { isVisible: () => true, rect: () => ({ x: 0, y: 0, width: 100, height: 40 }) }
  });
  const path = join(directory, "bestbuy.json");
  writeFileSync(path, JSON.stringify(capsule));
  for (const bundle of [[], ["--bundle"]]) {
    const shipping = replay(path, ...bundle, "--expect", "reproduce", "--json");
    assert.equal(shipping.status, 0, shipping.stderr + shipping.stdout);
    const pickup = replay(path, ...bundle, "--fulfillment", "pickup", "--expect", "pass", "--json");
    assert.equal(pickup.status, 0, pickup.stderr + pickup.stdout);
  }
  writeFileSync(path, JSON.stringify({ ...capsule, operation: "rehearse_add", requiredFulfillment: "pickup" }));
  for (const bundle of [[], ["--bundle"]]) {
    const result = replay(path, ...bundle, "--expect", "pass", "--json");
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const proof = JSON.parse(result.stdout);
    assert.equal(proof.rehearsal.wouldClick, true);
    assert.equal(proof.observation.unitPriceCents, 2499);
    assert.equal(proof.observation.sellerType, "first_party");
  }
});

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

test("Athleta repair replay rejoins the child SKU on the exact product path and preserves both captured selections", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-athleta-replay-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of ["scrunchie", "headband"]) {
    const base = join(ROOT, "test/fixtures/capsules/athleta", `${name}-product`);
    const meta = JSON.parse(readFileSync(base + ".json", "utf8"));
    const capsule = { ...meta, id: meta.capsuleId, ...meta.expectations,
      snapshot: { encoding: "gzip+base64", html: readFileSync(base + ".html.gz").toString("base64") } };
    assert.equal(capsule.url, "https://athleta.gap.com/browse/product.do");
    const path = join(directory, `${name}.json`);
    writeFileSync(path, JSON.stringify(capsule));
    const proofs = [[], ["--bundle"]].map(flags => {
      const result = replay(path, ...flags, "--expect", "pass", "--json");
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return JSON.parse(result.stdout);
    });
    assert.deepEqual(proofs[0].actual, meta.expectations);
    assert.deepEqual(proofs[0].actual, proofs[1].actual);
    for (const proof of proofs) {
      assert.equal(proof.rehearsal.ok, true);
      assert.equal(proof.rehearsal.wouldClick, true);
      assert.equal(proof.observation.retailerSku, meta.retailerSku);
      assert.equal(proof.observation.canonicalUrl, `${capsule.url}?pid=${meta.retailerSku}`);
    }
    // An unrelated capsule identity cannot replace the SKU bound in product metadata.
    writeFileSync(path, JSON.stringify({ ...capsule, retailerSku: "9999999990000" }));
    const mismatched = replay(path, "--bundle", "--json");
    assert.equal(mismatched.status, 0, mismatched.stderr);
    assert.notEqual(JSON.parse(mismatched.stdout).actual.outcome, "passed");
  }
});

test("all three added stores replay both captured offers in source and packaged runners and reject another identity", t => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-additional-replay-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [retailerId, names] of [
    ["audioadvice", ["coupler", "caps"]], ["bananarepublic", ["bandana", "beanie"]],
    ["bananarepublicfactory", ["mixed-media", "patterned"]]
  ] as const) for (const name of names) {
    const base = join(ROOT, "test/fixtures/capsules", retailerId, `${name}-product`);
    const meta = JSON.parse(readFileSync(base + ".json", "utf8"));
    const capsule = { ...meta, id: meta.capsuleId, ...meta.expectations,
      snapshot: { encoding: "gzip+base64", html: readFileSync(base + ".html.gz").toString("base64") } };
    assert.equal(new globalThis.URL(capsule.url).search, "");
    const path = join(directory, `${retailerId}-${name}.json`);
    writeFileSync(path, JSON.stringify(capsule));
    const results = [[], ["--bundle"]].map(flags => {
      const result = replay(path, ...flags, "--expect", "pass", "--json");
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return JSON.parse(result.stdout);
    });
    assert.deepEqual(results[0].actual, meta.expectations);
    assert.deepEqual(results[0].actual, results[1].actual);
    for (const result of results) {
      assert.equal(result.rehearsal.ok, true);
      assert.equal(result.rehearsal.wouldClick, true);
      assert.equal(result.observation.retailerSku, meta.retailerSku);
      assert.equal(result.observation.canonicalUrl, `${capsule.url}?${retailerId === "audioadvice" ? "variant" : "pid"}=${meta.retailerSku}`);
    }
    writeFileSync(path, JSON.stringify({ ...capsule, retailerSku: retailerId === "bananarepublic" ? "9999999990000" : "99999999990000" }));
    const mismatch = replay(path, "--bundle", "--json");
    assert.equal(mismatch.status, 0, mismatch.stderr);
    assert.notEqual(JSON.parse(mismatch.stdout).actual.outcome, "passed");
  }
});
