import { reviewedBrowserJobFixture } from "./helpers/official-msrp-browser.js";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { TARGET_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  observeTargetOffer,
  targetAdapterLayoutEvidence,
  targetPriceModuleLoading
} from "../packages/browser-adapters/src/target.js";
import {
  commitTargetAdd,
  prepareTargetAdd,
  rehearseTargetAdd,
  type TargetAddJob
} from "../apps/extension/src/target-action.js";
import { collectTargetShadowAttempt } from "../apps/extension/src/target-shadow.js";

// October 2026 Target layout, reduced from field capsules (see the fixture headers).
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document; close(): void } }
};
const FIXTURES = join(process.cwd(), "test", "fixtures", "target");
const NOW = new Date("2026-10-09T06:00:00.000Z").getTime();
const OBSERVED_AT = new Date(NOW).toISOString();
const LOADING_SKU = "95290386";
const LOADING_URL = `https://www.target.com/p/-/A-${LOADING_SKU}`;
const SOLD_OUT_SKU = "1010423703";
const SOLD_OUT_URL = `https://www.target.com/p/-/A-${SOLD_OUT_SKU}`;

function page(name: string, url: string): Document {
  return new JSDOM(readFileSync(join(FIXTURES, name), "utf8"), { url }).window.document;
}

function loadingPage(): Document {
  return page("product-price-loading-ship-only.html", LOADING_URL);
}

function job(overrides: Partial<TargetAddJob> = {}): TargetAddJob {
  const base: BrowserActionContract = {
    contractVersion: 1,
    jobId: "job_target_price_loading",
    retailerId: "target",
    retailerSku: LOADING_SKU,
    canonicalUrl: LOADING_URL,
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 1799,
    maxOrderTotalCents: 1800,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Target",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  return reviewedBrowserJobFixture({ ...base, adapterVersion: TARGET_ADD_ADAPTER_VERSION, ...overrides }, NOW);
}

function price(document: Document, fulfillment: "shipping" | "pickup" = "shipping"): number | null {
  return observeTargetOffer(document, LOADING_URL, LOADING_SKU, fulfillment, OBSERVED_AT).unitPriceCents;
}

test("Target price skeleton: the exact-TCIN sticky price is read only while ProductDetailPrice_2 is loading", () => {
  const document = loadingPage();
  assert.equal(targetPriceModuleLoading(document), true);
  const observation = observeTargetOffer(document, LOADING_URL, LOADING_SKU, "shipping", OBSERVED_AT);
  assert.deepEqual({
    availability: observation.availability,
    unitPriceCents: observation.unitPriceCents,
    sellerType: observation.sellerType,
    fulfillment: observation.fulfillment,
    addControlActionable: observation.addControlActionable
  }, { availability: "in_stock", unitPriceCents: 1799, sellerType: "first_party", fulfillment: "shipping", addControlActionable: true });
  assert.equal(targetAdapterLayoutEvidence(document, LOADING_URL, LOADING_SKU, "shipping").priceCandidateCount, 1);
  const attempt = collectTargetShadowAttempt(document, LOADING_URL, "shipping");
  assert.equal(attempt.diagnostic.outcome, "passed", JSON.stringify(attempt.diagnostic));
});

test("Target price skeleton: rehearsal passes and commit clicks only the module's Add to cart", async () => {
  assert.equal(rehearseTargetAdd(loadingPage(), LOADING_URL, job(), NOW).ok, true);
  const document = loadingPage();
  const clicked: string[] = [];
  document.addEventListener("click", (event) => {
    const target = event.target as Element;
    clicked.push(`${target.id}|${target.closest("[data-test='sticky-atc']") ? "sticky" : "page"}`);
  }, true);
  const prepared = prepareTargetAdd(document, LOADING_URL, job(), NOW);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (!prepared.ok) return;
  const commit = await commitTargetAdd(document, LOADING_URL, job(), prepared.authorizationId, NOW);
  assert.equal(commit.ok, true, JSON.stringify(commit));
  assert.deepEqual(clicked, [`addToCartButtonOrTextIdFor${LOADING_SKU}|page`]);
});

test("Target price skeleton: the sticky price still has to match the reviewed MSRP and caps", () => {
  const changed = rehearseTargetAdd(loadingPage(), LOADING_URL, job({ maxUnitPriceCents: 1699, maxOrderTotalCents: 1700 }), NOW);
  assert.equal(changed.ok, false);
  assert.ok(!changed.ok && ["listed_price_changed", "over_unit_cap"].includes(changed.reason), JSON.stringify(changed));
});

test("Target price skeleton: the sticky price is refused unless it is provably the exact item's single online price", () => {
  const otherTcin = loadingPage();
  otherTcin.querySelector("[data-test='sticky-atc'] button")?.setAttribute("id", "addToCartButtonOrTextIdFor99999999");
  assert.equal(price(otherTcin), null);

  const foreignTcin = loadingPage();
  foreignTcin.querySelector("[data-test='sticky-atc'] [data-test='product-title']")?.setAttribute("data-tcin", "88888888");
  assert.equal(price(foreignTcin), null);

  const range = loadingPage();
  range.querySelector("[data-test='sticky-atc'] [data-test='product-price']")!.textContent = "$17.99 - $24.99";
  assert.equal(price(range), null);

  const twoPrices = loadingPage();
  const span = twoPrices.querySelector("[data-test='sticky-atc'] [data-test='product-price']")!;
  span.after(span.cloneNode(true));
  assert.equal(price(twoPrices), null);

  const circle = loadingPage();
  const full = circle.querySelector("[data-test='@web/Price/PriceFull'] > div")!;
  full.insertAdjacentHTML("beforeend", "<div data-test='@web/Price/PriceHandle'>with Target Circle Card</div>");
  assert.equal(price(circle), null);
  const online = loadingPage();
  online.querySelector("[data-test='@web/Price/PriceFull'] > div")!
    .insertAdjacentHTML("beforeend", "<div data-test='@web/Price/PriceHandle'>When purchased online</div>");
  assert.equal(price(online), 1799);

  const twoBars = loadingPage();
  const bar = twoBars.querySelector("[data-test='sticky-atc']")!;
  bar.after(bar.cloneNode(true));
  assert.equal(price(twoBars), null);

  assert.equal(price(loadingPage(), "pickup"), null);

  const noSkeleton = loadingPage();
  noSkeleton.querySelector("[data-test='price-module-placeholder']")?.remove();
  assert.equal(targetPriceModuleLoading(noSkeleton), false);
  assert.equal(price(noSkeleton), null);
});

test("Target hydrated price module wins over the sticky bar", () => {
  const document = loadingPage();
  document.querySelector("[data-test='price-module-placeholder']")!.outerHTML = `<div data-test="price-cdui"><div data-test="price-cdui-row">
    <div data-test="text-quill"><span data-test="text-quill-insert-0">$19.99</span></div></div></div>`;
  assert.equal(targetPriceModuleLoading(document), false);
  assert.equal(price(document), 1999);
});

test("Target sold-out layout is an availability rejection, not an add-control selector miss", () => {
  const document = page("product-sold-out.html", SOLD_OUT_URL);
  const observation = observeTargetOffer(document, SOLD_OUT_URL, SOLD_OUT_SKU, "shipping", OBSERVED_AT);
  assert.equal(observation.availability, "out_of_stock");
  assert.equal(observation.addControlActionable, false);
  const attempt = collectTargetShadowAttempt(document, SOLD_OUT_URL, "shipping");
  assert.deepEqual(
    [attempt.diagnostic.outcome, attempt.diagnostic.failureStage, attempt.diagnostic.reasonCode],
    ["rejected", "availability_binding", "listing_unavailable_layout"]
  );
  const rehearsal = rehearseTargetAdd(document, SOLD_OUT_URL, job({
    jobId: "job_target_sold_out", retailerSku: SOLD_OUT_SKU, canonicalUrl: SOLD_OUT_URL
  }), NOW);
  assert.equal(rehearsal.ok, false);
});

test("Target sold-out needs Target's own status line and no usable Add control", () => {
  const storeLine = page("product-sold-out.html", SOLD_OUT_URL);
  storeLine.querySelector("[aria-label='Fulfillment'] span")!.textContent = "Out of stock at Cedar Rapids South";
  assert.equal(observeTargetOffer(storeLine, SOLD_OUT_URL, SOLD_OUT_SKU, "shipping", OBSERVED_AT).availability, "unknown");

  const enabled = page("product-sold-out.html", SOLD_OUT_URL);
  enabled.querySelector("[data-test='module-product-detail-add-to-cart'] .h-margin-v-default")!
    .insertAdjacentHTML("beforeend", `<button type="button" id="addToCartButtonOrTextIdFor${SOLD_OUT_SKU}">Add to cart</button>`);
  assert.notEqual(observeTargetOffer(enabled, SOLD_OUT_URL, SOLD_OUT_SKU, "shipping", OBSERVED_AT).availability, "out_of_stock");
});

// Promoted field captures (2026-10-09, scrubbed of visitor id, cookies, nearby
// stores, ZIP and store name): test/fixtures/capsules/target/october-*.
const CAPSULES = join(process.cwd(), "test", "fixtures", "capsules", "target");
const CAPTURED_VISIBILITY = { isVisible: (element: Element) => element.getAttribute("data-yoink-vis") === "1" };

function withCapture<T>(slug: string, work: (document: Document, url: string, sku: string) => T): T {
  const metadata = JSON.parse(readFileSync(join(CAPSULES, `${slug}.json`), "utf8")) as { url: string; retailerSku: string };
  const dom = new JSDOM(gunzipSync(readFileSync(join(CAPSULES, `${slug}.html.gz`))).toString("utf8"), { url: metadata.url });
  try {
    return work(dom.window.document, metadata.url, metadata.retailerSku);
  } finally {
    dom.window.close();
  }
}

test("October field captures: a plan for several adds one and raises the cart only up to the exact TCIN's purchase_limit", () => {
  withCapture("october-price-loading-ship-only", (document, url, sku) => {
    const plan = job({ jobId: "job_target_capture_ship_only", retailerSku: sku, canonicalUrl: url, quantity: 3, maxUnitPriceCents: 1799, maxOrderTotalCents: 3 * 1799 });
    const prepared = prepareTargetAdd(document, url, plan, NOW, CAPTURED_VISIBILITY);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.deepEqual(prepared.ok && prepared.quantity, { requested: 3, storeLimit: 2, add: 1, raiseTo: 2 });
  });
  withCapture("october-price-loading-tiles", (document, url, sku) => {
    const plan = job({ jobId: "job_target_capture_tiles", retailerSku: sku, canonicalUrl: url, quantity: 10, maxUnitPriceCents: 5099, maxOrderTotalCents: 10 * 5099 });
    const prepared = prepareTargetAdd(document, url, plan, NOW, CAPTURED_VISIBILITY);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.deepEqual(prepared.ok && prepared.quantity, { requested: 10, storeLimit: 10, add: 1, raiseTo: 10 });
  });
});

test("October field captures: sold out is out_of_stock; an Add control that cannot be bound is not", () => {
  withCapture("october-sold-out", (document, url, sku) => {
    const soldOut = job({ jobId: "job_target_capture_sold_out", retailerSku: sku, canonicalUrl: url });
    assert.equal(prepareTargetAdd(document, url, soldOut, NOW, CAPTURED_VISIBILITY).reason, "out_of_stock");
  });
  withCapture("october-price-loading-ship-only", (document, url, sku) => {
    document.querySelector(`[data-module-type='ProductDetailAddToCart'] #addToCartButtonOrTextIdFor${sku}`)?.remove();
    const plan = job({ jobId: "job_target_capture_unbound", retailerSku: sku, canonicalUrl: url, maxUnitPriceCents: 1799, maxOrderTotalCents: 1799 });
    assert.equal(prepareTargetAdd(document, url, plan, NOW, CAPTURED_VISIBILITY).reason, "add_control_unavailable");
  });
});
