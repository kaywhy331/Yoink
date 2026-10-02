import { reviewedBrowserJobFixture } from "./helpers/official-msrp-browser.js";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { WALMART_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  commitWalmartAdd,
  inspectWalmartCartBaseline,
  prepareWalmartAdd,
  rehearseWalmartAdd,
  type WalmartAddJob,
  verifyWalmartAddedCart
} from "../apps/extension/src/walmart-action.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const RETAILER_FIXTURES = join(process.cwd(), "test", "fixtures", "retailers");
const WALMART_FIXTURES = join(process.cwd(), "test", "fixtures", "walmart");
const PRODUCT_URL = "https://www.walmart.com/ip/fixture/17354421975";
const CART_URL = "https://www.walmart.com/cart";
const NOW = new Date("2026-08-23T16:00:00.000Z").getTime();

function product(): Document {
  return new JSDOM(readFileSync(join(RETAILER_FIXTURES, "walmart-first-party.html"), "utf8"), { url: PRODUCT_URL }).window.document;
}

function semanticDriftProduct(): Document {
  const document = product();
  const price = document.querySelector("[data-automation-id='product-price']");
  price?.removeAttribute("data-automation-id");
  price?.setAttribute("data-testid", "commerce-amount");
  const control = document.querySelector("button[data-automation-id='atc']");
  control?.removeAttribute("data-automation-id");
  control?.setAttribute("data-button-state", "primary-cart-action");
  return document;
}

function pickupProduct(): Document {
  const document = product();
  const fulfillment = document.querySelector("[aria-selected='true']");
  if (fulfillment) fulfillment.textContent = "Pickup at your selected store — ready today";
  return document;
}

function structuredProduct(): Document {
  const offerId = "E3FEC929BA58303AA09F92D2712898BD";
  const productState = {
    usItemId: "20895014480",
    availabilityStatus: "IN_STOCK",
    itemPageAvailabilityStatus: "IN_STOCK",
    showAtc: true,
    isConditionNew: true,
    selectedOfferId: offerId,
    offerId,
    sellerName: "Walmart.com",
    sellerType: "INTERNAL",
    orderLimit: 99,
    priceInfo: { currentPrice: { price: 39.97, currencyUnit: "USD" } },
    conditionOffers: [{
      offerId,
      availabilityStatus: { value: "IN_STOCK" },
      condition: { groupCode: 1 },
      price: { price: 39.97 }
    }],
    fulfillmentOptions: [{
      type: "SHIPPING",
      selected: true,
      intent: true,
      viewOnly: false,
      restricted: false,
      availabilityStatus: "IN_STOCK",
      maxOrderQuantity: 99,
      orderLimit: 99
    }]
  };
  return new JSDOM(`<body><main>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { initialData: { data: { product: productState } } } }
    })}</script>
    <section data-testid="add-to-cart-section"><button data-automation-id="atc">Add to cart</button></section>
  </main></body>`, { url: "https://www.walmart.com/ip/fixture/20895014480" }).window.document;
}

function job(overrides: Partial<WalmartAddJob> = {}): WalmartAddJob {
  const base: BrowserActionContract = {
    contractVersion: 1,
    jobId: "job_walmart_add_fixture",
    retailerId: "walmart",
    retailerSku: "17354421975",
    canonicalUrl: PRODUCT_URL,
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 4499,
    maxOrderTotalCents: 4500,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Walmart",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  return reviewedBrowserJobFixture({ ...base, adapterVersion: WALMART_ADD_ADAPTER_VERSION, ...overrides }, NOW);
}

test("Walmart rehearsal reaches the exact no-click boundary and virtual queues fail closed", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const result = rehearseWalmartAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(clicks, 0);

  const queued = product();
  queued.body.insertAdjacentHTML("afterbegin", "<div role='dialog'>You’re in line in our virtual queue</div>");
  assert.deepEqual(rehearseWalmartAdd(queued, PRODUCT_URL, job(), NOW), {
    ok: false,
    reason: "manual_action_required"
  });
});

test("Walmart v8 rehearses a split current page from its exact selected offer state", () => {
  const url = "https://www.walmart.com/ip/fixture/20895014480";
  const document = structuredProduct();
  let clicks = 0;
  document.querySelector("button[data-automation-id='atc']")?.addEventListener("click", () => { clicks += 1; });
  const exactJob = job({
    retailerSku: "20895014480",
    canonicalUrl: url,
    maxUnitPriceCents: 3997,
    maxOrderTotalCents: 3997
  });
  const result = rehearseWalmartAdd(document, url, exactJob, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(clicks, 0);
});

test("Walmart add consumes its authorization before one click and revalidates the offer", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const prepared = prepareWalmartAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitWalmartAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(committed.clicked, true);
  assert.equal(clicks, 1);
  assert.deepEqual(commitWalmartAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 200), {
    ok: false,
    reason: "authorization_missing",
    clicked: false
  });
  assert.equal(clicks, 1);

  const changed = product();
  const changedPreparation = prepareWalmartAdd(changed, PRODUCT_URL, job(), NOW);
  assert.equal(changedPreparation.ok, true);
  if (!changedPreparation.ok) return;
  const price = changed.querySelector("[data-automation-id='product-price']");
  if (price) price.textContent = "$144.99";
  assert.deepEqual(commitWalmartAdd(changed, PRODUCT_URL, job(), changedPreparation.authorizationId, NOW + 100), {
    ok: false,
    reason: "listed_price_changed",
    clicked: false
  });
});

test("Walmart safely self-heals unique control and price selector drift", () => {
  const document = semanticDriftProduct();
  const control = document.querySelector("[data-button-state='primary-cart-action']");
  assert.ok(control);
  let clicks = 0;
  control.addEventListener("click", () => { clicks += 1; });
  const rehearsal = rehearseWalmartAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(rehearsal.ok, true);
  assert.equal(clicks, 0);
  const prepared = prepareWalmartAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitWalmartAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(clicks, 1);

  const ambiguous = semanticDriftProduct();
  const duplicate = ambiguous.querySelector("[data-button-state='primary-cart-action']")?.cloneNode(true);
  if (duplicate) ambiguous.querySelector("[data-testid='buy-box']")?.append(duplicate);
  assert.equal(prepareWalmartAdd(ambiguous, PRODUCT_URL, job(), NOW).ok, false);
});

test("Walmart guarded Add accepts exact Shipping and rejects Pickup quantity-one jobs", () => {
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ quantity: 2 }), NOW).reason, "quantity_not_supported");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ action: "prepare_checkout" }), NOW).reason, "unsupported_action");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ sellerPolicy: "allow_third_party" }), NOW).reason, "seller_policy_not_supported");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ fulfillment: "either" }), NOW).reason, "fulfillment_not_supported");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ fulfillment: "pickup" }), NOW).ok, false);

  const pickup = pickupProduct();
  let clicks = 0;
  pickup.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const pickupJob = job({ fulfillment: "pickup" });
  const prepared = prepareWalmartAdd(pickup, PRODUCT_URL, pickupJob, NOW);
  assert.deepEqual(prepared, { ok: false, reason: "official_msrp_cart_policy_invalid" });
  assert.equal(commitWalmartAdd(pickup, PRODUCT_URL, pickupJob, "no_authorization", NOW + 100).ok, false);
  assert.equal(clicks, 0);
});

test("Walmart cart preflight captures a bounded baseline and post-add proof requires an exact delta", () => {
  const empty = new JSDOM("<body><main><h1>Your cart is empty</h1></main></body>", { url: CART_URL }).window.document;
  const baseline = inspectWalmartCartBaseline(empty, CART_URL, NOW);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.deepEqual(baseline.proof.lines, []);
  const cart = new JSDOM(readFileSync(join(WALMART_FIXTURES, "cart.html"), "utf8"), { url: CART_URL }).window.document;
  const existing = inspectWalmartCartBaseline(cart, CART_URL, NOW);
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.proof.lineCount, 1);
  const prepared = prepareWalmartAdd(product(), PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const verified = verifyWalmartAddedCart(cart, CART_URL, job(), prepared.proof, baseline.proof, NOW + 500);
  assert.equal(verified.ok, true);
});
