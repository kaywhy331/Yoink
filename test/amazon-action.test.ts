import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { AMAZON_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  commitAmazonAdd,
  inspectAmazonCartBaseline,
  prepareAmazonAdd,
  rehearseAmazonAdd,
  type AmazonAddJob,
  verifyAmazonAddedCart
} from "../apps/extension/src/amazon-action.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const RETAILER_FIXTURES = join(process.cwd(), "test", "fixtures", "retailers");
const AMAZON_FIXTURES = join(process.cwd(), "test", "fixtures", "amazon");
const PRODUCT_URL = "https://www.amazon.com/dp/B0GYTRYV7P";
const CART_URL = "https://www.amazon.com/gp/cart/view.html";
const NOW = new Date("2026-08-23T16:00:00.000Z").getTime();

function product(name = "amazon-first-party.html", url = PRODUCT_URL): Document {
  return new JSDOM(readFileSync(join(RETAILER_FIXTURES, name), "utf8"), { url }).window.document;
}

function semanticDriftProduct(): Document {
  const document = product();
  const price = document.querySelector("#corePrice_feature_div");
  price?.removeAttribute("id");
  price?.setAttribute("data-testid", "commerce-amount");
  price?.querySelector(".a-offscreen")?.removeAttribute("class");
  const control = document.querySelector("#add-to-cart-button");
  control?.removeAttribute("id");
  control?.removeAttribute("name");
  control?.setAttribute("data-button-state", "primary-cart-action");
  return document;
}

function pickupProduct(): Document {
  const document = product();
  document.querySelector("form")?.insertAdjacentHTML(
    "beforeend",
    "<div data-feature-name='delivery-option' role='radio' aria-selected='true'>Pickup at Amazon Locker</div>"
  );
  return document;
}

function job(overrides: Partial<AmazonAddJob> = {}): AmazonAddJob {
  const base: BrowserActionContract = {
    contractVersion: 1,
    jobId: "job_amazon_add_fixture",
    retailerId: "amazon",
    retailerSku: "B0GYTRYV7P",
    canonicalUrl: PRODUCT_URL,
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 2200,
    maxOrderTotalCents: 2200,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Amazon.com",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  return { ...base, adapterVersion: AMAZON_ADD_ADAPTER_VERSION, ...overrides };
}

test("Amazon rehearsal reaches one exact no-click boundary without exposing the offer ID", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("#add-to-cart-button")?.addEventListener("click", (event) => {
    event.preventDefault();
    clicks += 1;
  });
  const result = rehearseAmazonAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(JSON.stringify(result).includes("FIXTURE+OFFER/ONE=="), false);
  assert.equal(clicks, 0);

  const queued = product();
  queued.body.insertAdjacentHTML("afterbegin", "<div role='dialog'>You’re in line in our virtual queue</div>");
  assert.deepEqual(rehearseAmazonAdd(queued, PRODUCT_URL, job(), NOW), {
    ok: false,
    reason: "manual_action_required"
  });
});

test("Amazon add consumes authorization once and revalidates the same ephemeral offer binding", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("#add-to-cart-button")?.addEventListener("click", (event) => {
    event.preventDefault();
    clicks += 1;
  });
  const prepared = prepareAmazonAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  assert.equal(JSON.stringify(prepared).includes("FIXTURE+OFFER/ONE=="), false);
  if (!prepared.ok) return;
  const committed = commitAmazonAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(committed.clicked, true);
  assert.equal(clicks, 1);
  assert.deepEqual(commitAmazonAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 200), {
    ok: false,
    reason: "authorization_missing",
    clicked: false
  });

  const changed = product();
  const changedPreparation = prepareAmazonAdd(changed, PRODUCT_URL, job(), NOW);
  assert.equal(changedPreparation.ok, true);
  if (!changedPreparation.ok) return;
  const offer = changed.querySelector("input[name='offerListingID']") as HTMLInputElement | null;
  if (offer) offer.value = "DIFFERENT_EPHEMERAL_OFFER";
  assert.deepEqual(commitAmazonAdd(changed, PRODUCT_URL, job(), changedPreparation.authorizationId, NOW + 100), {
    ok: false,
    reason: "offer_binding_changed",
    clicked: false
  });
});

test("Amazon safely self-heals unique control and price selector drift", () => {
  const document = semanticDriftProduct();
  const control = document.querySelector("[data-button-state='primary-cart-action']");
  assert.ok(control);
  let clicks = 0;
  control.addEventListener("click", (event) => {
    event.preventDefault();
    clicks += 1;
  });
  const rehearsal = rehearseAmazonAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(rehearsal.ok, true);
  assert.equal(clicks, 0);
  const prepared = prepareAmazonAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitAmazonAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(clicks, 1);

  const ambiguous = semanticDriftProduct();
  const duplicate = ambiguous.querySelector("[data-button-state='primary-cart-action']")?.cloneNode(true);
  if (duplicate) ambiguous.querySelector("form")?.append(duplicate);
  assert.equal(prepareAmazonAdd(ambiguous, PRODUCT_URL, job(), NOW).ok, false);
});

test("Amazon add v8 rejects ambiguity and permits pickup only for an exact selected pickup offer", () => {
  assert.equal(prepareAmazonAdd(product("amazon-marketplace.html"), PRODUCT_URL, job(), NOW).reason, "third_party_seller");
  const separatedMarketplaceUrl = "https://www.amazon.com/dp/B081J5PW5J";
  assert.equal(prepareAmazonAdd(
    product("amazon-offer-display-separated-marketplace.html", separatedMarketplaceUrl),
    separatedMarketplaceUrl,
    job({
      retailerSku: "B081J5PW5J",
      canonicalUrl: separatedMarketplaceUrl,
      maxUnitPriceCents: 1200,
      maxOrderTotalCents: 1200
    }),
    NOW
  ).reason, "third_party_seller");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ quantity: 2 }), NOW).reason, "quantity_not_supported");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ action: "prepare_checkout" }), NOW).reason, "unsupported_action");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ sellerPolicy: "allow_third_party" }), NOW).reason, "seller_policy_not_supported");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ fulfillment: "either" }), NOW).reason, "fulfillment_not_supported");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ fulfillment: "pickup" }), NOW).ok, false);

  const pickup = pickupProduct();
  let pickupClicks = 0;
  pickup.querySelector("#add-to-cart-button")?.addEventListener("click", (event) => {
    event.preventDefault();
    pickupClicks += 1;
  });
  const pickupJob = job({ fulfillment: "pickup" });
  const pickupPreparation = prepareAmazonAdd(pickup, PRODUCT_URL, pickupJob, NOW);
  assert.equal(pickupPreparation.ok, true);
  if (pickupPreparation.ok) {
    assert.equal(commitAmazonAdd(pickup, PRODUCT_URL, pickupJob, pickupPreparation.authorizationId, NOW + 100).ok, true);
  }
  assert.equal(pickupClicks, 1);

  const ambiguous = product();
  ambiguous.querySelector("form")?.insertAdjacentHTML("beforeend", "<input name='offerListingID' value='SECOND_OFFER'>");
  assert.equal(prepareAmazonAdd(ambiguous, PRODUCT_URL, job(), NOW).ok, false);

  const accordionUrl = "https://www.amazon.com/dp/B0FB21526X";
  assert.equal(rehearseAmazonAdd(
    product("amazon-accordion-canonical-offer.html", accordionUrl),
    accordionUrl,
    job({
      retailerSku: "B0FB21526X",
      canonicalUrl: accordionUrl,
      maxUnitPriceCents: 7999,
      maxOrderTotalCents: 7999
    }),
    NOW
  ).ok, true);

  const variationUrl = "https://www.amazon.com/dp/B0FH8M48ZC";
  assert.equal(rehearseAmazonAdd(
    product("amazon-variation-heavy.html", variationUrl),
    variationUrl,
    job({
      retailerSku: "B0FH8M48ZC",
      canonicalUrl: variationUrl,
      maxUnitPriceCents: 17599,
      maxOrderTotalCents: 17599
    }),
    NOW
  ).ok, true);

  const marketplaceAccordionUrl = "https://www.amazon.com/dp/B07ZPS1KVD";
  assert.equal(prepareAmazonAdd(
    product("amazon-accordion-marketplace.html", marketplaceAccordionUrl),
    marketplaceAccordionUrl,
    job({
      retailerSku: "B07ZPS1KVD",
      canonicalUrl: marketplaceAccordionUrl,
      maxUnitPriceCents: 27477,
      maxOrderTotalCents: 27477
    }),
    NOW
  ).reason, "third_party_seller");

  const quantityChanged = product();
  quantityChanged.querySelector("form")?.insertAdjacentHTML("beforeend", "<select id='quantity' name='quantity'><option value='2' selected>2</option></select>");
  assert.equal(prepareAmazonAdd(quantityChanged, PRODUCT_URL, job(), NOW).ok, false);
});

test("Amazon cart preflight captures a bounded baseline and post-add proof requires an exact delta", () => {
  const empty = new JSDOM("<body><main id='sc-active-cart'><h1>Your Amazon Cart is empty</h1></main></body>", { url: CART_URL }).window.document;
  const baseline = inspectAmazonCartBaseline(empty, CART_URL, NOW);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.deepEqual(baseline.proof.lines, []);
  const cart = new JSDOM(readFileSync(join(AMAZON_FIXTURES, "cart.html"), "utf8"), { url: CART_URL }).window.document;
  const existing = inspectAmazonCartBaseline(cart, CART_URL, NOW);
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.proof.lineCount, 1);
  const prepared = prepareAmazonAdd(product(), PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const verified = verifyAmazonAddedCart(cart, CART_URL, job(), prepared.proof, baseline.proof, NOW + 500);
  assert.equal(verified.ok, true);
});
