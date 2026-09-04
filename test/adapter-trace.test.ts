import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { collectRetailerShadowAttempt } from "../apps/extension/src/retailer-shadow.js";
import { collectTargetShadowAttempt } from "../apps/extension/src/target-shadow.js";
import { commitTargetAdd, prepareTargetAdd, type TargetAddJob } from "../apps/extension/src/target-action.js";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import {
  createAdapterTraceBuffer,
  TARGET_ADD_ADAPTER_VERSION,
  type AdapterTraceEntry
} from "../packages/contracts/src/index.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } };
};
const FIXTURES = join(process.cwd(), "test", "fixtures");
const TARGET_URL = "https://www.target.com/p/fixture/A-1011483414";
const NOW = new Date("2026-09-04T12:00:00.000Z").getTime();

function fixture(path: string, url: string): Document {
  return new JSDOM(readFileSync(join(FIXTURES, path), "utf8"), { url }).window.document;
}

test("Walmart structured rejection records the failed condition and unscoped price selectors", () => {
  const document = fixture(
    "retailers/walmart-unavailable-structured.html",
    "https://www.walmart.com/ip/fixture/20895014480"
  );
  const attempt = collectRetailerShadowAttempt(
    document,
    document.URL,
    "walmart",
    "shipping",
    1,
    false,
    { trace: { record() {} } }
  );
  const trace = attempt.trace ?? [];
  const failed = trace.findIndex((entry) => entry.step === "structured_offer"
    && entry.condition === "product.availabilityStatus"
    && entry.actual === "OUT_OF_STOCK"
    && entry.passed === false);
  assert.ok(failed >= 0);
  assert.ok(trace.slice(failed + 1).some((entry) => entry.step === "price"
    && Number(entry.matched) > 0 && entry.scoped === 0));
});

test("Target selector miss traces every packaged selector and its semantic candidate", () => {
  const document = fixture("target/product-selector-miss.html", TARGET_URL);
  const attempt = collectTargetShadowAttempt(
    document, TARGET_URL, "shipping", 1, false, { trace: { record() {} } }
  );
  const addEntries = (attempt.trace ?? []).filter((entry) => entry.step === "add_control");
  for (const selector of [
    "button[data-test='shipItButton']",
    "button[data-test='shippingButton']",
    "button[data-test='orderPickupButton']",
    "button[data-test*='addToCart' i]"
  ]) {
    assert.ok(addEntries.some((entry) => entry.selector === selector && entry.matched === 0));
  }
  assert.ok(addEntries.some((entry) => entry.selector === "semantic:add-intent" && entry.matched === 1));
});

test("trace buffers cap output and runners describe authorized and rebound controls", async () => {
  const capped = createAdapterTraceBuffer();
  for (let index = 0; index < 350; index += 1) {
    capped.record({ step: "price", selector: `selector-${index}-${"x".repeat(240)}` });
  }
  assert.equal(capped.entries.length, 300);
  assert.deepEqual(capped.entries.at(-1), { step: "trace", truncated: true });
  assert.equal(capped.entries[0]?.selector?.length, 200);

  const document = fixture("target/product-first-party.html", TARGET_URL);
  const base: BrowserActionContract = {
    contractVersion: 1,
    jobId: "job_trace_target",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: TARGET_URL,
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 5999,
    maxOrderTotalCents: 5999,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Target",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  const job: TargetAddJob = { ...base, adapterVersion: TARGET_ADD_ADAPTER_VERSION };
  const trace: AdapterTraceEntry[] = [];
  const environment = { trace: { record(entry: AdapterTraceEntry) { trace.push(entry); } } };
  const prepared = prepareTargetAdd(document, TARGET_URL, job, NOW, environment);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const original = document.querySelector("button");
  const replacement = original?.cloneNode(true);
  if (original && replacement) original.replaceWith(replacement);
  const result = await commitTargetAdd(document, TARGET_URL, job, prepared.authorizationId, NOW + 100, environment);
  assert.equal(result.reason, "add_control_changed");
  assert.ok(trace.some((entry) => entry.condition === "authorized"));
  assert.ok(trace.some((entry) => entry.condition === "rebound"));
});
